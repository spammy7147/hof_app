import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PartyPresetCatalogModule,
  type PartyPresetCatalogBackend,
} from '../../main/domain/partyPresetCatalogModule';
import type { PartyPresetCatalogResponse, PartyPresetResponse } from '../../main/types/api';

describe('party preset catalog module', () => {
  it('exposes initial load, failure, and retry through one observable snapshot', async () => {
    const loadResults = [
      Promise.reject(new Error('network unavailable')),
      Promise.resolve(catalog(2)),
    ];
    const module = createModule({
      loadCatalog: () => loadResults.shift()!,
    });
    const observed: Array<{ loading: boolean; error: string | null }> = [];
    module.subscribe(() => {
      const snapshot = module.getSnapshot();
      observed.push({ loading: snapshot.loading, error: snapshot.error });
    });

    await module.activate('account-a');
    assert.equal(module.getSnapshot().loading, false);
    assert.equal(module.getSnapshot().error, '파티 프리셋을 불러오지 못했습니다.');

    await module.reload();
    assert.deepEqual(module.getSnapshot().catalog, catalog(2));
    assert.equal(module.getSnapshot().error, null);
    assert.deepEqual(observed, [
      { loading: true, error: null },
      { loading: false, error: '파티 프리셋을 불러오지 못했습니다.' },
      { loading: true, error: null },
      { loading: false, error: null },
    ]);
  });

  it('ignores late responses from an earlier request or account', async () => {
    const oldAccount = deferred<PartyPresetCatalogResponse>();
    const newAccount = deferred<PartyPresetCatalogResponse>();
    const loads = [oldAccount, newAccount];
    const module = createModule({ loadCatalog: () => loads.shift()!.promise });

    const stale = module.activate('account-a');
    const current = module.activate('account-b');
    oldAccount.resolve(catalog(1));
    await stale;
    assert.equal(module.getSnapshot().loading, true);
    assert.deepEqual(module.getSnapshot().catalog, emptyCatalog());

    newAccount.resolve(catalog(2));
    await current;
    assert.deepEqual(module.getSnapshot().catalog, catalog(2));
  });

  it('lets a force reload supersede an older request for the same account', async () => {
    const oldRequest = deferred<PartyPresetCatalogResponse>();
    const currentRequest = deferred<PartyPresetCatalogResponse>();
    const loads = [oldRequest, currentRequest];
    const module = createModule({ loadCatalog: () => loads.shift()!.promise });

    const oldLoad = module.activate('account-a');
    const currentLoad = module.reload();
    oldRequest.resolve(catalog(1));
    await oldLoad;
    assert.equal(module.getSnapshot().loading, true);

    currentRequest.resolve(catalog(2));
    await currentLoad;
    assert.deepEqual(module.getSnapshot().catalog, catalog(2));
  });

  it('serializes create and update, projects each result, then converges to authoritative loads', async () => {
    const createResult = deferred<PartyPresetResponse>();
    const createReload = deferred<PartyPresetCatalogResponse>();
    const updateResult = deferred<PartyPresetResponse>();
    const updateReload = deferred<PartyPresetCatalogResponse>();
    const calls: string[] = [];
    const loads = [
      Promise.resolve(catalogWithPresets(preset(1, 'existing'))),
      createReload.promise,
      updateReload.promise,
    ];
    const module = createModule({
      loadCatalog: () => {
        calls.push('load');
        return loads.shift()!;
      },
      createPreset: async () => {
        calls.push('create');
        return createResult.promise;
      },
      updatePreset: async () => {
        calls.push('update');
        return updateResult.promise;
      },
    });
    await module.activate('account-a');

    const creating = module.createPreset({ name: 'created', members: [] });
    const updating = module.updatePreset(1, { name: 'updated', members: [] });
    await Promise.resolve();
    assert.deepEqual(calls, ['load', 'create']);

    createResult.resolve(preset(2, 'created'));
    await waitFor(() => module.getSnapshot().catalog.presets.some(({ id }) => id === 2));
    assert.equal(module.getSnapshot().loading, true);
    assert.deepEqual(calls, ['load', 'create', 'load']);
    createReload.resolve(catalogWithPresets(preset(1, 'existing'), preset(2, 'server-created')));
    await creating;
    await waitFor(() => calls.includes('update'));
    assert.deepEqual(calls, ['load', 'create', 'load', 'update']);

    updateResult.resolve(preset(1, 'updated'));
    await waitFor(() => module.getSnapshot().catalog.presets[0]?.name === 'updated');
    updateReload.resolve(catalogWithPresets(preset(1, 'server-updated'), preset(2, 'server-created')));
    await updating;

    assert.deepEqual(calls, ['load', 'create', 'load', 'update', 'load']);
    assert.deepEqual(
      module.getSnapshot().catalog.presets.map(({ name }) => name),
      ['server-updated', 'server-created'],
    );
  });

  it('does not apply an in-flight mutation after the account changes', async () => {
    const mutation = deferred<PartyPresetResponse>();
    const module = createModule({
      loadCatalog: async () => emptyCatalog(),
      createPreset: () => mutation.promise,
    });
    await module.activate('account-a');
    const creating = module.createPreset({ name: 'old account', members: [] });
    await Promise.resolve();
    await module.activate('account-b');

    mutation.resolve(preset(1, 'old account'));
    await creating;
    assert.deepEqual(module.getSnapshot().catalog, emptyCatalog());
  });

  it('projects one primary preset immediately and converges to the authoritative catalog', async () => {
    const primaryResult = deferred<PartyPresetResponse>();
    const reload = deferred<PartyPresetCatalogResponse>();
    const module = createModule({
      loadCatalog: sequence(
        Promise.resolve(catalogWithPresets(preset(1, 'first', true), preset(2, 'second'))),
        reload.promise,
      ),
      makePresetPrimary: () => primaryResult.promise,
    });
    await module.activate('account-a');

    const makingPrimary = module.makePresetPrimary(2);
    assert.deepEqual(
      module.getSnapshot().catalog.presets.map(({ id, isPrimary }) => [id, isPrimary]),
      [[1, false], [2, true]],
    );

    primaryResult.resolve(preset(2, 'second', true));
    await waitFor(() => module.getSnapshot().loading);
    reload.resolve(catalogWithPresets(preset(1, 'server-first'), preset(2, 'server-second', true)));
    await makingPrimary;
    assert.deepEqual(
      module.getSnapshot().catalog.presets.map(({ name, isPrimary }) => [name, isPrimary]),
      [['server-first', false], ['server-second', true]],
    );
  });

  it('keeps the latest optimistic reorder while rapid requests converge in queue order', async () => {
    const firstResult = deferred<PartyPresetResponse[]>();
    const firstReload = deferred<PartyPresetCatalogResponse>();
    const secondResult = deferred<PartyPresetResponse[]>();
    const secondReload = deferred<PartyPresetCatalogResponse>();
    const reorderCalls: number[][] = [];
    const reorderResults = [firstResult, secondResult];
    const module = createModule({
      loadCatalog: sequence(
        Promise.resolve(catalogWithPresets(preset(1, 'one'), preset(2, 'two'), preset(3, 'three'))),
        firstReload.promise,
        secondReload.promise,
      ),
      reorderPresets: (request) => {
        reorderCalls.push(request.presetIds);
        return reorderResults.shift()!.promise;
      },
    });
    await module.activate('account-a');

    const first = module.reorderPresets({ folderId: null, presetIds: [3, 2, 1] });
    const second = module.reorderPresets({ folderId: null, presetIds: [2, 1, 3] });
    assert.deepEqual(presetIds(module), [2, 1, 3]);
    await Promise.resolve();
    assert.deepEqual(reorderCalls, [[3, 2, 1]]);

    const firstOrder = orderedPresets([3, 2, 1]);
    firstResult.resolve(firstOrder);
    await waitFor(() => module.getSnapshot().loading);
    assert.deepEqual(presetIds(module), [2, 1, 3]);
    firstReload.resolve(catalogWithPresets(...firstOrder));
    await first;
    await waitFor(() => reorderCalls.length === 2);
    assert.deepEqual(reorderCalls, [[3, 2, 1], [2, 1, 3]]);
    assert.deepEqual(presetIds(module), [2, 1, 3]);

    const finalOrder = orderedPresets([2, 1, 3]);
    secondResult.resolve(finalOrder);
    await waitFor(() => module.getSnapshot().loading);
    secondReload.resolve(catalogWithPresets(...finalOrder));
    await second;
    assert.deepEqual(presetIds(module), [2, 1, 3]);
  });

  it('removes a preset for every subscriber and rolls back to authority on failure', async () => {
    const deletion = deferred<null>();
    const initial = catalogWithPresets(preset(1, 'one'), preset(2, 'two'));
    const recovered = catalogWithPresets(preset(1, 'server-one'), preset(2, 'server-two'), preset(3, 'server-three'));
    const module = createModule({
      loadCatalog: sequence(Promise.resolve(initial), Promise.resolve(recovered)),
      deletePreset: () => deletion.promise,
    });
    await module.activate('account-a');
    const observedPresetIds: number[][] = [];
    module.subscribe(() => observedPresetIds.push(presetIds(module)));

    const deleting = module.deletePreset(1);
    assert.deepEqual(presetIds(module), [2]);
    deletion.reject(new Error('delete failed'));
    await assert.rejects(deleting, /delete failed/);

    assert.deepEqual(presetIds(module), [1, 2, 3]);
    assert.equal(module.getSnapshot().error, null);
    assert.equal(module.getSnapshot().mutationError, '파티 프리셋을 변경하지 못했습니다.');
    assert.ok(observedPresetIds.some((ids) => ids.length === 1 && ids[0] === 2));
    assert.deepEqual(observedPresetIds.at(-1), [1, 2, 3]);
  });

  it('keeps a load freshness error while a mutation is only queued', async () => {
    const authoritative = catalogWithPresets(preset(1, 'one'), preset(2, 'server-two', true));
    const module = createModule({
      loadCatalog: sequence(
        Promise.resolve(catalogWithPresets(preset(1, 'one', true), preset(2, 'two'))),
        Promise.reject(new Error('reload failed')),
        Promise.resolve(authoritative),
      ),
    });
    await module.activate('account-a');
    await module.reload();
    assert.equal(module.getSnapshot().error, '파티 프리셋을 불러오지 못했습니다.');

    const mutation = module.makePresetPrimary(2);
    assert.equal(module.getSnapshot().error, '파티 프리셋을 불러오지 못했습니다.');
    await mutation;
    assert.equal(module.getSnapshot().error, null);
  });

  it('does not publish a late primary result after switching accounts', async () => {
    const primaryResult = deferred<PartyPresetResponse>();
    const module = createModule({
      loadCatalog: sequence(
        Promise.resolve(catalogWithPresets(preset(1, 'old-primary', true), preset(2, 'old'))),
        Promise.resolve(catalogWithPresets(preset(9, 'new-primary', true))),
      ),
      makePresetPrimary: () => primaryResult.promise,
    });
    await module.activate('account-a');
    const oldMutation = module.makePresetPrimary(2);
    await Promise.resolve();
    await module.activate('account-b');

    primaryResult.resolve(preset(2, 'old', true));
    await oldMutation;
    assert.deepEqual(presetIds(module), [9]);
    assert.equal(module.getSnapshot().catalog.presets[0]?.name, 'new-primary');
  });

  it('clears an earlier mutation notice when the next queued mutation succeeds', async () => {
    const failedReorder = deferred<PartyPresetResponse[]>();
    const successfulReorder = deferred<PartyPresetResponse[]>();
    const reorderResults = [failedReorder, successfulReorder];
    const initial = catalogWithPresets(preset(1, 'one'), preset(2, 'two'));
    const finalOrder = orderedPresets([2, 1]);
    const module = createModule({
      loadCatalog: sequence(
        Promise.resolve(initial),
        Promise.resolve(initial),
        Promise.resolve(catalogWithPresets(...finalOrder)),
      ),
      reorderPresets: () => reorderResults.shift()!.promise,
    });
    await module.activate('account-a');

    const first = module.reorderPresets({ folderId: null, presetIds: [2, 1] });
    const second = module.reorderPresets({ folderId: null, presetIds: [2, 1] });
    await Promise.resolve();
    failedReorder.reject(new Error('first failed'));
    await assert.rejects(first, /first failed/);
    await waitFor(() => module.getSnapshot().mutationError == null);

    successfulReorder.resolve(finalOrder);
    await second;
    assert.deepEqual(presetIds(module), [2, 1]);
    assert.equal(module.getSnapshot().error, null);
    assert.equal(module.getSnapshot().mutationError, null);
  });

  it('cancels queued mutations until a failed authority recovery is retried', async () => {
    const deletion = deferred<null>();
    let primaryCalls = 0;
    const initial = catalogWithPresets(preset(1, 'one', true), preset(2, 'two'));
    const module = createModule({
      loadCatalog: sequence(
        Promise.resolve(initial),
        Promise.reject(new Error('recovery unavailable')),
      ),
      deletePreset: () => deletion.promise,
      makePresetPrimary: async (presetId) => {
        primaryCalls += 1;
        return preset(presetId, 'two', true);
      },
    });
    await module.activate('account-a');

    const failed = module.deletePreset(1);
    const queued = module.makePresetPrimary(2);
    await Promise.resolve();
    deletion.reject(new Error('delete failed'));
    await assert.rejects(failed, /delete failed/);
    await assert.rejects(queued, /refresh required/);

    assert.equal(primaryCalls, 0);
    assert.equal(module.getSnapshot().error, '파티 프리셋을 불러오지 못했습니다.');
    assert.equal(module.getSnapshot().mutationError, '파티 프리셋을 변경하지 못했습니다.');
  });
});

