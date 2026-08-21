import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useCharacterSync } from '../../../main/features/characters/useCharacterSync';
import type { BackendApiClient, CharacterSyncEventHandlers } from '../../../main/services/backendApi';
import type { CharacterSyncEventResponse, CharacterSyncJobResponse, HofCharacter, HofObservedStatusResponse } from '../../../main/types/api';
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

  it('synchronizes only the roster without starting a full detail job', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    let rosterSyncCalls = 0;
    let fullSyncCalls = 0;
    const roster = deferred<HofCharacter[]>();
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
      sync = useCharacterSync({ api, describeError: String, onNotice: () => undefined });
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
    assert.equal(sync.characters[0]?.name, '목록 전용');
    assert.equal(sync.characterSyncLabel, null);
    await act(async () => { renderer.unmount(); });
  });

  it('does not let an in-flight roster load overwrite a lifecycle mutation', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    const staleLoad = deferred<HofCharacter[]>();
    const api = {
      subscribeHofStatus: () => () => undefined,
      listCharacters: () => staleLoad.promise,
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({ api, describeError: String, onNotice: () => undefined });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    let pending!: Promise<void>;
    await act(async () => {
      pending = sync.loadSavedCharacters();
      await Promise.resolve();
    });
    const afterMutation = [makeHofCharacter(1, { lifecycle: 'ARCHIVED' })];
    await act(async () => { sync.replaceCharacters(afterMutation); });

    await act(async () => {
      staleLoad.resolve([makeHofCharacter(1)]);
      await pending;
    });

    assert.equal(sync.characters, afterMutation);
    await act(async () => { renderer.unmount(); });
  });

  it('does not let a roster load started before a detail projection regress it', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    const staleLoad = deferred<HofCharacter[]>();
    const api = {
      subscribeHofStatus: () => () => undefined,
      listCharacters: () => staleLoad.promise,
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({ api, describeError: String, onNotice: () => undefined });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    let pending!: Promise<void>;
    await act(async () => {
      pending = sync.loadSavedCharacters();
      await Promise.resolve();
    });
    const detailProjection = makeHofCharacter(1, {
      name: '최신 상세',
      revision: '2026-08-18T07:00:02Z',
      detailSyncedAt: '2026-08-18T07:00:02Z',
    });
    await act(async () => { sync.upsertCharacter(detailProjection); });
    await act(async () => {
      staleLoad.resolve([makeHofCharacter(1, { name: '오래된 목록' })]);
      await pending;
    });

    assert.equal(sync.characters[0], detailProjection);
    await act(async () => { renderer.unmount(); });
  });

  it('drops a retained pre-mutation SSE callback and accepts the rebound subscription', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    let handlers: CharacterSyncEventHandlers | null = null;
    let subscriptions = 0;
    const api = {
      subscribeHofStatus: () => () => undefined,
      async startCharacterSyncJob() { return syncJob(); },
      subscribeCharacterSyncJob(_jobId: number, nextHandlers: CharacterSyncEventHandlers) {
        subscriptions += 1;
        handlers = nextHandlers;
        return { close: () => undefined };
      },
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({ api, describeError: String, onNotice: () => undefined });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { await sync.startCharacterFullSync(); });
    const olderHandlers = requireHandlers(handlers);

    const afterMutation = [makeHofCharacter(1, { lifecycle: 'ARCHIVED' })];
    await act(async () => { sync.replaceCharacters(afterMutation); });
    await act(async () => {
      olderHandlers?.onEvent(syncEvent(makeHofCharacter(1)));
    });

    assert.equal(sync.characters, afterMutation);
    assert.equal(subscriptions, 2);
    await act(async () => {
      requireHandlers(handlers).onEvent(
        syncEvent(makeHofCharacter(2, { name: '재연결 반영' })),
      );
    });
    assert.equal(sync.characters[1]?.name, '재연결 반영');
    await act(async () => { renderer.unmount(); });
  });

  it('keeps the current full-sync subscription when a detail projection is upserted', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    let handlers: CharacterSyncEventHandlers | null = null;
    let subscriptions = 0;
    const api = {
      subscribeHofStatus: () => () => undefined,
      async startCharacterSyncJob() { return syncJob(); },
      subscribeCharacterSyncJob(_jobId: number, nextHandlers: CharacterSyncEventHandlers) {
        subscriptions += 1;
        handlers = nextHandlers;
        return { close: () => undefined };
      },
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({ api, describeError: String, onNotice: () => undefined });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { await sync.startCharacterFullSync(); });
    const currentHandlers = requireHandlers(handlers);

    const detailProjection = makeHofCharacter(1, {
      name: '상세 투영',
      revision: '2026-08-18T07:00:02Z',
      detailSyncedAt: '2026-08-18T07:00:02Z',
    });
    await act(async () => {
      sync.upsertCharacter(detailProjection);
      currentHandlers.onEvent(syncEvent(makeHofCharacter(1, {
        name: '오래된 동기화',
        revision: '2026-08-18T07:00:01Z',
        detailSyncedAt: '2026-08-18T07:00:01Z',
      })));
      currentHandlers.onEvent(syncEvent(makeHofCharacter(2, { name: '동기화 반영' })));
    });

    assert.equal(subscriptions, 1);
    assert.equal(sync.characters[0], detailProjection);
    assert.equal(sync.characters[1]?.name, '동기화 반영');
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
      sync = useCharacterSync({ api, describeError: String, onNotice: () => undefined });
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
    assert.deepEqual(sync.characters, []);
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
      sync = useCharacterSync({ api, describeError: String, onNotice: () => undefined });
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
    assert.deepEqual(sync.characters, []);
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
      sync = useCharacterSync({ api, describeError: String, onNotice: () => undefined });
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

    await act(async () => { await sync.startCharacterFullSync(); });

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
