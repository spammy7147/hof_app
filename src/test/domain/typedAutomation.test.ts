import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAdventureMapAutomationRequest,
  buildBattleMapAutomationRequest,
  buildExplicitPresetSelection,
  buildHomeQuestAutomationRequest,
  buildPrimaryPresetSelection,
  buildQuestAutomationRequest,
  canAddAutomationType,
  getAddableAutomationTypes,
  hasAllAutomationTypes,
  reorderEntries,
} from '../../main/domain/typedAutomation';
import type { TypedAutomationEntryResponse } from '../../main/types/api';

describe('typed automation domain', () => {
  it('returns missing singleton types in stable display order', () => {
    assert.deepEqual(getAddableAutomationTypes([
      entry(1, 'QUEST', 0),
      entry(2, 'ADVENTURE_MAP', 1),
    ]), ['HOME_QUEST', 'BATTLE_MAP', 'RAID', 'UNION', 'FISHING']);
    assert.deepEqual(getAddableAutomationTypes([]), ['QUEST', 'HOME_QUEST', 'BATTLE_MAP', 'ADVENTURE_MAP', 'RAID', 'UNION', 'FISHING']);
    assert.equal(hasAllAutomationTypes([]), false);
    assert.equal(canAddAutomationType([entry(1, 'QUEST', 0)], 'QUEST'), false);
    assert.equal(canAddAutomationType([entry(1, 'QUEST', 0)], 'BATTLE_MAP'), true);
    assert.equal(hasAllAutomationTypes([
      entry(1, 'QUEST', 0),
      entry(2, 'HOME_QUEST', 1),
      entry(3, 'BATTLE_MAP', 2),
      entry(4, 'ADVENTURE_MAP', 3),
      entry(5, 'RAID', 4),
      entry(6, 'UNION', 5),
      entry(7, 'FISHING', 6),
    ]), true);
  });

  it('reorders immutably and normalizes priorities without changing ids', () => {
    const original = [entry(10, 'QUEST', 8), entry(20, 'BATTLE_MAP', 3), entry(30, 'ADVENTURE_MAP', 1)];
    const reordered = reorderEntries(original, 0, 2);

    assert.deepEqual(reordered.map(({ id, priority }) => ({ id, priority })), [
      { id: 20, priority: 0 },
      { id: 30, priority: 1 },
      { id: 10, priority: 2 },
    ]);
    assert.deepEqual(original.map(({ id, priority }) => ({ id, priority })), [
      { id: 10, priority: 8 },
      { id: 20, priority: 3 },
      { id: 30, priority: 1 },
    ]);
    assert.notEqual(reordered[2], original[0]);
  });

  it('rejects reorder indexes outside the entry list', () => {
    const entries = [entry(1, 'QUEST', 0)];
    assert.throws(() => reorderEntries(entries, -1, 0), RangeError);
    assert.throws(() => reorderEntries(entries, 0, 1), RangeError);
  });

  it('builds the exact PRIMARY and EXPLICIT preset discriminants', () => {
    assert.deepEqual(buildPrimaryPresetSelection(), {
      presetMode: 'PRIMARY',
      partyPresetId: null,
    });
    assert.deepEqual(buildExplicitPresetSelection(42), {
      presetMode: 'EXPLICIT',
      partyPresetId: 42,
    });
    assert.throws(() => buildExplicitPresetSelection(0), RangeError);
  });

  it('normalizes setting orders and keeps source/map orders unique', () => {
    const quest = buildQuestAutomationRequest(true, [{
      questKey: 'daily', displayCode: 'daily', questName: 'Daily', enabled: true, sourceOrder: 9,
      maps: [
        { missionKey: 'b', categoryId: 'battle_map', mapCode: 'gb2', executionOrder: 4, manuallyOverridden: false, ...buildPrimaryPresetSelection() },
        { missionKey: 'a', categoryId: 'battle_map', mapCode: 'gb1', executionOrder: 4, manuallyOverridden: true, ...buildExplicitPresetSelection(7) },
      ],
    }, {
      questKey: 'weekly', displayCode: 'weekly', questName: 'Weekly', enabled: false, sourceOrder: 9, maps: [],
    }]);
    const battle = buildBattleMapAutomationRequest(true, [
      { categoryId: 'battle_map', mapCode: 'gb2', dailyTargetCount: 2, executionOrder: 8, ...buildPrimaryPresetSelection() },
      { categoryId: 'battle_map', mapCode: 'gb1', dailyTargetCount: 1, executionOrder: 8, ...buildExplicitPresetSelection(3) },
    ]);
    const adventure = buildAdventureMapAutomationRequest(false, [
      { categoryId: 'adventure_map', mapCode: 'Noble102', executionOrder: 3, ...buildPrimaryPresetSelection() },
      { categoryId: 'adventure_map', mapCode: 'Noble101', executionOrder: 3, ...buildExplicitPresetSelection(5) },
    ]);
    const home = buildHomeQuestAutomationRequest(true, [
      { questId: 'hq2', questName: '둘째', enabled: true, sourceOrder: 8 },
      { questId: 'hq1', questName: '첫째', enabled: true, sourceOrder: 8 },
    ]);

    assert.deepEqual(quest.quests.map((item) => item.sourceOrder), [0, 1]);
    assert.deepEqual(quest.quests[0]?.maps.map((item) => item.executionOrder), [0, 1]);
    assert.deepEqual(battle.maps.map((item) => item.executionOrder), [0, 1]);
    assert.deepEqual(adventure.maps.map((item) => item.executionOrder), [0, 1]);
    assert.deepEqual(home.quests.map((item) => item.sourceOrder), [0, 1]);
    assert.equal(quest.quests[0]?.maps[1]?.presetMode, 'EXPLICIT');
    assert.equal(quest.quests[0]?.maps[1]?.partyPresetId, 7);
  });
});

function entry(
  id: number,
  type: TypedAutomationEntryResponse['type'],
  priority: number,
): TypedAutomationEntryResponse {
  return {
    id, type, priority, enabled: true, ready: true, warnings: [],
    quests: [], battleMaps: [], battleMapProgress: [], adventureMaps: [],
  };
}
