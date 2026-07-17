import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  buildQuestMissionSummary,
  buildQuestRewardSummary,
  isCombatMission,
  type QuestSelectionDraft,
} from '../../../domain/questAutomation';
import { theme } from '../../../styles/theme';
import type { BattleMapResponse, PartyPresetResponse, QuestMapSettingRequest, QuestSnapshot } from '../../../types/api';
import { CombatMissionEditor } from './CombatMissionEditor';

export type QuestSummaryCardProps = {
  snapshot: QuestSnapshot;
  selected: QuestSelectionDraft | null;
  sectionLabel: string;
  catalog: BattleMapResponse[];
  presets: PartyPresetResponse[];
  disabled: boolean;
  catalogLoading: boolean;
  catalogError: string | null;
  onRetryCatalog: () => void;
  onToggle: () => void;
  onUpdateMission: (missionKey: string, maps: QuestMapSettingRequest[]) => void;
};

export function QuestSummaryCard({
  snapshot,
  selected,
  sectionLabel,
  catalog,
  presets,
  disabled,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  onToggle,
  onUpdateMission,
}: QuestSummaryCardProps) {
  const presetIds = presets.map(({ id }) => id);
  const combatMissions = selected?.missions.filter(isCombatMission) ?? [];

  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <View style={styles.heading}>
        <Pressable
          accessibilityLabel={`${snapshot.name} 선택`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected != null, disabled }}
          disabled={disabled}
          onPress={onToggle}
          style={[styles.checkbox, selected && styles.checkboxSelected]}
        >
          <Text style={styles.checkboxText}>{selected ? '✓' : ''}</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.name}>{snapshot.name}</Text>
          <Text style={styles.section}>{sectionLabel}</Text>
        </View>
      </View>
      <Text numberOfLines={1} style={styles.summary}>{buildQuestMissionSummary(snapshot.missions)}</Text>
      <Text numberOfLines={1} style={styles.reward}>{buildQuestRewardSummary(snapshot.rewards)}</Text>
      {combatMissions.map((mission) => (
        <View key={mission.key} style={styles.missionBlock}>
          <CombatMissionEditor
            catalog={catalog}
            catalogError={catalogError}
            catalogLoading={catalogLoading}
            disabled={disabled}
            mission={mission}
            presetIds={presetIds}
            presets={presets}
            questContext={snapshot.name || snapshot.questId}
            onRetryCatalog={onRetryCatalog}
            onUpdate={(maps) => onUpdateMission(mission.key, maps)}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md + 4, borderWidth: 1, gap: theme.spacing.xs, padding: theme.spacing.md },
  cardSelected: { borderColor: theme.colors.accentGreen },
  heading: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  checkbox: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: 5, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  checkboxSelected: { backgroundColor: theme.colors.accentGreen, borderColor: theme.colors.accentGreen },
  checkboxText: { color: theme.colors.buttonText, fontSize: 18, fontWeight: '900' },
  titleRow: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.sm, minWidth: 0 },
  name: { color: theme.colors.text, flex: 1, fontSize: 14, fontWeight: '900' },
  section: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '700' },
  summary: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  reward: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  missionBlock: { borderTopColor: theme.colors.border, borderTopWidth: 1, marginTop: theme.spacing.xs, paddingTop: theme.spacing.sm },
});
