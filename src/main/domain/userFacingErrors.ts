const BACKEND_CONNECTION_MESSAGE = '서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.';
const UNKNOWN_ERROR_MESSAGE = '알 수 없는 오류가 발생했습니다.';

/**
 * 내부 예외 메시지를 사용자가 이해할 수 있는 문구로 바꾼다.
 *
 * @remarks
 * React Native/OkHttp의 `fetch failed`, `ConnectException` 같은 원문은 앱 사용자에게 직접 보여주지 않는다.
 */
export function toUserFacingErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message);
  }

  if (typeof error === 'string') {
    return sanitizeErrorMessage(error);
  }

  return UNKNOWN_ERROR_MESSAGE;
}

/**
 * 내부 오류 문구를 그대로 보여주기 전에 앱 사용자용 문구로 정리한다.
 */
function sanitizeErrorMessage(message: string): string {
  const normalizedMessage = message.trim();
  if (!normalizedMessage) return UNKNOWN_ERROR_MESSAGE;
  if (isBackendConnectionError(normalizedMessage)) return BACKEND_CONNECTION_MESSAGE;

  return normalizedMessage;
}

/**
 * React Native나 fetch가 던지는 네트워크 연결 실패 메시지인지 판별한다.
 *
 * 원문에는 개발자용 주소와 예외명이 들어가므로 화면에는 공통 연결 실패 문구만 노출한다.
 */
function isBackendConnectionError(message: string): boolean {
  return (
    /fetch failed/i.test(message) ||
    /failed to fetch/i.test(message) ||
    /network request failed/i.test(message) ||
    /connectexception/i.test(message) ||
    /econnrefused/i.test(message) ||
    /10\.0\.2\.2:8080/.test(message)
  );
}
