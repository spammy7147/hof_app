import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { makeCaptchaChallenge } from '../../fixtures/api';

class BackendApiError extends Error {}
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request.endsWith('/services/backendApi')) return { BackendApiError };
  return originalLoad(request, parent, isMain);
};
const { useCaptchaGate } = require('../../../main/features/captcha/useCaptchaGate') as
  typeof import('../../../main/features/captcha/useCaptchaGate');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type CaptchaGate = ReturnType<typeof useCaptchaGate>;

describe('useCaptchaGate on-demand preparation', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/main/features/captcha/useCaptchaGate.ts'),
    'utf8',
  );
  const appSource = readFileSync(resolve(process.cwd(), 'src/main/App.tsx'), 'utf8');

  it('prepares the latest captcha when the existing open action starts', () => {
    assert.match(source, /await api\.prepareCurrentCaptcha\(\)/);
    assert.doesNotMatch(source, /await api\.fetchCurrentCaptcha\(\)/);
  });

  it('submits the exact preparation version shown to the user', () => {
    assert.match(
      source,
      /preparationVersion:\s*captcha\.preparationVersion/,
    );
  });

  it('waits after detection and prepares only after the existing button opens authentication', () => {
    assert.doesNotMatch(appSource, /await openCaptchaModal\(\{ blocking: true \}\)/);
    assert.match(source, /pendingResumeRef\.current !== null/);
  });

  it('closes and resumes immediately when preparation finds captcha completed on the original site', async () => {
    let gate!: CaptchaGate;
    const api = {
      prepareCurrentCaptcha: async () => makeCaptchaChallenge({
        status: 'ANSWERED',
        prompt: '캡차 인증이 완료되었습니다.',
        answeredAt: '2026-07-28T00:00:00Z',
      }),
    } as unknown as Parameters<typeof useCaptchaGate>[0]['api'];
    const Harness = () => {
      gate = useCaptchaGate({ authenticated: true, api, describeError: String });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    let resumed = false;

    await act(async () => {
      void gate.waitForResolution().then(() => { resumed = true; });
      await gate.open({ blocking: true });
    });

    assert.equal(gate.visible, false);
    assert.equal(gate.blocking, false);
    assert.equal(gate.captcha, null);
    assert.equal(resumed, true);
    await act(async () => { renderer.unmount(); });
  });
});
