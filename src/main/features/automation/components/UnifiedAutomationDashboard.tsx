import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, History, Pause, Play, RotateCcw, Settings, Square } from 'lucide-react-native';

import { formatAdventureDailyRefresh } from '../../../domain/adventureMapAutomation';
import { AUTOMATION_TYPE_METADATA } from '../../../domain/typedAutomation';
import { theme } from '../../../styles/theme';
import type {
  TypedAutomationAggregateResponse,
  AutomationType,
  TypedAutomationCurrentActionResponse,
  TypedAutomationEntryResponse,
  UnifiedAutomationAction,
} from '../../../types/api';

type Props = {
  aggregate: TypedAutomationAggregateResponse;
  busy: boolean;
  onChangeState: (action: UnifiedAutomationAction) => void;
  onOpenSettings: () => void;
  onOpenModule: (entryId: number) => void;
  onOpenCaptcha: () => void;
  onOpenHistory?: () => void;
  nowMs?: number;
};

export function hofRetryMessage(nextAttemptAt: string | null, nowMs = Date.now()): string {
  const retryAtMs = nextAttemptAt == null ? Number.NaN : Date.parse(nextAttemptAt);
  const remainingMs = retryAtMs - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return 'HOF 서버 연결이 원활하지 않습니다. 곧 자동으로 다시 시도합니다.';
  }
  const remainingSeconds = Math.ceil(remainingMs / 1_000);
  const delay = remainingSeconds < 60
    ? `${remainingSeconds}초`
    : `${Math.ceil(remainingSeconds / 60)}분`;
  return `HOF 서버 연결이 원활하지 않습니다. ${delay} 후 자동으로 다시 시도합니다.`;
}

function retryDelay(nextAttemptAt: string | null, nowMs = Date.now()): string {
  const retryAtMs = nextAttemptAt == null ? Number.NaN : Date.parse(nextAttemptAt);
  const remainingMs = retryAtMs - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '곧';
  const remainingSeconds = Math.ceil(remainingMs / 1_000);
  return remainingSeconds < 60 ? `${remainingSeconds}초 후` : `${Math.ceil(remainingSeconds / 60)}분 후`;
}

