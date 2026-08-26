import { useCallback, useEffect, useRef, useState } from 'react';

export type SessionRefreshEvent =
  | { type: 'refresh-succeeded' }
  | { type: 'refresh-failed'; error: unknown };

export type SessionLifecycleClient = {
  restoreSession: () => Promise<void>;
  login: (request: { loginId: string; password: string }) => Promise<unknown>;
  logout: () => Promise<void>;
  clearLocalSession: () => Promise<void>;
  subscribeSessionRefreshEvents: (listener: (event: SessionRefreshEvent) => void) => () => void;
  setSessionMutationsBlocked: (blocked: boolean) => void;
};

export type AppSessionLifecycleState =
  | { kind: 'RESTORING' }
  | { kind: 'UNAUTHENTICATED'; errorMessage: string | null }
  | { kind: 'AUTHENTICATING' }
  | { kind: 'AUTHENTICATED'; generation: number }
  | {
    kind: 'RECOVERY_WAITING';
    generation: number | null;
    errorMessage: string;
    retryAttempt: number;
    retryDelaySeconds: number;
  }
  | { kind: 'ENDING'; generation: number | null };

export type AppSessionLifecycle = {
  state: AppSessionLifecycleState;
  login: (loginId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  endForAccountSwitch: () => Promise<void>;
  retryRecovery: () => Promise<void>;
};

type SessionApiError = {
  statusCode?: unknown;
  code?: unknown;
  retryAfterSeconds?: unknown;
  message?: unknown;
};

const RECOVERY_DELAYS_SECONDS = [1, 2, 5, 10, 30, 60] as const;
const CREDENTIAL_INVALID_CODES = new Set(['AUTH_TOKEN_INVALID', 'REFRESH_TOKEN_REUSED']);

/** 인증 복원과 로그인 세대의 시작·복구·종료를 직렬화한다. */
export function useAppSessionLifecycle(api: SessionLifecycleClient): AppSessionLifecycle {
  const [state, setState] = useState<AppSessionLifecycleState>({ kind: 'RESTORING' });
  const stateRef = useRef(state);
  const generationRef = useRef(0);
  const restoreStartedRef = useRef(false);
  const mountedRef = useRef(true);

  const transition = useCallback((next: AppSessionLifecycleState) => {
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }, []);

  const authenticated = useCallback((generation?: number) => {
    const nextGeneration = generation ?? generationRef.current + 1;
    generationRef.current = Math.max(generationRef.current, nextGeneration);
    transition({ kind: 'AUTHENTICATED', generation: nextGeneration });
  }, [transition]);

  const endInvalidSession = useCallback(async () => {
    const current = stateRef.current;
    const generation = current.kind === 'AUTHENTICATED' || current.kind === 'RECOVERY_WAITING'
      ? current.generation
      : null;
    transition({ kind: 'ENDING', generation });
    await api.clearLocalSession();
    transition({ kind: 'UNAUTHENTICATED', errorMessage: null });
  }, [api, transition]);

  const handleRefreshFailure = useCallback((error: unknown) => {
    if (isCredentialInvalid(error)) {
      void endInvalidSession();
      return;
    }

    const current = stateRef.current;
    const generation = current.kind === 'AUTHENTICATED'
      ? current.generation
      : current.kind === 'RECOVERY_WAITING'
        ? current.generation
        : null;
    const retryAttempt = current.kind === 'RECOVERY_WAITING' ? current.retryAttempt + 1 : 0;
    transition({
      kind: 'RECOVERY_WAITING',
      generation,
      errorMessage: errorMessage(error),
      retryAttempt,
      retryDelaySeconds: sessionRecoveryDelaySeconds(retryAttempt, retryAfterSeconds(error)),
    });
  }, [endInvalidSession, transition]);

  useEffect(() => api.subscribeSessionRefreshEvents((event) => {
    if (event.type === 'refresh-failed') {
      handleRefreshFailure(event.error);
      return;
    }

    const current = stateRef.current;
    if (current.kind === 'RESTORING') {
      authenticated();
    } else if (current.kind === 'RECOVERY_WAITING') {
      authenticated(current.generation ?? undefined);
    }
  }), [api, authenticated, handleRefreshFailure]);

  useEffect(() => {
    if (restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    void api.restoreSession().catch(() => undefined);
  }, [api]);

  useEffect(() => {
    api.setSessionMutationsBlocked(state.kind === 'RECOVERY_WAITING' || state.kind === 'ENDING');
  }, [api, state.kind]);

  const retryRecovery = useCallback(async () => {
    if (stateRef.current.kind !== 'RECOVERY_WAITING') return;
    await api.restoreSession().catch(() => undefined);
  }, [api]);

  useEffect(() => {
    if (state.kind !== 'RECOVERY_WAITING') return undefined;
    const timeoutId = setTimeout(() => { void retryRecovery(); }, state.retryDelaySeconds * 1_000);
    return () => clearTimeout(timeoutId);
  }, [retryRecovery, state]);

  const login = useCallback(async (loginId: string, password: string) => {
    transition({ kind: 'AUTHENTICATING' });
    try {
      await api.login({ loginId, password });
      authenticated();
    } catch (error) {
      transition({ kind: 'UNAUTHENTICATED', errorMessage: errorMessage(error) });
      throw error;
    }
  }, [api, authenticated, transition]);

  const endSession = useCallback(async () => {
    const current = stateRef.current;
    const generation = current.kind === 'AUTHENTICATED' || current.kind === 'RECOVERY_WAITING'
      ? current.generation
      : null;
    transition({ kind: 'ENDING', generation });
    try {
      await api.logout();
      transition({ kind: 'UNAUTHENTICATED', errorMessage: null });
    } catch (error) {
      handleRefreshFailure(error);
    }
  }, [api, handleRefreshFailure, transition]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      api.setSessionMutationsBlocked(false);
    };
  }, [api]);

  return {
    state,
    login,
    logout: endSession,
    endForAccountSwitch: endSession,
    retryRecovery,
  };
}

export function sessionRecoveryDelaySeconds(
  retryAttempt: number,
  retryAfter: number | null,
): number {
  if (retryAfter != null && Number.isFinite(retryAfter) && retryAfter >= 0) return Math.ceil(retryAfter);
  return RECOVERY_DELAYS_SECONDS[Math.min(Math.max(0, retryAttempt), RECOVERY_DELAYS_SECONDS.length - 1)] ?? 60;
}

function isCredentialInvalid(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as SessionApiError;
  return candidate.statusCode === 401 && typeof candidate.code === 'string' && CREDENTIAL_INVALID_CODES.has(candidate.code);
}

function retryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as SessionApiError).retryAfterSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as SessionApiError).message === 'string') {
    return (error as SessionApiError).message as string;
  }
  return '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
