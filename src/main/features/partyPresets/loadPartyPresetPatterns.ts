import type { ManualSequenceApi } from '../../services/backendApi';
import type { HofCharacter, PartyPresetResponse } from '../../types/api';

/** 프리셋 전체를 하나의 수동 작업으로 실행하며 결과가 불명확하면 다음 캐릭터로 진행하지 않는다. */
export async function loadPartyPresetPatterns(api: ManualSequenceApi, preset: PartyPresetResponse, characters: HofCharacter[]): Promise<string> {
  const members = preset.members.filter((member) => member.characterId != null);
  const targets = members.filter((member) => member.patternSlot != null);
  const skipped = members.length - targets.length;
  return api.runManualSequence(async (requests) => {
    let completed = 0;
    for (const member of targets) {
      if (!requests.isCurrent()) break;
      const character = characters.find((item) => item.hofCharacterId === member.characterId);
      try {
        if (!character || (character.lifecycle && character.lifecycle !== 'ACTIVE')) {
          throw new Error('현재 캐릭터 목록에서 사용할 수 없습니다. 동기화 후 다시 시도하세요.');
        }
        const slotCode = character.patternSlots?.find((slot) => Number(slot.slot) === member.patternSlot)?.slot
          ?? String(member.patternSlot);
        const result = await requests.loadSavedPattern(character.id, slotCode);
        if (!requests.isCurrent()) break;
        if (!result.revision) throw new Error(result.message ?? '패턴 적용 결과를 확인하지 못했습니다.');
        completed += 1;
      } catch (error) {
        if (!requests.isCurrent()) break;
        return `${completed}명 완료 · ${targets.length - completed - 1}명 미실행 · ${skipped}명 패턴 미지정\n${character?.name ?? member.characterId}: ${error instanceof Error ? error.message : '패턴불러오기에 실패했습니다.'}`;
      }
    }
    return `${completed}명 완료 · ${targets.length - completed}명 미실행 · ${skipped}명 패턴 미지정`;
  });
}
