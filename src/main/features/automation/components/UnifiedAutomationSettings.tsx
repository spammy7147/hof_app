import { useCallback, useEffect, useRef, useState, type ElementRef } from 'react';
import {
  AccessibilityInfo,
  Alert,
  findNodeHandle,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Fish, GripVertical, Map, Plus, ScrollText, Shield, Swords, Trash2, Users } from 'lucide-react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import {
  NestableDraggableFlatList,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import {
  AUTOMATION_TYPE_METADATA,
  hasAllAutomationTypes,
} from '../../../domain/typedAutomation';
import { theme } from '../../../styles/theme';
import type { AutomationType, TypedAutomationEntryResponse } from '../../../types/api';
import { AutomationAddSheet } from './AutomationAddSheet';

type Props = {
  entries: TypedAutomationEntryResponse[];
  error: string | null;
  reordering: boolean;
  savingEntryIds: number[];
  savingTypes: AutomationType[];
  onAdd: (type: AutomationType) => Promise<boolean>;
  onDelete: (entryId: number) => Promise<boolean>;
  onDetail: (entry: TypedAutomationEntryResponse) => void;
  onReorder: (entries: TypedAutomationEntryResponse[]) => void;
  onToggle: (entry: TypedAutomationEntryResponse) => void;
};

const DRAG_HANDLE_GESTURE_WIDTH = 48;

