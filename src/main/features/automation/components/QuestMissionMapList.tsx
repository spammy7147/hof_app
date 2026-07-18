import { useCallback, useEffect, useRef, useState, type ElementRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowDown, ArrowUp, X } from 'lucide-react-native';

import {
  buildQuestMapIdentity,
  moveMissionMap,
  removeMissionMap,
} from '../../../domain/questAutomation';
import { formatAutomationPresetSelection } from '../../../domain/partyPresets';
import { theme } from '../../../styles/theme';
import type { BattleMapResponse, PartyPresetResponse, QuestMapSettingRequest } from '../../../types/api';
import { BattleMapPresetPickerModal } from './BattleMapPresetPickerModal';

export type QuestMissionMapListProps = {
  catalog: BattleMapResponse[];
  disabled: boolean;
  maps: QuestMapSettingRequest[];
  missionKey: string;
  presets: PartyPresetResponse[];
  questContext: string;
  onUpdate: (maps: QuestMapSettingRequest[]) => void;
};

type PresetInvocation = {
  rowKey: string;
  nodeHandle: ReturnType<typeof findNodeHandle>;
};

type MissionMapRow = {
  identity: string;
  index: number;
  map: QuestMapSettingRequest;
  rowKey: string;
};

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
  catalog,
  disabled,
  maps,
  missionKey,
  presets,
  questContext,
  onUpdate,
}: QuestMissionMapListProps) {
  const [activePresetRowKey, setActivePresetRowKey] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const disabledRef = useRef(disabled);
  const mapsRef = useRef(maps);
  const rowsRef = useRef<MissionMapRow[]>([]);
  const activePresetRowKeyRef = useRef<string | null>(null);
  const presetTriggerNodesRef = useRef(new Map<string, ElementRef<typeof Pressable>>());
  const invokingPresetTriggerRef = useRef<PresetInvocation | null>(null);
  const presetFocusGenerationRef = useRef(0);
  const restorePresetFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  disabledRef.current = disabled;
  mapsRef.current = maps;
  const rows = buildMissionMapRows(maps);
  rowsRef.current = rows;
  activePresetRowKeyRef.current = activePresetRowKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      presetFocusGenerationRef.current += 1;
      invokingPresetTriggerRef.current = null;
      if (restorePresetFocusTimerRef.current) {
        clearTimeout(restorePresetFocusTimerRef.current);
        restorePresetFocusTimerRef.current = null;
      }
    };
  }, []);

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
      const liveHandle = findNodeHandle(liveNode);
      if (liveHandle != null && liveHandle === invocation.nodeHandle) {
        AccessibilityInfo.setAccessibilityFocus(liveHandle);
      }
      clearInvocation();
    }, 250);
  }, []);

  const openPresetPicker = useCallback((rowKey: string) => {
    if (disabledRef.current) return;
    presetFocusGenerationRef.current += 1;
    if (restorePresetFocusTimerRef.current) {
      clearTimeout(restorePresetFocusTimerRef.current);
      restorePresetFocusTimerRef.current = null;
    }
    const triggerNode = presetTriggerNodesRef.current.get(rowKey) ?? null;
    invokingPresetTriggerRef.current = {
      rowKey,
      nodeHandle: findNodeHandle(triggerNode),
    };
    activePresetRowKeyRef.current = rowKey;
    setActivePresetRowKey(rowKey);
  }, []);

  const activePresetRow = activePresetRowKey == null
    ? null
    : rows.find((row) => row.rowKey === activePresetRowKey) ?? null;
  const activePresetMap = activePresetRow?.map.mapCode.trim() ? activePresetRow.map : null;
  const activeCatalogMap = activePresetRow == null
    ? null
    : catalog.find((map) => buildQuestMapIdentity(map) === activePresetRow.identity) ?? null;

  useEffect(() => {
    if (activePresetRowKey != null && (disabled || activePresetMap == null)) {
      closePresetPicker(false);
    }
  }, [activePresetMap, activePresetRowKey, closePresetPicker, disabled]);

  function selectPreset(partyPresetId: number | null) {
    if (disabledRef.current) return;
    const rowKey = activePresetRowKeyRef.current;
    if (rowKey == null) return;
    const currentMaps = mapsRef.current;
    const targetRow = rowsRef.current.find((row) => row.rowKey === rowKey);
    if (!targetRow) {
      closePresetPicker(false);
      return;
    }
    onUpdate(currentMaps.map((map, index) => index !== targetRow.index ? map : partyPresetId == null
      ? { ...map, presetMode: 'PRIMARY', partyPresetId: null }
      : { ...map, presetMode: 'EXPLICIT', partyPresetId }));
    closePresetPicker(true);
  }

  return (
    <>
      {rows.map(({ identity, index, map, rowKey }) => {
        const resolved = catalog.find((candidate) => buildQuestMapIdentity(candidate) === identity);
        const presetLabel = formatAutomationPresetSelection(map, presets);
        const category = map.categoryId === 'battle_map'
          ? '전투맵'
          : map.categoryId === 'adventure_map'
            ? '모험맵'
            : map.categoryId;
        return (
          <View key={`${missionKey}:${rowKey}`} style={styles.mapCard}>
            <View style={styles.mapHeading}>
              <View style={styles.mapCopy}>
                <Text style={styles.mapName}>{resolved?.name ?? (map.mapCode || '맵을 선택해 주세요')}</Text>
                {resolved?.groupName || category ? <Text style={styles.mapContext}>{[resolved?.groupName, category].filter(Boolean).join(' · ')}</Text> : null}
              </View>
              <Pressable accessibilityLabel={`${questContext} · ${missionKey} ${index + 1}번째 맵 위로`} accessibilityRole="button" accessibilityState={{ disabled: disabled || index === 0 }} disabled={disabled || index === 0} onPress={() => {
                if (disabledRef.current) return;
                const liveRow = rowsRef.current.find((candidate) => candidate.rowKey === rowKey);
                if (liveRow && liveRow.index > 0) onUpdate(moveMissionMap(mapsRef.current, liveRow.index, liveRow.index - 1));
              }} style={styles.smallIcon}><ArrowUp color={theme.colors.textMuted} size={15} /></Pressable>
              <Pressable accessibilityLabel={`${questContext} · ${missionKey} ${index + 1}번째 맵 아래로`} accessibilityRole="button" accessibilityState={{ disabled: disabled || index === maps.length - 1 }} disabled={disabled || index === maps.length - 1} onPress={() => {
                if (disabledRef.current) return;
                const liveRow = rowsRef.current.find((candidate) => candidate.rowKey === rowKey);
                if (liveRow && liveRow.index < mapsRef.current.length - 1) onUpdate(moveMissionMap(mapsRef.current, liveRow.index, liveRow.index + 1));
              }} style={styles.smallIcon}><ArrowDown color={theme.colors.textMuted} size={15} /></Pressable>
              <Pressable accessibilityLabel={`${questContext} · ${missionKey} ${index + 1}번째 맵 제거`} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => {
                if (disabledRef.current) return;
                const liveRow = rowsRef.current.find((candidate) => candidate.rowKey === rowKey);
                if (liveRow) onUpdate(removeMissionMap(mapsRef.current, liveRow.index));
              }} style={styles.smallIcon}><X color={theme.colors.danger} size={15} /></Pressable>
            </View>
            {map.mapCode.trim() ? (
              <Pressable
                ref={(node) => {
                  if (node) presetTriggerNodesRef.current.set(rowKey, node);
                  else presetTriggerNodesRef.current.delete(rowKey);
                }}
                accessibilityLabel={`${questContext} · ${missionKey} ${index + 1}번째 맵 프리셋 선택`}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                accessibilityValue={{ text: presetLabel }}
                disabled={disabled}
                onPress={() => openPresetPicker(rowKey)}
                style={styles.presetButton}
              >
                <Text style={styles.presetButtonText}>{presetLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <BattleMapPresetPickerModal
        disabled={disabled}
        mapName={activeCatalogMap?.name ?? activePresetMap?.mapCode ?? ''}
        onClose={() => closePresetPicker(true)}
        onSelect={selectPreset}
        presets={presets}
        selectedPresetId={activePresetMap?.partyPresetId ?? null}
        selectedPresetMode={activePresetMap?.presetMode ?? 'PRIMARY'}
        visible={activePresetMap != null && !disabled}
      />
    </>
  );
}

const styles = StyleSheet.create({
  mapCard: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: theme.spacing.sm, padding: theme.spacing.sm },
  mapHeading: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  mapCopy: { flex: 1, minWidth: 0 },
  mapName: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  mapContext: { color: theme.colors.textMuted, fontSize: 10, marginTop: 2 },
  smallIcon: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  presetButton: { borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  presetButtonText: { color: theme.colors.text, fontSize: 11, fontWeight: '800' },
});
