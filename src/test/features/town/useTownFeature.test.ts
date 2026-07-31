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

  it('uses the global CAPTCHA resolution flow for reload and retries the GET once', async () => {
    let calls = 0;
    let resolutions = 0;
    let feature!: ReturnType<typeof useTownFeature<{ value: string }>>;
    const Harness = () => {
      feature = useTownFeature({
        autoLoad: false,
        load: async () => {
          calls += 1;
          if (calls === 1) throw new BackendApiError(409, 'CAPTCHA_REQUIRED', '인증 필요');
          return { value: '갱신' };
        },
        resolveCaptcha: async () => { resolutions += 1; },
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { await feature.reload(); });

    assert.equal(calls, 2);
    assert.equal(resolutions, 1);
    assert.deepEqual(feature.data, { value: '갱신' });
    await act(async () => { renderer.unmount(); });
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

  it('blocks a double submit synchronously and sends only one mutation POST', async () => {
    const request = deferred<unknown>();
    let calls = 0;
    let feature!: ReturnType<typeof useTownFeature<null, { id: string }>>;
    const Harness = () => {
      feature = useTownFeature({
        autoLoad: false,
        load: async () => null,
        submitAction: () => {
          calls += 1;
          return request.promise;
        },
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    let first!: Promise<unknown>;
    await act(async () => { first = feature.submit({ id: 'first' }); });
    const second = feature.submit({ id: 'second' });
    await assert.rejects(second, /이미 처리 중/);
    assert.equal(calls, 1);
    await act(async () => {
      request.resolve({ status: 'SUCCESS', messages: ['완료'] });
      await first;
    });
    assert.deepEqual(feature.result?.messages, ['완료']);
    await act(async () => { renderer.unmount(); });
  });

  it('keeps a successful action result when an overlapping reload completes in reverse order', async () => {
    const loadRequest = deferred<{ value: string }>();
    const submitRequest = deferred<unknown>();
    let feature!: ReturnType<typeof useTownFeature<{ value: string }, { id: string }>>;
    const Harness = () => {
      feature = useTownFeature({
        autoLoad: false,
        load: () => loadRequest.promise,
        submitAction: () => submitRequest.promise,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    let submit!: Promise<unknown>;
    let reload!: Promise<{ value: string }>;
    await act(async () => {
      submit = feature.submit({ id: 'row-1' });
      reload = feature.reload();
    });

    await act(async () => {
      submitRequest.resolve({ status: 'SUCCESS', messages: ['제작 성공'] });
      await submit;
    });
    assert.deepEqual(feature.result?.messages, ['제작 성공']);
    assert.equal(feature.status, 'loading');

    await act(async () => {
      loadRequest.resolve({ value: '최신 목록' });
      await reload;
    });
    assert.deepEqual(feature.result?.messages, ['제작 성공']);
    assert.deepEqual(feature.data, { value: '최신 목록' });
    assert.equal(feature.status, 'ready');
    await act(async () => { renderer.unmount(); });
  });

  it('keeps one destructive mutation while CAPTCHA resolution is shared', async () => {
    const captchaResolution = deferred<void>();
    let calls = 0;
    let resolutions = 0;
    let feature!: ReturnType<typeof useTownFeature<null, { id: string }>>;
    const Harness = () => {
      feature = useTownFeature({
        autoLoad: false,
        load: async () => null,
        submitAction: async () => {
          calls += 1;
          if (calls === 1) throw new BackendApiError(409, 'CAPTCHA_REQUIRED', '인증 필요');
          return { status: 'SUCCESS', messages: ['완료'] };
        },
        resolveCaptcha: () => {
          resolutions += 1;
          return captchaResolution.promise;
        },
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    let first!: Promise<unknown>;
    await act(async () => { first = feature.submit({ id: 'one' }); });
    await act(async () => { await Promise.resolve(); });
    await assert.rejects(feature.submit({ id: 'two' }), /이미 처리 중/);
    assert.equal(calls, 1);
    assert.equal(resolutions, 1);

    await act(async () => {
      captchaResolution.resolve();
      await first;
    });
    assert.equal(calls, 2);
    await act(async () => { renderer.unmount(); });
  });

  it('never retries a destructive mutation after the feature unmounts during CAPTCHA', async () => {
    const captchaResolution = deferred<void>();
    let calls = 0;
    let feature!: ReturnType<typeof useTownFeature<null, { id: string }>>;
    const Harness = () => {
      feature = useTownFeature({
        autoLoad: false,
        featureKey: 'stash',
        load: async () => null,
        submitAction: async () => {
          calls += 1;
          throw new BackendApiError(409, 'CAPTCHA_REQUIRED', '인증 필요');
        },
        resolveCaptcha: () => captchaResolution.promise,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    let submit!: Promise<unknown>;
    await act(async () => { submit = feature.submit({ id: 'box-1' }); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { renderer.unmount(); });
    captchaResolution.resolve();

    await assert.rejects(submit, /취소/);
    assert.equal(calls, 1);
  });

  it('never retries a destructive mutation after the mounted panel changes feature', async () => {
    const captchaResolution = deferred<void>();
    let calls = 0;
    let feature!: ReturnType<typeof useTownFeature<null, { id: string }>>;
    const Harness = ({ featureKey }: { featureKey: string }) => {
      feature = useTownFeature({
        autoLoad: false,
        featureKey,
        load: async () => null,
        submitAction: async () => {
          calls += 1;
          throw new BackendApiError(409, 'CAPTCHA_REQUIRED', '인증 필요');
        },
        resolveCaptcha: () => captchaResolution.promise,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness, { featureKey: 'stash' })); });
    let submit!: Promise<unknown>;
    await act(async () => { submit = feature.submit({ id: 'box-1' }); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { renderer.update(React.createElement(Harness, { featureKey: 'orb' })); });

    captchaResolution.resolve();
    await assert.rejects(submit, /취소/);
    assert.equal(calls, 1);
    await act(async () => { renderer.unmount(); });
  });

  it('hides data owned by the previous feature before the next load settles', async () => {
    const nextLoad = deferred<{ value: string }>();
    const returningLoad = deferred<{ value: string }>();
    let homeLoads = 0;
    let feature!: ReturnType<typeof useTownFeature<{ value: string }>>;
    const Harness = ({ featureKey }: { featureKey: string }) => {
      feature = useTownFeature({
        featureKey,
        load: async () => featureKey === 'home'
          ? ++homeLoads === 1 ? { value: '이전 자택' } : returningLoad.promise
          : nextLoad.promise,
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness, { featureKey: 'home' })); });
    await act(async () => { await Promise.resolve(); });
    assert.deepEqual(feature.data, { value: '이전 자택' });

    await act(async () => { renderer.update(React.createElement(Harness, { featureKey: 'rest' })); });
    assert.equal(feature.data, null);

    await act(async () => {
      nextLoad.resolve({ value: '새 휴식처' });
      await Promise.resolve();
    });
    assert.deepEqual(feature.data, { value: '새 휴식처' });

    await act(async () => { renderer.update(React.createElement(Harness, { featureKey: 'home' })); });
    assert.equal(feature.data, null, '같은 feature key로 돌아와도 이전 세대 data를 재사용하지 않는다');
    await act(async () => {
      returningLoad.resolve({ value: '갱신 자택' });
      await Promise.resolve();
    });
    assert.deepEqual(feature.data, { value: '갱신 자택' });
    await act(async () => { renderer.unmount(); });
  });

  it('does not let a retained reset callback clear a newer feature outcome', async () => {
    let feature!: ReturnType<typeof useTownFeature<null, { id: string }>>;
    const Harness = ({ featureKey }: { featureKey: string }) => {
      feature = useTownFeature({
        autoLoad: false,
        featureKey,
        load: async () => null,
        submitAction: async () => {
          if (featureKey === 'new-error') throw new Error('새 화면 오류');
          return { status: 'SUCCESS', messages: ['새 화면 결과'] };
        },
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness, { featureKey: 'old' })); });
    const retainedReset = feature.resetOutcome;

    await act(async () => { renderer.update(React.createElement(Harness, { featureKey: 'new-error' })); });
    await act(async () => { await feature.submit({ id: 'failure' }).catch(() => undefined); });
    assert.equal(feature.error, '새 화면 오류');
    await act(async () => retainedReset());
    assert.equal(feature.error, '새 화면 오류');

    await act(async () => { renderer.update(React.createElement(Harness, { featureKey: 'new-result' })); });
    await act(async () => { await feature.submit({ id: 'success' }); });
    assert.deepEqual(feature.result?.messages, ['새 화면 결과']);
    await act(async () => retainedReset());
    assert.deepEqual(feature.result?.messages, ['새 화면 결과']);
    await act(async () => { renderer.unmount(); });
  });

  it('fences callbacks retained before leaving and returning to the same feature key', async () => {
    let feature!: ReturnType<typeof useTownFeature<null, { id: string }>>;
    const Harness = ({ featureKey }: { featureKey: string }) => {
      feature = useTownFeature({
        autoLoad: false,
        featureKey,
        load: async () => null,
        submitAction: async () => ({ status: 'SUCCESS', messages: [`${featureKey} 결과`] }),
      });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness, { featureKey: 'home' })); });
    const retainedSubmit = feature.submit;
    const retainedReset = feature.resetOutcome;
    await act(async () => { renderer.update(React.createElement(Harness, { featureKey: 'rest' })); });
    await act(async () => { renderer.update(React.createElement(Harness, { featureKey: 'home' })); });
    await act(async () => { await feature.submit({ id: 'current' }); });
    assert.deepEqual(feature.result?.messages, ['home 결과']);

    await act(async () => retainedReset());
    assert.deepEqual(feature.result?.messages, ['home 결과']);
    await assert.rejects(retainedSubmit({ id: 'stale' }), /취소/);
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
