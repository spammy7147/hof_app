import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { theme } from '../styles/theme';
import type { AutomationJobResponse } from '../types/api';

type SettingsTabScreenProps = {
  authenticated: boolean;
  onLogout: () => void;
  onOpenCaptcha: () => void;
  onLoadCurrentAutomationJob: () => Promise<AutomationJobResponse | null>;
};

/**
 * 설정 탭 화면이다.
 *
 * 현재 자동화 job 상태, 수동 캡차 확인, 로그아웃 동작을 제공한다.
 */
export function SettingsTabScreen({
  authenticated,
  onLogout,
  onOpenCaptcha,
  onLoadCurrentAutomationJob,
}: SettingsTabScreenProps) {
  const [automationJob, setAutomationJob] = useState<AutomationJobResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * 현재 계정의 자동화 job 상태를 새로 읽는다.
   */
  const load = useCallback(async () => {
    if (!authenticated) {
      setAutomationJob(null);
      setMessage('로그인 계정이 없습니다.');
      return;
    }

    setIsLoading(true);
    setMessage(null);
    try {
      const loadedAutomationJob = await onLoadCurrentAutomationJob();
      setAutomationJob(loadedAutomationJob);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '설정 상태를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [authenticated, onLoadCurrentAutomationJob]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>설정</Text>
        <PrimaryButton label="새로고침" variant="secondary" loading={isLoading} onPress={load} style={styles.smallButton} />
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>캡차 대기</Text>
        <View style={styles.panelBody}>
          <Text style={styles.mutedText}>
            전역 캡차 창에서 대기 중인 캡차를 확인하고 답안을 입력하세요.
          </Text>
          {!authenticated ? <Text style={styles.mutedText}>로그인이 필요합니다.</Text> : null}
          <PrimaryButton
            label="캡차 확인"
            variant="secondary"
            disabled={!authenticated}
            onPress={onOpenCaptcha}
            style={styles.captchaButton}
          />
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>자동화</Text>
        {automationJob ? (
          <View style={styles.panelBody}>
            <Text style={styles.primaryText}>자동전투 프로필 #{automationJob.profileId}</Text>
            <Text style={styles.mutedText}>상태: {automationJob.status}</Text>
            <Text style={styles.mutedText}>
              진행 단계: {automationJob.currentStepIndex.toLocaleString('en-US')}
            </Text>
            {automationJob.message ? <Text style={styles.mutedText}>{automationJob.message}</Text> : null}
          </View>
        ) : (
          <Text style={styles.mutedText}>진행 중인 자동화 job이 없습니다.</Text>
        )}
      </View>

      <PrimaryButton label="로그아웃" variant="secondary" onPress={onLogout} />
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
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  smallButton: {
    minHeight: 36,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  message: {
    color: theme.colors.accentAmber,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accentAmber,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    fontSize: 13,
    fontWeight: '800',
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
  panelBody: {
    gap: theme.spacing.sm,
  },
  primaryText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
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
});
