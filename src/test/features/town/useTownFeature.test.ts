import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

class BackendApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request.endsWith('/services/backendApi')) return { BackendApiError };
  return originalLoad(request, parent, isMain);
};
const { executeWithCaptchaRetry, useTownFeature } = require(
  '../../../main/features/town/hooks/useTownFeature',
) as typeof import('../../../main/features/town/hooks/useTownFeature');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useTownFeature CAPTCHA retry contract', () => {
  it('waits on the existing global gate and retries the same operation only once', async () => {
    let calls = 0;
    let resolutions = 0;
    const result = await executeWithCaptchaRetry(async () => {
      calls += 1;
      if (calls === 1) throw new BackendApiError(409, 'CAPTCHA_REQUIRED', '인증 필요');
      return '완료';
    }, async () => { resolutions += 1; });

    assert.equal(result, '완료');
    assert.equal(calls, 2);
    assert.equal(resolutions, 1);
  });

  it('does not retry ordinary backend failures', async () => {
    let calls = 0;
    await assert.rejects(() => executeWithCaptchaRetry(async () => {
      calls += 1;
      throw new BackendApiError(400, 'INVALID_REQUEST', '잘못된 요청');
    }, async () => undefined), /잘못된 요청/);
    assert.equal(calls, 1);
  });

  it('exposes idle, loading, ready, submitting, and error states', async () => {
    const loadRequest = deferred<{ value: string }>();
    const submitRequest = deferred<unknown>();
    let feature!: ReturnType<typeof useTownFeature<{ value: string }, { id: string }>>;
    const Harness = () => {
      feature = useTownFeature({
        autoLoad: false,
        load: () => loadRequest.promise,
        submitAction: () => submitRequest.promise,
        describeError: () => '표시 오류',
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    assert.equal(feature.status, 'idle');

    let reloadPromise!: Promise<{ value: string }>;
    await act(async () => { reloadPromise = feature.reload(); });
    assert.equal(feature.status, 'loading');
    await act(async () => {
      loadRequest.resolve({ value: '준비' });
      await reloadPromise;
    });
    assert.equal(feature.status, 'ready');
    assert.deepEqual(feature.data, { value: '준비' });

    let submitPromise!: Promise<unknown>;
    await act(async () => { submitPromise = feature.submit({ id: 'row-1' }); });
    assert.equal(feature.status, 'submitting');
    await act(async () => {
      submitRequest.reject(new Error('server detail'));
      await submitPromise.catch(() => undefined);
    });
    assert.equal(feature.status, 'error');
    assert.equal(feature.error, '표시 오류');
    await act(async () => { renderer.unmount(); });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
