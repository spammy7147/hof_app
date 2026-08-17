import type { CharacterSyncEventResponse, HofCharacter } from '../types/api';

/**
 * SSE로 도착한 캐릭터 1명 동기화 이벤트를 현재 캐릭터 목록에 반영한다.
 *
 * @remarks
 * 같은 HOF 캐릭터 ID가 이미 있으면 새 데이터로 교체하고, 목록 정렬은 직업/레벨/이름 기준으로 유지한다.
 */
export function upsertCharacterFromSyncEvent(
  characters: HofCharacter[],
  event: CharacterSyncEventResponse,
): HofCharacter[] {
  if (!event.character) return characters;

  const withoutCharacter = characters.filter(
    (character) => character.id !== event.character?.id,
  );

  return [event.character, ...withoutCharacter].sort(compareCharacters);
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

function compareCharacters(
  left: HofCharacter,
  right: HofCharacter,
): number {
  const leftJob = left.job || '기타';
  const rightJob = right.job || '기타';
  if (leftJob !== rightJob) return leftJob.localeCompare(rightJob);

  const leftLevel = left.level ?? -1;
  const rightLevel = right.level ?? -1;
  if (leftLevel !== rightLevel) return rightLevel - leftLevel;

  return left.name.localeCompare(right.name);
}
