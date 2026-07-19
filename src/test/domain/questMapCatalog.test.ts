import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildQuestMapCatalogGroupKey,
  buildQuestMapCatalogRows,
  type QuestMapCatalogRow,
} from '../../main/domain/questMapCatalog';
import { buildQuestMapIdentity } from '../../main/domain/questAutomation';
import type { BattleMapResponse } from '../../main/types/api';

describe('quest map catalog rows', () => {
  it('puts selected maps first in canonical order regardless of Set insertion order', () => {
    const adventure = map('adventure_map', 'adventure', '가 모험', { groupOrder: 0 });
    const laterBattle = map('battle_map', 'battle-late', '나 전투', { groupOrder: 1 });
    const earlyBattle = map('battle_map', 'battle-early', '가 전투', { groupOrder: 0 });
    const rows = buildQuestMapCatalogRows({
      maps: [adventure, laterBattle, earlyBattle],
      selectedIdentities: new Set([
        buildQuestMapIdentity(adventure),
        buildQuestMapIdentity(earlyBattle),
      ]),
      expandedCategoryIds: new Set(['battle_map', 'adventure_map']),
      expandedGroupKeys: new Set([buildQuestMapCatalogGroupKey(laterBattle)]),
      query: '',
    });

    assert.deepEqual(rows.slice(0, 3).map((row) => [
      row.kind,
      row.kind === 'SELECTED_MAP' ? row.map.mapCode : null,
    ]), [
      ['SELECTED_HEADING', null],
      ['SELECTED_MAP', 'battle-early'],
      ['SELECTED_MAP', 'adventure'],
    ]);
    assert.deepEqual(rows.filter(isMapRow).map(({ map: item }) => item.mapCode), ['battle-late']);
  });

  it('returns deselected maps to battle then adventure category/group/map order', () => {
    const maps = [
      map('adventure_map', 'adventure-late', '나 모험', { groupName: '나 모험', groupOrder: 1 }),
      map('battle_map', 'battle-late', '나 전투', { groupName: '나 전투', groupOrder: 1 }),
      map('battle_map', 'battle-early', '가 전투', { groupName: '가 전투', groupOrder: 0 }),
      map('adventure_map', 'adventure-early', '가 모험', { groupName: '가 모험', groupOrder: 0 }),
    ];
    const rows = buildQuestMapCatalogRows({
      maps,
      selectedIdentities: new Set(),
      expandedCategoryIds: new Set(['battle_map', 'adventure_map']),
      expandedGroupKeys: new Set(maps.map(buildQuestMapCatalogGroupKey)),
      query: '',
    });

    assert.deepEqual(rows.filter(isCategoryRow).map(({ categoryId }) => categoryId), ['battle_map', 'adventure_map']);
    assert.deepEqual(rows.filter(isMapRow).map(({ map: item }) => item.mapCode), [
      'battle-early',
      'battle-late',
      'adventure-early',
      'adventure-late',
    ]);
  });

  it('keeps selected rows during search while filtering and excluding them below', () => {
    const selected = map('battle_map', 'selected', '선택 맵');
    const matching = map('adventure_map', 'needle-code', '다른 이름', {
      groupName: '검색 그룹',
      recommendedLevel: '40-60',
    });
    const rows = buildQuestMapCatalogRows({
      maps: [map('battle_map', 'hidden', '숨겨진 맵'), matching, selected],
      selectedIdentities: new Set([buildQuestMapIdentity(selected)]),
      expandedCategoryIds: new Set(),
      expandedGroupKeys: new Set(),
      query: 'needle-code',
    });

    assert.deepEqual(rows.filter(isSelectedMapRow).map(({ map: item }) => item.mapCode), ['selected']);
    assert.deepEqual(rows.filter(isMapRow).map(({ map: item }) => item.mapCode), ['needle-code']);
    assert.equal(rows.some((row) => row.kind === 'MAP' && row.map.mapCode === 'selected'), false);
    assert.equal(rows.find(isCategoryRow)?.expanded, true);
    assert.equal(rows.find(isGroupRow)?.expanded, true);
  });

  it('searches name, group, level, category label, and code independently', () => {
    const target = map('battle_map', 'mansion-west', '저택 서관', {
      groupName: '귀족의 저택',
      recommendedLevel: '50-60',
    });
    for (const query of ['저택 서관', '귀족의 저택', '50-60', '전투맵', 'mansion-west']) {
      const rows = buildQuestMapCatalogRows({
        maps: [target],
        selectedIdentities: new Set(),
        expandedCategoryIds: new Set(),
        expandedGroupKeys: new Set(),
        query,
      });
      assert.deepEqual(rows.filter(isMapRow).map(({ map: item }) => item.mapCode), ['mansion-west']);
    }
  });

  it('retains resolved supported null-code maps with deterministic keys and category/group metadata', () => {
    const nullCode = map('battle_map', null, '코드 없음', { mapOrder: 2 });
    const maps = [
      map('battle_map', 'battle', '전투', { recommendedLevel: null }),
      map('battle_map', 'battle-2', '전투 2', { mapOrder: 1, recommendedLevel: '20-30' }),
      nullCode,
      map('adventure_map', 'adventure', '모험'),
      map('battle_map', 'unresolved', '미해결', { resolved: false }),
      map('union', 'union', '유니온'),
    ];
    const expandedGroupKeys = new Set([buildQuestMapCatalogGroupKey(nullCode)]);
    const args = {
      maps,
      selectedIdentities: new Set([buildQuestMapIdentity(nullCode)]),
      expandedCategoryIds: new Set(['battle_map']),
      expandedGroupKeys,
      query: '',
    };
    const first = buildQuestMapCatalogRows(args);
    const second = buildQuestMapCatalogRows(args);

    assert.equal(first.some((row) => row.kind === 'SELECTED_MAP' && row.map === nullCode), false);
    assert.deepEqual(first.filter(isMapRow).map(({ map: item }) => item.mapCode), ['battle', 'battle-2', null]);
    assert.equal(first.find((row) => row.kind === 'MAP' && row.map === nullCode)?.key,
      second.find((row) => row.kind === 'MAP' && row.map === nullCode)?.key);
    assert.deepEqual(first.filter(isCategoryRow).map(({ categoryId, label, count }) => [categoryId, label, count]), [
      ['battle_map', '전투맵', 3],
      ['adventure_map', '모험맵', 1],
    ]);
    const group = first.find(isGroupRow);
    assert.equal(group?.name, '기타');
    assert.equal(group?.meta, 'Lv 20-30 · 3개');
  });

  it('gives duplicate null and blank-code metadata rows stable unique keys', () => {
    const firstNull = map('battle_map', null, '중복 맵');
    const secondNull = map('battle_map', null, '중복 맵');
    const blank = map('battle_map', '   ', '중복 맵');
    const args = {
      maps: [secondNull, blank, firstNull],
      selectedIdentities: new Set<string>(),
      expandedCategoryIds: new Set(['battle_map']),
      expandedGroupKeys: new Set([buildQuestMapCatalogGroupKey(firstNull)]),
      query: '',
    };

    const first = buildQuestMapCatalogRows(args);
    const second = buildQuestMapCatalogRows(args);
    const firstKeys = first.map(({ key }) => key);

    assert.equal(first.filter(isMapRow).length, 3);
    assert.equal(new Set(firstKeys).size, firstKeys.length);
    assert.deepEqual(second.map(({ key }) => key), firstKeys);
  });

  it('builds the exact collision-safe group key from a map-like value', () => {
    const first = buildQuestMapCatalogGroupKey({ categoryId: 'a|1', groupOrder: 23, groupName: '  반복  ' });
    const second = buildQuestMapCatalogGroupKey({ categoryId: 'a', groupOrder: 1, groupName: '23|반복' });

    assert.equal(first, '3:a|1|2:23|2:반복');
    assert.equal(buildQuestMapCatalogGroupKey({ categoryId: 'a|1', groupOrder: 23, groupName: '   ' }), '3:a|1|2:23|2:기타');
    assert.notEqual(first, second);
  });

  it('produces stable unique keys without mutating maps or expansion Sets', () => {
    const maps = [
      map('battle_map', 'z', '같은 이름', { groupName: ' 그룹 ', mapOrder: 1 }),
      map('battle_map', 'b', '나 맵', { groupName: '그룹', mapOrder: 0 }),
      map('battle_map', 'a', '가 맵', { groupName: '그룹', mapOrder: 0 }),
      map('battle_map', 'a2', '가 맵', { groupName: '그룹', mapOrder: 0 }),
    ];
    const selectedIdentities = new Set<string>();
    const expandedCategoryIds = new Set(['manual-category']);
    const expandedGroupKeys = new Set(['manual-group']);
    const snapshot = structuredClone(maps);
    const args = { maps, selectedIdentities, expandedCategoryIds, expandedGroupKeys, query: '그룹' };

    const first = buildQuestMapCatalogRows(args);
    const second = buildQuestMapCatalogRows(args);

    assert.deepEqual(maps, snapshot);
    assert.deepEqual([...selectedIdentities], []);
    assert.deepEqual([...expandedCategoryIds], ['manual-category']);
    assert.deepEqual([...expandedGroupKeys], ['manual-group']);
    assert.deepEqual(first, second);
    assert.deepEqual(first.filter(isMapRow).map(({ map: item }) => item.mapCode), ['a', 'a2', 'b', 'z']);
    assert.equal(new Set(first.map(({ key }) => key)).size, first.length);
  });
});

function isSelectedMapRow(row: QuestMapCatalogRow): row is Extract<QuestMapCatalogRow, { kind: 'SELECTED_MAP' }> {
  return row.kind === 'SELECTED_MAP';
}

function isCategoryRow(row: QuestMapCatalogRow): row is Extract<QuestMapCatalogRow, { kind: 'CATEGORY' }> {
  return row.kind === 'CATEGORY';
}

function isGroupRow(row: QuestMapCatalogRow): row is Extract<QuestMapCatalogRow, { kind: 'GROUP' }> {
  return row.kind === 'GROUP';
}

function isMapRow(row: QuestMapCatalogRow): row is Extract<QuestMapCatalogRow, { kind: 'MAP' }> {
  return row.kind === 'MAP';
}

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
