import type { BattlePatternLoadRequest, HofCharacter, RunBattleRequest } from '../types/api';

export const BATTLE_PARTY_SIZE = 5;

export type BattlePartyMember = {
  slotIndex: number;
  characterId: string | null;
  patternSlot: number | null;
};

export type BattlePartyCharacterOption = {
  character: HofCharacter | null;
  selected: boolean;
  alreadyUsed: boolean;
};

export type BattlePartyPatternOption = {
  slot: number;
  label: string;
  selected: boolean;
};

export type ToRunBattleRequestInput = {
  categoryId: string;
  mapCode: string;
  party: BattlePartyMember[];
  characters: HofCharacter[];
  battleCount: 1 | 3;
};

/**
 * 캐릭터 목록 앞에서부터 최대 5명을 골라 기본 전투 파티를 만든다.
 *
 * @remarks
 * 패턴 슬롯이 있는 캐릭터는 기본으로 0번 슬롯을 선택한다. 사용자가 이후 UI에서 캐릭터와 패턴을 바꾼다.
 */
export function createDefaultBattleParty(characters: HofCharacter[]): BattlePartyMember[] {
  return Array.from({ length: BATTLE_PARTY_SIZE }, (_, slotIndex) => {
    const character = characters[slotIndex] ?? null;

    return {
      slotIndex,
      characterId: character?.hofCharacterId ?? null,
      patternSlot: defaultPatternSlot(character),
    };
  });
}

/**
 * 현재 동기화된 캐릭터가 아닌 파티 멤버를 빈 슬롯으로 정리한다.
 */
export function sanitizeBattlePartyForCharacters(
  party: BattlePartyMember[],
  characters: HofCharacter[],
): BattlePartyMember[] {
  const characterIds = new Set(characters.map((character) => character.hofCharacterId));

  return party.map((member) => (
    member.characterId != null && characterIds.has(member.characterId)
      ? member
      : { ...member, characterId: null, patternSlot: null }
  ));
}

/**
 * 특정 파티 슬롯에 캐릭터를 배치한다.
 *
 * @remarks
 * 같은 캐릭터가 다른 슬롯에 이미 있으면 중복 출전을 막기 위해 기존 슬롯을 비운다.
 */
export function updateBattlePartyMember(
  party: BattlePartyMember[],
  slotIndex: number,
  characterId: string | null,
  characters: HofCharacter[],
): BattlePartyMember[] {
  const character = characterId == null
    ? null
    : characters.find((candidate) => candidate.hofCharacterId === characterId) ?? null;

  return party.map((member, index) => {
    if (index === slotIndex) {
      return {
        ...member,
        characterId: character?.hofCharacterId ?? null,
        patternSlot: defaultPatternSlot(character),
      };
    }

    if (character != null && member.characterId === character.hofCharacterId) {
      return {
        ...member,
        characterId: null,
        patternSlot: null,
      };
    }

    return member;
  });
}

/**
 * 특정 파티 슬롯의 저장 패턴 번호만 변경한다.
 */
export function updateBattlePartyPattern(
  party: BattlePartyMember[],
  slotIndex: number,
  patternSlot: number | null,
): BattlePartyMember[] {
  return party.map((member, index) => (
    index === slotIndex
      ? { ...member, patternSlot }
      : member
  ));
}

/**
 * 캐릭터 선택 모달에 표시할 옵션 목록을 만든다.
 *
 * @remarks
 * 현재 슬롯에서 선택된 캐릭터와 다른 슬롯에서 이미 사용 중인 캐릭터를 구분해 UI가 비활성 상태를 표시할 수 있게 한다.
 */
export function buildBattlePartyCharacterOptions(
  party: BattlePartyMember[],
  characters: HofCharacter[],
  activeSlotIndex: number,
): BattlePartyCharacterOption[] {
  const activeCharacterId = party[activeSlotIndex]?.characterId ?? null;
  const selectedIds = new Set(
    party
      .map((member) => member.characterId)
      .filter((characterId): characterId is string => characterId != null && characterId.trim().length > 0),
  );

  const emptyOption: BattlePartyCharacterOption = {
    character: null,
    selected: activeCharacterId == null,
    alreadyUsed: false,
  };

  return [emptyOption, ...characters.map((character) => {
    const selected = character.hofCharacterId === activeCharacterId;

    return {
      character,
      selected,
      alreadyUsed: selectedIds.has(character.hofCharacterId) && !selected,
    };
  })];
}

/**
 * 캐릭터 선택 모달의 검색어로 이름, 직업, 레벨, HOF 캐릭터 ID를 필터링한다.
 */
export function filterBattlePartyCharacterOptions(
  options: BattlePartyCharacterOption[],
  query: string,
): BattlePartyCharacterOption[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return options;

  return options.filter((option) => {
    if (option.character == null) return true;
    return characterSearchText(option.character).includes(normalizedQuery);
  });
}

