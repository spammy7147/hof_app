import { CompactSwitch as Switch } from '../../../components/CompactSwitch';
import { useCallback, useEffect, useRef, useState, type ElementRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppAlert as Alert } from '../../../platform/AppAlert';
import { ChevronDown, ChevronRight, Fish, GripVertical, House, Map, Plus, ScrollText, Shield, Swords, Trash2, Users } from 'lucide-react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import {
  NestableDraggableFlatList,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import { usePickerFocusReturn } from '../../../platform/usePickerFocusReturn';

import {
  automationEntryDisplayName,
  hasAllAutomationTypes,
} from '../../../domain/typedAutomation';
import { theme } from '../../../styles/theme';
import type { AutomationType, TypedAutomationEntryResponse } from '../../../types/api';
import { AutomationAddSheet } from './AutomationAddSheet';

type Props = {
  draftMode?: boolean;
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
  draftMode = false,
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
  const [showHelp, setShowHelp] = useState(false);
  const [listWidth, setListWidth] = useState(0);
  const mountedRef = useRef(false);
  const addTriggerRef = useRef<ElementRef<typeof Pressable>>(null);
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const addGenerationRef = useRef(0);
  const allTypesAdded = hasAllAutomationTypes(entries);
  const entryIds = entries.map(({ id }) => id).join(',');
  const { open: captureFocus, close: restoreFocus } = usePickerFocusReturn<undefined>({
    getTarget: () => addTriggerRef.current,
    canRestore: () => !addSheetOpen && !allTypesAdded,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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

  const closeAddSheet = useCallback(() => {
    addGenerationRef.current += 1;
    setAddSheetOpen(false);
    restoreFocus();
  }, [restoreFocus]);

  useEffect(() => {
    closeOpenSwipeable();
  }, [closeOpenSwipeable, entryIds]);

  const addEntry = useCallback(async (type: AutomationType) => {
    const addGeneration = addGenerationRef.current;
    const added = await onAdd(type);
    return addGenerationRef.current === addGeneration && added;
  }, [onAdd]);

  const confirmDelete = useCallback((entry: TypedAutomationEntryResponse) => {
    const displayName = automationEntryDisplayName(entry, entries);
    closeOpenSwipeable();
    Alert.alert(
      `${displayName} 자동화를 삭제할까요?`,
      draftMode ? '프리셋 초안에서 이 항목을 제거합니다. 전체 저장하면 저장본에 반영됩니다.' : '저장한 세부 설정도 함께 삭제됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            const generation = ++addGenerationRef.current;
            captureFocus(undefined);
            void onDelete(entry.id).then((deleted) => {
              if (deleted && mountedRef.current && addGenerationRef.current === generation) {
                closeOpenSwipeable();
                restoreFocus();
              }
            });
          },
        },
      ],
    );
  }, [captureFocus, closeOpenSwipeable, draftMode, entries, onDelete, restoreFocus]);

  const renderItem = useCallback((params: RenderItemParams<TypedAutomationEntryResponse>) => (
    <AutomationEntryRow
      {...params}
      draftMode={draftMode}
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
    draftMode,
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
        <View style={styles.headingRow}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{draftMode ? '자동화 항목' : '판단 순서'}</Text>
          <Text style={styles.helper}>{entries.length}개 · {entries.filter(entry => entry.enabled).length}개 켜짐</Text>
        </View>
        <Text style={styles.helper}>위에서부터 판단 · 왼쪽을 길게 눌러 순서 변경</Text>
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
          if (allTypesAdded) return;
          closeOpenSwipeable();
          addGenerationRef.current += 1;
          captureFocus(undefined);
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
      <Pressable accessibilityRole="button" accessibilityLabel="자동화 구성 도움말"
        accessibilityState={{ expanded: showHelp }} onPress={() => setShowHelp(value => !value)} style={styles.helpToggle}>
        <Text style={styles.helper}>판단 순서와 저장 한도 안내</Text>
        <ChevronDown color={theme.colors.textMuted} size={16} style={showHelp ? styles.chevronOpen : undefined} />
      </Pressable>
      {showHelp ? <View style={styles.helpContent}>
        <Text style={styles.helper}>상위 항목이 계속 실행 가능하면 아래 항목은 기다릴 수 있어요.</Text>
        <Text style={styles.helper}>전투맵·모험맵은 여러 맵 묶음을, 다른 유형은 하나씩 추가할 수 있어요.</Text>
        <Text style={styles.helper}>자동화 항목은 100개, 맵은 유형별 전체 묶음 합계 100개까지 저장할 수 있어요.</Text>
        <Text style={styles.helper}>항목을 왼쪽으로 밀면 삭제할 수 있어요.</Text>
      </View> : null}
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
  draftMode: boolean;
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
  draftMode,
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
  const displayName = automationEntryDisplayName(item, entries);
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
          accessibilityLabel={`${displayName} 삭제`}
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
          accessibilityLabel={`${displayName} 우선순위 이동`}
          accessibilityRole="adjustable"
          accessibilityValue={index >= 0 ? { min: 1, max: entries.length, now: index + 1 } : undefined}
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
          {draftMode && index >= 0 ? <Text style={styles.orderNumber}>{index + 1}</Text> : null}
          <GripVertical color={theme.colors.textMuted} size={draftMode ? 14 : 20} />
        </Pressable>
        <Pressable
          accessibilityActions={[{ name: 'delete', label: '삭제' }]}
          accessibilityHint="선택한 자동화의 세부 설정 화면을 엽니다"
          accessibilityLabel={`${displayName} 상세 설정`}
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
              <Text numberOfLines={1} style={styles.rowTitle}>{displayName}</Text>
              {!draftMode ? <Text style={[styles.statusChip, !item.ready && styles.warningChip]}>
                {item.ready ? '준비됨' : '확인 필요'}
              </Text> : null}
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
          <ChevronRight color={theme.colors.textMuted} size={14} />
        </Pressable>
        <Switch
          accessibilityLabel={`${displayName} ${item.enabled ? '끄기' : '켜기'}`}
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

function getEntrySummary(entry: TypedAutomationEntryResponse): string {
  if (entry.type === 'QUEST') return `선택 ${entry.quests.length}개`;
  if (entry.type === 'COLOSSEUM') return '저장된 5인 팀 · 쿨다운마다 랭킹 도전';
  if (entry.type === 'HOME_QUEST') return `자택 퀘스트 ${entry.homeQuests?.length ?? 0}개`;
  if (entry.type === 'BATTLE_MAP') return `전투 맵 ${entry.battleMaps.length}개`;
  if (entry.type === 'ADVENTURE_MAP') return `모험 맵 ${entry.adventureMaps.length}개`;
  if (entry.type === 'RAID') return `레이드 ${entry.raidTargets?.length ?? 0}개`;
  if (entry.type === 'UNION') return `유니온 맵 ${entry.unionMaps?.length ?? 0}개`;
  return `낚시 전투 맵 ${entry.fishingMaps?.length ?? 0}개`;
}

function AutomationTypeIcon({ type }: { type: AutomationType }) {
  const iconProps = { color: theme.colors.accentGreen, size: 18 };
  if (type === 'QUEST') return <ScrollText {...iconProps} />;
  if (type === 'HOME_QUEST') return <House {...iconProps} />;
  if (type === 'BATTLE_MAP' || type === 'COLOSSEUM') return <Swords {...iconProps} />;
  if (type === 'ADVENTURE_MAP') return <Map {...iconProps} />;
  if (type === 'RAID') return <Shield {...iconProps} />;
  if (type === 'UNION') return <Users {...iconProps} />;
  return <Fish {...iconProps} />;
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing.md },
  listHeader: { gap: theme.spacing.hairline },
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.xs, marginBottom: theme.spacing.hairline },
  sectionTitle: { color: theme.colors.text, fontSize: theme.fontSize.section, fontWeight: '900' },
  helper: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption },
  emptyState: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: theme.radius.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 50, padding: theme.spacing.md },
  emptyCopy: { flex: 1 },
  emptyTitle: { color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: '800' },
  swipeContainer: { borderRadius: theme.radius.md, marginBottom: theme.layout.rowGap, overflow: 'hidden' },
  row: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, minHeight: theme.control.denseRow, paddingHorizontal: theme.spacing.xs },
  rowActive: { borderColor: theme.colors.accentGreen, opacity: 0.96 },
  dragHandle: { alignItems: 'center', minHeight: theme.control.touch, justifyContent: 'center', gap: 0, width: theme.control.touch, minWidth: theme.control.touch, },
  orderNumber: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, fontWeight: '700', fontVariant: ['tabular-nums'] },
  detailButton: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.sm, minWidth: theme.control.touch, minHeight: theme.control.touch, },
  typeIcon: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, height: theme.icon.decoration, justifyContent: 'center', width: theme.icon.decoration },
  rowCopy: { flex: 1, minWidth: 0, paddingVertical: theme.spacing.sm },
  rowTitleLine: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  rowTitle: { color: theme.colors.text, flexShrink: 1, fontSize: theme.fontSize.body, fontWeight: '900', lineHeight: theme.lineHeight.body, },
  rowMeta: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, marginTop: 0, lineHeight: theme.lineHeight.compact, },
  warningText: { color: theme.colors.accentAmber, fontSize: theme.fontSize.small, marginTop: theme.spacing.hairline },
  statusChip: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, color: theme.colors.accentGreen, fontSize: theme.fontSize.micro, fontWeight: '800', overflow: 'hidden', paddingHorizontal: theme.spacing.xs, paddingVertical: theme.spacing.hairline },
  warningChip: { color: theme.colors.accentAmber },
  deleteAction: { alignItems: 'center', backgroundColor: theme.colors.danger, gap: theme.spacing.hairline, justifyContent: 'center', width: 82, minHeight: theme.control.touch, minWidth: theme.control.touch, },
  deleteActionText: { color: theme.colors.buttonText, fontSize: theme.fontSize.caption, fontWeight: '900' },
  addButton: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'center', minHeight: theme.control.touch, paddingHorizontal: theme.spacing.md, minWidth: theme.control.touch, },
  addButtonText: { color: theme.colors.accentGreen, fontSize: theme.fontSize.body, fontWeight: '900' },
  addButtonTextDisabled: { color: theme.colors.textMuted },
  savingText: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, textAlign: 'right' },
  helpToggle: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, minHeight: theme.control.touch, minWidth: theme.control.touch, },
  helpContent: { gap: theme.spacing.sm, backgroundColor: theme.colors.header, padding: theme.spacing.md, borderRadius: theme.radius.md },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
});
