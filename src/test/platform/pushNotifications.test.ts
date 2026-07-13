import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const nativeSource = readFileSync(resolve(process.cwd(), 'src/main/platform/pushNotifications.native.ts'), 'utf8');
const hookSource = readFileSync(resolve(process.cwd(), 'src/main/features/push/useAndroidPushRegistration.ts'), 'utf8');
const appConfig = readFileSync(resolve(process.cwd(), 'app.json'), 'utf8');

describe('Android 직접 푸시 등록', () => {
  it('기기의 네이티브 FCM 토큰을 읽고 Expo push token은 사용하지 않는다', () => {
    assert.match(nativeSource, /getDevicePushTokenAsync/);
    assert.doesNotMatch(nativeSource, /getExpoPushTokenAsync/);
    assert.doesNotMatch(nativeSource, /ExpoPushToken/);
  });

  it('알림 권한과 Android 알림 채널을 준비한다', () => {
    assert.match(nativeSource, /requestPermissionsAsync/);
    assert.match(nativeSource, /setNotificationChannelAsync/);
    assert.match(nativeSource, /캡차 인증/);
  });

  it('FCM 토큰이 교체되면 새 토큰을 다시 등록한다', () => {
    assert.match(nativeSource, /addPushTokenListener/);
    assert.match(hookSource, /subscribeToPushTokenChanges/);
  });

  it('처리한 마지막 알림 응답을 지워 캡차 창이 반복해서 열리지 않게 한다', () => {
    assert.match(nativeSource, /clearLastNotificationResponse/);
    assert.doesNotMatch(nativeSource, /getLastNotificationResponseAsync/);
  });

  it('로그인 뒤 설치 ID와 네이티브 토큰을 백엔드에 등록한다', () => {
    assert.match(hookSource, /registerAndroidPushTarget/);
    assert.match(hookSource, /installationId/);
    assert.match(hookSource, /nativeToken/);
  });

  it('네이티브 빌드에 알림 플러그인과 Firebase 설정 파일을 연결한다', () => {
    assert.match(appConfig, /expo-notifications/);
    assert.match(appConfig, /googleServicesFile/);
  });
});
