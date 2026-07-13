import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  estimateActionTime,
  formatActionTime,
  formatStatusBarFunds,
  formatStatusBarStateValue,
} from '../domain/hofStatus';
import { theme } from '../styles/theme';
import type { HofStatusResponse } from '../types/api';

type GameStatusBarProps = {
  status: HofStatusResponse | null;
};

/**
 * HOF 상단 상태바를 앱 화면에 맞게 보여준다.
 *
 * 서버에서 받은 Time 값은 매초 로컬에서 추정 갱신해 자주 새로고침하지 않아도 자연스럽게 보이게 한다.
 */
export function GameStatusBar({ status }: GameStatusBarProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const estimatedTime = useMemo(() => {
    if (status?.timeCurrent == null || status.timeMax == null) return null;
    const observedAt = Date.parse(status.observedAt);
    if (Number.isNaN(observedAt)) return { current: status.timeCurrent, max: status.timeMax };

    return estimateActionTime(
      {
        current: status.timeCurrent,
        max: status.timeMax,
        observedAt,
      },
      now,
    );
  }, [now, status]);

  const timeText = estimatedTime == null ? '-' : formatActionTime(estimatedTime);
  const fundsText = status?.funds == null ? '$-' : formatStatusBarFunds(status.funds);
  const workText = formatStatusBarStateValue(status?.work);
  const auctionText = formatStatusBarStateValue(status?.auction);

  return (
    <View style={styles.container}>
      {status?.playerName ? (
        <Text style={styles.playerName} numberOfLines={1}>
          {status.playerName}
        </Text>
      ) : null}
      <Text style={styles.statusText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58}>
        Time {timeText} · Fund {fundsText}
      </Text>
      <Text style={styles.subStatusText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.64}>
        Work {workText} · Auction {auctionText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.header,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  playerName: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
  },
  statusText: {
    color: theme.colors.statusGreen,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
    width: '100%',
  },
  subStatusText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
    width: '100%',
  },
});
