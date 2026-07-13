import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BATTLE_PARTY_SIZE,
  createDefaultBattleParty,
  buildBattlePartyCharacterOptions,
  buildBattlePartyPatternOptions,
  filterBattlePartyCharacterOptions,
  isBattlePartyReady,
  toRunBattleRequest,
  updateBattlePartyMember,
  updateBattlePartyPattern,
} from '../../main/domain/battleParty';
import { makeHofCharacter } from '../fixtures/api';

describe('battleParty', () => {
  it('creates a five member default party from the first synced characters', () => {
    const characters = Array.from({ length: 6 }, (_, index) => makeHofCharacter(index + 1));

    const party = createDefaultBattleParty(characters);

    assert.equal(party.length, BATTLE_PARTY_SIZE);
    assert.deepEqual(
      party.map((member) => member.characterId),
      ['char-1', 'char-2', 'char-3', 'char-4', 'char-5'],
    );
    assert.deepEqual(
      party.map((member) => member.patternSlot),
      [0, 0, 0, 0, 0],
    );
    assert.equal(isBattlePartyReady(party, characters), true);
  });

  it('builds a 3-round battle request with each member pattern', () => {
    const characters = Array.from({ length: 5 }, (_, index) => makeHofCharacter(index + 1));
    const party = createDefaultBattleParty(characters)
      .map((member, index) => updateBattlePartyPattern([member], 0, index)[0]);

    const request = toRunBattleRequest({
      categoryId: 'battle_map',
      mapCode: 'snow22',
      party,
      characters,
      battleCount: 3,
    });

    assert.deepEqual(request, {
      categoryId: 'battle_map',
      mapCode: 'snow22',
      characterIds: ['char-1', 'char-2', 'char-3', 'char-4', 'char-5'],
      patternLoads: [
        { characterId: 'char-1', slot: 0 },
        { characterId: 'char-2', slot: 1 },
        { characterId: 'char-3', slot: 2 },
        { characterId: 'char-4', slot: 3 },
        { characterId: 'char-5', slot: 4 },
      ],
      battleCount: 3,
    });
  });

  it('builds a battle request with only selected party members when slots are intentionally empty', () => {
    const characters = Array.from({ length: 5 }, (_, index) => makeHofCharacter(index + 1));
    const party = updateBattlePartyMember(
      updateBattlePartyMember(
        updateBattlePartyMember(createDefaultBattleParty(characters), 2, null, characters),
        3,
        null,
        characters,
      ),
      4,
      null,
      characters,
    );

    const request = toRunBattleRequest({
      categoryId: 'battle_map',
      mapCode: 'snow22',
      party,
      characters,
      battleCount: 1,
    });

    assert.equal(isBattlePartyReady(party, characters), true);
    assert.deepEqual(request, {
      categoryId: 'battle_map',
      mapCode: 'snow22',
      characterIds: ['char-1', 'char-2'],
      patternLoads: [
        { characterId: 'char-1', slot: 0 },
        { characterId: 'char-2', slot: 0 },
      ],
      battleCount: 1,
    });
  });

  it('does not allow battle requests when every party slot is empty', () => {
    const characters = Array.from({ length: 5 }, (_, index) => makeHofCharacter(index + 1));
    const party = createDefaultBattleParty(characters)
      .map((member) => ({ ...member, characterId: null, patternSlot: null }));

    assert.equal(isBattlePartyReady(party, characters), false);
    assert.throws(
      () => toRunBattleRequest({
        categoryId: 'battle_map',
        mapCode: 'snow22',
        party,
        characters,
        battleCount: 1,
      }),
      /전투에 사용할 캐릭터를 1명 이상 선택해야 합니다/,
    );
  });

  it('keeps the same character out of multiple party slots', () => {
    const characters = Array.from({ length: 5 }, (_, index) => makeHofCharacter(index + 1));
    const party = createDefaultBattleParty(characters);

    const updatedParty = updateBattlePartyMember(party, 1, 'char-1', characters);

    assert.equal(updatedParty[0].characterId, null);
    assert.equal(updatedParty[1].characterId, 'char-1');
  });

  it('marks dropdown character options as selected or already used for the active slot', () => {
    const characters = Array.from({ length: 6 }, (_, index) => makeHofCharacter(index + 1));
    const party = createDefaultBattleParty(characters);

    const options = buildBattlePartyCharacterOptions(party, characters, 1);

    assert.deepEqual(
      options.map((option) => ({
        characterId: option.character?.hofCharacterId ?? null,
        selected: option.selected,
        alreadyUsed: option.alreadyUsed,
      })),
      [
        { characterId: null, selected: false, alreadyUsed: false },
        { characterId: 'char-1', selected: false, alreadyUsed: true },
        { characterId: 'char-2', selected: true, alreadyUsed: false },
        { characterId: 'char-3', selected: false, alreadyUsed: true },
        { characterId: 'char-4', selected: false, alreadyUsed: true },
        { characterId: 'char-5', selected: false, alreadyUsed: true },
        { characterId: 'char-6', selected: false, alreadyUsed: false },
      ],
    );
  });

  it('filters dropdown character options by name, job, level, or character id while keeping empty option first', () => {
    const characters = [
      makeHofCharacter(1, { name: '소셜', job: 'Social Knight', level: 60 }),
      makeHofCharacter(2, { name: '사제', job: 'Cardinal', level: 59 }),
      makeHofCharacter(3, { name: '도둑', job: 'Rogue', level: 34 }),
    ];
    const options = buildBattlePartyCharacterOptions(createDefaultBattleParty(characters), characters, 0);

    assert.deepEqual(
      filterBattlePartyCharacterOptions(options, 'card').map((option) => option.character?.hofCharacterId ?? null),
      [null, 'char-2'],
    );
    assert.deepEqual(
      filterBattlePartyCharacterOptions(options, 'Lv.34').map((option) => option.character?.hofCharacterId ?? null),
      [null, 'char-3'],
    );
    assert.deepEqual(
      filterBattlePartyCharacterOptions(options, '소셜').map((option) => option.character?.hofCharacterId ?? null),
      [null, 'char-1'],
    );
  });

  it('builds pattern options from the selected character saved pattern names', () => {
    const character = {
      ...makeHofCharacter(1, { patternSlotCount: 4 }),
      patternSlots: [
        { slot: '0', label: '범용', canLoad: true },
        { slot: '1', label: '대회랑', canLoad: true },
        { slot: '2', label: '산중', canLoad: true },
      ],
    };

    assert.deepEqual(
      buildBattlePartyPatternOptions(character, 2),
      [
        { slot: 0, label: '범용', selected: false },
        { slot: 1, label: '대회랑', selected: false },
        { slot: 2, label: '산중', selected: true },
      ],
    );
    assert.deepEqual(buildBattlePartyPatternOptions(null, null), []);
    assert.deepEqual(buildBattlePartyPatternOptions(makeHofCharacter(2, { patternSlotCount: 0 }), null), []);
  });

  it('falls back to numbered pattern options when saved pattern names are absent', () => {
    const character = makeHofCharacter(1, { patternSlotCount: 2 });

    assert.deepEqual(
      buildBattlePartyPatternOptions(character, 1),
      [
        { slot: 0, label: '패턴 1', selected: false },
        { slot: 1, label: '패턴 2', selected: true },
      ],
    );
  });
});
