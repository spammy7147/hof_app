import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement(name, { ...props, ref }, props.children as React.ReactNode)
));

let publishNotice: ((message: string | null) => void) | null = null;
const syncCharacters = async () => undefined;
const openCaptcha = async () => undefined;
const waitForCaptcha = async () => undefined;

class BackendApiClientMock {
  async restoreSession() {}
  async fetchStatus() { return { characterSyncRequired: false }; }
  subscribeManualActionState(listener: (pending: boolean) => void) { listener(false); return () => undefined; }
}

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
  if (request.endsWith('/services/backendApi')) return { BackendApiClient: BackendApiClientMock };
  if (request.endsWith('/domain/unifiedAutomationController')) {
    return { UnifiedAutomationController: UnifiedAutomationControllerMock };
  }
  if (request.endsWith('/features/characters/useCharacterSync')) {
    return {
      useCharacterSync: ({ onNotice }: { onNotice: (message: string | null) => void }) => {
        publishNotice = onNotice;
        return {
          characterSyncLabel: null,
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
          deepSync: { status: 'idle', progress: null, errorMessage: null },
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
  if (request.endsWith('/features/push/useAndroidPushRegistration')) {
    return { useAndroidPushRegistration: () => undefined };
  }
  return originalLoad(request, parent, isMain);
};
const { default: App } = require('../../main/App') as typeof import('../../main/App');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

afterEach(() => {
  publishNotice = null;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

describe('App system notice', () => {
  it('dismisses a service connection notice without restarting the app', async () => {
    const timers = fakeTimeouts();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(App));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      publishNotice?.('서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
    });
    assert.equal(mainScreen(renderer).props.notice, '서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');

    await act(async () => { timers.runAll(); });

    assert.equal(mainScreen(renderer).props.notice, null);
    await act(async () => { renderer.unmount(); });
  });
});

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
