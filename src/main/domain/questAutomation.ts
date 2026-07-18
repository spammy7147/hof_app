import type {
  BattleMapResponse,
  QuestMapSettingRequest,
  QuestMission,
  QuestMissionType,
  QuestSection,
  QuestSnapshot,
  TypedAutomationEntryResponse,
  UpdateQuestAutomationRequest,
} from '../types/api';

export type CombatQuestMissionType = Extract<QuestMissionType, 'MONSTER_KILL' | 'MAP_CLEAR'>;
export type QuestMissionReadiness = '자동 매칭됨' | '사용자 변경' | '맵 설정 필요' | '프리셋 설정 필요';
export type QuestMapFilter = 'ALL' | 'BATTLE' | 'ADVENTURE';

export type QuestMissionDraft = QuestMission & {
  maps: QuestMapSettingRequest[];
};

export type QuestSelectionDraft = {
  questCode: string;
  name: string;
  section: QuestSection | null;
  sourceOrder: number;
  enabled: boolean;
  missing: boolean;
  missions: QuestMissionDraft[];
};

export type QuestAutomationDraft = {
  enabled: boolean;
  quests: QuestSelectionDraft[];
};

export type QuestMapCatalogItem = BattleMapResponse & { aliases?: readonly string[] };

const COMBAT_TYPES = new Set<QuestMissionType>(['MONSTER_KILL', 'MAP_CLEAR']);
const MISSION_LABELS: Record<QuestMissionType, string> = {
  IMMEDIATE: '즉시 완료',
  ITEM_TURN_IN: '아이템 반납',
  MONSTER_KILL: '몬스터 처치',
  MAP_CLEAR: '맵 클리어',
  OTHER: '기타',
};

export function isCombatMission(mission: Pick<QuestMission, 'type'>): mission is QuestMission & { type: CombatQuestMissionType } {
  return COMBAT_TYPES.has(mission.type);
}

export function filterQuests(
  quests: readonly QuestSnapshot[],
  section: Extract<QuestSection, 'ACTIVE' | 'AVAILABLE' | 'WAITING'>,
  query: string,
): QuestSnapshot[] {
  const needle = normalizeSearch(query);
  return quests
    .filter((quest) => quest.section === section)
    .filter((quest) => !needle || normalizeSearch([
      quest.name,
      ...quest.missions.flatMap((mission) => [
        MISSION_LABELS[mission.type],
        mission.type,
        mission.target ?? '',
      ]),
    ].join(' ')).includes(needle))
    .sort((left, right) => left.sourceOrder - right.sourceOrder);
}

export function buildMissionLabel(mission: QuestMission): string {
  const label = MISSION_LABELS[mission.type];
  return mission.target?.trim() ? `${label} · ${mission.target.trim()}` : label;
}

export function buildMissionProgressLabel(mission: QuestMission): string | null {
  return mission.progress ? `${mission.progress.current} / ${mission.progress.required}` : null;
}

export function buildQuestMissionSummary(missions: readonly QuestMission[]): string {
  if (missions.length === 0) return '미션 · 없음';
  const items = missions.map((mission) => {
    const progress = buildMissionProgressLabel(mission);
    return `${buildMissionLabel(mission)}${progress ? ` ${progress.replace(' / ', '/')}` : ''}`;
  });
  return `미션 · ${items.join(' · ')}`;
}

export function buildQuestRewardSummary(rewards: readonly string[]): string {
  const items = rewards.map((reward) => reward.trim()).filter(Boolean);
  return items.length === 0 ? '보상 · 없음' : `보상 · ${items.join(' · ')}`;
}

export function buildQuestMapIdentity(map: Pick<BattleMapResponse, 'categoryId' | 'mapCode'>): string {
  return `${map.categoryId}\u0000${map.mapCode ?? ''}`;
}

export function filterQuestMapOptions(
  maps: readonly BattleMapResponse[],
  query: string,
  filter: QuestMapFilter,
): BattleMapResponse[] {
  const needle = normalizeSearch(query);
  return maps.filter((map) => {
    if (!map.resolved || map.mapCode == null) return false;
    const allowed = filter === 'ALL'
      ? map.categoryId === 'battle_map' || map.categoryId === 'adventure_map'
      : filter === 'BATTLE' ? map.categoryId === 'battle_map' : map.categoryId === 'adventure_map';
    return allowed && (!needle || normalizeSearch(`${map.name} ${map.groupName ?? ''}`).includes(needle));
  });
}

export function appendMissionMap(
  maps: readonly QuestMapSettingRequest[],
  missionKey: string,
  selected: BattleMapResponse,
): QuestMapSettingRequest[] {
  if (selected.mapCode == null || maps.some((map) => buildQuestMapIdentity(map) === buildQuestMapIdentity(selected))) {
    return [...maps];
  }
  return normalizeMapOrder([...maps, manualMapSetting(missionKey, selected.categoryId, selected.mapCode)]);
}

