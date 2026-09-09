import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { createSseConnection } from '../../../main/services/sseClient.web';
import { createSseConnection as createNativeSseConnection } from '../../../main/services/sseClient.native';
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


for (const closeKind of ['EOF', 'ERROR_AND_CLOSE', 'WEB_STREAM_EOF'] as const) {
  it(`${closeKind} 이후 snapshot을 확인하고 하나의 연결만 다시 연다`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let sync!: ReturnType<typeof useCharacterSync>;
    let handlers!: CharacterSyncEventHandlers;
    let snapshots = 0;
    let connections = 0;
    let finishStream!: () => void;
    if (closeKind === 'WEB_STREAM_EOF') {
      t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
        start(controller) { finishStream = () => controller.close(); },
      })));
    }
    const api = {
      subscribeHofStatus: () => () => undefined,
      startCharacterSyncJob: async () => syncJob(),
      fetchCharacterSyncJob: async () => { snapshots += 1; return syncJob(); },
      subscribeCharacterSyncJob(jobId: number, next: CharacterSyncEventHandlers) {
        assert.equal(jobId, 17);
        connections += 1;
        handlers = next;
        if (closeKind === 'WEB_STREAM_EOF') return createSseConnection('https://fixture.invalid/events', {
          eventTypes: [], onMessage: () => undefined, onClose: next.onClose, onError: next.onError,
        });
        return { close: () => next.onClose?.() };
      },
    } as unknown as BackendApiClient;
    const Harness = () => { sync = useCharacterSync({ api, describeError: String, observations: noOpObservations }); return null; };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    t.after(async () => { await act(async () => { renderer.unmount(); }); });
    await act(async () => { await sync.startCharacterFullSync(); });
    await act(async () => {
      if (closeKind === 'WEB_STREAM_EOF') finishStream();
      else {
        if (closeKind === 'ERROR_AND_CLOSE') handlers.onError?.(new Error('network'));
        handlers.onClose?.();
      }
    });
    assert.equal(snapshots, 1);
    assert.equal(connections, 1);
    await act(async () => { t.mock.timers.tick(1200); });
    assert.equal(connections, 2);
    assert.equal(snapshots, 1);
  });
}

it('snapshot 실패의 backoff를 소비해 복구하고 reset 뒤에는 다시 연결하지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let sync!: ReturnType<typeof useCharacterSync>;
  let handlers!: CharacterSyncEventHandlers;
  let snapshots = 0;
  let connections = 0;
  const api = {
    subscribeHofStatus: () => () => undefined,
    startCharacterSyncJob: async () => syncJob(),
    fetchCharacterSyncJob: async () => { if (++snapshots <= 2) throw new Error('일시 장애'); return syncJob(); },
    subscribeCharacterSyncJob(_id: number, next: CharacterSyncEventHandlers) {
      connections += 1; handlers = next; return { close: () => next.onClose?.() };
    },
  } as unknown as BackendApiClient;
  const Harness = () => { sync = useCharacterSync({ api, describeError: String, observations: noOpObservations }); return null; };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Harness)); });
  t.after(async () => { await act(async () => { renderer.unmount(); }); });
  await act(async () => { await sync.startCharacterFullSync(); });
  await act(async () => { handlers.onError?.(new Error('network')); });
  assert.equal(snapshots, 1);
  await act(async () => { t.mock.timers.tick(1200); });
  assert.equal(snapshots, 2);
  await act(async () => { t.mock.timers.tick(2399); });
  assert.equal(snapshots, 2);
  await act(async () => { t.mock.timers.tick(1); });
  assert.equal(snapshots, 3);
  await act(async () => { t.mock.timers.tick(1200); });
  assert.equal(connections, 2);
  assert.equal(sync.characterSyncError, null);
  await act(async () => { handlers.onClose?.(); sync.resetCharacterSync(); });
  await act(async () => { t.mock.timers.tick(60000); });
  assert.equal(connections, 2);
  assert.equal(sync.characterSyncJob, null);
});


