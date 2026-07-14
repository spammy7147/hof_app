import type {
  UnifiedAutomationModuleResponse,
  UnifiedAutomationModuleType,
} from '../types/api';

export type UnifiedModuleSummary = {
  id: number;
  title: string;
  typeLabel: string;
  enabled: boolean;
  ready: boolean;
  detail: string;
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
