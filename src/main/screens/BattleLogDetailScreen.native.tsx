import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { PrimaryButton } from '../components/PrimaryButton';
import { theme } from '../styles/theme';
import type { BattleLogDetailScreenProps } from './BattleLogDetailScreen';

/** 패배 HTML 보관본 또는 공개 로그 URL을 앱 내부 WebView로 표시한다. */
export function BattleLogDetailScreen({ title, url, html, onBack }: BattleLogDetailScreenProps) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <PrimaryButton label="로그로" variant="secondary" onPress={onBack} style={styles.compactButton} />
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
      <WebView
        allowsBackForwardNavigationGestures
        mixedContentMode="always"
        originWhitelist={html ? ['about:*'] : ['http://*', 'https://*']}
        javaScriptEnabled={!html}
        onShouldStartLoadWithRequest={(request: ShouldStartLoadRequest) => !html || request.url === 'about:blank'}
        renderError={() => (
          <View style={styles.statePanel}>
            <Text style={styles.errorText}>원본 전투 로그를 열지 못했습니다.</Text>
          </View>
        )}
        renderLoading={() => (
          <View style={styles.statePanel}>
            <ActivityIndicator color={theme.colors.accentGreen} />
            <Text style={styles.stateText}>원본 전투 로그 불러오는 중</Text>
          </View>
        )}
        setSupportMultipleWindows={false}
        source={html ? { html } : { uri: url }}
        startInLoadingState
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: theme.spacing.md, paddingTop: theme.spacing.md },
  header: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
  },
  compactButton: { minHeight: 44, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  title: { flex: 1, color: theme.colors.text, fontSize: 17, fontWeight: '900' },
  webView: { flex: 1, backgroundColor: theme.colors.background },
  statePanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
  },
  stateText: { color: theme.colors.textMuted, fontSize: 14, fontWeight: '800' },
  errorText: { color: theme.colors.danger, fontSize: 14, fontWeight: '800', textAlign: 'center' },
});
