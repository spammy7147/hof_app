import type {
  AutomationProfileMap,
  BattleCategoryResponse,
  BattleMapResponse,
  CreateAutomationProfileRequest,
} from '../types/api';

/**
 * 새 자동전투 카드를 만들 때 사용하는 기본 요청값을 만든다.
 *
 * @remarks
 * 서버가 구조화된 맵 행을 직접 받으므로, 사용자가 맵을 고르기 전에는 빈 배열로 시작한다.
 */
export function buildCreateAutomationProfileRequest(): CreateAutomationProfileRequest {
  return {
    name: '새 자동전투',
    mode: 'TIME_BURN',
    maps: [],
  };
}

/**
 * 자동전투 카드 편집 화면에서 특정 맵을 선택하거나 해제한다.
 *
 * @remarks
 * 원본 페이지에서 코드를 확인하지 못한 행은 프로필 FK로 저장할 수 없으므로 변경 없이 거절한다.
 * 정상 맵을 추가하거나 제거한 뒤에는 서버의 고유 순서 검증을 통과하도록 실행 순서를 0부터 다시 매긴다.
 */
export function toggleAutomationProfileMap(
  maps: AutomationProfileMap[],
  map: Pick<BattleMapResponse, 'categoryId' | 'mapCode' | 'resolved'>,
): AutomationProfileMap[] {
  if (map.mapCode == null || !map.resolved) return maps;

  const exists = maps.some(
    (current) => current.categoryId === map.categoryId && current.mapCode === map.mapCode,
  );
  const nextMaps = exists
    ? maps.filter(
      (current) => !(current.categoryId === map.categoryId && current.mapCode === map.mapCode),
    )
    : [
      ...maps,
      {
        categoryId: map.categoryId,
        mapCode: map.mapCode,
        partyPresetId: null,
        executionOrder: maps.length,
      },
    ];

  return reindexAutomationProfileMaps(nextMaps);
}

/**
 * 선택된 자동전투 맵에 사용할 캐릭터 프리셋 ID를 지정하거나 해제한다.
 *
 * @remarks
 * 프리셋 변경은 맵 배열의 상대 순서를 보존하며, 과거 응답의 순서 값이 비연속적이어도 저장 전에 다시 정규화한다.
 */
export function setAutomationProfileMapPreset(
  maps: AutomationProfileMap[],
  map: Pick<AutomationProfileMap, 'categoryId' | 'mapCode'>,
  partyPresetId: number | null,
): AutomationProfileMap[] {
  return reindexAutomationProfileMaps(maps.map((current) => {
    if (current.categoryId !== map.categoryId || current.mapCode !== map.mapCode) {
      return current;
    }

    return {
      ...current,
      partyPresetId: normalizePartyPresetId(partyPresetId),
    };
  }));
}

/**
 * 자동전투 카드 목록에 표시할 짧은 설정 요약 문구를 만든다.
 */
export function formatAutomationProfileSummary(maps: AutomationProfileMap[]): string {
  const mapCount = maps.length;
  if (mapCount === 0) return '맵 설정 필요';
  const presetCount = maps.filter((map) => map.partyPresetId != null).length;
  return `맵 ${mapCount.toLocaleString('en-US')}개 · 프리셋 ${presetCount.toLocaleString('en-US')}/${mapCount.toLocaleString('en-US')}`;
}

/**
 * 현재 카테고리에서 프로필에 저장된 맵을 편집용 전투 맵 row로 복원한다.
 *
 * @remarks
 * 동적 HOF 응답에서 일시적으로 빠진 맵도 사용자가 삭제하거나 프리셋을 바꿀 수 있어야 한다.
 * 카탈로그에 같은 코드가 있으면 최신 상태를 사용하고, 없으면 저장된 코드만 가진 비활성 fallback을 만든다.
 */
