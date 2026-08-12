import type {
  AdventureMapSettingRequest,
  AutomationType,
  BattleMapSettingRequest,
  PresetSelection,
  QuestSelectionRequest,
  TypedAutomationEntryResponse,
  UpdateAdventureMapAutomationRequest,
  UpdateBattleMapAutomationRequest,
  UpdateQuestAutomationRequest,
  UpdateFishingAutomationRequest,
  FishingMapSettingRequest,
  UpdateRaidAutomationRequest,
  UpdateUnionAutomationRequest,
  UnionMapSettingRequest,
  RaidTargetSettingRequest,
} from '../types/api';

export const AUTOMATION_TYPE_ORDER: readonly AutomationType[] = [
  'QUEST',
  'BATTLE_MAP',
  'ADVENTURE_MAP',
  'RAID',
  'UNION',
  'FISHING',
];

export const AUTOMATION_TYPE_METADATA: Readonly<Record<AutomationType, {
  label: string;
  icon: 'scroll-text' | 'swords' | 'map' | 'raid' | 'union' | 'fishing';
}>> = {
  QUEST: { label: '퀘스트', icon: 'scroll-text' },
  BATTLE_MAP: { label: '전투 맵', icon: 'swords' },
  ADVENTURE_MAP: { label: '모험 맵', icon: 'map' },
  RAID: { label: '레이드', icon: 'raid' },
  UNION: { label: '유니온', icon: 'union' },
  FISHING: { label: '낚시', icon: 'fishing' },
};

export function getAddableAutomationTypes(
  entries: readonly Pick<TypedAutomationEntryResponse, 'type'>[],
): AutomationType[] {
  const existing = new Set(entries.map(({ type }) => type));
  return AUTOMATION_TYPE_ORDER.filter((type) => !existing.has(type));
}

export function hasAllAutomationTypes(
  entries: readonly Pick<TypedAutomationEntryResponse, 'type'>[],
): boolean {
  return getAddableAutomationTypes(entries).length === 0;
}

export function canAddAutomationType(
  entries: readonly Pick<TypedAutomationEntryResponse, 'type'>[],
  type: AutomationType,
): boolean {
  return !entries.some((entry) => entry.type === type);
}

export function reorderEntries(
  entries: readonly TypedAutomationEntryResponse[],
  from: number,
  to: number,
): TypedAutomationEntryResponse[] {
  if (!Number.isInteger(from) || !Number.isInteger(to)
    || from < 0 || to < 0 || from >= entries.length || to >= entries.length) {
    throw new RangeError('Automation entry reorder index is outside the list.');
  }
  const next = [...entries];
  const [moved] = next.splice(from, 1);
  if (!moved) throw new RangeError('Automation entry does not exist.');
  next.splice(to, 0, moved);
  return next.map((entry, priority) => ({ ...entry, priority }));
}

export function buildPrimaryPresetSelection(): PresetSelection {
  return { presetMode: 'PRIMARY', partyPresetId: null };
}

export function buildExplicitPresetSelection(partyPresetId: number): PresetSelection {
  if (!Number.isSafeInteger(partyPresetId) || partyPresetId <= 0) {
    throw new RangeError('Explicit party preset id must be a positive integer.');
  }
  return { presetMode: 'EXPLICIT', partyPresetId };
}

export function buildQuestAutomationRequest(
  enabled: boolean,
  quests: readonly QuestSelectionRequest[],
): UpdateQuestAutomationRequest {
  return {
    enabled,
    quests: quests.map((quest, sourceOrder) => ({
      ...quest,
      sourceOrder,
      maps: normalizeOrder(quest.maps),
    })),
  };
}

export function buildBattleMapAutomationRequest(
  enabled: boolean,
  maps: readonly BattleMapSettingRequest[],
): UpdateBattleMapAutomationRequest {
  return { enabled, maps: normalizeOrder(maps) };
}

export function buildAdventureMapAutomationRequest(
  enabled: boolean,
  maps: readonly AdventureMapSettingRequest[],
): UpdateAdventureMapAutomationRequest {
  return { enabled, maps: normalizeOrder(maps) };
}

export function buildFishingAutomationRequest(enabled: boolean, maps: readonly FishingMapSettingRequest[]): UpdateFishingAutomationRequest {
  return { enabled, maps: normalizeOrder(maps) };
}
export function buildUnionAutomationRequest(enabled: boolean, maps: readonly UnionMapSettingRequest[]): UpdateUnionAutomationRequest {
  return { enabled, maps: normalizeOrder(maps) };
}
export function buildRaidAutomationRequest(enabled: boolean, targets: readonly RaidTargetSettingRequest[]): UpdateRaidAutomationRequest {
  return { enabled, targets: normalizeOrder(targets) };
}

function normalizeOrder<T extends { executionOrder: number }>(items: readonly T[]): T[] {
  return items.map((item, executionOrder) => ({ ...item, executionOrder }));
}
