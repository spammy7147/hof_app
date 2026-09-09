import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, it } from 'node:test';
import type { CharacterManagementObservationSink } from '../../../main/domain/characterManagementHubModule';
import type { CharacterSyncJobResponse, HofStatusResponse } from '../../../main/types/api';

type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const originalLoad = loader._load;
loader._load = (request, parent, isMain) => request === 'react-native'
  ? { Platform: { OS: 'web' }, StyleSheet: { flatten: (style: unknown) => style } }
  : originalLoad(request, parent, isMain);
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { BackendApiClient } = require('../../../main/services/backendApi') as typeof import('../../../main/services/backendApi');
const { useCharacterSync } = require('../../../main/features/characters/useCharacterSync') as typeof import('../../../main/features/characters/useCharacterSync');
const { useAuthenticatedBootstrap } = require('../../../main/features/auth/useAuthenticatedBootstrap') as typeof import('../../../main/features/auth/useAuthenticatedBootstrap');
loader._load = originalLoad;
const originalFetch = globalThis.fetch;
const clients: InstanceType<typeof BackendApiClient>[] = [];
const observations: CharacterManagementObservationSink = {
  beginRosterObservation: () => () => true,
  observeCharacter: () => true,
};
const completeRoster: HofStatusResponse = {
  accountId: 1, playerName: '테스트 계정', funds: 100, timeCurrent: 6000, timeMax: 6000,
  work: 'Nothing', auction: 'item/funds', totalCharacterCount: 1, synchronizedCharacterCount: 1,
  characterSyncRequired: false, observedAt: '2026-09-09T00:00:00Z',
};
const job: CharacterSyncJobResponse = {
  jobId: 17, accountId: 1, status: 'pending', rosterCount: 0, syncedCount: 0,
  failedCharacterIds: [], characters: [], message: null, startedAt: '2026-09-09T00:00:00Z',
  finishedAt: null, stopRequested: false, lastCompletedRosterIndex: -1, currentHofCharacterId: null,
};
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
function useBootstrap(api: InstanceType<typeof BackendApiClient>) {
  const sync = useCharacterSync({ api, describeError: String, observations });
  return useAuthenticatedBootstrap({
    generation: 1, loadStatus: () => api.fetchStatus(), loadCharacters: async () => undefined,
    startAutomaticSyncIfRequired: sync.startAutomaticSyncIfRequired, describeError: String,
  });
}
function client() {
  const api = new BackendApiClient('http://backend.test', { load: async () => null, save: async () => undefined, remove: async () => undefined });
  clients.push(api);
  return api;
}
afterEach(async () => {
  await rntl.cleanup();
  for (const api of clients.splice(0)) api.dispose();
  globalThis.fetch = originalFetch;
});

for (const required of [false, true]) {
  it(`상태 응답의 동기화 필요=${required}를 실제 bootstrap과 sync job 요청까지 전달한다`, async () => {
    const posts: string[] = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/status') return response({ ...completeRoster, totalCharacterCount: required ? 2 : 1, characterSyncRequired: required });
      if (path === '/api/characters/sync-jobs' && init?.method === 'POST') { posts.push(path); return response(job); }
      if (path.endsWith('/events')) return new Response(new ReadableStream({
        start(controller) { init?.signal?.addEventListener('abort', () => controller.close(), { once: true }); },
      }), { headers: { 'content-type': 'text/event-stream' } });
      throw new Error(`Unexpected request: ${path}`);
    };
    const api = client();
    const hook = await rntl.renderHook(() => useBootstrap(api));
    assert.equal(hook.result.current.status.kind, 'ready');
    assert.equal(posts.length, required ? 1 : 0);
    await hook.rerender(undefined);
    assert.equal(posts.length, required ? 1 : 0);
  });
}

it('명단 확인 실패는 빈 목록 완료로 처리하지 않고 상태 재조회 뒤 판정한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reads = 0;
  globalThis.fetch = async (url) => {
    assert.equal(new URL(String(url)).pathname, '/api/status');
    return ++reads === 1 ? response({ code: 'HOF_REQUEST_FAILED', message: '명단 확인 실패' }, 502) : response(completeRoster);
  };
  const api = client();
  const hook = await rntl.renderHook(() => useBootstrap(api));
  assert.equal(hook.result.current.status.kind, 'error');
  assert.equal(hook.result.current.characters.kind, 'ready');
  await rntl.act(() => { t.mock.timers.tick(10_000); });
  assert.equal(reads, 2);
  assert.equal(hook.result.current.status.kind, 'ready');
});
