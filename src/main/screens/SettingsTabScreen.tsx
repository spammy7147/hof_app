import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { theme } from '../styles/theme';
type SettingsTabScreenProps = {
  authenticated: boolean;
  onLogout: () => void;
  onOpenCaptcha: () => void;
};

/**
 * 설정 탭 화면이다.
 *
 * 수동 캡차 확인과 로그아웃 동작을 제공한다.
 */
export function SettingsTabScreen({
  authenticated,
  onLogout,
  onOpenCaptcha,
}: SettingsTabScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>설정</Text>
      </View>

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