/** Typed automation aggregate만 사용해 실행/중지/설정 상태를 한 화면에 분리해 표시한다. */
export function UnifiedAutomationDashboard({
  aggregate,
  busy,
  onChangeState,
  onOpenSettings,
  onOpenModule,
  onOpenCaptcha,
  onOpenHistory,
  nowMs,
}: Props) {
  const { runtime } = aggregate;
  const current = runtime.currentAction;
  const running = runtime.lifecycle === 'RUNNING' || runtime.lifecycle === 'DRAINING';
  const paused = runtime.lifecycle === 'PAUSED';
  const stoppedWithReason = runtime.lifecycle === 'STOPPED' && runtime.stopReason != null;
  const waiting = running && current == null && runtime.nextAttemptAt != null;
  const automaticRetry = running && runtime.nextAttemptAt != null
    && runtime.stopReason != null && runtime.stopReason !== 'MANUAL_STOP';
  const networkRetry = automaticRetry && (runtime.stopReason === 'NETWORK' || runtime.stopReason === 'FATAL' || runtime.stopReason === 'UNKNOWN');
  const waitingCaptcha = automaticRetry && runtime.stopReason === 'CAPTCHA';
  const waitingLogin = automaticRetry && runtime.stopReason === 'AUTHENTICATION';
  const waitingForHof = waiting && !automaticRetry && runtime.waitReason === 'HOF_CONNECTION';
  const waitingForWork = waiting && !waitingForHof;
  const warningCount = new Set(runtime.warnings).size;

  return (
    <View style={styles.stack}>
      <View style={[styles.hero, (networkRetry || waitingCaptcha || waitingLogin || waitingForHof) && styles.warningHero]}>
        <View style={styles.heroHeader}>
          <View style={[styles.statusDot, networkRetry && styles.dangerDot, (waitingCaptcha || waitingLogin || waitingForHof) && styles.warningDot]} />
          <Text style={[styles.statusLabel, networkRetry && styles.dangerText, (waitingCaptcha || waitingLogin || waitingForHof) && styles.warningText]}>
            {statusLabel(aggregate)}
          </Text>
        </View>

        {networkRetry ? (
          <>
            <Text style={styles.stopTitle}>
              {runtime.stopReason === 'NETWORK'
                ? `네트워크 오류가 발생했습니다. ${retryDelay(runtime.nextAttemptAt, nowMs)} 자동으로 다시 시도합니다.`
                : `자동화 오류가 발생했습니다. ${retryDelay(runtime.nextAttemptAt, nowMs)} 자동으로 다시 시도합니다.`}
            </Text>
            {runtime.lastError ? <Text style={styles.stopReason}>{runtime.lastError}</Text> : null}
            {current ? <CurrentAction current={current} /> : null}
          </>
        ) : waitingCaptcha ? (
          <>
            <Text style={styles.stopTitle}>캡차 인증이 필요합니다. 해결될 때까지 자동으로 다시 확인합니다.</Text>
            <Pressable accessibilityLabel="캡차 인증 열기" accessibilityRole="button" onPress={onOpenCaptcha} style={styles.captchaButton}>
              <Text style={styles.captchaButtonText}>지금 인증하기</Text>
            </Pressable>
          </>
        ) : waitingLogin ? (
          <Text style={styles.stopTitle}>HOF 로그인이 필요합니다. 저장된 로그인 정보로 {retryDelay(runtime.nextAttemptAt, nowMs)} 다시 시도합니다.</Text>
        ) : waitingForHof ? (
          <Text style={styles.stopTitle}>{hofRetryMessage(runtime.nextAttemptAt, nowMs)}</Text>
        ) : waitingForWork ? (
          <Text style={styles.stopTitle}>현재 진행할 작업이 없습니다. 실행 가능한 작업이 생기면 자동으로 계속합니다.</Text>
        ) : (
          <>
            <Text style={styles.currentLabel}>현재 작업</Text>
            <CurrentAction current={current} />
          </>
        )}

        <View style={styles.runtimeMeta}>
          <Text style={styles.metaText}>오늘 모험맵 {formatAdventureDailyRefresh(runtime.dailyRefresh).replace(/^오늘 /, '')}</Text>
          <Text style={warningCount > 0 ? styles.warningText : styles.metaText}>설정 경고 {warningCount}개</Text>
        </View>
        {running && current != null ? <Text style={styles.reevaluate}>현재 행동이 끝나면 전체 우선순위를 다시 확인합니다.</Text> : null}
      </View>

      <View testID="automation-action-row" style={styles.actionRow}>
        {runtime.lifecycle === 'STOPPED' && !stoppedWithReason ? (
          <ActionButton disabled={busy} icon={Play} label="시작" onPress={() => onChangeState('start')} />
        ) : null}
        {running ? <ActionButton disabled={busy} icon={Pause} label="일시정지" onPress={() => onChangeState('pause')} /> : null}
        {paused ? <ActionButton disabled={busy} icon={RotateCcw} label="계속" onPress={() => onChangeState('resume')} /> : null}
        {stoppedWithReason && !waitingCaptcha && !waitingLogin ? (
          <ActionButton
            accessibilityLabel="중지된 자동화 재개"
            disabled={busy || waitingCaptcha || waitingLogin}
            icon={RotateCcw}
            label="재개"
            onPress={() => onChangeState('resume')}
          />
        ) : null}
        {running || paused ? <ActionButton disabled={busy} icon={Square} label="정지" onPress={() => onChangeState('stop')} secondary /> : null}
        <ActionButton disabled={busy} icon={Settings} label="설정" onPress={onOpenSettings} secondary />
        <ActionButton disabled={busy} icon={History} label="기록" onPress={onOpenHistory ?? (() => undefined)} secondary />
      </View>
      {running || paused ? (
        <Text style={styles.controlHint}>
          일시정지는 현재 작업을 보존하고, 정지는 다음 시작 때 최신 상태부터 새로 판단합니다.
        </Text>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>자동화 구성</Text>
        {aggregate.entries.length === 0 ? <Text style={styles.emptyText}>자동화 구성을 추가해 주세요.</Text> : null}
        {aggregate.entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} onPress={() => onOpenModule(entry.id)} />
        ))}
      </View>
    </View>
  );
}

