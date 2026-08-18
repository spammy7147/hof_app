import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Settings } from 'lucide-react-native';

import {
  estimateActionTime,
  formatActionTime,
  formatPlayerDisplayName,
  formatStatusBarFunds,
  formatStatusBarStateValue,
} from '../domain/hofStatus';
import { theme } from '../styles/theme';
import type { HofObservedStatusResponse } from '../types/api';

type HomeStatusSummaryProps = {
  status: HofObservedStatusResponse | null;
  onOpenSettings: () => void;
};

/**
 * 홈 대시보드 상단에 플레이어와 게임 상태를 요약한다.
 *
 * 전역 고정 헤더가 아니므로 홈을 스크롤하면 다른 콘텐츠와 함께 사라진다.
 */
export function HomeStatusSummary({
  status,
  onOpenSettings,
}: HomeStatusSummaryProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const estimatedTime = useMemo(() => {
    if (status?.timeCurrent == null || status.timeMax == null) return null;
    const observedAt = Date.parse(status.observedAt);
    if (Number.isNaN(observedAt)) {
      return { current: status.timeCurrent, max: status.timeMax };
    }

    return estimateActionTime(
      {
        current: status.timeCurrent,
        max: status.timeMax,
        observedAt,
      },
      now,
    );
  }, [now, status]);

  const playerName = status?.playerName
    ? formatPlayerDisplayName(status.playerName)
    : '플레이어 정보 확인 중';
  const timeText = estimatedTime == null ? '-' : formatActionTime(estimatedTime);
  const fundsText = status?.funds == null ? '$-' : formatStatusBarFunds(status.funds);
  const workText = formatStatusBarStateValue(status?.work);
  const auctionText = formatStatusBarStateValue(status?.auction);

  return (
    <View accessibilityLabel="홈 게임 상태" style={styles.container}>
      <View style={styles.topRow}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          numberOfLines={1}
          style={styles.playerName}
        >
          {playerName}
        </Text>
        <Pressable
          accessibilityLabel="앱 설정 열기"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onOpenSettings}
          style={({ pressed }) => [
            styles.settingsButton,
            pressed && styles.settingsButtonPressed,
          ]}
        >
          <Settings color={theme.colors.textMuted} size={22} />
        </Pressable>
      </View>

      <View style={styles.metrics}>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Time</Text>
          <Text style={styles.metricValue}>{timeText}</Text>
        </View>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>Fund</Text>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={1}
            style={styles.fundsValue}
          >
            {fundsText}
          </Text>
        </View>
      </View>

      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        numberOfLines={1}
        style={styles.subStatusText}
      >
        Work {workText} · Auction {auctionText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomColor: theme.colors.border,
    borderBottomWidth: 1,
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
    minHeight: 44,
  },
  playerName: {
    color: theme.colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '900',
  },
  settingsButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  settingsButtonPressed: {
    backgroundColor: theme.colors.surfaceAlt,
  },
  metrics: {
    gap: theme.spacing.xs,
  },
  metricRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: theme.spacing.md,
    minWidth: 0,
  },
  metricLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    width: 40,
  },
  metricValue: {
    color: theme.colors.statusGreen,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
  },
  fundsValue: {
    color: theme.colors.statusGreen,
    flex: 1,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
  },
  subStatusText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
});
