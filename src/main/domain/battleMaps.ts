import type { BattleMapResponse } from '../types/api';

export type BattleMapGroup = {
  key: string;
  name: string;
  groupOrder: number;
  recommendedLevel: string | null;
  maps: BattleMapResponse[];
};

/**
 * 전투 맵별 React row와 실행 상태를 저장할 충돌 안전 키를 만든다.
 *
 * @remarks
 * 확인된 코드는 카테고리와 코드만으로 고유하다. 코드가 없는 placeholder는 같은 href를 공유할 수 있으므로
 * 카테고리, 정규화한 그룹명과 순서, 맵 순서, 이름, 원본 href를 길이 접두어와 함께 모두 포함한다.
 */
export function buildBattleMapStateKey(map: BattleMapResponse): string {
  if (map.resolved && map.mapCode != null) {
    return [
      'resolved',
      encodeBattleMapKeyPart(map.categoryId),
      encodeBattleMapKeyPart(map.mapCode),
    ].join('|');
  }

  return [
    'unresolved',
    encodeBattleMapKeyPart(map.categoryId),
    `group-order:${map.groupOrder}`,
    encodeBattleMapKeyPart(normalizeBattleMapKeyText(map.groupName ?? '기타')),
    `map-order:${map.mapOrder}`,
    encodeBattleMapKeyPart(normalizeBattleMapKeyText(map.name)),
    encodeBattleMapKeyPart(map.rawHref.trim()),
    encodeBattleMapKeyPart(map.mapCode ?? ''),
  ].join('|');
}

/**
 * 전투/모험맵을 HOF 원본 그룹 순서에 가깝게 정렬한다.
 *
 * @remarks
 * 비활성 맵은 목록 뒤로 보내고, 같은 그룹 안에서는 mapOrder와 이름을 기준으로 안정적으로 정렬한다.
 */
export function orderBattleMaps(maps: BattleMapResponse[]): BattleMapResponse[] {
  return [...maps].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }

    const groupCompare = left.groupOrder - right.groupOrder;
    if (groupCompare !== 0) return groupCompare;

    if (left.resolved !== right.resolved) {
      return left.resolved ? -1 : 1;
    }

    const mapCompare = left.mapOrder - right.mapOrder;
    if (mapCompare !== 0) return mapCompare;

    const nameCompare = left.name.localeCompare(right.name, 'ko-KR');
    if (nameCompare !== 0) return nameCompare;

    return (left.mapCode ?? '').localeCompare(right.mapCode ?? '');
  });
}

/**
 * 앱 화면에서 보여주지 않을 원본 HOF 맵을 제거한다.
 *
 * @remarks
 * 모험맵의 허수아비는 실제 자동전투/수동 전투 선택지로 쓰지 않으므로 화면 목록에서 숨긴다.
 */
export function filterDisplayBattleMaps(maps: BattleMapResponse[]): BattleMapResponse[] {
  return maps.filter((map) => !isHiddenAdventureScarecrowMap(map));
}

/**
 * 납작한 맵 목록을 화면의 접기/펼치기 트리에서 쓰기 좋은 그룹 단위로 묶는다.
 */
export function groupBattleMaps(maps: BattleMapResponse[]): BattleMapGroup[] {
  const groups = new Map<string, BattleMapGroup>();

  for (const map of orderBattleMaps(filterDisplayBattleMaps(maps))) {
    const groupName = map.groupName?.trim() || '기타';
    const key = `${map.categoryId}:${map.groupOrder}:${groupName}`;
    const existing = groups.get(key);

    if (existing) {
      existing.maps.push(map);
      if (existing.recommendedLevel == null && map.recommendedLevel != null) {
        existing.recommendedLevel = map.recommendedLevel;
      }
      continue;
    }

    groups.set(key, {
      key,
      name: groupName,
      groupOrder: map.groupOrder,
      recommendedLevel: map.recommendedLevel,
      maps: [map],
    });
  }

  return [...groups.values()];
}

/**
 * 맵 카드 보조 정보에 표시할 그룹명, 권장 레벨, 필요 Time, 가능 횟수를 한 줄로 만든다.
 */
