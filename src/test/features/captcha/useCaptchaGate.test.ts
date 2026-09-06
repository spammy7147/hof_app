import assert from 'node:assert/strict';
import Module from 'node:module';
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
  it('감지만으로 준비하지 않고 사용자가 연 최신 version을 제출한 뒤 대기를 재개한다', async () => {
    let gate!: CaptchaGate;
    let preparations = 0;
    const submissions: unknown[] = [];
    const ready = makeCaptchaChallenge({ id: 31, status: 'READY', preparationVersion: 7 });
    const api = {
      prepareCurrentCaptcha: async () => { preparations += 1; return ready; },
      submitCaptchaAnswer: async (id: number, request: unknown) => {
        submissions.push({ id, request });
        return makeCaptchaChallenge({ id, status: 'ANSWERED' });
      },
    } as unknown as Parameters<typeof useCaptchaGate>[0]['api'];
    const Harness = () => {
      gate = useCaptchaGate({ authenticated: true, api, describeError: String });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    try {
      let resumed = false;
      await act(async () => { void gate.waitForResolution().then(() => { resumed = true; }); });
      assert.equal(preparations, 0);
      assert.equal(gate.visible, false);
      assert.equal(resumed, false);
      await act(async () => { await gate.open(); });
      assert.equal(preparations, 1);
      assert.equal(gate.visible, true);
      assert.equal(gate.blocking, true);
      assert.equal(gate.captcha?.preparationVersion, 7);
      await act(async () => { await gate.submitAnswer('  Ab12  '); });
      assert.deepEqual(submissions, [{ id: 31, request: { answer: 'Ab12', preparationVersion: 7 } }]);
      assert.equal(gate.visible, false);
      assert.equal(gate.blocking, false);
      assert.equal(resumed, true);
    } finally {
      await act(async () => { renderer.unmount(); });
    }
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

  it('restarts automatic solving from manual input and resumes after success', async () => {
    let gate!: CaptchaGate;
    let retriedChallengeId: number | null = null;
    const ready = makeCaptchaChallenge({ id: 11, status: 'READY', preparationVersion: 2 });
    const api = {
      prepareCurrentCaptcha: async () => ready,
      retryCaptchaAutomatically: async (challengeId: number) => {
        retriedChallengeId = challengeId;
        return null;
      },
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
    await act(async () => { await gate.retryAutomatic(); });

    assert.equal(retriedChallengeId, 11);
    assert.equal(gate.visible, false);
    assert.equal(gate.captcha, null);
    assert.equal(resumed, true);
    await act(async () => { renderer.unmount(); });
  });
});
