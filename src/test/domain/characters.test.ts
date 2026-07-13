import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { groupCharactersByJob } from '../../main/domain/characters';

describe('character utilities', () => {
  it('groups characters by job and sorts each job by level descending then name', () => {
    const grouped = groupCharactersByJob([
      {
        id: 1,
        hofCharacterId: '1',
        name: '남세이지',
        job: 'Sage',
        level: 34,
        patternSlotCount: 3,
      },
      {
        id: 2,
        hofCharacterId: '2',
        name: '여세이지',
        job: 'Sage',
        level: 51,
        patternSlotCount: 3,
      },
      {
        id: 3,
        hofCharacterId: '3',
        name: '소셜',
        job: 'Social Knight',
        level: 60,
        patternSlotCount: 7,
      },
    ]);

    assert.deepEqual(
      grouped.map((group) => ({
        job: group.job,
        count: group.characters.length,
        names: group.characters.map((character) => character.name),
      })),
      [
        { job: 'Sage', count: 2, names: ['여세이지', '남세이지'] },
        { job: 'Social Knight', count: 1, names: ['소셜'] },
      ],
    );
  });

  it('uses uncategorized when the backend job is empty', () => {
    const grouped = groupCharactersByJob([
      {
        id: 1,
        hofCharacterId: '1',
        name: '(이름없음)',
        job: '',
        level: null,
        patternSlotCount: 0,
      },
    ]);

    assert.equal(grouped[0]?.job, '미분류');
  });
});
