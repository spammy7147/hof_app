import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';

import {
  buildPartyPresetFolderEditorRows,
  planPartyPresetFolderDrop,
  type PartyPresetFolderDropPlan,
  type PartyPresetFolderDropZone,
  type PartyPresetFolderEditorRow,
} from '../domain/partyPresetFolderEditor';
import type { PartyPresetCatalogIndex } from '../domain/partyPresetCatalog';
import { theme } from '../styles/theme';
import type {
  CreatePartyPresetFolderRequest,
  MovePartyPresetFolderRequest,
  RenamePartyPresetFolderRequest,
} from '../types/api';

export type PartyPresetFolderEditorProps = {
  disabled: boolean;
  index: PartyPresetCatalogIndex;
  onCreate: (request: CreatePartyPresetFolderRequest) => Promise<void>;
  onDelete: (folderId: number) => Promise<void>;
  onMove: (folderId: number, request: MovePartyPresetFolderRequest) => Promise<void>;
  onRename: (folderId: number, request: RenamePartyPresetFolderRequest) => Promise<void>;
};

type RowLayout = { y: number; height: number };
type DropFeedback = {
  movingFolderId: number;
  targetFolderId: number;
  zone: PartyPresetFolderDropZone;
  contentY: number;
};
type DragOrigin = { folderId: number; pointerY: number; scrollOffset: number };
type FolderCellProps = {
  children: ReactNode;
  index: number;
  item: PartyPresetFolderEditorRow;
  onLayout?: (event: LayoutChangeEvent) => void;
  style: StyleProp<ViewStyle>;
};

const MAX_VISIBLE_INDENT = 4;

