import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  findNodeHandle,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PartyPresetPickerModal } from '../../../components/PartyPresetPickerModal';
import { theme } from '../../../styles/theme';
import type { HofCharacter, PartyPresetCatalogResponse, PartyPresetResponse } from '../../../types/api';

export type PartySelectionMode = 'preset' | 'direct' | null;

export type BattlePartyPresetPickerProps = {
  characters: HofCharacter[];
  catalog: PartyPresetCatalogResponse;
  loading: boolean;
  errorMessage: string | null;
  selectedMode: PartySelectionMode;
  selectedPresetId: number | null;
  onRetry: () => void;
  onSelectDirect: () => void;
  onSelectPreset: (preset: PartyPresetResponse) => void;
};

/** 전투용 요약 필드와 화면 전용 직접 선택을 공통 프리셋 모달에 연결한다. */
export function BattlePartyPresetPicker({
  catalog,
  loading,
  errorMessage,
  selectedMode,
  selectedPresetId,
  onRetry,
  onSelectDirect,
  onSelectPreset,
}: BattlePartyPresetPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<ElementRef<typeof Pressable>>(null);
  const mountedRef = useRef(false);
  const loadingRef = useRef(loading);
  const expandedRef = useRef(false);
  const invokingTriggerHandleRef = useRef<ReturnType<typeof findNodeHandle>>(null);
  const focusGenerationRef = useRef(0);
  const restoreFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  loadingRef.current = loading;
  const selectedPreset = useMemo(
    () => catalog.presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [catalog.presets, selectedPresetId],
  );
  const selectedLabel = selectedMode === 'direct'
    ? '캐릭터 직접 선택'
    : selectedMode === 'preset' && selectedPresetId != null
      ? selectedPreset?.name ?? `삭제된 프리셋 #${selectedPresetId}`
      : '프리셋을 선택하세요';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      focusGenerationRef.current += 1;
      invokingTriggerHandleRef.current = null;
      if (restoreFocusTimerRef.current != null) clearTimeout(restoreFocusTimerRef.current);
    };
  }, []);

  const closePicker = useCallback((restoreFocus: boolean) => {
    const generation = ++focusGenerationRef.current;
    const invocationHandle = invokingTriggerHandleRef.current;
    expandedRef.current = false;
    setExpanded(false);
    if (restoreFocusTimerRef.current != null) {
      clearTimeout(restoreFocusTimerRef.current);
      restoreFocusTimerRef.current = null;
    }
    if (!restoreFocus || invocationHandle == null) {
      invokingTriggerHandleRef.current = null;
      return;
    }
    restoreFocusTimerRef.current = setTimeout(() => {
      restoreFocusTimerRef.current = null;
      if (
        !mountedRef.current
        || loadingRef.current
        || expandedRef.current
        || focusGenerationRef.current !== generation
      ) return;
      const liveHandle = findNodeHandle(triggerRef.current);
      if (liveHandle != null && liveHandle === invocationHandle) {
        AccessibilityInfo.setAccessibilityFocus(liveHandle);
      }
      if (invokingTriggerHandleRef.current === invocationHandle) {
        invokingTriggerHandleRef.current = null;
      }
    }, 250);
  }, []);
  const handleOpen = useCallback(() => {
    if (loadingRef.current) return;
    focusGenerationRef.current += 1;
    if (restoreFocusTimerRef.current != null) {
      clearTimeout(restoreFocusTimerRef.current);
      restoreFocusTimerRef.current = null;
    }
    invokingTriggerHandleRef.current = findNodeHandle(triggerRef.current);
    expandedRef.current = true;
    setExpanded(true);
  }, []);
  const handleClose = useCallback(() => closePicker(true), [closePicker]);
  const handleSelectPreset = useCallback((preset: PartyPresetResponse) => {
    if (loadingRef.current) return;
    onSelectPreset(preset);
    closePicker(true);
  }, [closePicker, onSelectPreset]);
  const handleSelectDirect = useCallback(() => {
    if (loadingRef.current) return;
    onSelectDirect();
    closePicker(true);
  }, [closePicker, onSelectDirect]);
  const syntheticOptions = useMemo(() => [{
    key: 'direct',
    label: '캐릭터 직접 선택',
    description: '프리셋 없이 캐릭터 5명과 패턴 지정',
    selected: selectedMode === 'direct',
    onSelect: handleSelectDirect,
  }], [handleSelectDirect, selectedMode]);

  return (
    <View style={styles.root}>
      <Pressable
        ref={triggerRef}
        accessibilityLabel="전투 파티 프리셋 선택"
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: loading }}
        disabled={loading}
        onPress={handleOpen}
        style={({ pressed }) => [styles.field, loading ? styles.disabled : null, pressed && !loading ? styles.pressed : null]}
      >
        <Text numberOfLines={1} style={styles.fieldText}>{selectedLabel}</Text>
        {expanded
          ? <ChevronUp color={theme.colors.textMuted} size={18} />
          : <ChevronDown color={theme.colors.textMuted} size={18} />}
      </Pressable>

      {loading ? (
        <View accessibilityLabel="프리셋을 불러오는 중" accessibilityLiveRegion="polite" style={styles.stateRow}>
          <ActivityIndicator color={theme.colors.accentGreen} size="small" />
          <Text style={styles.stateText}>프리셋을 불러오는 중</Text>
        </View>
      ) : null}
      {errorMessage != null ? (
        <View accessibilityRole="alert" style={styles.errorRow}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable accessibilityLabel="프리셋 다시 시도" accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}
      {!loading && errorMessage == null && catalog.presets.length === 0 ? (
        <Text style={styles.emptyText}>저장된 프리셋이 없습니다.</Text>
      ) : null}

      <PartyPresetPickerModal
        busyMessage={loading ? '프리셋을 새로 고치는 중' : undefined}
        catalog={catalog}
        disabled={loading}
        initialExpandedPath={[null]}
        onClose={handleClose}
        onSelectPreset={handleSelectPreset}
        selectedPresetId={selectedPresetId}
        syntheticOptions={syntheticOptions}
        title="전투 파티 프리셋 선택"
        visible={expanded}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: theme.spacing.sm },
  field: {
    alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
    borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm,
    justifyContent: 'space-between', minHeight: 44, paddingHorizontal: theme.spacing.md,
  },
  fieldText: { color: theme.colors.text, flex: 1, fontSize: 14, fontWeight: '900', minWidth: 0 },
  stateRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 36, paddingHorizontal: theme.spacing.sm },
  stateText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '800' },
  errorRow: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.danger, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.sm },
  errorText: { color: theme.colors.danger, flex: 1, fontSize: 13, fontWeight: '800' },
  retryButton: { borderColor: theme.colors.danger, borderRadius: theme.radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: 34, paddingHorizontal: theme.spacing.md },
  retryText: { color: theme.colors.danger, fontSize: 12, fontWeight: '900' },
  emptyText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.82 },
});
