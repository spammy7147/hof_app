import assert from 'node:assert/strict';
import Module from 'node:module';
import { after, afterEach, beforeEach, it } from 'node:test';
import type { AppStateStatus } from 'react-native';
import type { DevicePushTargetResponse } from '../../../main/types/api';
import type { RefreshTokenStorage } from '../../../main/platform/tokenStorage';

type NativePush = typeof import('../../../main/platform/pushNotifications.native');
type Token = { type: string; data: string };
const appListeners = new Set<(state: AppStateStatus) => void>();
const tokenListeners = new Set<(token: Token) => void>();
let permission = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' };
let nativeToken = 'native-token';
let tokenRequests = 0;
let emitOnTokenRead = false;
let permissionRequests = 0;
let installationLookup = async (): Promise<string | null> => 'installation-1';
let nativeTokenFailure: Error | null = null;
const nativeTokenManager = {
  getDevicePushTokenAsync: async () => {
    tokenRequests += 1;
    if (nativeTokenFailure) { const error = nativeTokenFailure; nativeTokenFailure = null; throw error; }
    if (emitOnTokenRead && tokenRequests <= 3) {
      for (const listener of tokenListeners) listener({ type: 'android', data: nativeToken });
    }
    return nativeToken;
  },
};
const notifications = {
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: () => undefined,
  setNotificationChannelAsync: async () => undefined,
  getPermissionsAsync: async () => permission,
  requestPermissionsAsync: async () => { permissionRequests += 1; return permission; },
  getDevicePushTokenAsync: () => getDevicePushTokenAsync(),
  getLastNotificationResponse: () => null,
  clearLastNotificationResponse: () => undefined,
  addNotificationResponseReceivedListener: () => ({ remove: () => undefined }),
  addPushTokenListener: (listener: (token: Token) => void) => {
    tokenListeners.add(listener);
    return { remove: () => tokenListeners.delete(listener) };
  },
};
// 제품 hook·native adapter·HTTP client를 유지하고 OS/저장소/전송 seam만 제어한다.
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const originalLoad = loader._load;
let nativePush: NativePush;
loader._load = (request, parent, isMain) => {
  if (request === 'expo-modules-core') return { Platform: { OS: 'android' }, UnavailabilityError: Error };
  if (parent?.filename.endsWith('/expo-notifications/build/getDevicePushTokenAsync.js')) {
    if (request === './PushTokenManager') return nativeTokenManager;
    if (request === './warnOfExpoGoPushUsage') return { warnOfExpoGoPushUsage: () => undefined };
  }
  if (request === 'react-native') return {
    Platform: { OS: 'android' },
    StyleSheet: { flatten: (style: unknown) => style },
    AppState: { currentState: 'active', addEventListener: (_event: string, listener: (state: AppStateStatus) => void) => {
      appListeners.add(listener);
      return { remove: () => appListeners.delete(listener) };
    } },
  };
  if (request === 'expo-constants') return { appOwnership: 'standalone' };
  if (request === 'expo-secure-store') return { getItemAsync: () => installationLookup(), setItemAsync: async () => undefined };
  if (request === 'expo-notifications') return notifications;
  if (request.endsWith('/platform/pushNotifications')) return nativePush;
  return originalLoad(request, parent, isMain);
};
const { getDevicePushTokenAsync } = require('expo-notifications/build/getDevicePushTokenAsync') as Pick<typeof import('expo-notifications'), 'getDevicePushTokenAsync'>;
nativePush = require('../../../main/platform/pushNotifications.native') as NativePush;
const { useAndroidPushRegistration } = require('../../../main/features/push/useAndroidPushRegistration') as typeof import('../../../main/features/push/useAndroidPushRegistration');
const { BackendApiClient } = require('../../../main/services/backendApi') as typeof import('../../../main/services/backendApi');
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const originalFetch = globalThis.fetch;
const storage: RefreshTokenStorage = { load: async () => 'refresh-1', save: async () => undefined, remove: async () => undefined };
const target: DevicePushTargetResponse = { id: 4, installationId: 'installation-1', platform: 'ANDROID', active: true, lastSeenAt: '2026-09-09T00:00:00Z' };
const clients: InstanceType<typeof BackendApiClient>[] = [];
const onOpenCaptcha = () => undefined;
function client() {
  const api = new BackendApiClient('http://backend.test', storage);
  clients.push(api);
  return api;
}
function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
beforeEach(() => {
  tokenRequests = 0;
  emitOnTokenRead = false;
  permissionRequests = 0;
  permission = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' };
  nativeToken = 'native-token';
  nativeTokenFailure = null;
  installationLookup = async () => 'installation-1';
});
afterEach(async () => {
  await rntl.cleanup();
  for (const api of clients.splice(0)) api.dispose();
  globalThis.fetch = originalFetch;
  appListeners.clear();
  tokenListeners.clear();
});
after(() => { loader._load = originalLoad; });

