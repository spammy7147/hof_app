export type AndroidPushRegistration = {
  installationId: string;
  nativeToken: string;
};

export type AndroidPushPreparation =
  | { status: 'ready'; registration: AndroidPushRegistration }
  | { status: 'permission-denied' }
  | { status: 'unsupported' };

/** 웹과 미지원 플랫폼에서는 Android 푸시 등록을 건너뛴다. */
export async function prepareAndroidPushRegistration(_nativeToken?: string): Promise<AndroidPushPreparation> {
  return { status: 'unsupported' };
}

/** 웹과 미지원 플랫폼에는 영속 Android 설치 ID가 없다. */
export async function loadAndroidPushInstallationId(): Promise<string | null> {
  return null;
}

/** 웹에서는 네이티브 알림 응답 구독이 없다. */
export function subscribeToCaptchaNotification(_onOpenCaptcha: () => void): () => void {
  return () => undefined;
}

/** 웹에서는 네이티브 push token 변경 이벤트가 없다. */
export function subscribeToPushTokenChanges(
  _onTokenChanged: (nativeToken: string) => void,
): () => void {
  return () => undefined;
}
