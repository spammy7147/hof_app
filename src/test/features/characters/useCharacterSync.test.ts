import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useCharacterSync } from '../../../main/features/characters/useCharacterSync';
import type { BackendApiClient } from '../../../main/services/backendApi';
import type { CharacterSyncJobResponse, HofCharacter, HofObservedStatusResponse } from '../../../main/types/api';
import { makeHofCharacter } from '../../fixtures/api';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useCharacterSync roster observation', () => {
  it('reloads characters only for a newer observed home roster', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    let publishStatus: ((status: HofObservedStatusResponse) => void) | null = null;
    let listCalls = 0;
    const rosters: HofCharacter[][] = [
      [makeHofCharacter(1, { name: '첫 목록' })],
      [makeHofCharacter(2, { name: '다음 목록' })],
    ];
    const api = {
      subscribeHofStatus(listener: (status: HofObservedStatusResponse) => void) {
        publishStatus = listener;
        return () => { publishStatus = null; };
      },
      async listCharacters() {
        const result = rosters[listCalls] ?? rosters.at(-1) ?? [];
        listCalls += 1;
        return result;
      },
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({ api, describeError: String, onNotice: () => undefined });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    await act(async () => {
      publishStatus?.(observedStatus('2026-08-18T07:00:00Z'));
      await Promise.resolve();
    });
    assert.equal(listCalls, 1);
    assert.equal(sync.characters[0]?.name, '첫 목록');

    await act(async () => {
      publishStatus?.(observedStatus('2026-08-18T07:00:00Z'));
      publishStatus?.(observedStatus('2026-08-18T06:59:59Z'));
      await Promise.resolve();
    });
    assert.equal(listCalls, 1);

    await act(async () => {
      publishStatus?.(observedStatus('2026-08-18T07:00:01Z'));
      await Promise.resolve();
    });
    assert.equal(listCalls, 2);
    assert.equal(sync.characters[0]?.name, '다음 목록');
    await act(async () => { renderer.unmount(); });
  });

  it('starts one manual roster sync while the start request is in flight', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    let startCalls = 0;
    const started = deferred<CharacterSyncJobResponse>();
    const api = {
      subscribeHofStatus: () => () => undefined,
      async startCharacterSyncJob() {
        startCalls += 1;
        return started.promise;
      },
      subscribeCharacterSyncJob: () => ({ close: () => undefined }),
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({ api, describeError: String, onNotice: () => undefined });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = sync.startCharacterSync();
      second = sync.startCharacterSync();
      await Promise.resolve();
    });
    assert.equal(startCalls, 1);
    assert.equal(sync.characterSyncLabel, '동기화 준비 중');

    await act(async () => {
      started.resolve(syncJob());
      await Promise.all([first, second]);
    });
    assert.equal(sync.characterSyncJob?.jobId, 17);
    await act(async () => { renderer.unmount(); });
  });

  it('clears the progress label and publishes an error when manual sync cannot start', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    const notices: Array<string | null> = [];
    const api = {
      subscribeHofStatus: () => () => undefined,
      async startCharacterSyncJob() {
        throw new Error('start failed');
      },
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({
        api,
        describeError: (error) => error instanceof Error ? error.message : String(error),
        onNotice: (message) => notices.push(message),
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    await act(async () => { await sync.startCharacterSync(); });

    assert.equal(sync.characterSyncLabel, null);
    assert.deepEqual(notices, ['start failed']);
    await act(async () => { renderer.unmount(); });
  });
});

function syncJob(): CharacterSyncJobResponse {
  return {
    jobId: 17,
    accountId: 1,
    status: 'pending',
    rosterCount: 0,
    syncedCount: 0,
    failedCharacterIds: [],
    characters: [],
    message: null,
    startedAt: '2026-08-18T07:00:00Z',
    finishedAt: null,
    stopRequested: false,
    lastCompletedRosterIndex: -1,
    currentHofCharacterId: null,
  };
}

function observedStatus(characterRosterObservedAt: string): HofObservedStatusResponse {
  return {
    playerName: '사용자',
    funds: 100,
    timeCurrent: 10,
    timeMax: 20,
    work: 'Nothing',
    auction: 'Nothing',
    observedAt: characterRosterObservedAt,
    characterRosterObservedAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
