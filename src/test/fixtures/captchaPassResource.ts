import type { CaptchaPassResource } from '../../main/features/captcha/useCaptchaPassMaintenance';
import { canOpenManualPassChallenge, captchaPassWarning } from '../../main/domain/captchaPassMaintenance';

export function makeCaptchaPassResource(overrides: Partial<CaptchaPassResource> = {}): CaptchaPassResource {
  const state = overrides.state ?? null;
  return {
    state, busy: false, errorMessage: null,
    warning: captchaPassWarning(state), manualAvailable: canOpenManualPassChallenge(state),
    load: async () => state,
    refresh: async () => { throw new Error('예상하지 않은 통행증 새로고침'); },
    updateEnabled: async () => { throw new Error('예상하지 않은 통행증 정책 변경'); },
    ...overrides,
  };
}
