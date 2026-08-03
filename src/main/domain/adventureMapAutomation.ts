import type {
  AdventureDailyRefreshResponse,
  AdventureMapSettingRequest,
  BattleCategoryResponse,
  BattleMapResponse,
  TypedAutomationEntryResponse,
  UpdateAdventureMapAutomationRequest,
} from '../types/api';
import {
  formatAutomationPresetSelection as formatPresetSelection,
} from './partyPresets';
import { findBundledAdventureMapName } from './adventureMapNames';

export type AdventureMapDraftSetting = {
  categoryId: string;
  mapCode: string;
  presetMode: 'PRIMARY' | 'EXPLICIT';
  partyPresetId: number | null;
  executionOrder: number;
  displayName: string;
  groupName: string | null;
  recommendedLevel: string | null;
  resolved: boolean;
  observed: BattleMapResponse | null;
};

export type AdventureMapAutomationDraft = {
  enabled: boolean;
  maps: AdventureMapDraftSetting[];
};

export type AdventureMapStateDescription = {
  kind: 'COOLDOWN' | 'DAILY_COMPLETE' | 'MISSING_KEY' | 'RUNNABLE' | 'UNLIMITED' | 'UNAVAILABLE';
  label: string;
  detail: string | null;
};

export type AdventureMapConstraintDescription = {
  key: 'STATE' | 'UNLIMITED' | 'COOLDOWN' | 'KEY' | 'AVAILABLE' | 'ATTEMPT' | 'WIN';
  label: string;
};

export function adventureMapIdentity(value: { categoryId: string; mapCode: string }): string {
  return `${value.categoryId}\u0000${value.mapCode}`;
}

export function filterAdventureAutomationCategories(
  categories: readonly BattleCategoryResponse[],
): BattleCategoryResponse[] {
  return categories.filter(({ id }) => id === 'adventure_map');
}

export function buildAdventureMapAutomationDraft(
  entry: TypedAutomationEntryResponse,
  catalog: readonly BattleMapResponse[],
): AdventureMapAutomationDraft {
  const catalogByIdentity = new Map(
    catalog
      .filter((map): map is BattleMapResponse & { mapCode: string } => map.resolved && map.mapCode != null)
      .map((map) => [adventureMapIdentity(map), map]),
  );
  return {
    enabled: entry.enabled,
    maps: entry.adventureMaps
      .slice()
      .sort((left, right) => left.executionOrder - right.executionOrder)
      .map((setting, executionOrder) => {
        const observed = catalogByIdentity.get(adventureMapIdentity(setting)) ?? null;
        return {
          ...setting,
          executionOrder,
          displayName: observed?.name
            || setting.displayName?.trim()
            || findBundledAdventureMapName(setting.mapCode)
            || '모험맵 이름 확인 불가',
          groupName: observed?.groupName ?? null,
          recommendedLevel: observed?.recommendedLevel ?? null,
          resolved: observed != null,
          observed,
        };
      }),
  };
}

export function filterAdventureMapCatalog(
  catalog: readonly BattleMapResponse[],
  query: string,
): BattleMapResponse[] {
  const normalized = normalizeSearch(query);
  return catalog
    .filter((map): map is BattleMapResponse & { mapCode: string } => (
      map.categoryId === 'adventure_map' && map.resolved && map.mapCode != null
    ))
    .filter((map) => {
      if (!normalized) return true;
      return [map.name, map.groupName, map.recommendedLevel]
        .some((value) => value != null && normalizeSearch(value).includes(normalized));
    })
    .sort((left, right) => (
      left.groupOrder - right.groupOrder
      || left.mapOrder - right.mapOrder
      || left.name.localeCompare(right.name, 'ko-KR')
    ));
}

