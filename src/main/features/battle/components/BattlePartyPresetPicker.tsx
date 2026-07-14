import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { displayCharacterName } from '../../../domain/characters';
import { filterPartyPresets, formatPartyPresetSummary } from '../../../domain/partyPresets';
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

/**
 * 전투에 사용할 저장 프리셋 또는 직접 선택 방식을 고르는 인라인 picker다.
 */
export function BattlePartyPresetPicker({
  characters,
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
  const [query, setQuery] = useState('');
  const filteredPresets = useMemo(
    () => filterPartyPresets(presets, characters, query),
    [characters, presets, query],
  );
  const charactersById = useMemo(
    () => new Map(characters.map((character) => [character.hofCharacterId, character])),
    [characters],
  );
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  );
  const selectedLabel = selectedMode === 'direct'
    ? '캐릭터 직접 선택'
    : selectedPreset?.name ?? '프리셋을 선택하세요';

  const handleToggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
  }, []);
  const handleSelectPreset = useCallback((preset: PartyPresetResponse) => {
    onSelectPreset(preset);
    setExpanded(false);
    setQuery('');
  }, [onSelectPreset]);
  const handleSelectDirect = useCallback(() => {
    onSelectDirect();
    setExpanded(false);
    setQuery('');
  }, [onSelectDirect]);
  const renderPreset = useCallback(({ item }: { item: PartyPresetResponse }) => (
    <PresetOption
      preset={item}
      selected={item.id === selectedPresetId}
      summary={formatPresetMembers(item, charactersById)}
      onSelect={handleSelectPreset}
    />
  ), [charactersById, handleSelectPreset, selectedPresetId]);

  const emptyMessage = query.trim().length > 0
    ? '일치하는 프리셋이 없습니다.'
    : '저장된 프리셋이 없습니다.';

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: loading }}
        disabled={loading}
        onPress={handleToggleExpanded}
        style={({ pressed }) => [
          styles.field,
          expanded && styles.fieldExpanded,
          loading && styles.disabled,
          pressed && !loading && styles.pressed,
        ]}
      >
        <Text style={styles.fieldText} numberOfLines={1}>{selectedLabel}</Text>
        {expanded ? (
          <ChevronUp color={theme.colors.textMuted} size={18} />
        ) : (
          <ChevronDown color={theme.colors.textMuted} size={18} />
        )}
      </Pressable>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={theme.colors.accentGreen} size="small" />
          <Text style={styles.stateText}>프리셋을 불러오는 중</Text>
        </View>
      ) : null}

      {errorMessage != null ? (
        <View style={styles.errorState}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}

      {expanded ? (
        <View style={styles.expandedArea}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="프리셋 이름 또는 캐릭터 검색"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.searchInput}
            value={query}
          />
          <FlatList
            contentContainerStyle={filteredPresets.length === 0 ? styles.emptyListContent : undefined}
            data={filteredPresets}
            keyExtractor={presetKeyExtractor}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={errorMessage == null ? (
              <Text style={styles.emptyText}>{emptyMessage}</Text>
            ) : null}
            nestedScrollEnabled
            renderItem={renderPreset}
            style={styles.presetList}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: selectedMode === 'direct' }}
            onPress={handleSelectDirect}
            style={({ pressed }) => [
              styles.directOption,
              selectedMode === 'direct' && styles.selectedOption,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.optionName}>캐릭터 직접 선택</Text>
            <Text style={styles.optionSummary}>프리셋 없이 캐릭터 5명과 패턴 지정</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

type PresetOptionProps = {
  preset: PartyPresetResponse;
  selected: boolean;
  summary: string;
  onSelect: (preset: PartyPresetResponse) => void;
};

const PresetOption = memo(function PresetOption({
  preset,
  selected,
  summary,
  onSelect,
}: PresetOptionProps) {
  const handlePress = useCallback(() => {
    onSelect(preset);
  }, [onSelect, preset]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selected }}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.presetOption,
        selected && styles.selectedOption,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.optionName} numberOfLines={1}>{preset.name}</Text>
      <Text style={styles.optionSummary} numberOfLines={2}>{summary}</Text>
    </Pressable>
  );
});

function formatPresetMembers(
  preset: PartyPresetResponse,
  charactersById: Map<string, HofCharacter>,
): string {
  const configuredMembers = preset.members.filter((member) => member.characterId != null);
  const resolvedNames = configuredMembers.flatMap((member) => {
    const character = member.characterId == null
      ? null
      : charactersById.get(member.characterId) ?? null;
    return character == null ? [] : [displayCharacterName(character)];
  });

  if (resolvedNames.length === 0) return formatPartyPresetSummary(preset);

  const unresolvedCount = configuredMembers.length - resolvedNames.length;
  return unresolvedCount > 0
    ? `${resolvedNames.join(' · ')} 외 ${unresolvedCount.toLocaleString('en-US')}명`
    : resolvedNames.join(' · ');
}

function presetKeyExtractor(preset: PartyPresetResponse): string {
  return String(preset.id);
}

const styles = StyleSheet.create({
  root: {
    gap: theme.spacing.sm,
  },
  field: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
  },
  fieldExpanded: {
    borderColor: theme.colors.accentGreen,
  },
  fieldText: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  loadingState: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
  },
  stateText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  errorState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
  },
  errorText: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.danger,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  retryButton: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
  },
  retryText: {
    color: theme.colors.danger,
    fontSize: 12,
    fontWeight: '900',
  },
  expandedArea: {
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.sm,
  },
  searchInput: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: theme.spacing.md,
  },
  presetList: {
    maxHeight: 240,
  },
  emptyListContent: {
    minHeight: 52,
    justifyContent: 'center',
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  presetOption: {
    minHeight: 54,
    justifyContent: 'center',
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  selectedOption: {
    borderColor: theme.colors.accentGreen,
    backgroundColor: theme.colors.surfaceAlt,
  },
  optionName: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  optionSummary: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  directOption: {
    minHeight: 56,
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.82,
  },
});
