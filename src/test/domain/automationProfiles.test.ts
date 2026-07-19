import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { filterAutomationProfileCategories } from '../../main/domain/automationProfiles';
import type { BattleCategoryResponse } from '../../main/types/api';

describe('automation category filtering', () => {
  it('excludes union categories from quest automation', () => {
    const categories = [
      { id: 'battle_map', label: '전투', enabled: true },
      { id: 'union', label: '유니온', enabled: true },
      { id: 'union_map', label: '연합', enabled: true },
      { id: 'adventure_map', label: '모험', enabled: true },
    ] as BattleCategoryResponse[];

    assert.deepEqual(
      filterAutomationProfileCategories(categories).map(({ id }) => id),
      ['battle_map', 'adventure_map'],
    );
  });
});
