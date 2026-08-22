import { useCallback, useEffect, useRef, useState } from 'react';

type BootstrapStatus = { characterSyncRequired: boolean };

export type BootstrapResource<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; value: T }
  | { kind: 'error'; errorMessage: string; retryDelaySeconds: number };

export type AuthenticatedBootstrap = {
  status: BootstrapResource<BootstrapStatus>;
  characters: BootstrapResource<true>;
  retryStatus: () => Promise<void>;
  retryCharacters: () => Promise<void>;
};

type Options = {
  generation: number;
  loadStatus: () => Promise<BootstrapStatus>;
  loadCharacters: () => Promise<void>;
  startAutomaticSyncIfRequired: (required: boolean) => Promise<void>;
  describeError: (error: unknown) => string;
};

const RESOURCE_RETRY_DELAYS_SECONDS = [10, 30, 60] as const;

/** 로그인 세대의 상태와 캐릭터 resource를 서로 독립적으로 준비하고 재시도한다. */
export function useAuthenticatedBootstrap(options: Options): AuthenticatedBootstrap {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const cycleRef = useRef(0);
  const statusAttemptRef = useRef(0);
  const characterAttemptRef = useRef(0);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const characterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<BootstrapResource<BootstrapStatus>>({ kind: 'loading' });
  const [characters, setCharacters] = useState<BootstrapResource<true>>({ kind: 'loading' });

  const clearStatusTimer = useCallback(() => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = null;
  }, []);
  const clearCharacterTimer = useCallback(() => {
    if (characterTimerRef.current) clearTimeout(characterTimerRef.current);
    characterTimerRef.current = null;
  }, []);

  const runStatusRef = useRef<(cycle: number) => Promise<void>>(async () => undefined);
  const runCharactersRef = useRef<(cycle: number) => Promise<void>>(async () => undefined);

  const runStatus = useCallback(async (cycle: number) => {
    clearStatusTimer();
    setStatus({ kind: 'loading' });
    try {
      const value = await optionsRef.current.loadStatus();
      if (cycle !== cycleRef.current) return;
      statusAttemptRef.current = 0;
      setStatus({ kind: 'ready', value });
      await optionsRef.current.startAutomaticSyncIfRequired(value.characterSyncRequired);
    } catch (error) {
      if (cycle !== cycleRef.current) return;
      const attempt = statusAttemptRef.current++;
      const retryDelaySeconds = resourceRetryDelaySeconds(attempt);
      setStatus({
        kind: 'error',
        errorMessage: optionsRef.current.describeError(error),
        retryDelaySeconds,
      });
      statusTimerRef.current = setTimeout(() => {
        void runStatusRef.current(cycle);
      }, retryDelaySeconds * 1_000);
    }
  }, [clearStatusTimer]);

  const runCharacters = useCallback(async (cycle: number) => {
    clearCharacterTimer();
    setCharacters({ kind: 'loading' });
    try {
      await optionsRef.current.loadCharacters();
      if (cycle !== cycleRef.current) return;
      characterAttemptRef.current = 0;
      setCharacters({ kind: 'ready', value: true });
    } catch (error) {
      if (cycle !== cycleRef.current) return;
      const attempt = characterAttemptRef.current++;
      const retryDelaySeconds = resourceRetryDelaySeconds(attempt);
      setCharacters({
        kind: 'error',
        errorMessage: optionsRef.current.describeError(error),
        retryDelaySeconds,
      });
      characterTimerRef.current = setTimeout(() => {
        void runCharactersRef.current(cycle);
      }, retryDelaySeconds * 1_000);
    }
  }, [clearCharacterTimer]);

  runStatusRef.current = runStatus;
  runCharactersRef.current = runCharacters;

  useEffect(() => {
    const cycle = ++cycleRef.current;
    statusAttemptRef.current = 0;
    characterAttemptRef.current = 0;
    void runStatus(cycle);
    void runCharacters(cycle);
    return () => {
      cycleRef.current += 1;
      clearStatusTimer();
      clearCharacterTimer();
    };
  }, [clearCharacterTimer, clearStatusTimer, options.generation, runCharacters, runStatus]);

  const retryStatus = useCallback(
    () => runStatus(cycleRef.current),
    [runStatus],
  );
  const retryCharacters = useCallback(
    () => runCharacters(cycleRef.current),
    [runCharacters],
  );

  return { status, characters, retryStatus, retryCharacters };
}

function resourceRetryDelaySeconds(attempt: number): number {
  return RESOURCE_RETRY_DELAYS_SECONDS[
    Math.min(Math.max(0, attempt), RESOURCE_RETRY_DELAYS_SECONDS.length - 1)
  ] ?? 60;
}