export const PartyPresetFolderEditor = memo(function PartyPresetFolderEditor({
  disabled,
  index,
  onCreate,
  onDelete,
  onMove,
  onRename,
}: PartyPresetFolderEditorProps) {
  const [expandedFolderIds, setExpandedFolderIds] = useState<ReadonlySet<number>>(
    () => new Set(index.foldersById.keys()),
  );
  const [topLevelName, setTopLevelName] = useState('');
  const [childEditorFolderId, setChildEditorFolderId] = useState<number | null>(null);
  const [childName, setChildName] = useState('');
  const [renameFolderId, setRenameFolderId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dropFeedback, setDropFeedback] = useState<DropFeedback | null>(null);
  const [dragPreview, setDragPreview] = useState<{ folderId: number; contentY: number } | null>(null);
  const previousFolderIdsRef = useRef(new Set(index.foldersById.keys()));
  const rowLayoutsRef = useRef(new Map<number, RowLayout>());
  const scrollOffsetRef = useRef(0);
  const dragOriginRef = useRef<DragOrigin | null>(null);
  const dropFeedbackRef = useRef<DropFeedback | null>(null);

  useEffect(() => {
    const currentFolderIds = new Set(index.foldersById.keys());
    const previousFolderIds = previousFolderIdsRef.current;
    setExpandedFolderIds((previousExpanded) => {
      const next = new Set<number>();
      for (const folderId of previousExpanded) {
        if (currentFolderIds.has(folderId)) next.add(folderId);
      }
      for (const folderId of currentFolderIds) {
        if (!previousFolderIds.has(folderId)) next.add(folderId);
      }
      return next;
    });
    previousFolderIdsRef.current = currentFolderIds;
    for (const folderId of rowLayoutsRef.current.keys()) {
      if (!currentFolderIds.has(folderId)) rowLayoutsRef.current.delete(folderId);
    }
    if (renameFolderId != null && !currentFolderIds.has(renameFolderId)) setRenameFolderId(null);
    if (childEditorFolderId != null && !currentFolderIds.has(childEditorFolderId)) setChildEditorFolderId(null);
  }, [childEditorFolderId, index, renameFolderId]);

  const rows = useMemo(
    () => buildPartyPresetFolderEditorRows(index, expandedFolderIds),
    [expandedFolderIds, index],
  );

  const toggleExpanded = useCallback((folderId: number) => {
    setExpandedFolderIds((previous) => {
      const next = new Set(previous);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const submitTopLevel = useCallback(async () => {
    const name = topLevelName.trim();
    if (disabled || name.length === 0) return;
    await onCreate({ name, parentFolderId: null });
    setTopLevelName('');
  }, [disabled, onCreate, topLevelName]);

  const openChildEditor = useCallback((folderId: number) => {
    if (disabled) return;
    setChildEditorFolderId(folderId);
    setChildName('');
    setExpandedFolderIds((previous) => new Set(previous).add(folderId));
  }, [disabled]);

  const submitChild = useCallback(async (folderId: number) => {
    const name = childName.trim();
    if (disabled || name.length === 0) return;
    await onCreate({ name, parentFolderId: folderId });
    setExpandedFolderIds((previous) => new Set(previous).add(folderId));
    setChildEditorFolderId(null);
    setChildName('');
  }, [childName, disabled, onCreate]);

  const openRename = useCallback((row: PartyPresetFolderEditorRow) => {
    if (disabled) return;
    setRenameFolderId(row.folderId);
    setRenameValue(row.name);
  }, [disabled]);

  const submitRename = useCallback(async (folderId: number) => {
    const name = renameValue.trim();
    if (disabled || name.length === 0) return;
    await onRename(folderId, { name });
    setRenameFolderId(null);
  }, [disabled, onRename, renameValue]);

  const deleteFolder = useCallback(async (folderId: number) => {
    if (disabled) return;
    await onDelete(folderId);
    setRenameFolderId(null);
  }, [disabled, onDelete]);

  const moveFolder = useCallback(async (
    folderId: number,
    plan: PartyPresetFolderDropPlan | null,
    expandInsideParent: boolean,
  ) => {
    if (disabled || plan == null) return;
    await onMove(folderId, plan);
    if (expandInsideParent && plan.parentFolderId != null) {
      setExpandedFolderIds((previous) => new Set(previous).add(plan.parentFolderId!));
    }
  }, [disabled, onMove]);

  const planForAccessibilityAction = useCallback((
    row: PartyPresetFolderEditorRow,
    rowIndex: number,
    actionName: string,
  ): PartyPresetFolderDropPlan | null => {
    if (actionName === 'decrement' && rowIndex > 0) {
      return planPartyPresetFolderDrop(index, row.folderId, rows[rowIndex - 1]!.folderId, 'before');
    }
    if (actionName === 'increment' && rowIndex < rows.length - 1) {
      return planPartyPresetFolderDrop(index, row.folderId, rows[rowIndex + 1]!.folderId, 'after');
    }
    if (actionName === 'escape' && row.parentFolderId != null) {
      return planPartyPresetFolderDrop(index, row.folderId, row.parentFolderId, 'after');
    }
    return null;
  }, [index, rows]);

  const accessibilityActionsFor = useCallback((row: PartyPresetFolderEditorRow, rowIndex: number) => {
    const actions: Array<{ name: 'decrement' | 'increment' | 'escape'; label: string }> = [];
    if (planForAccessibilityAction(row, rowIndex, 'decrement') != null) {
      actions.push({ name: 'decrement', label: '같은 위치에서 위로 이동' });
    }
    if (planForAccessibilityAction(row, rowIndex, 'increment') != null) {
      actions.push({ name: 'increment', label: '같은 위치에서 아래로 이동' });
    }
    if (planForAccessibilityAction(row, rowIndex, 'escape') != null) {
      actions.push({ name: 'escape', label: '한 단계 위로 이동' });
    }
    return actions;
  }, [planForAccessibilityAction]);

  const onDragStart = useCallback((folderId: number, pointerY: number) => {
    if (disabled) return;
    dragOriginRef.current = { folderId, pointerY, scrollOffset: scrollOffsetRef.current };
    const sourceLayout = rowLayoutsRef.current.get(folderId);
    if (sourceLayout != null) {
      setDragPreview({ folderId, contentY: sourceLayout.y + pointerY });
    }
  }, [disabled]);

  const onDragUpdate = useCallback((folderId: number, _pointerY: number, translationY: number) => {
    if (disabled) return;
    const origin = dragOriginRef.current;
    const sourceLayout = rowLayoutsRef.current.get(folderId);
    if (origin == null || origin.folderId !== folderId || sourceLayout == null) return;
    const contentY = sourceLayout.y
      + origin.pointerY
      + translationY
      + (scrollOffsetRef.current - origin.scrollOffset);
    setDragPreview({ folderId, contentY });
    const target = rows.find((row) => {
      const layout = rowLayoutsRef.current.get(row.folderId);
      return layout != null && contentY >= layout.y && contentY <= layout.y + layout.height;
    });
    if (target == null) return;
    const targetLayout = rowLayoutsRef.current.get(target.folderId)!;
    const ratio = targetLayout.height <= 0 ? 0.5 : (contentY - targetLayout.y) / targetLayout.height;
    const zone: PartyPresetFolderDropZone = ratio < 0.25
      ? 'before'
      : ratio > 0.75
        ? 'after'
        : 'inside';
    const feedback = planPartyPresetFolderDrop(index, folderId, target.folderId, zone) == null
      ? null
      : { movingFolderId: folderId, targetFolderId: target.folderId, zone, contentY };
    dropFeedbackRef.current = feedback;
    setDropFeedback(feedback);
  }, [disabled, index, rows]);

  const onDragEnd = useCallback((folderId: number) => {
    const feedback = dropFeedbackRef.current;
    dragOriginRef.current = null;
    dropFeedbackRef.current = null;
    setDropFeedback(null);
    setDragPreview(null);
    if (disabled || feedback == null || feedback.movingFolderId !== folderId) return;
    const plan = planPartyPresetFolderDrop(index, folderId, feedback.targetFolderId, feedback.zone);
    void moveFolder(folderId, plan, feedback.zone === 'inside');
  }, [disabled, index, moveFolder]);

  const cancelDrag = useCallback(() => {
    dragOriginRef.current = null;
    dropFeedbackRef.current = null;
    setDropFeedback(null);
    setDragPreview(null);
  }, []);

  const renderItem = useCallback(({ item: row, index: rowIndex }: {
    item: PartyPresetFolderEditorRow;
    index: number;
  }) => {
    const editingName = renameFolderId === row.folderId;
    const editingChild = childEditorFolderId === row.folderId;
    return (
      <FolderEditorRow
        accessibilityActions={accessibilityActionsFor(row, rowIndex)}
        disabled={disabled}
        dropZone={dropFeedback?.targetFolderId === row.folderId ? dropFeedback.zone : null}
        editingChild={editingChild}
        editingName={editingName}
        key={row.folderId}
        newChildName={editingChild ? childName : ''}
        onAccessibilityAction={(actionName) => {
          if (disabled) return;
          void moveFolder(row.folderId, planForAccessibilityAction(row, rowIndex, actionName), false);
        }}
        onCancelChild={() => setChildEditorFolderId(null)}
        onCancelRename={() => setRenameFolderId(null)}
        onChildNameChange={setChildName}
        onDelete={() => { void deleteFolder(row.folderId); }}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onDragUpdate={onDragUpdate}
        onFinalizeDrag={cancelDrag}
        onOpenChild={() => openChildEditor(row.folderId)}
        onOpenRename={() => openRename(row)}
        onRenameValueChange={setRenameValue}
        onSubmitChild={() => { void submitChild(row.folderId); }}
        onSubmitRename={() => { void submitRename(row.folderId); }}
        onToggle={() => toggleExpanded(row.folderId)}
        renameValue={editingName ? renameValue : ''}
        row={row}
      />
    );
  }, [
    accessibilityActionsFor,
    cancelDrag,
    childEditorFolderId,
    childName,
    deleteFolder,
    disabled,
    dropFeedback,
    moveFolder,
    onDragEnd,
    onDragStart,
    onDragUpdate,
    openChildEditor,
    openRename,
    planForAccessibilityAction,
    renameFolderId,
    renameValue,
    submitChild,
    submitRename,
    toggleExpanded,
  ]);

  const renderCell = useCallback(({ children, item, onLayout, style }: FolderCellProps) => (
    <View
      onLayout={(event) => {
        onLayout?.(event);
        const { y, height } = event.nativeEvent.layout;
        rowLayoutsRef.current.set(item.folderId, { y, height });
      }}
      style={style}
      testID="party-preset-folder-drop-target"
    >
      {children}
    </View>
  ), []);

  const header = (
    <View style={styles.topLevelCreateRow}>
      <TextInput
        accessibilityLabel="새 최상위 폴더 이름"
        editable={!disabled}
        onChangeText={setTopLevelName}
        onSubmitEditing={() => { void submitTopLevel(); }}
        placeholder="새 폴더"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.createInput}
        value={topLevelName}
      />
      <Pressable
        accessibilityLabel="최상위 폴더 추가"
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => { void submitTopLevel(); }}
        style={styles.topLevelAddButton}
      >
        <Plus color={theme.colors.accentGreen} size={20} />
      </Pressable>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        CellRendererComponent={renderCell}
        contentContainerStyle={styles.listContent}
        data={rows}
        keyboardShouldPersistTaps="handled"
        keyExtractor={({ folderId }) => folderId.toString()}
        ListHeaderComponent={header}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        renderItem={renderItem}
        scrollEventThrottle={16}
        style={styles.list}
      />
      {dragPreview != null ? (
        <View
          pointerEvents="none"
          style={[
            styles.dragPreview,
            { top: dragPreview.contentY - scrollOffsetRef.current - 22 },
          ]}
          testID="party-preset-folder-drag-preview"
        >
          <Text numberOfLines={1} style={styles.dragPreviewText}>
            {index.foldersById.get(dragPreview.folderId)?.name ?? ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

type FolderEditorRowProps = {
  accessibilityActions: Array<{ name: 'decrement' | 'increment' | 'escape'; label: string }>;
  disabled: boolean;
  dropZone: PartyPresetFolderDropZone | null;
  editingChild: boolean;
  editingName: boolean;
  newChildName: string;
  renameValue: string;
  row: PartyPresetFolderEditorRow;
  onAccessibilityAction: (actionName: string) => void;
  onCancelChild: () => void;
  onCancelRename: () => void;
  onChildNameChange: (name: string) => void;
  onDelete: () => void;
  onDragEnd: (folderId: number) => void;
  onDragStart: (folderId: number, pointerY: number) => void;
  onDragUpdate: (folderId: number, pointerY: number, translationY: number) => void;
  onFinalizeDrag: () => void;
  onOpenChild: () => void;
  onOpenRename: () => void;
  onRenameValueChange: (name: string) => void;
  onSubmitChild: () => void;
  onSubmitRename: () => void;
  onToggle: () => void;
};

const FolderEditorRow = memo(function FolderEditorRow({
  accessibilityActions,
  disabled,
  dropZone,
  editingChild,
  editingName,
  newChildName,
  renameValue,
  row,
  onAccessibilityAction,
  onCancelChild,
  onCancelRename,
  onChildNameChange,
  onDelete,
  onDragEnd,
  onDragStart,
  onDragUpdate,
  onFinalizeDrag,
  onOpenChild,
  onOpenRename,
  onRenameValueChange,
  onSubmitChild,
  onSubmitRename,
  onToggle,
}: FolderEditorRowProps) {
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .activateAfterLongPress(220)
    .onStart((event) => onDragStart(row.folderId, event.y))
    .onUpdate((event) => onDragUpdate(row.folderId, event.y, event.translationY))
    .onEnd(() => onDragEnd(row.folderId))
    .onFinalize(onFinalizeDrag)
    .runOnJS(true), [disabled, onDragEnd, onDragStart, onDragUpdate, onFinalizeDrag, row.folderId]);
  const indentation = Math.min(row.depth, MAX_VISIBLE_INDENT) * 16 + 8;

  return (
    <View>
      <View
        style={[
          styles.folderRow,
          { paddingLeft: indentation },
          row.depth > 0 && styles.nestedFolderRow,
          dropZone === 'inside' && styles.insideDropTarget,
        ]}
        testID={`party-preset-folder-row-${row.folderId}`}
      >
        <View pointerEvents="none" style={styles.dropFeedbackLayer}>
          {dropZone === 'before' ? (
            <View style={[styles.insertionLine, styles.insertionLineBefore]} testID={`party-preset-folder-drop-line-before-${row.folderId}`} />
          ) : null}
          {dropZone === 'inside' ? (
            <View style={styles.insideOutline} testID={`party-preset-folder-drop-inside-${row.folderId}`} />
          ) : null}
          {dropZone === 'after' ? (
            <View style={[styles.insertionLine, styles.insertionLineAfter]} testID={`party-preset-folder-drop-line-after-${row.folderId}`} />
          ) : null}
        </View>
        {row.hasChildren ? (
          <Pressable
            accessibilityLabel={`${row.name} 폴더 ${row.expanded ? '접기' : '펼치기'}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: row.expanded }}
            onPress={onToggle}
            style={styles.disclosureButton}
          >
            {row.expanded
              ? <ChevronDown color={theme.colors.textMuted} size={17} />
              : <ChevronRight color={theme.colors.textMuted} size={17} />}
          </Pressable>
        ) : <View style={styles.disclosureButton} />}
        <Text numberOfLines={1} style={styles.folderName}>{row.name}</Text>
        <Pressable
          accessibilityLabel={`${row.name} 폴더 이름 및 삭제 수정`}
          accessibilityRole="button"
          disabled={disabled}
          onPress={onOpenRename}
          style={styles.iconButton}
        >
          <Pencil color={theme.colors.textMuted} size={17} />
        </Pressable>
        <Pressable
          accessibilityLabel={`${row.name} 하위 폴더 추가`}
          accessibilityRole="button"
          disabled={disabled}
          onPress={onOpenChild}
          style={styles.iconButton}
        >
          <Plus color={theme.colors.accentGreen} size={19} />
        </Pressable>
        <GestureDetector gesture={gesture}>
          <Pressable
            accessibilityActions={accessibilityActions}
            accessibilityLabel={`${row.name} 폴더 위치 이동`}
            accessibilityRole="adjustable"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onAccessibilityAction={({ nativeEvent: { actionName } }) => onAccessibilityAction(actionName)}
            style={styles.dragHandle}
          >
            <GripVertical color={theme.colors.textMuted} size={18} />
          </Pressable>
        </GestureDetector>
      </View>
      {editingName ? (
        <View style={[styles.inlineEditor, { marginLeft: indentation + 34 }]}>
          <TextInput
            accessibilityLabel={`${row.name} 폴더 이름`}
            autoFocus
            editable={!disabled}
            onChangeText={onRenameValueChange}
            onSubmitEditing={onSubmitRename}
            style={styles.inlineInput}
            value={renameValue}
          />
          <Pressable accessibilityLabel={`${row.name} 폴더 이름 저장`} accessibilityRole="button" disabled={disabled} onPress={onSubmitRename} style={styles.inlineAction}>
            <Check color={theme.colors.accentGreen} size={18} />
          </Pressable>
          <Pressable accessibilityLabel={`${row.name} 폴더 삭제`} accessibilityRole="button" disabled={disabled} onPress={onDelete} style={styles.inlineAction}>
            <Trash2 color={theme.colors.danger} size={17} />
          </Pressable>
          <Pressable accessibilityLabel={`${row.name} 폴더 수정 취소`} accessibilityRole="button" onPress={onCancelRename} style={styles.inlineAction}>
            <X color={theme.colors.textMuted} size={18} />
          </Pressable>
        </View>
      ) : null}
      {editingChild ? (
        <View style={[styles.inlineEditor, { marginLeft: indentation + 34 }]}>
          <TextInput
            accessibilityLabel={`${row.name} 새 하위 폴더 이름`}
            autoFocus
            editable={!disabled}
            onChangeText={onChildNameChange}
            onSubmitEditing={onSubmitChild}
            placeholder="새 하위 폴더"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.inlineInput}
            value={newChildName}
          />
          <Pressable accessibilityLabel={`${row.name} 하위 폴더 저장`} accessibilityRole="button" disabled={disabled} onPress={onSubmitChild} style={styles.inlineAction}>
            <Check color={theme.colors.accentGreen} size={18} />
          </Pressable>
          <Pressable accessibilityLabel={`${row.name} 하위 폴더 추가 취소`} accessibilityRole="button" onPress={onCancelChild} style={styles.inlineAction}>
            <X color={theme.colors.textMuted} size={18} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: theme.spacing.lg,
  },
  topLevelCreateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 1,
  },
  createInput: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    color: theme.colors.text,
    flex: 1,
    minHeight: 40,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  topLevelAddButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    width: 44,
  },
  folderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 44,
    paddingRight: theme.spacing.xs,
    paddingVertical: 1,
    position: 'relative',
  },
  nestedFolderRow: {
    borderLeftColor: theme.colors.borderStrong,
    borderLeftWidth: 2,
  },
  disclosureButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    width: 30,
  },
  folderName: {
    color: theme.colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  iconButton: {
    alignItems: 'center',
    borderWidth: 0,
    justifyContent: 'center',
    minHeight: 44,
    width: 34,
  },
  dragHandle: {
    alignItems: 'center',
    borderWidth: 0,
    justifyContent: 'center',
    minHeight: 44,
    width: 34,
  },
  inlineEditor: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 44,
    paddingRight: theme.spacing.xs,
    paddingVertical: 1,
  },
  inlineInput: {
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    color: theme.colors.text,
    flex: 1,
    minHeight: 38,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  inlineAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    width: 34,
  },
  dropFeedbackLayer: {
    ...StyleSheet.absoluteFill,
  },
  insertionLine: {
    backgroundColor: theme.colors.accentGreen,
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  insertionLineBefore: {
    top: 0,
  },
  insertionLineAfter: {
    bottom: 0,
  },
  insideDropTarget: {
    backgroundColor: 'rgba(124, 224, 181, 0.08)',
  },
  insideOutline: {
    ...StyleSheet.absoluteFill,
    borderColor: theme.colors.accentGreen,
    borderRadius: theme.radius.sm,
    borderWidth: 2,
  },
  dragPreview: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.accentGreen,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    left: theme.spacing.lg,
    opacity: 0.94,
    paddingHorizontal: theme.spacing.md,
    position: 'absolute',
    right: theme.spacing.lg,
  },
  dragPreviewText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
});
