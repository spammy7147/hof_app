import assert from 'node:assert/strict';
import { BackendApiClient } from '../../main/services/backendApi';

export type FeatureHttpRequest = { path: string; method: string; body: unknown };

/** 기능 HTTP는 제어하되 로그인·Bearer 전송·JSON 처리는 실제 client를 통과한다. */
export async function authenticatedHttp(
  respond: (request: FeatureHttpRequest) => Promise<Response>,
  accessToken = 'screen-loading-fixture-token',
) {
  const requests: FeatureHttpRequest[] = [];
  const client = new BackendApiClient('http://backend.test', {
    load: async () => null,
    save: async () => undefined,
    remove: async () => undefined,
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/auth/login') return jsonResponse({
      accessToken, tokenType: 'Bearer', refreshToken: 'fixture-refresh',
      accessTokenExpiresAt: '2060-01-01T00:00:00Z', refreshTokenExpiresAt: '2060-02-01T00:00:00Z',
    });
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${accessToken}`);
    const request = { path: url.pathname + url.search, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null };
    requests.push(request);
    return respond(request);
  };
  await client.login({ loginId: 'screen-loading-fixture', password: 'fixture-only' });
  return { client, requests };
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
