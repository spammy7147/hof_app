import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GripVertical, Trash2 } from 'lucide-react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import DraggableFlatList, {
  NestableDraggableFlatList,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import { theme } from '../../../styles/theme';

export type AutomationMapOrderListProps<T extends object> = {
  data: readonly T[];
  disabled: boolean;
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  onDelete: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  onReorder: (orderedIds: string[]) => void;
  renderContent: (item: T, context: { disabled: boolean; index: number }) => ReactNode;
  compact?: boolean;
  nested?: boolean;
};

type Row<T> = { id: string; item: T };
const DRAG_HANDLE_GESTURE_WIDTH = 44;

export function AutomationMapOrderList<T extends object>({
  data,
  disabled,
  getId,
  getLabel,
  onDelete,
  onMove,
  onReorder,
  renderContent,
  compact = false,
  nested = false,
}: AutomationMapOrderListProps<T>) {
  const [dragging, setDragging] = useState(false);
  const [listWidth, setListWidth] = useState(0);
  const disabledRef = useRef(disabled);
  const draggingRef = useRef(dragging);
  const interactionGenerationRef = useRef(0);
  const interactionContextRef = useRef({ data, disabled });
  const activeDragGenerationRef = useRef<number | null>(null);
  const rowsRef = useRef<Row<T>[]>([]);
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const swipeableNodesRef = useRef(new Map<string, SwipeableMethods>());

  if (interactionContextRef.current.data !== data || interactionContextRef.current.disabled !== disabled) {
    interactionGenerationRef.current += 1;
    interactionContextRef.current = { data, disabled };
  }
  const renderInteractionGeneration = interactionGenerationRef.current;
  const rows = useMemo(() => data.map((item) => ({ id: getId(item), item })), [data, getId]);
  rowsRef.current = rows;
  disabledRef.current = disabled;
  draggingRef.current = dragging;

  const closeOpenSwipeable = useCallback(() => {
    openSwipeableRef.current?.close();
    openSwipeableRef.current = null;
  }, []);

  useEffect(() => {
    closeOpenSwipeable();
    activeDragGenerationRef.current = null;
    draggingRef.current = false;
    setDragging(false);
  }, [closeOpenSwipeable, data, disabled]);

  useEffect(() => () => {
    closeOpenSwipeable();
    swipeableNodesRef.current.clear();
  }, [closeOpenSwipeable]);

  function findCurrentRow(id: string, capturedItem: T, generation: number): Row<T> | null {
    if (generation !== interactionGenerationRef.current) return null;
    const liveRow = rowsRef.current.find((row) => row.id === id);
    return liveRow?.item === capturedItem ? liveRow : null;
  }

  function renderRow({ item: row, drag, getIndex, isActive }: RenderItemParams<Row<T>>) {
    const index = getIndex() ?? rowsRef.current.findIndex(({ id }) => id === row.id);
    const interactionDisabled = disabled || dragging || isActive;
    const accessibilityActions = [
      ...(index > 0 ? [{ name: 'decrement' as const, label: '위로 이동' }] : []),
      ...(index >= 0 && index < rows.length - 1 ? [{ name: 'increment' as const, label: '아래로 이동' }] : []),
      { name: 'delete' as const, label: '삭제' },
    ];

    const deleteRow = () => {
      if (disabledRef.current || draggingRef.current) return;
      if (!findCurrentRow(row.id, row.item, renderInteractionGeneration)) return;
      closeOpenSwipeable();
      onDelete(row.id);
    };

    return (
      <ReanimatedSwipeable
        ref={(node) => {
          if (node) swipeableNodesRef.current.set(row.id, node);
          else swipeableNodesRef.current.delete(row.id);
        }}
        containerStyle={styles.swipeContainer}
        enabled={!interactionDisabled}
        friction={2}
        onSwipeableWillOpen={() => {
          if (!findCurrentRow(row.id, row.item, renderInteractionGeneration)) return;
          const next = swipeableNodesRef.current.get(row.id) ?? null;
          if (openSwipeableRef.current && openSwipeableRef.current !== next) {
            openSwipeableRef.current.close();
          }
          openSwipeableRef.current = next;
        }}
        overshootRight={false}
        renderRightActions={() => (
          <Pressable
            accessibilityLabel={`${getLabel(row.item)} 삭제`}
            accessibilityRole="button"
            accessibilityState={{ disabled: interactionDisabled }}
            disabled={interactionDisabled}
            onPress={deleteRow}
            style={({ pressed }) => [styles.deleteAction, pressed && !interactionDisabled && styles.pressed]}
          >
            <Trash2 color={theme.colors.buttonText} size={18} />
            <Text style={styles.deleteText}>삭제</Text>
          </Pressable>
        )}
        rightThreshold={40}
      >
        <View style={[styles.card, isActive && styles.activeCard]}>
          <Pressable
            accessibilityActions={accessibilityActions}
            accessibilityHint="길게 누르거나 접근성 동작으로 순서를 바꾸세요"
            accessibilityLabel={`${getLabel(row.item)} ${index + 1}번째 맵 순서 이동`}
            accessibilityRole="adjustable"
            accessibilityState={{ disabled: interactionDisabled }}
            accessibilityValue={{ min: 1, max: rows.length, now: index + 1 }}
            delayLongPress={120}
            disabled={interactionDisabled}
            onAccessibilityAction={({ nativeEvent: { actionName } }) => {
              if (disabledRef.current || draggingRef.current) return;
              if (!findCurrentRow(row.id, row.item, renderInteractionGeneration)) return;
              if (actionName === 'decrement') onMove(row.id, -1);
              if (actionName === 'increment') onMove(row.id, 1);
              if (actionName === 'delete') deleteRow();
            }}
            onLongPress={() => {
              if (disabledRef.current || draggingRef.current) return;
              if (!findCurrentRow(row.id, row.item, renderInteractionGeneration)) return;
              closeOpenSwipeable();
              activeDragGenerationRef.current = renderInteractionGeneration;
              draggingRef.current = true;
              setDragging(true);
              drag();
            }}
            style={({ pressed }) => [styles.handle, pressed && !interactionDisabled && styles.pressed]}
          >
            <GripVertical color={theme.colors.textMuted} size={18} />
          </Pressable>
          <View style={[styles.content, compact && styles.compactContent]}>{renderContent(row.item, { disabled: interactionDisabled, index })}</View>
        </View>
      </ReanimatedSwipeable>
    );
  }

  const listProps = {
    activationDistance: nested ? 20 : 8,
    data: rows,
    dragHitSlop: listWidth > DRAG_HANDLE_GESTURE_WIDTH
      ? { right: -(listWidth - DRAG_HANDLE_GESTURE_WIDTH) }
      : undefined,
    ItemSeparatorComponent: compact ? CompactMapRowSeparator : MapRowSeparator,
    keyExtractor: ({ id }: Row<T>) => id,
    onLayout: (event: { nativeEvent: { layout: { width: number } } }) => {
      setListWidth(event.nativeEvent.layout.width);
    },
    onDragBegin: () => {
      if (disabledRef.current || renderInteractionGeneration !== interactionGenerationRef.current) return;
      closeOpenSwipeable();
      activeDragGenerationRef.current = renderInteractionGeneration;
      draggingRef.current = true;
      setDragging(true);
    },
    onDragEnd: ({ data: orderedRows, from, to }: { data: Row<T>[]; from: number; to: number }) => {
      closeOpenSwipeable();
      const activeDragGeneration = activeDragGenerationRef.current;
      activeDragGenerationRef.current = null;
      draggingRef.current = false;
      setDragging(false);
      if (disabledRef.current
        || activeDragGeneration !== renderInteractionGeneration
        || renderInteractionGeneration !== interactionGenerationRef.current
        || from === to) return;
      onReorder(orderedRows.map(({ id }) => id));
    },
    renderItem: renderRow,
    scrollEnabled: false,
  };
  return nested
    ? <NestableDraggableFlatList {...listProps} />
    : <DraggableFlatList {...listProps} />;
}

function MapRowSeparator() {
  return <View style={styles.separator} />;
}

function CompactMapRowSeparator() {
  return <View style={styles.compactSeparator} />;
}

const styles = StyleSheet.create({
  swipeContainer: { borderCurve: 'continuous', borderRadius: theme.radius.md, overflow: 'hidden' },
  card: {
    alignItems: 'stretch',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderCurve: 'continuous',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
  },
  activeCard: { borderColor: theme.colors.accentGreen, opacity: 0.82 },
  handle: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 },
  content: {
    flex: 1,
    minWidth: 0,
    paddingBottom: theme.spacing.xs,
    paddingRight: theme.spacing.xs,
    paddingTop: theme.spacing.xs,
  },
  compactContent: { paddingBottom: 2, paddingTop: 2 },
  deleteAction: { alignItems: 'center', backgroundColor: theme.colors.danger, justifyContent: 'center', width: 72 },
  deleteText: { color: theme.colors.buttonText, fontSize: 11, fontWeight: '900', marginTop: 2 },
  separator: { height: theme.spacing.sm },
  compactSeparator: { height: theme.spacing.xs },
  pressed: { opacity: 0.72 },
});
