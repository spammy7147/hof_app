import assert from 'node:assert/strict';
import Module from 'node:module';
import { after, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useCharacterSync } from '../../../main/features/characters/useCharacterSync';
import { createSseConnection as createWebConnection } from '../../../main/services/sseClient.web';
import { createSseConnection as createNativeConnection } from '../../../main/services/sseClient.native';
import type { CharacterSyncJobResponse } from '../../../main/types/api';
import { makeCharacterSyncEvent } from '../../fixtures/api';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader = Module as typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = loader._load;
let platform = 'web';
let connect = createWebConnection;
// Node에서 Metro의 플랫폼 선택만 대신한다. client·hook·SSE 파싱과 재연결은 실제 구현이다.
loader._load = function (request, parent, isMain) {
  if (request === 'react-native') return { Platform: { get OS() { return platform; } } };
  if (request === './sseClient') return {
    createSseConnection: (...args: Parameters<typeof createWebConnection>) => connect(...args),
  };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => { loader._load = originalLoad; });

for (const adapter of ['web', 'native'] as const) {
  it(`${adapter} 실제 구독의 stopped는 마지막 조회가 실패해도 중지를 반영하고 재접속하지 않는다`, async (t) => {
    platform = adapter === 'web' ? 'web' : 'android';
    connect = adapter === 'web' ? createWebConnection : createNativeConnection;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { BackendApiClient } = await import('../../../main/services/backendApi');
    const client = new BackendApiClient('https://fixture.invalid');
    t.after(() => client.dispose());
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
    const originalXhr = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
    Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: FixtureXhr });
    t.after(() => {
      if (originalXhr) Object.defineProperty(globalThis, 'XMLHttpRequest', originalXhr);
      else Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
    });
    let webStreams = 0;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let finalSnapshots = 0;
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/events')) {
        webStreams += 1;
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
      }
      if (url.endsWith('/api/characters/sync-jobs') && init?.method === 'POST') {
        return Response.json(runningJob());
      }
      assert.equal(url, 'https://fixture.invalid/api/characters/sync-jobs/17');
      finalSnapshots += 1;
      throw new Error('마지막 snapshot 통신 실패');
    });
    let sync!: ReturnType<typeof useCharacterSync>;
    const Harness = () => {
      sync = useCharacterSync({
        api: client,
        describeError: String,
        observations: { beginRosterObservation: () => () => true, observeCharacter: () => true },
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    t.after(async () => { await act(async () => { renderer.unmount(); }); });
    await act(async () => { await sync.startCharacterFullSync(); });
    assert.equal(sync.characterSyncJob?.status, 'running');
    await act(async () => { t.mock.timers.tick(500); });
    const event = makeCharacterSyncEvent({ eventType: 'stopped', status: 'stopped', jobId: 17, syncedCount: 3 });
    const block = `event: stopped\ndata: ${JSON.stringify(event)}\n\n`;
    await act(async () => {
      if (adapter === 'web') {
        stream.enqueue(new TextEncoder().encode(block));
        stream.close();
      } else {
        const request = requests[0]!;
        request.readyState = FixtureXhr.DONE;
        request.status = 200;
        request.responseText = block;
        request.onreadystatechange?.();
      }
    });
    assert.equal(sync.characterSyncJob?.status, 'stopped');
    assert.equal(sync.characterSyncJob?.syncedCount, 3);
    assert.equal(sync.characterSyncLabel, null);
    assert.match(sync.characterSyncError ?? '', /마지막 snapshot 통신 실패/);
    assert.equal(finalSnapshots, 1);
    if (adapter === 'native') assert.equal(requests[0]!.aborted, true);
    await act(async () => { t.mock.timers.tick(60000); });
    assert.equal(adapter === 'web' ? webStreams : requests.length, 1);
    assert.equal(finalSnapshots, 1, 'terminal 뒤 snapshot 복구 재시도를 예약하지 않는다');
  });
}

function runningJob(): CharacterSyncJobResponse {
  return {
    jobId: 17, accountId: 1, status: 'running', rosterCount: 4, syncedCount: 2,
    failedCharacterIds: [], characters: [], message: null,
    startedAt: '2026-09-10T00:00:00Z', finishedAt: null, stopRequested: true,
    lastCompletedRosterIndex: 1, currentHofCharacterId: null,
  };
}
