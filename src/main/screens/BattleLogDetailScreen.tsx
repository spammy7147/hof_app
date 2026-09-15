import { Linking, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { theme } from '../styles/theme';

export type BattleLogDetailScreenProps = {
  title: string;
  url: string;
  onBack: () => void;
};

/** Web/테스트 환경에서는 새 브라우저 탭으로 원본 로그를 연다. */
export function BattleLogDetailScreen({ title, url, onBack }: BattleLogDetailScreenProps) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <PrimaryButton label="로그로" variant="secondary" onPress={onBack} style={styles.compactButton} />
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
      <View style={styles.panel}>
        <Text style={styles.message}>웹에서는 원본 전투 로그를 새 창으로 엽니다.</Text>
        <PrimaryButton label="상세 보기" onPress={() => { void Linking.openURL(url); }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: theme.spacing.md, padding: theme.spacing.lg },
  header: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  compactButton: { minHeight: 44, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  title: { flex: 1, color: theme.colors.text, fontSize: 17, fontWeight: '900' },
  panel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  message: { color: theme.colors.textMuted, fontSize: 14, fontWeight: '700', textAlign: 'center' },
});
