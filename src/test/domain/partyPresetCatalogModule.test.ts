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
});

function createModule(overrides: Partial<PartyPresetCatalogBackend> = {}) {
  const backend: PartyPresetCatalogBackend = {
    loadCatalog: async () => emptyCatalog(),
    createPreset: async (request) => preset(1, request.name),
    updatePreset: async (presetId, request) => preset(presetId, request.name),
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

function preset(id: number, name: string): PartyPresetResponse {
  return {
    id,
    accountId: 1,
    name,
    folderId: null,
    displayOrder: id - 1,
    isPrimary: false,
    members: [],
    createdAt: '',
    updatedAt: '',
  };
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
