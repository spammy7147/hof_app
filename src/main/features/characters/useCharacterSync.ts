import { useCallback, useEffect, useRef, useState } from 'react';

import {
  formatCharacterSyncProgress,
  shouldCloseCharacterSyncSubscription,
} from '../../domain/characterSyncJobs';
import type { BackendApiClient } from '../../services/backendApi';
import type { SseSubscription } from '../../services/sseClient';
import type { CharacterManagementObservationSink } from '../../domain/characterManagementHubModule';
import type {
  CharacterSyncEventResponse,
  CharacterSyncJobResponse,
  HofObservedStatusResponse,
} from '../../types/api';
import { shouldStartAutomaticCharacterSync } from '../../domain/characterSyncPolicy';

type UseCharacterSyncOptions = {
  api: BackendApiClient;
  describeError: (error: unknown) => string;
  onNotice: (message: string | null) => void;
  observations: CharacterManagementObservationSink;
};

/**
 * 캐릭터 동기화 job과 SSE 연결의 전체 생명주기를 소유한다.
 *
 * roster와 개별 캐릭터 관측은 캐릭터 관리 허브로 전달한다. 연결 오류가 나면 snapshot으로 실제 job
 * 상태를 확인하고 진행 중일 때만 재연결하므로 SSE와 polling을 동시에 돌리지 않는다.
 */
