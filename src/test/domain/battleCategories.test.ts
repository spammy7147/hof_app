import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { orderBattleCategories } from '../../main/domain/battleCategories';
import type { BattleCategoryResponse } from '../../main/types/api';

describe('battle category utilities', () => {
  it('orders enabled categories first by display order and label', () => {
    const ordered = orderBattleCategories([
      battleCategory({ id: 'raid', label: '레이드', description: '레이드 신청과 관리', order: 50 }),
      battleCategory({ id: 'disabled', label: '비활성', description: '아직 사용할 수 없음', order: 1, enabled: false }),
      battleCategory({ id: 'union', label: '유니온', description: '유니온 전투', order: 30 }),
      battleCategory({ id: 'battle_map', label: '전투맵', description: '기본 전투 맵', order: 10 }),
    ]);

    assert.deepEqual(
      ordered.map((category) => category.id),
      ['battle_map', 'union', 'raid', 'disabled'],
    );
  });

  it('places scenario before union and shortens the scenario-sea label', () => {
    const ordered = orderBattleCategories([
      battleCategory({ id: 'union', label: '유니온', order: 30 }),
      battleCategory({ id: 'scenario_sea', label: '시나리오-대해', order: 40 }),
      battleCategory({ id: 'raid', label: '레이드', order: 50 }),
      battleCategory({ id: 'battle_map', label: '전투맵', order: 10 }),
    ]);

    assert.deepEqual(
      ordered.map((category) => [category.id, category.label]),
      [
        ['battle_map', '전투맵'],
        ['scenario_sea', '시나리오'],
        ['union', '유니온'],
        ['raid', '레이드'],
      ],
    );
  });
});

function battleCategory(overrides: Partial<BattleCategoryResponse>): BattleCategoryResponse {
  return {
    id: 'category',
    label: '카테고리',
    description: '',
    order: 0,
    enabled: true,
    ...overrides,
  };
}
