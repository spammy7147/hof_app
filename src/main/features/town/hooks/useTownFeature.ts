import { useCallback, useEffect, useRef, useState } from 'react';

import { isCaptchaRequiredError } from '../../../domain/captchaGate';
import type { TownActionResultResponse } from '../../../types/api';
import { normalizeTownResult } from '../api/townApi';

export type TownFeatureStatus = 'idle' | 'loading' | 'ready' | 'submitting' | 'error';

type UseTownFeatureOptions<TData, TRequest> = {
  load: () => Promise<TData>;
  submitAction?: (request: TRequest) => Promise<unknown>;
  resolveCaptcha?: () => Promise<void>;
  describeError?: (error: unknown) => string;
  autoLoad?: boolean;
  /** 같은 panel instance가 다른 기능을 표시할 때 이전 요청과 CAPTCHA 재개를 폐기한다. */
  featureKey?: string;
};

export class TownMutationBusyError extends Error {
  constructor() {
    super('다른 마을 작업을 이미 처리 중입니다. 완료 후 다시 시도해 주세요.');
    this.name = 'TownMutationBusyError';
  }
}

export class TownRequestCancelledError extends Error {
  constructor() {
    super('화면을 벗어나 마을 요청이 취소되었습니다.');
    this.name = 'TownRequestCancelledError';
  }
}

/**
 * 마을 기능의 조회와 mutation 상태를 독립적으로 관리한다.
 * 조회와 mutation 모두 전역 CAPTCHA gate를 공유하지만 destructive mutation은 동시에 하나만 허용한다.
 */
export function useTownFeature<TData, TRequest = never>({
  load,
  submitAction,
  resolveCaptcha,
  describeError = defaultDescribeError,
  autoLoad = true,
  featureKey,
}: UseTownFeatureOptions<TData, TRequest>) {
  const [status, setStatus] = useState<TownFeatureStatus>('idle');
  const [data, setData] = useState<TData | null>(null);
  const [result, setResult] = useState<TownActionResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lifecycleRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const latestLoadPendingRef = useRef(false);
  const mutationSequenceRef = useRef(0);
  const mutationBusyRef = useRef(false);
  const featureKeyRef = useRef(featureKey);
  const loadRef = useRef(load);
  const submitActionRef = useRef(submitAction);
  const resolveCaptchaRef = useRef(resolveCaptcha);
  const describeErrorRef = useRef(describeError);
  featureKeyRef.current = featureKey;
  loadRef.current = load;
  submitActionRef.current = submitAction;
  resolveCaptchaRef.current = resolveCaptcha;
  describeErrorRef.current = describeError;

  const reload = useCallback((): Promise<TData> => {
    if (featureKeyRef.current !== featureKey) {
      return Promise.reject(new TownRequestCancelledError());
    }
    const lifecycle = lifecycleRef.current;
    const loadSequence = ++loadSequenceRef.current;
    latestLoadPendingRef.current = true;
    if (!mutationBusyRef.current) setStatus('loading');
    setError(null);

    const isCancelled = () => (
      lifecycle !== lifecycleRef.current
      || featureKey !== featureKeyRef.current
      || loadSequence !== loadSequenceRef.current
    );
    return executeWithCaptchaRetry(
      () => loadRef.current(),
      resolveCaptchaRef.current,
      { isCancelled },
    ).then((nextData) => {
      if (isCancelled()) throw new TownRequestCancelledError();
      latestLoadPendingRef.current = false;
      setData(nextData);
      if (!mutationBusyRef.current) setStatus('ready');
      return nextData;
    }).catch((cause: unknown) => {
      if (!isCancelled()) {
        latestLoadPendingRef.current = false;
        setError(describeErrorRef.current(cause));
        if (!mutationBusyRef.current) setStatus('error');
      }
      throw cause;
    });
  }, [featureKey]);

  /** busy ref를 Promise 생성 전에 선점해 같은 event turn의 double tap도 두 번째 POST를 만들지 않는다. */
  const submit = useCallback((request: TRequest): Promise<TownActionResultResponse> => {
    if (featureKeyRef.current !== featureKey) {
      return Promise.reject(new TownRequestCancelledError());
    }
    if (mutationBusyRef.current) return Promise.reject(new TownMutationBusyError());

    const lifecycle = lifecycleRef.current;
    const mutationSequence = ++mutationSequenceRef.current;
    mutationBusyRef.current = true;
    setStatus('submitting');
    setError(null);

    const isCancelled = () => (
      lifecycle !== lifecycleRef.current
      || featureKey !== featureKeyRef.current
      || mutationSequence !== mutationSequenceRef.current
    );
    const operation = () => {
      if (!submitActionRef.current) throw new Error('이 마을 기능에는 실행할 action이 없습니다.');
      return submitActionRef.current(request);
    };
    let mutationSucceeded = false;

    return executeWithCaptchaRetry(operation, resolveCaptchaRef.current, { isCancelled })
      .then((rawResult) => {
        if (isCancelled()) throw new TownRequestCancelledError();
        const nextResult = normalizeTownResult(rawResult);
        mutationSucceeded = true;
        setResult(nextResult);
        return nextResult;
      })
      .catch((cause: unknown) => {
        if (!isCancelled()) {
          setError(describeErrorRef.current(cause));
          setStatus('error');
        }
        throw cause;
      })
      .finally(() => {
        if (mutationSequence !== mutationSequenceRef.current) return;
        mutationBusyRef.current = false;
        if (!isCancelled()) {
          setStatus(latestLoadPendingRef.current ? 'loading' : mutationSucceeded ? 'ready' : 'error');
        }
      });
  }, [featureKey]);

  const resetOutcome = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  useEffect(() => {
    const lifecycle = ++lifecycleRef.current;
    latestLoadPendingRef.current = false;
    mutationBusyRef.current = false;
    if (autoLoad) void reload().catch(() => undefined);

    return () => {
      if (lifecycleRef.current === lifecycle) lifecycleRef.current += 1;
      loadSequenceRef.current += 1;
      mutationSequenceRef.current += 1;
      latestLoadPendingRef.current = false;
      mutationBusyRef.current = false;
    };
  }, [autoLoad, featureKey, reload]);

  return { status, data, result, error, reload, submit, resetOutcome };
}

type CaptchaRetryOptions = { isCancelled?: () => boolean };

/** CAPTCHA 해결 전후에 cancellation을 검사해 떠난 화면의 destructive action을 재실행하지 않는다. */
export async function executeWithCaptchaRetry<T>(
  operation: () => Promise<T>,
  resolveCaptcha?: () => Promise<void>,
  options: CaptchaRetryOptions = {},
): Promise<T> {
  assertActive(options);
  try {
    const response = await operation();
    assertActive(options);
    return response;
  } catch (error) {
    if (error instanceof TownRequestCancelledError) throw error;
    assertActive(options);
    if (!resolveCaptcha || !isCaptchaRequiredError(error)) throw error;
    await resolveCaptcha();
    assertActive(options);
    const response = await operation();
    assertActive(options);
    return response;
  }
}

function assertActive(options: CaptchaRetryOptions): void {
  if (options.isCancelled?.()) throw new TownRequestCancelledError();
}

function defaultDescribeError(error: unknown): string {
  return error instanceof Error ? error.message : '마을 요청을 처리하지 못했습니다.';
}
