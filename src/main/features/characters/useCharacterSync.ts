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
  const subscriptionGenerationRef = useRef(0);
  const activeSubscriptionJobRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rosterSyncPromiseRef = useRef<Promise<void> | null>(null);
  const fullSyncStartPromiseRef = useRef<Promise<void> | null>(null);
  const syncGenerationRef = useRef(0);
  const automaticSyncEvaluatedRef = useRef(false);
  const latestRosterObservationRef = useRef<number | null>(null);
  const characterListRequestRef = useRef(0);
  const rosterAuthorityGenerationRef = useRef(0);
  const rosterProjectionGenerationRef = useRef(0);

  /** lifecycle mutation 뒤에는 그 전에 시작된 GET·job snapshot·SSE가 roster를 되돌리지 못한다. */
  const applyObservedRoster = useCallback((
    incoming: HofCharacter[],
    expectedAuthorityGeneration: number,
    expectedProjectionGeneration: number,
  ): boolean => {
    if (
      expectedAuthorityGeneration !== rosterAuthorityGenerationRef.current ||
      expectedProjectionGeneration !== rosterProjectionGenerationRef.current
    ) {
      return false;
    }
    setCharacters((current) => mergeFresherCharacterProjections(current, incoming));
    return true;
  }, []);

  const applyObservedCharacter = useCallback((
    event: CharacterSyncEventResponse,
    expectedAuthorityGeneration: number,
  ): boolean => {
    if (expectedAuthorityGeneration !== rosterAuthorityGenerationRef.current) {
      return false;
    }
    rosterProjectionGenerationRef.current += 1;
    setCharacters((current) => {
      const observed = event.character;
      const existing = observed
        ? current.find((character) => character.id === observed.id)
        : undefined;
      return existing && observed && isFresherCharacter(existing, observed)
        ? current
        : upsertCharacterFromSyncEvent(current, event);
    });
    return true;
  }, []);

  /** 현재 SSE와 예약된 재연결을 함께 닫아 로그아웃·unmount 이후 event 반영을 막는다. */
  const closeSubscription = useCallback(() => {
    subscriptionGenerationRef.current += 1;
    activeSubscriptionJobRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    subscriptionRef.current?.close();
    subscriptionRef.current = null;
  }, []);

  const applySnapshot = useCallback((
    snapshot: CharacterSyncJobResponse,
    expectedAuthorityGeneration: number,
    expectedProjectionGeneration: number,
    expectedSyncGeneration: number,
  ): boolean => {
    if (expectedSyncGeneration !== syncGenerationRef.current) return false;
    setCharacterSyncJob(snapshot);
    applyObservedRoster(
      snapshot.characters,
      expectedAuthorityGeneration,
      expectedProjectionGeneration,
    );
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
  }, [applyObservedRoster]);

  const openSubscriptionRef = useRef<(
    jobId: number,
    authorityGeneration: number,
    syncGeneration: number,
  ) => void>(() => undefined);

  const handleEvent = useCallback((
    event: CharacterSyncEventResponse,
    authorityGeneration: number,
    syncGeneration: number,
  ) => {
    if (
      authorityGeneration !== rosterAuthorityGenerationRef.current ||
      syncGeneration !== syncGenerationRef.current
    ) return;
    setCharacterSyncLabel(event.rosterCount > 0
      ? `전체 상세 동기화 ${formatCharacterSyncProgress(event)}`
      : '전체 상세 동기화 준비 중');
    applyObservedCharacter(event, authorityGeneration);
    setCharacterSyncJob((current) => current ? { ...current, status: event.eventType === 'stopped' ? 'stopped' : current.status, rosterCount: event.rosterCount, syncedCount: event.syncedCount, message: event.message, characters: event.character ? upsertCharacterFromSyncEvent(current.characters, event) : current.characters } : current);

    if (!shouldCloseCharacterSyncSubscription(event)) return;

    closeSubscription();
    setCharacterSyncLabel(null);
    if (event.eventType === 'failed') {
      onNotice(event.message ?? '전체 캐릭터 상세 동기화가 실패했습니다.');
      return;
    }
    const snapshotAuthorityGeneration = rosterAuthorityGenerationRef.current;
    const snapshotProjectionGeneration = rosterProjectionGenerationRef.current;
    api.fetchCharacterSyncJob(event.jobId)
      .then((snapshot) => applySnapshot(
        snapshot,
        snapshotAuthorityGeneration,
        snapshotProjectionGeneration,
        syncGeneration,
      ))
      .catch((error: unknown) => {
        if (syncGeneration === syncGenerationRef.current) {
          onNotice(describeError(error));
        }
      });
  }, [
    api,
    applyObservedCharacter,
    applySnapshot,
    closeSubscription,
    describeError,
    onNotice,
  ]);

  /** 연결 단절 시 snapshot 확인 후 진행 중인 동일 job만 1.2초 뒤 재구독한다. */
  const openSubscription = useCallback((
    jobId: number,
    authorityGeneration: number,
    syncGeneration: number,
  ) => {
    if (syncGeneration !== syncGenerationRef.current) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    subscriptionRef.current?.close();
    const subscriptionGeneration = ++subscriptionGenerationRef.current;
    activeSubscriptionJobRef.current = jobId;
    subscriptionRef.current = api.subscribeCharacterSyncJob(jobId, {
      onEvent: (event) => {
        if (subscriptionGeneration !== subscriptionGenerationRef.current) return;
        handleEvent(event, authorityGeneration, syncGeneration);
      },
      onError: () => {
        if (
          subscriptionGeneration !== subscriptionGenerationRef.current ||
          syncGeneration !== syncGenerationRef.current
        ) return;
        subscriptionGenerationRef.current += 1;
        subscriptionRef.current?.close();
        subscriptionRef.current = null;
        activeSubscriptionJobRef.current = null;
        const snapshotAuthorityGeneration = rosterAuthorityGenerationRef.current;
        const snapshotProjectionGeneration = rosterProjectionGenerationRef.current;
        api.fetchCharacterSyncJob(jobId)
          .then((snapshot) => {
            const applied = applySnapshot(
              snapshot,
              snapshotAuthorityGeneration,
              snapshotProjectionGeneration,
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
                  rosterAuthorityGenerationRef.current,
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
        openSubscription(
          job.jobId,
          rosterAuthorityGenerationRef.current,
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
    const requestId = ++characterListRequestRef.current;
    const authorityGeneration = rosterAuthorityGenerationRef.current;
    const projectionGeneration = rosterProjectionGenerationRef.current;
    const incoming = await api.listCharacters();
    if (requestId === characterListRequestRef.current) {
      applyObservedRoster(incoming, authorityGeneration, projectionGeneration);
    }
  }, [api, applyObservedRoster]);

  /** HOF 홈 roster와 생명주기만 갱신하고 캐릭터별 상세 페이지는 조회하지 않는다. */
  const syncCharacterRoster = useCallback((): Promise<void> => {
    if (rosterSyncPromiseRef.current) return rosterSyncPromiseRef.current;

    const syncGeneration = syncGenerationRef.current;
    const authorityGeneration = rosterAuthorityGenerationRef.current;
    const projectionGeneration = rosterProjectionGenerationRef.current;
    setCharacterSyncLabel('목록 동기화 중');
    const syncPromise = (async () => {
      try {
        const incoming = await api.syncCharacterRoster();
        if (syncGeneration !== syncGenerationRef.current) return;
        applyObservedRoster(incoming, authorityGeneration, projectionGeneration);
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
  }, [api, applyObservedRoster, describeError, onNotice]);

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
    rosterProjectionGenerationRef.current += 1;
    setCharacters((current) => {
      const index = current.findIndex((item) => item.id === incoming.id);
      if (index < 0) return [...current, incoming];
      return current.map((item, itemIndex) => itemIndex === index ? incoming : item);
    });
  }, []);

  const replaceCharacters = useCallback((incoming: HofCharacter[]) => {
    rosterAuthorityGenerationRef.current += 1;
    setCharacters(incoming);
    const activeJobId = activeSubscriptionJobRef.current;
    if (activeJobId != null) {
      openSubscriptionRef.current(
        activeJobId,
        rosterAuthorityGenerationRef.current,
        syncGenerationRef.current,
      );
    }
  }, []);

  const stopCharacterSync = useCallback(async () => {
    if (!characterSyncJob) return;
    const syncGeneration = syncGenerationRef.current;
    const authorityGeneration = rosterAuthorityGenerationRef.current;
    const projectionGeneration = rosterProjectionGenerationRef.current;
    applySnapshot(
      await api.stopCharacterSyncJob(characterSyncJob.jobId),
      authorityGeneration,
      projectionGeneration,
      syncGeneration,
    );
  }, [api, applySnapshot, characterSyncJob]);

  const resumeCharacterSync = useCallback(async () => {
    if (!characterSyncJob) return;
    const syncGeneration = syncGenerationRef.current;
    const authorityGeneration = rosterAuthorityGenerationRef.current;
    const projectionGeneration = rosterProjectionGenerationRef.current;
    const snapshot = await api.resumeCharacterSyncJob(characterSyncJob.jobId);
    if (!applySnapshot(
      snapshot,
      authorityGeneration,
      projectionGeneration,
      syncGeneration,
    )) return;
    openSubscription(
      snapshot.jobId,
      rosterAuthorityGenerationRef.current,
      syncGeneration,
    );
  }, [api, applySnapshot, characterSyncJob, openSubscription]);

  /** 로그아웃에서 화면 목록, 진행 표시와 연결을 원자적으로 초기화한다. */
  const resetCharacterSync = useCallback(() => {
    syncGenerationRef.current += 1;
    rosterAuthorityGenerationRef.current += 1;
    rosterProjectionGenerationRef.current += 1;
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

function mergeFresherCharacterProjections(
  current: HofCharacter[],
  incoming: HofCharacter[],
): HofCharacter[] {
  const currentById = new Map(current.map((character) => [character.id, character]));
  return incoming.map((observed) => {
    const existing = currentById.get(observed.id);
    return existing && isFresherCharacter(existing, observed) ? existing : observed;
  });
}

function isFresherCharacter(
  existing: HofCharacter,
  observed: HofCharacter,
): boolean {
  const revisionOrder = compareInstant(existing.revision, observed.revision);
  if (revisionOrder !== 0) return revisionOrder > 0;
  return compareInstant(existing.detailSyncedAt, observed.detailSyncedAt) > 0;
}

function compareInstant(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  if (left === right) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return leftTime - rightTime;
  }
  return left.localeCompare(right);
}
