import { ChevronDown, ChevronRight, Folder } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PartyPresetRow } from './PartyPresetSearchResults';
import type { PartyPresetCatalogIndex } from '../domain/partyPresetCatalog';
import { theme } from '../styles/theme';
import type { PartyPresetResponse } from '../types/api';

export type PartyPresetExpandedPath = readonly (number | null)[];

export type PartyPresetTreeProps = {
  disabled?: boolean;
  selectionLabels?: boolean;
  index: PartyPresetCatalogIndex;
  expandedPath: PartyPresetExpandedPath;
  selectedPresetId: number | null;
  onExpandedPathChange: (path: PartyPresetExpandedPath) => void;
  onSelectPreset: (preset: PartyPresetResponse) => void;
};

type PartyPresetTreeRow =
  | { key: string; kind: 'folder'; depth: number; folderId: number; name: string; expanded: boolean }
  | { key: string; kind: 'unassigned'; expanded: boolean }
  | { key: string; kind: 'preset'; preset: PartyPresetResponse }
  | { key: string; kind: 'empty'; unassigned: boolean };

/** 하나의 확장 경로와 그 leaf 프리셋만 표시하는 읽기 전용 카탈로그 트리다. */
export function PartyPresetTree({
  disabled = false,
  selectionLabels = false,
  index,
  expandedPath,
  selectedPresetId,
  onExpandedPathChange,
  onSelectPreset,
}: PartyPresetTreeProps) {
  const validExpandedPath = useMemo(
    () => validateExpandedPath(index, expandedPath),
    [expandedPath, index],
  );
  const rows = useMemo(
    () => buildVisibleRows(index, validExpandedPath),
    [index, validExpandedPath],
  );

  useEffect(() => {
    if (!pathsEqual(expandedPath, validExpandedPath)) {
      onExpandedPathChange(validExpandedPath);
    }
  }, [expandedPath, onExpandedPathChange, validExpandedPath]);

  const handleToggleFolder = useCallback((folderId: number, depth: number) => {
    if (validExpandedPath[depth] === folderId) {
      onExpandedPathChange(validExpandedPath.slice(0, depth));
      return;
    }
    onExpandedPathChange([...validExpandedPath.slice(0, depth), folderId]);
  }, [onExpandedPathChange, validExpandedPath]);
  const handleToggleUnassigned = useCallback(() => {
    onExpandedPathChange(validExpandedPath.length === 1 && validExpandedPath[0] === null ? [] : [null]);
  }, [onExpandedPathChange, validExpandedPath]);
  const renderRow = useCallback(({ item }: { item: PartyPresetTreeRow }) => {
    switch (item.kind) {
      case 'folder':
        return (
          <PartyPresetFolderRow
            depth={item.depth}
            expanded={item.expanded}
            disabled={disabled}
            folderId={item.folderId}
            name={item.name}
            onToggle={handleToggleFolder}
          />
        );
      case 'unassigned':
        return <PartyPresetUnassignedRow disabled={disabled} expanded={item.expanded} onToggle={handleToggleUnassigned} />;
      case 'preset':
        return (
          <PartyPresetRow
            rowAccessibilityLabel={selectionLabels ? `${item.preset.name} 프리셋 선택` : undefined}
            selectionControl={selectionLabels}
            path={null}
            preset={item.preset}
            selected={item.preset.id === selectedPresetId}
            disabled={disabled}
            testID="party-preset-row"
            onSelect={onSelectPreset}
          />
        );
      case 'empty':
        return <PartyPresetBrowsingEmptyState unassigned={item.unassigned} />;
    }
  }, [disabled, handleToggleFolder, handleToggleUnassigned, onSelectPreset, selectedPresetId, selectionLabels]);

  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={rows}
      keyExtractor={treeRowKeyExtractor}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      renderItem={renderRow}
      style={styles.list}
      windowSize={7}
    />
  );
}

type PartyPresetFolderRowProps = {
  disabled: boolean;
  depth: number;
  expanded: boolean;
  folderId: number;
  name: string;
  onToggle: (folderId: number, depth: number) => void;
};