export function useCharacterSync({
  api,
  describeError,
  onNotice,
  observations,
}: UseCharacterSyncOptions) {
  const [characterSyncLabel, setCharacterSyncLabel] = useState<string | null>(null);
  const [characterSyncJob, setCharacterSyncJob] = useState<CharacterSyncJobResponse | null>(null);
  const subscriptionRef = useRef<SseSubscription | null>(null);
  const subscriptionGenerationRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rosterSyncPromiseRef = useRef<Promise<void> | null>(null);
  const fullSyncStartPromiseRef = useRef<Promise<void> | null>(null);
  const syncGenerationRef = useRef(0);
  const automaticSyncEvaluatedRef = useRef(false);
  const latestRosterObservationRef = useRef<number | null>(null);

  /** 현재 SSE와 예약된 재연결을 함께 닫아 로그아웃·unmount 이후 event 반영을 막는다. */
  const closeSubscription = useCallback(() => {
    subscriptionGenerationRef.current += 1;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    subscriptionRef.current?.close();
    subscriptionRef.current = null;
  }, []);

  const applySnapshot = useCallback((
    snapshot: CharacterSyncJobResponse,
    acceptRoster: (characters: CharacterSyncJobResponse['characters']) => boolean,
    expectedSyncGeneration: number,
  ): boolean => {
    if (expectedSyncGeneration !== syncGenerationRef.current) return false;
    setCharacterSyncJob(snapshot);
    acceptRoster(snapshot.characters);
    if (snapshot.status === 'running' || snapshot.status === 'pending') {
      const progress = snapshot.rosterCount > 0
        ? `${snapshot.syncedCount.toLocaleString('en-US')}/${snapshot.rosterCount.toLocaleString('en-US')}`
        : '준비 중';
      const currentName = snapshot.characters.find((item) => item.hofCharacterId === snapshot.currentHofCharacterId)?.name;
      setCharacterSyncLabel(`전체 상세 동기화 ${progress}${currentName ? ` · ${currentName}` : ''}`);
    } else {
      setCharacterSyncLabel(null);
    }
    return true;
  }, []);

  const openSubscriptionRef = useRef<(
    jobId: number,
    syncGeneration: number,
  ) => void>(() => undefined);

  const handleEvent = useCallback((
    event: CharacterSyncEventResponse,
    syncGeneration: number,
  ) => {
    if (syncGeneration !== syncGenerationRef.current) return;
    setCharacterSyncLabel(event.rosterCount > 0
      ? `전체 상세 동기화 ${formatCharacterSyncProgress(event)}`
      : '전체 상세 동기화 준비 중');
    if (event.character) observations.observeCharacter(event.character);
    setCharacterSyncJob((current) => current ? {
      ...current,
      status: event.eventType === 'stopped' ? 'stopped' : current.status,
      rosterCount: event.rosterCount,
      syncedCount: event.syncedCount,
      message: event.message,
    } : current);

    if (!shouldCloseCharacterSyncSubscription(event)) return;

    closeSubscription();
    setCharacterSyncLabel(null);
    if (event.eventType === 'failed') {
      onNotice(event.message ?? '전체 캐릭터 상세 동기화가 실패했습니다.');
      return;
    }
    const acceptRoster = observations.beginRosterObservation();
    api.fetchCharacterSyncJob(event.jobId)
      .then((snapshot) => applySnapshot(
        snapshot,
        acceptRoster,
        syncGeneration,
      ))
      .catch((error: unknown) => {
        if (syncGeneration === syncGenerationRef.current) {
          onNotice(describeError(error));
        }
      });
  }, [
    api,
    applySnapshot,
    closeSubscription,
    describeError,
    onNotice,
    observations,
  ]);

  /** 연결 단절 시 snapshot 확인 후 진행 중인 동일 job만 1.2초 뒤 재구독한다. */
  const openSubscription = useCallback((
    jobId: number,
    syncGeneration: number,
  ) => {
    if (syncGeneration !== syncGenerationRef.current) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    subscriptionRef.current?.close();
    const subscriptionGeneration = ++subscriptionGenerationRef.current;
    subscriptionRef.current = api.subscribeCharacterSyncJob(jobId, {
      onEvent: (event) => {
        if (subscriptionGeneration !== subscriptionGenerationRef.current) return;
        handleEvent(event, syncGeneration);
      },
      onError: () => {
        if (
          subscriptionGeneration !== subscriptionGenerationRef.current ||
          syncGeneration !== syncGenerationRef.current
        ) return;
        subscriptionGenerationRef.current += 1;
        subscriptionRef.current?.close();
        subscriptionRef.current = null;
        const acceptRoster = observations.beginRosterObservation();
        api.fetchCharacterSyncJob(jobId)
          .then((snapshot) => {
            const applied = applySnapshot(
              snapshot,
              acceptRoster,
              syncGeneration,
            );
            if (
              applied &&
              (snapshot.status === 'running' || snapshot.status === 'pending')
            ) {
              reconnectTimerRef.current = setTimeout(() => {
                if (syncGeneration !== syncGenerationRef.current) return;
                openSubscriptionRef.current(
                  jobId,
                  syncGeneration,
                );
              }, RECONNECT_DELAY_MS);
            }
          })
          .catch((error: unknown) => {
            if (syncGeneration === syncGenerationRef.current) {
              onNotice(describeError(error));
            }
          });
      },
    });
  }, [api, applySnapshot, describeError, handleEvent, observations, onNotice]);

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
        openSubscription(
          job.jobId,
          syncGeneration,
        );
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
    const acceptRoster = observations.beginRosterObservation();
    const incoming = await api.listCharacters();
    acceptRoster(incoming);
  }, [api, observations]);

  /** HOF 홈 roster와 생명주기만 갱신하고 캐릭터별 상세 페이지는 조회하지 않는다. */
  const syncCharacterRoster = useCallback((): Promise<void> => {
    if (rosterSyncPromiseRef.current) return rosterSyncPromiseRef.current;

    const syncGeneration = syncGenerationRef.current;
    const acceptRoster = observations.beginRosterObservation();
    setCharacterSyncLabel('목록 동기화 중');
    const syncPromise = (async () => {
      try {
        const incoming = await api.syncCharacterRoster();
        if (syncGeneration !== syncGenerationRef.current) return;
        acceptRoster(incoming);
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
  }, [api, describeError, observations, onNotice]);

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

  const stopCharacterSync = useCallback(async () => {
    if (!characterSyncJob) return;
    const syncGeneration = syncGenerationRef.current;
    const acceptRoster = observations.beginRosterObservation();
    applySnapshot(
      await api.stopCharacterSyncJob(characterSyncJob.jobId),
      acceptRoster,
      syncGeneration,
    );
  }, [api, applySnapshot, characterSyncJob, observations]);

  const resumeCharacterSync = useCallback(async () => {
    if (!characterSyncJob) return;
    const syncGeneration = syncGenerationRef.current;
    const acceptRoster = observations.beginRosterObservation();
    const snapshot = await api.resumeCharacterSyncJob(characterSyncJob.jobId);
    if (!applySnapshot(
      snapshot,
      acceptRoster,
      syncGeneration,
    )) return;
    openSubscription(
      snapshot.jobId,
      syncGeneration,
    );
  }, [api, applySnapshot, characterSyncJob, observations, openSubscription]);

  /** 로그아웃에서 화면 목록, 진행 표시와 연결을 원자적으로 초기화한다. */
  const resetCharacterSync = useCallback(() => {
    syncGenerationRef.current += 1;
    rosterSyncPromiseRef.current = null;
    fullSyncStartPromiseRef.current = null;
    closeSubscription();
    setCharacterSyncLabel(null);
    setCharacterSyncJob(null);
    automaticSyncEvaluatedRef.current = false;
    latestRosterObservationRef.current = null;
  }, [closeSubscription]);

  useEffect(() => closeSubscription, [closeSubscription]);

  return {
    characterSyncLabel,
    characterSyncJob,
    syncCharacterRoster,
    startCharacterFullSync: startFullSyncJob,
    stopCharacterSync,
    resumeCharacterSync,
    loadSavedCharacters,
    startAutomaticSyncIfRequired,
    resetCharacterSync,
  };
}

const RECONNECT_DELAY_MS = 1200;
