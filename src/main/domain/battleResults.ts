import type { BattleResultResponse, BattleRoundResultResponse, BattleSideResponse } from '../types/api';

/**
 * 서버의 승패 코드를 전투 결과 카드 제목에 표시할 한국어로 변환한다.
 */
export function formatBattleOutcome(outcome: string): string {
  switch (outcome) {
    case 'VICTORY':
      return '승리';
    case 'DEFEAT':
      return '패배';
    case 'DRAW':
      return '무승부';
    default:
      return '확인 필요';
  }
}

/**
 * 1회/3회 전투 응답을 항상 라운드 배열로 다룰 수 있게 만든다.
 *
 * @remarks
 * 예전 응답처럼 최상위 결과만 있는 경우에도 화면은 `[result]` 형태로 동일하게 렌더링한다.
 */
export function getBattleResultRounds(result: BattleResultResponse): BattleRoundResultResponse[] {
  return result.rounds && result.rounds.length > 0 ? result.rounds : [result];
}

/**
 * 전투 보상 요약 줄을 만든다.
 */
export function formatBattleReward(result: Pick<BattleResultResponse, 'funds' | 'experience' | 'loots'>): string {
  const parts = [
    result.funds == null ? null : `Funds ${formatNumber(result.funds)}`,
    result.experience == null ? null : `경험치 ${formatNumber(result.experience)}`,
    result.loots.length > 0 ? `전리품 ${result.loots.length}개` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : '보상 없음';
}

/**
 * 전투 카드의 간단 요약용으로 아군/적군 상태를 한 줄로 만든다.
 */
export function formatBattleSide(side: BattleSideResponse): string {
  return [
    formatPair('생존', side.survivorsAlive, side.survivorsMax),
    formatPair('HP', side.hpCurrent, side.hpMax),
    side.totalDamage == null ? null : `피해 ${formatNumber(side.totalDamage)}`,
    formatPair('턴', side.turnCurrent, side.turnMax),
  ].filter(Boolean).join(' · ');
}

/**
 * 사용자가 요청한 상세 row 형식으로 아군/적군 HP, 생존자, 총 데미지를 만든다.
 */
export function formatBattleSideRow(label: string, side: BattleSideResponse): string {
  return [
    `${label}: HP : ${formatPairValue(side.hpCurrent, side.hpMax)}`,
    `생존자 : ${formatPairValue(side.survivorsAlive, side.survivorsMax)}`,
    `총 데미지 : ${formatNullableNumber(side.totalDamage)}`,
  ].join(' | ');
}

/**
 * 턴, 경험치, Funds 정보를 전투 결과의 별도 row로 만든다.
 */
export function formatBattleProgressRow(
  result: Pick<BattleResultResponse, 'ally' | 'experience' | 'funds' | 'turns'>,
): string {
  return [
    `턴 : ${formatTurnValue(result)}`,
    `경험치 : ${formatNullableNumber(result.experience)}`,
    `Funds : ${result.funds == null ? '-' : `$ ${formatNumber(result.funds)}`}`,
  ].join(' | ');
}

/**
 * current/max가 모두 있을 때만 `라벨 현재/최대` 형태의 짧은 문구를 만든다.
 */
function formatPair(label: string, current: number | null, max: number | null): string | null {
  if (current == null || max == null) return null;
  return `${label} ${formatNumber(current)}/${formatNumber(max)}`;
}

/**
 * 전투 상세 row에서 쓰는 `현재/최대` 문자열을 만든다.
 */
function formatPairValue(current: number | null, max: number | null): string {
  if (current == null || max == null) return '-';
  return `${formatNumber(current)}/${formatNumber(max)}`;
}

/**
 * 턴 정보가 ally 안에 있거나 최상위 turns에 있는 두 응답 형태를 모두 지원한다.
 */
function formatTurnValue(result: Pick<BattleResultResponse, 'ally' | 'turns'>): string {
  const turnCurrent = result.ally.turnCurrent ?? result.turns;
  const turnMax = result.ally.turnMax;
  if (turnCurrent == null) return '-';
  return turnMax == null ? formatNumber(turnCurrent) : `${formatNumber(turnCurrent)}/${formatNumber(turnMax)}`;
}

/**
 * 값이 없을 때 화면에 null 대신 `-`를 보여주기 위한 숫자 포매터다.
 */
function formatNullableNumber(value: number | null): string {
  return value == null ? '-' : formatNumber(value);
}

/**
 * 큰 데미지/Funds 값을 읽기 쉽도록 천 단위 콤마를 적용한다.
 */
function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}