export function UnifiedAutomationSettings({
  entries,
  error,
  reordering,
  savingEntryIds,
  savingTypes,
  onAdd,
  onDelete,
  onDetail,
  onReorder,
  onToggle,
}: Props) {
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [listWidth, setListWidth] = useState(0);
  const mountedRef = useRef(false);
  const addTriggerRef = useRef<ElementRef<typeof Pressable>>(null);
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const addGenerationRef = useRef(0);
  const restoreFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allTypesAdded = hasAllAutomationTypes(entries);
  const entryIds = entries.map(({ id }) => id).join(',');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (restoreFocusTimerRef.current) clearTimeout(restoreFocusTimerRef.current);
      openSwipeableRef.current?.close();
      openSwipeableRef.current = null;
    };
  }, []);

  const closeOpenSwipeable = useCallback(() => {
    openSwipeableRef.current?.close();
    openSwipeableRef.current = null;
  }, []);

  const registerOpenSwipeable = useCallback((swipeable: SwipeableMethods | null) => {
    if (openSwipeableRef.current && openSwipeableRef.current !== swipeable) {
      openSwipeableRef.current.close();
    }
    openSwipeableRef.current = swipeable;
  }, []);

  const restoreAddTriggerFocus = useCallback(() => {
    if (restoreFocusTimerRef.current) clearTimeout(restoreFocusTimerRef.current);
    restoreFocusTimerRef.current = setTimeout(() => {
      if (mountedRef.current) focusNode(addTriggerRef.current);
    }, 250);
  }, []);

  const closeAddSheet = useCallback(() => {
    addGenerationRef.current += 1;
    setAddSheetOpen(false);
    restoreAddTriggerFocus();
  }, [restoreAddTriggerFocus]);

  useEffect(() => {
    closeOpenSwipeable();
  }, [closeOpenSwipeable, entryIds]);

  const addEntry = useCallback(async (type: AutomationType) => {
    const addGeneration = addGenerationRef.current;
    const added = await onAdd(type);
    return addGenerationRef.current === addGeneration && added;
  }, [onAdd]);

  const confirmDelete = useCallback((entry: TypedAutomationEntryResponse) => {
    const metadata = AUTOMATION_TYPE_METADATA[entry.type];
    closeOpenSwipeable();
    Alert.alert(
      `${metadata.label} 자동화를 삭제할까요?`,
      '저장한 세부 설정도 함께 삭제됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            void onDelete(entry.id).then((deleted) => {
              if (deleted && mountedRef.current) {
                closeOpenSwipeable();
                restoreAddTriggerFocus();
              }
            });
          },
        },
      ],
    );
  }, [closeOpenSwipeable, onDelete, restoreAddTriggerFocus]);

  const renderItem = useCallback((params: RenderItemParams<TypedAutomationEntryResponse>) => (
    <AutomationEntryRow
      {...params}
      entries={entries}
      reorderBusy={reordering}
      saving={savingEntryIds.includes(params.item.id)}
      onDeleteRequest={confirmDelete}
      onDetail={onDetail}
      onReorder={onReorder}
      onSwipeableOpen={registerOpenSwipeable}
      onToggle={onToggle}
    />
  ), [
    confirmDelete,
    entries,
    onDetail,
    onReorder,
    onToggle,
    registerOpenSwipeable,
    reordering,
    savingEntryIds,
  ]);

  return (
    <View style={styles.stack}>
      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>실행 우선순위</Text>
        <Text style={styles.helper}>위에서부터 실행하며 변경은 다음 작업부터 적용돼요.</Text>
      </View>

      {entries.length === 0 ? (
        <View style={styles.emptyState}>
          <ScrollText color={theme.colors.textMuted} size={24} />
          <View style={styles.emptyCopy}>
            <Text style={styles.emptyTitle}>아직 자동화가 없습니다.</Text>
            <Text style={styles.helper}>필요한 항목만 추가해 실행 순서를 만드세요.</Text>
          </View>
        </View>
      ) : (
        <NestableDraggableFlatList
          activationDistance={20}
          data={entries}
          dragHitSlop={listWidth > DRAG_HANDLE_GESTURE_WIDTH
            ? { right: -(listWidth - DRAG_HANDLE_GESTURE_WIDTH) }
            : undefined}
          keyExtractor={(entry) => String(entry.id)}
          onLayout={(event) => setListWidth(event.nativeEvent.layout.width)}
          onDragEnd={({ data, from, to }) => {
            if (from !== to) onReorder(data);
          }}
          renderItem={renderItem}
          scrollEnabled={false}
        />
      )}

      <Pressable
        ref={addTriggerRef}
        accessibilityHint={allTypesAdded ? '추가할 수 있는 자동화 유형이 없습니다' : '자동화 유형 선택 창을 엽니다'}
        accessibilityLabel={allTypesAdded ? '모든 자동화가 추가되었습니다' : '자동화 추가'}
        accessibilityRole="button"
        accessibilityState={{ disabled: allTypesAdded }}
        disabled={allTypesAdded}
        nativeID="automation-add-trigger"
        onPress={() => {
          closeOpenSwipeable();
          addGenerationRef.current += 1;
          setAddSheetOpen(true);
        }}
        style={({ pressed }) => [
          styles.addButton,
          allTypesAdded && styles.disabled,
          pressed && !allTypesAdded && styles.pressed,
        ]}
      >
        <Plus color={allTypesAdded ? theme.colors.textMuted : theme.colors.accentGreen} size={18} />
        <Text style={[styles.addButtonText, allTypesAdded && styles.addButtonTextDisabled]}>
          {allTypesAdded ? '모든 자동화가 추가되었습니다' : '자동화 추가'}
        </Text>
      </Pressable>
      <Text style={styles.helper}>
        {allTypesAdded
          ? '다른 유형을 추가하려면 기존 자동화를 삭제해 주세요.'
          : '자동화 유형별로 하나씩 추가할 수 있습니다.'}
      </Text>
      {reordering ? <Text style={styles.savingText}>우선순위 저장 중</Text> : null}

      <AutomationAddSheet
        entries={entries}
        error={error}
        onAdd={addEntry}
        onClose={closeAddSheet}
        pendingTypes={savingTypes}
        visible={addSheetOpen}
      />
    </View>
  );
}

type AutomationEntryRowProps = RenderItemParams<TypedAutomationEntryResponse> & {
  entries: readonly TypedAutomationEntryResponse[];
  reorderBusy: boolean;
  saving: boolean;
  onDeleteRequest: (entry: TypedAutomationEntryResponse) => void;
  onDetail: (entry: TypedAutomationEntryResponse) => void;
  onReorder: (entries: TypedAutomationEntryResponse[]) => void;
  onSwipeableOpen: (swipeable: SwipeableMethods | null) => void;
  onToggle: (entry: TypedAutomationEntryResponse) => void;
};

