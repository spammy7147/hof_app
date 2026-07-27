import { ChevronDown, ChevronRight, Folder } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PartyPresetRow } from './PartyPresetSearchResults';
import {
  countPartyPresetsInFolderTree,
  type PartyPresetCatalogIndex,
} from '../domain/partyPresetCatalog';
import { theme } from '../styles/theme';
import type { PartyPresetResponse } from '../types/api';

export type PartyPresetExpandedPath = readonly (number | null)[];
export type PartyPresetExpandedFolderIds = ReadonlySet<number | null>;

type PartyPresetTreeBaseProps = {
  disabled?: boolean;
  selectionLabels?: boolean;
  showMemberCount?: boolean;
  index: PartyPresetCatalogIndex;
  selectedPresetId: number | null;
  onSelectPreset: (preset: PartyPresetResponse) => void;
};

export type PartyPresetTreeProps = PartyPresetTreeBaseProps & (
  | {
    expandedFolderIds: PartyPresetExpandedFolderIds;
    expandedPath?: never;
    onExpandedFolderIdsChange: (folderIds: PartyPresetExpandedFolderIds) => void;
    onExpandedPathChange?: never;
  }
  | {
    expandedFolderIds?: never;
    expandedPath: PartyPresetExpandedPath;
    onExpandedFolderIdsChange?: never;
    onExpandedPathChange: (path: PartyPresetExpandedPath) => void;
  }
);

type PartyPresetTreeRow =
  | { key: string; kind: 'folder'; count: number; depth: number; folderId: number; name: string; expanded: boolean }
  | { key: string; kind: 'unassigned'; count: number; expanded: boolean }
  | { key: string; kind: 'preset'; depth: number; preset: PartyPresetResponse }
  | { key: string; kind: 'empty'; depth: number; unassigned: boolean };

