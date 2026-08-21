import type { CharacterSyncEventResponse } from '../types/api';

/**
 * SSE 연결을 닫아도 되는 terminal 이벤트인지 판단한다.
 */
export function shouldCloseCharacterSyncSubscription(event: CharacterSyncEventResponse): boolean {
  return event.eventType === 'completed' || event.eventType === 'failed' || event.eventType === 'stopped';
}

/**
 * 동기화 진행 상태를 `완료/전체` 형태의 짧은 라벨로 만든다.
 */
export function formatCharacterSyncProgress(event: CharacterSyncEventResponse): string {
  return `${event.syncedCount.toLocaleString('en-US')}/${event.rosterCount.toLocaleString('en-US')}`;
}
