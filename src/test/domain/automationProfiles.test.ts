import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAutomationProfileSelectedMaps,
  buildCreateAutomationProfileRequest,
  filterAutomationProfileCategories,
  filterAutomationProfileMaps,
  formatAutomationProfileSummary,
  setAutomationProfileMapPreset,
  toggleAutomationProfileMap,
} from '../../main/domain/automationProfiles';
import type {
  AutomationProfileMap,
  BattleCategoryResponse,
  BattleMapResponse,
} from '../../main/types/api';

describe('automationProfiles', () => {
  it('builds an empty structured profile request in time-burn mode', () => {
    assert.deepEqual(buildCreateAutomationProfileRequest(), {
      name: '새 자동전투',
      mode: 'TIME_BURN',
      maps: [],
    });
  });

  it('summarizes structured profile maps directly', () => {
    const maps: AutomationProfileMap[] = [
      { categoryId: 'battle_map', mapCode: 'snow22', partyPresetId: 7, executionOrder: 0 },
      { categoryId: 'adventure_map', mapCode: 'ruin', partyPresetId: null, executionOrder: 1 },
    ];

    assert.equal(formatAutomationProfileSummary(maps), '맵 2개 · 프리셋 1/2');
    assert.equal(formatAutomationProfileSummary([]), '맵 설정 필요');
  });

  it('adds and removes resolved maps with contiguous execution order', () => {
    const firstMap = battleMap({ mapCode: 'snow22', resolved: true });
    const secondMap = battleMap({ mapCode: 'gb0', resolved: true });
    const withFirstMap = toggleAutomationProfileMap([], firstMap);
    const withBothMaps = toggleAutomationProfileMap(withFirstMap, secondMap);
    const withoutFirstMap = toggleAutomationProfileMap(withBothMaps, firstMap);

    assert.deepEqual(withBothMaps, [
      { categoryId: 'battle_map', mapCode: 'snow22', partyPresetId: null, executionOrder: 0 },
      { categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: null, executionOrder: 1 },
    ]);
    assert.deepEqual(withoutFirstMap, [
      { categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: null, executionOrder: 0 },
    ]);
  });

  it('does not select maps whose code is null or unresolved', () => {
    const selectedMaps: AutomationProfileMap[] = [
      { categoryId: 'battle_map', mapCode: 'snow22', partyPresetId: 3, executionOrder: 0 },
    ];

    assert.deepEqual(
      toggleAutomationProfileMap(selectedMaps, battleMap({ mapCode: null, resolved: false, keyMode: 'UNKNOWN' })),
      selectedMaps,
    );
    assert.deepEqual(
      toggleAutomationProfileMap(selectedMaps, battleMap({ mapCode: 'pending', resolved: false, keyMode: 'UNKNOWN' })),
      selectedMaps,
    );
  });

  it('keeps a temporarily disabled resolved map removable and preset-editable', () => {
    const disabledMap = battleMap({ mapCode: 'cooldown-map', resolved: true, enabled: false });
    const selectedMaps: AutomationProfileMap[] = [
      {
        categoryId: disabledMap.categoryId,
        mapCode: 'cooldown-map',
        partyPresetId: 3,
        executionOrder: 0,
      },
    ];

    assert.deepEqual(toggleAutomationProfileMap(selectedMaps, disabledMap), []);
    assert.deepEqual(
      setAutomationProfileMapPreset(
        selectedMaps,
        { categoryId: disabledMap.categoryId, mapCode: 'cooldown-map' },
        9,
      ),
      [{
        categoryId: disabledMap.categoryId,
        mapCode: 'cooldown-map',
        partyPresetId: 9,
        executionOrder: 0,
      }],
    );
  });

  it('assigns a party preset while preserving and reindexing map order', () => {
    const maps: AutomationProfileMap[] = [
      { categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: null, executionOrder: 4 },
      { categoryId: 'battle_map', mapCode: 'gb1', partyPresetId: 3, executionOrder: 9 },
    ];

    const assigned = setAutomationProfileMapPreset(
      maps,
      { categoryId: 'battle_map', mapCode: 'gb0' },
      9,
    );
    const cleared = setAutomationProfileMapPreset(
      assigned,
      { categoryId: 'battle_map', mapCode: 'gb1' },
      null,
    );

    assert.deepEqual(assigned, [
      { categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: 9, executionOrder: 0 },
      { categoryId: 'battle_map', mapCode: 'gb1', partyPresetId: 3, executionOrder: 1 },
    ]);
    assert.deepEqual(cleared, [
      { categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: 9, executionOrder: 0 },
      { categoryId: 'battle_map', mapCode: 'gb1', partyPresetId: null, executionOrder: 1 },
    ]);
  });

  it('synthesizes editable selected rows for stored maps missing from the catalog', () => {
    const profileMaps: AutomationProfileMap[] = [
      { categoryId: 'battle_map', mapCode: 'missing-map', partyPresetId: 7, executionOrder: 1 },
      { categoryId: 'adventure_map', mapCode: 'other-category', partyPresetId: 8, executionOrder: 0 },
    ];
    const catalogMap = battleMap({ mapCode: 'visible-map', name: '보이는 맵' });

    const selectedMaps = buildAutomationProfileSelectedMaps(
      profileMaps,
      [catalogMap],
      'battle_map',
    );

    assert.equal(selectedMaps.length, 1);
    assert.deepEqual(selectedMaps[0], {
      categoryId: 'battle_map',
      mapCode: 'missing-map',
      name: 'missing-map',
      groupName: '저장된 맵',
      groupOrder: Number.MAX_SAFE_INTEGER,
      mapOrder: 1,
      recommendedLevel: null,
      availableCount: null,
      attemptCount: null,
      winCount: null,
      cooldownRemainingText: null,
      cooldownRemainingSeconds: null,
      keyMode: 'UNKNOWN',
      keyCount: null,
      requiredTime: null,
      supportsThreeBattles: false,
      resolved: true,
      enabled: false,
      iconUrl: null,
      rawHref: '',
    });
  });

  it('uses the catalog row once when a stored profile map is still visible', () => {
    const profileMaps: AutomationProfileMap[] = [
      { categoryId: 'battle_map', mapCode: 'visible-map', partyPresetId: null, executionOrder: 0 },
    ];
    const catalogMap = battleMap({ mapCode: 'visible-map', name: '보이는 맵', enabled: false });

    const selectedMaps = buildAutomationProfileSelectedMaps(
      profileMaps,
      [catalogMap],
      'battle_map',
    );

    assert.deepEqual(selectedMaps, [catalogMap]);
  });

  it('filters automation maps by name, group, level, or nullable map code', () => {
    const maps: BattleMapResponse[] = [
      battleMap({
        mapCode: 'gb0',
        name: 'Goblin- 고블린과 놀기(가장 약함)',
        groupName: '고블린 부락',
        recommendedLevel: 'Lv 1-20',
      }),
      battleMap({
        mapCode: 'snow22',
        name: 'Frosty Mountain- 리치의 창고',
        groupName: '대충산 위험지역',
        recommendedLevel: 'Lv 40-60',
      }),
      battleMap({ mapCode: null, resolved: false, name: '코드 확인 중', keyMode: 'UNKNOWN' }),
    ];

    assert.deepEqual(filterAutomationProfileMaps(maps, '리치').map((map) => map.mapCode), ['snow22']);
    assert.deepEqual(filterAutomationProfileMaps(maps, '부락').map((map) => map.mapCode), ['gb0']);
    assert.deepEqual(filterAutomationProfileMaps(maps, '40-60').map((map) => map.mapCode), ['snow22']);
    assert.deepEqual(filterAutomationProfileMaps(maps, 'GB0').map((map) => map.mapCode), ['gb0']);
    assert.deepEqual(filterAutomationProfileMaps(maps, '확인 중').map((map) => map.mapCode), [null]);
    assert.deepEqual(
      filterAutomationProfileMaps(maps, '   ').map((map) => map.mapCode),
      ['gb0', 'snow22', null],
    );
  });

  it('excludes union categories from automation profile map settings', () => {
    const categories: BattleCategoryResponse[] = [
      battleCategory({ id: 'battle_map', label: '전투맵' }),
      battleCategory({ id: 'union', label: '유니온' }),
      battleCategory({ id: 'scenario_union', label: '시나리오-유니온' }),
      battleCategory({ id: 'adventure_map', label: '모험맵' }),
    ];

    assert.deepEqual(
      filterAutomationProfileCategories(categories).map((category) => category.id),
      ['battle_map', 'adventure_map'],
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

function battleMap(overrides: Partial<BattleMapResponse>): BattleMapResponse {
  return {
    categoryId: 'battle_map',
    mapCode: 'map',
    name: '맵',
    groupName: null,
    groupOrder: 0,
    mapOrder: 0,
    recommendedLevel: null,
    availableCount: null,
    attemptCount: null,
    winCount: null,
    cooldownRemainingText: null,
    cooldownRemainingSeconds: null,
    keyMode: 'NOT_REQUIRED',
    keyCount: null,
    requiredTime: null,
    resolved: true,
    enabled: true,
    iconUrl: null,
    rawHref: '',
    ...overrides,
    supportsThreeBattles: overrides.supportsThreeBattles ?? false,
  };
}
