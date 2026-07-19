import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildQuestMapCatalogGroupKey,
  buildQuestMapCatalogRows,
} from '../../main/domain/questMapCatalog';
import { buildQuestMapIdentity } from '../../main/domain/questAutomation';
import type { BattleMapResponse } from '../../main/types/api';

describe('quest map catalog rows', () => {
  it('puts selected maps first in selection order and restores canonical hierarchy order after deselection', () => {
    const catalog = [
      map('adventure_map', 'adventure-late', '나 모험', { groupName: '나 모험', groupOrder: 1 }),
      map('battle_map', 'battle-late', '나 전투', { groupName: '나 전투', groupOrder: 1 }),
      map('battle_map', 'battle-early', '가 전투', { groupName: '가 전투', groupOrder: 0 }),
      map('adventure_map', 'adventure-early', '가 모험', { groupName: '가 모험', groupOrder: 0 }),
    ];
    const selectedMapIdentities = [
      buildQuestMapIdentity(catalog[0]!),
      buildQuestMapIdentity(catalog[2]!),
    ];

    const selected = buildQuestMapCatalogRows({
      catalog,
      selectedMapIdentities,
      expandedCategoryIds: ['battle_map', 'adventure_map'],
      expandedGroupKeys: catalog.map((item) => buildQuestMapCatalogGroupKey(item.categoryId, item.groupOrder, item.groupName)),
      query: '',
    });

    assert.deepEqual(selected.rows.slice(0, 3).map((row) => [row.kind, row.kind === 'SELECTED_MAP' ? row.map.mapCode : null]), [
      ['SELECTED_HEADING', null],
      ['SELECTED_MAP', 'adventure-late'],
      ['SELECTED_MAP', 'battle-early'],
    ]);
    assert.deepEqual(
      selected.rows.filter((row) => row.kind === 'MAP').map(({ map: item }) => item.mapCode),
      ['battle-late', 'adventure-early'],
    );

    const deselected = buildQuestMapCatalogRows({
      catalog,
      selectedMapIdentities: [],
      expandedCategoryIds: ['battle_map', 'adventure_map'],
      expandedGroupKeys: catalog.map((item) => buildQuestMapCatalogGroupKey(item.categoryId, item.groupOrder, item.groupName)),
      query: '',
    });

    assert.deepEqual(deselected.rows.filter((row) => row.kind === 'CATEGORY').map(({ category }) => category.id), [
      'battle_map',
      'adventure_map',
    ]);
    assert.deepEqual(deselected.rows.filter((row) => row.kind === 'MAP').map(({ map: item }) => item.mapCode), [
      'battle-early',
      'battle-late',
      'adventure-early',
      'adventure-late',
    ]);
  });

  it('always retains selected rows during search while filtering and omitting them from the lower catalog', () => {
    const selected = map('battle_map', 'selected', '선택 맵', { groupName: '선택 그룹' });
    const matching = map('adventure_map', 'needle-code', '다른 이름', {
      groupName: '검색 그룹',
      recommendedLevel: 'Lv 40-60',
    });
    const hidden = map('battle_map', 'hidden', '숨겨진 맵');

    const result = buildQuestMapCatalogRows({
      catalog: [hidden, matching, selected],
      selectedMapIdentities: [buildQuestMapIdentity(selected)],
      expandedCategoryIds: [],
      expandedGroupKeys: [],
      query: 'needle-code',
    });

    assert.deepEqual(result.rows.filter((row) => row.kind === 'SELECTED_MAP').map(({ map: item }) => item.mapCode), ['selected']);
    assert.deepEqual(result.rows.filter((row) => row.kind === 'MAP').map(({ map: item }) => item.mapCode), ['needle-code']);
    assert.equal(result.matchCount, 1);
    assert.equal(result.rows.some((row) => row.kind === 'MAP' && row.map.mapCode === 'selected'), false);
    const category = result.rows.find((row) => row.kind === 'CATEGORY');
    const group = result.rows.find((row) => row.kind === 'GROUP');
    assert.equal(category?.kind === 'CATEGORY' ? category.expanded : false, true);
    assert.equal(group?.kind === 'GROUP' ? group.expanded : false, true);
  });

  it('searches map, group, level, category label, and code independently', () => {
    const target = map('battle_map', 'mansion-west', '저택 서관', {
      groupName: '귀족의 저택',
      recommendedLevel: '50-60',
    });
    for (const query of ['저택 서관', '귀족의 저택', '50-60', '전투맵', 'mansion-west']) {
      const result = buildQuestMapCatalogRows({
        catalog: [target],
        selectedMapIdentities: [],
        expandedCategoryIds: [],
        expandedGroupKeys: [],
        query,
      });
      assert.deepEqual(result.rows.filter((row) => row.kind === 'MAP').map(({ map: item }) => item.mapCode), ['mansion-west']);
    }
  });

  it('includes only resolved battle and adventure maps with codes and reports category/group metadata', () => {
    const catalog = [
      map('battle_map', 'battle', '전투', { recommendedLevel: null }),
      map('battle_map', 'battle-2', '전투 2', { mapOrder: 1, recommendedLevel: '20-30' }),
      map('adventure_map', 'adventure', '모험'),
      map('battle_map', 'unresolved', '미해결', { resolved: false }),
      map('adventure_map', null, '코드 없음'),
      map('union', 'union', '유니온'),
    ];
    const result = buildQuestMapCatalogRows({
      catalog,
      selectedMapIdentities: [],
      expandedCategoryIds: ['battle_map'],
      expandedGroupKeys: [],
      query: '',
    });

    assert.equal(result.matchCount, 3);
    const categories = result.rows.filter((row) => row.kind === 'CATEGORY').map(({ category, mapCount, groupCount }) => [
      category.id, category.label, mapCount, groupCount,
    ]);
    assert.deepEqual(categories, [
      ['battle_map', '전투맵', 2, 1],
      ['adventure_map', '모험맵', 1, 1],
    ]);
    const group = result.rows.find((row) => row.kind === 'GROUP');
    assert.equal(group?.kind, 'GROUP');
    assert.equal(group.group.mapCount, 2);
    assert.equal(group.group.recommendedLevel, '20-30');
  });

  it('uses collision-safe normalized group keys', () => {
    const first = buildQuestMapCatalogGroupKey('a|1', 23, '  반복  ');
    const second = buildQuestMapCatalogGroupKey('a', 1, '23|반복');

    assert.equal(first, '3:a|1|2:23|2:반복');
    assert.equal(buildQuestMapCatalogGroupKey('a|1', 23, '반복'), first);
    assert.equal(buildQuestMapCatalogGroupKey('a|1', 23, '   '), '3:a|1|2:23|2:기타');
    assert.notEqual(first, second);
  });

  it('sorts canonically with stable keys and never mutates inputs or manual expansion state', () => {
    const catalog = [
      map('battle_map', 'z', '같은 이름', { groupName: ' 그룹 ', mapOrder: 1 }),
      map('battle_map', 'b', '나 맵', { groupName: '그룹', mapOrder: 0 }),
      map('battle_map', 'a', '가 맵', { groupName: '그룹', mapOrder: 0 }),
      map('battle_map', 'a2', '가 맵', { groupName: '그룹', mapOrder: 0 }),
    ];
    const expandedCategoryIds = ['manual-category'];
    const expandedGroupKeys = ['manual-group'];
    const snapshot = structuredClone({ catalog, expandedCategoryIds, expandedGroupKeys });

    const first = buildQuestMapCatalogRows({
      catalog,
      selectedMapIdentities: [],
      expandedCategoryIds,
      expandedGroupKeys,
      query: '그룹',
    });
    const second = buildQuestMapCatalogRows({
      catalog,
      selectedMapIdentities: [],
      expandedCategoryIds,
      expandedGroupKeys,
      query: '그룹',
    });

    assert.deepEqual({ catalog, expandedCategoryIds, expandedGroupKeys }, snapshot);
    assert.deepEqual(first, second);
    assert.deepEqual(first.rows.filter((row) => row.kind === 'MAP').map(({ map: item }) => item.mapCode), ['a', 'a2', 'b', 'z']);
    assert.equal(new Set(first.rows.map(({ key }) => key)).size, first.rows.length);
  });
});

function map(
  categoryId: string,
  mapCode: string | null,
  name: string,
  overrides: Partial<BattleMapResponse> = {},
): BattleMapResponse {
  return {
    categoryId,
    mapCode,
    name,
    groupName: '기타',
    groupOrder: 0,
    mapOrder: 0,
    recommendedLevel: '1-10',
    availableCount: null,
    attemptCount: null,
    winCount: null,
    cooldownRemainingText: null,
    cooldownRemainingSeconds: null,
    keyMode: mapCode == null ? 'UNKNOWN' : 'NOT_REQUIRED',
    keyCount: null,
    requiredTime: null,
    supportsThreeBattles: false,
    enabled: true,
    resolved: true,
    iconUrl: null,
    rawHref: '',
    ...overrides,
  };
}
