import type {
  BattleCategoryResponse,
  BattleMapResponse,
  TypedAutomationEntryResponse,
  UpdateBattleMapAutomationRequest,
} from '../types/api';

export const MAX_BATTLE_DAILY_TARGET = 2_147_483_647;

export type BattleMapServerProgress = {
  successfulRuns: number;
};

export type BattleMapSettingDraft = {
  categoryId: string;
  mapCode: string;
  dailyTargetCount: number | string;
  executionOrder: number;
  displayName: string;
  groupName: string | null;
  recommendedLevel: string | null;
  source: 'STORED' | 'CATALOG';
  resolved: boolean;
  supportsThreeBattles: boolean | null;
  presetMode: 'PRIMARY' | 'EXPLICIT';
  partyPresetId: number | null;
};

export type BattleMapAutomationDraft = {
  enabled: boolean;
  maps: BattleMapSettingDraft[];
  dailyProgress: Record<string, BattleMapServerProgress>;
};

export type BattleProgress = { remaining: number; percent: number; complete: boolean };

export function buildBattleProgress({ target, successes }: { target: number; successes: number }): BattleProgress {
  const safeTarget = Number.isFinite(target) && target > 0 ? target : 1;
  const safeSuccesses = Number.isFinite(successes) ? Math.max(0, successes) : 0;
  return {
    remaining: Math.max(0, safeTarget - safeSuccesses),
    percent: Math.min(100, Math.max(0, (safeSuccesses / safeTarget) * 100)),
    complete: safeSuccesses >= safeTarget,
  };
}

export function describeBattleBatch({
  supportsThreeBattles,
  remaining,
}: { supportsThreeBattles: boolean | null; remaining: number }): string {
  if (remaining <= 0) return '오늘 목표 완료';
  return supportsThreeBattles === true && remaining >= 2 ? '다음 3회 전투' : '다음 1회 전투';
}

export function buildBattleMapAutomationDraft(
  entry: Pick<TypedAutomationEntryResponse, 'enabled' | 'battleMaps' | 'battleMapProgress'>,
  catalog: readonly BattleMapResponse[],
): BattleMapAutomationDraft {
  const dailyProgress = Object.fromEntries((entry.battleMapProgress ?? []).map((progress) => [
    battleMapIdentity(progress),
    { successfulRuns: Math.max(0, progress.successfulRuns) },
  ]));
  const maps = [...entry.battleMaps]
    .sort((left, right) => left.executionOrder - right.executionOrder)
    .map<BattleMapSettingDraft>((setting) => {
      const catalogMap = catalog.find((candidate) => candidate.resolved && candidate.mapCode != null
        && battleMapIdentity(candidate as { categoryId: string; mapCode: string }) === battleMapIdentity(setting));
      return {
        ...setting,
        displayName: catalogMap?.name || setting.mapCode,
        groupName: catalogMap?.groupName ?? null,
        recommendedLevel: catalogMap?.recommendedLevel ?? null,
        source: 'STORED',
        resolved: catalogMap != null,
        supportsThreeBattles: catalogMap?.supportsThreeBattles ?? null,
      };
    });
  return { enabled: entry.enabled, maps, dailyProgress };
}

export function filterBattleMapCatalog(
  catalog: readonly BattleMapResponse[],
  query: string,
): BattleMapResponse[] {
  const needle = normalizeSearch(query);
  return catalog
    .map((map, sourceIndex) => ({ map, sourceIndex }))
    .filter(({ map }) => map.resolved && map.mapCode != null)
    .filter(({ map }) => !needle || normalizeSearch([
      map.name, map.groupName ?? '', map.recommendedLevel ?? '',
    ].join(' ')).includes(needle))
    .sort((left, right) => left.map.groupOrder - right.map.groupOrder
      || left.map.mapOrder - right.map.mapOrder
      || left.sourceIndex - right.sourceIndex)
    .map(({ map }) => map);
}

/** 전투맵 typed API가 거절하는 두 카테고리만 새 선택 후보에서 제외한다. */
export function filterBattleAutomationCategories(
  categories: readonly BattleCategoryResponse[],
): BattleCategoryResponse[] {
  return categories.filter(({ id }) => id !== 'adventure_map' && id !== 'union');
}

