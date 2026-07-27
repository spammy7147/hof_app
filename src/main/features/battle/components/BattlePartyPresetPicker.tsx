import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PartyPresetPickerModal } from '../../../components/PartyPresetPickerModal';
import { theme } from '../../../styles/theme';
import type { HofCharacter, PartyPresetResponse } from '../../../types/api';

export type PartySelectionMode = 'preset' | 'direct' | null;

export type BattlePartyPresetPickerProps = {
  characters: HofCharacter[];
  presets: PartyPresetResponse[];
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
  presets,
  loading,
  errorMessage,
  selectedMode,
  selectedPresetId,
  onRetry,
  onSelectDirect,
  onSelectPreset,
}: BattlePartyPresetPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  );
  const catalog = useMemo(() => ({ folders: [], presets }), [presets]);
  const selectedLabel = selectedMode === 'direct'
    ? '캐릭터 직접 선택'
    : selectedPreset?.name ?? '프리셋을 선택하세요';

  const handleOpen = useCallback(() => setExpanded(true), []);
  const handleClose = useCallback(() => setExpanded(false), []);
  const handleSelectPreset = useCallback((preset: PartyPresetResponse) => {
    onSelectPreset(preset);
    setExpanded(false);
  }, [onSelectPreset]);
  const handleSelectDirect = useCallback(() => {
    onSelectDirect();
    setExpanded(false);
  }, [onSelectDirect]);
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
      {!loading && errorMessage == null && presets.length === 0 ? (
        <Text style={styles.emptyText}>저장된 프리셋이 없습니다.</Text>
      ) : null}

      <PartyPresetPickerModal
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
