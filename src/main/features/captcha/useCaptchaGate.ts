import { useCallback, useEffect, useRef, useState } from 'react';

import { isCaptchaPending, isCaptchaResolved } from '../../domain/captchaGate';
import type { BackendApiClient } from '../../services/backendApi';
import type { CaptchaChallengeResponse } from '../../types/api';

type PendingBattleResume = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type UseCaptchaGateOptions = {
  authenticated: boolean;
  api: BackendApiClient;
  describeError: (error: unknown) => string;
};

/**
 * 앱 전역 캡차 모달과 중단된 전투의 재개 Promise를 한 생명주기로 관리한다.
 *
 * blocking 모드는 전투가 `CAPTCHA_REQUIRED`를 받은 경우에만 사용한다. 인증 성공 시 대기 Promise를
 * resolve해 동일 요청을 한 번 재시도하고, 조회 실패·로그아웃 시 reject해 호출자가 무한 대기하지 않게 한다.
 */
export function useCaptchaGate({ authenticated, api, describeError }: UseCaptchaGateOptions) {
  const [visible, setVisible] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaChallengeResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAutoSolving, setIsAutoSolving] = useState(false);
  const pendingResumeRef = useRef<PendingBattleResume | null>(null);

  /** 이미 대기 중인 전투가 있으면 같은 Promise를 반환해 중복 retry 흐름을 만들지 않는다. */
  const waitForResolution = useCallback((): Promise<void> => {
    if (pendingResumeRef.current) return pendingResumeRef.current.promise;

    let resolveWaiter: () => void = () => undefined;
    let rejectWaiter: (error: unknown) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolveWaiter = resolve;
      rejectWaiter = reject;
    });
    pendingResumeRef.current = { promise, resolve: resolveWaiter, reject: rejectWaiter };
    return promise;
  }, []);

  const resolvePending = useCallback(() => {
    const pending = pendingResumeRef.current;
    pendingResumeRef.current = null;
    pending?.resolve();
  }, []);

  const rejectPending = useCallback((error: unknown) => {
    const pending = pendingResumeRef.current;
    pendingResumeRef.current = null;
    pending?.reject(error);
  }, []);

  /** 인증 시작 시 최신 캡차 snapshot을 준비하고, 필요하면 닫을 수 없는 blocking 모달로 연다. */
  const open = useCallback(async (options?: { blocking?: boolean }) => {
    const nextBlocking = options?.blocking === true || pendingResumeRef.current !== null;
    setVisible(true);
    setBlocking((current) => current || nextBlocking);
    setMessage(null);
    setErrorMessage(null);
    setCaptcha(null);

    if (!authenticated) {
      const error = new Error('로그인 계정이 없습니다.');
      setErrorMessage(error.message);
      if (nextBlocking) {
        setBlocking(false);
        rejectPending(error);
      }
      return;
    }

    setIsLoading(true);
    try {
      const preparedCaptcha = await api.prepareCurrentCaptcha();
      if (isCaptchaResolved(preparedCaptcha)) {
        setCaptcha(null);
        setVisible(false);
        setBlocking(false);
        setMessage('캡차 인증이 완료되었습니다.');
        resolvePending();
        return;
      }
      setCaptcha(preparedCaptcha);
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsLoading(false);
    }
  }, [api, authenticated, describeError, rejectPending, resolvePending]);

  /** blocking 중 닫기 요청은 거절하고, 일반 조회 모달만 상태를 정리해 닫는다. */
  const close = useCallback(() => {
    if (blocking) {
      setErrorMessage('캡차 인증을 완료해야 계속할 수 있습니다.');
      return;
    }
    setVisible(false);
    setBlocking(false);
    setCaptcha(null);
    setMessage(null);
    setErrorMessage(null);
  }, [blocking]);

  /** 사용자 답안을 현재 challenge form에 제출하고 pending이면 새 이미지로, 성공이면 전투 재개로 전환한다. */
  const submitAnswer = useCallback(async (answer: string): Promise<boolean> => {
    const trimmedAnswer = answer.trim();
    if (!authenticated) {
      setErrorMessage('로그인 계정이 없습니다.');
      return false;
    }
    if (captcha == null) {
      setErrorMessage('제출할 캡차가 없습니다.');
      return false;
    }
    if (!trimmedAnswer) {
      setErrorMessage('보안문자를 입력하세요.');
      return false;
    }

    setIsSubmitting(true);
    setMessage(null);
    setErrorMessage(null);
    try {
      const response = await api.submitCaptchaAnswer(captcha.id, {
        answer: trimmedAnswer,
        preparationVersion: captcha.preparationVersion,
      });
      if (isCaptchaPending(response)) {
        setCaptcha(response);
        setMessage('캡차 인증이 아직 완료되지 않았습니다. 다시 입력하세요.');
        return true;
      }
      if (isCaptchaResolved(response)) {
        setCaptcha(null);
        setVisible(false);
        setBlocking(false);
        setMessage('캡차 인증이 완료되었습니다.');
        resolvePending();
        return true;
      }
      return false;
    } catch (error) {
      setErrorMessage(describeError(error));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [api, authenticated, captcha, describeError, resolvePending]);

  /** 수동 입력으로 전환된 현재 challenge에 대해 자동 인식 횟수를 새로 시작한다. */
  const retryAutomatic = useCallback(async (): Promise<void> => {
    if (!authenticated) {
      setErrorMessage('로그인 계정이 없습니다.');
      return;
    }
    if (captcha == null) {
      setErrorMessage('자동 인식할 캡차가 없습니다.');
      return;
    }

    setIsAutoSolving(true);
    setMessage(null);
    setErrorMessage(null);
    try {
      const response = await api.retryCaptchaAutomatically(captcha.id);
      if (isCaptchaResolved(response)) {
        setCaptcha(null);
        setVisible(false);
        setBlocking(false);
        setMessage('캡차 자동 인증이 완료되었습니다.');
        resolvePending();
        return;
      }
      setCaptcha(response);
      setMessage('자동 인식을 완료하지 못했습니다. 직접 입력하거나 다시 시도해 주세요.');
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsAutoSolving(false);
    }
  }, [api, authenticated, captcha, describeError, resolvePending]);

  /** 로그아웃 시 모달 상태와 대기 중 전투를 모두 종료한다. */
  const reset = useCallback((error: unknown) => {
    rejectPending(error);
    setVisible(false);
    setBlocking(false);
    setCaptcha(null);
    setMessage(null);
    setErrorMessage(null);
    setIsLoading(false);
    setIsSubmitting(false);
    setIsAutoSolving(false);
  }, [rejectPending]);

  useEffect(() => () => {
    const pending = pendingResumeRef.current;
    pendingResumeRef.current = null;
    pending?.reject(new Error('로그인 계정이 변경되었습니다.'));
  }, []);

  return {
    visible,
    blocking,
    captcha,
    message,
    errorMessage,
    isLoading,
    isSubmitting,
    isAutoSolving,
    open,
    close,
    submitAnswer,
    retryAutomatic,
    waitForResolution,
    reset,
  };
}
