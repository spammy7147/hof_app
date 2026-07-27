import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PartyPresetCatalogLoadCoordinator } from '../../main/domain/partyPresetCatalogLoader';
import type { PartyPresetCatalogResponse } from '../../main/types/api';

describe('party preset catalog load coordinator', () => {
  it('keeps one non-forced request in flight and caches success', async () => {
    const coordinator = new PartyPresetCatalogLoadCoordinator();
    const pending = deferred<PartyPresetCatalogResponse>();
    const first = coordinator.start(() => pending.promise);

    assert.notEqual(first, null);
    assert.equal(coordinator.start(async () => catalog(2)), null);
    pending.resolve(catalog(1));
    assert.deepEqual(await first, { status: 'success', catalog: catalog(1) });
    assert.equal(coordinator.start(async () => catalog(2)), null);
  });

  it('lets a forced refresh supersede an in-flight request', async () => {
    const coordinator = new PartyPresetCatalogLoadCoordinator();
    const oldRequest = deferred<PartyPresetCatalogResponse>();
    const newRequest = deferred<PartyPresetCatalogResponse>();
    const oldOperation = coordinator.start(() => oldRequest.promise);
    const newOperation = coordinator.start(() => newRequest.promise, true);

    assert.notEqual(oldOperation, null);
    assert.notEqual(newOperation, null);
    oldRequest.resolve(catalog(1));
    assert.deepEqual(await oldOperation, { status: 'stale' });
    assert.equal(coordinator.start(async () => catalog(3)), null);
    newRequest.resolve(catalog(2));
    assert.deepEqual(await newOperation, { status: 'success', catalog: catalog(2) });
  });

  it('ignores old account successes and failures without releasing the current request', async () => {
    for (const oldOutcome of ['success', 'failure'] as const) {
      const coordinator = new PartyPresetCatalogLoadCoordinator();
      const oldRequest = deferred<PartyPresetCatalogResponse>();
      const currentRequest = deferred<PartyPresetCatalogResponse>();
      const oldOperation = coordinator.start(() => oldRequest.promise);
      coordinator.invalidate();
      const currentOperation = coordinator.start(() => currentRequest.promise);

      if (oldOutcome === 'success') oldRequest.resolve(catalog(1));
      else oldRequest.reject(new Error('old account'));
      assert.deepEqual(await oldOperation, { status: 'stale' });
      assert.equal(coordinator.start(async () => catalog(3)), null);

      currentRequest.resolve(catalog(2));
      assert.deepEqual(await currentOperation, { status: 'success', catalog: catalog(2) });
    }
  });

  it('returns current failures and allows retry', async () => {
    const coordinator = new PartyPresetCatalogLoadCoordinator();
    const error = new Error('network unavailable');
    const failed = coordinator.start(async () => Promise.reject(error));

    assert.notEqual(failed, null);
    assert.deepEqual(await failed, { status: 'failure', error });
    const retry = coordinator.start(async () => catalog(1));
    assert.notEqual(retry, null);
    assert.deepEqual(await retry, { status: 'success', catalog: catalog(1) });
  });

  it('makes an authoritative mutation replacement supersede an older load', async () => {
    const coordinator = new PartyPresetCatalogLoadCoordinator();
    const pending = deferred<PartyPresetCatalogResponse>();
    const operation = coordinator.start(() => pending.promise);

    assert.deepEqual(coordinator.replace(catalog(2)), {
      status: 'success',
      catalog: catalog(2),
    });
    pending.resolve(catalog(1));
    assert.deepEqual(await operation, { status: 'stale' });
    assert.equal(coordinator.start(async () => catalog(3)), null);
  });
});

function catalog(folderId: number): PartyPresetCatalogResponse {
  return {
    folders: [{ id: folderId, name: `folder-${folderId}`, parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' }],
    presets: [],
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
