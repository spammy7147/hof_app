import { useCallback, useEffect, useRef, useState } from 'react';

import type { BackendApiClient } from '../../services/backendApi';
import type { CaptchaPassMaintenanceResponse } from '../../types/api';

type Options = {
  api: BackendApiClient;
  authenticated: boolean;
  describeError: (error: unknown) => string;
};

/** 서버 소유 통행증 정책을 표시하고 앱이 열린 동안 최신 상태를 가볍게 동기화한다. */
export function useCaptchaPassMaintenance({ api, authenticated, describeError }: Options) {
  const [state, setState] = useState<CaptchaPassMaintenanceResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const requestSequence = useRef(0);
  const mutationInFlight = useRef(false);

  const load = useCallback(async (showError = false) => {
    if (mutationInFlight.current) return null;
    const requestGeneration = generation.current;
    const requestId = ++requestSequence.current;
    try {
      const next = await api.fetchCaptchaPassMaintenance();
      if (generation.current === requestGeneration && requestSequence.current === requestId) {
        setState(next);
        if (showError) setErrorMessage(null);
      }
      return next;
    } catch (error) {
      if (
        showError &&
        generation.current === requestGeneration &&
        requestSequence.current === requestId
      ) setErrorMessage(describeError(error));
      throw error;
    }
  }, [api, describeError]);

  useEffect(() => {
    generation.current += 1;
    requestSequence.current += 1;
    if (!authenticated) {
      mutationInFlight.current = false;
      setState(null);
      setErrorMessage(null);
      setBusy(false);
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        await load(false);
      } catch {
        // 백그라운드 표시 동기화 실패는 다음 poll에서 다시 확인한다.
      } finally {
        if (!cancelled) timer = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      generation.current += 1;
      if (timer != null) clearTimeout(timer);
    };
  }, [authenticated, load]);

  const updateEnabled = useCallback(async (enabled: boolean) => {
    const requestGeneration = generation.current;
    const requestId = ++requestSequence.current;
    mutationInFlight.current = true;
    setBusy(true);
    setErrorMessage(null);
    try {
      const next = await api.updateCaptchaPassMaintenance(enabled);
      if (generation.current === requestGeneration && requestSequence.current === requestId) setState(next);
      return next;
    } catch (error) {
      if (generation.current === requestGeneration && requestSequence.current === requestId) {
        setErrorMessage(describeError(error));
      }
      throw error;
    } finally {
      if (generation.current === requestGeneration && requestSequence.current === requestId) {
        mutationInFlight.current = false;
        setBusy(false);
      }
    }
  }, [api, describeError]);

  const refresh = useCallback(async () => {
    const requestGeneration = generation.current;
    const requestId = ++requestSequence.current;
    mutationInFlight.current = true;
    setBusy(true);
    setErrorMessage(null);
    try {
      const next = await api.refreshCaptchaPassMaintenance();
      if (generation.current === requestGeneration && requestSequence.current === requestId) setState(next);
      return next;
    } catch (error) {
      if (generation.current === requestGeneration && requestSequence.current === requestId) {
        setErrorMessage(describeError(error));
      }
      throw error;
    } finally {
      if (generation.current === requestGeneration && requestSequence.current === requestId) {
        mutationInFlight.current = false;
        setBusy(false);
      }
    }
  }, [api, describeError]);

  return { state, errorMessage, busy, load, refresh, updateEnabled };
}

const POLL_INTERVAL_MS = 10_000;
