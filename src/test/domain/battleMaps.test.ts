import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { BattleMapResponse } from '../../main/types/api';
import {
  buildBattleMapStateKey,
  filterDisplayBattleMaps,
  formatAutomationMapListMeta,
  formatAutomationMapListName,
  getAutomationMapSkipReason,
  formatBattleMapMeta,
  groupBattleMaps,
  orderBattleMaps,
} from '../../main/domain/battleMaps';

describe('battle map utilities', () => {
  it('orders enabled maps by name and moves disabled maps last', () => {
    const ordered = orderBattleMaps([
      {
        categoryId: 'battle_map',
        mapCode: 'z',
        name: 'Z Map',
        groupName: '비활성',
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
        supportsThreeBattles: false,
        resolved: true,
        enabled: false,
        iconUrl: null,
        rawHref: '?common=z',
      },
      {
        categoryId: 'battle_map',
        mapCode: 'snow22',
        name: 'Frosty Mountain - 대충산',
        groupName: '대충산 위험지역',
        groupOrder: 1,
        mapOrder: 1,
        recommendedLevel: '40-60',
        availableCount: 3,
        attemptCount: null,
        winCount: null,
        cooldownRemainingText: null,
        cooldownRemainingSeconds: null,
        keyMode: 'LIMITED',
        keyCount: 9,
        requiredTime: 100,
        supportsThreeBattles: false,
        resolved: true,
        enabled: true,
        iconUrl: null,
        rawHref: '?common=snow22',
      },
      {
        categoryId: 'battle_map',
        mapCode: 'arena01',
        name: 'Arena - 결투장',
        groupName: '투기장',
        groupOrder: 1,
        mapOrder: 0,
        recommendedLevel: null,
        availableCount: null,
        attemptCount: null,
        winCount: null,
        cooldownRemainingText: null,
        cooldownRemainingSeconds: null,
        keyMode: 'NOT_REQUIRED',
        keyCount: null,
        requiredTime: 50,
        supportsThreeBattles: false,
        resolved: true,
        enabled: true,
        iconUrl: null,
        rawHref: '?common=arena01',
      },
    ]);

    assert.deepEqual(
      ordered.map((map) => map.mapCode),
      ['arena01', 'snow22', 'z'],
    );
  });

  it('sorts unresolved null-code maps safely after resolved maps', () => {
    const ordered = orderBattleMaps([
      battleMapFixture({ mapCode: null, resolved: false, name: 'Same map', keyMode: 'UNKNOWN' }),
      battleMapFixture({ mapCode: 'resolved', resolved: true, name: 'Same map' }),
    ]);

    assert.deepEqual(ordered.map((map) => map.mapCode), ['resolved', null]);
  });

  it('builds collision-safe unresolved state keys from the full visible identity', () => {
    const unresolved = battleMapFixture({
      categoryId: 'adventure_map',
      mapCode: null,
      resolved: false,
      keyMode: 'UNKNOWN',
      groupName: '  대충산   위험지역 ',
      groupOrder: 7,
      mapOrder: 3,
      name: '코드 확인 중',
      rawHref: 'sp_hunt#',
    });
    const baseKey = buildBattleMapStateKey(unresolved);
    const distinctKeys = [
      buildBattleMapStateKey({ ...unresolved, categoryId: 'battle_map' }),
      buildBattleMapStateKey({ ...unresolved, groupName: '다른 그룹' }),
      buildBattleMapStateKey({ ...unresolved, groupOrder: 8 }),
      buildBattleMapStateKey({ ...unresolved, mapOrder: 4 }),
      buildBattleMapStateKey({ ...unresolved, name: '다른 이름' }),
      buildBattleMapStateKey({ ...unresolved, rawHref: 'same-placeholder#2' }),
    ];

    assert.equal(new Set([baseKey, ...distinctKeys]).size, 7);
    assert.equal(
      baseKey,
      buildBattleMapStateKey({ ...unresolved, groupName: '대충산 위험지역' }),
    );
    assert.notEqual(
      buildBattleMapStateKey({ ...unresolved, mapCode: 'pending-code', name: '첫 번째 행' }),
      buildBattleMapStateKey({ ...unresolved, mapCode: 'pending-code', name: '두 번째 행' }),
    );
  });

  it('groups maps by original HOF group order for tree rendering', () => {
    const groups = groupBattleMaps([
      battleMapFixture({
        mapCode: 'snow22',
        name: 'Frosty Mountain - 대충산',
        groupName: '대충산 위험지역',
        groupOrder: 7,
        mapOrder: 4,
        recommendedLevel: '40-60',
      }),
      battleMapFixture({
        mapCode: 'gb0',
        name: 'Goblin - 고블린과 놀기',
        groupName: '고블린 부락',
        groupOrder: 0,
        mapOrder: 0,
        recommendedLevel: '1-20',
      }),
      battleMapFixture({
        mapCode: 'snow2',
        name: 'Frosty Mountain - 대충산(고원)',
        groupName: '대충산 위험지역',
        groupOrder: 7,
        mapOrder: 0,
        recommendedLevel: '40-60',
      }),
      battleMapFixture({
        mapCode: 'solo',
        name: '분류 없는 맵',
        groupName: null,
        groupOrder: 99,
        mapOrder: 0,
        recommendedLevel: null,
      }),
    ]);

    assert.deepEqual(
      groups.map((group) => ({
        key: group.key,
        name: group.name,
        mapCodes: group.maps.map((map) => map.mapCode),
      })),
      [
        { key: 'battle_map:0:고블린 부락', name: '고블린 부락', mapCodes: ['gb0'] },
        { key: 'battle_map:7:대충산 위험지역', name: '대충산 위험지역', mapCodes: ['snow2', 'snow22'] },
        { key: 'battle_map:99:기타', name: '기타', mapCodes: ['solo'] },
      ],
    );
  });

  it('skips automation maps that are not currently runnable', () => {
    assert.equal(
      getAutomationMapSkipReason(battleMapFixture({ mapCode: null, resolved: false, keyMode: 'UNKNOWN' })),
      '맵 코드 확인 대기',
    );
    assert.equal(
      getAutomationMapSkipReason(battleMapFixture({ enabled: false })),
      '현재 맵이 보이지 않음',
    );
    assert.equal(
      getAutomationMapSkipReason(battleMapFixture({ keyMode: 'LIMITED', keyCount: 0 })),
      '키 없음',
    );
    assert.equal(
      getAutomationMapSkipReason(battleMapFixture({ availableCount: 0 })),
      '가능 횟수 없음',
    );
    assert.equal(
      getAutomationMapSkipReason(battleMapFixture({ attemptCount: 0 })),
      '도전 가능 횟수 없음',
    );
    assert.equal(
      getAutomationMapSkipReason(battleMapFixture({ winCount: 0 })),
      '승리 가능 횟수 없음',
    );
    assert.equal(
      getAutomationMapSkipReason(battleMapFixture({ cooldownRemainingText: '3시간 0분' })),
      '대기 시간 남음',
    );
  });

  it('allows automation maps with remaining keys or unknown dynamic limits', () => {
    assert.equal(getAutomationMapSkipReason(battleMapFixture({ keyMode: 'LIMITED', keyCount: 2 })), null);
    assert.equal(getAutomationMapSkipReason(battleMapFixture({ keyMode: 'UNKNOWN', keyCount: null, availableCount: null })), null);
  });

  it('shows remaining key count in map metadata instead of the map name', () => {
    assert.equal(
      formatBattleMapMeta(battleMapFixture({
        groupName: '대충산 위험지역',
        recommendedLevel: '40-60',
        requiredTime: 100,
        keyMode: 'LIMITED',
        keyCount: 9,
      })),
      '대충산 위험지역 · Lv 40-60 · Time 100 · 키 9',
    );
  });

  it('formats automation map list names as compact Korean names with remaining keys', () => {
    const map = battleMapFixture({
      name: "Noble's Mansion- 저택 서관(놀이방)",
      groupName: '저택 서관',
      recommendedLevel: '50-60',
      requiredTime: 0,
      availableCount: 15,
      keyMode: 'LIMITED',
      keyCount: 23,
    });

    assert.equal(formatAutomationMapListName(map), '저택 서관(놀이방)');
    assert.equal(formatAutomationMapListMeta(map), 'key 23 · Time 0');
  });

  it('formats automation map dynamic limits and cooldown status', () => {
    assert.equal(
      formatAutomationMapListMeta(battleMapFixture({
        keyMode: 'LIMITED',
        keyCount: 37,
        attemptCount: 15,
        winCount: 5,
        requiredTime: 0,
      })),
      'key 37 · 도전 15 · 승리 5 · Time 0',
    );
    assert.equal(
      formatAutomationMapListMeta(battleMapFixture({
        cooldownRemainingText: '3시간 0분',
        requiredTime: 100,
      })),
      '대기 3시간 0분 · Time 100',
    );
  });

  it('removes Korean prefixes before hyphen from automation map list names', () => {
    assert.equal(
      formatAutomationMapListName(battleMapFixture({
        name: '천년제 무투회 - 검과 방패의 자매',
        keyMode: 'LIMITED',
        keyCount: 10,
        requiredTime: 30,
      })),
      '검과 방패의 자매',
    );
  });

  it('hides scarecrow maps only from adventure map displays', () => {
    const maps = [
      battleMapFixture({ categoryId: 'adventure_map', mapCode: 'dummy', name: '허수아비 훈련장' }),
      battleMapFixture({ categoryId: 'adventure_map', mapCode: 'ruin', name: '유적 입구' }),
      battleMapFixture({ categoryId: 'battle_map', mapCode: 'dummy-battle', name: '허수아비 전투 테스트' }),
    ];

    assert.deepEqual(
      filterDisplayBattleMaps(maps).map((map) => map.mapCode),
      ['ruin', 'dummy-battle'],
    );
  });
});

function battleMapFixture(overrides: Partial<BattleMapResponse>): BattleMapResponse {
  return {
    categoryId: 'battle_map',
    mapCode: 'map',
    name: 'Map',
    groupName: '그룹',
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
    rawHref: '?common=map',
    ...overrides,
    supportsThreeBattles: overrides.supportsThreeBattles ?? false,
  };
}
