import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Pause, Play, RotateCcw, Settings, Square } from 'lucide-react-native';

import { buildUnifiedModuleSummaries, formatUnifiedAutomationStatus } from '../../../domain/unifiedAutomation';
import { theme } from '../../../styles/theme';
import type { UnifiedAutomationAction, UnifiedAutomationStatusResponse } from '../../../types/api';

type Props = {
  automation: UnifiedAutomationStatusResponse;
  busy: boolean;
  onChangeState: (action: UnifiedAutomationAction) => void;
  onOpenSettings: () => void;
  onOpenCaptcha: () => void;
};

/** 통합 자동화의 현재 작업과 모듈 요약만 보여주는 컴팩트 홈 대시보드다. */
export function UnifiedAutomationDashboard({
  automation,
  busy,
  onChangeState,
  onOpenSettings,
  onOpenCaptcha,
}: Props) {
  const status = automation.job?.status ?? null;
  const statusLabel = formatUnifiedAutomationStatus(status);
  const running = status === 'RUNNING' || status === 'PENDING';
  const paused = status === 'PAUSED';
  const waitingCaptcha = status === 'WAITING_CAPTCHA';
  const summaries = buildUnifiedModuleSummaries(automation.modules);

  return (
    <View style={styles.stack}>
      <View style={[styles.hero, waitingCaptcha && styles.warningHero]}>
        <View style={styles.heroHeader}>
          <View style={styles.statusDot} />
          <Text style={styles.statusLabel}>{statusLabel}</Text>
        </View>
        <Text style={styles.currentLabel}>현재 작업</Text>
        <Text style={styles.currentTitle}>{automation.currentTitle ?? '실행할 작업을 확인하고 있어요'}</Text>
        {automation.nextRunAt ? <Text style={styles.nextRun}>다음 확인 {formatNextRun(automation.nextRunAt)}</Text> : null}
        {waitingCaptcha ? (
          <Pressable onPress={onOpenCaptcha} style={styles.captchaButton}>
            <Text style={styles.captchaButtonText}>지금 인증하기</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.actionRow}>
        {!running && !paused ? (
          <ActionButton disabled={busy} icon={Play} label="시작" onPress={() => onChangeState('start')} />
        ) : null}
        {running ? (
          <ActionButton disabled={busy} icon={Pause} label="일시정지" onPress={() => onChangeState('pause')} />
        ) : null}
        {paused ? (
          <ActionButton disabled={busy} icon={RotateCcw} label="계속" onPress={() => onChangeState('resume')} />
        ) : null}
        {automation.job ? (
          <ActionButton disabled={busy} icon={Square} label="종료" onPress={() => onChangeState('stop')} secondary />
        ) : null}
        <ActionButton disabled={busy} icon={Settings} label="설정" onPress={onOpenSettings} secondary />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>자동화 구성</Text>
        {summaries.length === 0 ? (
          <Text style={styles.emptyText}>자동화 구성을 추가해 주세요.</Text>
        ) : null}
        {summaries.map((summary) => (
          <View key={summary.id} style={styles.summaryRow}>
            <View style={[styles.moduleDot, !summary.enabled && styles.moduleDotOff]} />
            <View style={styles.summaryCopy}>
              <Text style={styles.summaryTitle}>{summary.title}</Text>
              <Text style={styles.summaryDetail}>{summary.detail}</Text>
            </View>
            <ChevronRight color={theme.colors.textMuted} size={16} />
          </View>
        ))}
      </View>
    </View>
  );
}

type ActionButtonProps = {
  disabled: boolean;
  icon: typeof Play;
  label: string;
  onPress: () => void;
  secondary?: boolean;
};

function ActionButton({ disabled, icon: Icon, label, onPress, secondary = false }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
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
      <Text style={[styles.actionText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

function formatNextRun(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing.md },
  hero: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 6, padding: theme.spacing.lg },
  warningHero: { borderColor: theme.colors.accentAmber },
  heroHeader: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  statusDot: { backgroundColor: theme.colors.accentGreen, borderRadius: 4, height: 8, width: 8 },
  statusLabel: { color: theme.colors.accentGreen, fontSize: 13, fontWeight: '700' },
  currentLabel: { color: theme.colors.textMuted, fontSize: 12, marginTop: 6 },
  currentTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '800', lineHeight: 27 },
  nextRun: { color: theme.colors.textMuted, fontSize: 13 },
  captchaButton: { alignItems: 'center', backgroundColor: theme.colors.accentAmber, borderRadius: theme.radius.sm, marginTop: 8, padding: 11 },
  captchaButtonText: { color: theme.colors.buttonText, fontWeight: '800' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  actionButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.sm, flexDirection: 'row', gap: 6, minHeight: 42, paddingHorizontal: 14 },
  secondaryButton: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1 },
  actionText: { color: theme.colors.buttonText, fontSize: 14, fontWeight: '800' },
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
