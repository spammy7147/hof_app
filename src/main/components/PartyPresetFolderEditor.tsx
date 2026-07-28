import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
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
  onCreate: (request: CreatePartyPresetFolderRequest) => Promise<boolean | void>;
  onDelete: (folderId: number) => Promise<boolean | void>;
  onMove: (folderId: number, request: MovePartyPresetFolderRequest) => Promise<boolean | void>;
  onRename: (folderId: number, request: RenamePartyPresetFolderRequest) => Promise<boolean | void>;
};

type RowLayout = { y: number; height: number };
type DropFeedback = {
  movingFolderId: number;
  targetFolderId: number;
  zone: PartyPresetFolderDropZone;
  contentY: number;
};
type DragOrigin = { folderId: number; pointerY: number; scrollOffset: number };
type DragEdgeDirection = 'up' | 'down';
type RenameSession = { token: number; folderId: number; baseName: string };
type FolderAccessibilityAction = {
  name: 'decrement' | 'increment' | 'escape' | 'delete';
  label: string;
};
type FolderInteractionSnapshot = {
  disabled: boolean;
  index: PartyPresetCatalogIndex;
  onDelete: PartyPresetFolderEditorProps['onDelete'];
  token: symbol;
};
type FolderCellProps = {
  children: ReactNode;
  index: number;
  item: PartyPresetFolderEditorRow;
  onLayout?: (event: LayoutChangeEvent) => void;
  style: StyleProp<ViewStyle>;
};

