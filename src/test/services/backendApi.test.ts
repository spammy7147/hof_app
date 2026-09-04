import assert from 'node:assert/strict';
import Module from 'node:module';
import { after, afterEach, describe, it } from 'node:test';

import type { CharacterDeepSyncResponse, PartyPresetResponse } from '../../main/types/api';
import { makeCaptchaChallenge, makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';

const partyPresetFolderIdIsRequired: (
  {} extends Pick<PartyPresetResponse, 'folderId'> ? false : true
) = true;

type BackendApiModule = typeof import('../../main/services/backendApi');

const moduleLoader = Module as typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleLoader._load;
let platformOS = 'ios';
moduleLoader._load = function loadWithReactNativeStub(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === 'react-native') {
    return { Platform: { get OS() { return platformOS; } } };
  }

  return originalModuleLoad.call(this, request, parent, isMain);
};

let backendApiModule: Promise<BackendApiModule> | null = null;

after(() => {
  moduleLoader._load = originalModuleLoad;
});

describe('BackendApiClient', () => {
  const originalFetch = globalThis.fetch;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const extensionGlobal = globalThis as typeof globalThis & { chrome?: unknown };
  const originalChrome = extensionGlobal.chrome;

  afterEach(() => {
    platformOS = 'ios';
    globalThis.fetch = originalFetch;
    globalThis.BroadcastChannel = originalBroadcastChannel;
    extensionGlobal.chrome = originalChrome;
  });

  it('rejects a plaintext backend URL in a production build', async () => {
    const { normalizeBackendBaseUrl } = await loadBackendApi();

    assert.throws(
      () => normalizeBackendBaseUrl('http://api.example.com/', true),
      /HTTPS/,
    );
    assert.equal(normalizeBackendBaseUrl('https://api.example.com/', true), 'https://api.example.com');
    assert.equal(normalizeBackendBaseUrl('http://10.0.2.2:8080/', false), 'http://10.0.2.2:8080');
  });

  it('uses the public HOF API as the production default', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalConfiguredUrl = process.env.EXPO_PUBLIC_HOF_BACKEND_URL;
    process.env.NODE_ENV = 'production';
    delete process.env.EXPO_PUBLIC_HOF_BACKEND_URL;

    try {
      const { BackendApiClient } = await loadBackendApi();
      const client = new BackendApiClient(undefined, memoryTokenStorage());

      assert.equal(client.baseUrl, 'https://api-hof.spammy.app');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalConfiguredUrl === undefined) {
        delete process.env.EXPO_PUBLIC_HOF_BACKEND_URL;
      } else {
        process.env.EXPO_PUBLIC_HOF_BACKEND_URL = originalConfiguredUrl;
      }
    }
  });

  it('checks the public Android release before login and normalizes its download URL', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push({ url: String(url), init });
      return mockResponse({
        updateAvailable: true,
        release: {
          versionCode: 47,
          versionName: '1.0.0+47',
          fileSize: 1024,
          sha256: 'a'.repeat(64),
          gitRevision: 'b'.repeat(40),
          jenkinsBuild: 47,
          publishedAt: '2026-08-03T00:00:00Z',
          downloadUrl: '/api/app-releases/android/47/download',
        },
      });
    }) as unknown as typeof fetch;

    const release = await new BackendApiClient('https://backend.test').fetchLatestAndroidRelease(46);

    assert.equal(requests[0]?.url, 'https://backend.test/api/app-releases/android/latest?currentVersionCode=46');
    assert.equal(readHeader(requests[0]?.init.headers, 'Authorization'), null);
    assert.equal(release.release.downloadUrl, 'https://backend.test/api/app-releases/android/47/download');
  });

  it('stores only the native refresh token and sends the access token as Bearer authorization', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const storage = memoryTokenStorage();
    const requests: CapturedRequest[] = [];
    const responses = [
      tokenResponse('access-1', 'refresh-1'),
      {
        accountId: 1,
        playerName: '공민이',
        funds: 100,
        timeCurrent: 100,
        timeMax: 100,
        work: 'Nothing',
        auction: 'Nothing',
        observedAt: '2026-07-13T00:00:00Z',
      },
    ];
    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push({ url: String(url), init });
      return mockResponse(responses.shift());
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test', storage);

    await client.login({ loginId: 'hof-id', password: 'hof-password' });
    await client.fetchStatus();

    assert.equal(storage.value, 'refresh-1');
    assert.equal(requests[0]?.url, 'http://backend.test/api/auth/login');
    assert.equal(requests[0]?.init.body, '{"loginId":"hof-id","password":"hof-password","clientType":"NATIVE"}');
    assert.equal(readHeader(requests[1]?.init.headers, 'Authorization'), 'Bearer access-1');
  });

  it('uses the refresh-token body flow inside a Chrome extension web page', async () => {
    const { BackendApiClient } = await loadBackendApi();
    platformOS = 'web';
    extensionGlobal.chrome = { runtime: { id: 'extension-id' } };
    const storage = memoryTokenStorage();
    let loginBody: string | null = null;
    globalThis.fetch = (async (_url: RequestInfo | URL, init: RequestInit = {}) => {
      loginBody = String(init.body);
      return mockResponse(tokenResponse('access-1', 'refresh-1'));
    }) as unknown as typeof fetch;

    const client = new BackendApiClient('https://backend.test', storage);
    await client.login({
      loginId: 'hof-id',
      password: 'hof-password',
    });
    client.dispose();

    assert.equal(loginBody, '{"loginId":"hof-id","password":"hof-password","clientType":"NATIVE"}');
    assert.equal(storage.value, 'refresh-1');
  });

  it('publishes the latest HOF status carried by a backend response header', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const observed = {
      playerName: '《얼어붙은 손길》공민이',
      funds: 844_370_206,
      timeCurrent: 223,
      timeMax: 6000,
      work: 'Nothing',
      auction: 'Nothing',
      observedAt: '2026-08-17T00:00:00Z',
      characterRosterObservedAt: '2026-08-17T00:00:01Z',
    };
    globalThis.fetch = (async () => mockResponse(
      { folders: [], presets: [] },
      200,
      { 'X-HOF-Observed-Status': encodeURIComponent(JSON.stringify(observed)) },
    )) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test');
    const received: unknown[] = [];
    client.subscribeHofStatus((status) => received.push(status));

    await client.getPartyPresetCatalog();

    assert.deepEqual(received, [observed]);
  });

  it('ignores a malformed HOF status response header', async () => {
    const { BackendApiClient } = await loadBackendApi();
    globalThis.fetch = (async () => mockResponse(
      { folders: [], presets: [] },
      200,
      { 'X-HOF-Observed-Status': '%not-json' },
    )) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test');
    const received: unknown[] = [];
    client.subscribeHofStatus((status) => received.push(status));

    await client.getPartyPresetCatalog();

    assert.deepEqual(received, []);
  });

  it('uses one refresh request for concurrent 401 responses and retries each request once', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const storage = memoryTokenStorage('refresh-old');
    const bothInitialRequestsCompleted = deferred<void>();
    const refreshResponse = deferred<Response>();
    let refreshCalls = 0;
    const authorizationHeaders: Array<string | null> = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        return refreshResponse.promise;
      }
      const authorization = readHeader(init.headers, 'Authorization');
      authorizationHeaders.push(authorization);
      if (authorizationHeaders.length === 2) bothInitialRequestsCompleted.resolve();
      return authorization === 'Bearer access-new'
        ? mockResponse({ accountId: 1, playerName: '공민이' })
        : mockResponse({ code: 'AUTH_TOKEN_INVALID', message: '로그인이 필요합니다.' }, 401);
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test', storage);
    const sessionEvents: unknown[] = [];
    client.subscribeSessionRefreshEvents((event) => sessionEvents.push(event));

    const statuses = Promise.all([client.fetchStatus(), client.fetchStatus()]);
    await bothInitialRequestsCompleted.promise;
    refreshResponse.resolve(mockResponse(tokenResponse('access-new', 'refresh-new')));
    await statuses;

    assert.equal(refreshCalls, 1);
    assert.equal(storage.value, 'refresh-new');
    assert.deepEqual(authorizationHeaders, [null, null, 'Bearer access-new', 'Bearer access-new']);
    assert.deepEqual(sessionEvents, [{ type: 'refresh-succeeded' }]);
  });

  it('blocks authenticated mutations while session recovery is waiting', async () => {
    const { BackendApiClient, SessionRecoveryMutationBlockedError } = await loadBackendApi();
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return mockResponse({ entries: [] });
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test');
    client.setSessionMutationsBlocked(true);

    await assert.rejects(
      client.changeUnifiedAutomationState('pause'),
      SessionRecoveryMutationBlockedError,
    );

    assert.equal(fetchCalls, 0);
    await client.fetchUnifiedAutomation();
    assert.equal(fetchCalls, 1);
  });

  it('recovers a web refresh grace conflict from the token broadcast by another tab', async () => {
    const { BackendApiClient } = await loadBackendApi();
    platformOS = 'web';
    globalThis.BroadcastChannel = FakeBroadcastChannel as unknown as typeof BroadcastChannel;
    const firstRefreshResponse = deferred<Response>();
    const secondRefreshRequested = deferred<void>();
    let refreshCalls = 0;

    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/api/auth/login')) {
        return mockResponse(tokenResponse('access-old'));
      }
      if (requestUrl.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        if (refreshCalls === 1) {
          return firstRefreshResponse.promise;
        }
        secondRefreshRequested.resolve();
        return mockResponse({
          code: 'REFRESH_RETRY_REQUIRED',
          message: '다른 요청에서 로그인 정보가 갱신되었습니다.',
        }, 409);
      }

      return readHeader(init.headers, 'Authorization') === 'Bearer access-new'
        ? mockResponse({ accountId: 1, playerName: '공민이' })
        : mockResponse({ code: 'AUTH_TOKEN_INVALID', message: '로그인이 필요합니다.' }, 401);
    }) as unknown as typeof fetch;

    const firstTab = new BackendApiClient('http://backend.test');
    const secondTab = new BackendApiClient('http://backend.test');
    await firstTab.login({ loginId: 'hof-id', password: 'hof-password' });
    await secondTab.login({ loginId: 'hof-id', password: 'hof-password' });

    const statuses = Promise.all([
      firstTab.fetchStatus(),
      secondTab.fetchStatus(),
    ]);
    await secondRefreshRequested.promise;
    firstRefreshResponse.resolve(mockResponse(tokenResponse('access-new')));
    const [firstStatus, secondStatus] = await statuses;

    assert.equal(refreshCalls, 2);
    assert.equal(firstStatus.playerName, '공민이');
    assert.equal(secondStatus.playerName, '공민이');
  });

  it('normalizes relative current captcha image URLs against the backend base URL', async () => {
    const { BackendApiClient } = await loadBackendApi();
    mockFetch(makeCaptchaChallenge({ imageUrl: '/api/captcha/3/image' }));
    const client = new BackendApiClient('http://backend.test/');

    const result = await client.fetchCurrentCaptcha();

    assert.equal(result?.imageUrl, 'http://backend.test/api/captcha/3/image');
  });

  it('prepares the latest captcha snapshot only when authentication is started', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push({ url: String(url), init });
      return mockResponse(makeCaptchaChallenge({
        status: 'READY',
        imageUrl: '/api/captcha/3/image?version=4',
        preparationVersion: 4,
      }));
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test/');

    const result = await client.prepareCurrentCaptcha();

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, 'http://backend.test/api/captcha/current/prepare');
    assert.equal(requests[0]?.init.method, 'POST');
    assert.equal(result.imageUrl, 'http://backend.test/api/captcha/3/image?version=4');
    assert.equal(result.preparationVersion, 4);
  });

  it('restarts automatic solving for the selected captcha challenge', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push({ url: String(url), init });
      return mockResponse(null);
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test/');

    const result = await client.retryCaptchaAutomatically(7);

    assert.equal(result, null);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, 'http://backend.test/api/captcha/7/auto-solve');
    assert.equal(requests[0]?.init.method, 'POST');
  });

  it('builds captcha image sources with the current Bearer access token', async () => {
    const { BackendApiClient } = await loadBackendApi();
    mockFetch(tokenResponse('captcha-access-token', 'captcha-refresh-token'));
    const client = new BackendApiClient('http://backend.test');

    await client.login({ loginId: 'hof-id', password: 'hof-password' });

    assert.deepEqual(
      client.getAuthenticatedImageSource('http://backend.test/api/captcha/3/image'),
      {
        uri: 'http://backend.test/api/captcha/3/image',
        headers: { Authorization: 'Bearer captcha-access-token' },
      },
    );
  });

  it('keeps absolute current captcha image URLs unchanged', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const httpUrl = 'http://assets.test/api/captcha/3/image';
    mockFetch(makeCaptchaChallenge({ imageUrl: httpUrl }));
    const httpClient = new BackendApiClient('http://backend.test');

    const httpResult = await httpClient.fetchCurrentCaptcha();

    assert.equal(httpResult?.imageUrl, httpUrl);

    const httpsUrl = 'https://assets.test/api/captcha/3/image';
    mockFetch(makeCaptchaChallenge({ imageUrl: httpsUrl }));
    const httpsClient = new BackendApiClient('http://backend.test');

    const httpsResult = await httpsClient.fetchCurrentCaptcha();

    assert.equal(httpsResult?.imageUrl, httpsUrl);
  });

  it('normalizes network-path current captcha image URLs with the backend protocol', async () => {
    const { BackendApiClient } = await loadBackendApi();
    mockFetch(makeCaptchaChallenge({ imageUrl: '//cdn.example/captcha.png' }));
    const client = new BackendApiClient('https://backend.test');

    const result = await client.fetchCurrentCaptcha();

    assert.equal(result?.imageUrl, 'https://cdn.example/captcha.png');
  });

  it('keeps null current captcha values and null image URLs unchanged', async () => {
    const { BackendApiClient } = await loadBackendApi();
    mockFetch(null);
    const nullCaptchaClient = new BackendApiClient('http://backend.test');

    assert.equal(await nullCaptchaClient.fetchCurrentCaptcha(), null);

    mockFetch(makeCaptchaChallenge({ imageUrl: null }));
    const nullImageClient = new BackendApiClient('http://backend.test');

    assert.equal((await nullImageClient.fetchCurrentCaptcha())?.imageUrl, null);
  });

  it('normalizes missing and malformed quest rewards', async () => {
    const { BackendApiClient } = await loadBackendApi();
    mockFetch([
      {
        questKey: 'quest-without-rewards',
        name: 'Missing rewards',
        state: 'ACTIVE',
        section: 'ACTIVE',
        sourceOrder: 0,
        missions: [],
        actionNo: null,
      },
      {
        questKey: 'quest-with-malformed-rewards',
        name: 'Malformed rewards',
        state: 'AVAILABLE',
        section: 'AVAILABLE',
        sourceOrder: 1,
        missions: [],
        actionNo: null,
        rewards: ['Gold ×10', null, 3, '   '],
      },
    ]);
    const client = new BackendApiClient('http://backend.test');

    const quests = await client.fetchQuests();

    assert.deepEqual(quests.map(({ rewards }) => rewards), [
      [],
      ['Gold ×10'],
    ]);
  });

  it('normalizes captcha image URLs returned after submitting an answer', async () => {
    const { BackendApiClient } = await loadBackendApi();
    mockFetch(makeCaptchaChallenge({ imageUrl: '/api/captcha/3/image' }));
    const client = new BackendApiClient('http://backend.test/');

    const result = await client.submitCaptchaAnswer(3, { answer: 'abc123', preparationVersion: 2 });

    assert.equal(result.imageUrl, 'http://backend.test/api/captcha/3/image');
  });

  it('preserves backend error status code, code, and message', async () => {
    const { BackendApiClient, BackendApiError } = await loadBackendApi();
    mockFetch(
      { code: 'CAPTCHA_REQUIRED', message: 'Captcha answer is required.' },
      { status: 400 },
    );
    const client = new BackendApiClient('http://backend.test');

    await assert.rejects(
      client.fetchStatus(),
      (error) => {
        assert.equal(error instanceof BackendApiError, true);
        const backendError = error as BackendErrorShape;
        assert.equal(backendError.statusCode, 400);
        assert.equal(backendError.code, 'CAPTCHA_REQUIRED');
        assert.equal(backendError.message, 'Captcha answer is required.');
        return true;
      },
    );
  });

  it('preserves Retry-After seconds for session recovery scheduling', async () => {
    const { BackendApiClient, BackendApiError } = await loadBackendApi();
    globalThis.fetch = (async () => mockResponse(
      { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.' },
      429,
      { 'Retry-After': '37' },
    )) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test', memoryTokenStorage('refresh-token'));

    await assert.rejects(
      client.restoreSession(),
      (error) => {
        assert.equal(error instanceof BackendApiError, true);
        const backendError = error as BackendErrorShape;
        assert.equal(backendError.retryAfterSeconds, 37);
        return true;
      },
    );
  });

  it('discards a refresh result that finishes after logout starts', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const storage = memoryTokenStorage('refresh-old');
    const refreshResponse = deferred<Response>();
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/auth/refresh')) return refreshResponse.promise;
      if (String(url).endsWith('/api/auth/logout')) return mockResponse(null, 204);
      throw new Error(`Unexpected request: ${String(url)}`);
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test', storage);

    const restoring = client.restoreSession();
    await client.logout();
    refreshResponse.resolve(mockResponse(tokenResponse('stale-access', 'stale-refresh')));
    await restoring;

    assert.equal(client.getAccessToken(), null);
    assert.equal(storage.value, null);
  });

  it('clears local credentials before waiting for remote logout', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const storage = memoryTokenStorage('refresh-old');
    const logoutResponse = deferred<Response>();
    const logoutRequested = deferred<void>();
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (!String(url).endsWith('/api/auth/logout')) throw new Error(`Unexpected request: ${String(url)}`);
      logoutRequested.resolve();
      return logoutResponse.promise;
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test', storage);

    const loggingOut = client.logout();
    await logoutRequested.promise;

    assert.equal(client.getAccessToken(), null);
    assert.equal(storage.value, null);
    logoutResponse.resolve(mockResponse(null, 204));
    await loggingOut;
  });

  it('persists a failed remote logout and completes it before any later session restore', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const storage = memoryTokenStorage('refresh-old');
    let logoutAttempts = 0;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (!String(url).endsWith('/api/auth/logout')) throw new Error(`Unexpected request: ${String(url)}`);
      logoutAttempts += 1;
      if (logoutAttempts === 1) throw new Error('network unavailable');
      return mockResponse(null, 204);
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test', storage);

    await assert.rejects(client.logout(), /network unavailable/);
    assert.equal(storage.value, null);
    assert.equal(storage.pendingLogout, 'refresh-old');

    await assert.rejects(
      client.restoreSession(),
      (error: unknown) => (error as BackendErrorShape).code === 'AUTH_TOKEN_INVALID',
    );

    assert.equal(logoutAttempts, 2);
    assert.equal(storage.pendingLogout, null);
  });

  it('still clears memory and attempts removal when refresh-token loading fails during logout', async () => {
    const { BackendApiClient } = await loadBackendApi();
    let removeCalls = 0;
    const storage = {
      async load(): Promise<string | null> {
        throw new Error('secure storage read failed');
      },
      async save(): Promise<void> {},
      async remove(): Promise<void> {
        removeCalls += 1;
      },
    };
    globalThis.fetch = (async () => mockResponse(null, 204)) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test', storage);

    await client.logout();

    assert.equal(client.getAccessToken(), null);
    assert.equal(removeCalls, 1);
  });

  it('still revokes remotely and clears local credentials when pending-logout persistence fails', async () => {
    const { BackendApiClient } = await loadBackendApi();
    let value: string | null = 'refresh-old';
    let logoutBody: Record<string, unknown> | null = null;
    const storage = {
      async load() { return value; },
      async save(token: string) { value = token; },
      async remove() { value = null; },
      async savePendingLogout(): Promise<void> { throw new Error('secure storage write failed'); },
      async removePendingLogout(): Promise<void> {},
    };
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      logoutBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return mockResponse(null, 204);
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test', storage);

    await client.logout();

    assert.equal(value, null);
    assert.deepEqual(logoutBody, { refreshToken: 'refresh-old' });
  });

  it('ignores a late token broadcast after local logout until a new local login starts', async () => {
    const { BackendApiClient } = await loadBackendApi();
    platformOS = 'web';
    globalThis.BroadcastChannel = FakeBroadcastChannel as unknown as typeof BroadcastChannel;
    let loginCount = 0;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/auth/login')) {
        loginCount += 1;
        return mockResponse(tokenResponse(`access-${loginCount}`));
      }
      if (String(url).endsWith('/api/auth/logout')) return mockResponse(null, 204);
      throw new Error(`Unexpected request: ${String(url)}`);
    }) as unknown as typeof fetch;
    const firstTab = new BackendApiClient('http://backend.test');
    const secondTab = new BackendApiClient('http://backend.test');
    await firstTab.login({ loginId: 'hof-id', password: 'hof-password' });
    await secondTab.login({ loginId: 'hof-id', password: 'hof-password' });

    await firstTab.logout();
    await secondTab.login({ loginId: 'hof-id', password: 'hof-password' });

    assert.equal(firstTab.getAccessToken(), null);
  });

  it('discards a refresh result that finishes after a new login starts', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const storage = memoryTokenStorage('refresh-old');
    const refreshResponse = deferred<Response>();
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/auth/refresh')) return refreshResponse.promise;
      if (String(url).endsWith('/api/auth/login')) {
        return mockResponse(tokenResponse('new-access', 'new-refresh'));
      }
      throw new Error(`Unexpected request: ${String(url)}`);
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test', storage);

    const restoring = client.restoreSession();
    await client.login({ loginId: 'new-account', password: 'password' });
    refreshResponse.resolve(mockResponse(tokenResponse('stale-access', 'stale-refresh')));
    await restoring;

    assert.equal(client.getAccessToken(), 'new-access');
    assert.equal(storage.value, 'new-refresh');
  });

  it('stops accepting web token broadcasts after disposal', async () => {
    const { BackendApiClient } = await loadBackendApi();
    platformOS = 'web';
    globalThis.BroadcastChannel = FakeBroadcastChannel as unknown as typeof BroadcastChannel;
    const responses = [
      tokenResponse('first-access'),
      tokenResponse('second-access'),
      tokenResponse('second-new-access'),
    ];
    globalThis.fetch = (async () => mockResponse(responses.shift())) as unknown as typeof fetch;
    const firstTab = new BackendApiClient('http://backend.test');
    const secondTab = new BackendApiClient('http://backend.test');
    await firstTab.login({ loginId: 'same-account', password: 'password' });
    await secondTab.login({ loginId: 'same-account', password: 'password' });
    firstTab.dispose();

    await secondTab.login({ loginId: 'same-account', password: 'password' });

    assert.equal(firstTab.getAccessToken(), 'second-access');
    assert.equal(secondTab.getAccessToken(), 'second-new-access');
  });

  it('uses null error code for non-JSON bodies or error bodies without a code', async () => {
    const { BackendApiClient, BackendApiError } = await loadBackendApi();
    mockFetch('Gateway failure', { status: 502 });
    const nonJsonClient = new BackendApiClient('http://backend.test');

    await assert.rejects(
      nonJsonClient.fetchStatus(),
      (error) => {
        assert.equal(error instanceof BackendApiError, true);
        const backendError = error as BackendErrorShape;
        assert.equal(backendError.statusCode, 502);
        assert.equal(backendError.code, null);
        assert.equal(backendError.message, '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요. (HTTP 502)');
        return true;
      },
    );

    mockFetch({ message: 'Missing account.' }, { status: 404 });
    const noCodeClient = new BackendApiClient('http://backend.test');

    await assert.rejects(
      noCodeClient.fetchStatus(),
      (error) => {
        assert.equal(error instanceof BackendApiError, true);
        const backendError = error as BackendErrorShape;
        assert.equal(backendError.statusCode, 404);
        assert.equal(backendError.code, null);
        assert.equal(backendError.message, 'Missing account.');
        return true;
      },
    );
  });

  it('normalizes character list image URLs returned as HOF relative paths', async () => {
    const { BackendApiClient } = await loadBackendApi();
    mockFetch([
      makeHofCharacter(1, { imageUrl: '/ZeroHOF/image/social-knight.png' }),
      makeHofCharacter(2, { imageUrl: 'image/char/sknight02.gif' }),
    ]);
    const client = new BackendApiClient('http://backend.test');

    const characters = await client.listCharacters();

    assert.equal(characters[0]?.imageUrl, 'https://hof.zerosic.com/image/social-knight.png');
    assert.equal(characters[1]?.imageUrl, 'https://hof.zerosic.com/image/char/sknight02.gif');
  });

  it('synchronizes the roster through the HOF home without starting a detail job', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    const responses: unknown[] = [
      {
        accountId: 1,
        playerName: '공민이',
        funds: 100,
        timeCurrent: 10,
        timeMax: 20,
        work: 'Nothing',
        auction: 'Nothing',
        totalCharacterCount: 1,
        synchronizedCharacterCount: 0,
        characterSyncRequired: true,
        observedAt: '2026-08-20T00:00:00Z',
      },
      [makeHofCharacter(1, { name: '목록 전용' })],
    ];
    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push({ url: String(url), init });
      return mockResponse(responses.shift());
    }) as unknown as typeof fetch;

    const characters = await new BackendApiClient('http://backend.test').syncCharacterRoster();

    assert.equal(characters[0]?.name, '목록 전용');
    assert.deepEqual(
      requests.map(({ url, init }) => [url, init.method ?? 'GET']),
      [
        ['http://backend.test/api/status', 'GET'],
        ['http://backend.test/api/characters', 'GET'],
      ],
    );
    assert.equal(requests.some(({ url }) => url.includes('/sync-jobs')), false);
  });

  it('normalizes character detail and sync snapshot image URLs', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const client = new BackendApiClient('http://backend.test');

    mockFetch(makeHofCharacterDetail(1, { imageUrl: '/ZeroHOF/image/social-knight.png' }));
    const detail = await client.fetchCharacterDetail(1);

    assert.equal(detail.imageUrl, 'https://hof.zerosic.com/image/social-knight.png');

    mockFetch({
      jobId: 12,
      accountId: 1,
      status: 'running',
      rosterCount: 1,
      syncedCount: 1,
      failedCharacterIds: [],
      characters: [makeHofCharacter(1, { imageUrl: 'image/char/sknight02.gif' })],
      message: null,
      startedAt: '2026-07-10T00:00:00Z',
      finishedAt: null,
    });

    const job = await client.fetchCharacterSyncJob(12);

    assert.equal(job.characters[0]?.imageUrl, 'https://hof.zerosic.com/image/char/sknight02.gif');
  });

  it('loads a saved pattern through the stable character record contract', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    mockFetchWithCapture({}, requests);

    await new BackendApiClient('http://backend.test').loadSavedCharacterPattern(7, '0');

    assert.equal(requests[0]?.url, 'http://backend.test/api/characters/patterns/load');
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), { characterId: 7, slotCode: '0' });
  });

  it('starts long character work as a durable job instead of a blocking action', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    const progress: CharacterDeepSyncResponse = { characterId: 7, progress: [{
      phase: 'COMPLETED' as const,
      completedSteps: 4,
      totalSteps: 4,
      patternSlotCode: null,
      equipmentSlotNumber: null,
    }] };
    mockFetchWithCapture({
      id: 91,
      operationType: 'DEEP_SYNC',
      status: 'COMPLETED',
      sourceCharacterId: null,
      targetCharacterId: 7,
      deepSync: progress,
      transfer: null,
      message: null,
      updatedAt: '2026-08-17T00:00:00Z',
      finishedAt: '2026-08-17T00:00:00Z',
    }, requests);

    const observed: typeof progress[] = [];
    const result = await new BackendApiClient('http://backend.test')
      .deepSyncCharacter(7, (value) => observed.push(value));

    assert.equal(requests[0]?.url, 'http://backend.test/api/characters/records/7/deep-sync-jobs');
    assert.equal(requests[0]?.init.method, 'POST');
    assert.deepEqual(result, progress);
    assert.deepEqual(observed, [progress]);
  });

  it('restores an archived character through a durable deep-sync job before reloading the roster', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    const restored = makeHofCharacter(0);
    const responses: unknown[] = [
      {
        id: 92,
        operationType: 'RESTORE',
        status: 'COMPLETED',
        sourceCharacterId: null,
        targetCharacterId: restored.id,
        deepSync: { characterId: restored.id, progress: [] },
        transfer: null,
        message: null,
        updatedAt: '2026-08-17T00:00:00Z',
        finishedAt: '2026-08-17T00:00:00Z',
      },
      [restored],
    ];
    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push({ url: String(url), init });
      return mockResponse(responses.shift());
    }) as unknown as typeof fetch;

    const result = await new BackendApiClient('http://backend.test').restoreCharacter(restored.id);

    assert.deepEqual(requests.map((request) => request.url), [
      'http://backend.test/api/characters/restore-jobs',
      'http://backend.test/api/characters',
    ]);
    assert.equal(requests[0]?.init.method, 'POST');
    assert.deepEqual(result, [restored]);
  });

  it('uses the exact typed automation aggregate, settings, lifecycle, and quest endpoints', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    const aggregate = {
      entries: [],
      runtime: {
        lifecycle: 'STOPPED' as const,
        stopReason: null,
        nextAttemptAt: null,
        warnings: [],
        lastError: null,
      },
    };
    const questRequest = {
      enabled: true,
      quests: [{ questKey: 'daily', displayCode: 'daily', questName: 'Daily', enabled: true, sourceOrder: 0, maps: [] }],
    };
    const battleRequest = {
      enabled: true,
      maps: [{ categoryId: 'battle_map', mapCode: 'gb0', dailyTargetCount: 2,
        presetMode: 'PRIMARY' as const, partyPresetId: null, executionOrder: 0 }],
    };
    const adventureRequest = {
      enabled: false,
      maps: [{ categoryId: 'adventure_map', mapCode: 'Noble101',
        presetMode: 'EXPLICIT' as const, partyPresetId: 7, executionOrder: 0 }],
    };
    const client = new BackendApiClient('http://backend.test');

    mockFetchWithCapture(aggregate, requests);
    await client.fetchUnifiedAutomation();
    mockFetchWithCapture(aggregate, requests);
    await client.createAutomationEntry({ type: 'QUEST' });
    mockFetchWithCapture(aggregate, requests);
    await client.deleteAutomationEntry(31, '7');
    mockFetchWithCapture(aggregate, requests);
    await client.reorderAutomationEntries([31, 18]);
    mockFetchWithCapture(aggregate, requests);
    await client.updateQuestAutomation(questRequest);
    mockFetchWithCapture(aggregate, requests);
    await client.updateBattleMapAutomation(battleRequest);
    mockFetchWithCapture(aggregate, requests);
    await client.updateAdventureMapAutomation(adventureRequest);
    for (const action of ['start', 'pause', 'resume', 'stop'] as const) {
      mockFetchWithCapture(aggregate, requests);
      await client.changeUnifiedAutomationState(action);
    }
    mockFetchWithCapture([], requests);
    await client.fetchQuests();
    mockFetchWithCapture([], requests);
    await client.acceptQuest('quest 351');
    mockFetchWithCapture([], requests);
    await client.claimQuest('R/610');
    mockFetchWithCapture({ battleGate: null, items: [] }, requests);
    await client.fetchAutomationConvergence();
    mockFetchWithCapture({ battleGate: null, items: [] }, requests);
    await client.allowFreshAutomationDecision(77);

    assert.deepEqual(
      requests.map((request) => [request.url, request.init.method ?? 'GET']),
      [
        ['http://backend.test/api/automation/unified', 'GET'],
        ['http://backend.test/api/automation/unified/entries', 'POST'],
        ['http://backend.test/api/automation/unified/entries/31?settingsRevision=7', 'DELETE'],
        ['http://backend.test/api/automation/unified/entries/order', 'PUT'],
        ['http://backend.test/api/automation/unified/quest', 'PUT'],
        ['http://backend.test/api/automation/unified/battle-maps', 'PUT'],
        ['http://backend.test/api/automation/unified/adventure-maps', 'PUT'],
        ['http://backend.test/api/automation/unified/start', 'POST'],
        ['http://backend.test/api/automation/unified/pause', 'POST'],
        ['http://backend.test/api/automation/unified/resume', 'POST'],
        ['http://backend.test/api/automation/unified/stop', 'POST'],
        ['http://backend.test/api/quests', 'GET'],
        ['http://backend.test/api/quests/quest%20351/accept', 'POST'],
        ['http://backend.test/api/quests/R%2F610/claim', 'POST'],
        ['http://backend.test/api/automation/unified/convergence', 'GET'],
        ['http://backend.test/api/automation/unified/convergence/77/allow-fresh-decision', 'POST'],
      ],
    );
    assert.equal(requests[1]?.init.body, '{"type":"QUEST"}');
    assert.equal(requests[2]?.init.body, undefined);
    assert.equal(requests[3]?.init.body, '{"entryIds":[31,18]}');
    assert.equal(requests[4]?.init.body, JSON.stringify(questRequest));
    assert.equal(requests[5]?.init.body, JSON.stringify(battleRequest));
    assert.equal(requests[6]?.init.body, JSON.stringify(adventureRequest));
    assert.equal(requests.some(({ url }) => url.includes('/modules')), false);
  });

  it('registers an Android native FCM token without an Expo push token', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    mockFetchWithCapture({
      id: 3,
      platform: 'ANDROID',
      installationId: 'install-1',
      active: true,
      lastSeenAt: '2026-07-13T00:00:00Z',
    }, requests);
    const client = new BackendApiClient('http://backend.test');

    await client.registerAndroidPushTarget({
      installationId: 'install-1',
      nativeToken: 'native-fcm-token',
    });

    assert.equal(requests[0]?.url, 'http://backend.test/api/push/android/targets');
    assert.equal(requests[0]?.init.method, 'POST');
    assert.equal(
      requests[0]?.init.body,
      '{"installationId":"install-1","nativeToken":"native-fcm-token"}',
    );
  });

  it('sends the current device push target with explicit logout', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    const responses = [
      mockResponse({ id: 3, platform: 'ANDROID', installationId: 'install-1', active: true, lastSeenAt: '2026-07-13T00:00:00Z' }),
      mockResponse(null, 204),
    ];
    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push({ url: String(url), init });
      return responses.shift()!;
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test', memoryTokenStorage('refresh-old'));

    await client.registerAndroidPushTarget({ installationId: 'install-1', nativeToken: 'native-token' });
    await client.logout();

    assert.equal(requests[1]?.init.body, '{"refreshToken":"refresh-old","pushTargetId":3}');
  });

  it('waits for a late Android push registration before logout deactivates that installation', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const storage = memoryTokenStorage('refresh-old');
    const registrationResponse = deferred<Response>();
    const registrationRequested = deferred<void>();
    let logoutBody: string | null = null;
    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(url).endsWith('/api/push/android/targets')) {
        registrationRequested.resolve();
        return registrationResponse.promise;
      }
      if (String(url).endsWith('/api/auth/logout')) {
        logoutBody = String(init.body);
        return mockResponse(null, 204);
      }
      throw new Error(`Unexpected request: ${String(url)}`);
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test', storage);

    const registering = client.registerAndroidPushTarget({
      installationId: 'install-late',
      nativeToken: 'native-token',
    });
    await registrationRequested.promise;
    const loggingOut = client.logout();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(logoutBody, null);
    registrationResponse.resolve(mockResponse({
      id: 17,
      platform: 'ANDROID',
      installationId: 'install-late',
      active: true,
      lastSeenAt: '2026-08-26T00:00:00Z',
    }));
    await registering;
    await loggingOut;

    assert.equal(storage.value, null);
    assert.equal(logoutBody, '{"refreshToken":"refresh-old","pushTargetId":17}');
    await assert.rejects(
      client.registerAndroidPushTarget({ installationId: 'install-late', nativeToken: 'next-token' }),
      (error: unknown) => (error as BackendErrorShape).code === 'AUTH_TOKEN_INVALID',
    );
  });

  it('uses typed account pass maintenance status setting and refresh endpoints', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    const response = {
      enabled: true,
      authSuspended: false,
      passState: 'VALID',
      remainingSeconds: 1200,
      validUntil: '2026-08-26T10:20:00Z',
      observedAt: '2026-08-26T10:00:00Z',
      nextRefreshAt: '2026-08-26T10:20:01Z',
      lastAttemptAt: null,
      lastResult: 'VALID_CONFIRMED',
      manualChallengeId: null,
    };
    globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push({ url: String(url), init });
      return mockResponse(response);
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test');

    await client.fetchCaptchaPassMaintenance();
    await client.updateCaptchaPassMaintenance(false);
    await client.refreshCaptchaPassMaintenance();

    assert.deepEqual(requests.map(({ url, init }) => [url, init.method ?? 'GET', init.body]), [
      ['http://backend.test/api/captcha/pass-maintenance', 'GET', undefined],
      ['http://backend.test/api/captcha/pass-maintenance', 'PUT', '{"enabled":false}'],
      ['http://backend.test/api/captcha/pass-maintenance/refresh', 'POST', undefined],
    ]);
  });

  it('uses party preset endpoints for reusable character parties', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    const preset = {
      id: 7,
      accountId: 1,
      name: '고블린 범용 파티',
      folderId: null,
      displayOrder: 0,
      isPrimary: false,
      members: [
        { slotIndex: 0, characterId: 'char-1', patternSlot: 0 },
        { slotIndex: 1, characterId: 'char-2', patternSlot: 1 },
        { slotIndex: 2, characterId: null, patternSlot: null },
        { slotIndex: 3, characterId: null, patternSlot: null },
        { slotIndex: 4, characterId: null, patternSlot: null },
      ],
      createdAt: '2026-07-11T00:00:00Z',
      updatedAt: '2026-07-11T00:00:00Z',
    };
    mockFetchWithCapture([preset], requests);
    const client = new BackendApiClient('http://backend.test');

    const presets = await client.listPartyPresets();

    assert.equal(presets[0]?.name, '고블린 범용 파티');
    assert.equal(requests[0]?.url, 'http://backend.test/api/party-presets');

    mockFetchWithCapture(preset, requests);
    await client.createPartyPreset({
      name: '고블린 범용 파티',
      members: preset.members,
      folderId: null,
    });

    assert.equal(requests[1]?.url, 'http://backend.test/api/party-presets');
    assert.equal(requests[1]?.init.method, 'POST');
    assert.equal(
      requests[1]?.init.body,
      '{"name":"고블린 범용 파티","members":[{"slotIndex":0,"characterId":"char-1","patternSlot":0},{"slotIndex":1,"characterId":"char-2","patternSlot":1},{"slotIndex":2,"characterId":null,"patternSlot":null},{"slotIndex":3,"characterId":null,"patternSlot":null},{"slotIndex":4,"characterId":null,"patternSlot":null}],"folderId":null}',
    );

    mockFetchWithCapture({ ...preset, name: '모험 기본 파티' }, requests);
    await client.updatePartyPreset(7, {
      name: '모험 기본 파티',
      members: preset.members,
      folderId: 2,
    });

    assert.equal(requests[2]?.url, 'http://backend.test/api/party-presets/7');
    assert.equal(requests[2]?.init.method, 'PATCH');
    assert.equal(
      requests[2]?.init.body,
      '{"name":"모험 기본 파티","members":[{"slotIndex":0,"characterId":"char-1","patternSlot":0},{"slotIndex":1,"characterId":"char-2","patternSlot":1},{"slotIndex":2,"characterId":null,"patternSlot":null},{"slotIndex":3,"characterId":null,"patternSlot":null},{"slotIndex":4,"characterId":null,"patternSlot":null}],"folderId":2}',
    );

    mockFetchWithCapture({ ...preset, isPrimary: true }, requests);
    await client.makePartyPresetPrimary(7);

    assert.equal(requests[3]?.url, 'http://backend.test/api/party-presets/7/primary');
    assert.equal(requests[3]?.init.method, 'POST');

    mockFetchWithCapture([preset], requests);
    await client.reorderPartyPresets({ folderId: null, presetIds: [7] });

    assert.equal(requests[4]?.url, 'http://backend.test/api/party-presets/order');
    assert.equal(requests[4]?.init.method, 'PUT');
    assert.equal(requests[4]?.init.body, '{"folderId":null,"presetIds":[7]}');

    mockFetchWithCapture(null, requests);
    await client.deletePartyPreset(7);

    assert.equal(requests[5]?.url, 'http://backend.test/api/party-presets/7');
    assert.equal(requests[5]?.init.method, 'DELETE');
  });

  it('uses catalog and folder endpoints for the party preset hierarchy', async () => {
    assert.equal(partyPresetFolderIdIsRequired, true);
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    const catalog = {
      folders: [{
        id: 2,
        name: '레이드',
        parentFolderId: null,
        displayOrder: 0,
        createdAt: '2026-07-27T00:00:00Z',
        updatedAt: '2026-07-27T00:00:00Z',
      }],
      presets: [{
        id: 7,
        accountId: 1,
        name: '미지정 프리셋',
        folderId: null,
        displayOrder: 0,
        isPrimary: false,
        members: [
          { slotIndex: 0, characterId: 'char-1', patternSlot: 0 },
          { slotIndex: 1, characterId: null, patternSlot: null },
          { slotIndex: 2, characterId: null, patternSlot: null },
          { slotIndex: 3, characterId: null, patternSlot: null },
          { slotIndex: 4, characterId: null, patternSlot: null },
        ],
        createdAt: '2026-07-27T00:00:00Z',
        updatedAt: '2026-07-27T00:00:00Z',
      }],
    };
    const client = new BackendApiClient('http://backend.test');

    mockFetchWithCapture(catalog, requests);
    const response = await client.getPartyPresetCatalog();

    assert.equal(response.folders[0]?.name, '레이드');
    assert.equal(response.folders[0]?.parentFolderId, null);
    assert.equal(response.presets[0]?.folderId, null);
    assert.equal(requests[0]?.url, 'http://backend.test/api/party-presets/catalog');
    assert.equal(requests[0]?.init.method, undefined);
    assert.equal(requests[0]?.init.body, undefined);

    mockFetchWithCapture(catalog, requests);
    await client.createPartyPresetFolder({ name: '보스', parentFolderId: null });
    assert.equal(requests[1]?.url, 'http://backend.test/api/party-preset-folders');
    assert.equal(requests[1]?.init.method, 'POST');
    assert.equal(requests[1]?.init.body, '{"name":"보스","parentFolderId":null}');

    mockFetchWithCapture(catalog, requests);
    await client.renamePartyPresetFolder(4, { name: '매일 보스' });
    assert.equal(requests[2]?.url, 'http://backend.test/api/party-preset-folders/4');
    assert.equal(requests[2]?.init.method, 'PATCH');
    assert.equal(requests[2]?.init.body, '{"name":"매일 보스"}');

    mockFetchWithCapture(catalog, requests);
    await client.reorderPartyPresetFolders({ parentFolderId: null, folderIds: [4, 2] });
    assert.equal(requests[3]?.url, 'http://backend.test/api/party-preset-folders/order');
    assert.equal(requests[3]?.init.method, 'PUT');
    assert.equal(requests[3]?.init.body, '{"parentFolderId":null,"folderIds":[4,2]}');

    mockFetchWithCapture(catalog, requests);
    await client.movePartyPresetFolder(4, { parentFolderId: 2, displayOrder: 1 });
    assert.equal(requests[4]?.url, 'http://backend.test/api/party-preset-folders/4/location');
    assert.equal(requests[4]?.init.method, 'PUT');
    assert.equal(requests[4]?.init.body, '{"parentFolderId":2,"displayOrder":1}');

    mockFetchWithCapture(catalog, requests);
    await client.deletePartyPresetFolder(4);
    assert.equal(requests[5]?.url, 'http://backend.test/api/party-preset-folders/4');
    assert.equal(requests[5]?.init.method, 'DELETE');
    assert.equal(requests[5]?.init.body, undefined);
  });

  it('uses authenticated JSON transport for typed town resource and action endpoints', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const requests: CapturedRequest[] = [];
    const client = new BackendApiClient('http://backend.test');

    mockFetchWithCapture({ rows: [] }, requests);
    await client.fetchTownResource<{ rows: [] }>('/api/town/fishing');

    mockFetchWithCapture({ status: 'SUCCESS', messages: [] }, requests);
    await client.submitTownAction('/api/town/fishing/catch', { candidateId: 'fish-1' });

    assert.equal(requests[0]?.url, 'http://backend.test/api/town/fishing');
    assert.equal(requests[0]?.init.method, undefined);
    assert.equal(requests[1]?.url, 'http://backend.test/api/town/fishing/catch');
    assert.equal(requests[1]?.init.method, 'POST');
    assert.equal(requests[1]?.init.body, '{"candidateId":"fish-1"}');
  });

  it('blocks duplicate manual actions and publishes loading until the response settles', async () => {
    const { BackendApiClient, ManualActionBusyError } = await loadBackendApi();
    const pending = deferred<Response>();
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return pending.promise;
    }) as unknown as typeof fetch;
    const client = new BackendApiClient('http://backend.test');
    const states: boolean[] = [];
    const unsubscribe = client.subscribeManualActionState((state) => states.push(state));

    const first = client.submitTownAction('/api/town/fishing/catch', { candidateId: 'fish-1' });
    await assert.rejects(
      client.submitTownAction('/api/town/fishing/catch', { candidateId: 'fish-1' }),
      ManualActionBusyError,
    );
    assert.equal(fetchCalls, 1);
    assert.deepEqual(states, [false, true]);

    pending.resolve(mockResponse({ status: 'SUCCESS', messages: [] }));
    await first;
    assert.deepEqual(states, [false, true, false]);
    unsubscribe();
  });
});