export function buildAutomationProfileSelectedMaps(
  profileMaps: AutomationProfileMap[],
  catalogMaps: BattleMapResponse[],
  categoryId: string,
): BattleMapResponse[] {
  return profileMaps
    .filter((profileMap) => profileMap.categoryId === categoryId)
    .sort((left, right) => left.executionOrder - right.executionOrder)
    .map((profileMap) => (
      catalogMaps.find((catalogMap) => (
        catalogMap.categoryId === profileMap.categoryId &&
        catalogMap.mapCode === profileMap.mapCode &&
        catalogMap.resolved
      )) ?? buildStoredAutomationMapFallback(profileMap)
    ));
}

/**
 * 자동전투 설정 화면에서 맵 목록을 검색어로 필터링한다.
 *
 * @remarks
 * 사용자는 맵 이름뿐 아니라 그룹명, 추천 레벨, 확인된 내부 맵 코드로도 찾을 수 있다.
 */
export function filterAutomationProfileMaps(
  maps: BattleMapResponse[],
  query: string,
): BattleMapResponse[] {
  const normalizedQuery = normalizeMapSearchText(query);
  if (!normalizedQuery) return maps;

  return maps.filter((map) => buildMapSearchText(map).includes(normalizedQuery));
}

/**
 * 자동전투에서 사용할 수 있는 맵 카테고리만 남긴다.
 *
 * @remarks
 * 유니온은 자동전투 대상이 아니므로 홈 자동전투 설정에서는 숨긴다.
 */
export function filterAutomationProfileCategories(
  categories: BattleCategoryResponse[],
): BattleCategoryResponse[] {
  return categories.filter((category) => !isUnionCategory(category));
}

/**
 * 순서가 비어 있거나 중복된 입력도 서버가 받는 연속 실행 순서로 변환한다.
 */
function reindexAutomationProfileMaps(maps: AutomationProfileMap[]): AutomationProfileMap[] {
  return maps.map((map, executionOrder) => ({
    categoryId: map.categoryId,
    mapCode: map.mapCode,
    partyPresetId: normalizePartyPresetId(map.partyPresetId),
    executionOrder,
  }));
}

/**
 * 라이브 카탈로그에 없는 저장 맵을 선택 영역에서 편집할 수 있는 최소 표시 모델로 변환한다.
 */
function buildStoredAutomationMapFallback(profileMap: AutomationProfileMap): BattleMapResponse {
  return {
    categoryId: profileMap.categoryId,
    mapCode: profileMap.mapCode,
    name: profileMap.mapCode,
    groupName: '저장된 맵',
    groupOrder: Number.MAX_SAFE_INTEGER,
    mapOrder: profileMap.executionOrder,
    recommendedLevel: null,
    availableCount: null,
    attemptCount: null,
    winCount: null,
    cooldownRemainingText: null,
    cooldownRemainingSeconds: null,
    keyCount: null,
    requiredTime: null,
    supportsThreeBattles: false,
    enabled: false,
    resolved: true,
    iconUrl: null,
    rawHref: '',
  };
}

/**
 * HOF 전투 카테고리가 유니온 계열인지 판단한다.
 */
function isUnionCategory(category: BattleCategoryResponse): boolean {
  return category.id.toLocaleLowerCase().includes('union') || category.label.includes('유니온');
}

/**
 * nullable 맵 코드를 제외하고 검색에 사용할 비교 문자열을 만든다.
 */
function buildMapSearchText(map: BattleMapResponse): string {
  return normalizeMapSearchText([
    map.name,
    map.groupName,
    map.recommendedLevel,
    map.mapCode,
  ].filter(Boolean).join(' '));
}

/**
 * 맵 검색 비교가 대소문자와 공백 차이에 흔들리지 않도록 정규화한다.
 */
function normalizeMapSearchText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * 유한한 숫자 ID만 보존해 잘못된 프리셋 참조가 요청에 섞이지 않게 한다.
 */
function normalizePartyPresetId(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