export function replaceMissionMap(
  _maps: readonly QuestMapSettingRequest[],
  missionKey: string,
  selected: BattleMapResponse,
): QuestMapSettingRequest[] {
  return selected.mapCode == null ? [] : [manualMapSetting(missionKey, selected.categoryId, selected.mapCode)];
}

export function restoreQuestSelection(
  snapshot: QuestSnapshot,
  cached: QuestSelectionDraft,
  catalog: readonly QuestMapCatalogItem[] = [],
): QuestSelectionDraft {
  const cachedMapsByMission = new Map(cached.missions.map((mission) => [mission.key, mission.maps]));
  const fresh = buildSelection(snapshot, null, catalog);
  return {
    ...fresh,
    enabled: cached.enabled,
    missions: fresh.missions.map((mission) => (
      !isCombatMission(mission) || !cachedMapsByMission.has(mission.key)
        ? mission
        : { ...mission, maps: normalizeMissionMaps(mission.type, cachedMapsByMission.get(mission.key)!) }
    )),
  };
}

export function buildQuestAutomationDraft(
  entry: Pick<TypedAutomationEntryResponse, 'enabled' | 'quests'>,
  snapshots: readonly QuestSnapshot[],
  catalog: readonly QuestMapCatalogItem[] = [],
): QuestAutomationDraft {
  const byQuestCode = new Map(snapshots.map((snapshot) => [snapshot.questId, snapshot]));
  return {
    enabled: entry.enabled,
    quests: entry.quests.map((selection) => {
      const snapshot = byQuestCode.get(selection.questCode);
      if (!snapshot) return buildMissingSelection(selection);
      return buildSelection(snapshot, selection, catalog);
    }),
  };
}

export function selectQuest(
  draft: QuestAutomationDraft,
  snapshot: QuestSnapshot,
  selected: boolean,
  catalog: readonly QuestMapCatalogItem[] = [],
): QuestAutomationDraft {
  const existingIndex = draft.quests.findIndex(({ questCode }) => questCode === snapshot.questId);
  if (!selected) {
    return { ...draft, quests: draft.quests.filter(({ questCode }) => questCode !== snapshot.questId) };
  }
  if (existingIndex >= 0) return draft;
  return {
    ...draft,
    quests: [...draft.quests, buildSelection(snapshot, null, catalog)],
  };
}

export function matchMapClearMission(
  mission: Pick<QuestMission, 'type' | 'target'>,
  catalog: readonly QuestMapCatalogItem[],
): QuestMapCatalogItem | null {
  if (mission.type !== 'MAP_CLEAR' || !mission.target?.trim()) return null;
  const target = normalizeIdentity(mission.target);
  const matches = catalog.filter((map) => map.mapCode != null && [
    map.name,
    ...(map.aliases ?? []),
  ].some((candidate) => normalizeIdentity(candidate) === target));
  return matches.length === 1 ? matches[0]! : null;
}

export function applyAutoMatchedMap(
  current: QuestMapSettingRequest,
  selected: BattleMapResponse,
): QuestMapSettingRequest {
  if (current.manuallyOverridden || selected.mapCode == null) return current;
  return {
    ...current,
    categoryId: selected.categoryId,
    mapCode: selected.mapCode,
    manuallyOverridden: false,
  };
}

export function applyManualMapOverride(
  current: QuestMapSettingRequest,
  selected: BattleMapResponse,
): QuestMapSettingRequest {
  if (selected.mapCode == null) return current;
  return {
    ...current,
    categoryId: selected.categoryId,
    mapCode: selected.mapCode,
    manuallyOverridden: true,
  };
}

