import type { CharacterSyncEventResponse, HofCharacter } from '../types/api';
import { sortCharactersByRosterOrder } from './characters';

/**
 * SSE로 도착한 캐릭터 1명 동기화 이벤트를 현재 캐릭터 목록에 반영한다.
 *
 * @remarks
 * 같은 안정 캐릭터 ID가 이미 있으면 그 자리를 교체하고, 목록은 HOF roster 원본 순서로 유지한다.
 */
export function upsertCharacterFromSyncEvent(
  characters: HofCharacter[],
  event: CharacterSyncEventResponse,
): HofCharacter[] {
  if (!event.character) return characters;

  const existingIndex = characters.findIndex(
    (character) => character.id === event.character?.id,
  );
  const merged = existingIndex < 0
    ? [...characters, event.character]
    : characters.map((character, index) => index === existingIndex ? event.character! : character);

  return sortCharactersByRosterOrder(merged);
}

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
