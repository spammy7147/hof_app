import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAdventureMapCatalogRows } from '../../main/domain/adventureMapCatalog';
import type { BattleMapResponse } from '../../main/types/api';

describe('adventure map catalog rows', () => {
  it('starts with every group collapsed', () => {
    const result = buildAdventureMapCatalogRows({
      catalog: [
        map('forest', '숲 모험', { groupName: '숲', groupOrder: 0 }),
        map('desert', '사막 모험', { groupName: '사막', groupOrder: 1 }),
      ],
      expandedGroupKeys: [],
      query: '',
    });

    assert.deepEqual(result.rows.map((row) => row.kind), ['GROUP', 'GROUP']);
    assert.deepEqual(
      result.rows.map((row) => row.kind === 'GROUP' && row.expanded),
      [false, false],
    );
    assert.equal(result.matchCount, 2);
  });

  it('expands multiple manually selected groups at once', () => {
    const catalog = [
      map('forest', '숲 모험', { groupName: '숲', groupOrder: 0 }),
      map('desert', '사막 모험', { groupName: '사막', groupOrder: 1 }),
    ];
    const collapsed = buildAdventureMapCatalogRows({ catalog, expandedGroupKeys: [], query: '' });
    const groupKeys = collapsed.rows
      .filter((row) => row.kind === 'GROUP')
      .map(({ group }) => group.key);

    const result = buildAdventureMapCatalogRows({
      catalog,
      expandedGroupKeys: groupKeys,
      query: '',
    });

    assert.deepEqual(result.rows.map((row) => row.kind), ['GROUP', 'MAP', 'GROUP', 'MAP']);
    assert.deepEqual(
      result.rows.filter((row) => row.kind === 'MAP').map(({ groupKey, map }) => [groupKey, map.mapCode]),
      [[groupKeys[0], 'forest'], [groupKeys[1], 'desert']],
    );
  });

  it('auto expands search matches and clearing search restores manual expansion', () => {
    const catalog = [
      map('manual', '수동 맵', { groupName: '수동 그룹', groupOrder: 0 }),
      map('needle', '바늘 모험', { groupName: '검색 그룹', groupOrder: 1 }),
    ];
    const initial = buildAdventureMapCatalogRows({ catalog, expandedGroupKeys: [], query: '' });
    const manualKey = initial.rows.find(
      (row) => row.kind === 'GROUP' && row.group.name === '수동 그룹',
    );
    assert.equal(manualKey?.kind, 'GROUP');
    const expandedGroupKeys = [manualKey!.group.key];

    const searched = buildAdventureMapCatalogRows({ catalog, expandedGroupKeys, query: '바늘' });
    assert.deepEqual(searched.rows.map((row) => row.kind), ['GROUP', 'MAP']);
    assert.equal(searched.rows[0]?.kind === 'GROUP' ? searched.rows[0].expanded : false, true);
    assert.deepEqual(expandedGroupKeys, [manualKey!.group.key]);

    const cleared = buildAdventureMapCatalogRows({ catalog, expandedGroupKeys, query: '   ' });
    assert.deepEqual(
      cleared.rows.map((row) => row.kind === 'GROUP' ? [row.group.name, row.expanded] : ['MAP', row.map.mapCode]),
      [['수동 그룹', true], ['MAP', 'manual'], ['검색 그룹', false]],
    );
  });

  it('groups missing and blank group names under 기타 with deterministic level data', () => {
    const result = buildAdventureMapCatalogRows({
      catalog: [
        map('missing', '미지정', { groupName: null, recommendedLevel: null }),
        map('blank', '공백', { groupName: '   ', mapOrder: 1, recommendedLevel: 'Lv 20' }),
        map('later', '나중', { groupName: '', mapOrder: 2, recommendedLevel: 'Lv 30' }),
      ],
      expandedGroupKeys: [],
      query: '',
    });

    const group = result.rows[0];
    assert.equal(group?.kind, 'GROUP');
    assert.equal(group.group.name, '기타');
    assert.equal(group.group.recommendedLevel, 'Lv 20');
    assert.deepEqual(group.group.maps.map(({ mapCode }) => mapCode), ['missing', 'blank', 'later']);
  });

  it('does not collide duplicate group display names from different source positions', () => {
    const catalog = [
      map('first', '첫 맵', { groupName: '반복', groupOrder: 1 }),
      map('second', '둘째 맵', { groupName: '반복', groupOrder: 12 }),
    ];
    const collapsed = buildAdventureMapCatalogRows({ catalog, expandedGroupKeys: [], query: '' });
    const groups = collapsed.rows.filter((row) => row.kind === 'GROUP').map(({ group }) => group);

    assert.deepEqual(groups.map(({ name }) => name), ['반복', '반복']);
    assert.equal(new Set(groups.map(({ key }) => key)).size, 2);

    const expanded = buildAdventureMapCatalogRows({
      catalog,
      expandedGroupKeys: groups.map(({ key }) => key),
      query: '',
    });
    const mapRows = expanded.rows.filter((row) => row.kind === 'MAP');
    assert.equal(new Set(mapRows.map(({ key }) => key)).size, 2);
    assert.deepEqual(mapRows.map(({ groupKey }) => groupKey), groups.map(({ key }) => key));
  });

  it('keeps a map row key stable when its group metadata changes', () => {
    const beforeCatalog = [
      map('same-map', '같은 맵', { groupName: '이전 그룹', groupOrder: 1 }),
    ];
    const afterCatalog = [
      map('same-map', '같은 맵', { groupName: '새 그룹', groupOrder: 9 }),
    ];
    const beforeGroup = buildAdventureMapCatalogRows({
      catalog: beforeCatalog,
      expandedGroupKeys: [],
      query: '',
    }).rows[0];
    const afterGroup = buildAdventureMapCatalogRows({
      catalog: afterCatalog,
      expandedGroupKeys: [],
      query: '',
    }).rows[0];
    assert.equal(beforeGroup?.kind, 'GROUP');
    assert.equal(afterGroup?.kind, 'GROUP');

    const beforeRows = buildAdventureMapCatalogRows({
      catalog: beforeCatalog,
      expandedGroupKeys: [beforeGroup.group.key],
      query: '',
    });
    const afterRows = buildAdventureMapCatalogRows({
      catalog: afterCatalog,
      expandedGroupKeys: [afterGroup.group.key],
      query: '',
    });
    const beforeMap = beforeRows.rows.find((row) => row.kind === 'MAP');
    const afterMap = afterRows.rows.find((row) => row.kind === 'MAP');

    assert.equal(beforeMap?.kind, 'MAP');
    assert.equal(afterMap?.kind, 'MAP');
    assert.equal(beforeMap.key, afterMap.key);
    assert.notEqual(beforeMap.groupKey, afterMap.groupKey);
  });

  it('inherits filtered catalog ordering and keeps group map order stable', () => {
    const catalog = [
      map('zulu', '가나다', { groupName: '첫 그룹', groupOrder: 0, mapOrder: 2 }),
      map('beta', '나 맵', { groupName: '둘째 그룹', groupOrder: 1, mapOrder: 0 }),
      map('alpha', '가 맵', { groupName: '둘째 그룹', groupOrder: 1, mapOrder: 0 }),
      map('early', '먼저', { groupName: '첫 그룹', groupOrder: 0, mapOrder: 0 }),
    ];
    const collapsed = buildAdventureMapCatalogRows({ catalog, expandedGroupKeys: [], query: '' });
    const groups = collapsed.rows.filter((row) => row.kind === 'GROUP').map(({ group }) => group);

    assert.deepEqual(groups.map(({ name }) => name), ['첫 그룹', '둘째 그룹']);
    assert.deepEqual(groups.map(({ groupOrder }) => groupOrder), [0, 1]);
    assert.deepEqual(groups[0]?.maps.map(({ mapCode }) => mapCode), ['early', 'zulu']);
    assert.deepEqual(groups[1]?.maps.map(({ mapCode }) => mapCode), ['alpha', 'beta']);
  });

  it('excludes unresolved and null-code items while retaining Simulation scarecrow maps', () => {
    const catalog = [
      map('dummy-80', 'Simulation- 전체 공격 허수아비 Lv.80', {
        groupName: '특수 허수아비',
        mapOrder: 1,
      }),
      map('dummy-60', 'Simulation- 전체 공격 허수아비 Lv.60', {
        groupName: '특수 허수아비',
      }),
      map('unresolved', '해결 안 됨', { resolved: false, keyMode: 'UNKNOWN' }),
      map(null, '코드 없음', { groupOrder: 2, keyMode: 'UNKNOWN' }),
      map('other-category', '다른 카테고리', { categoryId: 'battle_map', groupOrder: 3 }),
    ];
    const collapsed = buildAdventureMapCatalogRows({ catalog, expandedGroupKeys: [], query: '' });
    const group = collapsed.rows.find((row) => row.kind === 'GROUP');
    assert.equal(group?.kind, 'GROUP');

    const result = buildAdventureMapCatalogRows({
      catalog,
      expandedGroupKeys: [group!.group.key],
      query: '',
    });

    assert.equal(result.matchCount, 2);
    assert.deepEqual(
      result.rows.filter((row) => row.kind === 'MAP').map(({ map }) => map.name),
      ['Simulation- 전체 공격 허수아비 Lv.60', 'Simulation- 전체 공격 허수아비 Lv.80'],
    );
  });

  it('does not mutate any input and produces deterministic rows', () => {
    const catalog = [
      map('later', '나중', { groupName: '그룹', mapOrder: 1 }),
      map('first', '먼저', { groupName: '그룹', mapOrder: 0 }),
    ];
    const expandedGroupKeys = ['unrelated-key'];
    const snapshot = structuredClone({ catalog, expandedGroupKeys });

    const first = buildAdventureMapCatalogRows({ catalog, expandedGroupKeys, query: '' });
    const second = buildAdventureMapCatalogRows({ catalog, expandedGroupKeys, query: '' });

    assert.deepEqual({ catalog, expandedGroupKeys }, snapshot);
    assert.deepEqual(first, second);
  });
});

function map(
  mapCode: string | null,
  name: string,
  overrides: Partial<BattleMapResponse> = {},
): BattleMapResponse {
  return {
    categoryId: 'adventure_map',
    mapCode,
    name,
    groupName: '모험',
    groupOrder: 0,
    mapOrder: 0,
    recommendedLevel: 'Lv 1-10',
    availableCount: null,
    attemptCount: null,
    winCount: null,
    cooldownRemainingText: null,
    cooldownRemainingSeconds: null,
    keyMode: 'NOT_REQUIRED',
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
