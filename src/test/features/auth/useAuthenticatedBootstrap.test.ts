import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  useAuthenticatedBootstrap,
  type AuthenticatedBootstrap,
} from '../../../main/features/auth/useAuthenticatedBootstrap';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useAuthenticatedBootstrap', () => {
  it('keeps character hydration successful when status hydration fails', async () => {
    let bootstrap!: AuthenticatedBootstrap;
    let characterLoads = 0;
    const Harness = () => {
      bootstrap = useAuthenticatedBootstrap({
        generation: 1,
        loadStatus: async () => { throw new Error('status unavailable'); },
        loadCharacters: async () => { characterLoads += 1; },
        startAutomaticSyncIfRequired: async () => undefined,
        describeError: (error) => (error as Error).message,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(bootstrap.status.kind, 'error');
    assert.equal(bootstrap.characters.kind, 'ready');
    assert.equal(characterLoads, 1);
    await act(async () => { renderer.unmount(); });
  });

  it('starts automatic sync from status success even when character hydration fails', async () => {
    let bootstrap!: AuthenticatedBootstrap;
    const autoSync: boolean[] = [];
    const Harness = () => {
      bootstrap = useAuthenticatedBootstrap({
        generation: 1,
        loadStatus: async () => ({ characterSyncRequired: true }),
        loadCharacters: async () => { throw new Error('characters unavailable'); },
        startAutomaticSyncIfRequired: async (required) => { autoSync.push(required); },
        describeError: (error) => (error as Error).message,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(bootstrap.status.kind, 'ready');
    assert.equal(bootstrap.characters.kind, 'error');
    assert.deepEqual(autoSync, [true]);
    await act(async () => { renderer.unmount(); });
  });

  it('retries only the requested failed resource', async () => {
    let bootstrap!: AuthenticatedBootstrap;
    let statusLoads = 0;
    let characterLoads = 0;
    const Harness = () => {
      bootstrap = useAuthenticatedBootstrap({
        generation: 1,
        loadStatus: async () => {
          statusLoads += 1;
          if (statusLoads === 1) throw new Error('status unavailable');
          return { characterSyncRequired: false };
        },
        loadCharacters: async () => { characterLoads += 1; },
        startAutomaticSyncIfRequired: async () => undefined,
        describeError: (error) => (error as Error).message,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await bootstrap.retryStatus(); });

    assert.equal(bootstrap.status.kind, 'ready');
    assert.equal(statusLoads, 2);
    assert.equal(characterLoads, 1);
    await act(async () => { renderer.unmount(); });
  });

  it('does not apply a completed hydration from an old generation', async () => {
    let bootstrap!: AuthenticatedBootstrap;
    const oldStatus = deferred<{ characterSyncRequired: boolean }>();
    const Harness = ({ generation }: { generation: number }) => {
      bootstrap = useAuthenticatedBootstrap({
        generation,
        loadStatus: generation === 1
          ? () => oldStatus.promise
          : async () => ({ characterSyncRequired: false }),
        loadCharacters: async () => undefined,
        startAutomaticSyncIfRequired: async () => undefined,
        describeError: String,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness, { generation: 1 })); });
    await act(async () => {
      renderer.update(React.createElement(Harness, { generation: 2 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      oldStatus.resolve({ characterSyncRequired: true });
      await oldStatus.promise;
    });

    assert.equal(bootstrap.status.kind, 'ready');
    if (bootstrap.status.kind !== 'ready') throw new Error('Expected ready status');
    assert.equal(bootstrap.status.value.characterSyncRequired, false);
    await act(async () => { renderer.unmount(); });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
