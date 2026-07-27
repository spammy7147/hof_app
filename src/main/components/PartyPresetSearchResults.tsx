import { Star } from 'lucide-react-native';
import { memo, useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PartyPresetSearchResult } from '../domain/partyPresetCatalog';
import { theme } from '../styles/theme';
import type { PartyPresetResponse } from '../types/api';

export type PartyPresetSearchResultsProps = {
  results: readonly PartyPresetSearchResult[];
  selectedPresetId: number | null;
  onSelectPreset: (preset: PartyPresetResponse) => void;
};

/** 현재 폴더 깊이와 무관한 전체 너비의 전역 프리셋 검색 결과다. */
export function PartyPresetSearchResults({
  results,
  selectedPresetId,
  onSelectPreset,
}: PartyPresetSearchResultsProps) {
  const renderResult = useCallback(({ item }: { item: PartyPresetSearchResult }) => (
    <PartyPresetRow
      depth={0}
      fullWidth
      path={item.path}
      preset={item.preset}
      selected={item.preset.id === selectedPresetId}
      testID="party-preset-search-result"
      onSelect={onSelectPreset}
    />
  ), [onSelectPreset, selectedPresetId]);

  return (
    <FlatList
      contentContainerStyle={styles.searchListContent}
      data={results}
      keyExtractor={presetSearchResultKeyExtractor}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={<PartyPresetSearchEmptyState />}
      renderItem={renderResult}
      style={styles.list}
    />
  );
}

type PartyPresetRowProps = {
  depth: number;
  fullWidth: boolean;
  path: string | null;
  preset: PartyPresetResponse;
  selected: boolean;
  testID: string;
  onSelect: (preset: PartyPresetResponse) => void;
};

export const PartyPresetRow = memo(function PartyPresetRow({
  depth,
  fullWidth,
  path,
  preset,
  selected,
  testID,
  onSelect,
}: PartyPresetRowProps) {
  const handlePress = useCallback(() => {
    onSelect(preset);
  }, [onSelect, preset]);
  const configuredMemberCount = countConfiguredMembers(preset);
  const testMetadata = { depth, fullWidth };

  return (
    <Pressable
      {...testMetadata}
      accessibilityLabel={`${preset.name}, 구성원 ${configuredMemberCount}명${preset.isPrimary ? ', 대표 프리셋' : ''}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.presetRow,
        fullWidth ? styles.fullWidth : depthStyles[Math.min(depth, depthStyles.length - 1)],
        selected ? styles.selected : null,
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <View style={styles.presetCopy}>
        <View style={styles.presetTitleRow}>
          <Text numberOfLines={1} style={styles.presetName}>{preset.name}</Text>
          {preset.isPrimary ? (
            <View accessibilityLabel="대표 프리셋" style={styles.primaryBadge}>
              <Star color={theme.colors.accentAmber} fill={theme.colors.accentAmber} size={13} />
              <Text style={styles.primaryText}>대표</Text>
            </View>
          ) : null}
        </View>
        {path != null ? <Text numberOfLines={1} style={styles.path}>{path}</Text> : null}
        <Text style={styles.memberCount}>구성원 {configuredMemberCount}명</Text>
      </View>
    </Pressable>
  );
});

function PartyPresetSearchEmptyState() {
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      <Text style={styles.emptyTitle}>일치하는 프리셋이 없습니다.</Text>
      <Text style={styles.emptyCopy}>다른 프리셋 이름으로 검색해 보세요.</Text>
    </View>
  );
}

function presetSearchResultKeyExtractor(result: PartyPresetSearchResult): string {
  return String(result.preset.id);
}

function countConfiguredMembers(preset: PartyPresetResponse): number {
  return preset.members.reduce(
    (count, member) => count + (member.characterId == null ? 0 : 1),
    0,
  );
}

const depthStyles = [
  { marginLeft: 0 },
  { marginLeft: theme.spacing.sm },
  { marginLeft: theme.spacing.md },
  { marginLeft: theme.spacing.lg },
  { marginLeft: theme.spacing.xl },
  { marginLeft: theme.spacing.xl + theme.spacing.sm },
] as const;

const styles = StyleSheet.create({
  list: { width: '100%' },
  searchListContent: { gap: theme.spacing.sm, width: '100%' },
  presetRow: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderCurve: 'continuous',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 58,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  fullWidth: { alignSelf: 'stretch', marginLeft: 0, width: '100%' },
  selected: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.accentGreen },
  pressed: { opacity: 0.82 },
  presetCopy: { gap: 2, minWidth: 0 },
  presetTitleRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  presetName: { color: theme.colors.text, flex: 1, fontSize: 14, fontWeight: '900' },
  primaryBadge: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  primaryText: { color: theme.colors.accentAmber, fontSize: 11, fontWeight: '900' },
  path: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  memberCount: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  emptyState: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderCurve: 'continuous',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing.xs,
    justifyContent: 'center',
    minHeight: 96,
    padding: theme.spacing.lg,
    width: '100%',
  },
  emptyTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  emptyCopy: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
});
