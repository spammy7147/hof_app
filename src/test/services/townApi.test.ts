import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createTownApi,
  normalizeTownResult,
  normalizeTownRow,
} from '../../main/features/town/api/townApi';

describe('town api', () => {
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
