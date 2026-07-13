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
} from '../../types/api';

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
  const subscriptionRef = useRef<SseSubscription | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setCharacters(snapshot.characters);
    if (snapshot.status === 'running' || snapshot.status === 'pending') {
      const progress = snapshot.rosterCount > 0
        ? `${snapshot.syncedCount.toLocaleString('en-US')}/${snapshot.rosterCount.toLocaleString('en-US')}`
        : '준비 중';
      setCharacterSyncLabel(`동기화 ${progress}`);
    } else {
      setCharacterSyncLabel(null);
    }
  }, []);

  const openSubscriptionRef = useRef<(jobId: number) => void>(() => undefined);

  const handleEvent = useCallback((event: CharacterSyncEventResponse) => {
    setCharacterSyncLabel(event.rosterCount > 0
      ? `동기화 ${formatCharacterSyncProgress(event)}`
      : '동기화 준비 중');
    setCharacters((current) => upsertCharacterFromSyncEvent(current, event));

    if (!shouldCloseCharacterSyncSubscription(event)) return;

    closeSubscription();
    setCharacterSyncLabel(null);
    if (event.eventType === 'failed') {
      onNotice(event.message ?? '캐릭터 동기화가 실패했습니다.');
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

  const startJob = useCallback(async () => {
    closeSubscription();
    setCharacterSyncLabel('동기화 준비 중');
    const job = await api.startCharacterSyncJob();
    openSubscription(job.jobId);
  }, [api, closeSubscription, openSubscription]);

  /** 저장 snapshot을 즉시 표시한 뒤 새 SSE job을 시작하는 로그인·수동 동기화 공통 진입점이다. */
  const syncCharacters = useCallback(async () => {
    setCharacters(await api.listCharacters());
    await startJob();
  }, [api, startJob]);

  const manualSyncCharacters = useCallback(async () => {
    onNotice(null);
    try {
      await syncCharacters();
    } catch (error) {
      onNotice(describeError(error));
    }
  }, [describeError, onNotice, syncCharacters]);

  /** 로그아웃에서 화면 목록, 진행 표시와 연결을 원자적으로 초기화한다. */
  const resetCharacterSync = useCallback(() => {
    closeSubscription();
    setCharacters([]);
    setCharacterSyncLabel(null);
  }, [closeSubscription]);

  useEffect(() => closeSubscription, [closeSubscription]);

  return {
    characters,
    characterSyncLabel,
    syncCharacters,
    manualSyncCharacters,
    resetCharacterSync,
  };
}

const RECONNECT_DELAY_MS = 1200;