it('첫 등록의 일시 실패 뒤 같은 로그인 세대와 토큰으로 푸시 연결을 마친다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const registrations: unknown[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'http://backend.test/api/push/android/targets');
    registrations.push(JSON.parse(String(init?.body)));
    return registrations.length === 1 ? response({ code: 'TEMPORARY', message: '일시 장애' }, 503) : response(target);
  };
  const api = client();
  await rntl.renderHook(() => useAndroidPushRegistration({ api, authenticated: true, onOpenCaptcha }));
  assert.equal(registrations.length, 1);
  await rntl.act(() => { t.mock.timers.tick(1_000); });
  assert.deepEqual(registrations, [
    { installationId: 'installation-1', nativeToken: 'native-token' },
    { installationId: 'installation-1', nativeToken: 'native-token' },
  ]);
  await rntl.act(() => { t.mock.timers.tick(60_000); });
  assert.equal(registrations.length, 2);
});

it('권한 거부는 반복 요청하지 않고 설정에서 허용한 뒤 앱 복귀 시 등록한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  permission = { granted: false, status: 'denied', canAskAgain: false, expires: 'never' };
  let registrations = 0;
  globalThis.fetch = async () => { registrations += 1; return response(target); };
  const api = client();
  const hook = await rntl.renderHook(() => useAndroidPushRegistration({ api, authenticated: true, onOpenCaptcha }));
  assert.match(hook.result.current ?? '', /설정.*알림 권한/);
  assert.equal(permissionRequests, 0);
  await rntl.act(() => { t.mock.timers.tick(60_000); });
  assert.equal(registrations, 0);
  permission = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' };
  await rntl.act(() => {
    for (const listener of appListeners) listener('background');
    for (const listener of appListeners) listener('active');
  });
  assert.equal(registrations, 1);
  assert.equal(permissionRequests, 0);
  assert.equal(hook.result.current, null);
});

it('등록 실패 안내는 알림 연결이 복구되면 사라진다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? response({ code: 'TEMPORARY', message: '일시 장애' }, 503) : response(target);
  const api = client();
  const hook = await rntl.renderHook(() => useAndroidPushRegistration({ api, authenticated: true, onOpenCaptcha }));
  assert.equal(typeof hook.result.current, 'string');
  await rntl.act(() => { t.mock.timers.tick(1_000); });
  assert.equal(hook.result.current, null);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('잘못된 등록 요청은 자동 반복하지 않고 앱 복귀에서 다시 확인한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1
    ? response({ code: 'VALIDATION_FAILED', message: '등록 요청 확인 필요' }, 400)
    : response(target);
  const api = client();
  const hook = await rntl.renderHook(() => useAndroidPushRegistration({ api, authenticated: true, onOpenCaptcha }));
  await rntl.act(() => { t.mock.timers.tick(60_000); });
  assert.equal(calls, 1);
  assert.match(hook.result.current ?? '', /앱.*다시/);
  await rntl.act(() => {
    for (const listener of appListeners) listener('background');
    for (const listener of appListeners) listener('active');
  });
  assert.equal(calls, 2);
  assert.equal(hook.result.current, null);
});

it('이전 토큰 등록이 진행 중이면 최신 토큰을 마지막에 연결하고 이전 실패를 재시도하지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = deferred<Response>();
  const tokens: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    tokens.push(body.nativeToken);
    return tokens.length === 1 ? first.promise : response(target);
  };
  const api = client();
  const hook = await rntl.renderHook(() => useAndroidPushRegistration({ api, authenticated: true, onOpenCaptcha }));
  await rntl.act(() => {
    nativeToken = 'new-token';
    for (const listener of tokenListeners) listener({ type: 'android', data: nativeToken });
  });
  assert.deepEqual(tokens, ['native-token']);
  await rntl.act(() => { first.resolve(response({ code: 'TEMPORARY', message: '이전 등록 실패' }, 503)); });
  assert.deepEqual(tokens, ['native-token', 'new-token']);
  await rntl.act(() => { t.mock.timers.tick(60_000); });
  assert.deepEqual(tokens, ['native-token', 'new-token']);
  assert.equal(hook.result.current, null);
});