export function formatBattleMapMeta(map: BattleMapResponse): string {
  const parts = [];

  if (map.groupName) {
    parts.push(map.groupName);
  }
  if (map.recommendedLevel) {
    parts.push(`Lv ${map.recommendedLevel}`);
  }
  if (map.requiredTime != null) {
    parts.push(`Time ${map.requiredTime.toLocaleString('en-US')}`);
  }
  if (map.availableCount != null) {
    parts.push(`${map.availableCount.toLocaleString('en-US')} 가능`);
  }
  if (map.attemptCount != null) {
    parts.push(`도전 ${map.attemptCount.toLocaleString('en-US')}`);
  }
  if (map.winCount != null) {
    parts.push(`승리 ${map.winCount.toLocaleString('en-US')}`);
  }
  if (hasCooldownRemaining(map)) {
    parts.push(`대기 ${map.cooldownRemainingText?.trim()}`);
  }
  if (map.keyCount != null) {
    parts.push(`키 ${map.keyCount.toLocaleString('en-US')}`);
  }

  return parts.join(' · ');
}

/**
 * 자동전투 맵 선택 목록에서 사용할 짧은 맵 이름을 만든다.
 *
 * @remarks
 * HOF 원본은 `Noble's Mansion- 저택 서관(놀이방)`처럼 영문 큰 지역명이 앞에 붙는 경우가 많다.
 * 자동전투 설정 화면은 이미 큰 그룹으로 묶어 보여주므로, 실제로 고를 맵 이름만 제목에 남긴다.
 */
export function formatAutomationMapListName(map: BattleMapResponse): string {
  const baseName = stripHofMapNamePrefix(stripTrailingKeyCount(map.name)).trim() || map.name;

  return baseName;
}

/**
 * 자동전투 맵 선택 목록에서 제목 밑에 표시할 보조 정보를 만든다.
 *
 * @remarks
 * 큰 지역명과 권장 레벨은 그룹 row에서 이미 보이므로, 개별 맵 row에서는 남은 키 수량과 소비 Time만 표시한다.
 */
export function formatAutomationMapListMeta(map: BattleMapResponse): string {
  const parts = [];

  if (map.keyCount != null) {
    parts.push(`key ${map.keyCount.toLocaleString('en-US')}`);
  }
  if (map.attemptCount != null) {
    parts.push(`도전 ${map.attemptCount.toLocaleString('en-US')}`);
  }
  if (map.winCount != null) {
    parts.push(`승리 ${map.winCount.toLocaleString('en-US')}`);
  }
  if (hasCooldownRemaining(map)) {
    parts.push(`대기 ${map.cooldownRemainingText?.trim()}`);
  }
  if (map.requiredTime != null) {
    parts.push(`Time ${map.requiredTime.toLocaleString('en-US')}`);
  }

  return parts.join(' · ');
}

/**
 * 자동전투 루프에서 특정 맵을 실행하지 않고 다음 맵으로 넘겨야 하는 이유를 반환한다.
 *
 * null이면 현재 앱이 알고 있는 맵 상태 기준으로 실행 가능하다는 뜻이다.
 */
export function getAutomationMapSkipReason(map: BattleMapResponse): string | null {
  if (map.mapCode == null || !map.resolved) return '맵 코드 확인 대기';
  if (!map.enabled) return '현재 맵이 보이지 않음';
  if (map.keyCount != null && map.keyCount <= 0) return '키 없음';
  if (map.attemptCount != null && map.attemptCount <= 0) return '도전 가능 횟수 없음';
  if (map.winCount != null && map.winCount <= 0) return '승리 가능 횟수 없음';
  if (hasCooldownRemaining(map)) return '대기 시간 남음';
  if (map.availableCount != null && map.availableCount <= 0) return '가능 횟수 없음';

  return null;
}

function hasCooldownRemaining(map: BattleMapResponse): boolean {
  return (map.cooldownRemainingSeconds ?? 0) > 0 || Boolean(map.cooldownRemainingText?.trim());
}

/**
 * 길이 접두어를 붙여 값 안의 구분자가 서로 다른 필드 조합을 같은 키로 만들지 못하게 한다.
 */
function encodeBattleMapKeyPart(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * 원본 HTML의 불규칙한 공백이 같은 그룹을 다른 identity로 만들지 않도록 정규화한다.
 */
function normalizeBattleMapKeyText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function isHiddenAdventureScarecrowMap(map: BattleMapResponse): boolean {
  if (map.categoryId !== 'adventure_map') return false;

  return [map.name, map.groupName, map.rawHref]
    .filter(Boolean)
    .join(' ')
    .includes('허수아비');
}

function stripHofMapNamePrefix(name: string): string {
  const separatorIndex = name.indexOf('-');
  if (separatorIndex < 0) return name.trim();

  const suffix = name.slice(separatorIndex + 1).trim();
  if (!suffix) return name.trim();

  return suffix;
}

function stripTrailingKeyCount(name: string): string {
  return name.replace(/\(\s*x\s*\d[\d,]*\s*\)\s*$/i, '').trim();
}
