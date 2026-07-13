import type { BattleLogResponse, BattleStatsResponse } from '../types/api';

/**
 * 서버가 0~1 사이 실수로 내려주는 승률을 화면용 퍼센트 문자열로 바꾼다.
 */
export function formatWinRate(stats: Pick<BattleStatsResponse, 'winRate'>): string {
  return `${Math.round(stats.winRate * 100)}%`;
}

/**
 * ISO 날짜 문자열을 최근 전투 로그 카드에서 쓰는 `MM-DD HH:mm` 형식으로 바꾼다.
 */
export function formatBattleLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());

  return `${month}-${day} ${hour}:${minute}`;
}

/**
 * 전투 로그 카드에 표시할 파티원 이름 목록을 만든다.
 *
 * `mapCode`는 내부 식별자이므로 사용자 화면에는 노출하지 않고,
 * 실제 전투에 참여한 캐릭터 이름만 콤마로 이어 보여준다.
 */
export function formatBattleLogParty(log: Pick<BattleLogResponse, 'characterNames'>): string {
  const names = log.characterNames
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  return names.length > 0 ? names.join(', ') : '캐릭터 없음';
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
