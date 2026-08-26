import type { CaptchaPassMaintenanceResponse } from '../types/api';

export type CaptchaPassMaintenanceDescription = {
  policyLabel: string;
  lifecycleLabel: string;
  stateLabel: string;
  remainingLabel: string;
  lastResultLabel: string;
};

export function canOpenManualPassChallenge(state: CaptchaPassMaintenanceResponse | null): boolean {
  return state?.passState === 'REQUIRED' && state.manualChallengeId != null;
}

export function captchaPassWarning(state: CaptchaPassMaintenanceResponse | null): string | null {
  switch (state?.lastResult) {
    case 'MANUAL_REQUIRED':
      return '통행증 자동 인식을 완료하지 못했습니다. 눌러서 직접 인증해 주세요.';
    case 'OCR_CONFIGURATION_REQUIRED':
      return '통행증 자동 갱신에 OCR 설정이 필요합니다.';
    case 'HOF_LOGIN_REQUIRED':
      return '통행증 자동 갱신을 계속하려면 HOF 로그인이 필요합니다.';
    default:
      return null;
  }
}

export function describeCaptchaPassMaintenance(
  state: CaptchaPassMaintenanceResponse,
  nowMs = Date.now(),
): CaptchaPassMaintenanceDescription {
  const remainingSeconds = currentRemainingSeconds(state, nowMs);
  return {
    policyLabel: state.authSuspended
      ? '로그인 세션 종료로 일시중단'
      : state.enabled
        ? '자동 갱신 사용 중'
        : '자동 갱신 사용 안 함',
    lifecycleLabel: describeLifecycle(state.lifecycleState),
    stateLabel: state.passState === 'VALID'
      ? '유효'
      : state.passState === 'REQUIRED'
        ? '인증 필요'
        : '미확인',
    remainingLabel: remainingSeconds == null
      ? '확인되지 않음'
      : formatRemaining(remainingSeconds),
    lastResultLabel: describeLastResult(state.lastResult),
  };
}

function currentRemainingSeconds(
  state: CaptchaPassMaintenanceResponse,
  nowMs: number,
): number | null {
  if (state.passState !== 'VALID' || state.validUntil == null) return state.remainingSeconds;
  const validUntilMs = Date.parse(state.validUntil);
  if (!Number.isFinite(validUntilMs)) return state.remainingSeconds;
  return Math.max(0, Math.ceil((validUntilMs - nowMs) / 1_000));
}

function describeLifecycle(state: CaptchaPassMaintenanceResponse['lifecycleState']): string {
  switch (state) {
    case 'DISABLED': return '사용 안 함';
    case 'AUTH_SUSPENDED': return '로그인 세션 종료로 일시중단';
    case 'UNKNOWN': return '상태 미확인';
    case 'VALID': return '통행증 유효';
    case 'CHECK_SCHEDULED': return '상태 확인 예정';
    case 'CHECKING': return '상태 확인 중';
    case 'AUTO_RECOGNIZING': return '자동 인식 중';
    case 'MANUAL_INPUT_REQUIRED': return '직접 인증 필요';
    case 'OCR_CONFIGURATION_REQUIRED': return 'OCR 설정 필요';
    case 'HOF_LOGIN_REQUIRED': return 'HOF 로그인 필요';
    case 'CONNECTION_RETRY_WAIT': return '연결 재확인 대기';
  }
}

export function formatPassTimestamp(value: string | null): string {
  if (value == null) return '없음';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '확인되지 않음';
  return timestamp.toLocaleString('ko-KR');
}

function formatRemaining(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return [hours > 0 ? `${hours}시간` : null, minutes > 0 ? `${minutes}분` : null, `${remainder}초`]
    .filter((part): part is string => part != null)
    .join(' ');
}

function describeLastResult(result: string | null): string {
  switch (result) {
    case 'RENEWED': return '자동 갱신 완료';
    case 'VALID_CONFIRMED': return '유효 상태 확인';
    case 'MANUAL_REQUIRED': return '직접 인증 필요';
    case 'OCR_CONFIGURATION_REQUIRED': return 'OCR 설정 필요';
    case 'HOF_LOGIN_REQUIRED': return 'HOF 로그인 필요';
    case 'RETRY_SCHEDULED': return '네트워크 재시도 대기';
    case 'AUTH_SUSPENDED': return '로그인 세션 종료로 일시중단';
    case 'DISABLED': return '사용자가 자동 갱신을 끔';
    default: return '기록 없음';
  }
}
