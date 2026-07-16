import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyAutoMatchedMap,
  applyManualMapOverride,
  buildMissionLabel,
  buildMissionProgressLabel,
  buildQuestAutomationDraft,
  buildQuestAutomationRequest,
  filterQuests,
  getMissionReadiness,
  hydrateAutoMatchedMapClearMissions,
  matchMapClearMission,
  moveMissionMap,
  removeMissionMap,
  selectQuest,
  validateQuestAutomationDraft,
} from '../../main/domain/questAutomation';
import type {
  BattleMapResponse,
  QuestMission,
  QuestSnapshot,
  TypedAutomationEntryResponse,
} from '../../main/types/api';

describe('quest automation domain', () => {
  it('filters the exact section and case-insensitive quest/mission text while preserving HOF order', () => {
    const quests = [
      snapshot('late', 'Second', 'ACTIVE', 8, [mission('kill', 'MONSTER_KILL', 'Killer Maid')]),
      snapshot('waiting', 'Killer request', 'WAITING', 0, [mission('other', 'OTHER', 'letter')]),
      snapshot('early', 'First', 'ACTIVE', 2, [mission('clear', 'MAP_CLEAR', 'KILLER FIELD')]),
    ];
    assert.deepEqual(filterQuests(quests, 'ACTIVE', 'killer').map(({ questId }) => questId), ['early', 'late']);
    assert.deepEqual(filterQuests(quests, 'WAITING', 'request').map(({ questId }) => questId), ['waiting']);
  });

  it('builds Korean mission labels and a separate progress label', () => {
    assert.equal(buildMissionLabel(mission('kill', 'MONSTER_KILL', 'Killer Maid')), '몬스터 처치 · Killer Maid');
    assert.equal(buildMissionLabel(mission('clear', 'MAP_CLEAR', '눈 덮인 산')), '맵 클리어 · 눈 덮인 산');
    assert.equal(buildMissionLabel(mission('item', 'ITEM_TURN_IN', '단단한 뿔')), '아이템 반납 · 단단한 뿔');
    assert.equal(buildMissionLabel(mission('now', 'IMMEDIATE', null)), '즉시 완료');
    assert.equal(buildMissionLabel(mission('other', 'OTHER', '대화')), '기타 · 대화');
    assert.equal(buildMissionProgressLabel({ ...mission('kill', 'MONSTER_KILL', 'Killer Maid'), progress: { current: 2, required: 5 } }), '2 / 5');
  });

  it('keeps a selected repeated quest and its config when the latest snapshot disappears', () => {
    const entry = questEntry([{ questCode: 'repeat', enabled: true, sourceOrder: 7, maps: [mapSetting('kill', 'a', 0)] }]);
    const draft = buildQuestAutomationDraft(entry, []);
    assert.equal(draft.quests[0]?.missing, true);
    assert.deepEqual(buildQuestAutomationRequest(draft, [4]), {
      enabled: true,
      quests: [{ questCode: 'repeat', enabled: true, sourceOrder: 0, maps: [mapSetting('kill', 'a', 0)] }],
    });
  });

  it('selects without disturbing existing config and deselection removes it from the request', () => {
    const quest = snapshot('q1', 'Quest', 'ACTIVE', 3, [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const stored = questEntry([{ questCode: 'q1', enabled: true, sourceOrder: 3, maps: [mapSetting('kill', 'a', 0)] }]);
    const draft = buildQuestAutomationDraft(stored, [quest]);
    assert.deepEqual(selectQuest(draft, quest, true).quests[0]?.missions[0]?.maps, [mapSetting('kill', 'a', 0)]);
    assert.deepEqual(selectQuest(draft, quest, false).quests, []);
  });

  it('auto matches map-clear only when unique and preserves a manual override', () => {
    const clear = mission('clear-key', 'MAP_CLEAR', 'Killer Field');
    const maps = [catalogMap('battle_map', 'killer', 'Killer Field')];
    assert.equal(matchMapClearMission(clear, maps)?.mapCode, 'killer');
    assert.equal(matchMapClearMission(clear, [...maps, catalogMap('adventure_map', 'killer2', 'Killer Field')]), null);

    const base = mapSetting('clear-key', 'old', 0);
    const automatic = applyAutoMatchedMap(base, maps[0]!);
    assert.equal(automatic.manuallyOverridden, false);
    const manual = applyManualMapOverride(automatic, catalogMap('battle_map', 'new', 'New'));
    assert.equal(manual.manuallyOverridden, true);
    assert.deepEqual(applyAutoMatchedMap(manual, maps[0]!), manual);
  });

  it('matches map-clear against canonical names and explicit aliases only', () => {
    const clear = mission('clear-key', 'MAP_CLEAR', 'Hidden Alias');
    const groupOnly = catalogMap('battle_map', 'group-map', 'Different Name');
    groupOnly.groupName = 'Hidden Alias';
    const codeOnly = catalogMap('battle_map', 'Hidden Alias', 'Another Name');
    const explicitAlias = { ...catalogMap('adventure_map', 'alias-map', 'Alias Canonical'), aliases: ['Hidden Alias'] };

    assert.equal(matchMapClearMission(clear, [groupOnly]), null);
    assert.equal(matchMapClearMission(clear, [codeOnly]), null);
    assert.equal(matchMapClearMission(clear, [explicitAlias])?.mapCode, 'alias-map');
  });

  it('clears a stale stored automatic map when current matching is missing or ambiguous', () => {
    const clearQuest = snapshot('q-clear', 'Clear', 'ACTIVE', 0, [mission('clear-key', 'MAP_CLEAR', 'Target')]);
    const entry = questEntry([{ questCode: 'q-clear', enabled: true, sourceOrder: 0, maps: [mapSetting('clear-key', 'stale', 0)] }]);

    for (const catalog of [
      [catalogMap('battle_map', 'other', 'Other')],
      [catalogMap('battle_map', 'a', 'Target'), catalogMap('adventure_map', 'b', 'Target')],
    ]) {
      const draft = buildQuestAutomationDraft(entry, [clearQuest], catalog);
      const configured = draft.quests[0]!.missions[0]!;
      assert.equal(configured.maps[0]?.mapCode, '');
      assert.equal(getMissionReadiness(configured, []), '맵 설정 필요');
      assert.match(validateQuestAutomationDraft(draft, []).join(' '), /맵 설정 필요/);
    }
  });

  it('preserves a stored manual map when current matching is missing', () => {
    const clearQuest = snapshot('q-clear', 'Clear', 'ACTIVE', 0, [mission('clear-key', 'MAP_CLEAR', 'Missing')]);
    const manual = { ...mapSetting('clear-key', 'chosen', 0), manuallyOverridden: true };
    const draft = buildQuestAutomationDraft(
      questEntry([{ questCode: 'q-clear', enabled: true, sourceOrder: 0, maps: [manual] }]),
      [clearQuest],
      [],
    );

    assert.deepEqual(draft.quests[0]?.missions[0]?.maps, [manual]);
    assert.equal(getMissionReadiness(draft.quests[0]!.missions[0]!, []), '사용자 변경');
  });

  it('hydrates only unresolved automatic map-clear rows while preserving user-owned draft fields', () => {
    const clearQuest = snapshot('q-clear', 'Clear', 'ACTIVE', 0, [mission('clear-key', 'MAP_CLEAR', 'Target')]);
    const automatic = {
      ...mapSetting('clear-key', '', 0),
      categoryId: '',
      presetMode: 'EXPLICIT' as const,
      partyPresetId: 7,
    };
    const draft = buildQuestAutomationDraft(
      questEntry([{ questCode: 'q-clear', enabled: true, sourceOrder: 0, maps: [automatic] }]),
      [clearQuest],
      [],
    );
    draft.enabled = false;
    draft.quests[0]!.enabled = false;

    const hydrated = hydrateAutoMatchedMapClearMissions(draft, [catalogMap('battle_map', 'target', 'Target')]);

    assert.notEqual(hydrated, draft);
    assert.equal(hydrated.enabled, false);
    assert.equal(hydrated.quests[0]!.enabled, false);
    assert.deepEqual(hydrated.quests[0]!.missions[0]!.maps, [{
      ...automatic,
      categoryId: 'battle_map',
      mapCode: 'target',
    }]);

    const manual = structuredClone(draft);
    manual.quests[0]!.missions[0]!.maps[0]!.manuallyOverridden = true;
    assert.equal(hydrateAutoMatchedMapClearMissions(manual, [catalogMap('battle_map', 'target', 'Target')]), manual);
    assert.equal(hydrateAutoMatchedMapClearMissions(draft, [
      catalogMap('battle_map', 'a', 'Target'),
      catalogMap('adventure_map', 'b', 'Target'),
    ]), draft);
  });

  it('supports ordered monster maps with reorder and remove', () => {
    const maps = [mapSetting('kill', 'a', 0), mapSetting('kill', 'b', 1), mapSetting('kill', 'c', 2)];
    assert.deepEqual(moveMissionMap(maps, 2, 0).map(({ mapCode, executionOrder }) => [mapCode, executionOrder]), [['c', 0], ['a', 1], ['b', 2]]);
    assert.deepEqual(removeMissionMap(maps, 1).map(({ mapCode, executionOrder }) => [mapCode, executionOrder]), [['a', 0], ['c', 1]]);
  });

  it('validates maps, presets, duplicates, and excludes map config from non-combat missions', () => {
    const quest = snapshot('q1', 'Quest', 'ACTIVE', 0, [
      mission('kill', 'MONSTER_KILL', 'Maid'),
      mission('item', 'ITEM_TURN_IN', 'horn'),
    ]);
    let draft = buildQuestAutomationDraft(questEntry([]), [quest]);
    draft = selectQuest(draft, quest, true);
    assert.match(validateQuestAutomationDraft(draft, [9]).join(' '), /맵 설정 필요/);
    assert.equal(getMissionReadiness(draft.quests[0]!.missions[0]!, [9]), '맵 설정 필요');

    draft.quests[0]!.missions[0]!.maps = [{ ...mapSetting('kill', 'a', 0), presetMode: 'EXPLICIT', partyPresetId: 999 }];
    assert.match(validateQuestAutomationDraft(draft, [9]).join(' '), /프리셋 설정 필요/);
    assert.equal(getMissionReadiness(draft.quests[0]!.missions[0]!, [9]), '프리셋 설정 필요');

    draft.quests[0]!.missions[0]!.maps = [mapSetting('kill', 'a', 0), mapSetting('kill', 'a', 1)];
    assert.match(validateQuestAutomationDraft(draft, [9]).join(' '), /중복/);
    draft.quests[0]!.missions[1]!.maps = [mapSetting('item', 'should-not-save', 0)];
    draft.quests[0]!.missions[0]!.maps = [{ ...mapSetting('kill', 'a', 0), manuallyOverridden: true }];
    assert.equal(getMissionReadiness(draft.quests[0]!.missions[0]!, [9]), '사용자 변경');
    assert.deepEqual(buildQuestAutomationRequest(draft, [9]).quests[0]?.maps.map(({ missionKey }) => missionKey), ['kill']);
  });

  it('emits contiguous unique source order in deterministic draft order', () => {
    const missing = questEntry([
      { questCode: 'missing', enabled: true, sourceOrder: 4, maps: [] },
      { questCode: 'live', enabled: true, sourceOrder: 4, maps: [] },
    ]);
    const live = snapshot('live', 'Live', 'ACTIVE', 4, [mission('now', 'IMMEDIATE', null)]);
    const request = buildQuestAutomationRequest(buildQuestAutomationDraft(missing, [live]), []);

    assert.deepEqual(request.quests.map(({ questCode, sourceOrder }) => [questCode, sourceOrder]), [
      ['missing', 0],
      ['live', 1],
    ]);
  });
});

function mission(key: string, type: QuestMission['type'], target: string | null): QuestMission {
  return { key, type, target, progress: null, completable: false };
}

function snapshot(questId: string, name: string, section: QuestSnapshot['section'], sourceOrder: number, missions: QuestMission[]): QuestSnapshot {
  return { questId, name, state: section === 'ACTIVE' ? 'ACTIVE' : section === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE', section, sourceOrder, missions, actionNo: null };
}

function mapSetting(missionKey: string, mapCode: string, executionOrder: number) {
  return { missionKey, categoryId: 'battle_map', mapCode, executionOrder, manuallyOverridden: false, presetMode: 'PRIMARY' as const, partyPresetId: null };
}

function questEntry(quests: TypedAutomationEntryResponse['quests']): TypedAutomationEntryResponse {
  return { id: 1, type: 'QUEST', enabled: true, priority: 0, ready: true, warnings: [], quests, battleMaps: [], adventureMaps: [] };
}

function catalogMap(categoryId: string, mapCode: string, name: string): BattleMapResponse {
  return { categoryId, mapCode, name, groupName: null, groupOrder: 0, mapOrder: 0, recommendedLevel: null, availableCount: null, attemptCount: null, winCount: null, cooldownRemainingText: null, cooldownRemainingSeconds: null, keyCount: null, requiredTime: null, enabled: true, resolved: true, iconUrl: null, rawHref: '' };
}