for (const ending of ['TERMINAL_EVENT', 'TERMINAL_SNAPSHOT', 'RESET', 'UNMOUNT'] as const) {
  it(`${ending} 이후 늦은 종료·snapshot은 연결을 다시 열지 않는다`, async (t) => {
    const pending = deferred<CharacterSyncJobResponse>();
    const harness = await reconnectHarness(t, () => pending.promise);
    await act(async () => {
      if (ending === 'TERMINAL_EVENT') {
        harness.handlers[0]!.onEvent({ ...syncEvent(makeHofCharacter()), eventType: 'completed', status: 'completed' });
      } else harness.handlers[0]!.onClose?.();
      if (ending === 'RESET') harness.sync.resetCharacterSync();
    });
    if (ending === 'UNMOUNT') await harness.unmount();
    await act(async () => {
      pending.resolve({ ...syncJob(), status: ending === 'RESET' || ending === 'UNMOUNT' ? 'running' : 'completed' });
    });
    await act(async () => { harness.handlers[0]!.onClose?.(); t.mock.timers.tick(60000); });
    assert.equal(harness.handlers.length, 1);
    assert.equal(harness.fetches, 1);
    if (ending === 'RESET') assert.equal(harness.sync.characterSyncJob, null);
    if (ending === 'TERMINAL_EVENT' || ending === 'TERMINAL_SNAPSHOT') {
      assert.equal(harness.sync.characterSyncJob?.status, 'completed');
      assert.equal(harness.sync.characterSyncLabel, null);
    }
  });
}

it('이전 연결의 늦은 복구 snapshot은 새 연결 상태를 되돌리지 않는다', async (t) => {
  const old = deferred<CharacterSyncJobResponse>();
  let fetches = 0;
  const harness = await reconnectHarness(t, () => ++fetches === 1 ? old.promise : Promise.resolve(syncJob()));
  await act(async () => { harness.handlers[0]!.onClose?.(); });
  await act(async () => { await harness.sync.checkCharacterSync(); });
  assert.equal(harness.handlers.length, 2);
  await act(async () => { old.resolve({ ...syncJob(), status: 'completed' }); });
  assert.equal(harness.sync.characterSyncJob?.status, 'pending');
  await act(async () => { t.mock.timers.tick(60000); });
  assert.equal(harness.handlers.length, 2);
});

it('복구 backoff는 30초를 넘지 않고 중지 snapshot 뒤에는 예약을 취소한다', async (t) => {
  let failed = true;
  const harness = await reconnectHarness(t, async () => {
    if (failed) throw new Error('offline');
    return { ...syncJob(), status: 'stopped' };
  });
  await act(async () => { harness.handlers[0]!.onError?.(new Error('offline')); });
  let expected = 1;
  for (const delay of [1200, 2400, 4800, 9600, 19200, 30000, 30000]) {
    await act(async () => { t.mock.timers.tick(delay - 1); });
    assert.equal(harness.fetches, expected);
    await act(async () => { t.mock.timers.tick(1); });
    assert.equal(harness.fetches, ++expected);
  }
  failed = false;
  await act(async () => { await harness.sync.checkCharacterSync(); });
  assert.equal(harness.sync.characterSyncJob?.status, 'stopped');
  await act(async () => { t.mock.timers.tick(60000); });
  assert.equal(harness.fetches, expected + 1);
  assert.equal(harness.handlers.length, 1);
});

it('다른 job의 복구 snapshot으로 연결하지 않는다', async (t) => {
  const harness = await reconnectHarness(t, async () => ({ ...syncJob(), jobId: 18 }));
  await act(async () => { harness.handlers[0]!.onClose?.(); });
  await act(async () => { t.mock.timers.tick(60000); });
  assert.equal(harness.handlers.length, 1);
  assert.equal(harness.sync.characterSyncJob?.jobId, 17);
});

