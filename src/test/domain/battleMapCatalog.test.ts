import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBattleMapCatalogRows } from '../../main/domain/battleMapCatalog';
import { buildBattleMapStateKey } from '../../main/domain/battleMaps';
import type { BattleCategoryResponse, BattleMapResponse } from '../../main/types/api';

describe('battle map automation catalog rows', () => {
  it('orders supported enabled categories and reveals only manually expanded groups', () => {
    const catalog = [
      map('battle_map', 'g2', '강한 고블린', '고블린 부락', 0, 1),
      map('battle_map', 'g1', '약한 고블린', '고블린 부락', 0, 0),
      map('battle_map', 'c1', '동굴 입구', '고대의 동굴', 1, 0),
      map('scenario_ocean', 's1', '연안', '연안 항로', 0, 0),
      map('adventure_map', 'daily', '일일 모험', '모험', 0, 0),
      map('union', 'union-map', '유니온', '유니온', 0, 0),
    ];

    const result = buildBattleMapCatalogRows({
      categories: categories(),
      catalog,
      categoryStates: settledStates(),
      expandedCategoryId: 'battle_map',
      expandedGroupKeys: ['10:battle_map|1:0|6:고블린 부락'],
      query: '',
    });

    assert.deepEqual(result.rows.map(({ kind, key }) => [kind, key]), [
      ['CATEGORY', 'category:battle_map'],
      ['GROUP', 'group:10:battle_map|1:0|6:고블린 부락'],
      ['MAP', `map:${buildBattleMapStateKey(catalog[1]!)}`],
      ['MAP', `map:${buildBattleMapStateKey(catalog[0]!)}`],
      ['GROUP', 'group:10:battle_map|1:1|6:고대의 동굴'],
      ['CATEGORY', 'category:scenario_ocean'],
      ['CATEGORY', 'category:raid'],
    ]);
    assert.equal(result.matchCount, 4);
  });

  it('searches supported resolved maps and auto expands matches without changing manual expansion', () => {
    const manualGroups = ['10:battle_map|1:1|6:고대의 동굴'];
    const result = buildBattleMapCatalogRows({
      categories: categories(),
      catalog: [
        map('battle_map', 'g1', '약한 고블린', '고블린 부락', 0, 0),
        map('scenario_ocean', 's1', '폭풍 항로', '대해', 0, 0),
        map('raid', 'unresolved', '숨김', '레이드', 0, 0, { resolved: false, mapCode: null, keyMode: 'UNKNOWN' }),
        map('adventure_map', 'daily', '폭풍 모험', '모험', 0, 0),
        map('union', 'union-map', '폭풍 유니온', '유니온', 0, 0),
      ],
      categoryStates: settledStates(),
      expandedCategoryId: 'battle_map',
      expandedGroupKeys: manualGroups,
      query: '폭풍',
    });

    assert.deepEqual(result.rows.map(({ kind, key }) => [kind, key]), [
      ['CATEGORY', 'category:scenario_ocean'],
      ['GROUP', 'group:14:scenario_ocean|1:0|2:대해'],
      ['MAP', 'map:resolved|14:scenario_ocean|2:s1'],
    ]);
    assert.equal(result.matchCount, 1);
    assert.deepEqual(manualGroups, ['10:battle_map|1:1|6:고대의 동굴']);
  });

  it('keeps missing and loading category states visible during search', () => {
    const base = {
      categories: [category('battle_map', '전투맵', 0)],
      catalog: [] as BattleMapResponse[],
      expandedCategoryId: null,
      expandedGroupKeys: [] as string[],
      query: '고블린',
    };

    assert.deepEqual(
      buildBattleMapCatalogRows({ ...base, categoryStates: {} }).rows.map(rowState),
      ['CATEGORY:null', 'STATE:loading'],
    );
    assert.deepEqual(
      buildBattleMapCatalogRows({
        ...base,
        categoryStates: { battle_map: { loading: true, error: null } },
      }).rows.map(rowState),
      ['CATEGORY:null', 'STATE:loading'],
    );
  });

  it('keeps errors visible during search without adding empty state for stale nonmatches', () => {
    const result = buildBattleMapCatalogRows({
      categories: [category('battle_map', '전투맵', 0)],
      catalog: [map('battle_map', 'stale', '지난 맵', '고블린', 0, 0)],
      categoryStates: { battle_map: { loading: false, error: '실패' } },
      expandedCategoryId: null,
      expandedGroupKeys: [],
      query: '용의 둥지',
    });

    assert.deepEqual(result.rows.map(rowState), ['CATEGORY:1', 'STATE:error']);
    const state = result.rows[1];
    assert.equal(state?.kind === 'STATE' ? state.error : null, '실패');
  });

  it('places loading, error, stale maps, and empty rows below an expanded category', () => {
    const base = {
      categories: [category('battle_map', '전투맵', 0)],
      expandedCategoryId: 'battle_map',
      expandedGroupKeys: [] as string[],
      query: '',
    };

    assert.deepEqual(
      buildBattleMapCatalogRows({ ...base, catalog: [], categoryStates: {} }).rows.map(rowState),
      ['CATEGORY:null', 'STATE:loading'],
    );
    assert.deepEqual(
      buildBattleMapCatalogRows({
        ...base,
        catalog: [],
        categoryStates: { battle_map: { loading: true, error: null } },
      }).rows.map(rowState),
      ['CATEGORY:null', 'STATE:loading'],
    );
    assert.deepEqual(
      buildBattleMapCatalogRows({
        ...base,
        catalog: [],
        categoryStates: { battle_map: { loading: false, error: '실패' } },
      }).rows.map(rowState),
      ['CATEGORY:0', 'STATE:error'],
    );
    assert.deepEqual(
      buildBattleMapCatalogRows({
        ...base,
        catalog: [map('battle_map', 'stale', '지난 맵', '고블린', 0, 0)],
        categoryStates: { battle_map: { loading: false, error: '실패' } },
        expandedGroupKeys: ['10:battle_map|1:0|3:고블린'],
      }).rows.map(rowState),
      ['CATEGORY:1', 'STATE:error', 'GROUP', 'MAP'],
    );
    assert.deepEqual(
      buildBattleMapCatalogRows({
        ...base,
        catalog: [],
        categoryStates: { battle_map: { loading: false, error: null } },
      }).rows.map(rowState),
      ['CATEGORY:0', 'STATE:empty'],
    );
  });

  it('shows loading before matching stale maps', () => {
    const result = buildBattleMapCatalogRows({
      categories: [category('battle_map', '전투맵', 0)],
      catalog: [map('battle_map', 'stale', '지난 고블린', '고블린', 0, 0)],
      categoryStates: { battle_map: { loading: true, error: null } },
      expandedCategoryId: 'battle_map',
      expandedGroupKeys: ['10:battle_map|1:0|3:고블린'],
      query: '',
    });

    assert.deepEqual(result.rows.map(rowState), ['CATEGORY:null', 'STATE:loading', 'GROUP', 'MAP']);
  });

  it('uses collision-safe group identities across adversarial category and group values', () => {
    const result = buildBattleMapCatalogRows({
      categories: [
        category('a:1', '첫 번째', 0),
        category('a', '두 번째', 1),
      ],
      catalog: [
        map('a:1', 'first', '검색 맵', 'x', 2, 0),
        map('a', 'second', '검색 맵', '2:x', 1, 0),
      ],
      categoryStates: {
        'a:1': { loading: false, error: null },
        a: { loading: false, error: null },
      },
      expandedCategoryId: null,
      expandedGroupKeys: [],
      query: '검색',
    });

    const groupKeys = result.rows.filter((row) => row.kind === 'GROUP').map(({ key }) => key);
    assert.deepEqual(groupKeys, [
      'group:3:a:1|1:2|1:x',
      'group:1:a|1:1|3:2:x',
    ]);
    assert.equal(new Set(groupKeys).size, 2);
  });

  it('does not mutate inputs while producing stable collision-safe map keys', () => {
    const source = map('battle_map', 'same', '첫 번째', '그룹', 0, 0);
    const second = map('battle_map', 'same|other', '두 번째', '그룹', 0, 1);
    const categoriesInput = categories();
    const catalog = [second, source];
    const states = settledStates();
    const expandedGroups = ['10:battle_map|1:0|2:그룹'];
    const snapshot = structuredClone({ categoriesInput, catalog, states, expandedGroups });

    const first = buildBattleMapCatalogRows({
      categories: categoriesInput,
      catalog,
      categoryStates: states,
      expandedCategoryId: 'battle_map',
      expandedGroupKeys: expandedGroups,
      query: '',
    });
    const secondResult = buildBattleMapCatalogRows({
      categories: categoriesInput,
      catalog,
      categoryStates: states,
      expandedCategoryId: 'battle_map',
      expandedGroupKeys: expandedGroups,
      query: '',
    });

    assert.deepEqual({ categoriesInput, catalog, states, expandedGroups }, snapshot);
    assert.deepEqual(first, secondResult);
    assert.deepEqual(
      first.rows.filter((row) => row.kind === 'MAP').map(({ key }) => key),
      [`map:${buildBattleMapStateKey(source)}`, `map:${buildBattleMapStateKey(second)}`],
    );
  });
});

