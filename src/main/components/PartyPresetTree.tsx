import { ChevronDown, ChevronRight, Folder } from 'lucide-react-native';
import { memo, useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PartyPresetRow } from './PartyPresetSearchResults';
import type { PartyPresetCatalogIndex } from '../domain/partyPresetCatalog';
import { theme } from '../styles/theme';
import type { PartyPresetResponse } from '../types/api';

export type PartyPresetExpandedPath = readonly (number | null)[];

export type PartyPresetTreeProps = {
  index: PartyPresetCatalogIndex;
  expandedPath: PartyPresetExpandedPath;
  selectedPresetId: number | null;
  onExpandedPathChange: (path: PartyPresetExpandedPath) => void;
  onSelectPreset: (preset: PartyPresetResponse) => void;
};

type FolderLevel = {
  depth: number;
  folderIds: readonly number[];
};

/** 하나의 확장 경로와 그 leaf 프리셋만 표시하는 읽기 전용 카탈로그 트리다. */
export function PartyPresetTree({
  index,
  expandedPath,
  selectedPresetId,
  onExpandedPathChange,
  onSelectPreset,
}: PartyPresetTreeProps) {
  const folderLevels = useMemo(
    () => buildVisibleFolderLevels(index, expandedPath),
    [expandedPath, index],
  );
  const expandedFolderId = expandedPath.length > 0
    ? expandedPath[expandedPath.length - 1] ?? null
    : undefined;
  const visiblePresets = useMemo(() => {
    if (expandedFolderId === undefined) return [];
    return (index.presetIdsByFolder.get(expandedFolderId) ?? []).flatMap((presetId) => {
      const preset = index.presetsById.get(presetId);
      return preset == null ? [] : [preset];
    });
  }, [expandedFolderId, index]);
  const presetDepth = expandedFolderId == null ? 1 : expandedPath.length;

  const handleToggleFolder = useCallback((folderId: number, depth: number) => {
    if (expandedPath[depth] === folderId) {
      onExpandedPathChange(expandedPath.slice(0, depth));
      return;
    }
    onExpandedPathChange([...expandedPath.slice(0, depth), folderId]);
  }, [expandedPath, onExpandedPathChange]);
  const handleToggleUnassigned = useCallback(() => {
    onExpandedPathChange(expandedPath.length === 1 && expandedPath[0] === null ? [] : [null]);
  }, [expandedPath, onExpandedPathChange]);
  const renderPreset = useCallback(({ item }: { item: PartyPresetResponse }) => (
    <PartyPresetRow
      depth={presetDepth}
      fullWidth
      path={null}
      preset={item}
      selected={item.id === selectedPresetId}
      testID="party-preset-row"
      onSelect={onSelectPreset}
    />
  ), [onSelectPreset, presetDepth, selectedPresetId]);

  return (
    <View style={styles.root}>
      <View style={styles.folderRows}>
        {folderLevels.map(({ depth, folderIds }) => (
          <View key={depth} style={styles.folderLevel}>
            {folderIds.map((folderId) => {
              const folder = index.foldersById.get(folderId);
              if (folder == null) return null;
              return (
                <PartyPresetFolderRow
                  key={folder.id}
                  depth={depth}
                  expanded={expandedPath[depth] === folder.id}
                  folderId={folder.id}
                  name={folder.name}
                  onToggle={handleToggleFolder}
                />
              );
            })}
            {depth === 0 ? (
              <PartyPresetUnassignedRow
                expanded={expandedPath.length === 1 && expandedPath[0] === null}
                onToggle={handleToggleUnassigned}
              />
            ) : null}
          </View>
        ))}
      </View>
      {expandedFolderId !== undefined ? (
        <FlatList
          contentContainerStyle={styles.presetListContent}
          data={visiblePresets}
          keyExtractor={presetKeyExtractor}
          renderItem={renderPreset}
          scrollEnabled={false}
          style={styles.presetList}
        />
      ) : null}
    </View>
  );
}

type PartyPresetFolderRowProps = {
  depth: number;
  expanded: boolean;
  folderId: number;
  name: string;
  onToggle: (folderId: number, depth: number) => void;
};

const PartyPresetFolderRow = memo(function PartyPresetFolderRow({
  depth,
  expanded,
  folderId,
  name,
  onToggle,
}: PartyPresetFolderRowProps) {
  const handlePress = useCallback(() => {
    onToggle(folderId, depth);
  }, [depth, folderId, onToggle]);

  return (
    <Pressable
      accessibilityLabel={`${name} 폴더 ${expanded ? '닫기' : '열기'}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.folderRow,
        depthStyles[Math.min(depth, depthStyles.length - 1)],
        expanded ? styles.folderRowExpanded : null,
        pressed ? styles.pressed : null,
      ]}
      testID="party-preset-folder-row"
    >
      <Folder color={expanded ? theme.colors.accentGreen : theme.colors.textMuted} size={16} />
      <Text numberOfLines={1} style={styles.folderName}>{name}</Text>
      {expanded
        ? <ChevronDown color={theme.colors.textMuted} size={17} />
        : <ChevronRight color={theme.colors.textMuted} size={17} />}
    </Pressable>
  );
});

const PartyPresetUnassignedRow = memo(function PartyPresetUnassignedRow({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`미지정 폴더 ${expanded ? '닫기' : '열기'}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.folderRow,
        expanded ? styles.folderRowExpanded : null,
        pressed ? styles.pressed : null,
      ]}
      testID="party-preset-unassigned-row"
    >
      <Folder color={expanded ? theme.colors.accentGreen : theme.colors.textMuted} size={16} />
      <Text numberOfLines={1} style={styles.folderName}>미지정</Text>
      {expanded
        ? <ChevronDown color={theme.colors.textMuted} size={17} />
        : <ChevronRight color={theme.colors.textMuted} size={17} />}
    </Pressable>
  );
});

function buildVisibleFolderLevels(
  index: PartyPresetCatalogIndex,
  expandedPath: PartyPresetExpandedPath,
): FolderLevel[] {
  const levels: FolderLevel[] = [{ depth: 0, folderIds: index.childFolderIdsByParent.get(null) ?? [] }];
  for (let depth = 0; depth < expandedPath.length; depth += 1) {
    const folderId = expandedPath[depth];
    if (folderId == null || !levels[depth]?.folderIds.includes(folderId)) break;
    const children = index.childFolderIdsByParent.get(folderId) ?? [];
    if (children.length > 0) levels.push({ depth: depth + 1, folderIds: children });
  }
  return levels;
}

function presetKeyExtractor(preset: PartyPresetResponse): string {
  return String(preset.id);
}

const depthStyles = [
  { marginLeft: 0 },
  { marginLeft: theme.spacing.sm },
  { marginLeft: theme.spacing.md },
  { marginLeft: theme.spacing.lg },
  { marginLeft: theme.spacing.xl },
] as const;

const styles = StyleSheet.create({
  root: { gap: theme.spacing.sm, width: '100%' },
  folderRows: { gap: theme.spacing.sm, width: '100%' },
  folderLevel: { gap: theme.spacing.sm, width: '100%' },
  folderRow: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderCurve: 'continuous',
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    minHeight: 42,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  folderRowExpanded: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong },
  folderName: { color: theme.colors.text, flex: 1, fontSize: 14, fontWeight: '900' },
  pressed: { opacity: 0.82 },
  presetList: { width: '100%' },
  presetListContent: { gap: theme.spacing.sm, width: '100%' },
});