function AutomationEntryRow({
  item,
  drag,
  getIndex,
  isActive,
  entries,
  reorderBusy,
  saving,
  onDeleteRequest,
  onDetail,
  onReorder,
  onSwipeableOpen,
  onToggle,
}: AutomationEntryRowProps) {
  const swipeableRef = useRef<SwipeableMethods>(null);
  const metadata = AUTOMATION_TYPE_METADATA[item.type];
  const summary = getEntrySummary(item);
  const warning = item.warnings[0];
  const index = getIndex() ?? -1;
  const canMoveUp = index > 0;
  const canMoveDown = index >= 0 && index < entries.length - 1;
  const reorderDisabled = saving || reorderBusy;

  function moveEntry(offset: -1 | 1) {
    if (reorderDisabled) return;
    const currentIndex = getIndex() ?? -1;
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= entries.length) return;
    const reordered = [...entries];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    onReorder(reordered);
  }

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      containerStyle={styles.swipeContainer}
      enabled={!saving && !isActive}
      friction={2}
      onSwipeableWillOpen={() => onSwipeableOpen(swipeableRef.current)}
      overshootRight={false}
      renderRightActions={(_progress, _translation, _swipeable) => (
        <Pressable
          accessibilityHint="확인 후 선택한 자동화를 삭제합니다"
          accessibilityLabel={`${metadata.label} 삭제`}
          accessibilityRole="button"
          accessibilityState={{ busy: saving, disabled: saving }}
          disabled={saving}
          onPress={() => onDeleteRequest(item)}
          style={({ pressed }) => [styles.deleteAction, pressed && !saving && styles.pressed]}
        >
          <Trash2 color={theme.colors.buttonText} size={19} />
          <Text style={styles.deleteActionText}>삭제</Text>
        </Pressable>
      )}
      rightThreshold={42}
    >
      <View style={[styles.row, isActive && styles.rowActive]}>
        <Pressable
          accessibilityActions={[
            ...(canMoveUp ? [{ name: 'decrement' as const, label: '위로 이동' }] : []),
            ...(canMoveDown ? [{ name: 'increment' as const, label: '아래로 이동' }] : []),
          ]}
          accessibilityHint="길게 누르거나 접근성 동작으로 위아래로 이동하세요"
          accessibilityLabel={`${metadata.label} 우선순위 이동`}
          accessibilityRole="adjustable"
          accessibilityState={{ disabled: reorderDisabled }}
          delayLongPress={120}
          disabled={reorderDisabled}
          onAccessibilityAction={({ nativeEvent: { actionName } }) => {
            if (actionName === 'decrement') moveEntry(-1);
            if (actionName === 'increment') moveEntry(1);
          }}
          onLongPress={drag}
          style={({ pressed }) => [styles.dragHandle, pressed && styles.pressed]}
        >
          <GripVertical color={theme.colors.textMuted} size={20} />
        </Pressable>
        <Pressable
          accessibilityActions={[{ name: 'delete', label: '삭제' }]}
          accessibilityHint="선택한 자동화의 세부 설정 화면을 엽니다"
          accessibilityLabel={`${metadata.label} 상세 설정`}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving || isActive }}
          disabled={saving || isActive}
          onAccessibilityAction={({ nativeEvent: { actionName } }) => {
            if (actionName === 'delete' && !saving && !isActive) onDeleteRequest(item);
          }}
          onPress={() => {
            swipeableRef.current?.close();
            onDetail(item);
          }}
          style={({ pressed }) => [
            styles.detailButton,
            pressed && !saving && !isActive && styles.pressed,
          ]}
        >
          <View style={styles.typeIcon}><AutomationTypeIcon type={item.type} /></View>
          <View style={styles.rowCopy}>
            <View style={styles.rowTitleLine}>
              <Text numberOfLines={1} style={styles.rowTitle}>{metadata.label}</Text>
              <Text style={[styles.statusChip, !item.ready && styles.warningChip]}>
                {item.ready ? '준비됨' : '확인 필요'}
              </Text>
              {warning ? <Text style={[styles.statusChip, styles.warningChip]}>경고</Text> : null}
            </View>
            <Text numberOfLines={1} style={styles.rowMeta}>{summary}</Text>
            {warning ? (
              <Text
                accessibilityLabel={`경고: ${warning}`}
                numberOfLines={1}
                style={styles.warningText}
              >
                {warning}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Switch
          accessibilityLabel={`${metadata.label} ${item.enabled ? '끄기' : '켜기'}`}
          disabled={saving}
          onValueChange={() => onToggle(item)}
          thumbColor={item.enabled ? theme.colors.buttonText : theme.colors.textMuted}
          trackColor={{ false: theme.colors.border, true: theme.colors.accentGreen }}
          value={item.enabled}
        />
      </View>
    </ReanimatedSwipeable>
  );
}

