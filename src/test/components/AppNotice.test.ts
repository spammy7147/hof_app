import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  routeCaptchaNotificationResponse,
  type PushNotificationResponseLike,
} from '../../main/platform/pushNotificationRouting';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement(name, { ...props, ref }, props.children as React.ReactNode)
));

let manualActionListener: ((pending: boolean) => void) | null = null;
let deepSyncStatus = 'idle';
let recoveryBusy = false;
let syncError: string | null = null;
let syncLabel: string | null = null;
let selectPushNotification: ((response: PushNotificationResponseLike) => void) | null = null;
let openCaptchaCalls = 0;
let logoutCalls = 0;
let categoryCalls = 0;
let passReads = 0;
let mutationsBlocked = false;
let clientConstructions = 0;
const categories = [{ id: 'battle_map', name: '전투', description: '' }];
const passState = { enabled: true, passState: 'UNKNOWN', lifecycleState: 'UNKNOWN', userActionRequired: false };
const syncCharacters = async () => undefined;
const openCaptcha = async () => { openCaptchaCalls += 1; };
let captchaWaitCalls = 0;
let captchaResolution: () => Promise<void> = async () => undefined;
const waitForCaptcha = async () => { captchaWaitCalls += 1; return captchaResolution(); };
let battleCalls = 0;
let battleRequests: unknown[] = [];
let battleResponse: () => Promise<unknown> = async () => ({});
class BackendApiError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}

class BackendApiClientMock {
  constructor() { clientConstructions += 1; }
  private refreshListener: ((event: import('../../main/services/backendApi').SessionRefreshEvent) => void) | null = null;
  emit(event: import('../../main/services/backendApi').SessionRefreshEvent) { this.refreshListener?.(event); }
  async fetchBattleCategories() { categoryCalls += 1; return categories; }
  async fetchCaptchaPassMaintenance() { passReads += 1; return passState; }
  async restoreSession() { this.refreshListener?.({ type: 'refresh-succeeded' }); }
  async login() { return { accessToken: 'access' }; }
  async logout() { logoutCalls += 1; }
  async clearLocalSession() {}
  subscribeSessionRefreshEvents(listener: (event: import('../../main/services/backendApi').SessionRefreshEvent) => void) {
    this.refreshListener = listener;
    return () => { this.refreshListener = null; };
  }
  setSessionMutationsBlocked(blocked: boolean) { mutationsBlocked = blocked; }
  async runBattle(request: unknown) { battleCalls += 1; battleRequests.push(request); return battleResponse(); }
  async fetchStatus() { return { characterSyncRequired: false }; }
  subscribeManualActionState(listener: (pending: boolean) => void) { manualActionListener = listener; listener(false); return () => { manualActionListener = null; }; }
}
const backendApiClient = new BackendApiClientMock();

class UnifiedAutomationControllerMock {
  reset() {}
}

type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') {
    return {
      ActivityIndicator: host('ActivityIndicator'),
      Pressable: host('Pressable'),
      StyleSheet: { create: <T,>(styles: T) => styles },
      Text: host('Text'),
      View: host('View'),
    };
  }
  if (request === 'expo-status-bar') return { StatusBar: host('StatusBar') };
  if (request.endsWith('/components/AppProviders')) return { AppProviders: host('AppProviders') };
  if (request.endsWith('/features/update/RequiredUpdateGate')) {
    return { RequiredUpdateGate: ({ children }: { children: React.ReactNode }) => children };
  }
  if (request.endsWith('/components/CaptchaChallengeModal')) return { CaptchaChallengeModal: host('CaptchaChallengeModal') };
  if (request.endsWith('/screens/LoginScreen')) return { LoginScreen: host('LoginScreen') };
  if (request.endsWith('/screens/MainScreen')) return { MainScreen: host('MainScreen') };
  if (request.endsWith('/services/backendApi')) return { BackendApiClient: BackendApiClientMock, BackendApiError };
  if (request.endsWith('/services/appRuntime')) {
    return { getAppBackendApiClient: () => backendApiClient };
  }
  if (request.endsWith('/domain/unifiedAutomationController')) {
    return { UnifiedAutomationController: UnifiedAutomationControllerMock };
  }
  if (request.endsWith('/features/characters/useCharacterSync')) {
    return {
      useCharacterSync: () => {
        return {
          characterSyncLabel: syncLabel,
          characterSyncError: syncError,
          loadSavedCharacters: syncCharacters,
          startAutomaticSyncIfRequired: syncCharacters,
          resetCharacterSync: () => undefined,
        };
      },
    };
  }
  if (request.endsWith('/features/characters/useCharacterManagementHub')) {
    return {
      useCharacterManagementHub: () => ({
        resource: {
          characters: [],
          selectedCharacter: null,
          detail: null,
          isLoading: false,
          errorMessage: null,
          warningMessage: null,
          identityResolution: null,
          patternConflict: null,
          deepSync: { status: deepSyncStatus, recoveryBusy, progress: null, errorMessage: null },
          transfer: {
            status: 'idle', sourceCharacter: null, targetCharacterId: null,
            request: null, preview: null, progress: null, result: null, errorMessage: null,
          },
          actions: {},
        },
        observations: {
          beginRosterObservation: () => () => true,
          observeCharacter: () => true,
        },
      }),
    };
  }
  if (request.endsWith('/features/captcha/useCaptchaGate')) {
    return {
      useCaptchaGate: () => ({
        visible: false,
        blocking: false,
        captcha: null,
        message: null,
        errorMessage: null,
        isLoading: false,
        isSubmitting: false,
        open: openCaptcha,
        close: () => undefined,
        submitAnswer: async () => undefined,
        waitForResolution: waitForCaptcha,
        reset: () => undefined,
      }),
    };
  }
  if (request.endsWith('/platform/pushNotifications')) {
    return {
      prepareAndroidPushRegistration: async () => null,
      subscribeToCaptchaNotification: (onOpenCaptcha: () => void) => {
        selectPushNotification = (response) => {
          routeCaptchaNotificationResponse(response, onOpenCaptcha);
        };
        return () => { selectPushNotification = null; };
      },
      subscribeToPushTokenChanges: () => () => undefined,
    };
  }
  return originalLoad(request, parent, isMain);
};
const { default: App } = require('../../main/App') as typeof import('../../main/App');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

