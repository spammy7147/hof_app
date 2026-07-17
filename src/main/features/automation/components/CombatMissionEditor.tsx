import { useCallback, useEffect, useRef, useState, type ElementRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react-native';

import {
  appendMissionMap,
  buildMissionLabel,
  buildMissionProgressLabel,
  buildQuestMapIdentity,
  getMissionReadiness,
  moveMissionMap,
  removeMissionMap,
  replaceMissionMap,
  type QuestMissionDraft,
} from '../../../domain/questAutomation';
import { formatAutomationPresetSelection } from '../../../domain/partyPresets';
import { theme } from '../../../styles/theme';
import type { BattleMapResponse, PartyPresetResponse, QuestMapSettingRequest } from '../../../types/api';
import { BattleMapPickerSheet } from './BattleMapPickerSheet';

export type CombatMissionEditorProps = {
  mission: QuestMissionDraft;
  catalog: BattleMapResponse[];
  presets: PartyPresetResponse[];
  presetIds: number[];
  disabled: boolean;
  questContext: string;
  catalogLoading: boolean;
  catalogError: string | null;
  onRetryCatalog: () => void;
  onUpdate: (maps: QuestMapSettingRequest[]) => void;
};

export function CombatMissionEditor({
  mission,
  catalog,
  presets,
  presetIds,
  disabled,
  questContext,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  onUpdate,
}: CombatMissionEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerTriggerRef = useRef<ElementRef<typeof Pressable>>(null);
  const mountedRef = useRef(false);
  const disabledRef = useRef(disabled);
  const pickerOpenRef = useRef(false);
  const invokingTriggerHandleRef = useRef<ReturnType<typeof findNodeHandle>>(null);
  const focusGenerationRef = useRef(0);
  const restoreFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readiness = getMissionReadiness(mission, presetIds);
  const progress = buildMissionProgressLabel(mission);

  disabledRef.current = disabled;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      focusGenerationRef.current += 1;
      invokingTriggerHandleRef.current = null;
      if (restoreFocusTimerRef.current) {
        clearTimeout(restoreFocusTimerRef.current);
        restoreFocusTimerRef.current = null;
      }
    };
  }, []);

  const closePicker = useCallback((restoreFocus: boolean) => {
    const focusGeneration = ++focusGenerationRef.current;
    const invocationHandle = invokingTriggerHandleRef.current;
    pickerOpenRef.current = false;
    setPickerOpen(false);
    if (restoreFocusTimerRef.current) {
      clearTimeout(restoreFocusTimerRef.current);
      restoreFocusTimerRef.current = null;
    }
    if (!restoreFocus || invocationHandle == null) {
      invokingTriggerHandleRef.current = null;
      return;
    }
    restoreFocusTimerRef.current = setTimeout(() => {
      restoreFocusTimerRef.current = null;
      if (
        !mountedRef.current
        || disabledRef.current
        || pickerOpenRef.current
        || focusGenerationRef.current !== focusGeneration
      ) {
        if (invokingTriggerHandleRef.current === invocationHandle) invokingTriggerHandleRef.current = null;
        return;
      }
      const liveHandle = findNodeHandle(pickerTriggerRef.current);
      if (liveHandle != null && liveHandle === invocationHandle) {
        AccessibilityInfo.setAccessibilityFocus(liveHandle);
      }
      if (invokingTriggerHandleRef.current === invocationHandle) invokingTriggerHandleRef.current = null;
    }, 250);
  }, []);

  const openPicker = useCallback(() => {
    if (disabledRef.current) return;
    focusGenerationRef.current += 1;
    if (restoreFocusTimerRef.current) {
      clearTimeout(restoreFocusTimerRef.current);
      restoreFocusTimerRef.current = null;
    }
    invokingTriggerHandleRef.current = findNodeHandle(pickerTriggerRef.current);
    pickerOpenRef.current = true;
    setPickerOpen(true);
  }, []);

  useEffect(() => {
    if (disabled) closePicker(false);
  }, [closePicker, disabled]);

  function updatePreset(index: number, partyPresetId: number | null) {
    if (disabled) return;
    onUpdate(mission.maps.map((map, currentIndex) => currentIndex !== index ? map : partyPresetId == null
      ? { ...map, presetMode: 'PRIMARY', partyPresetId: null }
      : { ...map, presetMode: 'EXPLICIT', partyPresetId }));
  }

  function selectMap(selected: BattleMapResponse) {
    if (disabled) return;
    onUpdate(mission.type === 'MAP_CLEAR'
      ? replaceMissionMap(mission.maps, mission.key, selected)
      : appendMissionMap(mission.maps, mission.key, selected));
    closePicker(true);
  }

  const pickerLabel = mission.type === 'MAP_CLEAR' ? '전투맵 변경' : '전투맵 추가';

  return (
    <View style={styles.editor}>
      <View style={styles.missionTitleLine}>
        <Text style={styles.missionBadge}>{buildMissionLabel(mission)}</Text>
        {progress ? <Text style={styles.progress}>{progress}</Text> : null}
      </View>
      <Text style={[styles.readiness, readiness === '맵 설정 필요' || readiness === '프리셋 설정 필요' ? styles.problem : null]}>{readiness}</Text>
      {mission.maps.map((map, index) => {
        const resolved = catalog.find((candidate) => candidate.categoryId === map.categoryId && candidate.mapCode === map.mapCode);
        const category = map.categoryId === 'battle_map' ? '전투맵' : map.categoryId === 'adventure_map' ? '모험맵' : map.categoryId;
        return (
          <View key={`${mission.key}:${index}`} style={styles.mapCard}>
            <View style={styles.mapHeading}>
              <View style={styles.mapCopy}>
                <Text style={styles.mapName}>{resolved?.name ?? (map.mapCode || '맵을 선택해 주세요')}</Text>
                {resolved?.groupName || category ? <Text style={styles.mapContext}>{[resolved?.groupName, category].filter(Boolean).join(' · ')}</Text> : null}
              </View>
              <Pressable accessibilityLabel={`${questContext} · ${mission.key} ${index + 1}번째 맵 위로`} accessibilityRole="button" accessibilityState={{ disabled: disabled || index === 0 }} disabled={disabled || index === 0} onPress={() => { if (!disabled && index > 0) onUpdate(moveMissionMap(mission.maps, index, index - 1)); }} style={styles.smallIcon}><ArrowUp color={theme.colors.textMuted} size={15} /></Pressable>
              <Pressable accessibilityLabel={`${questContext} · ${mission.key} ${index + 1}번째 맵 아래로`} accessibilityRole="button" accessibilityState={{ disabled: disabled || index === mission.maps.length - 1 }} disabled={disabled || index === mission.maps.length - 1} onPress={() => { if (!disabled && index < mission.maps.length - 1) onUpdate(moveMissionMap(mission.maps, index, index + 1)); }} style={styles.smallIcon}><ArrowDown color={theme.colors.textMuted} size={15} /></Pressable>
              <Pressable accessibilityLabel={`${questContext} · ${mission.key} ${index + 1}번째 맵 제거`} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => { if (!disabled) onUpdate(removeMissionMap(mission.maps, index)); }} style={styles.smallIcon}><X color={theme.colors.danger} size={15} /></Pressable>
            </View>
            {map.mapCode ? (
              <View accessibilityLabel={`${questContext} · ${mission.key} ${index + 1}번째 맵 프리셋 선택`} accessibilityRole="radiogroup" style={styles.presetRow}>
                <Pressable accessibilityLabel={`${questContext} · ${mission.key} ${index + 1}번째 맵 대표 프리셋`} accessibilityRole="radio" accessibilityState={{ checked: map.presetMode === 'PRIMARY', disabled }} disabled={disabled} onPress={() => updatePreset(index, null)} style={[styles.choice, map.presetMode === 'PRIMARY' && styles.choiceActive]}><Text style={styles.choiceText}>{formatAutomationPresetSelection({ presetMode: 'PRIMARY', partyPresetId: null }, presets)}</Text></Pressable>
                {presets.map((preset) => {
                  const checked = map.presetMode === 'EXPLICIT' && map.partyPresetId === preset.id;
                  return <Pressable key={preset.id} accessibilityLabel={`${questContext} · ${mission.key} ${index + 1}번째 맵 ${preset.name} 프리셋`} accessibilityRole="radio" accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => updatePreset(index, preset.id)} style={[styles.choice, checked && styles.choiceActive]}><Text style={styles.choiceText}>{preset.name}</Text></Pressable>;
                })}
              </View>
            ) : null}
          </View>
        );
      })}
      {mission.type === 'MONSTER_KILL' && mission.maps.length >= 2 ? <Text style={styles.hint}>여러 맵을 실행 가능한 순서대로 확인하고 전투 횟수를 고르게 분배해요</Text> : null}
      <Pressable
        ref={pickerTriggerRef}
        accessibilityLabel={`${questContext} · ${mission.key} ${pickerLabel}`}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={openPicker}
        style={styles.pickerButton}
      >
        <Plus color={theme.colors.accentGreen} size={16} />
        <Text style={styles.pickerButtonText}>{pickerLabel}</Text>
      </Pressable>
      <BattleMapPickerSheet
        error={catalogError}
        loading={catalogLoading}
        maps={catalog}
        selectedMapIdentities={mission.maps.map(buildQuestMapIdentity)}
        target={mission.target}
        visible={pickerOpen}
        onClose={() => closePicker(true)}
        onRetry={onRetryCatalog}
        onSelect={selectMap}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: theme.spacing.sm },
  missionTitleLine: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  missionBadge: { color: theme.colors.text, flex: 1, fontSize: 12, fontWeight: '700' },
  progress: { color: theme.colors.accentBlue, fontSize: 11, fontWeight: '800' },
  readiness: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '800' },
  problem: { color: theme.colors.accentAmber },
  mapCard: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: theme.spacing.sm, padding: theme.spacing.sm },
  mapHeading: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  mapCopy: { flex: 1, minWidth: 0 },
  mapName: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  mapContext: { color: theme.colors.textMuted, fontSize: 10, marginTop: 2 },
  smallIcon: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  choice: { borderColor: theme.colors.borderStrong, borderRadius: 14, borderWidth: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  choiceActive: { borderColor: theme.colors.accentGreen },
  choiceText: { color: theme.colors.text, fontSize: 10, fontWeight: '700' },
  hint: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  pickerButton: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, minHeight: 44, justifyContent: 'center' },
  pickerButtonText: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800' },
});
