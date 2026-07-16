import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  UnifiedAutomationController,
  type UnifiedAutomationControllerApi,
} from '../../main/domain/unifiedAutomationController';
import type {
  AutomationType,
  QuestSnapshot,
  TypedAutomationAggregateResponse,
  TypedAutomationEntryResponse,
} from '../../main/types/api';

describe('typed unified automation controller', () => {
  it('exposes typed quest discovery for the dedicated editor', async () => {
    const snapshots = [questSnapshot('quest-1', [mission('kill', 'MONSTER_KILL')])];
    const controller = new UnifiedAutomationController(apiStub({ fetchQuests: async () => snapshots }));

    assert.deepEqual(await controller.fetchQuests(), snapshots);
  });
  it('fences an older load and account-reset responses', async () => {
    const first = deferred<TypedAutomationAggregateResponse>();
    const second = deferred<TypedAutomationAggregateResponse>();
    let calls = 0;
    const controller = new UnifiedAutomationController(apiStub({
      fetch: () => (++calls === 1 ? first.promise : second.promise),
    }));

    const oldLoad = controller.load();
    const newLoad = controller.load();
    second.resolve(aggregate([entry(2, 'BATTLE_MAP', 0)]));
    await newLoad;
    first.resolve(aggregate([entry(1, 'QUEST', 0)]));
    await oldLoad;
    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [2]);

    const stale = deferred<TypedAutomationAggregateResponse>();
    const resetController = new UnifiedAutomationController(apiStub({ fetch: () => stale.promise }));
    const loading = resetController.load();
    resetController.reset();
    stale.resolve(aggregate([entry(99, 'QUEST', 0)]));
    await loading;
    assert.equal(resetController.getSnapshot().aggregate, null);
  });

  it('refreshes battle progress from a quest settings aggregate without replacing battle settings', async () => {
    const battle = battleEntryWithProgress(1, { warnings: ['battle-current'] });
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0), battle]),
      updateQuest: async () => aggregate([
        entry(1, 'QUEST', 0, { warnings: ['quest-saved'] }),
        battleEntryWithProgress(5, { warnings: ['battle-stale'] }),
      ]),
    }));
    await controller.load();

    await controller.saveQuestSettings({ enabled: true, quests: [] });

    const battleAfterSave = controller.getSnapshot().aggregate?.entries.find(({ type }) => type === 'BATTLE_MAP');
    assert.deepEqual(battleAfterSave?.warnings, ['battle-current']);
    assert.deepEqual(battleAfterSave?.battleMapProgress, battleProgress(5));
  });

  it('lets the later aggregate invocation own battle progress when cross-type saves complete in reverse', async () => {
    const questSave = deferred<TypedAutomationAggregateResponse>();
    const adventureSave = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([
        entry(1, 'QUEST', 0), battleEntryWithProgress(1), entry(3, 'ADVENTURE_MAP', 2),
      ]),
      updateQuest: () => questSave.promise,
      updateAdventure: () => adventureSave.promise,
    }));
    await controller.load();

    const savingQuest = controller.saveQuestSettings({ enabled: true, quests: [] });
    const savingAdventure = controller.saveAdventureMapSettings({ enabled: true, maps: [] });
    adventureSave.resolve(aggregate([
      entry(1, 'QUEST', 0), battleEntryWithProgress(9), entry(3, 'ADVENTURE_MAP', 2),
    ]));
    await savingAdventure;
    questSave.resolve(aggregate([
      entry(1, 'QUEST', 0), battleEntryWithProgress(4), entry(3, 'ADVENTURE_MAP', 2),
    ]));
    await savingQuest;

    assert.deepEqual(currentBattleProgress(controller), battleProgress(9));
  });

  it('keeps later quest progress when an earlier battle settings response completes last', async () => {
    const battleSave = deferred<TypedAutomationAggregateResponse>();
    const questSave = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([
        entry(1, 'QUEST', 0),
        battleEntryWithProgress(1, { warnings: ['battle-current'] }),
      ]),
      updateBattle: () => battleSave.promise,
      updateQuest: () => questSave.promise,
    }));
    await controller.load();

    const savingBattle = controller.saveBattleMapSettings({ enabled: true, maps: [] });
    const savingQuest = controller.saveQuestSettings({ enabled: true, quests: [] });
    questSave.resolve(aggregate([
      entry(1, 'QUEST', 0, { warnings: ['quest-saved'] }),
      battleEntryWithProgress(9, { warnings: ['battle-stale'] }),
    ]));
    await savingQuest;
    battleSave.resolve(aggregate([
      entry(1, 'QUEST', 0),
      battleEntryWithProgress(4, { warnings: ['battle-settings'] }),
    ]));
    await savingBattle;

    const entries = controller.getSnapshot().aggregate?.entries;
    const battle = entries?.find(({ type }) => type === 'BATTLE_MAP');
    assert.deepEqual(battle?.warnings, ['battle-settings']);
    assert.deepEqual(battle?.battleMapProgress, battleProgress(9));
    assert.deepEqual(entries?.map(({ type, priority }) => ({ type, priority })), [
      { type: 'QUEST', priority: 0 },
      { type: 'BATTLE_MAP', priority: 1 },
    ]);
  });

  it('does not let a load started before a settings mutation regress newer battle progress', async () => {
    const staleLoad = deferred<TypedAutomationAggregateResponse>();
    let fetches = 0;
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => (++fetches === 1
        ? aggregate([entry(1, 'QUEST', 0), battleEntryWithProgress(1)])
        : staleLoad.promise),
      updateQuest: async () => aggregate([entry(1, 'QUEST', 0), battleEntryWithProgress(8)]),
    }));
    await controller.load();

    const loading = controller.load();
    await controller.saveQuestSettings({ enabled: true, quests: [] });
    staleLoad.resolve(aggregate([entry(1, 'QUEST', 0), battleEntryWithProgress(2)]));
    await loading;

    assert.deepEqual(currentBattleProgress(controller), battleProgress(8));
  });

  it('keeps later lifecycle progress when an earlier load completes last', async () => {
    const staleLoad = deferred<TypedAutomationAggregateResponse>();
    const lifecycle = deferred<TypedAutomationAggregateResponse>();
    let fetches = 0;
    const controller = new UnifiedAutomationController(apiStub({
      fetch: () => (++fetches === 1
        ? Promise.resolve(aggregate([entry(1, 'QUEST', 0), battleEntryWithProgress(1)]))
        : staleLoad.promise),
      changeState: () => lifecycle.promise,
    }));
    await controller.load();

    const loading = controller.load();
    const starting = controller.changeState('start');
    lifecycle.resolve(aggregate([
      entry(1, 'QUEST', 0),
      battleEntryWithProgress(9),
    ], 'RUNNING'));
    await starting;
    staleLoad.resolve(aggregate([
      entry(1, 'QUEST', 0),
      battleEntryWithProgress(4),
    ]));
    await loading;

    assert.deepEqual(currentBattleProgress(controller), battleProgress(9));
    assert.equal(controller.getSnapshot().aggregate?.runtime.lifecycle, 'RUNNING');
  });

  it('does not let a no-battle aggregate claim the progress clock', async () => {
    const staleLoad = deferred<TypedAutomationAggregateResponse>();
    let fetches = 0;
    const controller = new UnifiedAutomationController(apiStub({
      fetch: () => (++fetches === 1
        ? Promise.resolve(aggregate([entry(1, 'QUEST', 0), battleEntryWithProgress(1)]))
        : staleLoad.promise),
      updateQuest: async () => aggregate([
        entry(1, 'QUEST', 0, { warnings: ['quest-saved'] }),
      ]),
    }));
    await controller.load();

    const loading = controller.load();
    await controller.saveQuestSettings({ enabled: true, quests: [] });
    staleLoad.resolve(aggregate([
      entry(1, 'QUEST', 0),
      battleEntryWithProgress(4),
    ]));
    await loading;

    assert.deepEqual(currentBattleProgress(controller), battleProgress(4));
    assert.deepEqual(
      controller.getSnapshot().aggregate?.entries.find(({ type }) => type === 'QUEST')?.warnings,
      ['quest-saved'],
    );
    assert.deepEqual(
      controller.getSnapshot().aggregate?.entries.map(({ type, priority }) => ({ type, priority })),
      [
        { type: 'QUEST', priority: 0 },
        { type: 'BATTLE_MAP', priority: 1 },
      ],
    );
  });

  it('preserves initial battle progress when an older create completes after a later no-battle save', async () => {
    const create = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0)]),
      create: () => create.promise,
      updateQuest: async () => aggregate([
        entry(1, 'QUEST', 0, { warnings: ['quest-saved'] }),
      ]),
    }));
    await controller.load();

    const creating = controller.createEntry('BATTLE_MAP');
    await controller.saveQuestSettings({ enabled: true, quests: [] });
    create.resolve(aggregate([
      entry(1, 'QUEST', 0),
      battleEntryWithProgress(6),
    ]));
    await creating;

    assert.deepEqual(currentBattleProgress(controller), battleProgress(6));
    assert.deepEqual(
      controller.getSnapshot().aggregate?.entries.map(({ type, priority, warnings }) => (
        { type, priority, warnings }
      )),
      [
        { type: 'QUEST', priority: 0, warnings: ['quest-saved'] },
        { type: 'BATTLE_MAP', priority: 1, warnings: [] },
      ],
    );
  });

  it('retains later battle progress until an older create publishes the same membership', async () => {
    const create = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0)]),
      create: () => create.promise,
      updateQuest: async () => aggregate([
        entry(1, 'QUEST', 0, { warnings: ['quest-saved'] }),
        battleEntryWithProgress(9),
      ]),
    }));
    await controller.load();

    const creating = controller.createEntry('BATTLE_MAP');
    await controller.saveQuestSettings({ enabled: true, quests: [] });
    assert.equal(
      controller.getSnapshot().aggregate?.entries.some(({ type }) => type === 'BATTLE_MAP'),
      false,
    );

    create.resolve(aggregate([
      entry(1, 'QUEST', 0),
      battleEntryWithProgress(6),
    ]));
    await creating;

    const battle = controller.getSnapshot().aggregate?.entries.find(({ type }) => type === 'BATTLE_MAP');
    assert.equal(battle?.id, 2);
    assert.deepEqual(battle?.battleMapProgress, battleProgress(9));
    assert.deepEqual(
      controller.getSnapshot().aggregate?.entries.find(({ type }) => type === 'QUEST')?.warnings,
      ['quest-saved'],
    );
  });

  it('does not let an older cross-type response resurrect a deleted battle entry', async () => {
    const questSave = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([
        entry(1, 'QUEST', 0),
        battleEntryWithProgress(1),
      ]),
      updateQuest: () => questSave.promise,
      delete: async () => aggregate([entry(1, 'QUEST', 0)]),
    }));
    await controller.load();

    const savingQuest = controller.saveQuestSettings({ enabled: true, quests: [] });
    await controller.deleteEntry(2);
    questSave.resolve(aggregate([
      entry(1, 'QUEST', 0, { warnings: ['quest-saved'] }),
      battleEntryWithProgress(9),
    ]));
    await savingQuest;

    assert.deepEqual(
      controller.getSnapshot().aggregate?.entries.map(({ type, priority, warnings }) => (
        { type, priority, warnings }
      )),
      [{ type: 'QUEST', priority: 0, warnings: ['quest-saved'] }],
    );
  });

  it('does not apply a deleted membership progress snapshot to a different-id recreate', async () => {
    const create = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([
        entry(1, 'QUEST', 0),
        battleEntryWithProgress(1),
      ]),
      delete: async () => aggregate([entry(1, 'QUEST', 0)]),
      create: () => create.promise,
      updateQuest: async () => aggregate([
        entry(1, 'QUEST', 0, { warnings: ['quest-saved'] }),
        battleEntryWithProgress(9),
      ]),
    }));
    await controller.load();
    await controller.deleteEntry(2);

    const creating = controller.createEntry('BATTLE_MAP');
    await controller.saveQuestSettings({ enabled: true, quests: [] });
    create.resolve(aggregate([
      entry(1, 'QUEST', 0),
      battleEntryWithProgress(6, { id: 3 }),
    ]));
    await creating;

    const battle = controller.getSnapshot().aggregate?.entries.find(({ type }) => type === 'BATTLE_MAP');
    assert.equal(battle?.id, 3);
    assert.deepEqual(battle?.battleMapProgress, battleProgress(6));
    assert.deepEqual(
      controller.getSnapshot().aggregate?.entries.find(({ type }) => type === 'QUEST')?.warnings,
      ['quest-saved'],
    );
  });

  it('does not insert a deleted battle entry and accepts recreated and reset-account progress', async () => {
    let fetches = 0;
    let creates = 0;
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => (++fetches === 1
        ? aggregate([entry(1, 'QUEST', 0), battleEntryWithProgress(1)])
        : aggregate([entry(101, 'QUEST', 0), battleEntryWithProgress(2, { id: 102 })])),
      delete: async () => aggregate([entry(1, 'QUEST', 0)]),
      create: async () => {
        creates += 1;
        return aggregate([entry(1, 'QUEST', 0), battleEntryWithProgress(6)]);
      },
    }));
    await controller.load();

    await controller.deleteEntry(2);
    assert.equal(controller.getSnapshot().aggregate?.entries.some(({ type }) => type === 'BATTLE_MAP'), false);
    await controller.createEntry('BATTLE_MAP');
    assert.equal(creates, 1);
    assert.deepEqual(currentBattleProgress(controller), battleProgress(6));

    controller.reset();
    await controller.load();
    assert.deepEqual(currentBattleProgress(controller), battleProgress(2));
    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [101, 102]);
  });

  it('refreshes battle progress independently through create, delete, reorder, and lifecycle aggregates', async () => {
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0), battleEntryWithProgress(1)]),
      create: async () => aggregate([
        entry(1, 'QUEST', 0), battleEntryWithProgress(2), entry(3, 'ADVENTURE_MAP', 2),
      ]),
      delete: async () => aggregate([entry(1, 'QUEST', 0), battleEntryWithProgress(3)]),
      reorder: async () => aggregate([battleEntryWithProgress(4), entry(1, 'QUEST', 1)]),
      changeState: async () => aggregate([battleEntryWithProgress(5), entry(1, 'QUEST', 1)], 'RUNNING'),
    }));
    await controller.load();

    await controller.createEntry('ADVENTURE_MAP');
    assert.deepEqual(currentBattleProgress(controller), battleProgress(2));
    await controller.deleteEntry(3);
    assert.deepEqual(currentBattleProgress(controller), battleProgress(3));
    controller.reorderEntries([battleEntryWithProgress(3), entry(1, 'QUEST', 1)]);
    await controller.whenReorderIdle();
    assert.deepEqual(currentBattleProgress(controller), battleProgress(4));
    await controller.changeState('start');
    assert.deepEqual(currentBattleProgress(controller), battleProgress(5));
  });

  it('does not apply battle progress from an old-account structural response after reset', async () => {
    const create = deferred<TypedAutomationAggregateResponse>();
    let fetches = 0;
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => {
        const accountGeneration = fetches++;
        return accountGeneration === 0
          ? aggregate([entry(1, 'QUEST', 0), battleEntryWithProgress(1)])
          : aggregate([entry(101, 'QUEST', 0), battleEntryWithProgress(20, { id: 102 })]);
      },
      create: () => create.promise,
    }));
    await controller.load();

    const creating = controller.createEntry('ADVENTURE_MAP');
    controller.reset();
    await controller.load();
    create.resolve(aggregate([
      entry(1, 'QUEST', 0), battleEntryWithProgress(99), entry(3, 'ADVENTURE_MAP', 2),
    ]));
    await creating;

    assert.deepEqual(currentBattleProgress(controller), battleProgress(20));
    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [101, 102]);
  });

  it('coalesces optimistic reorder requests and sends only the latest pending order serially', async () => {
    const first = deferred<TypedAutomationAggregateResponse>();
    const calls: number[][] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1), entry(3, 'ADVENTURE_MAP', 2)]),
      reorder: async (ids) => {
        calls.push(ids);
        return calls.length === 1 ? first.promise : aggregate(ids.map((id, priority) => entry(id, typeFor(id), priority)));
      },
    }));
    await controller.load();

    controller.reorderEntries([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1), entry(3, 'ADVENTURE_MAP', 2)]);
    controller.reorderEntries([entry(3, 'ADVENTURE_MAP', 0), entry(2, 'BATTLE_MAP', 1), entry(1, 'QUEST', 2)]);
    controller.reorderEntries([entry(1, 'QUEST', 0), entry(3, 'ADVENTURE_MAP', 1), entry(2, 'BATTLE_MAP', 2)]);
    assert.deepEqual(calls, [[2, 1, 3]]);
    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [1, 3, 2]);

    first.resolve(aggregate([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1), entry(3, 'ADVENTURE_MAP', 2)]));
    await controller.whenReorderIdle();
    assert.deepEqual(calls, [[2, 1, 3], [1, 3, 2]]);
    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [1, 3, 2]);
  });

  it('does not let a stale reorder response hide a created entry or revive a deleted entry', async () => {
    const reorder = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]),
      reorder: () => reorder.promise,
      create: async () => aggregate([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1), entry(3, 'ADVENTURE_MAP', 2)]),
      delete: async () => aggregate([entry(2, 'BATTLE_MAP', 0), entry(3, 'ADVENTURE_MAP', 1)]),
    }));
    await controller.load();

    controller.reorderEntries([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]);
    await Promise.all([controller.createEntry('ADVENTURE_MAP'), controller.deleteEntry(1)]);
    reorder.resolve(aggregate([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]));
    await controller.whenReorderIdle();

    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [2, 3]);
  });

  it('appends a pending create after a completed reorder instead of applying the stale create order', async () => {
    const create = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]),
      create: () => create.promise,
      reorder: async () => aggregate([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]),
    }));
    await controller.load();

    const creating = controller.createEntry('ADVENTURE_MAP');
    controller.reorderEntries([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]);
    await controller.whenReorderIdle();
    create.resolve(aggregate([
      entry(1, 'QUEST', 0),
      entry(2, 'BATTLE_MAP', 1),
      entry(3, 'ADVENTURE_MAP', 2),
    ]));
    await creating;

    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [2, 1, 3]);
  });

  it('preserves a completed reorder when a later create response carries stale existing-id order', async () => {
    const create = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]),
      create: () => create.promise,
      reorder: async () => aggregate([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]),
    }));
    await controller.load();

    controller.reorderEntries([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]);
    await controller.whenReorderIdle();
    const creating = controller.createEntry('ADVENTURE_MAP');
    create.resolve(aggregate([
      entry(1, 'QUEST', 0),
      entry(2, 'BATTLE_MAP', 1),
      entry(3, 'ADVENTURE_MAP', 2),
    ]));
    await creating;

    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [2, 1, 3]);
  });

  it('preserves relative order when delete and reorder complete in either direction', async () => {
    const deleteBeforeReorder = deferred<TypedAutomationAggregateResponse>();
    const first = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([
        entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1), entry(3, 'ADVENTURE_MAP', 2),
      ]),
      delete: () => deleteBeforeReorder.promise,
      reorder: async () => aggregate([
        entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1), entry(3, 'ADVENTURE_MAP', 2),
      ]),
    }));
    await first.load();
    const deletingFirst = first.deleteEntry(3);
    first.reorderEntries([
      entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1), entry(3, 'ADVENTURE_MAP', 2),
    ]);
    await first.whenReorderIdle();
    deleteBeforeReorder.resolve(aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]));
    await deletingFirst;
    assert.deepEqual(first.getSnapshot().aggregate?.entries.map(({ id }) => id), [2, 1]);

    const deleteAfterReorder = deferred<TypedAutomationAggregateResponse>();
    const second = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([
        entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1), entry(3, 'ADVENTURE_MAP', 2),
      ]),
      delete: () => deleteAfterReorder.promise,
      reorder: async () => aggregate([
        entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1), entry(3, 'ADVENTURE_MAP', 2),
      ]),
    }));
    await second.load();
    second.reorderEntries([
      entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1), entry(3, 'ADVENTURE_MAP', 2),
    ]);
    await second.whenReorderIdle();
    const deletingSecond = second.deleteEntry(3);
    deleteAfterReorder.resolve(aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]));
    await deletingSecond;
    assert.deepEqual(second.getSnapshot().aggregate?.entries.map(({ id }) => id), [2, 1]);
  });

  it('serializes different-type creates in invocation order', async () => {
    const first = deferred<TypedAutomationAggregateResponse>();
    const second = deferred<TypedAutomationAggregateResponse>();
    const calls: AutomationType[] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([]),
      create: ({ type }) => {
        calls.push(type);
        return calls.length === 1 ? first.promise : second.promise;
      },
    }));
    await controller.load();

    const creatingQuest = controller.createEntry('QUEST');
    const creatingBattle = controller.createEntry('BATTLE_MAP');
    assert.deepEqual(calls, ['QUEST']);

    first.resolve(aggregate([entry(1, 'QUEST', 0)]));
    assert.equal(await creatingQuest, true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['QUEST', 'BATTLE_MAP']);
    second.resolve(aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]));
    assert.equal(await creatingBattle, true);
    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [1, 2]);
  });

  it('releases the structural queue after failure so the next create starts', async () => {
    const first = deferred<TypedAutomationAggregateResponse>();
    const second = deferred<TypedAutomationAggregateResponse>();
    const calls: AutomationType[] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([]),
      create: ({ type }) => {
        calls.push(type);
        return calls.length === 1 ? first.promise : second.promise;
      },
    }));
    await controller.load();

    const failedCreate = controller.createEntry('QUEST');
    const successfulCreate = controller.createEntry('BATTLE_MAP');
    first.reject(new Error('create failed'));
    assert.equal(await failedCreate, false);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['QUEST', 'BATTLE_MAP']);
    second.resolve(aggregate([entry(2, 'BATTLE_MAP', 0)]));
    assert.equal(await successfulCreate, true);
  });

  it('reset prevents queued structural work for the old account from starting', async () => {
    const first = deferred<TypedAutomationAggregateResponse>();
    const calls: AutomationType[] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([]),
      create: ({ type }) => {
        calls.push(type);
        return first.promise;
      },
    }));
    await controller.load();

    const inFlight = controller.createEntry('QUEST');
    const queued = controller.createEntry('BATTLE_MAP');
    controller.reset();
    first.resolve(aggregate([entry(1, 'QUEST', 0)]));
    assert.equal(await inFlight, false);
    assert.equal(await queued, false);
    assert.deepEqual(calls, ['QUEST']);
    assert.equal(controller.getSnapshot().aggregate, null);
  });

  it('uses the same structural queue for create followed by delete', async () => {
    const create = deferred<TypedAutomationAggregateResponse>();
    const remove = deferred<TypedAutomationAggregateResponse>();
    const calls: string[] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0)]),
      create: () => { calls.push('create'); return create.promise; },
      delete: () => { calls.push('delete'); return remove.promise; },
    }));
    await controller.load();

    const creating = controller.createEntry('BATTLE_MAP');
    const deleting = controller.deleteEntry(1);
    assert.deepEqual(calls, ['create']);
    create.resolve(aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]));
    await creating;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['create', 'delete']);
    remove.resolve(aggregate([entry(2, 'BATTLE_MAP', 0)]));
    await deleting;
    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [2]);
  });

  it('publishes queued structural row ids while another structural mutation is running', async () => {
    const create = deferred<TypedAutomationAggregateResponse>();
    const remove = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([
        entry(1, 'QUEST', 0),
        entry(2, 'BATTLE_MAP', 1),
      ]),
      create: () => create.promise,
      delete: () => remove.promise,
    }));
    await controller.load();

    const creating = controller.createEntry('ADVENTURE_MAP');
    const deleting = controller.deleteEntry(2);
    assert.deepEqual(controller.getSnapshot().savingEntryIds, [2]);
    assert.equal(controller.getSnapshot().savingEntryIds.includes(1), false);

    create.resolve(aggregate([
      entry(1, 'QUEST', 0),
      entry(2, 'BATTLE_MAP', 1),
      entry(3, 'ADVENTURE_MAP', 2),
    ]));
    await creating;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(controller.getSnapshot().savingEntryIds, [2]);

    remove.resolve(aggregate([entry(1, 'QUEST', 0), entry(3, 'ADVENTURE_MAP', 1)]));
    await deleting;
    assert.deepEqual(controller.getSnapshot().savingEntryIds, []);
  });

  it('recomputes published busy ids when a pending create adds its typed row', async () => {
    const create = deferred<TypedAutomationAggregateResponse>();
    const publishedBusyIds: number[][] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([]),
      create: () => create.promise,
    }));
    await controller.load();
    controller.subscribe(() => publishedBusyIds.push(controller.getSnapshot().savingEntryIds));

    const creating = controller.createEntry('BATTLE_MAP');
    create.resolve(aggregate([entry(2, 'BATTLE_MAP', 0)]));
    await creating;

    assert.equal(publishedBusyIds.some((ids) => ids.includes(2)), true);
    assert.deepEqual(controller.getSnapshot().savingEntryIds, []);
  });

  it('runs save then delete through the same type queue without clearing savingTypes between them', async () => {
    const save = deferred<TypedAutomationAggregateResponse>();
    const remove = deferred<TypedAutomationAggregateResponse>();
    const calls: string[] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(2, 'BATTLE_MAP', 0)]),
      updateBattle: () => { calls.push('save'); return save.promise; },
      delete: () => { calls.push('delete'); return remove.promise; },
    }));
    await controller.load();

    const saving = controller.saveBattleMapSettings({ enabled: true, maps: [] });
    const deleting = controller.deleteEntry(2);
    assert.deepEqual(calls, ['save']);
    assert.deepEqual(controller.getSnapshot().savingTypes, ['BATTLE_MAP']);
    assert.equal(controller.isEntryBusy(2), true);
    save.resolve(aggregate([entry(2, 'BATTLE_MAP', 0, { warnings: ['saved'] })]));
    await saving;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['save', 'delete']);
    assert.deepEqual(controller.getSnapshot().savingTypes, ['BATTLE_MAP']);
    assert.equal(controller.isEntryBusy(2), true);
    remove.resolve(aggregate([]));
    await deleting;
    assert.deepEqual(controller.getSnapshot().savingTypes, []);
    assert.equal(controller.isEntryBusy(2), false);
  });

  it('runs delete then save through the same type queue', async () => {
    const remove = deferred<TypedAutomationAggregateResponse>();
    const save = deferred<TypedAutomationAggregateResponse>();
    const calls: string[] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(2, 'BATTLE_MAP', 0)]),
      delete: () => { calls.push('delete'); return remove.promise; },
      updateBattle: () => { calls.push('save'); return save.promise; },
    }));
    await controller.load();

    const deleting = controller.deleteEntry(2);
    const saving = controller.saveBattleMapSettings({ enabled: false, maps: [] });
    assert.deepEqual(calls, ['delete']);
    remove.resolve(aggregate([]));
    await deleting;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['delete', 'save']);
    save.resolve(aggregate([]));
    await saving;
  });

  it('releases a failed same-type save so queued delete can start', async () => {
    const save = deferred<TypedAutomationAggregateResponse>();
    const calls: string[] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(2, 'BATTLE_MAP', 0)]),
      updateBattle: () => { calls.push('save'); return save.promise; },
      delete: async () => { calls.push('delete'); return aggregate([]); },
    }));
    await controller.load();

    const saving = controller.saveBattleMapSettings({ enabled: true, maps: [] });
    const deleting = controller.deleteEntry(2);
    save.reject(new Error('save failed'));
    assert.equal(await saving, false);
    assert.equal(await deleting, true);
    assert.deepEqual(calls, ['save', 'delete']);
  });

  it('reset cancels structural work queued behind an old-account same-type save', async () => {
    const save = deferred<TypedAutomationAggregateResponse>();
    const calls: string[] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(2, 'BATTLE_MAP', 0)]),
      updateBattle: () => { calls.push('save'); return save.promise; },
      delete: async () => { calls.push('delete'); return aggregate([]); },
    }));
    await controller.load();

    const saving = controller.saveBattleMapSettings({ enabled: true, maps: [] });
    const deleting = controller.deleteEntry(2);
    assert.equal(controller.isEntryBusy(2), true);
    controller.reset();
    save.resolve(aggregate([entry(2, 'BATTLE_MAP', 0)]));
    assert.equal(await saving, false);
    assert.equal(await deleting, false);
    assert.deepEqual(calls, ['save']);
    assert.deepEqual(controller.getSnapshot().savingTypes, []);
    assert.equal(controller.isEntryBusy(2), false);
  });

  it('atomically reserves the type lane so a later same-type save cannot overtake queued create', async () => {
    const createBattle = deferred<TypedAutomationAggregateResponse>();
    const createQuest = deferred<TypedAutomationAggregateResponse>();
    const saveQuest = deferred<TypedAutomationAggregateResponse>();
    const calls: string[] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([]),
      create: ({ type }) => {
        calls.push(`create:${type}`);
        return type === 'BATTLE_MAP' ? createBattle.promise : createQuest.promise;
      },
      updateQuest: () => { calls.push('save:QUEST'); return saveQuest.promise; },
    }));
    await controller.load();

    const battle = controller.createEntry('BATTLE_MAP');
    const quest = controller.createEntry('QUEST');
    const saving = controller.saveQuestSettings({ enabled: true, quests: [] });
    assert.deepEqual(calls, ['create:BATTLE_MAP']);

    createBattle.resolve(aggregate([entry(2, 'BATTLE_MAP', 0)]));
    await battle;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['create:BATTLE_MAP', 'create:QUEST']);
    createQuest.resolve(aggregate([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]));
    await quest;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['create:BATTLE_MAP', 'create:QUEST', 'save:QUEST']);
    saveQuest.resolve(aggregate([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]));
    await saving;
  });

  it('reserves global structural order while delete waits behind an earlier same-type setting', async () => {
    const saveAdventure = deferred<TypedAutomationAggregateResponse>();
    const deleteAdventure = deferred<TypedAutomationAggregateResponse>();
    const createBattle = deferred<TypedAutomationAggregateResponse>();
    const calls: string[] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(3, 'ADVENTURE_MAP', 0)]),
      updateAdventure: () => { calls.push('save:ADVENTURE'); return saveAdventure.promise; },
      delete: () => { calls.push('delete:ADVENTURE'); return deleteAdventure.promise; },
      create: () => { calls.push('create:BATTLE'); return createBattle.promise; },
    }));
    await controller.load();

    const saving = controller.saveAdventureMapSettings({ enabled: true, maps: [] });
    const deleting = controller.deleteEntry(3);
    const creating = controller.createEntry('BATTLE_MAP');
    assert.deepEqual(calls, ['save:ADVENTURE']);
    saveAdventure.resolve(aggregate([entry(3, 'ADVENTURE_MAP', 0)]));
    await saving;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['save:ADVENTURE', 'delete:ADVENTURE']);
    deleteAdventure.resolve(aggregate([]));
    await deleting;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ['save:ADVENTURE', 'delete:ADVENTURE', 'create:BATTLE']);
    createBattle.resolve(aggregate([entry(2, 'BATTLE_MAP', 0)]));
    await creating;
  });

  it('rolls optimistic order back and reloads after reorder failure', async () => {
    let fetches = 0;
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => {
        fetches += 1;
        return aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]);
      },
      reorder: async () => { throw new Error('offline'); },
    }));
    await controller.load();
    controller.reorderEntries([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]);
    await controller.whenReorderIdle();

    assert.equal(fetches, 2);
    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [1, 2]);
    assert.match(controller.getSnapshot().message ?? '', /순서/);
  });

  it('merges lifecycle runtime without overwriting concurrent entry changes', async () => {
    const lifecycle = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0)]),
      changeState: () => lifecycle.promise,
      create: async () => aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]),
    }));
    await controller.load();

    const starting = controller.changeState('start');
    await controller.createEntry('BATTLE_MAP');
    lifecycle.resolve(aggregate([entry(1, 'QUEST', 0)], 'RUNNING'));
    await starting;

    assert.equal(controller.getSnapshot().aggregate?.runtime.lifecycle, 'RUNNING');
    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [1, 2]);
  });

  it('keeps both cross-type setting saves when stale aggregates complete in reverse ownership order', async () => {
    const questSave = deferred<TypedAutomationAggregateResponse>();
    const battleSave = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([
        entry(1, 'QUEST', 0, { warnings: ['quest-old'] }),
        entry(2, 'BATTLE_MAP', 1, { warnings: ['battle-old'] }),
      ]),
      updateQuest: () => questSave.promise,
      updateBattle: () => battleSave.promise,
    }));
    await controller.load();

    const savingQuest = controller.saveQuestSettings({ enabled: true, quests: [] });
    const savingBattle = controller.saveBattleMapSettings({ enabled: true, maps: [] });
    questSave.resolve(aggregate([
      entry(1, 'QUEST', 0, { warnings: ['quest-saved'] }),
      entry(2, 'BATTLE_MAP', 1, { warnings: ['battle-old'] }),
    ]));
    await savingQuest;
    battleSave.resolve(aggregate([
      entry(1, 'QUEST', 0, { warnings: ['quest-old'] }),
      entry(2, 'BATTLE_MAP', 1, { warnings: ['battle-saved'] }),
    ]));
    await savingBattle;

    assert.deepEqual(
      controller.getSnapshot().aggregate?.entries.map(({ type, warnings }) => ({ type, warnings })),
      [
        { type: 'QUEST', warnings: ['quest-saved'] },
        { type: 'BATTLE_MAP', warnings: ['battle-saved'] },
      ],
    );
  });

  it('does not let a pre-reorder settings aggregate restore its old priorities', async () => {
    const settings = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]),
      updateQuest: () => settings.promise,
      reorder: async (ids) => aggregate(ids.map((id, priority) => entry(id, typeFor(id), priority))),
    }));
    await controller.load();

    const saving = controller.saveQuestSettings({ enabled: true, quests: [] });
    controller.reorderEntries([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]);
    await controller.whenReorderIdle();
    settings.resolve(aggregate([
      entry(1, 'QUEST', 0, { warnings: ['quest-saved'] }),
      entry(2, 'BATTLE_MAP', 1),
    ]));
    await saving;

    assert.deepEqual(
      controller.getSnapshot().aggregate?.entries.map(({ id, priority }) => ({ id, priority })),
      [{ id: 2, priority: 0 }, { id: 1, priority: 1 }],
    );
    assert.deepEqual(controller.getSnapshot().aggregate?.entries[1]?.warnings, ['quest-saved']);
  });

  it('lets lifecycle own runtime only when its old aggregate finishes after settings and reorder', async () => {
    const lifecycle = deferred<TypedAutomationAggregateResponse>();
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]),
      changeState: () => lifecycle.promise,
      updateQuest: async () => aggregate([
        entry(1, 'QUEST', 0, { warnings: ['quest-saved'] }),
        entry(2, 'BATTLE_MAP', 1),
      ]),
      reorder: async (ids) => aggregate(ids.map((id, priority) => entry(id, typeFor(id), priority))),
    }));
    await controller.load();

    const starting = controller.changeState('start');
    await controller.saveQuestSettings({ enabled: true, quests: [] });
    controller.reorderEntries([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1, { warnings: ['quest-saved'] })]);
    await controller.whenReorderIdle();
    lifecycle.resolve(aggregate([
      entry(1, 'QUEST', 0, { warnings: ['quest-old'] }),
      entry(2, 'BATTLE_MAP', 1),
    ], 'RUNNING'));
    await starting;

    assert.equal(controller.getSnapshot().aggregate?.runtime.lifecycle, 'RUNNING');
    assert.deepEqual(
      controller.getSnapshot().aggregate?.entries.map(({ id, warnings }) => ({ id, warnings })),
      [{ id: 2, warnings: [] }, { id: 1, warnings: ['quest-saved'] }],
    );
  });

  it('serializes saves for the same type while allowing different types concurrently', async () => {
    const firstBattle = deferred<TypedAutomationAggregateResponse>();
    const secondBattle = deferred<TypedAutomationAggregateResponse>();
    const quest = deferred<TypedAutomationAggregateResponse>();
    let battleCalls = 0;
    let questCalls = 0;
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]),
      updateBattle: () => (++battleCalls === 1 ? firstBattle.promise : secondBattle.promise),
      updateQuest: () => { questCalls += 1; return quest.promise; },
    }));
    await controller.load();

    const battleOne = controller.saveBattleMapSettings({ enabled: true, maps: [] });
    const battleTwo = controller.saveBattleMapSettings({ enabled: false, maps: [] });
    const questSave = controller.saveQuestSettings({ enabled: true, quests: [] });
    assert.equal(battleCalls, 1);
    assert.equal(questCalls, 1);
    assert.deepEqual(new Set(controller.getSnapshot().savingTypes), new Set(['QUEST', 'BATTLE_MAP']));

    firstBattle.resolve(aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]));
    await battleOne;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(battleCalls, 2);
    secondBattle.resolve(aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]));
    quest.resolve(aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]));
    await Promise.all([battleTwo, questSave]);
    assert.deepEqual(controller.getSnapshot().savingTypes, []);
  });

  it('dispose/reset cancels the old account pending reorder queue', async () => {
    const first = deferred<TypedAutomationAggregateResponse>();
    const calls: number[][] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]),
      reorder: (ids) => { calls.push(ids); return first.promise; },
    }));
    await controller.load();
    controller.reorderEntries([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]);
    controller.reorderEntries([entry(1, 'QUEST', 0), entry(2, 'BATTLE_MAP', 1)]);
    const idle = controller.whenReorderIdle();
    controller.reset();
    first.resolve(aggregate([entry(2, 'BATTLE_MAP', 0), entry(1, 'QUEST', 1)]));
    await idle;

    assert.deepEqual(calls, [[2, 1]]);
    assert.equal(controller.getSnapshot().aggregate, null);
  });
});

