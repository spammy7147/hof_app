import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BattlePartyMember } from '../../main/domain/battleParty';
import {
  buildCreatePartyPresetRequest,
  createExecutablePartyFromPreset,
  createPartyFromPreset,
  filterPartyPresets,
  formatPartyPresetSummary,
  getChangedBattlePartySlotIndexes,
  rehydrateExecutablePartyFromPresetSeed,
} from '../../main/domain/partyPresets';
import type { PartyPresetResponse } from '../../main/types/api';
import { makeHofCharacter } from '../fixtures/api';

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

  it('filters presets by trimmed, case-insensitive preset name', () => {
    const presets = [
      makePreset({ id: 1, name: 'Goblin Party' }),
      makePreset({ id: 2, name: '대회랑 파티' }),
    ];

    assert.deepEqual(
      filterPartyPresets(presets, [], '  gObLiN  ').map((preset) => preset.id),
      [1],
    );
    assert.deepEqual(
      filterPartyPresets(presets, [], '   ').map((preset) => preset.id),
      [1, 2],
    );
  });

  it('filters presets by a currently synced member character name', () => {
    const presets = [
      makePreset({
        id: 1,
        name: '첫 번째 파티',
        members: [{ slotIndex: 0, characterId: 'char-1', patternSlot: 0 }],
      }),
      makePreset({
        id: 2,
        name: '두 번째 파티',
        members: [{ slotIndex: 0, characterId: 'char-2', patternSlot: 0 }],
      }),
    ];
    const characters = [
      makeHofCharacter(1, { name: '달빛 기사' }),
      makeHofCharacter(2, { name: '태양 사제' }),
    ];

    assert.deepEqual(
      filterPartyPresets(presets, characters, '태양').map((preset) => preset.id),
      [2],
    );
  });

  it('filters presets by a trimmed, case-insensitive synced member job without searching missing member ids', () => {
    const presets = [
      makePreset({
        id: 1,
        name: '동기화 해제 파티',
        members: [{ slotIndex: 0, characterId: 'social', patternSlot: 0 }],
      }),
      makePreset({
        id: 2,
        name: '기사 파티',
        members: [{ slotIndex: 0, characterId: 'char-1', patternSlot: 0 }],
      }),
    ];
    const characters = [makeHofCharacter(1, { job: 'Social Knight' })];

    assert.deepEqual(
      filterPartyPresets(presets, characters, '  sOcIaL  ').map((preset) => preset.id),
      [2],
    );
  });

  it('matches each member field independently without allowing a query to span name and job', () => {
    const presets = [
      makePreset({
        id: 1,
        name: '공략 파티',
        members: [{ slotIndex: 0, characterId: 'char-1', patternSlot: 0 }],
      }),
    ];
    const characters = [makeHofCharacter(1, { name: 'Alpha', job: 'Beta' })];

    assert.deepEqual(filterPartyPresets(presets, characters, 'ha be'), []);
    assert.deepEqual(
      filterPartyPresets(presets, characters, '  aLpHa  ').map((preset) => preset.id),
      [1],
    );
    assert.deepEqual(
      filterPartyPresets(presets, characters, '  bEtA  ').map((preset) => preset.id),
      [1],
    );
  });

  it('creates a five-slot executable party and clears a missing preset member', () => {
    const preset = makePreset({
      members: [
        { slotIndex: 0, characterId: 'char-1', patternSlot: 1 },
        { slotIndex: 2, characterId: 'missing-character', patternSlot: 3 },
      ],
    });

    assert.deepEqual(createExecutablePartyFromPreset(preset, [makeHofCharacter(1)]), [
      { slotIndex: 0, characterId: 'char-1', patternSlot: 1 },
      { slotIndex: 1, characterId: null, patternSlot: null },
      { slotIndex: 2, characterId: null, patternSlot: null },
      { slotIndex: 3, characterId: null, patternSlot: null },
      { slotIndex: 4, characterId: null, patternSlot: null },
    ]);
  });

  it('rehydrates untouched preset slots when characters arrive after an empty sync', () => {
    const preset = makePreset({
      members: [
        { slotIndex: 0, characterId: 'char-1', patternSlot: 1 },
        { slotIndex: 1, characterId: 'char-2', patternSlot: 2 },
      ],
    });
    const presetSeed = createPartyFromPreset(preset);
    const initiallyExecutable = rehydrateExecutablePartyFromPresetSeed(
      presetSeed,
      createExecutablePartyFromPreset(preset, []),
      new Set(),
      [],
    );

    assert.deepEqual(initiallyExecutable.map((member) => member.characterId), [
      null,
      null,
      null,
      null,
      null,
    ]);
    assert.deepEqual(
      rehydrateExecutablePartyFromPresetSeed(
        presetSeed,
        initiallyExecutable,
        new Set(),
        [makeHofCharacter(1), makeHofCharacter(2)],
      ).slice(0, 2),
      [
        { slotIndex: 0, characterId: 'char-1', patternSlot: 1 },
        { slotIndex: 1, characterId: 'char-2', patternSlot: 2 },
      ],
    );
  });

  it('rehydrates untouched slots after a partial sync while preserving a dirty slot', () => {
    const preset = makePreset({
      members: [
        { slotIndex: 0, characterId: 'char-1', patternSlot: 1 },
        { slotIndex: 1, characterId: 'char-2', patternSlot: 2 },
      ],
    });
    const presetSeed = createPartyFromPreset(preset);
    const partialParty = createExecutablePartyFromPreset(
      preset,
      [makeHofCharacter(1), makeHofCharacter(3)],
    );
    const editedParty = partialParty.map((member) => (
      member.slotIndex === 0
        ? { ...member, characterId: 'char-3', patternSlot: 4 }
        : member
    ));

    assert.deepEqual(
      rehydrateExecutablePartyFromPresetSeed(
        presetSeed,
        editedParty,
        new Set([0]),
        [makeHofCharacter(1), makeHofCharacter(2), makeHofCharacter(3)],
      ).slice(0, 2),
      [
        { slotIndex: 0, characterId: 'char-3', patternSlot: 4 },
        { slotIndex: 1, characterId: 'char-2', patternSlot: 2 },
      ],
    );
  });

  it('reports every character or pattern change when an edit affects multiple slots', () => {
    const current: BattlePartyMember[] = [
      { slotIndex: 0, characterId: 'char-1', patternSlot: 1 },
      { slotIndex: 1, characterId: 'char-2', patternSlot: 2 },
      { slotIndex: 2, characterId: 'char-3', patternSlot: 0 },
    ];
    const next: BattlePartyMember[] = [
      { slotIndex: 0, characterId: null, patternSlot: null },
      { slotIndex: 1, characterId: 'char-1', patternSlot: 0 },
      { slotIndex: 2, characterId: 'char-3', patternSlot: 3 },
    ];

    assert.deepEqual(getChangedBattlePartySlotIndexes(current, next), [0, 1, 2]);
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
