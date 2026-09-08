import { useCallback, useEffect, useRef, useState, type ElementRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';

import { usePickerFocusReturn } from '../../../platform/usePickerFocusReturn';

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
  const disabledRef = useRef(disabled);
  const pickerOpenRef = useRef(false);
  const questContext = quest.name || quest.displayCode;
  const { open: captureFocus, close: restoreFocus } = usePickerFocusReturn<string>({
    getTarget: () => pickerTriggerRef.current,
    canRestore: (questKey) => questKey === quest.questKey && !disabledRef.current && !pickerOpenRef.current,
  });

  disabledRef.current = disabled;

  const closePicker = useCallback((restore: boolean) => {
    pickerOpenRef.current = false;
    setPickerOpen(false);
    restoreFocus(restore);
  }, [restoreFocus]);

  const openPicker = useCallback(() => {
    if (disabledRef.current) return;
    captureFocus(quest.questKey);
    pickerOpenRef.current = true;
    setPickerOpen(true);
  }, [captureFocus, quest.questKey]);

  useEffect(() => { closePicker(false); }, [closePicker, quest.questKey]);

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
        hitSlop={3}
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
  editor: { gap: theme.spacing.xs },
  problem: { color: theme.colors.accentAmber, fontSize: 11, fontWeight: '800' },
  pickerButton: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, minHeight: 36, justifyContent: 'center' },
  pickerButtonText: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800' },
});
