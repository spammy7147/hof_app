import { useCallback, useEffect, useRef, useState, type ElementRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';

import {
  appendMissionMap,
  buildMissionLabel,
  buildMissionProgressLabel,
  buildQuestMapIdentity,
  getMissionReadiness,
  removeMissionMap,
  replaceMissionMap,
  type QuestMissionDraft,
} from '../../../domain/questAutomation';
import { theme } from '../../../styles/theme';
import type { BattleMapResponse, PartyPresetResponse, QuestMapSettingRequest } from '../../../types/api';
import { BattleMapPickerSheet } from './BattleMapPickerSheet';
import { QuestMissionMapList } from './QuestMissionMapList';

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

  function toggleMap(selectedMap: BattleMapResponse) {
    if (disabledRef.current) return;
    const selectedIdentity = buildQuestMapIdentity(selectedMap);
    const selectedIndex = mission.maps.findIndex((candidate) => buildQuestMapIdentity(candidate) === selectedIdentity);
    const selected = selectedIndex >= 0;
    onUpdate(mission.type === 'MAP_CLEAR'
      ? (selected ? [] : replaceMissionMap(mission.maps, mission.key, selectedMap))
      : (selected
        ? removeMissionMap(mission.maps, selectedIndex)
        : appendMissionMap(mission.maps, mission.key, selectedMap)));
  }

  const pickerLabel = mission.type === 'MAP_CLEAR' ? '전투맵 변경' : '전투맵 추가';

  return (
    <View style={styles.editor}>
      <View style={styles.missionTitleLine}>
        <Text style={styles.missionBadge}>{buildMissionLabel(mission)}</Text>
        {progress ? <Text style={styles.progress}>{progress}</Text> : null}
      </View>
      <Text style={[styles.readiness, readiness === '맵 설정 필요' || readiness === '프리셋 설정 필요' ? styles.problem : null]}>{readiness}</Text>
      <QuestMissionMapList
        catalog={catalog}
        disabled={disabled}
        maps={mission.maps}
        missionKey={mission.key}
        presets={presets}
        questContext={questContext}
        onUpdate={onUpdate}
      />
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
        mode={mission.type === 'MAP_CLEAR' ? 'REPLACE' : 'ADD'}
        selectedMapIdentities={mission.maps.map(buildQuestMapIdentity)}
        target={mission.target}
        visible={pickerOpen}
        onClose={() => closePicker(true)}
        onRetry={onRetryCatalog}
        onToggle={toggleMap}
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
  pickerButton: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, minHeight: 44, justifyContent: 'center' },
  pickerButtonText: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800' },
});
