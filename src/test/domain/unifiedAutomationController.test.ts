import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  UnifiedAutomationController,
  type UnifiedAutomationControllerApi,
} from '../../main/domain/unifiedAutomationController';
import type {
  AutomationType,
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

function entry(id: number, type: AutomationType, priority: number): TypedAutomationEntryResponse {
  return {
    id, type, priority, enabled: true, ready: true, warnings: [],
    quests: [], battleMaps: [], adventureMaps: [],
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
