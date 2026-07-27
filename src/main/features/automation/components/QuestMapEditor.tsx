import { useCallback, useEffect, useRef, useState, type ElementRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';

import {
  buildQuestMapIdentity,
  type QuestMapDraft,
  type QuestSelectionDraft,
} from '../../../domain/questAutomation';
import { theme } from '../../../styles/theme';
import type { BattleMapResponse, PartyPresetCatalogResponse } from '../../../types/api';
import { BattleMapPickerSheet } from './BattleMapPickerSheet';
import { QuestMapList } from './QuestMissionMapList';

export type QuestMapEditorProps = {
  catalog: BattleMapResponse[];
  catalogError: string | null;
  catalogLoading: boolean;
  disabled: boolean;
  partyPresetCatalog: PartyPresetCatalogResponse;
  quest: QuestSelectionDraft;
  onAddMap: (map: BattleMapResponse) => void;
  onRemoveMap: (index: number) => void;
  onRetryCatalog: () => void;
  onUpdateMaps: (maps: QuestMapDraft[]) => void;
};

export function QuestMapEditor({
  catalog,
  catalogError,
  catalogLoading,
  disabled,
  partyPresetCatalog,
  quest,
  onAddMap,
  onRemoveMap,
  onRetryCatalog,
  onUpdateMaps,
}: QuestMapEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerTriggerRef = useRef<ElementRef<typeof Pressable>>(null);
  const mountedRef = useRef(false);
  const disabledRef = useRef(disabled);
  const pickerOpenRef = useRef(false);
  const invokingTriggerHandleRef = useRef<ReturnType<typeof findNodeHandle>>(null);
  const focusGenerationRef = useRef(0);
  const restoreFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questContext = quest.name || quest.displayCode;

  disabledRef.current = disabled;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      focusGenerationRef.current += 1;
      invokingTriggerHandleRef.current = null;
      if (restoreFocusTimerRef.current) clearTimeout(restoreFocusTimerRef.current);
    };
  }, []);

  const closePicker = useCallback((restoreFocus: boolean) => {
    const generation = ++focusGenerationRef.current;
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
      if (!mountedRef.current || disabledRef.current || pickerOpenRef.current || focusGenerationRef.current !== generation) return;
      const liveHandle = findNodeHandle(pickerTriggerRef.current);
      if (liveHandle != null && liveHandle === invocationHandle) AccessibilityInfo.setAccessibilityFocus(liveHandle);
      if (invokingTriggerHandleRef.current === invocationHandle) invokingTriggerHandleRef.current = null;
    }, 250);
  }, []);

  const openPicker = useCallback(() => {
    if (disabledRef.current) return;
    focusGenerationRef.current += 1;
    if (restoreFocusTimerRef.current) clearTimeout(restoreFocusTimerRef.current);
    invokingTriggerHandleRef.current = findNodeHandle(pickerTriggerRef.current);
    pickerOpenRef.current = true;
    setPickerOpen(true);
  }, []);

  useEffect(() => {
    if (disabled) closePicker(false);
  }, [closePicker, disabled]);

  function toggleMap(selectedMap: BattleMapResponse) {
    if (disabledRef.current) return;
    const selectedIndex = quest.mapMode === 'MANUAL'
      ? quest.maps.findIndex((map) => buildQuestMapIdentity(map) === buildQuestMapIdentity(selectedMap))
      : -1;
    if (selectedIndex >= 0) onRemoveMap(selectedIndex);
    else onAddMap(selectedMap);
  }

  return (
    <View style={styles.editor}>
      <Text style={styles.source}>{quest.mapMode === 'AUTO' ? '자동 매칭' : '사용자 설정'}</Text>
      {quest.maps.length > 0 ? (
        <QuestMapList
          catalog={catalog}
          disabled={disabled}
          maps={quest.maps}
          mode={quest.mapMode}
          partyPresetCatalog={partyPresetCatalog}
          questContext={questContext}
          onRemove={onRemoveMap}
          onUpdate={onUpdateMaps}
        />
      ) : <Text style={styles.problem}>전투맵을 추가해 주세요.</Text>}
      <Pressable
        ref={pickerTriggerRef}
        accessibilityLabel={`${questContext} 전투맵 추가`}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={openPicker}
        style={styles.pickerButton}
      >
        <Plus color={theme.colors.accentGreen} size={16} />
        <Text style={styles.pickerButtonText}>전투맵 추가</Text>
      </Pressable>
      <BattleMapPickerSheet
        error={catalogError}
        loading={catalogLoading}
        maps={catalog}
        mode="ADD"
        selectedMapIdentities={quest.mapMode === 'MANUAL' ? quest.maps.map(buildQuestMapIdentity) : []}
        target={null}
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
  source: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '800' },
  problem: { color: theme.colors.accentAmber, fontSize: 11, fontWeight: '800' },
  pickerButton: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, minHeight: 44, justifyContent: 'center' },
  pickerButtonText: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800' },
});