function CurrentAction({ current }: { current: TypedAutomationCurrentActionResponse | null }) {
  const nextWorkFallback = '다음 실행 작업을 확인하고 있어요';
  if (current == null) {
    return <Text style={styles.actionLabel}>{nextWorkFallback}</Text>;
  }

  const hasNamedContext = current.questName != null || current.missionLabel != null || current.mapName != null;
  const actionLabel = current.kind.includes('BATTLE') && !hasNamedContext
    ? '전투 진행 중'
    : current.actionLabel.trim() || nextWorkFallback;

  return (
    <View style={styles.currentAction}>
      <Text style={styles.actionLabel}>{actionLabel}</Text>
      {current.questName ? <Text style={styles.currentTitle}>{current.questName}</Text> : null}
      {current.missionLabel ? (
        <Text style={styles.actionMeta}>
          {current.missionLabel}
          {current.missionCurrent != null && current.missionRequired != null
            ? ` · ${current.missionCurrent}/${current.missionRequired}`
            : ''}
        </Text>
      ) : null}
      {current.mapName ? <Text style={styles.actionMeta}>{current.mapName}</Text> : null}
      {current.battleCount != null ? <Text style={styles.battleDetail}>{current.battleCount}회 전투 진행 중</Text> : null}
    </View>
  );
}

function automationTypeLabel(type: AutomationType): string {
  if (type === 'BATTLE_MAP') return '전투맵';
  if (type === 'ADVENTURE_MAP') return '모험맵';
  return AUTOMATION_TYPE_METADATA[type].label;
}

function EntryRow({ entry, onPress }: { entry: TypedAutomationEntryResponse; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`${automationTypeLabel(entry.type)} 설정 열기`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.summaryRow, pressed && styles.pressed]}
    >
      <View style={[styles.moduleDot, !entry.enabled && styles.moduleDotOff]} />
      <View style={styles.summaryCopy}>
        <Text style={styles.summaryTitle}>{automationTypeLabel(entry.type)}</Text>
        <Text style={entry.ready ? styles.summaryDetail : styles.warningText}>
          {entrySummary(entry)}
        </Text>
      </View>
      <ChevronRight color={theme.colors.textMuted} size={16} />
    </Pressable>
  );
}

type ActionButtonProps = {
  accessibilityLabel?: string;
  disabled: boolean;
  icon: typeof Play;
  label: string;
  onPress: () => void;
  secondary?: boolean;
};

