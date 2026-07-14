import type {
  BattleMapResponse,
  CreateUnifiedAutomationModuleRequest,
  UnifiedAutomationMap,
  UnifiedAutomationModuleResponse,
  UnifiedAutomationModuleType,
  UnifiedAutomationQuest,
  UpdateUnifiedAutomationModuleRequest,
} from '../types/api';

export type UnifiedModuleSummary = {
  id: number;
  title: string;
  typeLabel: string;
  enabled: boolean;
  ready: boolean;
  detail: string;
};

/**
 * 생성 화면과 수정 화면이 함께 사용하는 로컬 편집 모델이다.
 *
 * 서버 ID가 null이면 아직 저장하지 않은 새 모듈이며, 화면에서 필수 설정을 모두 채운 뒤에만
 * POST 요청으로 변환한다. 이 구분 덕분에 유형을 고른 순간 불완전한 모듈이 서버에 생기지 않는다.
 */
export type UnifiedAutomationModuleDraft = {
  moduleId: number | null;
  moduleType: UnifiedAutomationModuleType;
  displayName: string;
  enabled: boolean;
  thresholdPercent: number | null;
  maps: UnifiedAutomationMap[];
  quests: UnifiedAutomationQuest[];
};

const MODULE_TYPE_LABELS: Record<UnifiedAutomationModuleType, string> = {
  KEY_QUEST: '열쇠 퀘스트',
  TIME_BURN: 'Time 자동 소모',
  COOLDOWN_ADVENTURE: '쿨다운 모험맵',
  DAILY_ADVENTURE: '일일 제한 모험맵',
  OTHER_QUEST: '일반 퀘스트',
};

/** 내부 enum 대신 사용자가 이해할 수 있는 모듈 유형 이름을 반환한다. */
export function getUnifiedModuleTypeLabel(type: UnifiedAutomationModuleType): string {
  return MODULE_TYPE_LABELS[type];
}

/** 같은 유형을 여러 번 추가할 때 겹치지 않는 기본 이름을 제안한다. */
export function suggestUnifiedModuleName(
  type: UnifiedAutomationModuleType,
  modules: UnifiedAutomationModuleResponse[],
): string {
  const label = getUnifiedModuleTypeLabel(type);
  const sameTypeCount = modules.filter((module) => module.moduleType === type).length;
  return sameTypeCount === 0 ? label : `${label} ${sameTypeCount + 1}`;
}

/** 선택한 유형의 안전한 초기값을 만들며 서버에는 어떤 요청도 보내지 않는다. */
export function buildCreateUnifiedModuleDraft(
  type: UnifiedAutomationModuleType,
  modules: UnifiedAutomationModuleResponse[],
): UnifiedAutomationModuleDraft {
  return {
    moduleId: null,
    moduleType: type,
    displayName: suggestUnifiedModuleName(type, modules),
    enabled: true,
    thresholdPercent: type === 'TIME_BURN' ? 90 : null,
    maps: [],
    quests: [],
  };
}

/** 서버 모듈을 깊은 복사해 취소 가능한 편집 초안으로 바꾼다. */
export function buildEditUnifiedModuleDraft(
  module: UnifiedAutomationModuleResponse,
): UnifiedAutomationModuleDraft {
  return {
    moduleId: module.id,
    moduleType: module.moduleType,
    displayName: module.displayName,
    enabled: module.enabled,
    thresholdPercent: module.thresholdPercent,
    maps: normalizeMaps(module.maps),
    quests: normalizeQuests(module.quests),
  };
}

/** 서버가 반환한 실제 모듈만 목록용 요약으로 변환한다. 빈 목록에는 기본값을 합성하지 않는다. */
export function buildUnifiedModuleSummaries(
  modules: UnifiedAutomationModuleResponse[],
): UnifiedModuleSummary[] {
  return modules.map((module) => ({
    id: module.id,
    title: module.displayName,
    typeLabel: getUnifiedModuleTypeLabel(module.moduleType),
    enabled: module.enabled,
    ready: module.ready,
    detail: module.summary,
  }));
}

/** 모듈 편집 화면에서 보여줄 수 있는 맵 카테고리를 유형별로 제한한다. */
export function getUnifiedModuleCategoryIds(type: UnifiedAutomationModuleType): string[] {
  switch (type) {
    case 'TIME_BURN':
      return ['battle_map', 'scenario_ocean'];
    case 'COOLDOWN_ADVENTURE':
    case 'DAILY_ADVENTURE':
      return ['adventure_map'];
    case 'KEY_QUEST':
      return ['battle_map'];
    case 'OTHER_QUEST':
      return [];
  }
}