/**
 * 선택한 캐릭터가 가진 저장 패턴 슬롯 목록을 UI 옵션으로 바꾼다.
 *
 * @remarks
 * 백엔드가 저장 패턴명을 알고 있으면 그 라벨을 쓰고, 없으면 `패턴 1` 같은 기본 라벨을 만든다.
 */
export function buildBattlePartyPatternOptions(
  character: HofCharacter | null,
  selectedPatternSlot: number | null,
): BattlePartyPatternOption[] {
  if (character == null || character.patternSlotCount <= 0) return [];

  const savedPatternOptions = (character.patternSlots ?? [])
    .map((patternSlot) => {
      const slot = Number.parseInt(patternSlot.slot, 10);
      if (!Number.isInteger(slot) || slot < 0) return null;

      const label = patternSlot.label.trim().length > 0
        ? patternSlot.label.trim()
        : `패턴 ${slot + 1}`;

      return {
        slot,
        label,
        selected: selectedPatternSlot === slot,
      };
    })
    .filter((option): option is BattlePartyPatternOption => option != null)
    .sort((left, right) => left.slot - right.slot);
  if (savedPatternOptions.length > 0) return savedPatternOptions;

  return Array.from({ length: character.patternSlotCount }, (_, slot) => ({
    slot,
    label: `패턴 ${slot + 1}`,
    selected: selectedPatternSlot === slot,
  }));
}

/**
 * 전투 요청을 만들 수 있는 파티 상태인지 검증한다.
 *
 * @remarks
 * 정확히 5명, 중복 캐릭터 없음, 각 캐릭터마다 유효한 패턴 슬롯이 있어야 한다.
 */
export function isBattlePartyReady(
  party: BattlePartyMember[],
  characters: HofCharacter[],
): boolean {
  if (party.length !== BATTLE_PARTY_SIZE) return false;

  const selectedIds = party
    .map((member) => member.characterId)
    .filter((characterId): characterId is string => characterId != null && characterId.trim().length > 0);
  if (selectedIds.length !== BATTLE_PARTY_SIZE) return false;
  if (new Set(selectedIds).size !== selectedIds.length) return false;

  return party.every((member) => {
    if (member.characterId == null || member.characterId.trim().length === 0) return false;
    const character = characters.find((candidate) => candidate.hofCharacterId === member.characterId);
    return character != null && isValidPatternSlot(character, member.patternSlot);
  });
}

/**
 * 앱의 파티 편집 상태를 백엔드 전투 실행 API 요청으로 변환한다.
 *
 * @throws 전투 가능한 파티가 아니면 사용자에게 보여줄 수 있는 Error를 던진다.
 */
export function toRunBattleRequest(input: ToRunBattleRequestInput): RunBattleRequest {
  if (!isBattlePartyReady(input.party, input.characters)) {
    throw new Error('전투에 사용할 캐릭터 5명을 모두 선택해야 합니다.');
  }

  const selectedMembers = input.party
    .filter((member): member is BattlePartyMember & { characterId: string; patternSlot: number } => (
      member.characterId != null
      && member.characterId.trim().length > 0
      && member.patternSlot != null
    ));
  const characterIds = selectedMembers.map((member) => member.characterId);
  const patternLoads: BattlePatternLoadRequest[] = selectedMembers.map((member) => ({
    characterId: member.characterId,
    slot: member.patternSlot,
  }));

  return {
    categoryId: input.categoryId,
    mapCode: input.mapCode,
    characterIds,
    patternLoads,
    battleCount: input.battleCount,
  };
}

/**
 * 캐릭터를 처음 슬롯에 넣을 때 자동 선택할 기본 패턴 번호를 정한다.
 */
function defaultPatternSlot(character: HofCharacter | null): number | null {
  return character != null && character.patternSlotCount > 0 ? 0 : null;
}

/**
 * 선택된 패턴 번호가 해당 캐릭터가 실제로 가진 저장 패턴 범위 안에 있는지 확인한다.
 */
function isValidPatternSlot(character: HofCharacter, patternSlot: number | null): boolean {
  return (
    patternSlot != null
    && Number.isInteger(patternSlot)
    && patternSlot >= 0
    && patternSlot < character.patternSlotCount
  );
}

/**
 * 캐릭터 검색에서 비교할 문자열을 만든다.
 *
 * 이름/직업/레벨/캐릭터 ID를 한 번에 검색할 수 있도록 하나의 문자열로 합친다.
 */
function characterSearchText(character: HofCharacter): string {
  return normalizeSearchText([
    character.name,
    character.job,
    character.level == null ? '' : `lv.${character.level}`,
    character.level == null ? '' : `lv${character.level}`,
    character.level == null ? '' : character.level.toString(),
    character.hofCharacterId,
  ].join(' '));
}

/**
 * 검색어 비교가 대소문자나 앞뒤 공백에 흔들리지 않도록 정규화한다.
 */
function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('ko-KR');
}