function loadBackendApi(): Promise<BackendApiModule> {
  backendApiModule ??= import('../../main/services/backendApi');
  return backendApiModule;
}

function mockFetch(body: unknown, { status = 200 }: { status?: number } = {}): void {
  globalThis.fetch = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  })) as unknown as typeof fetch;
}

function mockFetchWithCapture(
  body: unknown,
  requests: CapturedRequest[],
  { status = 200 }: { status?: number } = {},
): void {
  globalThis.fetch = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }) as unknown as typeof fetch;
}

type BackendErrorShape = {
  statusCode: number;
  code: string | null;
  message: string;
  retryAfterSeconds: number | null;
};

type CapturedRequest = {
  url: string;
  init: RequestInit;
};

function tokenResponse(accessToken: string, refreshToken?: string) {
  return {
    accessToken,
    tokenType: 'Bearer',
    accessTokenExpiresAt: '2026-07-13T00:30:00Z',
    ...(refreshToken ? { refreshToken } : {}),
    refreshTokenExpiresAt: '2026-08-12T00:00:00Z',
  };
}

function mockResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => (body == null ? '' : JSON.stringify(body)),
  } as Response;
}

function memoryTokenStorage(initialValue: string | null = null) {
  return {
    value: initialValue,
    pendingLogout: null as string | null,
    async load() {
      return this.value;
    },
    async save(token: string) {
      this.value = token;
    },
    async remove() {
      this.value = null;
    },
    async loadPendingLogout() {
      return this.pendingLogout;
    },
    async savePendingLogout(token: string | null) {
      this.pendingLogout = token ?? 'WEB_COOKIE';
    },
    async removePendingLogout() {
      this.pendingLogout = null;
    },
  };
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  return new Headers(headers).get(name);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** 테스트 프로세스 안에서 브라우저 탭 사이의 BroadcastChannel 전달을 재현한다. */
class FakeBroadcastChannel {
  private static readonly channels = new Map<string, Set<FakeBroadcastChannel>>();
  readonly name: string;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>();
    peers.add(this);
    FakeBroadcastChannel.channels.set(name, peers);
  }

  postMessage(message: unknown): void {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data: message } as MessageEvent<unknown>);
    }
  }

  close(): void {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}
