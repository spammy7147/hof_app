import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  prepareAndroidPushRegistration,
  subscribeToCaptchaNotification,
  subscribeToPushTokenChanges,
} from '../../platform/pushNotifications';
import { BackendApiError, type BackendApiClient } from '../../services/backendApi';

type Options = {
  api: BackendApiClient;
  authenticated: boolean;
  onOpenCaptcha: () => void;
  onError?: (error: unknown) => void;
};

/** 로그인 계정에 Android FCM 네이티브 토큰을 연결하고 캡차 알림 탭을 구독한다. */
export function useAndroidPushRegistration({
  api,
  authenticated,
  onOpenCaptcha,
  onError,
}: Options): string | null {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const callbacks = useRef({ onOpenCaptcha, onError });
  useLayoutEffect(() => { callbacks.current = { onOpenCaptcha, onError }; }, [onOpenCaptcha, onError]);
  useEffect(() => {
    setErrorMessage(null);
    if (!authenticated) return;
    let cancelled = false;
    let retryDelay = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let waitingForServer = false;
    let requestVersion = 0;
    let requestedToken: string | undefined;
    let running = false;
    let queued = false;

    function requestRegistration(nativeToken?: string) {
      if (cancelled) return;
      requestedToken = nativeToken;
      requestVersion += 1;
      if (waitingForServer) return;
      if (retryTimer != null) clearTimeout(retryTimer);
      retryTimer = null;
      if (running) { queued = true; return; }
      void register();
    }
    async function register() {
      running = true;
      const version = requestVersion;
      const receivedToken = requestedToken;
      const isCurrent = () => !cancelled && version === requestVersion;
      try {
        const preparation = await prepareAndroidPushRegistration(receivedToken);
        if (!isCurrent()) return;
        if (preparation.status !== 'ready') {
          setErrorMessage(preparation.status === 'permission-denied'
            ? '기기 설정에서 알림 권한을 허용하면 캡차 알림을 받을 수 있습니다.'
            : null);
          return;
        }
        const { installationId, nativeToken } = preparation.registration;
        await api.registerAndroidPushTarget({ installationId, nativeToken });
        if (!isCurrent()) return;
        setErrorMessage(null);
        retryDelay = 1_000;
      } catch (error) {
        if (cancelled) return;
        const retryable = !(error instanceof BackendApiError)
          || error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500;
        const serverDelay = retryable && error instanceof BackendApiError ? (error.retryAfterSeconds ?? 0) * 1_000 : 0;
        // 이전 토큰 응답이어도 서버가 정한 대기는 다음 등록에 적용한다.
        if (!isCurrent() && serverDelay <= 0) return;
        if (isCurrent()) {
          setErrorMessage(retryable
            ? '알림을 연결하지 못했습니다. 연결이 복구되면 다시 시도합니다.'
            : '알림을 연결하지 못했습니다. 앱에 다시 돌아오면 연결을 확인합니다.');
          callbacks.current.onError?.(error);
        }
        if (retryable) {
          waitingForServer = serverDelay > 0;
          retryTimer = setTimeout(() => {
            waitingForServer = false;
            queued = false;
            requestRegistration(requestedToken);
          }, Math.max(retryDelay, serverDelay));
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      } finally {
        running = false;
        if (!cancelled && queued && !waitingForServer) { queued = false; void register(); }
      }
    }
    requestRegistration();
    let appState = AppState.currentState;
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const foreground = nextState === 'active' && appState !== 'active';
      appState = nextState;
      if (foreground) { retryDelay = 1_000; requestRegistration(); }
    });
    const unsubscribe = subscribeToCaptchaNotification(() => {
      if (!cancelled) callbacks.current.onOpenCaptcha();
    });
    const unsubscribeTokenChanges = subscribeToPushTokenChanges((nativeToken) => {
      retryDelay = 1_000;
      requestRegistration(nativeToken);
    });
    return () => {
      cancelled = true;
      if (retryTimer != null) clearTimeout(retryTimer);
      appStateSubscription.remove();
      unsubscribe();
      unsubscribeTokenChanges();
    };
  }, [api, authenticated]);
  return errorMessage;
}
