import { useCallback, useEffect, useRef, useState } from 'react';

import {
  formatCharacterSyncProgress,
  shouldCloseCharacterSyncSubscription,
  upsertCharacterFromSyncEvent,
} from '../../domain/characterSyncJobs';
import type { BackendApiClient } from '../../services/backendApi';
import type { SseSubscription } from '../../services/sseClient';
import type {
  CharacterSyncEventResponse,
  CharacterSyncJobResponse,
  HofCharacter,
  HofObservedStatusResponse,
} from '../../types/api';
import { shouldStartAutomaticCharacterSync } from '../../domain/characterSyncPolicy';

type UseCharacterSyncOptions = {
  api: BackendApiClient;
  describeError: (error: unknown) => string;
  onNotice: (message: string | null) => void;
};

/**
 * 캐릭터 목록과 SSE 동기화 연결의 전체 생명주기를 소유한다.
 *
 * 저장된 캐릭터를 먼저 반환한 뒤 `characterSynced` event마다 한 명씩 upsert한다. 연결 오류가 나면
 * snapshot으로 실제 job 상태를 확인하고 진행 중일 때만 재연결하므로 SSE와 polling을 동시에 돌리지 않는다.
 */
export function useCharacterSync({ api, describeError, onNotice }: UseCharacterSyncOptions) {
  const [characters, setCharacters] = useState<HofCharacter[]>([]);
  const [characterSyncLabel, setCharacterSyncLabel] = useState<string | null>(null);
  const [characterSyncJob, setCharacterSyncJob] = useState<CharacterSyncJobResponse | null>(null);
  const subscriptionRef = useRef<SseSubscription | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rosterSyncPromiseRef = useRef<Promise<void> | null>(null);
  const fullSyncStartPromiseRef = useRef<Promise<void> | null>(null);
  const syncGenerationRef = useRef(0);
  const automaticSyncEvaluatedRef = useRef(false);
  const latestRosterObservationRef = useRef<number | null>(null);
  const characterListRequestRef = useRef(0);

  /** 현재 SSE와 예약된 재연결을 함께 닫아 로그아웃·unmount 이후 event 반영을 막는다. */
  const closeSubscription = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    subscriptionRef.current?.close();
    subscriptionRef.current = null;
  }, []);

  const applySnapshot = useCallback((snapshot: CharacterSyncJobResponse) => {
    setCharacterSyncJob(snapshot);
    setCharacters(snapshot.characters);
    if (snapshot.status === 'running' || snapshot.status === 'pending') {
      const progress = snapshot.rosterCount > 0
        ? `${snapshot.syncedCount.toLocaleString('en-US')}/${snapshot.rosterCount.toLocaleString('en-US')}`
        : '준비 중';
      const currentName = snapshot.characters.find((item) => item.hofCharacterId === snapshot.currentHofCharacterId)?.name;
      setCharacterSyncLabel(`전체 상세 동기화 ${progress}${currentName ? ` · ${currentName}` : ''}`);
    } else {
      setCharacterSyncLabel(null);
    }
  }, []);

  const openSubscriptionRef = useRef<(jobId: number) => void>(() => undefined);

  const handleEvent = useCallback((event: CharacterSyncEventResponse) => {
    setCharacterSyncLabel(event.rosterCount > 0
      ? `전체 상세 동기화 ${formatCharacterSyncProgress(event)}`
      : '전체 상세 동기화 준비 중');
    setCharacters((current) => upsertCharacterFromSyncEvent(current, event));
    setCharacterSyncJob((current) => current ? { ...current, status: event.eventType === 'stopped' ? 'stopped' : current.status, rosterCount: event.rosterCount, syncedCount: event.syncedCount, message: event.message, characters: event.character ? upsertCharacterFromSyncEvent(current.characters, event) : current.characters } : current);

    if (!shouldCloseCharacterSyncSubscription(event)) return;

    closeSubscription();
    setCharacterSyncLabel(null);
    if (event.eventType === 'failed') {
      onNotice(event.message ?? '전체 캐릭터 상세 동기화가 실패했습니다.');
      return;
    }
    api.fetchCharacterSyncJob(event.jobId)
      .then(applySnapshot)
      .catch((error: unknown) => onNotice(describeError(error)));
  }, [api, applySnapshot, closeSubscription, describeError, onNotice]);

  /** 연결 단절 시 snapshot 확인 후 진행 중인 동일 job만 1.2초 뒤 재구독한다. */
  const openSubscription = useCallback((jobId: number) => {
    subscriptionRef.current?.close();
    subscriptionRef.current = api.subscribeCharacterSyncJob(jobId, {
      onEvent: handleEvent,
      onError: () => {
        subscriptionRef.current?.close();
        subscriptionRef.current = null;
        api.fetchCharacterSyncJob(jobId)
          .then((snapshot) => {
            applySnapshot(snapshot);
            if (snapshot.status === 'running' || snapshot.status === 'pending') {
              reconnectTimerRef.current = setTimeout(() => {
                openSubscriptionRef.current(jobId);
              }, RECONNECT_DELAY_MS);
            }
          })
          .catch((error: unknown) => onNotice(describeError(error)));
      },
    });
  }, [api, applySnapshot, describeError, handleEvent, onNotice]);

  useEffect(() => {
    openSubscriptionRef.current = openSubscription;
  }, [openSubscription]);

  const startFullSyncJob = useCallback((): Promise<void> => {
    if (fullSyncStartPromiseRef.current) return fullSyncStartPromiseRef.current;

    const syncGeneration = syncGenerationRef.current;
    closeSubscription();
    setCharacterSyncLabel('전체 상세 동기화 준비 중');
    const startPromise = (async () => {
      try {
        const job = await api.startCharacterSyncJob();
        if (syncGeneration !== syncGenerationRef.current) return;
        setCharacterSyncJob(job);
        openSubscription(job.jobId);
      } catch (error) {
        if (syncGeneration !== syncGenerationRef.current) return;
        setCharacterSyncLabel(null);
        onNotice(describeError(error));
      }
    })();
    fullSyncStartPromiseRef.current = startPromise;
    void startPromise.finally(() => {
      if (fullSyncStartPromiseRef.current === startPromise) {
        fullSyncStartPromiseRef.current = null;
      }
    });
    return startPromise;
  }, [api, closeSubscription, describeError, onNotice, openSubscription]);

  const loadSavedCharacters = useCallback(async () => {
    const requestId = ++characterListRequestRef.current;
    const incoming = await api.listCharacters();
    if (requestId === characterListRequestRef.current) setCharacters(incoming);
  }, [api]);

  /** HOF 홈 roster와 생명주기만 갱신하고 캐릭터별 상세 페이지는 조회하지 않는다. */
  const syncCharacterRoster = useCallback((): Promise<void> => {
    if (rosterSyncPromiseRef.current) return rosterSyncPromiseRef.current;

    const syncGeneration = syncGenerationRef.current;
    setCharacterSyncLabel('목록 동기화 중');
    const syncPromise = (async () => {
      try {
        const incoming = await api.syncCharacterRoster();
        if (syncGeneration !== syncGenerationRef.current) return;
        setCharacters(incoming);
        setCharacterSyncLabel(null);
      } catch (error) {
        if (syncGeneration !== syncGenerationRef.current) return;
        setCharacterSyncLabel(null);
        onNotice(describeError(error));
      }
    })();
    rosterSyncPromiseRef.current = syncPromise;
    void syncPromise.finally(() => {
      if (rosterSyncPromiseRef.current === syncPromise) {
        rosterSyncPromiseRef.current = null;
      }
    });
    return syncPromise;
  }, [api, describeError, onNotice]);

  /** 새 로그인 홈 roster가 관측되면 같은 응답 헤더로 인한 재귀 호출 없이 저장 목록을 다시 읽는다. */
  const handleRosterObservation = useCallback((status: HofObservedStatusResponse) => {
    if (!status.characterRosterObservedAt) return;
    const observedAt = Date.parse(status.characterRosterObservedAt);
    if (Number.isNaN(observedAt)) return;
    const latest = latestRosterObservationRef.current;
    if (latest != null && observedAt <= latest) return;

    latestRosterObservationRef.current = observedAt;
    if (rosterSyncPromiseRef.current) return;
    void loadSavedCharacters().catch((error: unknown) => {
      if (latestRosterObservationRef.current === observedAt) {
        latestRosterObservationRef.current = null;
      }
      onNotice(describeError(error));
    });
  }, [describeError, loadSavedCharacters, onNotice]);

  useEffect(
    () => api.subscribeHofStatus(handleRosterObservation),
    [api, handleRosterObservation],
  );

  const startAutomaticSyncIfRequired = useCallback(async (required: boolean) => {
    if (!shouldStartAutomaticCharacterSync(required, automaticSyncEvaluatedRef.current)) return;
    automaticSyncEvaluatedRef.current = true;
    await startFullSyncJob();
  }, [startFullSyncJob]);

  const upsertCharacter = useCallback((incoming: HofCharacter) => {
    setCharacters((current) => {
      const index = current.findIndex((item) => item.id === incoming.id);
      if (index < 0) return [...current, incoming];
      return current.map((item, itemIndex) => itemIndex === index ? incoming : item);
    });
  }, []);

  const replaceCharacters = useCallback((incoming: HofCharacter[]) => {
    setCharacters(incoming);
  }, []);

  const stopCharacterSync = useCallback(async () => {
    if (!characterSyncJob) return;
    applySnapshot(await api.stopCharacterSyncJob(characterSyncJob.jobId));
  }, [api, applySnapshot, characterSyncJob]);

  const resumeCharacterSync = useCallback(async () => {
    if (!characterSyncJob) return;
    const snapshot = await api.resumeCharacterSyncJob(characterSyncJob.jobId);
    applySnapshot(snapshot);
    openSubscription(snapshot.jobId);
  }, [api, applySnapshot, characterSyncJob, openSubscription]);

  /** 로그아웃에서 화면 목록, 진행 표시와 연결을 원자적으로 초기화한다. */
  const resetCharacterSync = useCallback(() => {
    syncGenerationRef.current += 1;
    rosterSyncPromiseRef.current = null;
    fullSyncStartPromiseRef.current = null;
    closeSubscription();
    setCharacters([]);
    setCharacterSyncLabel(null);
    setCharacterSyncJob(null);
    automaticSyncEvaluatedRef.current = false;
    latestRosterObservationRef.current = null;
    characterListRequestRef.current += 1;
  }, [closeSubscription]);

  useEffect(() => closeSubscription, [closeSubscription]);

  return {
    characters,
    characterSyncLabel,
    characterSyncJob,
    syncCharacterRoster,
    startCharacterFullSync: startFullSyncJob,
    stopCharacterSync,
    resumeCharacterSync,
    loadSavedCharacters,
    startAutomaticSyncIfRequired,
    upsertCharacter,
    replaceCharacters,
    resetCharacterSync,
  };
}

const RECONNECT_DELAY_MS = 1200;