export function hydrateAutoMatchedMapClearMissions(
  draft: QuestAutomationDraft,
  catalog: readonly QuestMapCatalogItem[],
  isBlocked: (questCode: string, missionKey: string) => boolean = () => false,
): QuestAutomationDraft {
  let changed = false;
  const quests = draft.quests.map((quest) => {
    let questChanged = false;
    const missions = quest.missions.map((mission) => {
      if (mission.type !== 'MAP_CLEAR') return mission;
      const normalizedMaps = normalizeMissionMaps(mission.type, mission.maps);
      const normalized = normalizedMaps.length !== mission.maps.length
        || normalizedMaps.some((map, index) => map.executionOrder !== mission.maps[index]?.executionOrder);
      const normalizedMission = normalized ? { ...mission, maps: normalizedMaps } : mission;
      if (isBlocked(quest.questCode, mission.key) || normalizedMaps.some(({ manuallyOverridden }) => manuallyOverridden)) {
        if (normalized) {
          changed = true;
          questChanged = true;
        }
        return normalizedMission;
      }
      const match = matchMapClearMission(mission, catalog);
      if (!match) {
        if (normalized) {
          changed = true;
          questChanged = true;
        }
        return normalizedMission;
      }
      const unresolvedIndex = normalizedMaps.findIndex(({ categoryId, mapCode }) => !categoryId.trim() || !mapCode.trim());
      if (unresolvedIndex < 0 && normalizedMaps.length > 0) {
        if (normalized) {
          changed = true;
          questChanged = true;
        }
        return normalizedMission;
      }
      const maps = normalizedMaps.length === 0
        ? [applyAutoMatchedMap(emptyMapSetting(mission.key), match)]
        : normalizedMaps.map((map, index) => index === unresolvedIndex ? applyAutoMatchedMap(map, match) : map);
      changed = true;
      questChanged = true;
      return { ...mission, maps };
    });
    return questChanged ? { ...quest, missions } : quest;
  });
  return changed ? { ...draft, quests } : draft;
}

export function moveMissionMap(
  maps: readonly QuestMapSettingRequest[],
  from: number,
  to: number,
): QuestMapSettingRequest[] {
  if (from < 0 || to < 0 || from >= maps.length || to >= maps.length || from === to) {
    return normalizeMapOrder(maps);
  }
  const reordered = [...maps];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved!);
  return normalizeMapOrder(reordered);
}

export function removeMissionMap(
  maps: readonly QuestMapSettingRequest[],
  index: number,
): QuestMapSettingRequest[] {
  return normalizeMapOrder(maps.filter((_map, currentIndex) => currentIndex !== index));
}

export function getMissionReadiness(
  mission: QuestMissionDraft,
  validPresetIds: readonly number[],
): QuestMissionReadiness | null {
  if (!isCombatMission(mission)) return null;
  if (
    mission.maps.length === 0
    || mission.type === 'MAP_CLEAR' && mission.maps.length !== 1
    || mission.maps.some((map) => !map.categoryId.trim() || !map.mapCode.trim())
  ) {
    return '맵 설정 필요';
  }
  if (mission.maps.some((map) => !isValidPreset(map, validPresetIds))) return '프리셋 설정 필요';
  return mission.type === 'MAP_CLEAR' && mission.maps.every((map) => !map.manuallyOverridden)
    ? '자동 매칭됨'
    : '사용자 변경';
}

export function validateQuestAutomationDraft(
  draft: QuestAutomationDraft,
  validPresetIds: readonly number[],
): string[] {
  const errors: string[] = [];
  const questCodes = new Set<string>();
  for (const quest of draft.quests) {
    if (questCodes.has(quest.questCode)) errors.push(`${quest.name}: 중복 선택된 퀘스트입니다.`);
    questCodes.add(quest.questCode);
    const missionKeys = new Set<string>();
    const questMapIdentities = new Set<string>();
    for (const mission of quest.missions) {
      if (!isCombatMission(mission)) continue;
      if (missionKeys.has(mission.key)) errors.push(`${quest.name} · ${buildMissionLabel(mission)}: 중복된 미션 설정입니다.`);
      missionKeys.add(mission.key);
      if (mission.maps.length === 0) {
        errors.push(`${quest.name} · ${buildMissionLabel(mission)}: 맵 설정 필요`);
        continue;
      }
      if (mission.type === 'MAP_CLEAR' && mission.maps.length !== 1) {
        errors.push(`${quest.name} · ${buildMissionLabel(mission)}: 맵은 하나만 선택할 수 있습니다.`);
      }
      const identities = new Set<string>();
      for (const map of mission.maps) {
        if (!map.categoryId.trim() || !map.mapCode.trim()) {
          errors.push(`${quest.name} · ${buildMissionLabel(mission)}: 맵 설정 필요`);
        }
        const identity = `${map.categoryId}\u0000${map.mapCode}`;
        if (identities.has(identity)) errors.push(`${quest.name} · ${buildMissionLabel(mission)}: 중복된 맵입니다.`);
        identities.add(identity);
        const questIdentity = `${mission.key}\u0000${identity}`;
        if (questMapIdentities.has(questIdentity)) errors.push(`${quest.name} · ${buildMissionLabel(mission)}: 중복된 맵입니다.`);
        questMapIdentities.add(questIdentity);
        if (!isValidPreset(map, validPresetIds)) {
          errors.push(`${quest.name} · ${buildMissionLabel(mission)}: 프리셋 설정 필요`);
        }
      }
    }
  }
  return [...new Set(errors)];
}