type Overrides = Partial<UnifiedAutomationControllerApi>;
function apiStub(overrides: Overrides): UnifiedAutomationControllerApi {
  return {
    fetch: overrides.fetch ?? (async () => aggregate([])),
    create: overrides.create ?? (async ({ type }) => aggregate([entry(99, type, 0)])),
    delete: overrides.delete ?? (async () => aggregate([])),
    reorder: overrides.reorder ?? (async (ids) => aggregate(ids.map((id, priority) => entry(id, typeFor(id), priority)))),
    updateQuest: overrides.updateQuest ?? (async () => aggregate([])),
    updateBattle: overrides.updateBattle ?? (async () => aggregate([])),
    updateAdventure: overrides.updateAdventure ?? (async () => aggregate([])),
    fetchQuests: overrides.fetchQuests ?? (async () => []),
    changeState: overrides.changeState ?? (async () => aggregate([])),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function typeFor(id: number): AutomationType {
  return id === 1 ? 'QUEST' : id === 2 ? 'BATTLE_MAP' : 'ADVENTURE_MAP';
}

function entry(
  id: number,
  type: AutomationType,
  priority: number,
  overrides: Partial<TypedAutomationEntryResponse> = {},
): TypedAutomationEntryResponse {
  return {
    id, type, priority, enabled: true, ready: true, warnings: [],
    quests: [], battleMaps: [], adventureMaps: [],
    ...overrides,
    battleMapProgress: overrides.battleMapProgress ?? [],
  };
}

function aggregate(
  entries: TypedAutomationEntryResponse[],
  lifecycle: TypedAutomationAggregateResponse['runtime']['lifecycle'] = 'STOPPED',
): TypedAutomationAggregateResponse {
  return {
    entries,
    runtime: {
      lifecycle,
      stopReason: null,
      nextAttemptAt: null,
      warnings: [],
      lastError: null,
      currentAction: null,
      dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null },
    },
  };
}

function battleProgress(successfulRuns: number) {
  return [{ categoryId: 'battle_map', mapCode: 'gb0', successfulRuns }];
}

function battleEntryWithProgress(
  successfulRuns: number,
  overrides: Partial<TypedAutomationEntryResponse> = {},
): TypedAutomationEntryResponse {
  return entry(overrides.id ?? 2, 'BATTLE_MAP', overrides.priority ?? 1, {
    ...overrides,
    battleMapProgress: battleProgress(successfulRuns),
  });
}

function currentBattleProgress(controller: UnifiedAutomationController) {
  return controller.getSnapshot().aggregate?.entries.find(({ type }) => type === 'BATTLE_MAP')?.battleMapProgress;
}

function mission(key: string, type: QuestSnapshot['missions'][number]['type']) {
  return { key, type, target: null, progress: null, completable: false };
}

function questSnapshot(questId: string, missions: QuestSnapshot['missions']): QuestSnapshot {
  return {
    questId,
    name: questId,
    state: 'ACTIVE',
    section: 'ACTIVE',
    sourceOrder: 0,
    missions,
    actionNo: null,
  };
}
