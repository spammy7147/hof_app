import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildBattleMapAutomationDraft,
  buildBattleMapAutomationRequest,
  buildBattleProgress,
  describeBattleBatch,
  filterBattleAutomationCategories,
  filterBattleMapCatalog,
  moveBattleMapSetting,
  selectBattleMap,
  validateBattleMapAutomationDraft,
} from '../../main/domain/battleMapAutomation';
import type { BattleMapResponse, TypedAutomationEntryResponse } from '../../main/types/api';

describe('battle map automation domain', () => {
  it('computes normal, complete, over-target, raised, and lowered progress with a clamped percent', () => {
    assert.deepEqual(buildBattleProgress({ target: 30, successes: 12 }), { remaining: 18, percent: 40, complete: false });
    assert.deepEqual(buildBattleProgress({ target: 12, successes: 12 }), { remaining: 0, percent: 100, complete: true });
    assert.deepEqual(buildBattleProgress({ target: 10, successes: 12 }), { remaining: 0, percent: 100, complete: true });
    assert.deepEqual(buildBattleProgress({ target: 20, successes: 12 }), { remaining: 8, percent: 60, complete: false });
    assert.deepEqual(buildBattleProgress({ target: 5, successes: 12 }), { remaining: 0, percent: 100, complete: true });
    assert.deepEqual(buildBattleProgress({ target: 10, successes: -5 }), { remaining: 10, percent: 0, complete: false });
    assert.deepEqual(buildBattleProgress({ target: 0, successes: 0 }), { remaining: 1, percent: 0, complete: false });
  });

  it('describes the approved three-battle overshoot rule and unknown capability safely', () => {
    assert.equal(describeBattleBatch({ supportsThreeBattles: true, remaining: 2 }), '다음 3회 전투');
    assert.equal(describeBattleBatch({ supportsThreeBattles: true, remaining: 1 }), '다음 1회 전투');
    assert.equal(describeBattleBatch({ supportsThreeBattles: false, remaining: 9 }), '다음 1회 전투');
    assert.equal(describeBattleBatch({ supportsThreeBattles: null, remaining: 9 }), '다음 1회 전투');
    assert.equal(describeBattleBatch({ supportsThreeBattles: true, remaining: 0 }), '오늘 목표 완료');
  });

  it('validates targets, duplicates, preset discriminants, unresolved new selections, and order', () => {
    const draft = buildBattleMapAutomationDraft(entry(), [map('battle', 'a', 'Alpha')]);
    draft.maps = [
      { ...draft.maps[0]!, dailyTargetCount: 0, executionOrder: 1, presetMode: 'PRIMARY', partyPresetId: 7 },
      { ...draft.maps[0]!, dailyTargetCount: 1.5, executionOrder: 1, presetMode: 'EXPLICIT', partyPresetId: 99 },
      { ...draft.maps[0]!, mapCode: '', dailyTargetCount: 2_147_483_648, executionOrder: 4, source: 'CATALOG', resolved: false },
    ];

    const errors = validateBattleMapAutomationDraft(draft, [4]);
    assert.ok(errors.includes('일일 목표는 1회 이상이어야 합니다.'));
    assert.ok(errors.includes('일일 목표는 정수로 입력해 주세요.'));
    assert.ok(errors.includes('일일 목표는 2,147,483,647회 이하여야 합니다.'));
    assert.ok(errors.includes('같은 전투 맵을 두 번 선택할 수 없습니다.'));
    assert.ok(errors.includes('대표 프리셋 사용 시 개별 프리셋을 함께 지정할 수 없습니다.'));
    assert.ok(errors.includes('선택한 프리셋을 찾을 수 없습니다. 다른 프리셋을 선택해 주세요.'));
    assert.ok(errors.includes('확인되지 않은 맵은 새로 선택할 수 없습니다.'));
    assert.ok(errors.includes('맵 실행 순서는 0부터 빠짐없이 한 번씩 지정해야 합니다.'));
  });

  it('keeps missing stored settings and server progress editable but excludes progress from the exact request', () => {
    const stored = entry();
    const draft = buildBattleMapAutomationDraft(stored, []);
    assert.equal(draft.maps[0]?.displayName, 'a');
    assert.equal(draft.maps[0]?.source, 'STORED');
    assert.equal(draft.maps[0]?.resolved, false);
    assert.equal(draft.dailyProgress['battle\u0000a']?.successfulRuns, 6);

    draft.maps[0]!.dailyTargetCount = 9;
    assert.deepEqual(buildBattleMapAutomationRequest(draft, [4]), {
      enabled: true,
      maps: [{
        categoryId: 'battle', mapCode: 'a', dailyTargetCount: 9,
        presetMode: 'PRIMARY', partyPresetId: null, executionOrder: 0,
      }],
    });
    assert.equal('successfulRuns' in buildBattleMapAutomationRequest(draft, [4]).maps[0]!, false);

    const disabledCatalog = buildBattleMapAutomationDraft(stored, [map('battle', 'a', 'Disabled Alpha', { enabled: false })]);
    assert.equal(disabledCatalog.maps[0]?.displayName, 'Disabled Alpha');
    assert.equal(disabledCatalog.maps[0]?.resolved, true);
    const unresolvedCatalog = buildBattleMapAutomationDraft(stored, [map('battle', 'a', 'Unresolved Alpha', { resolved: false })]);
    assert.equal(unresolvedCatalog.maps[0]?.displayName, 'a');
    assert.equal(unresolvedCatalog.maps[0]?.resolved, false);
  });

  it('searches resolved catalog in stable group/map order and selects, deselects, readds, and reorders contiguously', () => {
    const catalog = [
      map('battle', 'b', 'Beta', { groupName: 'Forest', groupOrder: 1, mapOrder: 2, recommendedLevel: 'Lv 20' }),
      map('battle', 'a', 'Alpha', { groupName: 'Forest', groupOrder: 1, mapOrder: 1, recommendedLevel: 'Lv 10' }),
      map('battle', 'x', 'Hidden', { resolved: false }),
    ];
    assert.deepEqual(filterBattleMapCatalog(catalog, 'forest').map(({ mapCode }) => mapCode), ['a', 'b']);
    assert.deepEqual(filterBattleMapCatalog(catalog, '20').map(({ mapCode }) => mapCode), ['b']);

    let draft = buildBattleMapAutomationDraft(entry(), catalog);
    draft = selectBattleMap(draft, catalog[0]!, true);
    assert.deepEqual(draft.maps.map(({ mapCode, dailyTargetCount, presetMode, partyPresetId, executionOrder }) => (
      [mapCode, dailyTargetCount, presetMode, partyPresetId, executionOrder]
    )), [['a', 3, 'PRIMARY', null, 0], ['b', 1, 'PRIMARY', null, 1]]);
    draft = selectBattleMap(draft, catalog[0]!, false);
    assert.deepEqual(draft.maps.map(({ executionOrder }) => executionOrder), [0]);
    draft = selectBattleMap(draft, catalog[0]!, true);
    assert.equal(draft.dailyProgress['battle\u0000a']?.successfulRuns, 6);
    draft = moveBattleMapSetting(draft, 1, 0);
    assert.deepEqual(draft.maps.map(({ mapCode, executionOrder }) => [mapCode, executionOrder]), [['b', 0], ['a', 1]]);
    draft = selectBattleMap(draft, catalog[1]!, false);
    draft = selectBattleMap(draft, catalog[1]!, true);
    assert.equal(draft.dailyProgress['battle\u0000a']?.successfulRuns, 6);
    assert.equal(selectBattleMap(draft, catalog[2]!, true), draft);
  });

  it('does not let dynamic cooldown, key, or daily-limit state prevent configuration selection', () => {
    const unavailableNow = map('battle', 'later', 'Later', {
      availableCount: 0,
      attemptCount: 0,
      winCount: 0,
      cooldownRemainingSeconds: 3_600,
      keyCount: 0,
    });
    assert.deepEqual(filterBattleMapCatalog([unavailableNow], '').map(({ mapCode }) => mapCode), ['later']);
    const selected = selectBattleMap(buildBattleMapAutomationDraft(entry(), []), unavailableNow, true);
    assert.deepEqual(selected.maps.map(({ mapCode }) => mapCode), ['a', 'later']);
  });

  it('filters only the exact adventure and union categories rejected for battle automation', () => {
    const categories = [
      { id: 'battle_map', label: '전투맵', description: '', order: 0, enabled: true },
      { id: 'adventure_map', label: '모험맵', description: '', order: 1, enabled: true },
      { id: 'union', label: '유니온', description: '', order: 2, enabled: true },
      { id: 'scenario_union', label: '유니온 이름을 포함한 별도 카테고리', description: '', order: 3, enabled: true },
    ];

    assert.deepEqual(filterBattleAutomationCategories(categories).map(({ id }) => id), [
      'battle_map',
      'scenario_union',
    ]);
  });
});

function entry(): TypedAutomationEntryResponse {
  return {
    id: 14, type: 'BATTLE_MAP', enabled: true, priority: 1, ready: true, warnings: [], quests: [], adventureMaps: [],
    battleMaps: [{ categoryId: 'battle', mapCode: 'a', dailyTargetCount: 3, presetMode: 'PRIMARY', partyPresetId: null, executionOrder: 0 }],
    battleMapProgress: [{ categoryId: 'battle', mapCode: 'a', successfulRuns: 6 }],
  };
}

function map(categoryId: string, mapCode: string, name: string, overrides: Partial<BattleMapResponse> = {}): BattleMapResponse {
  return {
    categoryId, mapCode, name, groupName: null, groupOrder: 0, mapOrder: 0, recommendedLevel: null,
    availableCount: null, attemptCount: null, winCount: null, cooldownRemainingText: null,
    cooldownRemainingSeconds: null, keyCount: null, requiredTime: null, enabled: true, resolved: true,
    iconUrl: null, rawHref: '', ...overrides, supportsThreeBattles: overrides.supportsThreeBattles ?? false,
  };
}
