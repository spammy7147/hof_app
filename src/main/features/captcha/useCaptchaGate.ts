import { useCallback, useRef, useState } from 'react';

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

  /** 현재 계정의 pending challenge를 읽고, 필요하면 사용자가 닫을 수 없는 blocking 모달로 연다. */
  const open = useCallback(async (options?: { blocking?: boolean }) => {
    const nextBlocking = options?.blocking === true;
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
      const loadedCaptcha = await api.fetchCurrentCaptcha();
      setCaptcha(loadedCaptcha);
      if (loadedCaptcha) return;

      const error = new Error('전투를 계속할 캡차 정보를 찾지 못했습니다.');
      setMessage('대기 중인 캡차가 없습니다.');
      if (nextBlocking) {
        setBlocking(false);
        setErrorMessage(error.message);
        rejectPending(error);
      }
    } catch (error) {
      setErrorMessage(describeError(error));
      if (nextBlocking) {
        setBlocking(false);
        rejectPending(error);
      }
    } finally {
      setIsLoading(false);
    }
  }, [api, authenticated, describeError, rejectPending]);

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
      const response = await api.submitCaptchaAnswer(captcha.id, { answer: trimmedAnswer });
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
  }, [rejectPending]);

  return {
    visible,
    blocking,
    captcha,
    message,
    errorMessage,
    isLoading,
    isSubmitting,
    open,
    close,
    submitAnswer,
    waitForResolution,
    reset,
  };
}
