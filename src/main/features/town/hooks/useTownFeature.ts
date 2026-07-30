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
};

/**
 * 마을 기능의 조회·제출 상태를 한 곳에서 관리한다.
 * CAPTCHA_REQUIRED는 전역 gate의 resolution Promise를 재사용하고 동일 action을 한 번만 재시도한다.
 */
export function useTownFeature<TData, TRequest = never>({
  load,
  submitAction,
  resolveCaptcha,
  describeError = defaultDescribeError,
  autoLoad = true,
}: UseTownFeatureOptions<TData, TRequest>) {
  const [status, setStatus] = useState<TownFeatureStatus>('idle');
  const [data, setData] = useState<TData | null>(null);
  const [result, setResult] = useState<TownActionResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const loadRef = useRef(load);
  const submitActionRef = useRef(submitAction);
  const resolveCaptchaRef = useRef(resolveCaptcha);
  const describeErrorRef = useRef(describeError);
  loadRef.current = load;
  submitActionRef.current = submitAction;
  resolveCaptchaRef.current = resolveCaptcha;
  describeErrorRef.current = describeError;

  const reload = useCallback(async (): Promise<TData> => {
    const generation = ++generationRef.current;
    setStatus('loading');
    setError(null);
    try {
      const nextData = await loadRef.current();
      if (generation === generationRef.current) {
        setData(nextData);
        setStatus('ready');
      }
      return nextData;
    } catch (cause) {
      if (generation === generationRef.current) {
        setError(describeErrorRef.current(cause));
        setStatus('error');
      }
      throw cause;
    }
  }, []);

  const submit = useCallback(async (request: TRequest): Promise<TownActionResultResponse> => {
    const generation = ++generationRef.current;
    setStatus('submitting');
    setError(null);
    try {
      const rawResult = await executeWithCaptchaRetry(
        () => {
          if (!submitActionRef.current) throw new Error('이 마을 기능에는 실행할 action이 없습니다.');
          return submitActionRef.current(request);
        },
        resolveCaptchaRef.current,
      );
      const nextResult = normalizeTownResult(rawResult);
      if (generation === generationRef.current) {
        setResult(nextResult);
        setStatus('ready');
      }
      return nextResult;
    } catch (cause) {
      if (generation === generationRef.current) {
        setError(describeErrorRef.current(cause));
        setStatus('error');
      }
      throw cause;
    }
  }, []);

  useEffect(() => {
    if (autoLoad) void reload().catch(() => undefined);
    return () => { generationRef.current += 1; };
  }, [autoLoad, reload]);

  return { status, data, result, error, reload, submit };
}

export async function executeWithCaptchaRetry<T>(
  operation: () => Promise<T>,
  resolveCaptcha?: () => Promise<void>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!resolveCaptcha || !isCaptchaRequiredError(error)) throw error;
    await resolveCaptcha();
    return operation();
  }
}

function defaultDescribeError(error: unknown): string {
  return error instanceof Error ? error.message : '마을 요청을 처리하지 못했습니다.';
}