function categories(): BattleCategoryResponse[] {
  return [
    category('raid', '레이드', 4),
    category('adventure_map', '모험맵', 1),
    category('scenario_ocean', '시나리오- 대해', 3),
    category('union', '유니온', 2),
    category('battle_map', '전투맵', 0),
    { ...category('disabled', '비활성', -1), enabled: false },
  ];
}

function category(id: string, label: string, order: number): BattleCategoryResponse {
  return { id, label, description: `${label} 설명`, order, enabled: true };
}

function settledStates() {
  return {
    battle_map: { loading: false, error: null },
    scenario_ocean: { loading: false, error: null },
    raid: { loading: false, error: null },
  };
}

function rowState(row: ReturnType<typeof buildBattleMapCatalogRows>['rows'][number]): string {
  if (row.kind === 'CATEGORY') return `CATEGORY:${row.mapCount}`;
  if (row.kind === 'STATE') return `STATE:${row.state}`;
  return row.kind;
}

function map(
  categoryId: string,
  mapCode: string,
  name: string,
  groupName: string,
  groupOrder: number,
  mapOrder: number,
  overrides: Partial<BattleMapResponse> = {},
): BattleMapResponse {
  return {
    categoryId, mapCode, name, groupName, groupOrder, mapOrder,
    recommendedLevel: '1-20', availableCount: null, attemptCount: null,
    winCount: null, cooldownRemainingText: null, cooldownRemainingSeconds: null,
    keyMode: 'NOT_REQUIRED', keyCount: null, requiredTime: 10, enabled: true, resolved: true,
    supportsThreeBattles: false, iconUrl: null, rawHref: '', ...overrides,
  };
}
