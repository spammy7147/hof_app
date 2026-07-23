import assert from 'node:assert/strict';
import Module from 'node:module';
import { after, describe, it } from 'node:test';

import { makeCaptchaChallenge } from '../fixtures/api';

type CaptchaGateModule = typeof import('../../main/domain/captchaGate');
type BackendApiModule = typeof import('../../main/services/backendApi');

const moduleLoader = Module as typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleLoader._load;
moduleLoader._load = function loadWithReactNativeStub(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === 'react-native') {
    return { Platform: { OS: 'ios' } };
  }

  return originalModuleLoad.call(this, request, parent, isMain);
};

let captchaGateModule: Promise<CaptchaGateModule> | null = null;
let backendApiModule: Promise<BackendApiModule> | null = null;

after(() => {
  moduleLoader._load = originalModuleLoad;
});

describe('captcha gate utilities', () => {
  it('requires captcha only for BackendApiError with CAPTCHA_REQUIRED code', async () => {
    const { isCaptchaRequiredError } = await loadCaptchaGate();
    const { BackendApiError } = await loadBackendApi();

    assert.equal(
      isCaptchaRequiredError(new BackendApiError(400, 'CAPTCHA_REQUIRED', 'Captcha answer is required.')),
      true,
    );
  });

  it('does not require captcha for other backend codes or status codes alone', async () => {
    const { isCaptchaRequiredError } = await loadCaptchaGate();
    const { BackendApiError } = await loadBackendApi();

    assert.equal(isCaptchaRequiredError(new BackendApiError(400, 'VALIDATION_FAILED', 'Invalid request.')), false);
    assert.equal(isCaptchaRequiredError(new BackendApiError(400, null, 'Missing code.')), false);
    assert.equal(isCaptchaRequiredError(new BackendApiError(403, 'FORBIDDEN', 'Forbidden.')), false);
  });

  it('does not require captcha for non-backend errors or unknown values', async () => {
    const { isCaptchaRequiredError } = await loadCaptchaGate();

    assert.equal(isCaptchaRequiredError(new Error('boom')), false);
    assert.equal(isCaptchaRequiredError('CAPTCHA_REQUIRED'), false);
    assert.equal(isCaptchaRequiredError(null), false);
  });

  it('treats detected and ready captcha challenges as active case-insensitively', async () => {
    const { isCaptchaPending } = await loadCaptchaGate();

    assert.equal(isCaptchaPending(makeCaptchaChallenge({ status: 'PENDING' })), true);
    assert.equal(isCaptchaPending(makeCaptchaChallenge({ status: 'pending' })), true);
    assert.equal(isCaptchaPending(makeCaptchaChallenge({ status: 'DETECTED' })), true);
    assert.equal(isCaptchaPending(makeCaptchaChallenge({ status: 'ready' })), true);
    assert.equal(isCaptchaPending(makeCaptchaChallenge({ status: 'ANSWERED' })), false);
    assert.equal(isCaptchaPending(null), false);
  });

  it('treats answered or absent captcha challenges as resolved', async () => {
    const { isCaptchaResolved } = await loadCaptchaGate();

    assert.equal(isCaptchaResolved(makeCaptchaChallenge({ status: 'ANSWERED' })), true);
    assert.equal(isCaptchaResolved(null), true);
    assert.equal(isCaptchaResolved(makeCaptchaChallenge({ status: 'PENDING' })), false);
    assert.equal(isCaptchaResolved(makeCaptchaChallenge({ status: 'pending' })), false);
  });
});

function loadCaptchaGate(): Promise<CaptchaGateModule> {
  captchaGateModule ??= import('../../main/domain/captchaGate');
  return captchaGateModule;
}

function loadBackendApi(): Promise<BackendApiModule> {
  backendApiModule ??= import('../../main/services/backendApi');
  return backendApiModule;
}
