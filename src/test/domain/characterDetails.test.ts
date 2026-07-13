import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { HofCharacterDetail } from '../../main/types/api';
import {
  buildCharacterDetailMetrics,
  groupSkillsByCategory,
} from '../../main/domain/characterDetails';

describe('character detail utilities', () => {
  const detail: HofCharacterDetail = {
    id: 10,
    hofCharacterId: '111',
    name: '소셜',
    job: 'Social Knight',
    level: 60,
    patternSlotCount: 1,
    imageUrl: 'http://sic.zerosic.com/ZeroHOF/image/char/sknight02.gif',
    statusLines: ['HP : 5628 + 5033'],
    patternSlots: [{ slot: '0', label: '범용', canLoad: true }],
    stats: {
      atk: 116,
      matk: 5,
      defBase: 141,
      defBonus: 1649,
      mdefBase: 111,
      mdefBonus: 1089,
      handleUsed: 25,
      handleMax: 25,
      costUsed: 0,
      costMax: 10,
    },
    actionPatterns: [
      {
        index: 0,
        judge: '1701',
        judgeText: '자신이 후방',
        quantity: '0',
        quantityText: '0',
        skill: '4003',
        skillText: 'Stance Restore(Self) - (SP:0)',
      },
    ],
    positionGuard: {
      positions: [
        { value: 'front', checked: true },
        { value: 'back', checked: false },
      ],
      selectedPosition: 'front',
      guardValue: 'always',
      guardText: '반드시 지킨다',
    },
    equipment: [
      {
        slot: 'weapon',
        part: 'Weapon',
        name: "Soulcollector's Sword Breaker",
        iconUrl: 'swordb.gif',
        description: 'Atk:96',
        checked: false,
      },
    ],
    learnedSkills: [
      {
        value: '',
        name: 'Attack / enemy - individual',
        iconUrl: 'skill_042.png',
        category: '사용 가능 스킬(Mastered)',
      },
      {
        value: '',
        name: 'Guard / self - individual',
        iconUrl: 'guard.png',
        category: '공용 스킬(Common)',
      },
    ],
    learnableSkills: [
      {
        value: '1014',
        name: 'Double Quick Slash / 8pt',
        iconUrl: 'skill_074z.png',
        category: '',
      },
    ],
  };

  it('builds compact stat metrics for the mobile detail screen', () => {
    assert.deepEqual(buildCharacterDetailMetrics(detail), [
      { label: 'Atk', value: '116' },
      { label: 'Matk', value: '5' },
      { label: 'Def', value: '141 + 1,649' },
      { label: 'Mdef', value: '111 + 1,089' },
      { label: 'handle', value: '25/25' },
      { label: 'cost', value: '0/10' },
    ]);
  });

  it('groups learned skills by backend category and keeps learnable skills separate', () => {
    assert.deepEqual(groupSkillsByCategory(detail.learnedSkills), [
      {
        category: '사용 가능 스킬(Mastered)',
        skills: [detail.learnedSkills[0]],
      },
      {
        category: '공용 스킬(Common)',
        skills: [detail.learnedSkills[1]],
      },
    ]);
    assert.equal(detail.learnableSkills[0]?.value, '1014');
  });
});