/** 선택 가능한 실제 맵을 초안에 추가하거나 제거하고 실행 순서를 다시 매긴다. */
export function toggleUnifiedAutomationMap(
  maps: UnifiedAutomationMap[],
  map: Pick<BattleMapResponse, 'categoryId' | 'mapCode' | 'resolved'>,
): UnifiedAutomationMap[] {
  if (!map.resolved || map.mapCode == null) return maps;
  const exists = maps.some((saved) => (
    saved.categoryId === map.categoryId && saved.mapCode === map.mapCode
  ));
  const next = exists
    ? maps.filter((saved) => !(
      saved.categoryId === map.categoryId && saved.mapCode === map.mapCode
    ))
    : [...maps, {
      categoryId: map.categoryId,
      mapCode: map.mapCode,
      partyPresetId: null,
      executionOrder: maps.length,
    }];
  return normalizeMaps(next);
}

/** 선택한 맵 한 개에 프리셋을 연결하거나 연결을 해제한다. */
export function setUnifiedAutomationMapPreset(
  maps: UnifiedAutomationMap[],
  map: Pick<BattleMapResponse, 'categoryId' | 'mapCode'>,
  partyPresetId: number | null,
): UnifiedAutomationMap[] {
  if (map.mapCode == null) return maps;
  return normalizeMaps(maps.map((saved) => (
    saved.categoryId === map.categoryId && saved.mapCode === map.mapCode
      ? { ...saved, partyPresetId: normalizePresetId(partyPresetId) }
      : saved
  )));
}

/** 퀘스트 입력 행을 마지막에 추가한다. 같은 유형 모듈이나 같은 화면의 다른 초안과 공유하지 않는다. */
export function addUnifiedAutomationQuest(
  draft: UnifiedAutomationModuleDraft,
  questCode = '',
): UnifiedAutomationModuleDraft {
  return {
    ...draft,
    quests: normalizeQuests([...draft.quests, {
      questCode,
      executionOrder: draft.quests.length,
      maps: [],
    }]),
  };
}

/** 지정한 퀘스트 입력 행을 제거하고 남은 실행 순서를 연속 값으로 정리한다. */
export function removeUnifiedAutomationQuest(
  draft: UnifiedAutomationModuleDraft,
  questIndex: number,
): UnifiedAutomationModuleDraft {
  return {
    ...draft,
    quests: normalizeQuests(draft.quests.filter((_, index) => index !== questIndex)),
  };
}

/** 퀘스트 코드만 바꾸며 그 퀘스트에 연결된 맵과 프리셋은 보존한다. */
export function setUnifiedAutomationQuestCode(
  draft: UnifiedAutomationModuleDraft,
  questIndex: number,
  questCode: string,
): UnifiedAutomationModuleDraft {
  return {
    ...draft,
    quests: draft.quests.map((quest, index) => (
      index === questIndex ? { ...quest, questCode } : quest
    )),
  };
}

/** 열쇠 퀘스트 한 개의 맵 배열만 교체한다. */
export function setUnifiedAutomationQuestMaps(
  draft: UnifiedAutomationModuleDraft,
  questIndex: number,
  maps: UnifiedAutomationMap[],
): UnifiedAutomationModuleDraft {
  return {
    ...draft,
    quests: draft.quests.map((quest, index) => (
      index === questIndex ? { ...quest, maps: normalizeMaps(maps) } : quest
    )),
  };
}

/**
 * 초안을 서버가 요구하는 유형별 요청으로 정규화한다.
 * UI에서 사용하지 않는 필드는 빈 배열 또는 null로 강제해 이전 편집 상태가 다른 유형에 섞이지 않게 한다.
 */
export function buildUnifiedModuleRequest(
  draft: UnifiedAutomationModuleDraft,
): CreateUnifiedAutomationModuleRequest {
  const usesModuleMaps = draft.moduleType === 'TIME_BURN' ||
    draft.moduleType === 'COOLDOWN_ADVENTURE' ||
    draft.moduleType === 'DAILY_ADVENTURE';
  const usesQuests = draft.moduleType === 'KEY_QUEST' || draft.moduleType === 'OTHER_QUEST';
  return {
    displayName: draft.displayName.trim(),
    moduleType: draft.moduleType,
    enabled: draft.enabled,
    thresholdPercent: draft.moduleType === 'TIME_BURN' ? draft.thresholdPercent : null,
    maps: usesModuleMaps ? normalizeMaps(draft.maps) : [],
    quests: usesQuests ? normalizeQuests(draft.quests) : [],
  };
}

