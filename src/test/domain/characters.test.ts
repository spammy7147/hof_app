import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { groupCharactersByJob, sortCharactersByRosterOrder } from '../../main/domain/characters';

describe('character utilities', () => {
  it('keeps the HOF roster order in the ungrouped character list', () => {
    const characters = [
      { id: 1, hofCharacterId: '1', name: '셋', job: 'Knight', level: 1, patternSlotCount: 0, rosterOrder: 2, revision: '2026-08-17T00:00:00Z' },
      { id: 2, hofCharacterId: '2', name: '하나', job: 'Knight', level: 1, patternSlotCount: 0, rosterOrder: 0, revision: '2026-08-17T00:00:00Z' },
      { id: 3, hofCharacterId: '3', name: '둘', job: 'Knight', level: 1, patternSlotCount: 0, rosterOrder: 1, revision: '2026-08-17T00:00:00Z' },
    ];

    assert.deepEqual(sortCharactersByRosterOrder(characters).map((item) => item.id), [2, 3, 1]);
  });

  it('keeps the server response order when legacy records do not have a roster order yet', () => {
    const characters = [
      { id: 1, hofCharacterId: '1', name: '소셜', job: 'Social Knight', level: 60, patternSlotCount: 0, revision: '2026-08-17T00:00:00Z' },
      { id: 2, hofCharacterId: '2', name: '사제', job: 'Cardinal', level: 60, patternSlotCount: 0, revision: '2026-08-17T00:00:00Z' },
      { id: 3, hofCharacterId: '3', name: '춘장이', job: 'Desperado', level: 60, patternSlotCount: 0, revision: '2026-08-17T00:00:00Z' },
    ];

    assert.deepEqual(sortCharactersByRosterOrder(characters).map((item) => item.name), ['소셜', '사제', '춘장이']);
  });

  it('groups characters by job and sorts each job by level descending then name', () => {
    const grouped = groupCharactersByJob([
      {
        id: 1,
        hofCharacterId: '1',
        name: '남세이지',
        job: 'Sage',
        level: 34,
        patternSlotCount: 3,
        revision: '2026-08-17T00:00:00Z',
      },
      {
        id: 2,
        hofCharacterId: '2',
        name: '여세이지',
        job: 'Sage',
        level: 51,
        patternSlotCount: 3,
        revision: '2026-08-17T00:00:00Z',
      },
      {
        id: 3,
        hofCharacterId: '3',
        name: '소셜',
        job: 'Social Knight',
        level: 60,
        patternSlotCount: 7,
        revision: '2026-08-17T00:00:00Z',
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
        revision: '2026-08-17T00:00:00Z',
      },
    ]);

    assert.equal(grouped[0]?.job, '미분류');
  });
});