it('로그아웃은 진행 중 등록을 비활성화한 뒤 끝내고 다음 로그인에 이전 콜백을 연결하지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pendingRegistration = deferred<Response>();
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  let registrations = 0;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    requests.push({ path, body: JSON.parse(String(init?.body)) });
    if (path === '/api/push/android/targets') return ++registrations === 1 ? pendingRegistration.promise : response(target);
    if (path === '/api/auth/logout') return response(null, 204);
    if (path === '/api/auth/login') return response({ accessToken: 'access-next', refreshToken: 'refresh-next' });
    throw new Error(`Unexpected request: ${path}`);
  };
  const api = client();
  const hook = await rntl.renderHook(({ authenticated }: { authenticated: boolean }) => useAndroidPushRegistration({ api, authenticated, onOpenCaptcha }), {
    initialProps: { authenticated: true },
  });
  const previousListeners = [...tokenListeners];
  await rntl.act(() => {
    for (const listener of tokenListeners) listener({ type: 'android', data: 'old-delayed-token' });
  });
  const loggingOut = api.logout();
  await hook.rerender({ authenticated: false });
  assert.equal(requests.some(({ path }) => path === '/api/auth/logout'), false);
  await rntl.act(async () => { pendingRegistration.resolve(response(target)); await loggingOut; });
  assert.deepEqual(requests[1], { path: '/api/auth/logout', body: { refreshToken: 'refresh-1', pushTargetId: 4 } });
  assert.equal(tokenListeners.size, 0);
  assert.equal(appListeners.size, 0);
  nativeToken = 'next-account-token';
  await api.login({ loginId: 'next-account', password: 'fixture-password' });
  await hook.rerender({ authenticated: true });
  await rntl.act(() => {
    for (const listener of previousListeners) listener({ type: 'android', data: 'old-delayed-token' });
  });
  await rntl.act(() => { t.mock.timers.tick(60_000); });
  assert.deepEqual(requests.filter(({ path }) => path === '/api/push/android/targets').map(({ body }) => body.nativeToken), [
    'native-token', 'next-account-token',
  ]);
  assert.equal(hook.result.current, null);
});

it('등록 재시도 예약은 로그인 세대가 끝나면 제거한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return response({ code: 'TEMPORARY', message: '일시 장애' }, 503); };
  const api = client();
  const hook = await rntl.renderHook(({ authenticated }: { authenticated: boolean }) => useAndroidPushRegistration({ api, authenticated, onOpenCaptcha }), {
    initialProps: { authenticated: true },
  });
  await hook.rerender({ authenticated: false });
  await rntl.act(() => { t.mock.timers.tick(60_000); });
  assert.equal(calls, 1);
  assert.equal(hook.result.current, null);
});

it('토큰 교체 중 설치 저장소의 일시 실패도 같은 등록 경로에서 복구한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tokens: string[] = [];
  globalThis.fetch = async (_url, init) => {
    tokens.push(JSON.parse(String(init?.body)).nativeToken);
    return response(target);
  };
  const api = client();
  const hook = await rntl.renderHook(() => useAndroidPushRegistration({ api, authenticated: true, onOpenCaptcha }));
  nativeToken = 'new-token';
  installationLookup = async () => { throw new Error('저장소 일시 장애'); };
  await rntl.act(() => {
    for (const listener of tokenListeners) listener({ type: 'android', data: nativeToken });
  });
  assert.equal(typeof hook.result.current, 'string');
  installationLookup = async () => 'installation-1';
  await rntl.act(() => { t.mock.timers.tick(1_000); });
  assert.deepEqual(tokens, ['native-token', 'new-token']);
  assert.equal(hook.result.current, null);
});

it('기기 토큰 조회가 변경 이벤트를 발생시켜도 토큰을 반복 조회하지 않는다', async () => {
  emitOnTokenRead = true;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return response(target); };
  const api = client();
  await rntl.renderHook(() => useAndroidPushRegistration({ api, authenticated: true, onOpenCaptcha }));
  assert.equal(tokenRequests, 1);
  assert.equal(calls, 1);
});