const MAX_FOLDER_LEVELS = 5;
const MAX_VISIBLE_INDENT = MAX_FOLDER_LEVELS - 1;
const DRAG_EDGE_THRESHOLD = 44;
const DRAG_SCROLL_STEP = 44;

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
  const rowLayoutsRef = useRef(new Map<number, RowLayout>());
  const scrollOffsetRef = useRef(0);
  const dragOriginRef = useRef<DragOrigin | null>(null);
  const dropFeedbackRef = useRef<DropFeedback | null>(null);
  const listRef = useRef<FlatList<PartyPresetFolderEditorRow>>(null);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const indexRef = useRef(index);
  const mountedRef = useRef(true);
  const disabledRef = useRef(disabled);
  const interactionToken = useMemo(() => Symbol('party-preset-folder-interaction'), [disabled, index]);
  const committedInteractionRef = useRef<FolderInteractionSnapshot | null>(null);
  const renamePendingRef = useRef(false);
  const renameSessionRef = useRef<RenameSession | null>(null);
  const nextRenameSessionTokenRef = useRef(0);
  const deletePendingRef = useRef(false);
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const swipeableNodesRef = useRef(new Map<number, SwipeableMethods>());
  const dragBaseContentYRef = useRef<number | null>(null);
  const dragEdgeDirectionRef = useRef<DragEdgeDirection | null>(null);
  const edgeAnimationFrameRef = useRef<number | null>(null);
  const advanceEdgeScrollRef = useRef<() => boolean>(() => false);
  const scheduleEdgeScrollRef = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      committedInteractionRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    indexRef.current = index;
    disabledRef.current = disabled;
    committedInteractionRef.current = {
      disabled,
      index,
      onDelete,
      token: interactionToken,
    };
  }, [disabled, index, interactionToken, onDelete]);

  const isMutationBlocked = useCallback(() => (
    !mountedRef.current
    || disabledRef.current
    || renamePendingRef.current
    || deletePendingRef.current
  ), []);

  const clearRenameSession = useCallback((session: RenameSession) => {
    if (renameSessionRef.current?.token !== session.token) return;
    renameSessionRef.current = null;
    if (!mountedRef.current) return;
    setRenameFolderId(null);
    setRenameValue('');
  }, []);

  const closeOpenSwipeable = useCallback(() => {
    openSwipeableRef.current?.close();
    openSwipeableRef.current = null;
  }, []);

  const registerSwipeable = useCallback((folderId: number, node: SwipeableMethods | null) => {
    if (node) swipeableNodesRef.current.set(folderId, node);
    else {
      swipeableNodesRef.current.delete(folderId);
    }
  }, []);

  const prepareSwipeable = useCallback((folderId: number) => {
    const next = swipeableNodesRef.current.get(folderId) ?? null;
    if (isMutationBlocked()) {
      next?.close();
      return;
    }
    if (openSwipeableRef.current && openSwipeableRef.current !== next) openSwipeableRef.current.close();
    openSwipeableRef.current = next;
  }, [isMutationBlocked]);

  useEffect(() => {
    return () => {
      renameSessionRef.current = null;
      if (edgeAnimationFrameRef.current != null) {
        cancelAnimationFrame(edgeAnimationFrameRef.current);
        edgeAnimationFrameRef.current = null;
      }
      closeOpenSwipeable();
      swipeableNodesRef.current.clear();
    };
  }, [closeOpenSwipeable]);

  useEffect(() => {
    const currentFolderIds = new Set(index.foldersById.keys());
    setExpandedFolderIds((previousExpanded) => {
      const next = new Set<number>();
      for (const folderId of previousExpanded) {
        if (currentFolderIds.has(folderId)) next.add(folderId);
      }
      return next.size === previousExpanded.size ? previousExpanded : next;
    });
    for (const folderId of rowLayoutsRef.current.keys()) {
      if (!currentFolderIds.has(folderId)) rowLayoutsRef.current.delete(folderId);
    }
  }, [index]);

  useEffect(() => {
    closeOpenSwipeable();
  }, [closeOpenSwipeable, disabled, index]);

  useEffect(() => {
    const currentFolderIds = new Set(index.foldersById.keys());
    const renameSession = renameSessionRef.current;
    if (
      renameSession != null
      && index.foldersById.get(renameSession.folderId)?.name !== renameSession.baseName
    ) clearRenameSession(renameSession);
    if (childEditorFolderId != null && !currentFolderIds.has(childEditorFolderId)) setChildEditorFolderId(null);
  }, [childEditorFolderId, clearRenameSession, index]);

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
    if (isMutationBlocked() || name.length === 0) return;
    const succeeded = await onCreate({ name, parentFolderId: null });
    if (succeeded === false) return;
    setTopLevelName('');
  }, [isMutationBlocked, onCreate, topLevelName]);

  const openChildEditor = useCallback((folderId: number) => {
    if (isMutationBlocked() || !canCreatePartyPresetChildFolder(indexRef.current, folderId)) return;
    closeOpenSwipeable();
    setChildEditorFolderId(folderId);
    setChildName('');
  }, [closeOpenSwipeable, isMutationBlocked]);

  const submitChild = useCallback(async (folderId: number) => {
    const name = childName.trim();
    if (
      isMutationBlocked()
      || name.length === 0
      || !canCreatePartyPresetChildFolder(indexRef.current, folderId)
    ) return;
    const succeeded = await onCreate({ name, parentFolderId: folderId });
    if (succeeded === false) return;
    setExpandedFolderIds((previous) => new Set(previous).add(folderId));
    setChildEditorFolderId(null);
    setChildName('');
  }, [childName, isMutationBlocked, onCreate]);

  const openRename = useCallback((row: PartyPresetFolderEditorRow) => {
    const currentFolder = indexRef.current.foldersById.get(row.folderId);
    if (isMutationBlocked() || currentFolder?.name !== row.name) return;
    const session = {
      token: nextRenameSessionTokenRef.current + 1,
      folderId: row.folderId,
      baseName: currentFolder.name,
    };
    nextRenameSessionTokenRef.current = session.token;
    renameSessionRef.current = session;
    closeOpenSwipeable();
    setRenameFolderId(row.folderId);
    setRenameValue(row.name);
  }, [closeOpenSwipeable, isMutationBlocked]);

  const deleteFolder = useCallback(async (folderId: number, token: symbol) => {
    const interaction = committedInteractionRef.current;
    if (
      interaction == null
      || token !== interaction.token
      || isMutationBlocked()
      || interaction.disabled
      || !interaction.index.foldersById.has(folderId)
    ) return;
    deletePendingRef.current = true;
    closeOpenSwipeable();
    try {
      await interaction.onDelete(folderId);
    } catch {
      // Parent mutation handling already surfaces errors.
    } finally {
      deletePendingRef.current = false;
    }
  }, [closeOpenSwipeable, isMutationBlocked]);

  const finishRename = useCallback(async (
    row: PartyPresetFolderEditorRow,
    session: RenameSession,
  ) => {
    const name = renameValue.trim();
    const currentFolder = indexRef.current.foldersById.get(session.folderId);
    if (
      !mountedRef.current
      || disabledRef.current
      || deletePendingRef.current
      || renamePendingRef.current
      || renameSessionRef.current?.token !== session.token
      || row.folderId !== session.folderId
    ) return;
    if (currentFolder?.name !== session.baseName) {
      clearRenameSession(session);
      return;
    }
    if (name.length === 0 || name === session.baseName) {
      clearRenameSession(session);
      return;
    }
    renamePendingRef.current = true;
    try {
      await onRename(row.folderId, { name });
    } catch {
      // Parent mutation handling already surfaces errors.
    } finally {
      renamePendingRef.current = false;
      clearRenameSession(session);
    }
  }, [clearRenameSession, onRename, renameValue]);

  const moveFolder = useCallback(async (
    folderId: number,
    plan: PartyPresetFolderDropPlan | null,
    expandInsideParent: boolean,
  ) => {
    if (isMutationBlocked() || plan == null) return;
    const succeeded = await onMove(folderId, plan);
    if (succeeded === false) return;
    if (mountedRef.current && expandInsideParent && plan.parentFolderId != null) {
      setExpandedFolderIds((previous) => new Set(previous).add(plan.parentFolderId!));
    }
  }, [isMutationBlocked, onMove]);

  const planForAccessibilityAction = useCallback((
    row: PartyPresetFolderEditorRow,
    actionName: string,
  ): PartyPresetFolderDropPlan | null => {
    const siblingFolderIds = index.childFolderIdsByParent.get(row.parentFolderId) ?? [];
    const siblingIndex = siblingFolderIds.indexOf(row.folderId);
    if (actionName === 'decrement' && siblingIndex > 0) {
      return planPartyPresetFolderDrop(index, row.folderId, siblingFolderIds[siblingIndex - 1]!, 'before');
    }
    if (actionName === 'increment' && siblingIndex >= 0 && siblingIndex < siblingFolderIds.length - 1) {
      return planPartyPresetFolderDrop(index, row.folderId, siblingFolderIds[siblingIndex + 1]!, 'after');
    }
    if (actionName === 'escape' && row.parentFolderId != null) {
      return planPartyPresetFolderDrop(index, row.folderId, row.parentFolderId, 'after');
    }
    return null;
  }, [index]);

  const accessibilityActionsFor = useCallback((row: PartyPresetFolderEditorRow) => {
    const actions: FolderAccessibilityAction[] = [];
    if (planForAccessibilityAction(row, 'decrement') != null) {
      actions.push({ name: 'decrement', label: '같은 위치에서 위로 이동' });
    }
    if (planForAccessibilityAction(row, 'increment') != null) {
      actions.push({ name: 'increment', label: '같은 위치에서 아래로 이동' });
    }
    if (planForAccessibilityAction(row, 'escape') != null) {
      actions.push({ name: 'escape', label: '한 단계 위 폴더로 이동' });
    }
    actions.push({ name: 'delete', label: '삭제' });
    return actions;
  }, [planForAccessibilityAction]);

  const cancelEdgeScroll = useCallback(() => {
    dragEdgeDirectionRef.current = null;
    dragBaseContentYRef.current = null;
    if (edgeAnimationFrameRef.current != null) {
      cancelAnimationFrame(edgeAnimationFrameRef.current);
      edgeAnimationFrameRef.current = null;
    }
  }, []);

  const updateDragPresentation = useCallback((folderId: number, contentY: number) => {
    if (isMutationBlocked()) return;
    setDragPreview({ folderId, contentY });
    const target = rows.find((row) => {
      const layout = rowLayoutsRef.current.get(row.folderId);
      return layout != null && contentY >= layout.y && contentY <= layout.y + layout.height;
    });
    if (target == null) {
      if (dropFeedbackRef.current == null) return;
      dropFeedbackRef.current = null;
      setDropFeedback(null);
      return;
    }
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
    const previousFeedback = dropFeedbackRef.current;
    if (
      previousFeedback?.movingFolderId === feedback?.movingFolderId
      && previousFeedback?.targetFolderId === feedback?.targetFolderId
      && previousFeedback?.zone === feedback?.zone
    ) return;
    dropFeedbackRef.current = feedback;
    setDropFeedback(feedback);
  }, [index, isMutationBlocked, rows]);

  const advanceEdgeScroll = useCallback((): boolean => {
    const origin = dragOriginRef.current;
    const baseContentY = dragBaseContentYRef.current;
    const direction = dragEdgeDirectionRef.current;
    if (isMutationBlocked() || origin == null || baseContentY == null || direction == null) {
      return false;
    }

    const currentScrollOffset = scrollOffsetRef.current;
    const maximumScrollOffset = Math.max(0, contentHeightRef.current - viewportHeightRef.current);
    const nextScrollOffset = direction === 'up'
      ? Math.max(0, currentScrollOffset - DRAG_SCROLL_STEP)
      : Math.min(maximumScrollOffset, currentScrollOffset + DRAG_SCROLL_STEP);
    if (nextScrollOffset === currentScrollOffset) {
      updateDragPresentation(
        origin.folderId,
        baseContentY + currentScrollOffset - origin.scrollOffset,
      );
      return false;
    }

    scrollOffsetRef.current = nextScrollOffset;
    listRef.current?.scrollToOffset({ animated: false, offset: nextScrollOffset });
    updateDragPresentation(
      origin.folderId,
      baseContentY + nextScrollOffset - origin.scrollOffset,
    );
    return direction === 'up' ? nextScrollOffset > 0 : nextScrollOffset < maximumScrollOffset;
  }, [isMutationBlocked, updateDragPresentation]);
  advanceEdgeScrollRef.current = advanceEdgeScroll;

  const scheduleEdgeScroll = useCallback(() => {
    if (
      edgeAnimationFrameRef.current != null
      || dragEdgeDirectionRef.current == null
      || !mountedRef.current
    ) return;
    edgeAnimationFrameRef.current = requestAnimationFrame(() => {
      edgeAnimationFrameRef.current = null;
      if (!mountedRef.current) return;
      if (advanceEdgeScrollRef.current()) scheduleEdgeScrollRef.current();
    });
  }, []);
  scheduleEdgeScrollRef.current = scheduleEdgeScroll;

  const onDragStart = useCallback((folderId: number, pointerY: number) => {
    if (isMutationBlocked()) return;
    closeOpenSwipeable();
    cancelEdgeScroll();
    dragOriginRef.current = { folderId, pointerY, scrollOffset: scrollOffsetRef.current };
    const sourceLayout = rowLayoutsRef.current.get(folderId);
    if (sourceLayout != null) {
      setDragPreview({ folderId, contentY: sourceLayout.y + pointerY });
    }
  }, [cancelEdgeScroll, closeOpenSwipeable, isMutationBlocked]);

  const onDragUpdate = useCallback((folderId: number, _pointerY: number, translationY: number) => {
    if (isMutationBlocked()) return;
    const origin = dragOriginRef.current;
    const sourceLayout = rowLayoutsRef.current.get(folderId);
    if (origin == null || origin.folderId !== folderId || sourceLayout == null) return;
    const baseContentY = sourceLayout.y + origin.pointerY + translationY;
    dragBaseContentYRef.current = baseContentY;
    const contentY = baseContentY + scrollOffsetRef.current - origin.scrollOffset;
    const viewportY = contentY - scrollOffsetRef.current;
    const viewportHeight = viewportHeightRef.current;
    const maximumScrollOffset = Math.max(0, contentHeightRef.current - viewportHeight);
    const direction: DragEdgeDirection | null = viewportHeight > 0 && maximumScrollOffset > 0
      ? viewportY < DRAG_EDGE_THRESHOLD
        ? 'up'
        : viewportY > viewportHeight - DRAG_EDGE_THRESHOLD
          ? 'down'
          : null
      : null;
    dragEdgeDirectionRef.current = direction;
    if (direction == null) {
      if (edgeAnimationFrameRef.current != null) {
        cancelAnimationFrame(edgeAnimationFrameRef.current);
        edgeAnimationFrameRef.current = null;
      }
      updateDragPresentation(folderId, contentY);
      return;
    }
    if (advanceEdgeScrollRef.current()) scheduleEdgeScrollRef.current();
  }, [isMutationBlocked, updateDragPresentation]);

  const onDragEnd = useCallback((folderId: number) => {
    const feedback = dropFeedbackRef.current;
    cancelEdgeScroll();
    dragOriginRef.current = null;
    dropFeedbackRef.current = null;
    if (mountedRef.current) {
      setDropFeedback(null);
      setDragPreview(null);
    }
    if (isMutationBlocked() || feedback == null || feedback.movingFolderId !== folderId) return;
    const plan = planPartyPresetFolderDrop(index, folderId, feedback.targetFolderId, feedback.zone);
    void moveFolder(folderId, plan, feedback.zone === 'inside').catch(() => undefined);
  }, [cancelEdgeScroll, index, isMutationBlocked, moveFolder]);

  const cancelDrag = useCallback(() => {
    cancelEdgeScroll();
    dragOriginRef.current = null;
    dropFeedbackRef.current = null;
    if (mountedRef.current) {
      setDropFeedback(null);
      setDragPreview(null);
    }
  }, [cancelEdgeScroll]);

  useEffect(() => {
    if (disabled) cancelDrag();
  }, [cancelDrag, disabled]);

  const renderItem = useCallback(({ item: row }: {
    item: PartyPresetFolderEditorRow;
  }) => {
    const editingName = renameFolderId === row.folderId;
    const editingChild = childEditorFolderId === row.folderId;
    const renameSession = editingName ? renameSessionRef.current : null;
    return (
      <FolderEditorRow
        accessibilityActions={accessibilityActionsFor(row)}
        canAddChild={canCreatePartyPresetChildFolder(index, row.folderId)}
        disabled={disabled}
        dropZone={dropFeedback?.targetFolderId === row.folderId ? dropFeedback.zone : null}
        editingChild={editingChild}
        editingName={editingName}
        key={row.folderId}
        newChildName={editingChild ? childName : ''}
        onAccessibilityAction={(actionName) => {
          if (disabled) return;
          if (actionName === 'delete') {
            void deleteFolder(row.folderId, interactionToken);
            return;
          }
          void moveFolder(row.folderId, planForAccessibilityAction(row, actionName), false)
            .catch(() => undefined);
        }}
        onCancelChild={() => setChildEditorFolderId(null)}
        onChildNameChange={setChildName}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onDragUpdate={onDragUpdate}
        onFinalizeDrag={cancelDrag}
        onOpenChild={() => openChildEditor(row.folderId)}
        onOpenRename={() => openRename(row)}
        onDelete={() => { void deleteFolder(row.folderId, interactionToken); }}
        onRegisterSwipeable={registerSwipeable}
        onRowLayout={(event) => {
          const { height } = event.nativeEvent.layout;
          rowLayoutsRef.current.set(row.folderId, {
            y: rowLayoutsRef.current.get(row.folderId)?.y ?? 0,
            height,
          });
        }}
        onRenameValueChange={setRenameValue}
        onSubmitChild={() => { void submitChild(row.folderId).catch(() => undefined); }}
        onFinishRename={() => {
          if (renameSession != null) void finishRename(row, renameSession);
        }}
        onSwipeableWillOpen={prepareSwipeable}
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
    disabled,
    deleteFolder,
    dropFeedback,
    index,
    interactionToken,
    moveFolder,
    onDragEnd,
    onDragStart,
    onDragUpdate,
    openChildEditor,
    openRename,
    prepareSwipeable,
    planForAccessibilityAction,
    renameFolderId,
    renameValue,
    registerSwipeable,
    submitChild,
    finishRename,
    toggleExpanded,
  ]);

  const renderCell = useCallback(({ children, item, onLayout, style }: FolderCellProps) => (
    <View
      onLayout={(event) => {
        onLayout?.(event);
        const { y } = event.nativeEvent.layout;
        rowLayoutsRef.current.set(item.folderId, {
          y,
          height: rowLayoutsRef.current.get(item.folderId)?.height ?? 44,
        });
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
        onSubmitEditing={() => { void submitTopLevel().catch(() => undefined); }}
        placeholder="새 폴더"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.createInput}
        value={topLevelName}
      />
      <Pressable
        accessibilityLabel="최상위 폴더 추가"
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => { void submitTopLevel().catch(() => undefined); }}
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
        onContentSizeChange={(_width, height) => {
          contentHeightRef.current = height;
        }}
        onLayout={(event) => {
          viewportHeightRef.current = event.nativeEvent.layout.height;
        }}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        renderItem={renderItem}
        ref={listRef}
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
  accessibilityActions: FolderAccessibilityAction[];
  canAddChild: boolean;
  disabled: boolean;
  dropZone: PartyPresetFolderDropZone | null;
  editingChild: boolean;
  editingName: boolean;
  newChildName: string;
  renameValue: string;
  row: PartyPresetFolderEditorRow;
  onAccessibilityAction: (actionName: string) => void;
  onCancelChild: () => void;
  onChildNameChange: (name: string) => void;
  onDelete: () => void;
  onDragEnd: (folderId: number) => void;
  onDragStart: (folderId: number, pointerY: number) => void;
  onDragUpdate: (folderId: number, pointerY: number, translationY: number) => void;
  onFinalizeDrag: () => void;
  onOpenChild: () => void;
  onOpenRename: () => void;
  onRegisterSwipeable: (folderId: number, node: SwipeableMethods | null) => void;
  onRowLayout: (event: LayoutChangeEvent) => void;
  onRenameValueChange: (name: string) => void;
  onSubmitChild: () => void;
  onFinishRename: () => void;
  onSwipeableWillOpen: (folderId: number) => void;
  onToggle: () => void;
};

const FolderEditorRow = memo(function FolderEditorRow({
  accessibilityActions,
  canAddChild,
  disabled,
  dropZone,
  editingChild,
  editingName,
  newChildName,
  renameValue,
  row,
  onAccessibilityAction,
  onCancelChild,
  onChildNameChange,
  onDelete,
  onDragEnd,
  onDragStart,
  onDragUpdate,
  onFinalizeDrag,
  onOpenChild,
  onOpenRename,
  onRegisterSwipeable,
  onRowLayout,
  onRenameValueChange,
  onSubmitChild,
  onFinishRename,
  onSwipeableWillOpen,
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
  const connectorCount = Math.min(row.depth, MAX_VISIBLE_INDENT);
  const registerSwipeableNode = useCallback((node: SwipeableMethods | null) => {
    onRegisterSwipeable(row.folderId, node);
  }, [onRegisterSwipeable, row.folderId]);
  const prepareSwipe = useCallback(() => onSwipeableWillOpen(row.folderId), [onSwipeableWillOpen, row.folderId]);
  const renderRightActions = useCallback(() => (
    <Pressable
      accessibilityLabel={`${row.name} 폴더 삭제`}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onDelete}
      style={({ pressed }) => [styles.swipeDeleteAction, pressed && styles.pressed]}
    >
      <Trash2 color={theme.colors.buttonText} size={18} />
      <Text style={styles.swipeDeleteText}>삭제</Text>
    </Pressable>
  ), [disabled, onDelete, row.name]);

  return (
    <View>
      <ReanimatedSwipeable
        containerStyle={styles.swipeContainer}
        childrenContainerStyle={styles.swipeContent}
        enabled={!disabled && !editingName}
        friction={2}
        onSwipeableWillOpen={prepareSwipe}
        overshootRight={false}
        ref={registerSwipeableNode}
        renderRightActions={renderRightActions}
        rightThreshold={40}
        testID={`party-preset-folder-swipeable-${row.folderId}`}
      >
        <View
          onLayout={onRowLayout}
          style={[
            styles.folderRow,
            { paddingLeft: indentation },
            dropZone === 'inside' && styles.insideDropTarget,
          ]}
          testID={`party-preset-folder-row-${row.folderId}`}
        >
        {Array.from({ length: connectorCount }, (_, connectorIndex) => (
          <View
            key={connectorIndex}
            pointerEvents="none"
            style={[styles.treeConnector, { left: 8 + connectorIndex * 16 }]}
            testID={`party-preset-folder-connector-${row.folderId}`}
          />
        ))}
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
        {editingName ? (
          <TextInput
            accessibilityLabel={`${row.name} 폴더 이름`}
            autoFocus
            editable={!disabled}
            onBlur={onFinishRename}
            onChangeText={onRenameValueChange}
            onSubmitEditing={onFinishRename}
            selectTextOnFocus
            style={styles.renameInput}
            value={renameValue}
          />
        ) : <Text numberOfLines={1} style={styles.folderName}>{row.name}</Text>}
        <Pressable
          accessibilityLabel={`${row.name} 폴더 이름 수정`}
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
          accessibilityState={{ disabled: disabled || !canAddChild }}
          disabled={disabled || !canAddChild}
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
      </ReanimatedSwipeable>
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

function canCreatePartyPresetChildFolder(
  index: PartyPresetCatalogIndex,
  folderId: number,
): boolean {
  let currentFolderId: number | null = folderId;
  let depth = 0;
  const visited = new Set<number>();
  while (currentFolderId != null) {
    if (visited.has(currentFolderId)) return false;
    visited.add(currentFolderId);
    const folder = index.foldersById.get(currentFolderId);
    if (folder == null) return false;
    currentFolderId = folder.parentFolderId;
    if (currentFolderId != null) depth += 1;
  }
  return depth < MAX_VISIBLE_INDENT;
}

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
  treeConnector: {
    backgroundColor: theme.colors.borderStrong,
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: 2,
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
  renameInput: {
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    color: theme.colors.text,
    flex: 1,
    height: 38,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
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
  swipeContainer: {
    overflow: 'hidden',
  },
  swipeContent: {
    backgroundColor: theme.colors.background,
  },
  swipeDeleteAction: {
    alignItems: 'center',
    backgroundColor: theme.colors.danger,
    justifyContent: 'center',
    width: 72,
  },
  swipeDeleteText: {
    color: theme.colors.buttonText,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 2,
  },
  pressed: {
    opacity: 0.82,
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
