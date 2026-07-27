import { X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  findNodeHandle,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PartyPresetSearchResults } from './PartyPresetSearchResults';
import { PartyPresetTree, type PartyPresetExpandedPath } from './PartyPresetTree';
import { indexPartyPresetCatalog, searchPartyPresetCatalog } from '../domain/partyPresetCatalog';
import { theme } from '../styles/theme';
import type { PartyPresetCatalogResponse, PartyPresetResponse } from '../types/api';

export type PartyPresetPickerSyntheticOption = {
  key: string;
  accessibilityLabel?: string;
  label: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
};

export type PartyPresetPickerModalProps = {
  busyMessage?: string;
  catalog: PartyPresetCatalogResponse;
  disabled?: boolean;
  initialExpandedPath?: PartyPresetExpandedPath;
  onClose: () => void;
  onSelectPreset: (preset: PartyPresetResponse) => void;
  selectedPresetId: number | null;
  syntheticOptions?: readonly PartyPresetPickerSyntheticOption[];
  title: string;
  visible: boolean;
};

/** 모든 프리셋 선택 화면이 공유하는 읽기 전용 폴더 탐색 및 전역 검색 모달이다. */
export function PartyPresetPickerModal({
  busyMessage,
  catalog,
  disabled = false,
  initialExpandedPath = [],
  onClose,
  onSelectPreset,
  selectedPresetId,
  syntheticOptions = [],
  title,
  visible,
}: PartyPresetPickerModalProps) {
  const { bottom } = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [expandedPath, setExpandedPath] = useState<PartyPresetExpandedPath>(initialExpandedPath);
  const titleRef = useRef<ElementRef<typeof Text>>(null);
  const index = useMemo(() => indexPartyPresetCatalog(catalog), [catalog]);
  const searching = query.trim().length > 0;
  const results = useMemo(
    () => searching ? searchPartyPresetCatalog(index, query) : [],
    [index, query, searching],
  );

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const handleShow = useCallback(() => {
    const titleNode = findNodeHandle(titleRef.current);
    if (titleNode != null) AccessibilityInfo.setAccessibilityFocus(titleNode);
  }, []);
  const handleClose = useCallback(() => {
    if (disabled) return;
    setQuery('');
    onClose();
  }, [disabled, onClose]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleClose}
      onShow={handleShow}
      presentationStyle="formSheet"
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="프리셋 선택기 배경 닫기"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={handleClose}
          style={styles.backdrop}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
          pointerEvents="box-none"
          style={styles.keyboardAvoiding}
        >
          <View
            accessibilityLabel="파티 프리셋 선택기"
            accessibilityViewIsModal
            style={[styles.root, { paddingBottom: bottom }]}
          >
            <View style={styles.headingRow}>
              <Text ref={titleRef} accessible accessibilityRole="header" style={styles.title}>{title}</Text>
              <Pressable
                accessibilityLabel="프리셋 선택기 닫기"
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={handleClose}
                style={({ pressed }) => [styles.closeButton, pressed && !disabled ? styles.pressed : null]}
              >
                <X color={theme.colors.textMuted} size={20} />
                <Text style={styles.closeText}>닫기</Text>
              </Pressable>
            </View>

            {syntheticOptions.length > 0 ? (
              <View accessibilityLabel="특수 선택" style={styles.syntheticSection}>
                <Text style={styles.sectionLabel}>빠른 선택</Text>
                {syntheticOptions.map((option) => (
                  <SyntheticOptionRow disabled={disabled} key={option.key} option={option} />
                ))}
              </View>
            ) : null}

            <TextInput
              accessibilityLabel="프리셋 검색"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!disabled}
              onChangeText={setQuery}
              placeholder="프리셋 이름 검색"
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.searchInput, disabled ? styles.disabled : null]}
              value={query}
            />

            {busyMessage != null ? (
              <View accessibilityLabel={busyMessage} accessibilityLiveRegion="polite" style={styles.busyState}>
                <ActivityIndicator color={theme.colors.accentGreen} size="small" />
                <Text style={styles.busyText}>{busyMessage}</Text>
              </View>
            ) : null}

            <View style={styles.catalogArea}>
              {searching ? (
                <PartyPresetSearchResults
                  disabled={disabled}
                  emptyTitle="검색 결과가 없습니다"
                  onSelectPreset={onSelectPreset}
                  results={results}
                  selectedPresetId={selectedPresetId}
                  selectionLabels
                />
              ) : (
                <PartyPresetTree
                  disabled={disabled}
                  expandedPath={expandedPath}
                  index={index}
                  onExpandedPathChange={setExpandedPath}
                  onSelectPreset={onSelectPreset}
                  selectedPresetId={selectedPresetId}
                  selectionLabels
                />
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const SyntheticOptionRow = memo(function SyntheticOptionRow({
  disabled,
  option,
}: {
  disabled: boolean;
  option: PartyPresetPickerSyntheticOption;
}) {
  return (
    <Pressable
      accessibilityLabel={option.accessibilityLabel ?? `${option.label} 선택`}
      accessibilityRole="radio"
      accessibilityState={{ checked: option.selected, disabled }}
      disabled={disabled}
      onPress={option.onSelect}
      style={({ pressed }) => [
        styles.syntheticOption,
        option.selected ? styles.selected : null,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <Text numberOfLines={1} style={styles.syntheticLabel}>{option.label}</Text>
      {option.description != null ? (
        <Text numberOfLines={2} style={styles.syntheticDescription}>{option.description}</Text>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    backgroundColor: theme.colors.overlay,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  root: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.border,
    borderTopLeftRadius: theme.radius.md + 8,
    borderTopRightRadius: theme.radius.md + 8,
    borderWidth: 1,
    gap: theme.spacing.md,
    maxHeight: '84%',
    padding: theme.spacing.lg,
  },
  keyboardAvoiding: { flex: 1, justifyContent: 'flex-end' },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  title: { color: theme.colors.text, flex: 1, fontSize: 18, fontWeight: '900' },
  closeButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: theme.spacing.sm,
  },
  closeText: { color: theme.colors.text, fontSize: 13, fontWeight: '900' },
  syntheticSection: { gap: theme.spacing.xs },
  sectionLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '900' },
  syntheticOption: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderCurve: 'continuous',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  selected: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.accentGreen },
  syntheticLabel: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  syntheticDescription: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  searchInput: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.borderStrong,
    borderCurve: 'continuous',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '800',
    minHeight: 46,
    paddingHorizontal: theme.spacing.md,
  },
  busyState: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 32 },
  busyText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800' },
  catalogArea: { flex: 1, minHeight: 0, width: '100%' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.82 },
});