export function buildQuestAutomationRequest(
  draft: QuestAutomationDraft,
  validPresetIds: readonly number[],
): UpdateQuestAutomationRequest {
  const errors = validateQuestAutomationDraft(draft, validPresetIds);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return {
    enabled: draft.enabled,
    quests: draft.quests.map((quest, sourceOrder) => ({
      questCode: quest.questCode,
      enabled: quest.enabled,
      sourceOrder,
      maps: normalizeMapOrder(quest.missions.flatMap((mission) => (
        isCombatMission(mission)
          ? mission.maps.map((map) => ({ ...map, missionKey: mission.key }))
          : []
      ))),
    })),
  };
}

function buildSelection(
  snapshot: QuestSnapshot,
  stored: TypedAutomationEntryResponse['quests'][number] | null,
  catalog: readonly QuestMapCatalogItem[],
): QuestSelectionDraft {
  const storedByMission = groupMapsByMission(stored?.maps ?? []);
  const missions = coalesceMissions(snapshot.missions).map<QuestMissionDraft>((mission) => {
    if (!isCombatMission(mission)) return { ...mission, maps: [] };
    let maps = normalizeMissionMaps(mission.type, storedByMission.get(mission.key) ?? []);
    if (mission.type === 'MAP_CLEAR' && !maps.some(({ manuallyOverridden }) => manuallyOverridden)) {
      const matched = matchMapClearMission(mission, catalog);
      if (matched) {
        const seed = maps[0] ?? emptyMapSetting(mission.key);
        maps = [applyAutoMatchedMap(seed, matched)];
      } else if (maps.length > 0) {
        maps = [{ ...maps[0]!, categoryId: '', mapCode: '', executionOrder: 0 }];
      }
    }
    return { ...mission, maps };
  });
  for (const [missionKey, maps] of storedByMission) {
    if (missions.some(({ key }) => key === missionKey)) continue;
    missions.push({ key: missionKey, type: 'MONSTER_KILL', target: null, progress: null, completable: false, maps });
  }
  return {
    questCode: snapshot.questId,
    name: snapshot.name,
    section: snapshot.section,
    sourceOrder: snapshot.sourceOrder,
    enabled: stored?.enabled ?? true,
    missing: false,
    missions,
  };
}

function buildMissingSelection(selection: TypedAutomationEntryResponse['quests'][number]): QuestSelectionDraft {
  return {
    questCode: selection.questCode,
    name: selection.questCode,
    section: null,
    sourceOrder: selection.sourceOrder,
    enabled: selection.enabled,
    missing: true,
    missions: [...groupMapsByMission(selection.maps)].map(([key, maps]) => ({
      key,
      type: 'MONSTER_KILL',
      target: null,
      progress: null,
      completable: false,
      maps,
    })),
  };
}

function groupMapsByMission(maps: readonly QuestMapSettingRequest[]): Map<string, QuestMapSettingRequest[]> {
  const grouped = new Map<string, QuestMapSettingRequest[]>();
  for (const map of maps) grouped.set(map.missionKey, [...(grouped.get(map.missionKey) ?? []), { ...map }]);
  for (const [key, values] of grouped) grouped.set(key, normalizeMapOrder(values));
  return grouped;
}

function emptyMapSetting(missionKey: string): QuestMapSettingRequest {
  return { missionKey, categoryId: '', mapCode: '', executionOrder: 0, manuallyOverridden: false, presetMode: 'PRIMARY', partyPresetId: null };
}

function manualMapSetting(missionKey: string, categoryId: string, mapCode: string): QuestMapSettingRequest {
  return {
    missionKey,
    categoryId,
    mapCode,
    executionOrder: 0,
    manuallyOverridden: true,
    presetMode: 'PRIMARY',
    partyPresetId: null,
  };
}

function normalizeMapOrder(maps: readonly QuestMapSettingRequest[]): QuestMapSettingRequest[] {
  return maps.map((map, executionOrder) => ({ ...map, executionOrder }));
}

function normalizeMissionMaps(
  type: CombatQuestMissionType,
  maps: readonly QuestMapSettingRequest[],
): QuestMapSettingRequest[] {
  const normalized = normalizeMapOrder(maps);
  return type === 'MAP_CLEAR' ? normalized.slice(0, 1) : normalized;
}

function coalesceMissions(missions: readonly QuestMission[]): QuestMission[] {
  const seen = new Set<string>();
  return missions.filter((mission) => {
    if (seen.has(mission.key)) return false;
    seen.add(mission.key);
    return true;
  });
}

function isValidPreset(map: QuestMapSettingRequest, validPresetIds: readonly number[]): boolean {
  if (map.presetMode === 'PRIMARY') return map.partyPresetId === null;
  return Number.isSafeInteger(map.partyPresetId) && map.partyPresetId > 0 && validPresetIds.includes(map.partyPresetId);
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s_\-·:()[\]{}]+/g, '');
}