it('등록 제한 응답의 대기 시간을 지킨 뒤 연결을 복구한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const tokens: string[] = [];
  globalThis.fetch = async (_url, init) => {
    tokens.push(JSON.parse(String(init?.body)).nativeToken);
    if (++calls > 1) return response(target);
    const limited = response({ code: 'RATE_LIMITED', message: '잠시 대기' }, 429);
    limited.headers.set('Retry-After', '10');
    return limited;
  };
  const api = client();
  const hook = await rntl.renderHook(() => useAndroidPushRegistration({ api, authenticated: true, onOpenCaptcha }));
  await rntl.act(() => {
    for (const listener of appListeners) listener('background');
    for (const listener of appListeners) listener('active');
    for (const listener of tokenListeners) listener({ type: 'android', data: 'new-token' });
  });
  assert.equal(calls, 1);
  await rntl.act(() => { t.mock.timers.tick(9_999); });
  assert.equal(calls, 1);
  await rntl.act(() => { t.mock.timers.tick(1); });
  assert.equal(calls, 2);
  assert.deepEqual(tokens, ['native-token', 'new-token']);
  assert.equal(hook.result.current, null);
});

it('반복 실패는 최대 30초 간격으로 기다리고 콜백 교체가 재시도를 초기화하지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  emitOnTokenRead = true;
  let calls = 0;
  let firstErrors = 0;
  let nextErrors = 0;
  globalThis.fetch = async () => { calls += 1; return response({ code: 'TEMPORARY', message: '일시 장애' }, 503); };
  const api = client();
  const hook = await rntl.renderHook(({ onError }: { onError: () => void }) => useAndroidPushRegistration({ api, authenticated: true, onOpenCaptcha, onError }), {
    initialProps: { onError: () => { firstErrors += 1; } },
  });
  await hook.rerender({ onError: () => { nextErrors += 1; } });
  assert.equal(calls, 1);
  for (const [wait, expectedCalls] of [[1_000, 2], [2_000, 3], [4_000, 4], [8_000, 5], [16_000, 6], [30_000, 7], [30_000, 8]]) {
    await rntl.act(() => { t.mock.timers.tick(wait! - 1); });
    assert.equal(calls, expectedCalls! - 1);
    await rntl.act(() => { t.mock.timers.tick(1); });
    assert.equal(calls, expectedCalls);
  }
  assert.equal(firstErrors, 1);
  assert.equal(nextErrors, 7);
});

it('새 토큰을 기다리던 이전 등록의 늦은 요청 제한도 다음 등록에 적용한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred<Response>();
  const tokens: string[] = [];
  globalThis.fetch = async (_url, init) => {
    tokens.push(JSON.parse(String(init?.body)).nativeToken);
    return tokens.length === 1 ? pending.promise : response(target);
  };
  const api = client();
  await rntl.renderHook(() => useAndroidPushRegistration({ api, authenticated: true, onOpenCaptcha }));
  await rntl.act(() => {
    for (const listener of tokenListeners) listener({ type: 'android', data: 'new-token' });
  });
  await rntl.act(() => {
    const limited = response({ code: 'RATE_LIMITED', message: '잠시 대기' }, 429);
    limited.headers.set('Retry-After', '10');
    pending.resolve(limited);
  });
  assert.deepEqual(tokens, ['native-token']);
  await rntl.act(() => { t.mock.timers.tick(10_000); });
  assert.deepEqual(tokens, ['native-token', 'new-token']);
});

it('첫 네이티브 토큰 조회 실패 뒤 실제 Expo getter가 새 조회를 수행해 등록을 복구한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  nativeTokenFailure = new Error('일시적인 네이티브 토큰 조회 실패');
  let registrations = 0;
  globalThis.fetch = async () => { registrations += 1; return response(target); };
  const api = client();
  const hook = await rntl.renderHook(() => useAndroidPushRegistration({ api, authenticated: true, onOpenCaptcha }));
  assert.equal(tokenRequests, 1);
  assert.equal(registrations, 0);
  await rntl.act(() => { t.mock.timers.tick(1_000); });
  assert.equal(tokenRequests, 2);
  assert.equal(registrations, 1);
  assert.equal(hook.result.current, null);
});
