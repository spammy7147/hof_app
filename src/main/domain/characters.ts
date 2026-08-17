import type { HofCharacter } from '../types/api';

export type CharacterGroup = {
  job: string;
  headerText: string;
  characters: HofCharacter[];
};

/** HOF 원본 목록 순서를 유지하고, 같은 순번이나 과거 기록은 서버 응답의 상대 순서를 보존한다. */
export function sortCharactersByRosterOrder(characters: HofCharacter[]): HofCharacter[] {
  return [...characters].sort((left, right) => {
    const leftOrder = left.rosterOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.rosterOrder ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

/**
 * 캐릭터 목록을 직업별 섹션으로 묶고, 각 섹션 안에서는 레벨 높은 순서로 정렬한다.
 */
export function groupCharactersByJob(characters: HofCharacter[]): CharacterGroup[] {
  const sortedCharacters = [...characters].sort((left, right) => {
    const jobCompare = displayCharacterJob(left).localeCompare(displayCharacterJob(right));
    if (jobCompare !== 0) return jobCompare;

    const levelCompare = (right.level ?? -1) - (left.level ?? -1);
    if (levelCompare !== 0) return levelCompare;

    return displayCharacterName(left).localeCompare(displayCharacterName(right), 'ko-KR');
  });

  const groups = new Map<string, HofCharacter[]>();
  sortedCharacters.forEach((character) => {
    const job = displayCharacterJob(character);
    groups.set(job, [...(groups.get(job) ?? []), character]);
  });

  return [...groups.entries()].map(([job, groupCharacters]) => ({
    job,
    headerText: `${job} ${groupCharacters.length}명`,
    characters: groupCharacters,
  }));
}

/**
 * 빈 캐릭터명을 화면에 그대로 노출하지 않도록 기본 표시명을 만든다.
 */
export function displayCharacterName(character: HofCharacter): string {
  return character.name.trim() || '(이름없음)';
}

/**
 * 빈 직업명을 `미분류`로 바꿔 섹션 헤더가 항상 의미 있게 보이도록 한다.
 */
export function displayCharacterJob(character: HofCharacter): string {
  return character.job.trim() || '미분류';
}

/**
 * 캐릭터 레벨을 UI에서 쓰는 `Lv.60` 형식으로 만든다.
 */
export function formatCharacterLevel(character: HofCharacter): string {
  return character.level == null ? 'Lv.-' : `Lv.${character.level}`;
}

/**
 * 캐릭터가 가진 저장 패턴 슬롯 개수를 짧은 설명 문구로 만든다.
 */
export function formatPatternSlotCount(character: HofCharacter): string {
  return character.patternSlotCount > 0 ? `패턴 ${character.patternSlotCount}개` : '패턴 없음';
}
