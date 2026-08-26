import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useCaptchaPassMaintenance } from '../../../main/features/captcha/useCaptchaPassMaintenance';
import type { BackendApiClient } from '../../../main/services/backendApi';
import type { CaptchaPassMaintenanceResponse } from '../../../main/types/api';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useCaptchaPassMaintenance', () => {
  it('does not let an older poll overwrite a completed setting mutation', async () => {
    const oldPoll = deferred<CaptchaPassMaintenanceResponse>();
    const disabled = state({ enabled: false, lifecycleState: 'DISABLED', lastResult: 'DISABLED' });
    const api = {
      fetchCaptchaPassMaintenance: () => oldPoll.promise,
      updateCaptchaPassMaintenance: async () => disabled,
      refreshCaptchaPassMaintenance: async () => disabled,
    } as unknown as BackendApiClient;
    let pass!: ReturnType<typeof useCaptchaPassMaintenance>;
    const Harness = () => {
      pass = useCaptchaPassMaintenance({ api, authenticated: true, describeError: String });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    await act(async () => { await pass.updateEnabled(false); });
    assert.equal(pass.state?.enabled, false);

    await act(async () => { oldPoll.resolve(state({ enabled: true, lifecycleState: 'VALID' })); });
    assert.equal(pass.state?.enabled, false);
    await act(async () => { renderer.unmount(); });
  });

  it('discards a refresh result that completes after logout', async () => {
    const refresh = deferred<CaptchaPassMaintenanceResponse>();
    const api = {
      fetchCaptchaPassMaintenance: async () => state(),
      updateCaptchaPassMaintenance: async () => state(),
      refreshCaptchaPassMaintenance: () => refresh.promise,
    } as unknown as BackendApiClient;
    let pass!: ReturnType<typeof useCaptchaPassMaintenance>;
    const Harness = ({ authenticated }: { authenticated: boolean }) => {
      pass = useCaptchaPassMaintenance({ api, authenticated, describeError: String });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness, { authenticated: true })); });
    let pending!: Promise<CaptchaPassMaintenanceResponse>;
    await act(async () => { pending = pass.refresh(); });
    await act(async () => { renderer.update(React.createElement(Harness, { authenticated: false })); });
    await act(async () => { refresh.resolve(state({ passState: 'VALID', lifecycleState: 'VALID' })); await pending; });

    assert.equal(pass.state, null);
    assert.equal(pass.busy, false);
    await act(async () => { renderer.unmount(); });
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
