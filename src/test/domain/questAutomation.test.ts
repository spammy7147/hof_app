import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyAutoMatchedMap,
  applyManualMapOverride,
  appendMissionMap,
  buildMissionLabel,
  buildMissionProgressLabel,
  buildQuestAutomationDraft,
  buildQuestAutomationRequest,
  buildQuestMapIdentity,
  buildQuestMissionSummary,
  buildQuestRewardSummary,
  filterQuests,
  filterQuestMapOptions,
  getMissionReadiness,
  hydrateAutoMatchedMapClearMissions,
  matchMapClearMission,
  moveMissionMap,
  prioritizeSelectedQuests,
  removeMissionMap,
  reorderMissionMaps,
  replaceMissionMap,
  restoreQuestSelection,
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

  it('prioritizes selected quests while preserving HOF order within each group', () => {
    const quests = [
      snapshot('late', 'Late', 'ACTIVE', 9, []),
      snapshot('first-selected', 'First selected', 'ACTIVE', 2, []),
      snapshot('early', 'Early', 'ACTIVE', 1, []),
      snapshot('second-selected', 'Second selected', 'ACTIVE', 7, []),
    ];
    const prioritized = prioritizeSelectedQuests(quests, new Set(['second-selected', 'first-selected']));

    assert.deepEqual(
      prioritized.map(({ questId }) => questId),
      ['first-selected', 'second-selected', 'early', 'late'],
    );
    assert.notEqual(prioritized, quests);
    assert.deepEqual(quests.map(({ questId }) => questId), ['late', 'first-selected', 'early', 'second-selected']);
    assert.deepEqual(
      prioritizeSelectedQuests(quests, new Set()).map(({ questId }) => questId),
      ['early', 'first-selected', 'second-selected', 'late'],
    );
  });

  it('builds Korean mission labels and a separate progress label', () => {
    assert.equal(buildMissionLabel(mission('kill', 'MONSTER_KILL', 'Killer Maid')), '몬스터 처치 · Killer Maid');
    assert.equal(buildMissionLabel(mission('clear', 'MAP_CLEAR', '눈 덮인 산')), '맵 클리어 · 눈 덮인 산');
    assert.equal(buildMissionLabel(mission('item', 'ITEM_TURN_IN', '단단한 뿔')), '아이템 반납 · 단단한 뿔');
    assert.equal(buildMissionLabel(mission('now', 'IMMEDIATE', null)), '즉시 완료');
    assert.equal(buildMissionLabel(mission('other', 'OTHER', '대화')), '기타 · 대화');
    assert.equal(buildMissionProgressLabel({ ...mission('kill', 'MONSTER_KILL', 'Killer Maid'), progress: { current: 2, required: 5 } }), '2 / 5');
  });

  it('builds full quest mission summaries with progress in source order', () => {
    assert.equal(buildQuestMissionSummary([]), '미션 · 없음');
    assert.equal(buildQuestMissionSummary([
      { ...mission('kill', 'MONSTER_KILL', 'Killer Maid'), progress: { current: 12, required: 30 } },
      mission('clear', 'MAP_CLEAR', 'Maid Hall'),
      { ...mission('item', 'ITEM_TURN_IN', 'Silver Key'), progress: { current: 1, required: 1 } },
    ]), '미션 · 몬스터 처치 · Killer Maid 12/30 · 맵 클리어 · Maid Hall · 아이템 반납 · Silver Key 1/1');
  });

  it('builds full reward summaries and ignores blank entries', () => {
    assert.equal(buildQuestRewardSummary([]), '보상 · 없음');
    assert.equal(buildQuestRewardSummary(['', '  ']), '보상 · 없음');
    assert.equal(
      buildQuestRewardSummary([' Red Potion ×2 ', '', 'Blue Potion ×2', '  Fund $15,000  ']),
      '보상 · Red Potion ×2 · Blue Potion ×2 · Fund $15,000',
    );
  });

  it('builds map identities from a category and its map code, including a missing code', () => {
    assert.equal(buildQuestMapIdentity(catalogMap('battle_map', 'maid', 'Maid')), 'battle_map\u0000maid');
    assert.equal(buildQuestMapIdentity(catalogMap('battle_map', null, 'Unresolved')), 'battle_map\u0000');
  });

  it('filters resolved battle and adventure maps by category and normalized text in input order', () => {
    const battle = catalogMap('battle_map', 'battle', 'Killer Field');
    battle.groupName = 'Maid Group';
    const adventure = catalogMap('adventure_map', 'adventure', 'Silver Cave');
    adventure.groupName = 'Key Group';
    const unresolved = catalogMap('battle_map', 'unresolved', 'Killer Unresolved');
    unresolved.resolved = false;
    const noCode = catalogMap('adventure_map', null, 'Killer No Code');
    const union = catalogMap('union_map', 'union', 'Killer Union');
    const maps = [adventure, unresolved, noCode, union, battle];

    assert.deepEqual(filterQuestMapOptions(maps, '  MAID group ', 'ALL').map(({ mapCode }) => mapCode), ['battle']);
    assert.deepEqual(filterQuestMapOptions(maps, '', 'BATTLE').map(({ mapCode }) => mapCode), ['battle']);
    assert.deepEqual(filterQuestMapOptions(maps, 'key', 'ADVENTURE').map(({ mapCode }) => mapCode), ['adventure']);
    assert.deepEqual(filterQuestMapOptions(maps, '', 'ALL').map(({ mapCode }) => mapCode), ['adventure', 'battle']);
  });

  it('appends only a unique resolved map with contiguous manual primary defaults', () => {
    const initial = [{ ...mapSetting('old', 'a', 7), executionOrder: 7 }];
    const selected = catalogMap('adventure_map', 'b', 'B');
    const appended = appendMissionMap(initial, 'kill', selected);
    assert.deepEqual(appended, [
      { ...initial[0]!, executionOrder: 0 },
      { missionKey: 'kill', categoryId: 'adventure_map', mapCode: 'b', executionOrder: 1, manuallyOverridden: true, presetMode: 'PRIMARY', partyPresetId: null },
    ]);
    assert.deepEqual(appendMissionMap(initial, 'kill', catalogMap('battle_map', null, 'None')), initial);
    assert.deepEqual(appendMissionMap(appended, 'kill', selected), appended);
  });

  it('replaces maps with one resolved manual primary map and clears an unresolved choice', () => {
    const previous = [mapSetting('old', 'a', 0), mapSetting('old', 'b', 1)];
    assert.deepEqual(replaceMissionMap(previous, 'clear', catalogMap('battle_map', 'new', 'New')), [
      { missionKey: 'clear', categoryId: 'battle_map', mapCode: 'new', executionOrder: 0, manuallyOverridden: true, presetMode: 'PRIMARY', partyPresetId: null },
    ]);
    assert.deepEqual(replaceMissionMap(previous, 'clear', catalogMap('battle_map', null, 'None')), []);
  });

  it('restores cached settings only to live combat missions with the same semantic key', () => {
    const current = snapshot('q1', 'Current', 'AVAILABLE', 12, [
      mission('same', 'MONSTER_KILL', 'Maid'),
      mission('new', 'MAP_CLEAR', 'Cave'),
      mission('item', 'ITEM_TURN_IN', 'Horn'),
    ]);
    const cached = {
      questCode: 'q1', name: 'Old', section: 'ACTIVE' as const, sourceOrder: 1, enabled: false, missing: true,
      missions: [
        { ...mission('same', 'MONSTER_KILL', 'Maid'), maps: [{ ...mapSetting('same', 'a', 9), executionOrder: 9 }] },
        { ...mission('gone', 'MONSTER_KILL', 'Gone'), maps: [mapSetting('gone', 'gone', 0)] },
        { ...mission('item', 'ITEM_TURN_IN', 'Horn'), maps: [mapSetting('item', 'wrong', 0)] },
      ],
    };
    const restored = restoreQuestSelection(current, cached);

    assert.deepEqual(restored, {
      questCode: 'q1', name: 'Current', section: 'AVAILABLE', sourceOrder: 12, enabled: false, missing: false,
      missions: [
        { ...current.missions[0]!, maps: [{ ...mapSetting('same', 'a', 0), executionOrder: 0 }] },
        { ...current.missions[1]!, maps: [] },
        { ...current.missions[2]!, maps: [] },
      ],
    });
  });

  it('restores cached automatic map-clear settings without re-matching them against the current catalog', () => {
    const current = snapshot('q1', 'Current', 'AVAILABLE', 12, [mission('clear', 'MAP_CLEAR', 'Target')]);
    const automatic = { ...mapSetting('clear', 'cached-map', 4), executionOrder: 4, manuallyOverridden: false };
    const cached = {
      questCode: 'q1', name: 'Old', section: 'ACTIVE' as const, sourceOrder: 1, enabled: true, missing: false,
      missions: [{ ...mission('clear', 'MAP_CLEAR', 'Target'), maps: [automatic] }],
    };

    assert.deepEqual(restoreQuestSelection(current, cached, [
      catalogMap('battle_map', 'a', 'Target'),
      catalogMap('adventure_map', 'b', 'Target'),
    ]).missions[0]?.maps, [{ ...automatic, executionOrder: 0 }]);
    assert.deepEqual(restoreQuestSelection(current, cached).missions[0]?.maps, [{ ...automatic, executionOrder: 0 }]);
  });

  it('restores only the first ordered cached map for a map-clear mission', () => {
    const current = snapshot('q1', 'Current', 'AVAILABLE', 12, [mission('clear', 'MAP_CLEAR', 'Target')]);
    const cached = {
      questCode: 'q1', name: 'Old', section: 'ACTIVE' as const, sourceOrder: 1, enabled: true, missing: false,
      missions: [{
        ...mission('clear', 'MAP_CLEAR', 'Target'),
        maps: [
          { ...mapSetting('clear', 'first', 4), executionOrder: 4, manuallyOverridden: true },
          { ...mapSetting('clear', 'second', 5), executionOrder: 5, manuallyOverridden: true },
        ],
      }],
    };

    assert.deepEqual(restoreQuestSelection(current, cached).missions[0]?.maps, [{
      ...mapSetting('clear', 'first', 0),
      manuallyOverridden: true,
    }]);
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

  it('keeps only one ordered map from malformed legacy map-clear settings', () => {
    const clearQuest = snapshot('q-clear', 'Clear', 'ACTIVE', 0, [mission('clear-key', 'MAP_CLEAR', 'Missing')]);
    const first = { ...mapSetting('clear-key', 'first', 0), manuallyOverridden: true };
    const second = { ...mapSetting('clear-key', 'second', 1), manuallyOverridden: true };
    const draft = buildQuestAutomationDraft(
      questEntry([{ questCode: 'q-clear', enabled: true, sourceOrder: 0, maps: [first, second] }]),
      [clearQuest],
      [],
    );

    assert.deepEqual(draft.quests[0]?.missions[0]?.maps, [first]);
    assert.deepEqual(buildQuestAutomationRequest(draft, []).quests[0]?.maps, [first]);
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

    const removed = structuredClone(draft);
    removed.quests[0]!.missions[0]!.maps = [];
    assert.equal(hydrateAutoMatchedMapClearMissions(
      removed,
      [catalogMap('battle_map', 'target', 'Target')],
      (questCode, missionKey) => questCode === 'q-clear' && missionKey === 'clear-key',
    ), removed);
  });

  it('normalizes malformed map-clear drafts to one map during catalog hydration', () => {
    const clearQuest = snapshot('q-clear', 'Clear', 'ACTIVE', 0, [mission('clear-key', 'MAP_CLEAR', 'Target')]);
    const draft = buildQuestAutomationDraft(questEntry([]), [clearQuest]);
    draft.quests = [selectQuest(draft, clearQuest, true).quests[0]!];
    draft.quests[0]!.missions[0]!.maps = [
      { ...mapSetting('clear-key', 'first', 3), executionOrder: 3, manuallyOverridden: true },
      { ...mapSetting('clear-key', 'second', 4), executionOrder: 4, manuallyOverridden: true },
    ];

    assert.deepEqual(
      hydrateAutoMatchedMapClearMissions(draft, [catalogMap('battle_map', 'target', 'Target')])
        .quests[0]?.missions[0]?.maps,
      [{ ...mapSetting('clear-key', 'first', 0), manuallyOverridden: true }],
    );
  });

  it('supports ordered monster maps with reorder and remove', () => {
    const maps = [mapSetting('kill', 'a', 0), mapSetting('kill', 'b', 1), mapSetting('kill', 'c', 2)];
    assert.deepEqual(moveMissionMap(maps, 2, 0).map(({ mapCode, executionOrder }) => [mapCode, executionOrder]), [['c', 0], ['a', 1], ['b', 2]]);
    assert.deepEqual(removeMissionMap(maps, 1).map(({ mapCode, executionOrder }) => [mapCode, executionOrder]), [['a', 0], ['c', 1]]);
  });

  it('preserves dragged map order while normalizing execution order without mutating input', () => {
    const maps = [mapSetting('kill', 'c', 9), mapSetting('kill', 'a', 4), mapSetting('kill', 'b', 7)];

    assert.deepEqual(reorderMissionMaps(maps).map(({ mapCode, executionOrder }) => [mapCode, executionOrder]), [
      ['c', 0], ['a', 1], ['b', 2],
    ]);
    assert.deepEqual(maps.map(({ mapCode, executionOrder }) => [mapCode, executionOrder]), [
      ['c', 9], ['a', 4], ['b', 7],
    ]);
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

  it('requires exactly one map for map-clear missions', () => {
    const quest = snapshot('clear', 'Clear', 'ACTIVE', 0, [mission('clear-key', 'MAP_CLEAR', 'Target')]);
    const draft = selectQuest(buildQuestAutomationDraft(questEntry([]), [quest]), quest, true);
    draft.quests[0]!.missions[0]!.maps = [
      { ...mapSetting('clear-key', 'a', 0), manuallyOverridden: true },
      { ...mapSetting('clear-key', 'b', 1), manuallyOverridden: true },
    ];

    assert.match(validateQuestAutomationDraft(draft, []).join(' '), /하나/);
    assert.throws(() => buildQuestAutomationRequest(draft, []), /하나/);
  });

  it('coalesces repeated semantic mission instances into one UI setting and one request map list', () => {
    const repeated = snapshot('repeat', 'Repeated', 'ACTIVE', 0, [
      mission('kill-key', 'MONSTER_KILL', 'Killer Maid'),
      mission('kill-key', 'MONSTER_KILL', 'Killer Maid'),
    ]);
    const storedMaps = [mapSetting('kill-key', 'a', 0), mapSetting('kill-key', 'b', 1)];
    const draft = buildQuestAutomationDraft(
      questEntry([{ questCode: 'repeat', enabled: true, sourceOrder: 0, maps: storedMaps }]),
      [repeated],
    );

    assert.equal(draft.quests[0]?.missions.length, 1);
    assert.deepEqual(buildQuestAutomationRequest(draft, []).quests[0]?.maps, storedMaps);
  });

  it('validates duplicate semantic mission map identities across the whole quest', () => {
    const quest = snapshot('repeat', 'Repeated', 'ACTIVE', 0, [mission('kill-key', 'MONSTER_KILL', 'Killer Maid')]);
    const draft = selectQuest(buildQuestAutomationDraft(questEntry([]), [quest]), quest, true);
    const duplicated = { ...draft.quests[0]!.missions[0]!, maps: [mapSetting('kill-key', 'a', 0)] };
    draft.quests[0]!.missions = [duplicated, structuredClone(duplicated)];

    assert.match(validateQuestAutomationDraft(draft, []).join(' '), /중복/);
    assert.throws(() => buildQuestAutomationRequest(draft, []), /중복/);
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
  return { questId, name, state: section === 'ACTIVE' ? 'ACTIVE' : section === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE', section, sourceOrder, missions, actionNo: null, rewards: [] };
}

function mapSetting(missionKey: string, mapCode: string, executionOrder: number) {
  return { missionKey, categoryId: 'battle_map', mapCode, executionOrder, manuallyOverridden: false, presetMode: 'PRIMARY' as const, partyPresetId: null };
}

function questEntry(quests: TypedAutomationEntryResponse['quests']): TypedAutomationEntryResponse {
  return { id: 1, type: 'QUEST', enabled: true, priority: 0, ready: true, warnings: [], quests, battleMaps: [], battleMapProgress: [], adventureMaps: [] };
}

function catalogMap(categoryId: string, mapCode: string | null, name: string): BattleMapResponse {
  return { categoryId, mapCode, name, groupName: null, groupOrder: 0, mapOrder: 0, recommendedLevel: null, availableCount: null, attemptCount: null, winCount: null, cooldownRemainingText: null, cooldownRemainingSeconds: null, keyMode: mapCode == null ? 'UNKNOWN' : 'NOT_REQUIRED', keyCount: null, requiredTime: null, supportsThreeBattles: false, enabled: true, resolved: true, iconUrl: null, rawHref: '' };
}
