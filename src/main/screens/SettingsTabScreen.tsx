import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { theme } from '../styles/theme';
import {
  describeCaptchaPassMaintenance,
  formatPassTimestamp,
} from '../domain/captchaPassMaintenance';
import type { CaptchaPassResource } from '../features/captcha/useCaptchaPassMaintenance';
type SettingsTabScreenProps = {
  authenticated: boolean;
  onBack: () => void;
  onLogout: () => void;
  onOpenCaptcha: () => void;
  passMaintenance?: CaptchaPassResource;
};

/**
 * 홈 상단에서 여는 앱 설정 화면이다.
 *
 * 수동 캡차 확인과 로그아웃 동작을 제공한다.
 */
export function SettingsTabScreen({
  authenticated,
  onBack,
  onLogout,
  onOpenCaptcha,
  passMaintenance: pass,
}: SettingsTabScreenProps) {
  const passMaintenance = pass?.state ?? null;
  const passMaintenanceBusy = pass?.busy ?? false;
  const passMaintenanceError = pass?.errorMessage ?? null;
  const onRefreshPassMaintenance = pass?.refresh;
  const onTogglePassMaintenance = pass?.updateEnabled;
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    if (passMaintenance?.passState !== 'VALID' || passMaintenance.validUntil == null) return undefined;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [passMaintenance?.passState, passMaintenance?.validUntil]);
  const passDescription = passMaintenance == null
    ? null
    : describeCaptchaPassMaintenance(passMaintenance, nowMs);
  const manualAvailable = pass?.manualAvailable ?? false;
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="홈으로 돌아가기"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <ArrowLeft color={theme.colors.text} size={22} />
        </Pressable>
        <Text style={styles.title}>설정</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.panel}>
        <View style={styles.panelTitleRow}>
          <View style={styles.panelTitleCopy}>
            <Text style={styles.panelTitle}>통행증 자동 갱신</Text>
            <Text style={styles.mutedText}>전투와 별개로 만료 시각 뒤 서버에서 갱신합니다.</Text>
          </View>
          <Switch
            accessibilityLabel="통행증 자동 갱신"
            disabled={!authenticated || passMaintenanceBusy || passMaintenance == null}
            onValueChange={(enabled) => { void onTogglePassMaintenance?.(enabled).catch(() => undefined); }}
            value={passMaintenance?.enabled ?? true}
          />
        </View>
        <View style={styles.panelBody}>
          <StatusRow label="정책" value={passDescription?.policyLabel ?? '불러오는 중'} />
          <StatusRow label="유지 상태" value={passDescription?.lifecycleLabel ?? '상태 미확인'} />
          <StatusRow label="통행증" value={passDescription?.stateLabel ?? '미확인'} />
          <StatusRow label="남은 시간" value={passDescription?.remainingLabel ?? '확인되지 않음'} />
          <StatusRow label="다음 갱신" value={formatPassTimestamp(passMaintenance?.nextRefreshAt ?? null)} />
          <StatusRow label="최근 결과" value={passDescription?.lastResultLabel ?? '기록 없음'} />
          <StatusRow label="최근 관측" value={formatPassTimestamp(passMaintenance?.observedAt ?? null)} />
          {passMaintenanceError ? <Text accessibilityRole="alert" style={styles.errorText}>{passMaintenanceError}</Text> : null}
          {!authenticated ? <Text style={styles.mutedText}>로그인이 필요합니다.</Text> : null}
          <View style={styles.actionRow}>
            <PrimaryButton
              label="상태 새로고침"
              variant="secondary"
              disabled={!authenticated || passMaintenanceBusy}
              onPress={() => { void onRefreshPassMaintenance?.().catch(() => undefined); }}
              style={styles.captchaButton}
            />
            <PrimaryButton
              label="직접 인증"
              variant="secondary"
              disabled={!authenticated || passMaintenanceBusy || !manualAvailable}
              onPress={onOpenCaptcha}
              style={styles.captchaButton}
            />
          </View>
        </View>
      </View>

      <PrimaryButton label="로그아웃" variant="secondary" onPress={onLogout} />
    </View>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={styles.statusValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.lg,
  },
  header: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  title: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  headerSpacer: {
    width: 44,
  },
  pressed: {
    backgroundColor: theme.colors.surfaceAlt,
  },
  panel: {
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  panelTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  panelTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
    justifyContent: 'space-between',
  },
  panelTitleCopy: {
    flex: 1,
    gap: 4,
  },
  panelBody: {
    gap: theme.spacing.sm,
  },
  mutedText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  captchaButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  statusRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: theme.spacing.md,
    justifyContent: 'space-between',
  },
  statusLabel: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  statusValue: {
    color: theme.colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'right',
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
});
