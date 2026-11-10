import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../styles/theme';

type PlaceholderTabScreenProps = {
  title: string;
  summary: string;
};

/**
 * 아직 상세 기능을 만들지 않은 탭에 임시 안내를 보여주는 화면이다.
 */
export function PlaceholderTabScreen({ title, summary }: PlaceholderTabScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.panel}>
        <Text style={styles.summary}>{summary}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.md,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.fontSize.title,
    fontWeight: '900',
  },
  panel: {
    minHeight: 78,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    justifyContent: 'center',
  },
  summary: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.body,
    lineHeight: theme.lineHeight.section,
    fontWeight: '700',
  },
});
