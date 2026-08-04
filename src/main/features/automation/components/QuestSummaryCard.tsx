import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  buildQuestMissionSummary,
  buildQuestRewardSummary,
  isCombatMission,
  type QuestSelectionDraft,
  type QuestMapDraft,
} from '../../../domain/questAutomation';
import { theme } from '../../../styles/theme';
import type { BattleMapResponse, PartyPresetCatalogResponse, QuestSnapshot } from '../../../types/api';
import { QuestMapEditor } from './QuestMapEditor';

export type QuestSummaryCardProps = {
  snapshot: QuestSnapshot;
  selected: QuestSelectionDraft | null;
  sectionLabel: string;
  catalog: BattleMapResponse[];
  partyPresetCatalog: PartyPresetCatalogResponse;
  disabled: boolean;
  catalogLoading: boolean;
  catalogError: string | null;
  onRetryCatalog: () => void;
  onToggle: () => void;
  onAddMap: (map: BattleMapResponse) => void;
  onRemoveMap: (index: number) => void;
  onUpdateMaps: (maps: QuestMapDraft[]) => void;
};

export function QuestSummaryCard({
  snapshot,
  selected,
  sectionLabel,
  catalog,
  partyPresetCatalog,
  disabled,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  onToggle,
  onAddMap,
  onRemoveMap,
  onUpdateMaps,
}: QuestSummaryCardProps) {
  const combatMissions = selected?.missions.filter(isCombatMission) ?? [];

  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <Pressable
        accessibilityLabel={`${snapshot.name} 선택`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected != null, disabled }}
        disabled={disabled}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.summaryPressable,
          pressed && styles.summaryPressed,
          disabled && styles.summaryDisabled,
        ]}
        testID={`quest-summary:${snapshot.name}`}
      >
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={styles.name}>{snapshot.name}</Text>
            <Text style={styles.section}>{sectionLabel}</Text>
          </View>
          <Text style={styles.summary}>{buildQuestMissionSummary(snapshot.missions)}</Text>
          <Text style={styles.reward}>{buildQuestRewardSummary(snapshot.rewards)}</Text>
        </View>
      </Pressable>
      {selected && combatMissions.length > 0 ? (
        <View style={styles.mapSection}>
          <QuestMapEditor
            catalog={catalog}
            catalogError={catalogError}
            catalogLoading={catalogLoading}
            disabled={disabled}
            partyPresetCatalog={partyPresetCatalog}
            quest={selected}
            onAddMap={onAddMap}
            onRemoveMap={onRemoveMap}
            onRetryCatalog={onRetryCatalog}
            onUpdateMaps={onUpdateMaps}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md + 4, borderWidth: 1, gap: 2, padding: theme.spacing.sm },
  cardSelected: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.accentGreen },
  summaryPressable: { justifyContent: 'center', minHeight: 44 },
  summaryPressed: { opacity: 0.72 },
  summaryDisabled: { opacity: 0.5 },
  copy: { flex: 1, minWidth: 0 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  name: { color: theme.colors.text, flex: 1, fontSize: 14, fontWeight: '900' },
  section: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '700' },
  summary: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  reward: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  mapSection: { borderTopColor: theme.colors.border, borderTopWidth: 1, marginTop: 2, paddingTop: theme.spacing.xs },
});