function ActionButton({
  accessibilityLabel,
  disabled,
  icon: Icon,
  label,
  onPress,
  secondary = false,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        secondary && styles.secondaryButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Icon color={secondary ? theme.colors.text : theme.colors.buttonText} size={16} />
      <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1} style={[styles.actionText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

function statusLabel(aggregate: TypedAutomationAggregateResponse): string {
  const { runtime } = aggregate;
  const running = runtime.lifecycle === 'RUNNING' || runtime.lifecycle === 'DRAINING';
  const automaticRetry = running && runtime.nextAttemptAt != null
    && runtime.stopReason != null && runtime.stopReason !== 'MANUAL_STOP';
  const waiting = (runtime.lifecycle === 'RUNNING' || runtime.lifecycle === 'DRAINING')
    && runtime.currentAction == null
    && runtime.nextAttemptAt != null;
  if (automaticRetry && runtime.stopReason === 'AUTHENTICATION') return '로그인 재시도 대기';
  if (automaticRetry && runtime.stopReason === 'CAPTCHA') return '캡차 재확인 대기';
  if (automaticRetry) return '오류 재시도 대기';
  if (waiting && runtime.waitReason === 'HOF_CONNECTION') return 'HOF 서버 연결 대기 중';
  if (waiting) return '자동화 대기 중';
  if (runtime.lifecycle === 'RUNNING') return '실행 중';
  if (runtime.lifecycle === 'DRAINING') return '레이드 사이클 마무리 중';
  if (runtime.lifecycle === 'PAUSED') return '일시정지';
  if (runtime.stopReason === 'NETWORK' || runtime.stopReason === 'FATAL') return '완전 중지';
  if (runtime.stopReason === 'CAPTCHA') return '캡차 대기';
  if (runtime.stopReason === 'AUTHENTICATION') return '로그인 대기';
  if (runtime.stopReason != null) return '중지됨';
  return '시작 전';
}

function entrySummary(entry: TypedAutomationEntryResponse): string {
  if (!entry.enabled) return '사용 안 함';
  if (entry.warnings.length > 0) return entry.warnings[0] ?? '설정 확인 필요';
  if (entry.type === 'QUEST') return `퀘스트 ${entry.quests.filter(({ enabled }) => enabled).length}개`;
  if (entry.type === 'HOME_QUEST') return `자택 퀘스트 ${entry.homeQuests?.filter(({ enabled }) => enabled).length ?? 0}개`;
  if (entry.type === 'BATTLE_MAP') return `전투맵 ${entry.battleMaps.length}개`;
  if (entry.type === 'ADVENTURE_MAP') return `모험맵 ${entry.adventureMaps.length}개`;
  if (entry.type === 'RAID') return `레이드 ${entry.raidTargets?.length ?? 0}개 · 완료 후 다음 대상으로 순환`;
  if (entry.type === 'UNION') return `유니온 ${entry.unionMaps?.length ?? 0}개 · 공유 쿨다운마다 순환`;
  return `일일 낚시 · 전투 맵 ${entry.fishingMaps?.length ?? 0}개 · 미설정 맵은 대표 프리셋`;
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing.md },
  hero: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 7, padding: theme.spacing.lg },
  warningHero: { borderColor: theme.colors.accentAmber },
  heroHeader: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  statusDot: { backgroundColor: theme.colors.accentGreen, borderRadius: 4, height: 8, width: 8 },
  dangerDot: { backgroundColor: theme.colors.danger },
  warningDot: { backgroundColor: theme.colors.accentAmber },
  statusLabel: { color: theme.colors.accentGreen, fontSize: 13, fontWeight: '800' },
  dangerText: { color: theme.colors.danger },
  warningText: { color: theme.colors.accentAmber, fontSize: 12, fontWeight: '700' },
  currentLabel: { color: theme.colors.textMuted, fontSize: 12, marginTop: 5 },
  currentAction: { gap: 3 },
  actionLabel: { color: theme.colors.text, fontSize: 17, fontWeight: '900', lineHeight: 24 },
  currentTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '900', lineHeight: 27 },
  actionMeta: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  battleDetail: { color: theme.colors.accentBlue, fontSize: 13, fontWeight: '800' },
  stopTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '900', lineHeight: 24, marginTop: 5 },
  stopReason: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  runtimeMeta: { borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth, gap: 4, marginTop: 5, paddingTop: 9 },
  metaText: { color: theme.colors.textMuted, fontSize: 12 },
  reevaluate: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  captchaButton: { alignItems: 'center', backgroundColor: theme.colors.accentAmber, borderRadius: theme.radius.sm, marginTop: 8, padding: 11 },
  captchaButtonText: { color: theme.colors.buttonText, fontWeight: '800' },
  actionRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6, width: '100%' },
  actionButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.sm, flex: 1, flexDirection: 'row', gap: 4, justifyContent: 'center', minHeight: 42, minWidth: 0, paddingHorizontal: 6 },
  secondaryButton: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1 },
  actionText: { color: theme.colors.buttonText, fontSize: 14, fontWeight: '800' },
  controlHint: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  secondaryText: { color: theme.colors.text },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, padding: theme.spacing.md },
  sectionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '800', marginBottom: 3 },
  emptyText: { color: theme.colors.textMuted, fontSize: 13, paddingVertical: theme.spacing.md },
  summaryRow: { alignItems: 'center', borderBottomColor: theme.colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 57 },
  moduleDot: { backgroundColor: theme.colors.accentGreen, borderRadius: 4, height: 8, width: 8 },
  moduleDotOff: { backgroundColor: theme.colors.textMuted },
  summaryCopy: { flex: 1 },
  summaryTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  summaryDetail: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
});
