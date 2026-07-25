import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PrimaryButton } from '../components/PrimaryButton';
import {
  formatBattleLogFunds,
  formatBattleLogItems,
  formatBattleLogMap,
  formatBattleLogParty,
  formatBattleLogTime,
  formatWinRate,
} from '../domain/battleLogs';
import { formatBattleOutcome } from '../domain/battleResults';
import { theme } from '../styles/theme';
import type { BattleLogResponse, BattleStatsResponse } from '../types/api';

type DataTabScreenProps = {
  authenticated: boolean;
  onLoadBattleLogs: (limit?: number) => Promise<BattleLogResponse[]>;
  onLoadBattleStats: () => Promise<BattleStatsResponse>;
};

/**
 * 전투 기록과 누적 통계를 보여주는 데이터 탭 화면이다.
 */
export function DataTabScreen({
  authenticated,
  onLoadBattleLogs,
  onLoadBattleStats,
}: DataTabScreenProps) {
  const [stats, setStats] = useState<BattleStatsResponse | null>(null);
  const [logs, setLogs] = useState<BattleLogResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * 누적 통계와 최근 전투 로그를 동시에 불러온다.
   *
   * 두 데이터가 같은 화면에 함께 필요하므로 Promise.all로 병렬 요청해 로딩 시간을 줄인다.
   */
  const load = useCallback(async () => {
    if (!authenticated) {
      setErrorMessage('로그인 계정이 없습니다.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [loadedStats, loadedLogs] = await Promise.all([
        onLoadBattleStats(),
        onLoadBattleLogs(20),
      ]);
      setStats(loadedStats);
      setLogs(loadedLogs);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '전투 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [authenticated, onLoadBattleLogs, onLoadBattleStats]);

  useEffect(() => {
    void load();
  }, [load]);

  const ListHeaderComponent = useMemo(() => (
    <View style={styles.headerStack}>
      <View style={styles.header}>
        <Text style={styles.title}>데이터</Text>
        <PrimaryButton label="새로고침" variant="secondary" loading={isLoading} onPress={load} style={styles.refreshButton} />
      </View>

      {isLoading && !stats ? (
        <View style={styles.statePanel}>
          <ActivityIndicator color={theme.colors.accentGreen} />
          <Text style={styles.stateText}>전투 데이터 확인 중</Text>
        </View>
      ) : null}

      {errorMessage ? (
        <View style={styles.statePanel}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      {stats ? <StatsPanel stats={stats} /> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>최근 전투</Text>
        <Text style={styles.sectionMeta}>{logs.length}개</Text>
      </View>
    </View>
  ), [errorMessage, isLoading, load, logs.length, stats]);
  /**
   * 전투 로그가 비어 있을 때 FlatList가 표시할 빈 상태 컴포넌트다.
   */
  const ListEmptyComponent = useCallback(() => (
    !isLoading ? (
      <View style={styles.statePanel}>
        <Text style={styles.stateText}>저장된 전투 기록이 없습니다.</Text>
      </View>
    ) : null
  ), [isLoading]);
  /**
   * 최근 전투 로그 한 건을 카드로 렌더링한다.
   */
  const renderItem = useCallback(({ item }: { item: BattleLogResponse }) => (
    <BattleLogCard log={item} />
  ), []);

  return (
    <FlatList
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      data={logs}
      ItemSeparatorComponent={LogSeparator}
      keyExtractor={(log) => String(log.id)}
      ListEmptyComponent={ListEmptyComponent}
      ListHeaderComponent={ListHeaderComponent}
      renderItem={renderItem}
      style={styles.list}
    />
  );
}

/**
 * 누적 전투 통계를 작은 카드 그리드로 표시한다.
 */
function StatsPanel({ stats }: { stats: BattleStatsResponse }) {
  return (
    <View style={styles.statsGrid}>
      <StatCard label="전투" value={`${stats.totalBattles.toLocaleString('en-US')}회`} />
      <StatCard label="승률" value={formatWinRate(stats)} accent />
      <StatCard label="승/패/무" value={`${stats.victories}/${stats.defeats}/${stats.draws}`} />
      <StatCard label="Funds" value={stats.totalFunds.toLocaleString('en-US')} accent />
      <StatCard label="경험치" value={stats.totalExperience.toLocaleString('en-US')} />
      <StatCard label="전리품" value={`${stats.totalLootCount.toLocaleString('en-US')}개`} />
    </View>
  );
}

/**
 * 통계 그리드의 단일 카드다.
 */
function StatCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent && styles.accentValue]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/**
 * 전투 기록 한 건의 결과, 시간, 맵, 참여 캐릭터, 보상을 표시한다.
 */
function BattleLogCard({ log }: { log: BattleLogResponse }) {
  return (
    <View style={styles.logCard}>
      <View style={styles.logHeader}>
        <Text style={styles.logOutcome}>{formatBattleOutcome(log.outcome)}</Text>
        <Text style={styles.logTime}>{formatBattleLogTime(log.createdAt)}</Text>
      </View>
      <Text style={styles.logTitle} numberOfLines={2}>{formatBattleLogMap(log)}</Text>
      <Text style={styles.logMeta} numberOfLines={1}>
        {formatBattleLogParty(log)}
      </Text>
      <Text style={styles.logText}>{formatBattleLogFunds(log)}</Text>
      <Text style={styles.logText} numberOfLines={2}>{formatBattleLogItems(log)}</Text>
      {log.quest ? <Text style={styles.questText} numberOfLines={2}>{log.quest}</Text> : null}
    </View>
  );
}

/**
 * 전투 기록 카드 사이 간격을 만든다.
 */
function LogSeparator() {
  return <View style={styles.logSeparator} />;
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  headerStack: {
    gap: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  header: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  title: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  refreshButton: {
    minHeight: 36,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  statePanel: {
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  stateText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  statCard: {
    minWidth: '31%',
    flexGrow: 1,
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  statLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  statValue: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  accentValue: {
    color: theme.colors.accentAmber,
  },
  sectionHeader: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  sectionMeta: {
    color: theme.colors.accentGreen,
    fontSize: 13,
    fontWeight: '900',
  },
  logSeparator: {
    height: theme.spacing.sm,
  },
  logCard: {
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  logOutcome: {
    color: theme.colors.accentAmber,
    fontSize: 15,
    fontWeight: '900',
  },
  logTime: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  logTitle: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  logMeta: {
    color: theme.colors.accentGreen,
    fontSize: 12,
    fontWeight: '800',
  },
  logText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  questText: {
    color: theme.colors.accentBlue,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
});