const PartyPresetFolderRow = memo(function PartyPresetFolderRow({
  depth,
  disabled,
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
      accessibilityState={{ expanded, ...(disabled ? { disabled: true } : {}) }}
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.folderRow,
        depthStyles[Math.min(depth, depthStyles.length - 1)],
        expanded ? styles.folderRowExpanded : null,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
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
  disabled,
  onToggle,
}: {
  expanded: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`미지정 폴더 ${expanded ? '닫기' : '열기'}`}
      accessibilityRole="button"
      accessibilityState={{ expanded, ...(disabled ? { disabled: true } : {}) }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.folderRow,
        expanded ? styles.folderRowExpanded : null,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
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

function PartyPresetBrowsingEmptyState({ unassigned }: { unassigned: boolean }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      <Text style={styles.emptyText}>
        {unassigned ? '미지정 프리셋이 없습니다.' : '이 폴더에 프리셋이 없습니다.'}
      </Text>
    </View>
  );
}

function validateExpandedPath(
  index: PartyPresetCatalogIndex,
  expandedPath: PartyPresetExpandedPath,
): PartyPresetExpandedPath {
  if (expandedPath[0] === null) return [null];
  const validPath: number[] = [];
  let parentFolderId: number | null = null;
  for (let depth = 0; depth < expandedPath.length && depth < 5; depth += 1) {
    const folderId = expandedPath[depth];
    if (folderId == null || !(index.childFolderIdsByParent.get(parentFolderId) ?? []).includes(folderId)) break;
    validPath.push(folderId);
    parentFolderId = folderId;
  }
  return validPath;
}

function buildVisibleRows(
  index: PartyPresetCatalogIndex,
  expandedPath: PartyPresetExpandedPath,
): PartyPresetTreeRow[] {
  const rows: PartyPresetTreeRow[] = [];
  let parentFolderId: number | null = null;

  for (let depth = 0; depth <= expandedPath.length; depth += 1) {
    const folderIds = index.childFolderIdsByParent.get(parentFolderId) ?? [];
    for (const folderId of folderIds) {
      const folder = index.foldersById.get(folderId);
      if (folder == null) continue;
      rows.push({
        key: `folder:${folder.id}`,
        kind: 'folder',
        depth,
        folderId: folder.id,
        name: folder.name,
        expanded: expandedPath[depth] === folder.id,
      });
    }
    if (depth === 0) {
      rows.push({
        key: 'folder:unassigned',
        kind: 'unassigned',
        expanded: expandedPath.length === 1 && expandedPath[0] === null,
      });
    }
    const expandedFolderId = expandedPath[depth];
    if (expandedFolderId == null) break;
    parentFolderId = expandedFolderId;
  }

  if (expandedPath.length === 0) return rows;
  const activeFolderId = expandedPath[expandedPath.length - 1] ?? null;
  let presetCount = 0;
  for (const presetId of index.presetIdsByFolder.get(activeFolderId) ?? []) {
    const preset = index.presetsById.get(presetId);
    if (preset == null) continue;
    rows.push({ key: `preset:${preset.id}`, kind: 'preset', preset });
    presetCount += 1;
  }
  if (presetCount === 0) {
    rows.push({ key: `empty:${activeFolderId ?? 'unassigned'}`, kind: 'empty', unassigned: activeFolderId == null });
  }
  return rows;
}

function pathsEqual(left: PartyPresetExpandedPath, right: PartyPresetExpandedPath): boolean {
  return left.length === right.length && left.every((folderId, index) => folderId === right[index]);
}

function treeRowKeyExtractor(row: PartyPresetTreeRow): string {
  return row.key;
}

const depthStyles = [
  { marginLeft: 0 },
  { marginLeft: theme.spacing.sm },
  { marginLeft: theme.spacing.md },
  { marginLeft: theme.spacing.lg },
  { marginLeft: theme.spacing.xl },
] as const;

const styles = StyleSheet.create({
  list: { flexShrink: 1, width: '100%' },
  listContent: { gap: theme.spacing.sm, width: '100%' },
  folderRow: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderCurve: 'continuous',
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  folderRowExpanded: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong },
  folderName: { color: theme.colors.text, flex: 1, fontSize: 14, fontWeight: '900' },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.5 },
  emptyState: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderCurve: 'continuous',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 64,
    padding: theme.spacing.md,
    width: '100%',
  },
  emptyText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '800', textAlign: 'center' },
});