/** 수정 endpoint에는 생성 시 고정된 moduleType을 보내지 않는다. */
export function buildUpdateUnifiedModuleRequest(
  draft: UnifiedAutomationModuleDraft,
): UpdateUnifiedAutomationModuleRequest {
  const { moduleType: _moduleType, ...request } = buildUnifiedModuleRequest(draft);
  return request;
}

/** 목록 스위치가 세부 설정을 잃지 않고 enabled 값만 반전하도록 PUT 요청을 만든다. */
export function buildToggleUnifiedModuleRequest(
  module: UnifiedAutomationModuleResponse,
): UpdateUnifiedAutomationModuleRequest {
  return {
    displayName: module.displayName,
    enabled: !module.enabled,
    thresholdPercent: module.thresholdPercent,
    maps: normalizeMaps(module.maps),
    quests: normalizeQuests(module.quests),
  };
}

/** 저장 버튼 옆에 바로 표시할 수 있는 사용자 친화적인 유효성 오류 목록을 만든다. */
export function validateUnifiedModuleDraft(draft: UnifiedAutomationModuleDraft): string[] {
  const errors: string[] = [];
  const name = draft.displayName.trim();
  if (!name) errors.push('자동화 이름을 입력해 주세요.');
  else if (name.length > 50) errors.push('자동화 이름은 50자 이내로 입력해 주세요.');

  if (draft.moduleType === 'TIME_BURN' && (
    draft.thresholdPercent == null || draft.thresholdPercent < 1 || draft.thresholdPercent > 100
  )) {
    errors.push('Time 기준은 1%에서 100% 사이로 설정해 주세요.');
  }

  const moduleUsesMaps = draft.moduleType === 'TIME_BURN' ||
    draft.moduleType === 'COOLDOWN_ADVENTURE' ||
    draft.moduleType === 'DAILY_ADVENTURE';
  if (moduleUsesMaps && draft.maps.length === 0) {
    errors.push('실행할 맵을 한 개 이상 선택해 주세요.');
  }

  const quests = draft.quests.map((quest) => quest.questCode.trim());
  if ((draft.moduleType === 'KEY_QUEST' || draft.moduleType === 'OTHER_QUEST') && quests.length === 0) {
    errors.push('실행할 퀘스트를 한 개 이상 추가해 주세요.');
  }
  if (quests.some((questCode) => !questCode)) {
    errors.push('퀘스트 코드를 입력해 주세요.');
  }
  if (quests.some((questCode) => questCode.length > 100)) {
    errors.push('퀘스트 코드는 100자 이내로 입력해 주세요.');
  }
  if (new Set(quests).size !== quests.length) {
    errors.push('같은 퀘스트 코드를 두 번 추가할 수 없습니다.');
  }

  const mapsRequiringPreset = moduleUsesMaps
    ? draft.maps
    : draft.moduleType === 'KEY_QUEST'
      ? draft.quests.flatMap((quest) => quest.maps)
      : [];
  if (mapsRequiringPreset.some((map) => map.partyPresetId == null)) {
    errors.push('선택한 모든 맵에 파티 프리셋을 지정해 주세요.');
  }
  return errors;
}

/** 백엔드 job 상태를 화면에서 사용할 짧은 한국어 상태로 바꾼다. */
export function formatUnifiedAutomationStatus(status: string | null | undefined): string {
  switch (status?.toUpperCase()) {
    case 'RUNNING':
    case 'PENDING':
      return '자동 전투 중';
    case 'WAITING_CAPTCHA':
      return '캡차 인증이 필요해요';
    case 'WAITING_CONFIG':
      return '전투에 사용할 파티를 선택해 주세요';
    case 'WAITING_LOGIN':
      return '로그인 정보를 확인해 주세요';
    case 'PAUSED':
      return '일시정지됨';
    case 'STOPPED':
    case 'COMPLETED':
      return '종료됨';
    case 'FAILED':
      return '자동화 확인이 필요해요';
    default:
      return '시작 전';
  }
}

function normalizeMaps(maps: UnifiedAutomationMap[]): UnifiedAutomationMap[] {
  return maps.map((map, executionOrder) => ({
    categoryId: map.categoryId,
    mapCode: map.mapCode,
    partyPresetId: normalizePresetId(map.partyPresetId),
    executionOrder,
  }));
}

function normalizeQuests(quests: UnifiedAutomationQuest[]): UnifiedAutomationQuest[] {
  return quests.map((quest, executionOrder) => ({
    questCode: quest.questCode,
    executionOrder,
    maps: normalizeMaps(quest.maps),
  }));
}

function normalizePresetId(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}
