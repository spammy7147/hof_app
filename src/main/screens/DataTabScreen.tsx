import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { BattleLogDetailScreen } from './BattleLogDetailScreen';
import {
  formatBattleLogFunds,
  formatBattleLogMap,
  formatBattleLogParty,
  formatBattleLogTime,
} from '../domain/battleLogs';
import { formatBattleOutcome } from '../domain/battleResults';
import { theme } from '../styles/theme';
import type {
  AdventureMapOutcomeStatsResponse,
  BattleLogOutcome,
  BattleLogQuery,
  BattleLogResponse,
  BattleStatsResponse,
} from '../types/api';

type DataTabScreenProps = {
  authenticated: boolean;
  onLoadBattleLogs: (query?: BattleLogQuery) => Promise<BattleLogResponse[]>;
  onLoadBattleStats: () => Promise<BattleStatsResponse>;
  onFullScreenChange?: (open: boolean) => void;
};

type LogFilter = 'ALL' | BattleLogOutcome;

const LOG_PAGE_SIZE = 40;
const LOG_FILTERS: ReadonlyArray<{ id: LogFilter; label: string }> = [
  { id: 'ALL', label: '전체' },
  { id: 'VICTORY', label: '승리' },
  { id: 'DEFEAT', label: '패배' },
  { id: 'DRAW', label: '무승부' },
];

/** Funds 통계와 별도의 전체 전투 로그 화면을 제공하는 데이터 탭이다. */
export function DataTabScreen({
  authenticated,
  onLoadBattleLogs,
  onLoadBattleStats,
  onFullScreenChange,
}: DataTabScreenProps) {
  const [stats, setStats] = useState<BattleStatsResponse | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [logScreenOpen, setLogScreenOpen] = useState(false);

  const loadStats = useCallback(async () => {
    if (!authenticated) {
      setStatsError('로그인 계정이 없습니다.');
      return;
    }
    setIsStatsLoading(true);
    setStatsError(null);
    try {
      setStats(await onLoadBattleStats());
    } catch (error) {
      setStatsError(error instanceof Error ? error.message : '통계를 불러오지 못했습니다.');
    } finally {
      setIsStatsLoading(false);
    }
  }, [authenticated, onLoadBattleStats]);

  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => {
    onFullScreenChange?.(logScreenOpen);
    return () => onFullScreenChange?.(false);
  }, [logScreenOpen, onFullScreenChange]);

  if (logScreenOpen) {
    return (
      <BattleLogScreen
        authenticated={authenticated}
        onBack={() => setLogScreenOpen(false)}
        onLoadBattleLogs={onLoadBattleLogs}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.list}
    >
      <View style={styles.header}>
        <Text style={styles.title}>데이터</Text>
        <PrimaryButton
          label="새로고침"
          variant="secondary"
          loading={isStatsLoading}
          onPress={loadStats}
          style={styles.compactButton}
        />
      </View>

      {isStatsLoading && !stats ? <LoadingPanel label="통계 확인 중" /> : null}
      {statsError ? <StatePanel message={statsError} error /> : null}
      {stats ? <StatsPanel stats={stats} /> : null}

      <View style={styles.logLaunchCard}>
        <View style={styles.logLaunchCopy}>
          <Text style={styles.sectionTitle}>전투 로그</Text>
          <Text style={styles.description}>전체 기록을 결과별로 확인하고 상세 링크를 복사합니다.</Text>
        </View>
        <PrimaryButton label="로그 보기" onPress={() => setLogScreenOpen(true)} />
      </View>
    </ScrollView>
  );
}

