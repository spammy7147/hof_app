import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCreatePartyPresetRequest,
  createPartyFromPreset,
  formatPartyPresetSummary,
} from '../../main/domain/partyPresets';
import type { PartyPresetResponse } from '../../main/types/api';

describe('partyPresets', () => {
  it('builds a compact empty five-slot preset request', () => {
    assert.deepEqual(buildCreatePartyPresetRequest(), {
      name: '새 프리셋',
      members: [
        { slotIndex: 0, characterId: null, patternSlot: null },
        { slotIndex: 1, characterId: null, patternSlot: null },
        { slotIndex: 2, characterId: null, patternSlot: null },
        { slotIndex: 3, characterId: null, patternSlot: null },
        { slotIndex: 4, characterId: null, patternSlot: null },
      ],
    });
  });

  it('converts stored preset members into the reusable battle party shape', () => {
    const preset = makePreset({
      members: [
        { slotIndex: 2, characterId: 'char-3', patternSlot: 2 },
        { slotIndex: 0, characterId: 'char-1', patternSlot: 0 },
        { slotIndex: 1, characterId: 'char-2', patternSlot: 1 },
        { slotIndex: 3, characterId: null, patternSlot: null },
        { slotIndex: 4, characterId: 'char-5', patternSlot: 4 },
      ],
    });

    const party = createPartyFromPreset(preset);

    assert.deepEqual(party, [
      { slotIndex: 0, characterId: 'char-1', patternSlot: 0 },
      { slotIndex: 1, characterId: 'char-2', patternSlot: 1 },
      { slotIndex: 2, characterId: 'char-3', patternSlot: 2 },
      { slotIndex: 3, characterId: null, patternSlot: null },
      { slotIndex: 4, characterId: 'char-5', patternSlot: 4 },
    ]);
    assert.equal(formatPartyPresetSummary(preset), '4명 설정');
  });

  it('fills missing preset slots with empty slots', () => {
    const preset = makePreset({
      members: [
        { slotIndex: 0, characterId: 'char-1', patternSlot: 0 },
        { slotIndex: 4, characterId: 'char-5', patternSlot: 4 },
      ],
    });

    const party = createPartyFromPreset(preset);

    assert.deepEqual(party.map((member) => member.characterId), ['char-1', null, null, null, 'char-5']);
    assert.equal(formatPartyPresetSummary(preset), '2명 설정');
  });
});

function makePreset(overrides: Partial<PartyPresetResponse> = {}): PartyPresetResponse {
  return {
    id: 1,
    accountId: 1,
    name: '고블린 범용 파티',
    members: [],
    createdAt: '2026-07-11T00:00:00Z',
    updatedAt: '2026-07-11T00:00:00Z',
    ...overrides,
  };
}
