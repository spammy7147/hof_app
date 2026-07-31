import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '../../../components/PrimaryButton';
import { theme } from '../../../styles/theme';

export type TownConfirmationDetail = { label: string; value: string; warning?: boolean };

type TownConfirmSheetProps = {
  visible: boolean;
  title: string;
  message?: string;
  details?: TownConfirmationDetail[];
  confirmLabel?: string;
  destructive?: boolean;
  submitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** 비용·재료·대상을 실행 직전에 다시 보여주는 공통 확인 sheet다. */
export function TownConfirmSheet({
  visible,
  title,
  message,
  details = [],
  confirmLabel = '실행',
  destructive = false,
  submitting = false,
  onConfirm,
  onCancel,
}: TownConfirmSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      animationType="slide"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View style={styles.root}>
        <Pressable accessibilityLabel="확인창 닫기" onPress={onCancel} style={styles.backdrop} />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { paddingBottom: theme.spacing.lg + insets.bottom }]}
          testID="town-confirm-sheet"
        >
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            style={styles.scroll}
            testID="town-confirm-scroll"
          >
            {message ? <Text style={styles.message}>{message}</Text> : null}
            {details.map((detail, index) => (
              <View key={`${detail.label}-${index}`} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{detail.label}</Text>
                <Text style={[styles.detailValue, detail.warning && styles.warning]}>{detail.value}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions} testID="town-confirm-actions">
            <PrimaryButton label="취소" onPress={onCancel} disabled={submitting} variant="secondary" style={styles.action} />
            <PrimaryButton
              label={confirmLabel}
              onPress={onConfirm}
              loading={submitting}
              variant={destructive ? 'danger' : 'primary'}
              style={styles.action}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: theme.colors.overlay },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.borderStrong,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    gap: theme.spacing.md,
    maxHeight: '85%',
    padding: theme.spacing.xl,
  },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
  message: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  detailRow: { flexDirection: 'row', gap: theme.spacing.md, justifyContent: 'space-between' },
  detailLabel: { color: theme.colors.textMuted, flex: 1 },
  detailValue: { color: theme.colors.text, flex: 2, fontWeight: '700', textAlign: 'right' },
  warning: { color: theme.colors.danger },
  scroll: { flexShrink: 1 },
  scrollContent: { gap: theme.spacing.md },
  actions: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  action: { flex: 1 },
});
