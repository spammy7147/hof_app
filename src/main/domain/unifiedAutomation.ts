import type {
  UnifiedAutomationSettingsRequest,
} from '../types/api';

export type UnifiedModuleSummary = {
  title: string;
  enabled: boolean;
  detail: string;
};

export function buildDefaultUnifiedAutomationSettings(): UnifiedAutomationSettingsRequest {
  return {
    keyQuest: {
      enabled: true,
      quests: ['0563', '0571', '0171', '0351'].map((questId) => ({ questId, maps: [] })),
    },
    time: { enabled: true, thresholdPercent: 90, maps: [] },
    cooldownAdventure: { enabled: true, maps: [] },
    dailyAdventure: { enabled: true, maps: [] },
    union: { enabled: true, maps: [] },
    normalQuest: { enabled: false, questIds: [] },
  };
}

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

export function buildUnifiedModuleSummaries(
  settings: UnifiedAutomationSettingsRequest,
): UnifiedModuleSummary[] {
  const mapDetail = (enabled: boolean, count: number) => {
    if (!enabled) return '사용 안 함';
    return count > 0 ? `${count}개 맵 선택됨` : '맵 설정 필요';
  };
  return [
    {
      title: '열쇠 퀘스트',
      enabled: settings.keyQuest.enabled,
      detail: settings.keyQuest.enabled
        ? '4개 우선 퀘스트'
        : '사용 안 함',
    },
    {
      title: 'Time 자동 소모',
      enabled: settings.time.enabled,
      detail: settings.time.enabled
        ? `${settings.time.thresholdPercent}% 이상일 때 실행`
        : '사용 안 함',
    },
    {
      title: '쿨다운 모험맵',
      enabled: settings.cooldownAdventure.enabled,
      detail: mapDetail(settings.cooldownAdventure.enabled, settings.cooldownAdventure.maps.length),
    },
    {
      title: '일일 제한 모험맵',
      enabled: settings.dailyAdventure.enabled,
      detail: mapDetail(settings.dailyAdventure.enabled, settings.dailyAdventure.maps.length),
    },
    {
      title: '유니온',
      enabled: settings.union.enabled,
      detail: mapDetail(settings.union.enabled, settings.union.maps.length),
    },
    {
      title: '일반 퀘스트',
      enabled: settings.normalQuest.enabled,
      detail: settings.normalQuest.enabled
        ? `${settings.normalQuest.questIds.length}개 선택됨`
        : '사용 안 함',
    },
  ];
}

export function getPriorityQuestName(questId: string): string {
  const names: Record<string, string> = {
    '0563': '저택 동관 열쇠 수집',
    '0571': '저택 서관 열쇠 수집',
    '0171': '우선 열쇠 퀘스트',
    '0351': '마을 지하 수로 열쇠 수집',
  };
  return names[questId] ?? '선택한 퀘스트';
}

export function getUnifiedModuleCategoryIds(
  module: 'time' | 'cooldownAdventure' | 'dailyAdventure' | 'union',
): string[] {
  switch (module) {
    case 'time':
      return ['battle_map', 'scenario_ocean'];
    case 'cooldownAdventure':
    case 'dailyAdventure':
      return ['adventure_map'];
    case 'union':
      return ['union'];
  }
}
