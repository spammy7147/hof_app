import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { AndroidPushRegistration } from './pushNotifications';

const CHANNEL_ID = 'automation-alerts';
const INSTALLATION_ID_KEY = 'hof.android.installation-id';
type NotificationsModule = typeof import('expo-notifications');
let notificationsModule: NotificationsModule | null = null;

/** Android 알림 권한과 캡차 인증 채널을 준비하고 FCM 네이티브 토큰을 반환한다. */
export async function prepareAndroidPushRegistration(): Promise<AndroidPushRegistration | null> {
  if (Platform.OS !== 'android') return null;
  const Notifications = getNotifications();
  if (!Notifications) return null;

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

/** 로그아웃 시 푸시 등록 훅이 아직 실행되지 않았어도 현재 설치를 식별한다. */
export async function loadAndroidPushInstallationId(): Promise<string | null> {
  return SecureStore.getItemAsync(INSTALLATION_ID_KEY);
}

/** CAPTCHA_REQUIRED 알림을 누르면 앱 전역 캡차 화면을 연다. */
export function subscribeToCaptchaNotification(onOpenCaptcha: () => void): () => void {
  const Notifications = getNotifications();
  if (!Notifications) return () => undefined;

  const handleResponse = (response: import('expo-notifications').NotificationResponse | null) => {
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
  const Notifications = getNotifications();
  if (!Notifications) return () => undefined;

  const subscription = Notifications.addPushTokenListener((token) => {
    if (typeof token.data !== 'string' || token.data.length === 0) return;
    void getOrCreateInstallationId().then((installationId) => {
      onToken({ installationId, nativeToken: token.data as string });
    });
  });
  return () => subscription.remove();
}

/**
 * Android Expo Go는 SDK 53부터 원격 푸시 네이티브 모듈을 제공하지 않는다.
 * 앱 시작 시 정적 import하면 전체 앱이 중단되므로 Expo Go가 아닐 때만 모듈을 평가한다.
 */
function getNotifications(): NotificationsModule | null {
  if (Constants.appOwnership === 'expo') return null;
  if (notificationsModule) return notificationsModule;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  notificationsModule = require('expo-notifications') as NotificationsModule;
  notificationsModule.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  return notificationsModule;
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
