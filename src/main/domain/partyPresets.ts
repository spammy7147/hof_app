import {
  BATTLE_PARTY_SIZE,
  sanitizeBattlePartyForCharacters,
  type BattlePartyMember,
} from './battleParty';
import type { CreatePartyPresetRequest, HofCharacter, PartyPresetResponse } from '../types/api';

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
      return character != null && normalizeSearchText([
        character.name,
        character.job,
      ].join(' ')).includes(normalizedQuery);
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

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('ko-KR');
}