/** 일/주/월 Funds와 모험맵 패배·무승부 집계를 표시한다. */
function StatsPanel({ stats }: { stats: BattleStatsResponse }) {
  const failedMaps = stats.adventureMapOutcomes.filter(({ defeats }) => defeats > 0);
  const drawnMaps = stats.adventureMapOutcomes.filter(({ draws }) => draws > 0);
  return (
    <View style={styles.statsStack}>
      <View style={styles.fundsGrid}>
        <StatCard label="일일 펀드" value={formatFunds(stats.dailyFunds)} />
        <StatCard label="주간 펀드" hint="월요일~일요일" value={formatFunds(stats.weeklyFunds)} />
        <StatCard label="월간 펀드" value={formatFunds(stats.monthlyFunds)} />
      </View>

      <View style={styles.outcomePanel}>
        <Text style={styles.sectionTitle}>모험맵 점검</Text>
        <Text style={styles.description}>패배·무승부가 기록된 맵만 집계합니다.</Text>
        <MapOutcomeSection label="패배" maps={failedMaps} outcome="DEFEAT" />
        <MapOutcomeSection label="무승부" maps={drawnMaps} outcome="DRAW" />
      </View>
    </View>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statLabelRow}>
        <Text style={styles.statLabel}>{label}</Text>
        {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
      </View>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function MapOutcomeSection({
  label,
  maps,
  outcome,
}: {
  label: string;
  maps: AdventureMapOutcomeStatsResponse[];
  outcome: 'DEFEAT' | 'DRAW';
}) {
  return (
    <View style={styles.mapSection}>
      <Text style={[styles.mapSectionTitle, outcome === 'DEFEAT' && styles.defeatText]}>{label}</Text>
      {maps.length === 0 ? (
        <Text style={styles.emptyInline}>기록 없음</Text>
      ) : maps.map((map) => (
        <View key={`${outcome}-${map.mapCode}`} style={styles.mapRow}>
          <Text style={styles.mapName} numberOfLines={2}>{map.mapName.trim() || map.mapCode}</Text>
          <Text style={[styles.mapCount, outcome === 'DEFEAT' && styles.defeatText]}>
            {outcome === 'DEFEAT' ? map.defeats : map.draws}회
          </Text>
        </View>
      ))}
    </View>
  );
}

/** 전체/승리/패배/무승부 필터와 페이지 로딩을 갖춘 전투 로그 전체 화면이다. */
function BattleLogScreen({
  authenticated,
  onBack,
  onLoadBattleLogs,
}: {
  authenticated: boolean;
  onBack: () => void;
  onLoadBattleLogs: (query?: BattleLogQuery) => Promise<BattleLogResponse[]>;
}) {
  const [filter, setFilter] = useState<LogFilter>('ALL');
  const [detailLog, setDetailLog] = useState<BattleLogResponse | null>(null);
  const [logs, setLogs] = useState<BattleLogResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const queryFor = useCallback((offset: number): BattleLogQuery => ({
    limit: LOG_PAGE_SIZE,
    offset,
    ...(filter === 'ALL' ? {} : { outcome: filter }),
  }), [filter]);

  const loadFirstPage = useCallback(async () => {
    if (!authenticated) {
      setErrorMessage('로그인 계정이 없습니다.');
      return;
    }
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const loaded = await onLoadBattleLogs(queryFor(0));
      if (requestId !== requestIdRef.current) return;
      setLogs(loaded);
      setHasMore(loaded.length === LOG_PAGE_SIZE);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setErrorMessage(error instanceof Error ? error.message : '전투 로그를 불러오지 못했습니다.');
      }
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [authenticated, onLoadBattleLogs, queryFor]);

  useEffect(() => { void loadFirstPage(); }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (isLoading || isLoadingMore || !hasMore) return;
    const requestId = requestIdRef.current;
    setIsLoadingMore(true);
    setErrorMessage(null);
    try {
      const loaded = await onLoadBattleLogs(queryFor(logs.length));
      if (requestId !== requestIdRef.current) return;
      setLogs((current) => [...current, ...loaded]);
      setHasMore(loaded.length === LOG_PAGE_SIZE);
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setErrorMessage(error instanceof Error ? error.message : '추가 로그를 불러오지 못했습니다.');
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoading, isLoadingMore, logs.length, onLoadBattleLogs, queryFor]);

  const header = useMemo(() => (
    <View style={styles.logScreenHeaderStack}>
      <View style={styles.header}>
        <PrimaryButton label="돌아가기" variant="secondary" onPress={onBack} style={styles.compactButton} />
        <Text style={styles.logScreenTitle}>전투 로그</Text>
        <PrimaryButton
          label="새로고침"
          variant="secondary"
          loading={isLoading}
          onPress={loadFirstPage}
          style={styles.compactButton}
        />
      </View>
      <View accessibilityRole="tablist" style={styles.filterRow}>
        {LOG_FILTERS.map((option) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === option.id }}
            key={option.id}
            onPress={() => setFilter(option.id)}
            style={[styles.filterButton, filter === option.id && styles.filterButtonActive]}
          >
            <Text style={[styles.filterLabel, filter === option.id && styles.filterLabelActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      {errorMessage ? <StatePanel message={errorMessage} error /> : null}
    </View>
  ), [errorMessage, filter, isLoading, loadFirstPage, onBack]);

  const detailUrl = safeHttpUrl(detailLog?.rawLogUrl ?? null);
  if (detailLog && detailUrl) {
    return (
      <BattleLogDetailScreen
        title={formatBattleLogMap(detailLog)}
        url={detailUrl}
        onBack={() => setDetailLog(null)}
      />
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.logListContainer}
      data={logs}
      ItemSeparatorComponent={LogSeparator}
      keyExtractor={(log) => String(log.id)}
      ListEmptyComponent={!isLoading ? <StatePanel message="저장된 전투 기록이 없습니다." /> : null}
      ListFooterComponent={isLoadingMore ? <ActivityIndicator color={theme.colors.accentGreen} /> : null}
      ListHeaderComponent={header}
      onEndReached={() => { void loadMore(); }}
      onEndReachedThreshold={0.35}
      renderItem={({ item }) => <BattleLogCard log={item} onOpenDetail={() => setDetailLog(item)} />}
      style={styles.list}
    />
  );
}

/** 전투 결과, 맵, 파티, Funds와 저장된 Show Detail URL을 표시한다. */
function BattleLogCard({ log, onOpenDetail }: { log: BattleLogResponse; onOpenDetail: () => void }) {
  const [copied, setCopied] = useState(false);
  const detailUrl = safeHttpUrl(log.rawLogUrl);
  const copyLink = useCallback(async () => {
    if (!log.rawLogUrl) return;
    await Clipboard.setStringAsync(log.rawLogUrl);
    setCopied(true);
  }, [log.rawLogUrl]);

  return (
    <View style={styles.logCard}>
      <View style={styles.logHeader}>
        <Text style={outcomeTextStyle(log.outcome)}>{formatBattleOutcome(log.outcome)}</Text>
        <Text style={styles.logTime}>{formatBattleLogTime(log.createdAt)}</Text>
      </View>
      <Text style={styles.logTitle} numberOfLines={2}>{formatBattleLogMap(log)}</Text>
      <Text style={styles.logMeta} numberOfLines={2}>{formatBattleLogParty(log)}</Text>
      <Text style={styles.logText}>{formatBattleLogFunds(log)}</Text>
      {log.quest ? <Text style={styles.questText} numberOfLines={2}>{log.quest}</Text> : null}
      {detailUrl ? (
        <View style={styles.linkPanel}>
          <Text selectable style={styles.linkText} numberOfLines={2}>{log.rawLogUrl}</Text>
          <View style={styles.linkActions}>
            <PrimaryButton label="상세 보기" onPress={onOpenDetail} style={styles.linkButton} />
            <PrimaryButton
              label={copied ? '복사됨' : '링크 복사'}
              variant="secondary"
              onPress={() => { void copyLink(); }}
              style={styles.linkButton}
            />
          </View>
        </View>
      ) : (
        <Text style={styles.noLinkText}>Show Detail 링크 없음</Text>
      )}
    </View>
  );
}

function outcomeTextStyle(outcome: string) {
  if (outcome === 'DEFEAT') return [styles.logOutcome, styles.defeatText];
  if (outcome === 'DRAW') return [styles.logOutcome, styles.drawText];
  return styles.logOutcome;
}

function formatFunds(value: number): string {
  return `$ ${value.toLocaleString('en-US')}`;
}

/** WebView에는 네트워크 URL만 전달하고 다른 scheme은 복사 전용으로 남긴다. */
function safeHttpUrl(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <View style={styles.statePanel}>
      <ActivityIndicator color={theme.colors.accentGreen} />
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );
}

function StatePanel({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <View style={styles.statePanel}>
      <Text style={error ? styles.errorText : styles.stateText}>{message}</Text>
    </View>
  );
}

function LogSeparator() {
  return <View style={styles.logSeparator} />;
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  container: { gap: theme.spacing.lg, padding: theme.spacing.lg, paddingBottom: theme.spacing.xl },
  header: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '900' },
  logScreenTitle: { flex: 1, color: theme.colors.text, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  compactButton: { minHeight: 36, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  statePanel: {
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  stateText: { color: theme.colors.textMuted, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  errorText: { color: theme.colors.danger, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  statsStack: { gap: theme.spacing.lg },
  fundsGrid: { gap: theme.spacing.sm },
  statCard: {
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  statLabelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.spacing.sm },
  statLabel: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '800' },
  statHint: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' },
  statValue: { color: theme.colors.accentAmber, fontSize: 22, fontWeight: '900' },
  outcomePanel: {
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  sectionTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  description: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  mapSection: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  mapSectionTitle: { color: theme.colors.accentBlue, fontSize: 14, fontWeight: '900' },
  mapRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.sm,
  },
  mapName: { flex: 1, color: theme.colors.text, fontSize: 13, fontWeight: '800', lineHeight: 18 },
  mapCount: { color: theme.colors.accentBlue, fontSize: 13, fontWeight: '900' },
  emptyInline: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  defeatText: { color: theme.colors.danger },
  drawText: { color: theme.colors.accentBlue },
  logLaunchCard: {
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  logLaunchCopy: { gap: theme.spacing.xs },
  logScreenHeaderStack: { gap: theme.spacing.md, marginBottom: theme.spacing.lg },
  logListContainer: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xl },
  filterRow: { flexDirection: 'row', gap: theme.spacing.xs },
  filterButton: {
    minHeight: 38,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
  },
  filterButtonActive: { borderColor: theme.colors.accentGreen, backgroundColor: theme.colors.surfaceAlt },
  filterLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800' },
  filterLabelActive: { color: theme.colors.accentGreen },
  logSeparator: { height: theme.spacing.sm },
  logCard: {
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  logHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
  logOutcome: { color: theme.colors.accentAmber, fontSize: 15, fontWeight: '900' },
  logTime: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800' },
  logTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '900', lineHeight: 18 },
  logMeta: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  logText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  questText: { color: theme.colors.accentBlue, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  linkPanel: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  linkActions: { flexDirection: 'row', gap: theme.spacing.sm },
  linkText: { color: theme.colors.accentBlue, fontSize: 11, fontWeight: '700', lineHeight: 16 },
  noLinkText: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700', marginTop: theme.spacing.xs },
  linkButton: { minHeight: 34, flex: 1, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
});
