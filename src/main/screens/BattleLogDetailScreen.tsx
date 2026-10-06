import { Linking, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { theme } from '../styles/theme';

export type BattleLogDetailScreenProps = {
  title: string;
  url: string;
  html?: string;
  onBack: () => void;
};

/** 웹에서 HTML 보관본을 표시·다운로드하고 원본 링크는 새 창으로 연다. */
export function BattleLogDetailScreen({ title, url, html, onBack }: BattleLogDetailScreenProps) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <PrimaryButton label="로그로" variant="secondary" onPress={onBack} style={styles.compactButton} />
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
      {html ? <>
        <PrimaryButton label="HTML 저장" onPress={() => {
          const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = 'defeated-battle-log.html';
          link.click();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        }} />
        <iframe title="보관된 전투 HTML" sandbox="" srcDoc={html} style={{ flex: 1, width: '100%', border: 0, background: '#fff' }} />
      </> : <View style={styles.panel}>
        <Text style={styles.message}>웹에서는 원본 전투 로그를 새 창으로 엽니다.</Text>
        <PrimaryButton label="상세 보기" onPress={() => { void Linking.openURL(url); }} />
      </View>}
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
