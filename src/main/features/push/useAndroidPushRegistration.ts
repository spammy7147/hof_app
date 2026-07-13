import { useEffect } from 'react';

import {
  prepareAndroidPushRegistration,
  subscribeToCaptchaNotification,
  subscribeToPushTokenChanges,
} from '../../platform/pushNotifications';
import type { BackendApiClient } from '../../services/backendApi';

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
}: Options): void {
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;

    void prepareAndroidPushRegistration()
      .then((registration) => {
        if (cancelled || !registration) return;
        const { installationId, nativeToken } = registration;
        return api.registerAndroidPushTarget({ installationId, nativeToken });
      })
      .catch((error: unknown) => {
        if (!cancelled) onError?.(error);
      });

    const unsubscribe = subscribeToCaptchaNotification(onOpenCaptcha);
    const unsubscribeTokenChanges = subscribeToPushTokenChanges((registration) => {
      const { installationId, nativeToken } = registration;
      void api.registerAndroidPushTarget({ installationId, nativeToken }).catch((error: unknown) => {
        if (!cancelled) onError?.(error);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeTokenChanges();
    };
  }, [api, authenticated, onError, onOpenCaptcha]);
}
