import { useCallback, useEffect, useRef, useState, type ElementRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GripVertical, Trash2 } from 'lucide-react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';

import { getAccessibilityFocusTarget, focusAccessibilityTarget } from '../../../platform/accessibilityFocus';

import {
  buildQuestMapIdentity,
  moveMissionMap,
  removeMissionMap,
  reorderMissionMaps,
  type QuestMapDraft,
  type QuestMapMode,
} from '../../../domain/questAutomation';
import { formatAutomationPresetSelection } from '../../../domain/partyPresets';
import { theme } from '../../../styles/theme';
import type { BattleMapResponse, PartyPresetCatalogResponse, QuestMapSettingRequest } from '../../../types/api';
import { BattleMapPresetPickerModal } from './BattleMapPresetPickerModal';

export type QuestMissionMapListProps = {
  allowMapMutations?: boolean;
  catalog: BattleMapResponse[];
  disabled: boolean;
  maps: QuestMapSettingRequest[];
  missionKey: string;
  partyPresetCatalog: PartyPresetCatalogResponse;
  questContext: string;
  onUpdate: (maps: QuestMapSettingRequest[]) => void;
};

type PresetInvocation = {
  interactionGeneration: number;
  map: QuestMapSettingRequest;
  rowKey: string;
  nodeHandle: ReturnType<typeof getAccessibilityFocusTarget>;
};

type MissionMapRow = {
  identity: string;
  index: number;
  map: QuestMapSettingRequest;
  rowKey: string;
};

const DRAG_HANDLE_GESTURE_WIDTH = 48;

function buildMissionMapRows(maps: readonly QuestMapSettingRequest[]): MissionMapRow[] {
  const occurrences = new Map<string, number>();
  return maps.map((map, index) => {
    const identity = buildQuestMapIdentity(map);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { identity, index, map, rowKey: `${identity}\u0000${occurrence}` };
  });
}

