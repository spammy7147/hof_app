import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  captchaPassWarning,
  canOpenManualPassChallenge,
  describeCaptchaPassMaintenance,
} from '../../main/domain/captchaPassMaintenance';
import type { CaptchaPassMaintenanceResponse } from '../../main/types/api';

describe('captcha pass maintenance presentation', () => {
  it('enables manual authentication only for a persisted manual-required challenge', () => {
    assert.equal(canOpenManualPassChallenge(state({ passState: 'VALID', manualChallengeId: 7 })), false);
    assert.equal(canOpenManualPassChallenge(state({ passState: 'REQUIRED', manualChallengeId: null })), false);
    assert.equal(canOpenManualPassChallenge(state({ passState: 'REQUIRED', lastResult: 'MANUAL_REQUIRED', manualChallengeId: 7 })), true);
    assert.equal(canOpenManualPassChallenge(state({ passState: 'REQUIRED', lastResult: 'AUTH_SUSPENDED', manualChallengeId: 7 })), true);
  });

  it('explains valid countdown and account policy state', () => {
    const description = describeCaptchaPassMaintenance(state({
      passState: 'VALID',
      remainingSeconds: 1_569,
      validUntil: '2026-08-26T10:26:09Z',
    }));

    assert.equal(description.stateLabel, '유효');
    assert.equal(description.remainingLabel, '26분 9초');
    assert.equal(description.policyLabel, '자동 갱신 사용 중');
  });

  it('shows nonblocking warnings for manual OCR and HOF login handoff only', () => {
    assert.match(captchaPassWarning(state({ lastResult: 'MANUAL_REQUIRED', manualChallengeId: 7 })) ?? '', /직접/);
    assert.match(captchaPassWarning(state({ lastResult: 'OCR_CONFIGURATION_REQUIRED' })) ?? '', /OCR/);
    assert.match(captchaPassWarning(state({ lastResult: 'HOF_LOGIN_REQUIRED' })) ?? '', /로그인/);
    assert.equal(captchaPassWarning(state({ lastResult: 'VALID_CONFIRMED' })), null);
  });
});

function state(overrides: Partial<CaptchaPassMaintenanceResponse> = {}): CaptchaPassMaintenanceResponse {
  return {
    enabled: true,
    authSuspended: false,
    passState: 'UNKNOWN',
    remainingSeconds: null,
    validUntil: null,
    observedAt: null,
    nextRefreshAt: null,
    lastAttemptAt: null,
    lastResult: null,
    manualChallengeId: null,
    lifecycleState: 'UNKNOWN',
    userActionRequired: false,
    ...overrides,
  };
}