export function selectAdventureMap(
  draft: AdventureMapAutomationDraft,
  map: BattleMapResponse,
  selected: boolean,
): AdventureMapAutomationDraft {
  if (map.categoryId !== 'adventure_map' || !map.resolved || map.mapCode == null) return draft;
  const identity = adventureMapIdentity({ categoryId: map.categoryId, mapCode: map.mapCode });
  if (!selected) {
    return { ...draft, maps: reindex(draft.maps.filter((setting) => adventureMapIdentity(setting) !== identity)) };
  }
  if (draft.maps.some((setting) => adventureMapIdentity(setting) === identity)) return draft;
  return {
    ...draft,
    maps: [...draft.maps, {
      categoryId: map.categoryId,
      mapCode: map.mapCode,
      presetMode: 'PRIMARY',
      partyPresetId: null,
      executionOrder: draft.maps.length,
      displayName: map.name,
      groupName: map.groupName,
      recommendedLevel: map.recommendedLevel,
      resolved: true,
      observed: map,
    }],
  };
}

export function removeAdventureMapSetting(
  draft: AdventureMapAutomationDraft,
  index: number,
): AdventureMapAutomationDraft {
  if (index < 0 || index >= draft.maps.length) return draft;
  return { ...draft, maps: reindex(draft.maps.filter((_, candidate) => candidate !== index)) };
}

export function moveAdventureMapSetting(
  draft: AdventureMapAutomationDraft,
  from: number,
  to: number,
): AdventureMapAutomationDraft {
  if (from < 0 || from >= draft.maps.length || to < 0 || to >= draft.maps.length || from === to) return draft;
  const maps = [...draft.maps];
  const [moved] = maps.splice(from, 1);
  if (!moved) return draft;
  maps.splice(to, 0, moved);
  return { ...draft, maps: reindex(maps) };
}

export function validateAdventureMapAutomationDraft(
  draft: AdventureMapAutomationDraft,
  validPresetIds: readonly number[],
  options: { validatePresetMembership?: boolean } = {},
): string[] {
  const errors = new Set<string>();
  const identities = draft.maps.map(adventureMapIdentity);
  if (identities.length !== new Set(identities).size) errors.add('같은 모험맵을 두 번 선택할 수 없습니다.');
  if (draft.maps.some(({ executionOrder }, index) => executionOrder !== index)) {
    errors.add('맵 실행 순서는 0부터 빠짐없이 한 번씩 지정해야 합니다.');
  }
  for (const map of draft.maps) {
    if (map.categoryId !== 'adventure_map' || !map.mapCode.trim()) errors.add('모험맵 설정을 확인해 주세요.');
    if (map.presetMode === 'PRIMARY' && map.partyPresetId != null) {
      errors.add('대표 프리셋 사용 시 개별 프리셋을 함께 지정할 수 없습니다.');
    }
    if (map.presetMode === 'EXPLICIT') {
      if (map.partyPresetId == null || map.partyPresetId <= 0) {
        errors.add('개별 프리셋을 선택해 주세요.');
      } else if (options.validatePresetMembership !== false && !validPresetIds.includes(map.partyPresetId)) {
        errors.add('선택한 프리셋을 찾을 수 없습니다. 다른 프리셋을 선택해 주세요.');
      }
    }
  }
  return [...errors];
}

export function buildAdventureMapAutomationRequest(
  draft: AdventureMapAutomationDraft,
  validPresetIds: readonly number[],
): UpdateAdventureMapAutomationRequest {
  const errors = validateAdventureMapAutomationDraft(draft, validPresetIds);
  if (errors.length > 0) throw new Error(errors[0]);
  return {
    enabled: draft.enabled,
    maps: draft.maps.map((map, executionOrder) => ({
      categoryId: map.categoryId,
      mapCode: map.mapCode,
      presetMode: map.presetMode,
      partyPresetId: map.presetMode === 'PRIMARY' ? null : map.partyPresetId,
      executionOrder,
    } as AdventureMapSettingRequest)),
  };
}

