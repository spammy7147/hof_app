export type PushNotificationResponseLike = {
  notification: {
    request: {
      content: {
        data?: Record<string, unknown> | null;
      };
    };
  };
} | null;

/** 실제 알림 응답 중 CAPTCHA_REQUIRED 선택만 앱 전역 캡차 진입으로 전달한다. */
export function routeCaptchaNotificationResponse(
  response: PushNotificationResponseLike,
  onOpenCaptcha: () => void,
): boolean {
  if (response?.notification.request.content.data?.type !== 'CAPTCHA_REQUIRED') return false;
  onOpenCaptcha();
  return true;
}
