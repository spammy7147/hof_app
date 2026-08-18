import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { theme } from '../styles/theme';
type SettingsTabScreenProps = {
  authenticated: boolean;
  onBack: () => void;
  onLogout: () => void;
  onOpenCaptcha: () => void;
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
}: SettingsTabScreenProps) {
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
