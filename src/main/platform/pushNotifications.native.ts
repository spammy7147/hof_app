import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { AndroidPushPreparation } from './pushNotifications';
import { routeCaptchaNotificationResponse } from './pushNotificationRouting';

const CHANNEL_ID = 'automation-alerts';
const INSTALLATION_ID_KEY = 'hof.android.installation-id';
type NotificationsModule = typeof import('expo-notifications');
let notificationsModule: NotificationsModule | null = null;

/** Android 알림 권한과 캡차 인증 채널을 준비하고 FCM 네이티브 토큰을 반환한다. */
export async function prepareAndroidPushRegistration(nativeToken?: string): Promise<AndroidPushPreparation> {
  if (Platform.OS !== 'android') return { status: 'unsupported' };
  const Notifications = getNotifications();
  if (!Notifications) return { status: 'unsupported' };

  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: '캡차 인증',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
  });

  const currentPermission = await Notifications.getPermissionsAsync();
  const permission = currentPermission.status === 'undetermined' && currentPermission.canAskAgain
    ? await Notifications.requestPermissionsAsync()
    : currentPermission;
  if (!permission.granted) return { status: 'permission-denied' };

  // 토큰 조회도 변경 이벤트를 발생시키므로 listener가 전달한 토큰은 재조회하지 않는다.
  const token = nativeToken ?? (await Notifications.getDevicePushTokenAsync()).data;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('기기 알림 토큰을 가져오지 못했습니다.');
  }

  return {
    status: 'ready',
    registration: {
      installationId: await getOrCreateInstallationId(),
      nativeToken: token,
    },
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
    if (!routeCaptchaNotificationResponse(response, onOpenCaptcha)) return;
    Notifications.clearLastNotificationResponse();
  };

  handleResponse(Notifications.getLastNotificationResponse());
  const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
  return () => subscription.remove();
}

/** 토큰 교체는 등록 경로가 최신 권한·설치 ID를 확인하고 새 토큰을 연결하게 한다. */
export function subscribeToPushTokenChanges(
  onTokenChanged: (nativeToken: string) => void,
): () => void {
  if (Platform.OS !== 'android') return () => undefined;
  const Notifications = getNotifications();
  if (!Notifications) return () => undefined;

  let active = true;
  const subscription = Notifications.addPushTokenListener((token) => {
    if (!active) return;
    if (typeof token.data !== 'string' || token.data.length === 0) return;
    onTokenChanged(token.data);
  });
  return () => { active = false; subscription.remove(); };
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
