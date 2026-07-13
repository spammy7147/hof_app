import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import type { AndroidPushRegistration } from './pushNotifications';

const CHANNEL_ID = 'automation-alerts';
const INSTALLATION_ID_KEY = 'hof.android.installation-id';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Android 알림 권한과 캡차 인증 채널을 준비하고 FCM 네이티브 토큰을 반환한다. */
export async function prepareAndroidPushRegistration(): Promise<AndroidPushRegistration | null> {
  if (Platform.OS !== 'android') return null;

  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: '캡차 인증',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
  });

  const currentPermission = await Notifications.getPermissionsAsync();
  const permission = currentPermission.granted
    ? currentPermission
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return null;

  const token = await Notifications.getDevicePushTokenAsync();
  if (typeof token.data !== 'string' || token.data.length === 0) return null;

  return {
    installationId: await getOrCreateInstallationId(),
    nativeToken: token.data,
  };
}

/** CAPTCHA_REQUIRED 알림을 누르면 앱 전역 캡차 화면을 연다. */
export function subscribeToCaptchaNotification(onOpenCaptcha: () => void): () => void {
  const handleResponse = (response: Notifications.NotificationResponse | null) => {
    const data = response?.notification.request.content.data;
    if (data?.type !== 'CAPTCHA_REQUIRED') return;
    onOpenCaptcha();
    Notifications.clearLastNotificationResponse();
  };

  handleResponse(Notifications.getLastNotificationResponse());
  const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
  return () => subscription.remove();
}

/** 실행 중 FCM 토큰이 교체되면 백엔드가 즉시 갱신할 수 있도록 전달한다. */
export function subscribeToPushTokenChanges(
  onToken: (registration: AndroidPushRegistration) => void,
): () => void {
  if (Platform.OS !== 'android') return () => undefined;
  const subscription = Notifications.addPushTokenListener((token) => {
    if (typeof token.data !== 'string' || token.data.length === 0) return;
    void getOrCreateInstallationId().then((installationId) => {
      onToken({ installationId, nativeToken: token.data as string });
    });
  });
  return () => subscription.remove();
}

async function getOrCreateInstallationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  if (existing) return existing;

  const generated = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `android-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, generated);
  return generated;
}
