import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type { TownActionResultResponse, TownResultStatus } from '../../../types/api';
import { normalizeTownResult } from '../api/townApi';

type TownActionResultProps = {
  result: TownActionResultResponse;
  onRefresh?: () => void;
  showStatusLabel?: boolean;
  successNoticeTitle?: string;
};

/** backend가 추출한 문구와 item만 표시하며 HOF HTML을 받을 prop 자체를 제공하지 않는다. */
export function TownActionResult({ result, onRefresh, showStatusLabel = true, successNoticeTitle }: TownActionResultProps) {
  const displayResult = normalizeTownResult(result);
  const actionable = displayResult.status !== 'INFORMATIONAL';
  const [noticeVisible, setNoticeVisible] = useState(actionable);
  const emptyUnknown = displayResult.status === 'UNKNOWN'
    && displayResult.messages.length === 0
    && displayResult.items.length === 0;

  useEffect(() => {
    setNoticeVisible(actionable);
  }, [actionable, result]);

  if (actionable) {
    return (
      <Modal
        animationType="fade"
        onRequestClose={() => setNoticeVisible(false)}
        transparent
        visible={noticeVisible}
      >
        <View style={styles.modalRoot}>
          <View
            accessibilityLabel={noticeAccessibilityLabel(displayResult.status, successNoticeTitle)}
            accessibilityRole="alert"
            accessibilityViewIsModal
            style={[styles.notice, statusStyle(displayResult.status)]}
          >
            <View style={styles.noticeHeader}>
              <Text style={[styles.statusMark, statusTextStyle(displayResult.status)]}>
                {statusMark(displayResult.status)}
              </Text>
              <Text style={styles.noticeTitle}>{noticeTitle(displayResult.status, successNoticeTitle)}</Text>
            </View>
            <ScrollView contentContainerStyle={styles.noticeContent}>
              <ResultContent emptyUnknown={emptyUnknown} result={displayResult} />
            </ScrollView>
            <View style={styles.noticeActions}>
              {displayResult.refreshRequired && onRefresh ? (
                <Pressable
                  accessibilityLabel="마을 정보 새로고침"
                  accessibilityRole="button"
                  onPress={() => {
                    setNoticeVisible(false);
                    onRefresh();
                  }}
                  style={[styles.noticeButton, styles.secondaryButton]}
                >
                  <Text style={styles.secondaryButtonLabel}>새로고침</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityLabel="결과 확인"
                accessibilityRole="button"
                onPress={() => setNoticeVisible(false)}
                style={[styles.noticeButton, styles.confirmButton]}
              >
                <Text style={styles.confirmButtonLabel}>확인</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <View accessibilityLabel="인라인 작업 결과" accessibilityLiveRegion="polite" style={[styles.card, statusStyle(displayResult.status)]}>
      {showStatusLabel ? <Text style={styles.title}>{statusLabel(displayResult.status)}</Text> : null}
      <ResultContent emptyUnknown={emptyUnknown} result={displayResult} />
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

function ResultContent({ emptyUnknown, result }: { emptyUnknown: boolean; result: TownActionResultResponse }) {
  return <>
    {result.messages.map((message, index) => (
      <Text key={`${message}-${index}`} style={styles.message}>{message}</Text>
    ))}
    {result.items.map((item, index) => (
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
    {emptyUnknown ? <Text style={styles.message}>결과를 확인하지 못했습니다. 정보를 새로고침해 주세요.</Text> : null}
  </>;
}

function noticeTitle(status: TownResultStatus, successTitle?: string): string {
  if (status === 'SUCCESS') return successTitle ?? '작업 완료';
  if (status === 'FAILURE') return '작업 실패';
  return '결과 확인 필요';
}

function noticeAccessibilityLabel(status: TownResultStatus, successTitle?: string): string {
  if (status === 'SUCCESS') return `${successTitle ?? '작업 완료'} 알림`;
  if (status === 'FAILURE') return '작업 실패 알림';
  return '결과 확인 필요 알림';
}

function statusMark(status: TownResultStatus): string {
  if (status === 'SUCCESS') return '✓';
  if (status === 'FAILURE') return '!';
  return '?';
}

function statusTextStyle(status: TownResultStatus) {
  if (status === 'SUCCESS') return styles.successText;
  if (status === 'FAILURE') return styles.failureText;
  return styles.informationText;
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
  modalRoot: {
    alignItems: 'center',
    backgroundColor: theme.colors.overlay,
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  notice: {
    backgroundColor: theme.colors.surface,
    borderLeftWidth: 5,
    borderRadius: theme.radius.md,
    gap: theme.spacing.md,
    maxHeight: '80%',
    padding: theme.spacing.lg,
    width: '100%',
  },
  noticeHeader: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.md },
  statusMark: { fontSize: 30, fontWeight: '900', lineHeight: 34, textAlign: 'center', width: 36 },
  successText: { color: theme.colors.accentGreen },
  failureText: { color: theme.colors.danger },
  informationText: { color: theme.colors.accentBlue },
  noticeTitle: { color: theme.colors.text, flex: 1, fontSize: 22, fontWeight: '900' },
  noticeContent: { gap: theme.spacing.sm },
  noticeActions: { flexDirection: 'row', gap: theme.spacing.sm },
  noticeButton: { alignItems: 'center', borderRadius: theme.radius.md, flex: 1, justifyContent: 'center', minHeight: 52, paddingHorizontal: theme.spacing.md },
  confirmButton: { backgroundColor: theme.colors.accentGreen },
  confirmButtonLabel: { color: theme.colors.buttonText, fontSize: 16, fontWeight: '900' },
  secondaryButton: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderWidth: 1 },
  secondaryButtonLabel: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
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