afterEach(() => {
  manualActionListener = null;
  deepSyncStatus = 'idle';
  recoveryBusy = false;
  syncError = null;
  syncLabel = null;
  selectPushNotification = null;
  openCaptchaCalls = 0;
  logoutCalls = 0;
  battleCalls = 0;
  categoryCalls = 0;
  passReads = 0;
  mutationsBlocked = false;
  battleRequests = [];
  captchaResolution = async () => undefined;
  captchaWaitCalls = 0;
  battleResponse = async () => ({});
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

describe('App system notice', () => {
  it('동기화 오류는 별도 화면으로 전달하고 공용 안내에 표시하지 않는다', async () => {
    syncError = '서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.';
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(App)); });
    try {
      assert.equal(mainScreen(renderer).props.characterSyncError, syncError);
      assert.equal(mainScreen(renderer).props.notice, null);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('동기화·복구 진행 중 탐색을 가로막지 않고 일반 요청의 처리 표시는 유지한다', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(App)); });
    try {
      await act(async () => { manualActionListener?.(true); });
      assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '요청 처리 중' }).length > 0);
      syncLabel = '목록 동기화 중';
      await act(async () => { renderer.update(React.createElement(App)); });
      assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '요청 처리 중' }).length, 0);
      syncLabel = null;
      deepSyncStatus = 'running';
      await act(async () => { renderer.update(React.createElement(App)); });
      assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '요청 처리 중' }).length, 0);
      deepSyncStatus = 'failed';
      recoveryBusy = true;
      await act(async () => { renderer.update(React.createElement(App)); });
      assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '요청 처리 중' }).length, 0);
      recoveryBusy = false;
      await act(async () => { renderer.update(React.createElement(App)); });
      assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '요청 처리 중' }).length > 0);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('재렌더와 인증 복구 동안 기능 상태를 유지하고 새 로그인에서는 카테고리를 초기화한다', async () => {
    fakeTimeouts();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(App)); });
    try {
      assert.equal(categoryCalls, 0);
      assert.equal(passReads, 1);
      await act(async () => { await mainScreen(renderer).props.battle.loadCategories(); });
      const first = mainScreen(renderer);
      const run = first.props.battle.run;
      const loadStats = first.props.battle.loadStats;
      await act(async () => { renderer.update(React.createElement(App)); });
      await act(async () => { backendApiClient.emit({ type: 'refresh-failed', error: new TypeError('network unavailable') }); });
      assert.equal(mainScreen(renderer), first);
      assert.equal(mainScreen(renderer).props.battle.categories, categories);
      assert.equal(mainScreen(renderer).props.passMaintenance.state, passState);
      assert.equal(mutationsBlocked, true);
      assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '로그인 상태 복구 중' }).length > 0);
      await act(async () => { backendApiClient.emit({ type: 'refresh-succeeded' }); });
      assert.equal(mainScreen(renderer).props.battle.run, run);
      assert.equal(mainScreen(renderer).props.battle.loadStats, loadStats);
      assert.equal(mutationsBlocked, false);
      assert.equal(categoryCalls, 1);
      assert.equal(passReads, 1);
      await act(async () => { await mainScreen(renderer).props.onOpenLogin(); });
      await act(async () => { await renderer.root.find((node) => String(node.type) === 'LoginScreen').props.onSubmit({ username: 'other', password: 'test' }); });
      assert.deepEqual(mainScreen(renderer).props.battle.categories, []);
      assert.equal(mainScreen(renderer).props.battle.loaded, false);
      assert.equal(categoryCalls, 1);
      assert.equal(passReads, 2);
      assert.equal(clientConstructions, 1);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('ends the current login generation before opening account login', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(App));
      await Promise.resolve();
    });

    await act(async () => { await mainScreen(renderer).props.onOpenLogin(); });

    assert.equal(logoutCalls, 1);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'LoginScreen').length, 1);
    await act(async () => { renderer.unmount(); });
  });

  it('로그인 세대가 끝난 뒤 도착한 전투 캡차 오류로 대기나 재시도를 시작하지 않는다', async () => {
    let rejectBattle!: (error: unknown) => void;
    const response = new Promise<unknown>((_resolve, reject) => { rejectBattle = reject; });
    battleResponse = () => battleCalls === 1 ? response : Promise.resolve({});
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(App)); });
    const pending = mainScreen(renderer).props.battle.run({ categoryId: 'battle_map', mapCode: 'field', characterIds: ['char-1'] });
    const ended = assert.rejects(pending);
    await act(async () => { await mainScreen(renderer).props.onOpenLogin(); });
    await act(async () => {
      rejectBattle(new BackendApiError(409, 'CAPTCHA_REQUIRED', '통행증 필요'));
      await ended;
    });
    assert.equal(captchaWaitCalls, 0);
    assert.equal(battleCalls, 1);
    await act(async () => renderer.unmount());
  });

  it('현재 로그인에서는 캡차 해결 뒤 같은 전투를 한 번만 재시도한다', async () => {
    const result = { outcome: 'VICTORY' };
    battleResponse = async () => {
      if (battleCalls === 1) throw new BackendApiError(409, 'CAPTCHA_REQUIRED', '통행증 필요');
      return result;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(App)); });
    const request = { categoryId: 'battle_map', mapCode: 'field', characterIds: ['char-1'] };
    let received: unknown;
    await act(async () => { received = await mainScreen(renderer).props.battle.run(request); });
    assert.equal(received, result);
    assert.deepEqual(battleRequests, [request, request]);
    assert.equal(captchaWaitCalls, 1);
    await act(async () => renderer.unmount());
  });

  it('캡차 대기 중 계정 전환이 시작되면 늦은 해결 뒤 전투를 재시도하지 않는다', async () => {
    let resolveCaptcha!: () => void;
    const resolution = new Promise<void>((resolve) => { resolveCaptcha = resolve; });
    captchaResolution = () => resolution;
    battleResponse = async () => { throw new BackendApiError(409, 'CAPTCHA_REQUIRED', '통행증 필요'); };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(App)); });
    const pending = mainScreen(renderer).props.battle.run({ categoryId: 'battle_map', mapCode: 'field', characterIds: ['char-1'] });
    const ended = assert.rejects(pending, /로그인 계정이 변경/);
    await act(async () => { await Promise.resolve(); });
    assert.equal(captchaWaitCalls, 1);
    await act(async () => { await mainScreen(renderer).props.onOpenLogin(); });
    await act(async () => { resolveCaptcha(); await ended; });
    assert.equal(battleCalls, 1);
    await act(async () => renderer.unmount());
  });

  it('routes an actual selected CAPTCHA notification response into the existing global modal flow', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(App));
      await Promise.resolve();
    });

    assert.ok(selectPushNotification);
    await act(async () => selectPushNotification?.(notificationResponse('OTHER')));
    assert.equal(openCaptchaCalls, 0);
    await act(async () => selectPushNotification?.(notificationResponse('CAPTCHA_REQUIRED')));

    assert.equal(openCaptchaCalls, 1);
    await act(async () => { renderer.unmount(); });
  });
});

function notificationResponse(type: string): NonNullable<PushNotificationResponseLike> {
  return {
    notification: {
      request: {
        content: { data: { type } },
      },
    },
  };
}

function mainScreen(renderer: ReactTestRenderer) {
  return renderer.root.find((node) => String(node.type) === 'MainScreen');
}

function fakeTimeouts() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  globalThis.setTimeout = ((callback: TimerHandler) => {
    const id = nextId++;
    pending.set(id, callback as () => void);
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    pending.delete(id as unknown as number);
  }) as typeof clearTimeout;
  return {
    runAll: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}
