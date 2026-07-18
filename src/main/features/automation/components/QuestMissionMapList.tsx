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
  identity: string;
  nodeHandle: ReturnType<typeof findNodeHandle>;
};

export function QuestMissionMapList({
  catalog,
  disabled,
  maps,
  missionKey,
  presets,
  questContext,
  onUpdate,
}: QuestMissionMapListProps) {
  const [activePresetIdentity, setActivePresetIdentity] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const disabledRef = useRef(disabled);
  const mapsRef = useRef(maps);
  const activePresetIdentityRef = useRef<string | null>(null);
  const presetTriggerNodesRef = useRef(new Map<string, ElementRef<typeof Pressable>>());
  const invokingPresetTriggerRef = useRef<PresetInvocation | null>(null);
  const presetFocusGenerationRef = useRef(0);
  const restorePresetFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  disabledRef.current = disabled;
  mapsRef.current = maps;
  activePresetIdentityRef.current = activePresetIdentity;

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
    activePresetIdentityRef.current = null;
    setActivePresetIdentity(null);
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
        || activePresetIdentityRef.current != null
        || presetFocusGenerationRef.current !== focusGeneration
        || !mapsRef.current.some((map) => buildQuestMapIdentity(map) === invocation.identity)
      ) {
        clearInvocation();
        return;
      }
      const liveNode = presetTriggerNodesRef.current.get(invocation.identity) ?? null;
      const liveHandle = findNodeHandle(liveNode);
      if (liveHandle != null && liveHandle === invocation.nodeHandle) {
        AccessibilityInfo.setAccessibilityFocus(liveHandle);
      }
      clearInvocation();
    }, 250);
  }, []);

  const openPresetPicker = useCallback((identity: string) => {
    if (disabledRef.current) return;
    presetFocusGenerationRef.current += 1;
    if (restorePresetFocusTimerRef.current) {
      clearTimeout(restorePresetFocusTimerRef.current);
      restorePresetFocusTimerRef.current = null;
    }
    const triggerNode = presetTriggerNodesRef.current.get(identity) ?? null;
    invokingPresetTriggerRef.current = {
      identity,
      nodeHandle: findNodeHandle(triggerNode),
    };
    activePresetIdentityRef.current = identity;
    setActivePresetIdentity(identity);
  }, []);

  const activePresetMap = activePresetIdentity == null
    ? null
    : maps.find((map) => buildQuestMapIdentity(map) === activePresetIdentity) ?? null;
  const activeCatalogMap = activePresetMap == null
    ? null
    : catalog.find((map) => buildQuestMapIdentity(map) === activePresetIdentity) ?? null;

  useEffect(() => {
    if (activePresetIdentity != null && (disabled || activePresetMap == null)) {
      closePresetPicker(false);
    }
  }, [activePresetIdentity, activePresetMap, closePresetPicker, disabled]);

  function selectPreset(partyPresetId: number | null) {
    if (disabledRef.current) return;
    const identity = activePresetIdentityRef.current;
    if (identity == null) return;
    const currentMaps = mapsRef.current;
    const targetIndex = currentMaps.findIndex((map) => buildQuestMapIdentity(map) === identity);
    if (targetIndex < 0) {
      closePresetPicker(false);
      return;
    }
    onUpdate(currentMaps.map((map, index) => index !== targetIndex ? map : partyPresetId == null
      ? { ...map, presetMode: 'PRIMARY', partyPresetId: null }
      : { ...map, presetMode: 'EXPLICIT', partyPresetId }));
    closePresetPicker(true);
  }

  return (
    <>
      {maps.map((map, index) => {
        const identity = buildQuestMapIdentity(map);
        const resolved = catalog.find((candidate) => buildQuestMapIdentity(candidate) === identity);
        const category = map.categoryId === 'battle_map'
          ? '전투맵'
          : map.categoryId === 'adventure_map'
            ? '모험맵'
            : map.categoryId;
        return (
          <View key={`${missionKey}:${identity}`} style={styles.mapCard}>
            <View style={styles.mapHeading}>
              <View style={styles.mapCopy}>
                <Text style={styles.mapName}>{resolved?.name ?? (map.mapCode || '맵을 선택해 주세요')}</Text>
                {resolved?.groupName || category ? <Text style={styles.mapContext}>{[resolved?.groupName, category].filter(Boolean).join(' · ')}</Text> : null}
              </View>
              <Pressable accessibilityLabel={`${questContext} · ${missionKey} ${index + 1}번째 맵 위로`} accessibilityRole="button" accessibilityState={{ disabled: disabled || index === 0 }} disabled={disabled || index === 0} onPress={() => {
                if (disabledRef.current) return;
                const liveIndex = mapsRef.current.findIndex((candidate) => buildQuestMapIdentity(candidate) === identity);
                if (liveIndex > 0) onUpdate(moveMissionMap(mapsRef.current, liveIndex, liveIndex - 1));
              }} style={styles.smallIcon}><ArrowUp color={theme.colors.textMuted} size={15} /></Pressable>
              <Pressable accessibilityLabel={`${questContext} · ${missionKey} ${index + 1}번째 맵 아래로`} accessibilityRole="button" accessibilityState={{ disabled: disabled || index === maps.length - 1 }} disabled={disabled || index === maps.length - 1} onPress={() => {
                if (disabledRef.current) return;
                const liveIndex = mapsRef.current.findIndex((candidate) => buildQuestMapIdentity(candidate) === identity);
                if (liveIndex >= 0 && liveIndex < mapsRef.current.length - 1) onUpdate(moveMissionMap(mapsRef.current, liveIndex, liveIndex + 1));
              }} style={styles.smallIcon}><ArrowDown color={theme.colors.textMuted} size={15} /></Pressable>
              <Pressable accessibilityLabel={`${questContext} · ${missionKey} ${index + 1}번째 맵 제거`} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => {
                if (disabledRef.current) return;
                const liveIndex = mapsRef.current.findIndex((candidate) => buildQuestMapIdentity(candidate) === identity);
                if (liveIndex >= 0) onUpdate(removeMissionMap(mapsRef.current, liveIndex));
              }} style={styles.smallIcon}><X color={theme.colors.danger} size={15} /></Pressable>
            </View>
            <Pressable
              ref={(node) => {
                if (node) presetTriggerNodesRef.current.set(identity, node);
                else presetTriggerNodesRef.current.delete(identity);
              }}
              accessibilityLabel={`${questContext} · ${missionKey} ${index + 1}번째 맵 프리셋 선택`}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => openPresetPicker(identity)}
              style={styles.presetButton}
            >
              <Text style={styles.presetButtonText}>{formatAutomationPresetSelection(map, presets)}</Text>
            </Pressable>
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