async function reconnectHarness(t: TestContext, fetchJob: () => Promise<CharacterSyncJobResponse>) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const handlers: CharacterSyncEventHandlers[] = [];
  let sync!: ReturnType<typeof useCharacterSync>;
  let fetches = 0;
  const api = {
    subscribeHofStatus: () => () => undefined,
    startCharacterSyncJob: async () => syncJob(),
    resumeCharacterSyncJob: async () => ({ ...syncJob(), status: 'running' }),
    fetchCharacterSyncJob: () => { fetches += 1; return fetchJob(); },
    subscribeCharacterSyncJob(jobId: number, next: CharacterSyncEventHandlers) {
      assert.equal(jobId, 17); handlers.push(next); return { close: () => next.onClose?.() };
    },
  } as unknown as BackendApiClient;
  const Harness = () => { sync = useCharacterSync({ api, describeError: String, observations: noOpObservations }); return null; };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Harness)); });
  let mounted = true;
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => { renderer.unmount(); }); } };
  t.after(unmount);
  await act(async () => { await sync.startCharacterFullSync(); });
  return { handlers, get sync() { return sync; }, get fetches() { return fetches; }, unmount };
}


it('실제 native SSE adapter가 오류 후 닫힌 연결을 자체 polling으로 되살리지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests: FixtureXhr[] = [];
  class FixtureXhr {
    static DONE = 4;
    static LOADING = 3;
    readyState = 0;
    status = 0;
    responseText = '';
    onreadystatechange: (() => void) | null = null;
    aborted = false;
    constructor() { requests.push(this); }
    open() {}
    setRequestHeader() {}
    send() {}
    abort() { this.aborted = true; }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
  Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: FixtureXhr });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'XMLHttpRequest', original);
    else Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
  });
  let sync!: ReturnType<typeof useCharacterSync>;
  let connections = 0;
  const api = {
    subscribeHofStatus: () => () => undefined,
    startCharacterSyncJob: async () => syncJob(),
    fetchCharacterSyncJob: async () => syncJob(),
    subscribeCharacterSyncJob(_id: number, next: CharacterSyncEventHandlers) {
      connections += 1;
      return createNativeSseConnection('https://fixture.invalid/events', {
        eventTypes: [], onMessage: () => undefined, onClose: next.onClose, onError: next.onError,
      });
    },
  } as unknown as BackendApiClient;
  const Harness = () => { sync = useCharacterSync({ api, describeError: String, observations: noOpObservations }); return null; };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Harness)); });
  t.after(async () => { await act(async () => { renderer.unmount(); }); });
  await act(async () => { await sync.startCharacterFullSync(); t.mock.timers.tick(500); });
  await act(async () => {
    const first = requests[0]!;
    first.readyState = FixtureXhr.DONE; first.status = 503; first.onreadystatechange?.();
  });
  await act(async () => { t.mock.timers.tick(1200); });
  await act(async () => { t.mock.timers.tick(500); });
  assert.equal(connections, 2);
  assert.equal(requests[0]!.aborted, true);
  await act(async () => { t.mock.timers.tick(5000); });
  assert.equal(requests.length, 2, '닫힌 EventSource의 자체 재시도 요청이 남으면 안 된다');
});


it('종료 event의 늦은 마지막 snapshot은 같은 job의 재개 연결을 닫지 않는다', async (t) => {
  const stopped = deferred<CharacterSyncJobResponse>();
  const harness = await reconnectHarness(t, () => stopped.promise);
  await act(async () => {
    harness.handlers[0]!.onEvent({ ...syncEvent(makeHofCharacter()), eventType: 'stopped', status: 'stopped' });
  });
  await act(async () => { await harness.sync.resumeCharacterSync(); });
  assert.equal(harness.handlers.length, 2);
  assert.equal(harness.sync.characterSyncJob?.status, 'running');
  await act(async () => { stopped.resolve({ ...syncJob(), status: 'stopped' }); });
  assert.equal(harness.sync.characterSyncJob?.status, 'running');
  await act(async () => {
    harness.handlers[1]!.onEvent({ ...syncEvent(makeHofCharacter()), syncedCount: 7 });
  });
  assert.equal(harness.sync.characterSyncJob?.syncedCount, 7);
});