function createModule(overrides: Partial<PartyPresetCatalogBackend> = {}) {
  const backend: PartyPresetCatalogBackend = {
    loadCatalog: async () => emptyCatalog(),
    createPreset: async (request) => preset(1, request.name),
    updatePreset: async (presetId, request) => preset(presetId, request.name),
    makePresetPrimary: async (presetId) => preset(presetId, `preset-${presetId}`, true),
    reorderPresets: async (request) => orderedPresets(request.presetIds),
    deletePreset: async () => null,
    ...overrides,
  };
  return new PartyPresetCatalogModule(backend);
}

function emptyCatalog(): PartyPresetCatalogResponse {
  return { folders: [], presets: [] };
}

function catalog(folderId: number): PartyPresetCatalogResponse {
  return {
    folders: [{ id: folderId, name: `folder-${folderId}`, parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' }],
    presets: [],
  };
}

function catalogWithPresets(...presets: PartyPresetResponse[]): PartyPresetCatalogResponse {
  return { folders: [], presets };
}

function preset(id: number, name: string, isPrimary = false): PartyPresetResponse {
  return {
    id,
    accountId: 1,
    name,
    folderId: null,
    displayOrder: id - 1,
    isPrimary,
    members: [],
    createdAt: '',
    updatedAt: '',
  };
}

function orderedPresets(ids: number[]): PartyPresetResponse[] {
  return ids.map((id, displayOrder) => ({
    ...preset(id, ['zero', 'one', 'two', 'three'][id] ?? `preset-${id}`),
    displayOrder,
  }));
}

function presetIds(module: PartyPresetCatalogModule): number[] {
  return [...module.getSnapshot().catalog.presets]
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map(({ id }) => id);
}

function sequence<T>(...values: Array<Promise<T>>): () => Promise<T> {
  return () => values.shift()!;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('condition was not met');
}