/** 여러 폴더를 독립적으로 확장할 수 있는 읽기 전용 카탈로그 트리다. */
export function PartyPresetTree({
  disabled = false,
  selectionLabels = false,
  showMemberCount = true,
  index,
  expandedFolderIds,
  expandedPath,
  selectedPresetId,
  onExpandedFolderIdsChange,
  onExpandedPathChange,
  onSelectPreset,
}: PartyPresetTreeProps) {
  const requestedExpandedFolderIds = useMemo<PartyPresetExpandedFolderIds>(
    () => expandedFolderIds ?? new Set(expandedPath ?? []),
    [expandedFolderIds, expandedPath],
  );
  const validExpandedFolderIds = useMemo(
    () => validateExpandedFolderIds(index, requestedExpandedFolderIds),
    [index, requestedExpandedFolderIds],
  );
  const rows = useMemo(
    () => buildVisibleRows(index, validExpandedFolderIds),
    [index, validExpandedFolderIds],
  );

  const notifyExpandedFolderIdsChange = useCallback((folderIds: PartyPresetExpandedFolderIds) => {
    if (expandedFolderIds != null) onExpandedFolderIdsChange?.(folderIds);
    else onExpandedPathChange?.([...folderIds]);
  }, [expandedFolderIds, onExpandedFolderIdsChange, onExpandedPathChange]);

  useEffect(() => {
    if (!setsEqual(requestedExpandedFolderIds, validExpandedFolderIds)) {
      notifyExpandedFolderIdsChange(validExpandedFolderIds);
    }
  }, [notifyExpandedFolderIdsChange, requestedExpandedFolderIds, validExpandedFolderIds]);

  const handleToggleFolder = useCallback((folderId: number) => {
    const nextFolderIds = new Set(validExpandedFolderIds);
    if (nextFolderIds.has(folderId)) nextFolderIds.delete(folderId);
    else nextFolderIds.add(folderId);
    notifyExpandedFolderIdsChange(nextFolderIds);
  }, [notifyExpandedFolderIdsChange, validExpandedFolderIds]);
  const handleToggleUnassigned = useCallback(() => {
    const nextFolderIds = new Set(validExpandedFolderIds);
    if (nextFolderIds.has(null)) nextFolderIds.delete(null);
    else nextFolderIds.add(null);
    notifyExpandedFolderIdsChange(nextFolderIds);
  }, [notifyExpandedFolderIdsChange, validExpandedFolderIds]);
  const renderRow = useCallback(({ item }: { item: PartyPresetTreeRow }) => {
    switch (item.kind) {
      case 'folder':
        return (
          <PartyPresetFolderRow
            depth={item.depth}
            expanded={item.expanded}
            disabled={disabled}
            count={item.count}
            folderId={item.folderId}
            name={item.name}
            onToggle={handleToggleFolder}
          />
        );
      case 'unassigned':
        return <PartyPresetUnassignedRow count={item.count} disabled={disabled} expanded={item.expanded} onToggle={handleToggleUnassigned} />;
      case 'preset':
        return (
          <PartyPresetRow
            browsingDepth={item.depth}
            rowAccessibilityLabel={selectionLabels ? `${item.preset.name} 프리셋 선택` : undefined}
            selectionControl={selectionLabels}
            showMemberCount={showMemberCount}
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
  }, [disabled, handleToggleFolder, handleToggleUnassigned, onSelectPreset, selectedPresetId, selectionLabels, showMemberCount]);

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
  count: number;
  disabled: boolean;
  depth: number;
  expanded: boolean;
  folderId: number;
  name: string;
  onToggle: (folderId: number) => void;
};

const PartyPresetFolderRow = memo(function PartyPresetFolderRow({
  count,
  depth,
  disabled,
  expanded,
  folderId,
  name,
  onToggle,
}: PartyPresetFolderRowProps) {
  const handlePress = useCallback(() => {
    onToggle(folderId);
  }, [folderId, onToggle]);

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
      <Text style={styles.folderCount} testID="party-preset-folder-count">{count}</Text>
      {expanded
        ? <ChevronDown color={theme.colors.textMuted} size={17} />
        : <ChevronRight color={theme.colors.textMuted} size={17} />}
    </Pressable>
  );
});

const PartyPresetUnassignedRow = memo(function PartyPresetUnassignedRow({
  count,
  expanded,
  disabled,
  onToggle,
}: {
  count: number;
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
      <Text style={styles.folderCount} testID="party-preset-folder-count">{count}</Text>
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

function validateExpandedFolderIds(
  index: PartyPresetCatalogIndex,
  expandedFolderIds: PartyPresetExpandedFolderIds,
): PartyPresetExpandedFolderIds {
  const reachableFolderIds = new Set<number>();
  const pending = [...(index.childFolderIdsByParent.get(null) ?? [])];
  while (pending.length > 0) {
    const folderId = pending.pop();
    if (folderId == null || reachableFolderIds.has(folderId)) continue;
    reachableFolderIds.add(folderId);
    pending.push(...(index.childFolderIdsByParent.get(folderId) ?? []));
  }
  return new Set([...expandedFolderIds].filter((folderId) => (
    folderId === null || reachableFolderIds.has(folderId)
  )));
}

function buildVisibleRows(
  index: PartyPresetCatalogIndex,
  expandedFolderIds: PartyPresetExpandedFolderIds,
): PartyPresetTreeRow[] {
  const rows: PartyPresetTreeRow[] = [];

  function appendPresetRows(folderId: number | null, depth: number) {
    let presetCount = 0;
    for (const presetId of index.presetIdsByFolder.get(folderId) ?? []) {
      const preset = index.presetsById.get(presetId);
      if (preset == null) continue;
      rows.push({ key: `preset:${preset.id}`, kind: 'preset', depth, preset });
      presetCount += 1;
    }
    const hasChildFolders = folderId != null
      && (index.childFolderIdsByParent.get(folderId)?.length ?? 0) > 0;
    if (presetCount === 0 && !hasChildFolders) {
      rows.push({ key: `empty:${folderId ?? 'unassigned'}`, kind: 'empty', depth, unassigned: folderId == null });
    }
  }

  function appendFolderLevel(parentFolderId: number | null, depth: number) {
    const folderIds = index.childFolderIdsByParent.get(parentFolderId) ?? [];
    for (const folderId of folderIds) {
      const folder = index.foldersById.get(folderId);
      if (folder == null) continue;
      const expanded = expandedFolderIds.has(folder.id);
      rows.push({
        key: `folder:${folder.id}`,
        kind: 'folder',
        count: countPartyPresetsInFolderTree(index, folder.id),
        depth,
        folderId: folder.id,
        name: folder.name,
        expanded,
      });
      if (expanded) {
        appendFolderLevel(folder.id, depth + 1);
        appendPresetRows(folder.id, depth);
      }
    }
  }

  appendFolderLevel(null, 0);
  const unassignedExpanded = expandedFolderIds.has(null);
  rows.push({
    key: 'folder:unassigned',
    kind: 'unassigned',
    count: countPartyPresetsInFolderTree(index, null),
    expanded: unassignedExpanded,
  });
  if (unassignedExpanded) appendPresetRows(null, 0);
  return rows;
}

function setsEqual(left: PartyPresetExpandedFolderIds, right: PartyPresetExpandedFolderIds): boolean {
  return left.size === right.size && [...left].every((folderId) => right.has(folderId));
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
    backgroundColor: '#15251f',
    borderColor: '#2e5143',
    borderCurve: 'continuous',
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    minHeight: 44,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  folderRowExpanded: { backgroundColor: '#1b342b', borderColor: '#4f806c' },
  folderName: { color: '#cce9dc', flex: 1, fontSize: 13, fontWeight: '900' },
  folderCount: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' },
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
