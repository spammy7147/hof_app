export type ActionTimeValue = {
  current: number;
  max: number;
};

export type ActionTimeSnapshot = ActionTimeValue & {
  observedAt: number;
};

/**
 * 마지막으로 관측한 Time 값과 현재 시각을 이용해 화면에 표시할 예상 Time을 계산한다.
 *
 * @remarks
 * HOF 서버를 매초 호출하지 않아도 상단 상태바가 자연스럽게 회복되는 것처럼 보이게 한다.
 */
export function estimateActionTime(
  snapshot: ActionTimeSnapshot,
  now: number = Date.now(),
  recoveryPerSecond = 1,
): ActionTimeValue {
  const elapsedSeconds = Math.max(0, Math.floor((now - snapshot.observedAt) / 1000));
  const recovered = elapsedSeconds * recoveryPerSecond;

  return {
    current: Math.min(snapshot.max, snapshot.current + recovered),
    max: snapshot.max,
  };
}

/**
 * 일반 화면에서 쓰는 Funds 표기다. `$ 1,000`처럼 기호 뒤에 공백을 둔다.
 */
export function formatFunds(funds: number): string {
  return `$ ${new Intl.NumberFormat('en-US').format(funds)}`;
}

/**
 * 상단 상태바에서 공간을 줄이기 위한 Funds 표기다. `$1,000`처럼 공백을 제거한다.
 */
export function formatStatusBarFunds(funds: number): string {
  return `$${new Intl.NumberFormat('en-US').format(funds)}`;
}

/**
 * Work/Auction처럼 빈 값일 수 있는 상태값을 안전한 표시 문자열로 바꾼다.
 */
export function formatStatusBarStateValue(value: string | null | undefined): string {
  return value?.trim() || '-';
}

/**
 * Time 값을 `현재/최대` 형식으로 표시한다.
 */
export function formatActionTime(time: ActionTimeValue): string {
  return `${time.current}/${time.max}`;
}
