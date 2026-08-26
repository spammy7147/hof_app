import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  sessionRecoveryDelaySeconds,
  useAppSessionLifecycle,
  type AppSessionLifecycle,
  type SessionLifecycleClient,
  type SessionRefreshEvent,
} from '../../../main/features/auth/useAppSessionLifecycle';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useAppSessionLifecycle', () => {
  it('starts session restoration only once when the harness rerenders', async () => {
    const client = fakeClient();
    let lifecycle!: AppSessionLifecycle;
    const Harness = ({ marker }: { marker: number }) => {
      lifecycle = useAppSessionLifecycle(client.api);
      return React.createElement('marker', { marker });
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness, { marker: 1 })); });
    await act(async () => { renderer.update(React.createElement(Harness, { marker: 2 })); });

    assert.equal(client.restoreCalls, 1);
    assert.equal(lifecycle.state.kind, 'RESTORING');

    await act(async () => { client.emit({ type: 'refresh-succeeded' }); });
    assert.deepEqual(lifecycle.state, { kind: 'AUTHENTICATED', generation: 1 });
    await act(async () => { renderer.unmount(); });
  });

  it('keeps a transient refresh failure in recovery instead of logging out', async () => {
    const client = fakeClient();
    let lifecycle!: AppSessionLifecycle;
    const Harness = () => {
      lifecycle = useAppSessionLifecycle(client.api);
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => {
      client.emit({ type: 'refresh-succeeded' });
      client.emit({
        type: 'refresh-failed',
        error: apiError(429, 'RATE_LIMITED', 37),
      });
    });

    assert.equal(lifecycle.state.kind, 'RECOVERY_WAITING');
    if (lifecycle.state.kind !== 'RECOVERY_WAITING') throw new Error('Expected recovery waiting');
    assert.equal(lifecycle.state.generation, 1);
    assert.equal(lifecycle.state.retryDelaySeconds, 37);
    assert.equal(client.mutationsBlocked, true);
    assert.equal(client.clearCalls, 0);

    await act(async () => { client.emit({ type: 'refresh-succeeded' }); });
    assert.deepEqual(lifecycle.state, { kind: 'AUTHENTICATED', generation: 1 });
    assert.equal(client.mutationsBlocked, false);
    await act(async () => { renderer.unmount(); });
  });

  it('ends the login generation only when refresh credentials are invalid', async () => {
    const client = fakeClient();
    let lifecycle!: AppSessionLifecycle;
    const Harness = () => {
      lifecycle = useAppSessionLifecycle(client.api);
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => {
      client.emit({ type: 'refresh-succeeded' });
      client.emit({ type: 'refresh-failed', error: apiError(401, 'REFRESH_TOKEN_REUSED') });
      await Promise.resolve();
    });

    assert.equal(client.clearCalls, 1);
    assert.deepEqual(lifecycle.state, { kind: 'UNAUTHENTICATED', errorMessage: null });
    await act(async () => { renderer.unmount(); });
  });

  it('creates a new generation for each successful explicit login', async () => {
    const client = fakeClient();
    let lifecycle!: AppSessionLifecycle;
    const Harness = () => {
      lifecycle = useAppSessionLifecycle(client.api);
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { client.emit({ type: 'refresh-failed', error: apiError(401, 'AUTH_TOKEN_INVALID') }); });
    await act(async () => { await lifecycle.login('first', 'password'); });
    assert.deepEqual(lifecycle.state, { kind: 'AUTHENTICATED', generation: 1 });

    await act(async () => { await lifecycle.endForAccountSwitch(); });
    await act(async () => { await lifecycle.login('second', 'password'); });
    assert.deepEqual(lifecycle.state, { kind: 'AUTHENTICATED', generation: 2 });
    assert.equal(client.loginCalls, 2);
    await act(async () => { renderer.unmount(); });
  });

  it('keeps a failed explicit logout in recovery until the server family is revoked', async () => {
    const client = fakeClient();
    let lifecycle!: AppSessionLifecycle;
    const Harness = () => {
      lifecycle = useAppSessionLifecycle(client.api);
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { client.emit({ type: 'refresh-succeeded' }); });
    client.failLogout(apiError(503, 'SERVICE_UNAVAILABLE'));

    await act(async () => { await lifecycle.logout(); });

    assert.equal(lifecycle.state.kind, 'RECOVERY_WAITING');
    if (lifecycle.state.kind !== 'RECOVERY_WAITING') throw new Error('Expected recovery waiting');
    assert.equal(lifecycle.state.generation, null);
    assert.equal(client.logoutCalls, 1);
    assert.equal(client.mutationsBlocked, true);
    await act(async () => { renderer.unmount(); });
  });

  it('uses Retry-After first and then the agreed bounded backoff', () => {
    assert.equal(sessionRecoveryDelaySeconds(0, 19), 19);
    assert.deepEqual(
      Array.from({ length: 8 }, (_, attempt) => sessionRecoveryDelaySeconds(attempt, null)),
      [1, 2, 5, 10, 30, 60, 60, 60],
    );
  });
});

function fakeClient() {
  let listener: ((event: SessionRefreshEvent) => void) | null = null;
  const state = {
    restoreCalls: 0,
    loginCalls: 0,
    logoutCalls: 0,
    clearCalls: 0,
    mutationsBlocked: false,
    logoutError: null as unknown,
  };
  const api: SessionLifecycleClient = {
    async restoreSession() { state.restoreCalls += 1; },
    async login() {
      state.loginCalls += 1;
      return { accessToken: 'access' };
    },
    async logout() {
      state.logoutCalls += 1;
      if (state.logoutError) throw state.logoutError;
    },
    async clearLocalSession() { state.clearCalls += 1; },
    subscribeSessionRefreshEvents(next) {
      listener = next;
      return () => { listener = null; };
    },
    setSessionMutationsBlocked(blocked) { state.mutationsBlocked = blocked; },
  };
  return {
    api,
    emit(event: SessionRefreshEvent) { listener?.(event); },
    failLogout(error: unknown) { state.logoutError = error; },
    get restoreCalls() { return state.restoreCalls; },
    get loginCalls() { return state.loginCalls; },
    get logoutCalls() { return state.logoutCalls; },
    get clearCalls() { return state.clearCalls; },
    get mutationsBlocked() { return state.mutationsBlocked; },
  };
}

function apiError(statusCode: number, code: string, retryAfterSeconds: number | null = null) {
  return { statusCode, code, retryAfterSeconds, message: code };
}