export function describeAdventureMapState(map: BattleMapResponse): AdventureMapStateDescription {
  if ((map.cooldownRemainingSeconds ?? 0) > 0) {
    return {
      kind: 'COOLDOWN',
      label: `쿨다운 ${map.cooldownRemainingText ?? formatDuration(map.cooldownRemainingSeconds ?? 0)}`,
      detail: '쿨다운이 끝난 뒤 자동으로 다시 확인합니다.',
    };
  }
  if ([map.availableCount, map.attemptCount, map.winCount].some((value) => value != null && value <= 0)) {
    return { kind: 'DAILY_COMPLETE', label: '오늘 횟수 완료', detail: '다음 한국 날짜 초기화 전까지 건너뜁니다.' };
  }
  if (map.keyMode === 'LIMITED' && (map.keyCount == null || map.keyCount <= 0)) {
    return { kind: 'MISSING_KEY', label: '열쇠 부족', detail: '열쇠를 확보할 때까지 건너뜁니다.' };
  }
  if (!map.resolved || !map.enabled) {
    return { kind: 'UNAVAILABLE', label: '현재 실행 불가', detail: '상태가 바뀌면 자동으로 다시 확인합니다.' };
  }
  const limits = [
    map.availableCount,
    map.attemptCount,
    map.winCount,
    map.keyMode === 'LIMITED' ? map.keyCount : null,
  ];
  if (limits.every((value) => value == null)) {
    return { kind: 'UNLIMITED', label: '횟수 제한 없음 · 반복 실행', detail: null };
  }
  return { kind: 'RUNNABLE', label: '실행 가능', detail: null };
}

export function describeAdventureMapConstraints(
  map: BattleMapResponse | null,
): AdventureMapConstraintDescription[] {
  if (map == null) {
    return [{ key: 'STATE', label: '상태 미확인' }];
  }
  const constraints: AdventureMapConstraintDescription[] = [];
  const cooldownText = map.cooldownRemainingText?.trim();
  if ((map.cooldownRemainingSeconds ?? 0) > 0 || cooldownText) {
    constraints.push({
      key: 'COOLDOWN',
      label: `쿨다운 ${cooldownText || formatDuration(map.cooldownRemainingSeconds ?? 0)}`,
    });
  }
  if (map.keyMode === 'UNLIMITED') {
    constraints.push({ key: 'KEY', label: '영구 키' });
  } else if (map.keyMode === 'LIMITED') {
    constraints.push({
      key: 'KEY',
      label: map.keyCount == null ? '키 상태 미확인' : `키 ${map.keyCount.toLocaleString('ko-KR')}개`,
    });
  } else if (map.keyMode === 'UNKNOWN') {
    constraints.push({ key: 'KEY', label: '키 상태 미확인' });
  }
  if (map.availableCount != null) {
    constraints.push({ key: 'AVAILABLE', label: `가능 ${map.availableCount.toLocaleString('ko-KR')}회` });
  }
  if (map.attemptCount != null) {
    constraints.push({ key: 'ATTEMPT', label: `도전 ${map.attemptCount.toLocaleString('ko-KR')}회` });
  }
  if (map.winCount != null) {
    constraints.push({ key: 'WIN', label: `승리 ${map.winCount.toLocaleString('ko-KR')}회` });
  }
  return constraints.length > 0 ? constraints : [{ key: 'UNLIMITED', label: '제한 없음' }];
}

export function formatAutomationPresetSelection(
  selection: { presetMode: 'PRIMARY' | 'EXPLICIT'; partyPresetId: number | null },
  presets: Parameters<typeof formatPresetSelection>[1],
): string {
  return formatPresetSelection(selection, presets);
}

export function formatAdventureDailyRefresh(refresh?: AdventureDailyRefreshResponse | null): string {
  if (refresh?.status !== 'COMPLETE' || refresh.refreshedAt == null) return '오늘 초기화 대기';
  const date = new Date(refresh.refreshedAt);
  if (Number.isNaN(date.getTime())) return `오늘 초기화 완료 · ${refresh.refreshedAt}`;
  const formattedTime = date.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(/\bAM\b/, '오전').replace(/\bPM\b/, '오후');
  return `오늘 초기화 완료 · ${formattedTime}`;
}

function reindex(maps: AdventureMapDraftSetting[]): AdventureMapDraftSetting[] {
  return maps.map((map, executionOrder) => ({ ...map, executionOrder }));
}
function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase('ko-KR');
}
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes}분` : `${Math.ceil(minutes / 60)}시간`;
}
