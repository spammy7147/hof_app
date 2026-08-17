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

  afterEach(() => {
    platformOS = 'ios';
    globalThis.fetch = originalFetch;
    globalThis.BroadcastChannel = originalBroadcastChannel;
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

    const statuses = Promise.all([client.fetchStatus(), client.fetchStatus()]);
    await bothInitialRequestsCompleted.promise;
    refreshResponse.resolve(mockResponse(tokenResponse('access-new', 'refresh-new')));
    await statuses;

    assert.equal(refreshCalls, 1);
    assert.equal(storage.value, 'refresh-new');
    assert.deepEqual(authorizationHeaders, [null, null, 'Bearer access-new', 'Bearer access-new']);
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

    assert.equal(characters[0]?.imageUrl, 'http://sic.zerosic.com/ZeroHOF/image/social-knight.png');
    assert.equal(characters[1]?.imageUrl, 'http://sic.zerosic.com/ZeroHOF/image/char/sknight02.gif');
  });

  it('normalizes character detail and sync snapshot image URLs', async () => {
    const { BackendApiClient } = await loadBackendApi();
    const client = new BackendApiClient('http://backend.test');

    mockFetch(makeHofCharacterDetail(1, { imageUrl: '/ZeroHOF/image/social-knight.png' }));
    const detail = await client.fetchCharacterDetail(1);

    assert.equal(detail.imageUrl, 'http://sic.zerosic.com/ZeroHOF/image/social-knight.png');

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

    assert.equal(job.characters[0]?.imageUrl, 'http://sic.zerosic.com/ZeroHOF/image/char/sknight02.gif');
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
    await client.deleteAutomationEntry(31);
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

    assert.deepEqual(
      requests.map((request) => [request.url, request.init.method ?? 'GET']),
      [
        ['http://backend.test/api/automation/unified', 'GET'],
        ['http://backend.test/api/automation/unified/entries', 'POST'],
        ['http://backend.test/api/automation/unified/entries/31', 'DELETE'],
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

function mockResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body == null ? '' : JSON.stringify(body)),
  } as Response;
}

function memoryTokenStorage(initialValue: string | null = null) {
  return {
    value: initialValue,
    async load() {
      return this.value;
    },
    async save(token: string) {
      this.value = token;
    },
    async remove() {
      this.value = null;
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
