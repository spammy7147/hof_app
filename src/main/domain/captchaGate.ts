import { BackendApiError } from '../services/backendApi';
import type { CaptchaChallengeResponse } from '../types/api';

const CAPTCHA_REQUIRED_CODE = 'CAPTCHA_REQUIRED';
const CAPTCHA_ACTIVE_STATUSES = new Set(['DETECTED', 'READY', 'PENDING']);

/**
 * 백엔드 에러가 캡차 우선 처리 대상인지 판단한다.
 *
 * @remarks
 * 전투 중 이 값이 true면 전투 흐름을 멈추고 전역 캡차 모달을 먼저 띄운다.
 */
export function isCaptchaRequiredError(error: unknown): boolean {
  return error instanceof BackendApiError && error.code === CAPTCHA_REQUIRED_CODE;
}

/**
 * 현재 캡차가 아직 사용자 입력을 기다리는 상태인지 확인한다.
 */
export function isCaptchaPending(challenge: CaptchaChallengeResponse | null): boolean {
  return challenge != null && CAPTCHA_ACTIVE_STATUSES.has(challenge.status.toUpperCase());
}

/**
 * 캡차가 없거나 이미 완료되어 전투를 다시 진행해도 되는지 확인한다.
 */
export function isCaptchaResolved(challenge: CaptchaChallengeResponse | null): boolean {
  return !isCaptchaPending(challenge);
}
