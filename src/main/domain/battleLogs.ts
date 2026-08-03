import type { BattleLogResponse } from '../types/api';

const KOREA_LOG_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * ISO 날짜 문자열을 최근 전투 로그 카드에서 쓰는 `MM-DD HH:mm` 형식으로 바꾼다.
 */
export function formatBattleLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const parts = Object.fromEntries(
    KOREA_LOG_TIME_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatBattleLogMap(log: Pick<BattleLogResponse, 'mapName' | 'mapCode'>): string {
  return log.mapName.trim() || log.mapCode;
}

export function formatBattleLogFunds(log: Pick<BattleLogResponse, 'funds'>): string {
  return log.funds == null ? 'Funds 없음' : `Funds ${log.funds.toLocaleString('en-US')}`;
}

export function formatBattleLogItems(log: Pick<BattleLogResponse, 'loots'>): string {
  const items = log.loots.map(({ name }) => name.trim()).filter(Boolean);
  return items.length === 0 ? '획득 아이템 없음' : `획득 아이템: ${items.join(', ')}`;
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
