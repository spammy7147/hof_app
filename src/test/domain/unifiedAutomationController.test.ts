import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  UnifiedAutomationController,
  type UnifiedAutomationControllerApi,
} from '../../main/domain/unifiedAutomationController';
import type {
  AutomationType,
  CreateUnifiedAutomationModuleRequest,
  QuestSnapshot,
  TypedAutomationAggregateResponse,
  TypedAutomationEntryResponse,
} from '../../main/types/api';

describe('typed unified automation controller', () => {
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

  it('projects each typed singleton to exactly one canonical transitional module', async () => {
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([
        entry(1, 'QUEST', 0),
        entry(2, 'BATTLE_MAP', 1),
        entry(3, 'ADVENTURE_MAP', 2),
      ]),
    }));

    await controller.load();

    assert.deepEqual(controller.getSnapshot().automation?.modules.map((module) => ({
      moduleType: module.moduleType,
      displayName: module.displayName,
    })), [
      { moduleType: 'OTHER_QUEST', displayName: '퀘스트' },
      { moduleType: 'TIME_BURN', displayName: '전투 맵' },
      { moduleType: 'DAILY_ADVENTURE', displayName: '모험 맵' },
    ]);
  });

  it('resolves transitional quest maps to the authoritative single combat mission key', async () => {
    const savedRequests: Parameters<UnifiedAutomationControllerApi['updateQuest']>[0][] = [];
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0)]),
      fetchQuests: async () => [questSnapshot('quest-1', [mission('real-mission', 'MAP_CLEAR')])],
      updateQuest: async (request) => {
        savedRequests.push(request);
        return aggregate([entry(1, 'QUEST', 0)]);
      },
    }));
    await controller.load();

    const saved = await controller.updateModule(1, legacyQuestUpdate('quest-1', true));

    assert.equal(saved, true);
    assert.equal(savedRequests[0]?.quests[0]?.maps[0]?.missionKey, 'real-mission');
  });

  it('rejects missing or ambiguous quest mission resolution without updating settings', async () => {
    let questSnapshots: QuestSnapshot[] = [];
    let updates = 0;
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([entry(1, 'QUEST', 0)]),
      fetchQuests: async () => questSnapshots,
      updateQuest: async () => { updates += 1; return aggregate([entry(1, 'QUEST', 0)]); },
    }));
    await controller.load();

    assert.equal(await controller.updateModule(1, legacyQuestUpdate('missing', true)), false);
    assert.match(controller.getSnapshot().message ?? '', /퀘스트.*찾을 수/);
    questSnapshots = [questSnapshot('quest-1', [mission('immediate', 'IMMEDIATE')])];
    assert.equal(await controller.updateModule(1, legacyQuestUpdate('quest-1', true)), false);
    assert.match(controller.getSnapshot().message ?? '', /전투 미션.*찾을 수/);
    questSnapshots = [questSnapshot('quest-1', [
      mission('kill', 'MONSTER_KILL'),
      mission('clear', 'MAP_CLEAR'),
    ])];
    assert.equal(await controller.updateModule(1, legacyQuestUpdate('quest-1', true)), false);
    assert.match(controller.getSnapshot().message ?? '', /여러.*미션/);
    assert.equal(updates, 0);
  });

  it('allows authoritative immediate or item quests with no configured map rows', async () => {
    let updates = 0;
    for (const type of ['IMMEDIATE', 'ITEM_TURN_IN'] as const) {
      const controller = new UnifiedAutomationController(apiStub({
        fetch: async () => aggregate([entry(1, 'QUEST', 0)]),
        fetchQuests: async () => [questSnapshot('quest-1', [mission(type, type)])],
        updateQuest: async () => { updates += 1; return aggregate([entry(1, 'QUEST', 0)]); },
      }));
      await controller.load();

      assert.equal(await controller.updateModule(1, legacyQuestUpdate('quest-1', false)), true);
    }
    assert.equal(updates, 2);
  });

  it('adopts a created typed entry when settings fail and retries without another create', async () => {
    let creates = 0;
    let updates = 0;
    const controller = new UnifiedAutomationController(apiStub({
      fetch: async () => aggregate([]),
      create: async () => {
        creates += 1;
        return aggregate([entry(1, 'QUEST', 0)]);
      },
      fetchQuests: async () => [questSnapshot('quest-1', [mission('real-key', 'MAP_CLEAR')])],
      updateQuest: async () => {
        updates += 1;
        if (updates === 1) throw new Error('settings failed');
        return aggregate([entry(1, 'QUEST', 0)]);
      },
    }));
    await controller.load();
    const request = legacyQuestCreate('quest-1');

    assert.equal(await controller.createModule(request), false);
    assert.deepEqual(controller.getSnapshot().aggregate?.entries.map(({ id }) => id), [1]);
    assert.equal(await controller.createModule(request), true);
    assert.equal(creates, 1);
    assert.equal(updates, 2);
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
  };
}

function aggregate(
  entries: TypedAutomationEntryResponse[],
  lifecycle: TypedAutomationAggregateResponse['runtime']['lifecycle'] = 'STOPPED',
): TypedAutomationAggregateResponse {
  return {
    entries,
    runtime: { lifecycle, stopReason: null, nextAttemptAt: null, warnings: [], lastError: null },
  };
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

function legacyQuestUpdate(
  questCode: string,
  withMap: boolean,
): Omit<CreateUnifiedAutomationModuleRequest, 'moduleType'> {
  return {
    displayName: '퀘스트',
    enabled: true,
    thresholdPercent: null,
    maps: [],
    quests: [{
      questCode,
      executionOrder: 0,
      maps: withMap ? [{
        categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: null, executionOrder: 0,
      }] : [],
    }],
  };
}

function legacyQuestCreate(questCode: string): CreateUnifiedAutomationModuleRequest {
  return { ...legacyQuestUpdate(questCode, true), moduleType: 'OTHER_QUEST' };
}
