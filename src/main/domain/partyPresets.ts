import {
  BATTLE_PARTY_SIZE,
  sanitizeBattlePartyForCharacters,
  type BattlePartyMember,
} from './battleParty';
import type {
  CreatePartyPresetRequest,
  HofCharacter,
  PartyPresetResponse,
} from '../types/api';

/**
 * 새 파티 프리셋을 만들 때 사용할 기본 요청값을 생성한다.
 */
export function buildCreatePartyPresetRequest(): CreatePartyPresetRequest {
  return {
    name: '새 프리셋',
    members: emptyPartyMembers(),
  };
}

/**
 * 백엔드에 저장된 프리셋 멤버 목록을 전투 파티 UI 상태로 변환한다.
 *
 * @remarks
 * 저장된 슬롯이 일부 누락되어도 항상 5칸짜리 배열을 반환해서 UI가 단순하게 렌더링되도록 한다.
 */
export function createPartyFromPreset(preset: PartyPresetResponse): BattlePartyMember[] {
  const bySlot = new Map(
    preset.members
      .filter((member) => Number.isInteger(member.slotIndex) && member.slotIndex >= 0 && member.slotIndex < BATTLE_PARTY_SIZE)
      .map((member) => [member.slotIndex, member]),
  );

  return emptyPartyMembers().map((emptyMember) => {
    const member = bySlot.get(emptyMember.slotIndex);
    if (member == null) return emptyMember;

    return {
      slotIndex: emptyMember.slotIndex,
      characterId: normalizeCharacterId(member.characterId),
      patternSlot: normalizePatternSlot(member.patternSlot),
    };
  });
}

/**
 * 저장된 프리셋을 현재 동기화 상태에서 실행 가능한 5칸 파티로 변환한다.
 */
export function createExecutablePartyFromPreset(
  preset: PartyPresetResponse,
  characters: HofCharacter[],
): BattlePartyMember[] {
  return sanitizeBattlePartyForCharacters(createPartyFromPreset(preset), characters);
}

/**
 * 프리셋 선택 후 캐릭터 동기화가 갱신될 때 실행 가능한 파티를 다시 만든다.
 *
 * 사용자가 건드리지 않은 슬롯은 원본 프리셋에서 복원하고, 편집한 슬롯은 현재 값을 유지한다.
 */
export function rehydrateExecutablePartyFromPresetSeed(
  presetSeed: BattlePartyMember[],
  currentParty: BattlePartyMember[],
  dirtySlotIndexes: ReadonlySet<number>,
  characters: HofCharacter[],
): BattlePartyMember[] {
  const currentBySlot = new Map(
    currentParty.map((member) => [member.slotIndex, member]),
  );
  const mergedParty = presetSeed.map((seedMember) => (
    dirtySlotIndexes.has(seedMember.slotIndex)
      ? currentBySlot.get(seedMember.slotIndex) ?? seedMember
      : seedMember
  ));

  return sanitizeBattlePartyForCharacters(mergedParty, characters);
}

/** 캐릭터 또는 패턴 값이 달라진 모든 파티 슬롯 번호를 반환한다. */
export function getChangedBattlePartySlotIndexes(
  currentParty: BattlePartyMember[],
  nextParty: BattlePartyMember[],
): number[] {
  const currentBySlot = new Map(
    currentParty.map((member) => [member.slotIndex, member]),
  );

  return nextParty.flatMap((nextMember) => {
    const currentMember = currentBySlot.get(nextMember.slotIndex);
    return currentMember?.characterId === nextMember.characterId
      && currentMember.patternSlot === nextMember.patternSlot
      ? []
      : [nextMember.slotIndex];
  });
}

/**
 * 프리셋 이름이나 현재 동기화된 멤버 정보로 프리셋을 검색한다.
 */
export function filterPartyPresets(
  presets: PartyPresetResponse[],
  characters: HofCharacter[],
  query: string,
): PartyPresetResponse[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return presets;
  const charactersById = new Map(
    characters.map((character) => [character.hofCharacterId, character]),
  );

  return presets.filter((preset) => {
    if (normalizeSearchText(preset.name).includes(normalizedQuery)) return true;

    return preset.members.some((member) => {
      const character = member.characterId == null
        ? null
        : charactersById.get(member.characterId) ?? null;
      return character != null && (
        normalizeSearchText(character.name).includes(normalizedQuery)
        || normalizeSearchText(character.job).includes(normalizedQuery)
      );
    });
  });
}

/**
 * 프리셋 카드에 표시할 `몇 명 설정` 요약 문구를 만든다.
 */
export function formatPartyPresetSummary(preset: PartyPresetResponse): string {
  const memberCount = createPartyFromPreset(preset)
    .filter((member) => member.characterId != null)
    .length;

  return `${memberCount.toLocaleString('en-US')}명 설정`;
}

/** PRIMARY는 현재 대표 이름을 동적으로 표시하고 EXPLICIT은 저장된 ID의 이름을 고정해 표시한다. */
export function formatAutomationPresetSelection(
  selection: { presetMode: 'PRIMARY' | 'EXPLICIT'; partyPresetId: number | null },
  presets: readonly PartyPresetResponse[],
): string {
  if (selection.presetMode === 'PRIMARY') {
    const primary = presets.find(({ isPrimary }) => isPrimary);
    return primary ? `대표 · ${primary.name}` : '대표 프리셋 없음';
  }
  return presets.find(({ id }) => id === selection.partyPresetId)?.name
    ?? `삭제된 프리셋 #${selection.partyPresetId}`;
}

/**
 * 캐릭터와 패턴이 비어 있는 5인 파티 배열을 만든다.
 */
export function emptyPartyMembers(): BattlePartyMember[] {
  return Array.from({ length: BATTLE_PARTY_SIZE }, (_, slotIndex) => ({
    slotIndex,
    characterId: null,
    patternSlot: null,
  }));
}

function normalizeCharacterId(characterId: string | null): string | null {
  if (characterId == null) return null;
  const trimmed = characterId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePatternSlot(patternSlot: number | null): number | null {
  return Number.isInteger(patternSlot) && patternSlot != null && patternSlot >= 0
    ? patternSlot
    : null;
}

export function normalizePartyPresetSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('ko-KR');
}

const normalizeSearchText = normalizePartyPresetSearchText;
