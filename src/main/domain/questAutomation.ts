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

export type QuestMissionDraft = QuestMission & {
  maps: QuestMapSettingRequest[];
};

export type QuestMapMode = 'AUTO' | 'MANUAL';
type QuestMapDraftFields<T> = T extends unknown ? Omit<T, 'missionKey' | 'manuallyOverridden'> : never;
export type QuestMapDraft = QuestMapDraftFields<QuestMapSettingRequest>;

export type QuestSelectionDraft = {
  questKey: string;
  displayCode: string;
  name: string;
  section: QuestSection | null;
  sourceOrder: number;
  enabled: boolean;
  missing: boolean;
  missions: QuestMissionDraft[];
  mapMode: QuestMapMode;
  maps: QuestMapDraft[];
  storedMaps: QuestMapSettingRequest[];
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

export function prioritizeSelectedQuests(
  quests: readonly QuestSnapshot[],
  selectedQuestKeys: ReadonlySet<string>,
): QuestSnapshot[] {
  return [...quests].sort((left, right) => {
    const selectedDifference = Number(selectedQuestKeys.has(right.questKey)) - Number(selectedQuestKeys.has(left.questKey));
    return selectedDifference || left.sourceOrder - right.sourceOrder;
  });
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

export function buildAutomaticQuestMaps(
  missions: readonly QuestMission[],
  catalog: readonly QuestMapCatalogItem[],
  previous: readonly QuestMapDraft[] = [],
): QuestMapDraft[] {
  const previousByIdentity = new Map(previous.map((map) => [buildQuestMapIdentity(map), map]));
  const unique = new Map<string, QuestMapCatalogItem>();
  for (const mission of missions) {
    const match = matchMapClearMission(mission, catalog);
    if (match?.mapCode != null) unique.set(buildQuestMapIdentity(match), match);
  }
  return normalizeQuestMapOrder([...unique.values()].map((match) => {
    const prior = previousByIdentity.get(buildQuestMapIdentity(match));
    return prior ? { ...prior } : {
      categoryId: match.categoryId,
      mapCode: match.mapCode!,
      executionOrder: 0,
      presetMode: 'PRIMARY' as const,
      partyPresetId: null,
    };
  }));
}

export function addUserQuestMap(
  selection: QuestSelectionDraft,
  selected: BattleMapResponse,
): QuestSelectionDraft {
  if (selected.mapCode == null) return selection;
  const current = selection.mapMode === 'MANUAL' ? selection.maps : [];
  if (current.some((map) => buildQuestMapIdentity(map) === buildQuestMapIdentity(selected))) return selection;
  return {
    ...selection,
    mapMode: 'MANUAL',
    maps: normalizeQuestMapOrder([...current, {
      categoryId: selected.categoryId,
      mapCode: selected.mapCode,
      executionOrder: current.length,
      presetMode: 'PRIMARY',
      partyPresetId: null,
    }]),
  };
}

export function removeQuestMap(
  selection: QuestSelectionDraft,
  index: number,
  catalog: readonly QuestMapCatalogItem[],
): QuestSelectionDraft {
  if (selection.mapMode !== 'MANUAL' || index < 0 || index >= selection.maps.length) return selection;
  const maps = normalizeQuestMapOrder(selection.maps.filter((_map, currentIndex) => currentIndex !== index));
  return maps.length > 0
    ? { ...selection, maps }
    : { ...selection, mapMode: 'AUTO', maps: buildAutomaticQuestMaps(selection.missions, catalog) };
}

export function updateQuestMaps(
  selection: QuestSelectionDraft,
  maps: readonly QuestMapDraft[],
): QuestSelectionDraft {
  return { ...selection, maps: normalizeQuestMapOrder(maps) };
}

export function refreshAutomaticQuestMaps(
  draft: QuestAutomationDraft,
  catalog: readonly QuestMapCatalogItem[],
): QuestAutomationDraft {
  let changed = false;
  const quests = draft.quests.map((quest) => {
    if (quest.missing || quest.mapMode === 'MANUAL') return quest;
    const maps = buildAutomaticQuestMaps(quest.missions, catalog, quest.maps);
    if (sameQuestMaps(quest.maps, maps)) return quest;
    changed = true;
    return { ...quest, maps };
  });
  return changed ? { ...draft, quests } : draft;
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
    mapMode: cached.mapMode,
    maps: cached.mapMode === 'MANUAL'
      ? normalizeQuestMapOrder(cached.maps)
      : buildAutomaticQuestMaps(fresh.missions, catalog, cached.maps),
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
  const byQuestKey = new Map(snapshots.map((snapshot) => [snapshot.questKey, snapshot]));
  return {
    enabled: entry.enabled,
    quests: entry.quests.map((selection) => {
      const snapshot = byQuestKey.get(selection.questKey);
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
  const existingIndex = draft.quests.findIndex(({ questKey }) => questKey === snapshot.questKey);
  if (!selected) {
    return { ...draft, quests: draft.quests.filter(({ questKey }) => questKey !== snapshot.questKey) };
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
  isBlocked: (questKey: string, missionKey: string) => boolean = () => false,
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
      if (isBlocked(quest.questKey, mission.key) || normalizedMaps.some(({ manuallyOverridden }) => manuallyOverridden)) {
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

export function reorderMissionMaps(
  maps: readonly QuestMapSettingRequest[],
): QuestMapSettingRequest[] {
  return normalizeMapOrder(maps);
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
  const questKeys = new Set<string>();
  for (const quest of draft.quests) {
    if (questKeys.has(quest.questKey)) errors.push(`${quest.name}: 중복 선택된 퀘스트입니다.`);
    questKeys.add(quest.questKey);
    if (quest.missing) continue;
    const combatMissions = quest.missions.filter(isCombatMission);
    if (combatMissions.length > 0 && quest.maps.length === 0) errors.push(`${quest.name}: 맵 설정 필요`);
    const identities = new Set<string>();
    for (const map of quest.maps) {
      if (!map.categoryId.trim() || !map.mapCode.trim()) errors.push(`${quest.name}: 맵 설정 필요`);
      const identity = buildQuestMapIdentity(map);
      if (identities.has(identity)) errors.push(`${quest.name}: 중복된 맵입니다.`);
      identities.add(identity);
      if (!isValidPreset(map, validPresetIds)) errors.push(`${quest.name}: 프리셋 설정 필요`);
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
      questKey: quest.questKey,
      displayCode: quest.displayCode,
      questName: quest.name,
      enabled: quest.enabled,
      sourceOrder,
      maps: quest.missing
        ? quest.storedMaps.map((map) => ({ ...map }))
        : quest.missions.filter(isCombatMission).flatMap((mission) => quest.maps.map((map) => ({
          ...map,
          missionKey: mission.key,
          manuallyOverridden: quest.mapMode === 'MANUAL',
        }))),
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
  const collapsed = collapseQuestMaps(missions.flatMap(({ maps }) => maps));
  const questMaps = collapsed.mode === 'MANUAL'
    ? collapsed
    : { mode: 'AUTO' as const, maps: buildAutomaticQuestMaps(missions, catalog, collapsed.maps) };
  return {
    questKey: snapshot.questKey,
    displayCode: snapshot.displayCode,
    name: snapshot.name,
    section: snapshot.section,
    sourceOrder: snapshot.sourceOrder,
    enabled: stored?.enabled ?? true,
    missing: false,
    missions,
    mapMode: questMaps.mode,
    maps: questMaps.maps,
    storedMaps: [],
  };
}

function buildMissingSelection(selection: TypedAutomationEntryResponse['quests'][number]): QuestSelectionDraft {
  const questMaps = collapseQuestMaps(selection.maps);
  return {
    questKey: selection.questKey,
    displayCode: selection.displayCode,
    name: selection.questName,
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
    mapMode: questMaps.mode,
    maps: questMaps.maps,
    storedMaps: selection.maps.map((map) => ({ ...map })),
  };
}

function collapseQuestMaps(maps: readonly QuestMapSettingRequest[]): { mode: QuestMapMode; maps: QuestMapDraft[] } {
  const manual = maps.filter(({ manuallyOverridden }) => manuallyOverridden);
  const source = manual.length > 0 ? manual : maps.filter(({ categoryId, mapCode }) => categoryId.trim() && mapCode.trim());
  const seen = new Set<string>();
  const collapsed: QuestMapDraft[] = [];
  for (const map of [...source].sort((left, right) => left.executionOrder - right.executionOrder)) {
    const identity = buildQuestMapIdentity(map);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const { missionKey: _missionKey, manuallyOverridden: _manuallyOverridden, ...draft } = map;
    collapsed.push({ ...draft, executionOrder: collapsed.length });
  }
  return { mode: manual.length > 0 ? 'MANUAL' : 'AUTO', maps: collapsed };
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

function normalizeQuestMapOrder(maps: readonly QuestMapDraft[]): QuestMapDraft[] {
  return maps.map((map, executionOrder) => ({ ...map, executionOrder }));
}

function sameQuestMaps(left: readonly QuestMapDraft[], right: readonly QuestMapDraft[]): boolean {
  return left.length === right.length && left.every((map, index) => JSON.stringify(map) === JSON.stringify(right[index]));
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

function isValidPreset(map: QuestMapDraft | QuestMapSettingRequest, validPresetIds: readonly number[]): boolean {
  if (map.presetMode === 'PRIMARY') return map.partyPresetId === null;
  return Number.isSafeInteger(map.partyPresetId) && map.partyPresetId > 0 && validPresetIds.includes(map.partyPresetId);
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s_\-·:()[\]{}]+/g, '');
}
