import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useCharacterSync } from '../../../main/features/characters/useCharacterSync';
import type { CharacterManagementObservationSink } from '../../../main/domain/characterManagementHubModule';
import type { BackendApiClient, CharacterSyncEventHandlers } from '../../../main/services/backendApi';
import type { CharacterSyncEventResponse, CharacterSyncJobResponse, HofCharacter, HofObservedStatusResponse } from '../../../main/types/api';
import { makeHofCharacter } from '../../fixtures/api';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useCharacterSync roster observation', () => {
  it('reloads characters only for a newer observed home roster', async () => {
    let publishStatus: ((status: HofObservedStatusResponse) => void) | null = null;
    let listCalls = 0;
    const rosters: HofCharacter[][] = [
      [makeHofCharacter(1, { name: '첫 목록' })],
      [makeHofCharacter(2, { name: '다음 목록' })],
    ];
    const observations = recordingObservations();
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
      useCharacterSync({
        api,
        describeError: String,
        observations: observations.sink,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    await act(async () => {
      publishStatus?.(observedStatus('2026-08-18T07:00:00Z'));
      await Promise.resolve();
    });
    assert.equal(listCalls, 1);
    assert.equal(observations.rosters[0]?.[0]?.name, '첫 목록');

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
    assert.equal(observations.rosters[1]?.[0]?.name, '다음 목록');
    await act(async () => { renderer.unmount(); });
  });

  it('synchronizes only the roster without starting a full detail job', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    let rosterSyncCalls = 0;
    let fullSyncCalls = 0;
    const roster = deferred<HofCharacter[]>();
    const observations = recordingObservations();
    const api = {
      subscribeHofStatus: () => () => undefined,
      async syncCharacterRoster() {
        rosterSyncCalls += 1;
        return roster.promise;
      },
      async startCharacterSyncJob() {
        fullSyncCalls += 1;
        return syncJob();
      },
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({
        api,
        describeError: String,
        observations: observations.sink,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = sync.syncCharacterRoster();
      second = sync.syncCharacterRoster();
      await Promise.resolve();
    });
    assert.equal(rosterSyncCalls, 1);
    assert.equal(fullSyncCalls, 0);
    assert.equal(sync.characterSyncLabel, '목록 동기화 중');

    await act(async () => {
      roster.resolve([makeHofCharacter(1, { name: '목록 전용' })]);
      await Promise.all([first, second]);
    });
    assert.equal(observations.rosters[0]?.[0]?.name, '목록 전용');
    assert.equal(sync.characterSyncLabel, null);
    await act(async () => { renderer.unmount(); });
  });

  it('forwards SSE character observations while retaining only the job snapshot', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    let handlers: CharacterSyncEventHandlers | null = null;
    const observations = recordingObservations();
    const api = {
      subscribeHofStatus: () => () => undefined,
      async startCharacterSyncJob() { return syncJob(); },
      subscribeCharacterSyncJob(_jobId: number, nextHandlers: CharacterSyncEventHandlers) {
        handlers = nextHandlers;
        return { close: () => undefined };
      },
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({
        api,
        describeError: String,
        observations: observations.sink,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { await sync.startCharacterFullSync(); });
    const observed = makeHofCharacter(1, { name: 'SSE 관측' });

    await act(async () => { requireHandlers(handlers).onEvent(syncEvent(observed)); });

    assert.equal(observations.characters[0], observed);
    assert.deepEqual(sync.characterSyncJob?.characters, []);
    await act(async () => { renderer.unmount(); });
  });

  it('does not restore an old sync job when resume completes after reset', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    const resumed = deferred<CharacterSyncJobResponse>();
    let subscriptions = 0;
    const api = {
      subscribeHofStatus: () => () => undefined,
      async startCharacterSyncJob() { return syncJob(); },
      resumeCharacterSyncJob: () => resumed.promise,
      subscribeCharacterSyncJob() {
        subscriptions += 1;
        return { close: () => undefined };
      },
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({
        api,
        describeError: String,
        observations: noOpObservations,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { await sync.startCharacterFullSync(); });

    let pending!: Promise<void>;
    await act(async () => {
      pending = sync.resumeCharacterSync();
      sync.resetCharacterSync();
    });
    await act(async () => {
      resumed.resolve(syncJob());
      await pending;
    });

    assert.equal(sync.characterSyncJob, null);
    assert.equal(sync.characterSyncLabel, null);
    assert.equal(subscriptions, 1);
    await act(async () => { renderer.unmount(); });
  });

  it('does not restore an old sync job when error recovery completes after reset', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    let handlers: CharacterSyncEventHandlers | null = null;
    const recovered = deferred<CharacterSyncJobResponse>();
    let subscriptions = 0;
    const api = {
      subscribeHofStatus: () => () => undefined,
      async startCharacterSyncJob() { return syncJob(); },
      fetchCharacterSyncJob: () => recovered.promise,
      subscribeCharacterSyncJob(_jobId: number, nextHandlers: CharacterSyncEventHandlers) {
        subscriptions += 1;
        handlers = nextHandlers;
        return { close: () => undefined };
      },
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({
        api,
        describeError: String,
        observations: noOpObservations,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { await sync.startCharacterFullSync(); });

    await act(async () => {
      requireHandlers(handlers).onError?.(new Error('connection lost'));
      sync.resetCharacterSync();
    });
    await act(async () => {
      recovered.resolve(syncJob());
      await Promise.resolve();
    });

    assert.equal(sync.characterSyncJob, null);
    assert.equal(sync.characterSyncLabel, null);
    assert.equal(subscriptions, 1);
    await act(async () => { renderer.unmount(); });
  });

  it('starts one full detail sync while the start request is in flight', async () => {
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
      sync = useCharacterSync({
        api,
        describeError: String,
        observations: noOpObservations,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = sync.startCharacterFullSync();
      second = sync.startCharacterFullSync();
      await Promise.resolve();
    });
    assert.equal(startCalls, 1);
    assert.equal(sync.characterSyncLabel, '전체 상세 동기화 준비 중');

    await act(async () => {
      started.resolve(syncJob());
      await Promise.all([first, second]);
    });
    assert.equal(sync.characterSyncJob?.jobId, 17);
    await act(async () => { renderer.unmount(); });
  });

  it('실행 실패를 동기화 상태에 보존하고 재설정할 때 지운다', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
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
        observations: noOpObservations,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    await act(async () => { await sync.startCharacterFullSync(); });

    assert.equal(sync.characterSyncLabel, null);
    assert.equal(sync.characterSyncError, 'start failed');
    await act(async () => { sync.resetCharacterSync(); });
    assert.equal(sync.characterSyncError, null);
    await act(async () => { renderer.unmount(); });
  });
});

it('과거 전체 상세 작업을 다시 조회해도 새 목록 동기화 실패를 지우지 않는다', async () => {
  let sync!: ReturnType<typeof useCharacterSync>;
  const observations = recordingObservations();
  const api = {
    subscribeHofStatus: () => () => undefined,
    startCharacterSyncJob: async () => syncJob(),
    subscribeCharacterSyncJob: () => ({ close: () => undefined }),
    fetchCharacterSyncJob: async () => ({ ...syncJob(), status: 'completed' }),
    syncCharacterRoster: async () => { throw new Error('목록 조회 실패'); },
  } as unknown as BackendApiClient;
  const Harness = () => { sync = useCharacterSync({ api, describeError: String, observations: observations.sink }); return null; };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Harness)); });
  await act(async () => { await sync.startCharacterFullSync(); });
  await act(async () => { await sync.checkCharacterSync(); });
  await act(async () => { await sync.syncCharacterRoster(); });
  await act(async () => { await sync.checkCharacterSync(); });
  assert.equal(sync.characterRosterError, 'Error: 목록 조회 실패');
  assert.equal(sync.characterSyncJob?.status, 'completed');
  await act(async () => { renderer.unmount(); });
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

function syncEvent(character: HofCharacter): CharacterSyncEventResponse {
  return {
    eventId: 1,
    eventType: 'characterSynced',
    jobId: 17,
    accountId: 1,
    status: 'running',
    rosterCount: 1,
    syncedCount: 1,
    failedCharacterIds: [],
    character,
    message: null,
    emittedAt: '2026-08-18T07:00:01Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function requireHandlers(
  handlers: CharacterSyncEventHandlers | null,
): CharacterSyncEventHandlers {
  if (!handlers) throw new Error('character sync subscription was not opened');
  return handlers;
}

const noOpObservations: CharacterManagementObservationSink = {
  beginRosterObservation: () => () => true,
  observeCharacter: () => true,
};

function recordingObservations() {
  const rosters: HofCharacter[][] = [];
  const characters: HofCharacter[] = [];
  const sink: CharacterManagementObservationSink = {
    beginRosterObservation: () => (roster) => {
      rosters.push(roster);
      return true;
    },
    observeCharacter: (character) => {
      characters.push(character);
      return true;
    },
  };
  return { sink, rosters, characters };
}