function focusNode(node: ElementRef<typeof Pressable> | null): void {
  const handle = findNodeHandle(node);
  if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
}

function getEntrySummary(entry: TypedAutomationEntryResponse): string {
  if (entry.type === 'QUEST') return `선택 ${entry.quests.length}개`;
  if (entry.type === 'BATTLE_MAP') return `전투 맵 ${entry.battleMaps.length}개`;
  if (entry.type === 'ADVENTURE_MAP') return `모험 맵 ${entry.adventureMaps.length}개`;
  if (entry.type === 'RAID') return `레이드 ${entry.raidTargets?.length ?? 0}개`;
  if (entry.type === 'UNION') return `유니온 맵 ${entry.unionMaps?.length ?? 0}개`;
  return `낚시 전투 맵 ${entry.fishingMaps?.length ?? 0}개`;
}

function AutomationTypeIcon({ type }: { type: AutomationType }) {
  const iconProps = { color: theme.colors.accentGreen, size: 18 };
  if (type === 'QUEST') return <ScrollText {...iconProps} />;
  if (type === 'BATTLE_MAP') return <Swords {...iconProps} />;
  if (type === 'ADVENTURE_MAP') return <Map {...iconProps} />;
  if (type === 'RAID') return <Shield {...iconProps} />;
  if (type === 'UNION') return <Users {...iconProps} />;
  return <Fish {...iconProps} />;
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing.md },
  listHeader: { gap: 2 },
  sectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '900' },
  helper: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  emptyState: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: theme.radius.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 84, padding: theme.spacing.md },
  emptyCopy: { flex: 1 },
  emptyTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  swipeContainer: { borderRadius: theme.radius.md + 4, marginBottom: theme.spacing.sm, overflow: 'hidden' },
  row: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md + 4, borderWidth: 1, flexDirection: 'row', gap: 5, minHeight: 70, paddingHorizontal: 5 },
  rowActive: { borderColor: theme.colors.accentGreen, opacity: 0.96 },
  dragHandle: { alignItems: 'center', height: 44, justifyContent: 'center', width: 32 },
  detailButton: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 5, minWidth: 0 },
  typeIcon: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, height: 36, justifyContent: 'center', width: 36 },
  rowCopy: { flex: 1, minWidth: 0, paddingVertical: theme.spacing.sm },
  rowTitleLine: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  rowTitle: { color: theme.colors.text, flexShrink: 1, fontSize: 14, fontWeight: '900' },
  rowMeta: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4 },
  warningText: { color: theme.colors.accentAmber, fontSize: 10, marginTop: 3 },
  statusChip: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, color: theme.colors.accentGreen, fontSize: 9, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3 },
  warningChip: { color: theme.colors.accentAmber },
  deleteAction: { alignItems: 'center', backgroundColor: theme.colors.danger, gap: 3, justifyContent: 'center', width: 82 },
  deleteActionText: { color: theme.colors.buttonText, fontSize: 12, fontWeight: '900' },
  addButton: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md + 6, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'center', minHeight: 54, paddingHorizontal: theme.spacing.md },
  addButtonText: { color: theme.colors.accentGreen, fontSize: 14, fontWeight: '900' },
  addButtonTextDisabled: { color: theme.colors.textMuted },
  savingText: { color: theme.colors.textMuted, fontSize: 11, textAlign: 'right' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
});
