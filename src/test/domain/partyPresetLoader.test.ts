import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PartyPresetLoadCoordinator } from '../../main/domain/partyPresetLoader';
import type { PartyPresetResponse } from '../../main/types/api';

describe('party preset load coordinator', () => {
  it('starts only one loader for rapid normal or forced starts', async () => {
    const coordinator = new PartyPresetLoadCoordinator();
    const pending = deferred<PartyPresetResponse[]>();
    let callCount = 0;
    const loader = () => {
      callCount += 1;
      return pending.promise;
    };

    const first = coordinator.start(loader);
    const overlappingRetry = coordinator.start(loader, true);

    assert.notEqual(first, null);
    assert.equal(overlappingRetry, null);
    assert.equal(callCount, 1);

    pending.resolve([preset(1)]);
    assert.deepEqual(await first, { status: 'success', presets: [preset(1)] });
  });

  it('caches a successful empty list and starts again only when forced', async () => {
    const coordinator = new PartyPresetLoadCoordinator();
    let callCount = 0;
    const loader = async () => {
      callCount += 1;
      return [];
    };

    const first = coordinator.start(loader);
    assert.notEqual(first, null);
    assert.deepEqual(await first, { status: 'success', presets: [] });
    assert.equal(coordinator.start(loader), null);

    const forced = coordinator.start(loader, true);
    assert.notEqual(forced, null);
    assert.deepEqual(await forced, { status: 'success', presets: [] });
    assert.equal(callCount, 2);
  });

  it('releases the request mutex after a failure so retry can start', async () => {
    const coordinator = new PartyPresetLoadCoordinator();
    const loadError = new Error('network unavailable');
    const failed = coordinator.start(async () => Promise.reject(loadError));

    assert.notEqual(failed, null);
    assert.deepEqual(await failed, { status: 'failure', error: loadError });

    const retry = coordinator.start(async () => [preset(2)]);
    assert.notEqual(retry, null);
    assert.deepEqual(await retry, { status: 'success', presets: [preset(2)] });
  });

  it('marks old success or rejection stale without clearing the new account request', async () => {
    for (const oldOutcome of ['success', 'failure'] as const) {
      const coordinator = new PartyPresetLoadCoordinator();
      const oldRequest = deferred<PartyPresetResponse[]>();
      const newRequest = deferred<PartyPresetResponse[]>();
      const oldOperation = coordinator.start(() => oldRequest.promise);

      coordinator.invalidate();
      const newOperation = coordinator.start(() => newRequest.promise);
      assert.notEqual(oldOperation, null);
      assert.notEqual(newOperation, null);

      if (oldOutcome === 'success') {
        oldRequest.resolve([preset(1)]);
      } else {
        oldRequest.reject(new Error('old account failed'));
      }
      assert.deepEqual(await oldOperation, { status: 'stale' });
      assert.equal(coordinator.start(async () => [], true), null);

      newRequest.resolve([preset(2)]);
      assert.deepEqual(await newOperation, { status: 'success', presets: [preset(2)] });
      assert.equal(coordinator.start(async () => []), null);
    }
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function preset(id: number): PartyPresetResponse {
  return {
    id,
    accountId: 1,
    name: `preset-${id}`,
    members: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}