export function selectBattleMap(
  draft: BattleMapAutomationDraft,
  map: BattleMapResponse,
  selected: boolean,
): BattleMapAutomationDraft {
  if (!map.resolved || map.mapCode == null) return draft;
  const identity = battleMapIdentity({ categoryId: map.categoryId, mapCode: map.mapCode });
  const exists = draft.maps.some((setting) => battleMapIdentity(setting) === identity);
  if (selected && exists) return draft;
  const maps = selected
    ? [...draft.maps, {
      categoryId: map.categoryId,
      mapCode: map.mapCode,
      dailyTargetCount: 1,
      presetMode: 'PRIMARY' as const,
      partyPresetId: null,
      executionOrder: draft.maps.length,
      displayName: map.name,
      groupName: map.groupName,
      recommendedLevel: map.recommendedLevel,
      source: 'CATALOG' as const,
      resolved: true,
      supportsThreeBattles: map.supportsThreeBattles ?? null,
    }]
    : draft.maps.filter((setting) => battleMapIdentity(setting) !== identity);
  return { ...draft, maps: normalizeExecutionOrder(maps) };
}

export function moveBattleMapSetting(
  draft: BattleMapAutomationDraft,
  from: number,
  to: number,
): BattleMapAutomationDraft {
  if (from < 0 || to < 0 || from >= draft.maps.length || to >= draft.maps.length || from === to) {
    return { ...draft, maps: normalizeExecutionOrder(draft.maps) };
  }
  const maps = [...draft.maps];
  const [moved] = maps.splice(from, 1);
  maps.splice(to, 0, moved!);
  return { ...draft, maps: normalizeExecutionOrder(maps) };
}

export function removeBattleMapSetting(draft: BattleMapAutomationDraft, index: number): BattleMapAutomationDraft {
  return { ...draft, maps: normalizeExecutionOrder(draft.maps.filter((_map, current) => current !== index)) };
}

export function validateBattleMapAutomationDraft(
  draft: BattleMapAutomationDraft,
  validPresetIds: readonly number[],
): string[] {
  const errors: string[] = [];
  const identities = new Set<string>();
  const orders = new Set<number>();
  for (const map of draft.maps) {
    const dailyTargetCount = parseBattleDailyTarget(map.dailyTargetCount);
    if (dailyTargetCount == null) {
      errors.push('일일 목표는 정수로 입력해 주세요.');
    } else if (dailyTargetCount <= 0) {
      errors.push('일일 목표는 1회 이상이어야 합니다.');
    } else if (dailyTargetCount > MAX_BATTLE_DAILY_TARGET) {
      errors.push('일일 목표는 2,147,483,647회 이하여야 합니다.');
    }
    const identity = battleMapIdentity(map);
    if (identities.has(identity)) errors.push('같은 전투 맵을 두 번 선택할 수 없습니다.');
    identities.add(identity);
    if (map.presetMode === 'PRIMARY' && map.partyPresetId != null) {
      errors.push('대표 프리셋 사용 시 개별 프리셋을 함께 지정할 수 없습니다.');
    }
    if (map.presetMode === 'EXPLICIT'
      && (typeof map.partyPresetId !== 'number' || !Number.isSafeInteger(map.partyPresetId) || !validPresetIds.includes(map.partyPresetId))) {
      errors.push('선택한 프리셋을 찾을 수 없습니다. 다른 프리셋을 선택해 주세요.');
    }
    if (map.source === 'CATALOG' && (!map.resolved || !map.categoryId.trim() || !map.mapCode.trim())) {
      errors.push('확인되지 않은 맵은 새로 선택할 수 없습니다.');
    }
    orders.add(map.executionOrder);
  }
  if (orders.size !== draft.maps.length || draft.maps.some((map, index) => map.executionOrder !== index)) {
    errors.push('맵 실행 순서는 0부터 빠짐없이 한 번씩 지정해야 합니다.');
  }
  return [...new Set(errors)];
}

export function buildBattleMapAutomationRequest(
  draft: BattleMapAutomationDraft,
  validPresetIds: readonly number[],
): UpdateBattleMapAutomationRequest {
  const errors = validateBattleMapAutomationDraft(draft, validPresetIds);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return {
    enabled: draft.enabled,
    maps: draft.maps.map(({ categoryId, mapCode, dailyTargetCount, presetMode, partyPresetId, executionOrder }) => (
      presetMode === 'PRIMARY'
        ? { categoryId, mapCode, dailyTargetCount: parseBattleDailyTarget(dailyTargetCount)!, presetMode, partyPresetId: null, executionOrder }
        : { categoryId, mapCode, dailyTargetCount: parseBattleDailyTarget(dailyTargetCount)!, presetMode, partyPresetId: partyPresetId!, executionOrder }
    )),
  };
}

export function battleMapIdentity(map: { categoryId: string; mapCode: string }): string {
  return `${map.categoryId}\u0000${map.mapCode}`;
}

function normalizeExecutionOrder(maps: readonly BattleMapSettingDraft[]): BattleMapSettingDraft[] {
  return maps.map((map, executionOrder) => ({ ...map, executionOrder }));
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ');
}

export function parseBattleDailyTarget(value: number | string): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  const normalized = value.trim();
  if (normalized === '') return 0;
  if (!/^[0-9]+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