export function QuestMissionMapList({
  allowMapMutations = true,
  catalog,
  disabled,
  maps,
  missionKey,
  partyPresetCatalog,
  questContext,
  onUpdate,
}: QuestMissionMapListProps) {
  const [activePresetRowKey, setActivePresetRowKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [listWidth, setListWidth] = useState(0);
  const mountedRef = useRef(false);
  const disabledRef = useRef(disabled);
  const draggingRef = useRef(dragging);
  const allowMapMutationsRef = useRef(allowMapMutations);
  const interactionGenerationRef = useRef(0);
  const interactionContextRef = useRef({ disabled, maps, missionKey });
  const activeDragGenerationRef = useRef<number | null>(null);
  const mapsRef = useRef(maps);
  const rowsRef = useRef<MissionMapRow[]>([]);
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const swipeableNodesRef = useRef(new Map<string, SwipeableMethods>());
  const activePresetRowKeyRef = useRef<string | null>(null);
  const presetTriggerNodesRef = useRef(new Map<string, ElementRef<typeof Pressable>>());
  const invokingPresetTriggerRef = useRef<PresetInvocation | null>(null);
  const presetFocusGenerationRef = useRef(0);
  const restorePresetFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  disabledRef.current = disabled;
  draggingRef.current = dragging;
  allowMapMutationsRef.current = allowMapMutations;
  mapsRef.current = maps;
  const previousInteractionContext = interactionContextRef.current;
  if (
    previousInteractionContext.disabled !== disabled
    || previousInteractionContext.maps !== maps
    || previousInteractionContext.missionKey !== missionKey
  ) {
    interactionGenerationRef.current += 1;
    interactionContextRef.current = { disabled, maps, missionKey };
  }
  const renderInteractionGeneration = interactionGenerationRef.current;
  const rows = buildMissionMapRows(maps);
  const canReorder = allowMapMutations && rows.length > 1;
  rowsRef.current = rows;
  activePresetRowKeyRef.current = activePresetRowKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      openSwipeableRef.current?.close();
      openSwipeableRef.current = null;
      swipeableNodesRef.current.clear();
      presetFocusGenerationRef.current += 1;
      invokingPresetTriggerRef.current = null;
      if (restorePresetFocusTimerRef.current) {
        clearTimeout(restorePresetFocusTimerRef.current);
        restorePresetFocusTimerRef.current = null;
      }
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

  useEffect(() => {
    closeOpenSwipeable();
    activeDragGenerationRef.current = null;
    draggingRef.current = false;
    setDragging(false);
  }, [closeOpenSwipeable, disabled, maps, missionKey]);

  const closePresetPicker = useCallback((restoreFocus: boolean) => {
    const focusGeneration = ++presetFocusGenerationRef.current;
    const invocation = invokingPresetTriggerRef.current;
    activePresetRowKeyRef.current = null;
    setActivePresetRowKey(null);
    if (restorePresetFocusTimerRef.current) {
      clearTimeout(restorePresetFocusTimerRef.current);
      restorePresetFocusTimerRef.current = null;
    }
    if (!restoreFocus || !invocation) {
      invokingPresetTriggerRef.current = null;
      return;
    }
    restorePresetFocusTimerRef.current = setTimeout(() => {
      restorePresetFocusTimerRef.current = null;
      const clearInvocation = () => {
        if (invokingPresetTriggerRef.current === invocation) invokingPresetTriggerRef.current = null;
      };
      if (
        !mountedRef.current
        || disabledRef.current
        || activePresetRowKeyRef.current != null
        || presetFocusGenerationRef.current !== focusGeneration
        || !rowsRef.current.some((row) => row.rowKey === invocation.rowKey)
      ) {
        clearInvocation();
        return;
      }
      const liveNode = presetTriggerNodesRef.current.get(invocation.rowKey) ?? null;
      const liveHandle = getAccessibilityFocusTarget(liveNode);
      if (liveHandle != null && liveHandle === invocation.nodeHandle) {
        focusAccessibilityTarget(liveHandle);
      }
      clearInvocation();
    }, 250);
  }, []);

  const openPresetPicker = useCallback((rowKey: string, map: QuestMapSettingRequest, interactionGeneration: number) => {
    if (
      disabledRef.current
      || interactionGeneration !== interactionGenerationRef.current
      || !rowsRef.current.some((row) => row.rowKey === rowKey && row.map === map)
    ) return;
    presetFocusGenerationRef.current += 1;
    if (restorePresetFocusTimerRef.current) {
      clearTimeout(restorePresetFocusTimerRef.current);
      restorePresetFocusTimerRef.current = null;
    }
    const triggerNode = presetTriggerNodesRef.current.get(rowKey) ?? null;
    invokingPresetTriggerRef.current = {
      interactionGeneration,
      map,
      rowKey,
      nodeHandle: getAccessibilityFocusTarget(triggerNode),
    };
    activePresetRowKeyRef.current = rowKey;
    setActivePresetRowKey(rowKey);
  }, []);

  const activePresetRow = activePresetRowKey == null
    ? null
    : rows.find((row) => row.rowKey === activePresetRowKey) ?? null;
  const activePresetMap = activePresetRow?.map.mapCode.trim() ? activePresetRow.map : null;
  const activePresetInvocation = invokingPresetTriggerRef.current;
  const activePresetInvocationValid = activePresetInvocation != null
    && activePresetInvocation.interactionGeneration === interactionGenerationRef.current
    && activePresetRow?.map === activePresetInvocation.map;
  const activeCatalogMap = activePresetRow == null
    ? null
    : catalog.find((map) => buildQuestMapIdentity(map) === activePresetRow.identity) ?? null;

  useEffect(() => {
    if (activePresetRowKey != null && (disabled || activePresetMap == null || !activePresetInvocationValid)) {
      closePresetPicker(false);
    }
  }, [activePresetInvocationValid, activePresetMap, activePresetRowKey, closePresetPicker, disabled]);

  function selectPreset(partyPresetId: number | null) {
    if (disabledRef.current) return;
    const rowKey = activePresetRowKeyRef.current;
    const invocation = invokingPresetTriggerRef.current;
    if (rowKey == null || invocation == null) return;
    const currentMaps = mapsRef.current;
    const targetRow = rowsRef.current.find((row) => row.rowKey === rowKey);
    if (
      !targetRow
      || invocation.rowKey !== rowKey
      || invocation.interactionGeneration !== interactionGenerationRef.current
      || targetRow.map !== invocation.map
    ) {
      closePresetPicker(false);
      return;
    }
    onUpdate(currentMaps.map((map, index) => index !== targetRow.index ? map : partyPresetId == null
      ? { ...map, presetMode: 'PRIMARY', partyPresetId: null }
      : { ...map, presetMode: 'EXPLICIT', partyPresetId }));
    closePresetPicker(true);
  }

  function findCurrentRow(rowKey: string, capturedMap: QuestMapSettingRequest, generation: number) {
    if (generation !== interactionGenerationRef.current) return null;
    const liveRow = rowsRef.current.find((row) => row.rowKey === rowKey);
    return liveRow?.map === capturedMap ? liveRow : null;
  }

  function moveRow(rowKey: string, capturedMap: QuestMapSettingRequest, generation: number, offset: -1 | 1) {
    if (!allowMapMutationsRef.current || disabledRef.current || draggingRef.current) return;
    const liveRow = findCurrentRow(rowKey, capturedMap, generation);
    if (!liveRow) return;
    const targetIndex = liveRow.index + offset;
    if (targetIndex < 0 || targetIndex >= mapsRef.current.length) return;
    onUpdate(moveMissionMap(mapsRef.current, liveRow.index, targetIndex));
  }

  function deleteRow(rowKey: string, capturedMap: QuestMapSettingRequest, generation: number) {
    if (!allowMapMutationsRef.current || disabledRef.current || draggingRef.current) return;
    const liveRow = findCurrentRow(rowKey, capturedMap, generation);
    if (!liveRow) return;
    closeOpenSwipeable();
    onUpdate(removeMissionMap(mapsRef.current, liveRow.index));
  }

  function beginDrag(rowKey: string, capturedMap: QuestMapSettingRequest, generation: number, drag: () => void) {
    if (!allowMapMutationsRef.current || disabledRef.current || draggingRef.current) return;
    if (!findCurrentRow(rowKey, capturedMap, generation)) return;
    const rowSwipeable = swipeableNodesRef.current.get(rowKey) ?? null;
    if (rowSwipeable !== openSwipeableRef.current) rowSwipeable?.close();
    closeOpenSwipeable();
    activeDragGenerationRef.current = generation;
    draggingRef.current = true;
    setDragging(true);
    drag();
  }

  function renderMapRow({ item: { identity, map, rowKey }, drag, getIndex, isActive }: RenderItemParams<MissionMapRow>) {
    const resolved = catalog.find((candidate) => buildQuestMapIdentity(candidate) === identity);
    const presetLabel = formatAutomationPresetSelection(map, partyPresetCatalog.presets);
    const category = map.categoryId === 'battle_map'
      ? '전투맵'
      : map.categoryId === 'adventure_map'
        ? '모험맵'
        : map.categoryId;
    const index = getIndex() ?? rowsRef.current.find((row) => row.rowKey === rowKey)?.index ?? -1;
    const mapName = resolved?.name ?? (map.mapCode || '맵을 선택해 주세요');
    const interactionDisabled = disabled || dragging || isActive;
    const accessibilityActions = allowMapMutations ? [
      ...(index > 0 ? [{ name: 'decrement' as const, label: '위로 이동' }] : []),
      ...(index >= 0 && index < rows.length - 1 ? [{ name: 'increment' as const, label: '아래로 이동' }] : []),
      { name: 'delete' as const, label: '삭제' },
    ] : [];
    const accessibilityPrefix = missionKey ? `${questContext} · ${missionKey}` : questContext;

    const mapCard = (
      <View key={rowKey} style={[styles.mapCard, isActive && styles.mapCardActive]}>
        {canReorder ? <Pressable
          accessibilityActions={accessibilityActions}
          accessibilityHint="길게 누르거나 접근성 동작으로 순서를 바꾸세요"
          accessibilityLabel={`${accessibilityPrefix} ${index + 1}번째 맵 순서 이동`}
          accessibilityRole="adjustable"
          accessibilityState={{ disabled: interactionDisabled }}
          delayLongPress={120}
          disabled={interactionDisabled}
          onAccessibilityAction={({ nativeEvent: { actionName } }) => {
            if (actionName === 'decrement') moveRow(rowKey, map, renderInteractionGeneration, -1);
            if (actionName === 'increment') moveRow(rowKey, map, renderInteractionGeneration, 1);
            if (actionName === 'delete') deleteRow(rowKey, map, renderInteractionGeneration);
          }}
          onLongPress={() => beginDrag(rowKey, map, renderInteractionGeneration, drag)}
          style={({ pressed }) => [styles.dragHandle, pressed && !interactionDisabled && styles.pressed]}
        >
          <GripVertical color={theme.colors.textMuted} size={18} />
        </Pressable> : null}
        <View style={styles.mapBody}>
          <View style={styles.mapCopy}>
            <Text style={styles.mapName}>{mapName}</Text>
            {resolved?.groupName || category ? <Text style={styles.mapContext}>{[resolved?.groupName, category].filter(Boolean).join(' · ')}</Text> : null}
          </View>
          {map.mapCode.trim() ? (
            <Pressable
              ref={(node) => {
                if (node) presetTriggerNodesRef.current.set(rowKey, node);
                else presetTriggerNodesRef.current.delete(rowKey);
              }}
              accessibilityLabel={`${accessibilityPrefix} ${index + 1}번째 맵 프리셋 선택`}
              accessibilityRole="button"
              accessibilityState={{ disabled: interactionDisabled }}
              accessibilityValue={{ text: presetLabel }}
              disabled={interactionDisabled}
              hitSlop={5}
              onPress={() => {
                if (!findCurrentRow(rowKey, map, renderInteractionGeneration)) return;
                swipeableNodesRef.current.get(rowKey)?.close();
                openPresetPicker(rowKey, map, renderInteractionGeneration);
              }}
              style={styles.presetButton}
            >
              <Text style={styles.presetButtonText}>{presetLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );

    if (!allowMapMutations) return mapCard;

    return (
      <ReanimatedSwipeable
        key={rowKey}
        ref={(node) => {
          if (node) swipeableNodesRef.current.set(rowKey, node);
          else swipeableNodesRef.current.delete(rowKey);
        }}
        containerStyle={styles.swipeContainer}
        enabled={allowMapMutations && !interactionDisabled}
        friction={2}
        onSwipeableWillOpen={() => {
          if (findCurrentRow(rowKey, map, renderInteractionGeneration)) {
            registerOpenSwipeable(swipeableNodesRef.current.get(rowKey) ?? null);
          }
        }}
        overshootRight={false}
        renderRightActions={() => (
          <Pressable
            accessibilityLabel={`${accessibilityPrefix} · ${mapName} 삭제`}
            accessibilityRole="button"
            accessibilityState={{ disabled: interactionDisabled }}
            disabled={interactionDisabled}
            onPress={() => deleteRow(rowKey, map, renderInteractionGeneration)}
            style={({ pressed }) => [styles.deleteAction, pressed && !interactionDisabled && styles.pressed]}
          >
            <Trash2 color={theme.colors.buttonText} size={18} />
            <Text style={styles.deleteActionText}>삭제</Text>
          </Pressable>
        )}
        rightThreshold={40}
      >
        {mapCard}
      </ReanimatedSwipeable>
    );
  }

  return (
    <>
      {canReorder ? <DraggableFlatList
        activationDistance={8}
        data={rows}
        dragHitSlop={listWidth > DRAG_HANDLE_GESTURE_WIDTH
          ? { right: -(listWidth - DRAG_HANDLE_GESTURE_WIDTH) }
          : undefined}
        keyExtractor={(row) => `${missionKey}:${row.rowKey}`}
        nestedScrollEnabled
        onLayout={(event) => setListWidth(event.nativeEvent.layout.width)}
        onDragBegin={() => {
          if (!allowMapMutationsRef.current || renderInteractionGeneration !== interactionGenerationRef.current || disabledRef.current) return;
          closeOpenSwipeable();
          activeDragGenerationRef.current = renderInteractionGeneration;
          draggingRef.current = true;
          setDragging(true);
        }}
        onDragEnd={({ data, from, to }) => {
          closeOpenSwipeable();
          const activeDragGeneration = activeDragGenerationRef.current;
          activeDragGenerationRef.current = null;
          draggingRef.current = false;
          setDragging(false);
          if (
            !allowMapMutationsRef.current
            ||
            activeDragGeneration !== renderInteractionGeneration
            || renderInteractionGeneration !== interactionGenerationRef.current
            || disabledRef.current
          ) return;
          if (from !== to) onUpdate(reorderMissionMaps(data.map(({ map }) => map)));
        }}
        renderItem={renderMapRow}
        scrollEnabled={false}
      /> : rows.map((row, index) => renderMapRow({
        item: row,
        drag: () => undefined,
        getIndex: () => index,
        isActive: false,
      }))}
      <BattleMapPresetPickerModal
        disabled={disabled}
        mapName={activeCatalogMap?.name ?? activePresetMap?.mapCode ?? ''}
        onClose={() => closePresetPicker(true)}
        onSelect={selectPreset}
        catalog={partyPresetCatalog}
        selectedPresetId={activePresetMap?.partyPresetId ?? null}
        selectedPresetMode={activePresetMap?.presetMode ?? 'PRIMARY'}
        visible={activePresetMap != null && !disabled}
      />
    </>
  );
}

export type QuestMapListProps = {
  catalog: BattleMapResponse[];
  disabled: boolean;
  maps: QuestMapDraft[];
  mode: QuestMapMode;
  partyPresetCatalog: PartyPresetCatalogResponse;
  questContext: string;
  onRemove?: (index: number) => void;
  onUpdate: (maps: QuestMapDraft[]) => void;
};

export function QuestMapList({ catalog, disabled, maps, mode, partyPresetCatalog, questContext, onRemove, onUpdate }: QuestMapListProps) {
  const missionMaps = maps.map<QuestMapSettingRequest>((map) => ({
    ...map,
    missionKey: '',
    manuallyOverridden: mode === 'MANUAL',
  }));
  return (
    <QuestMissionMapList
      allowMapMutations={mode === 'MANUAL'}
      catalog={catalog}
      disabled={disabled}
      maps={missionMaps}
      missionKey=""
      partyPresetCatalog={partyPresetCatalog}
      questContext={questContext}
      onUpdate={(updated) => {
        if (onRemove && updated.length < maps.length) {
          const updatedIdentities = new Set(updated.map(buildQuestMapIdentity));
          const removedIndex = maps.findIndex((map) => !updatedIdentities.has(buildQuestMapIdentity(map)));
          if (removedIndex >= 0) {
            onRemove(removedIndex);
            return;
          }
        }
        onUpdate(updated.map((map) => {
          const { missionKey: _missionKey, manuallyOverridden: _manuallyOverridden, ...questMap } = map;
          return questMap;
        }));
      }}
    />
  );
}

const styles = StyleSheet.create({
  swipeContainer: { borderRadius: theme.radius.md, overflow: 'hidden' },
  mapCard: { alignItems: 'stretch', backgroundColor: theme.colors.surfaceAlt, borderColor: 'transparent', borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.xs, paddingVertical: 3 },
  mapCardActive: { borderColor: theme.colors.accentGreen, opacity: 0.82 },
  dragHandle: { alignItems: 'center', justifyContent: 'center', minHeight: 44, width: 32 },
  mapBody: { flex: 1, gap: 3, minWidth: 0 },
  mapCopy: { flex: 1, minWidth: 0 },
  mapName: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  mapContext: { color: theme.colors.textMuted, fontSize: 10, marginTop: 2 },
  deleteAction: { alignItems: 'center', backgroundColor: theme.colors.danger, justifyContent: 'center', width: 72 },
  deleteActionText: { color: theme.colors.buttonText, fontSize: 11, fontWeight: '900', marginTop: 2 },
  pressed: { opacity: 0.72 },
  presetButton: { borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, minHeight: 34, justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  presetButtonText: { color: theme.colors.text, fontSize: 11, fontWeight: '800' },
});
