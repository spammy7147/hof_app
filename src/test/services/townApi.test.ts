import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createTownApi,
  normalizeTownResult,
  normalizeTownRow,
} from '../../main/features/town/api/townApi';

describe('town api', () => {
  it('표시 자료는 실행 식별자와 결과를 제거하고 불완전한 상점 응답으로 덮어쓰지 않는다', async () => {
    let response: unknown = { shopId: 'general', stale: false, items: [{ id: 'private-candidate', label: '표시 품목', selectable: true, detail: null, imageUrl: null, price: 100, quantity: 2 }], actionId: 'private-action', result: { messages: ['private-result'] } };
    const api = createTownApi({ fetchTownResource: async <T,>() => response as T, submitTownAction: async <TRequest, TResponse>(_path: string, _request: TRequest) => ({} as TResponse) });
    await api.load('/api/town/shops/general');
    const before = api.peekPreview('/api/town/shops/general');
    assert.equal(before?.rows[0]?.label, '표시 품목');
    assert.equal(before?.rows[0]?.selectable, false);
    assert.equal(JSON.stringify(before).includes('private-'), false);
    response = { shopId: 'general', stale: false };
    await assert.rejects(api.load('/api/town/shops/general'));
    assert.deepEqual(api.peekPreview('/api/town/shops/general'), before);
    api.dispose();
    assert.equal(api.peekPreview('/api/town/shops/general'), null);
  });
  it('normalizes rows without making display-only rows selectable', () => {
    assert.equal(normalizeTownRow({ id: 'x', label: 'X', selectable: false }).selectable, false);
    assert.equal(normalizeTownRow({ id: 'y', label: 'Y' }).selectable, false);
  });

  it('trims structured result messages and never carries raw HTML fields', () => {
    const normalized = normalizeTownResult({
      status: 'UNKNOWN',
      messages: ['  결과  ', '<html><body>전체 HOF 원문</body></html>', '<b>태그 문구</b>'],
      rawHtml: '<html>비공개</html>',
    });

    assert.deepEqual(normalized.messages, ['결과']);
    assert.equal('rawHtml' in normalized, false);
  });

  it('uses only backend town paths and preserves typed request bodies', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const backend = {
      fetchTownResource: async <T,>(path: `/api/town/${string}`): Promise<T> => {
        calls.push({ method: 'GET', path });
        return { rows: [] } as T;
      },
      submitTownAction: async <TRequest, TResponse>(
        path: `/api/town/${string}`,
        body: TRequest,
      ): Promise<TResponse> => {
        calls.push({ method: 'POST', path, body });
        return { status: 'SUCCESS', messages: ['완료'] } as TResponse;
      },
    };
    const api = createTownApi(backend);

    await api.load<{ rows: [] }>('/api/town/fishing');
    await api.submit<{ candidateId: string }, { status: string }>(
      '/api/town/fishing/catch',
      { candidateId: 'fish-1' },
    );

    assert.deepEqual(calls, [
      { method: 'GET', path: '/api/town/fishing' },
      { method: 'POST', path: '/api/town/fishing/catch', body: { candidateId: 'fish-1' } },
    ]);
  });
});

it('상점 미리보기는 확인 시각과 5분 기한을 보존하고 실패는 재시도를 막지 않는다', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let fail = false;
  const backend = { fetchTownResource: async <T,>() => { if (fail) throw new Error('503'); return { shopId: 'general', items: [], stale: false, lastVerifiedAt: null, result: { messages: ['이전 결과'] } } as T; }, submitTownAction: async <R>() => ({} as R) };
  const api = createTownApi(backend);
  const fresh = await api.load<{ lastVerifiedAt: string }>('/api/town/shops/general');
  assert.equal(fresh.lastVerifiedAt, new Date(1000).toISOString());
  assert.equal(api.peekShop('/api/town/shops/general')?.result, null);
  fail = true;
  await assert.rejects(api.load('/api/town/shops/general'));
  assert.equal(api.peekShop('/api/town/shops/general')?.lastVerifiedAt, fresh.lastVerifiedAt);
  context.mock.timers.setTime(301001);
  assert.equal(api.peekShop('/api/town/shops/general'), null);
  fail = false;
  await api.load('/api/town/shops/general');
});

it('구매 중 시작한 조회도 완료 후 폐기하고 dispose 뒤 새 세대 자료와 섞지 않는다', async () => {
  let finishRead!: (value: unknown) => void; let finishAction!: (value: unknown) => void;
  const api = createTownApi({ fetchTownResource: async () => new Promise((resolve) => { finishRead = resolve; }), submitTownAction: async () => new Promise((resolve) => { finishAction = resolve; }) } as never);
  const action = api.submit('/api/town/shops/general/purchase', {});
  const read = api.load('/api/town/shops/general');
  const rejected = assert.rejects(read, /이전 조회/);
  finishAction({}); await action;
  finishRead({ shopId: 'general', items: [], stale: false }); await rejected;
  assert.equal(api.peekShop('/api/town/shops/general'), null);
  api.dispose();
  await assert.rejects(api.load('/api/town/shops/general'), /로그인 계정/);
  api.activate();
  const next = api.load('/api/town/shops/general');
  finishRead({ shopId: 'general', items: [], stale: false });
  await next;
  assert.ok(api.peekShop('/api/town/shops/general'));
});
