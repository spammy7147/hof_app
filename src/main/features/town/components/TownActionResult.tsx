import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type { TownActionResultResponse, TownResultStatus } from '../../../types/api';
import { normalizeTownResult } from '../api/townApi';

type TownActionResultProps = {
  result: TownActionResultResponse;
  onRefresh?: () => void;
};

/** backend가 추출한 문구와 item만 표시하며 HOF HTML을 받을 prop 자체를 제공하지 않는다. */
export function TownActionResult({ result, onRefresh }: TownActionResultProps) {
  const displayResult = normalizeTownResult(result);
  const emptyUnknown = displayResult.status === 'UNKNOWN'
    && displayResult.messages.length === 0
    && displayResult.items.length === 0;

  return (
    <View accessibilityLiveRegion="polite" style={[styles.card, statusStyle(displayResult.status)]}>
      <Text style={styles.title}>{statusLabel(displayResult.status)}</Text>
      {displayResult.messages.map((message, index) => (
        <Text key={`${message}-${index}`} style={styles.message}>{message}</Text>
      ))}
      {displayResult.items.map((item, index) => (
        <View key={`${item.name}-${index}`} style={styles.item}>
          {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.image} /> : null}
          <View style={styles.itemText}>
            <Text style={styles.itemName}>
              {`${item.name}${item.quantity !== null ? ` ×${item.quantity}` : ''}`}
            </Text>
            {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
          </View>
        </View>
      ))}
      {emptyUnknown ? (
        <Text style={styles.message}>결과를 확인하지 못했습니다. 정보를 새로고침해 주세요.</Text>
      ) : null}
      {displayResult.refreshRequired && onRefresh ? (
        <Pressable
          accessibilityLabel="마을 정보 새로고침"
          accessibilityRole="button"
          onPress={onRefresh}
          style={styles.refreshButton}
        >
          <Text style={styles.refreshLabel}>새로고침</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function statusLabel(status: TownResultStatus): string {
  if (status === 'SUCCESS') return '완료';
  if (status === 'FAILURE') return '실패';
  if (status === 'INFORMATIONAL') return '안내';
  return '결과 확인 필요';
}

function statusStyle(status: TownResultStatus) {
  if (status === 'SUCCESS') return styles.success;
  if (status === 'FAILURE') return styles.failure;
  return styles.informational;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderLeftWidth: 4,
    borderRadius: theme.radius.md,
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  success: { borderLeftColor: theme.colors.accentGreen },
  failure: { borderLeftColor: theme.colors.danger },
  informational: { borderLeftColor: theme.colors.accentBlue },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  message: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  item: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  image: { borderRadius: theme.radius.sm, height: 36, width: 36 },
  itemText: { flex: 1 },
  itemName: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  detail: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  refreshButton: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    marginTop: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  refreshLabel: { color: theme.colors.text, fontWeight: '700' },
});
