import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react-native';

import {
  buildAutomationProfileSelectedMaps,
  filterAutomationProfileMaps,
} from '../../../domain/automationProfiles';
import {
  buildBattleMapStateKey,
  filterDisplayBattleMaps,
  formatAutomationMapListMeta,
  formatAutomationMapListName,
  getAutomationMapSkipReason,
  groupBattleMaps,
  orderBattleMaps,
  type BattleMapGroup,
} from '../../../domain/battleMaps';
import { theme } from '../../../styles/theme';
import type {
  AutomationProfileMap,
  BattleMapResponse,
  PartyPresetResponse,
} from '../../../types/api';

type AutomationMapSettingsProps = {
  categoryId: string;
  profileMaps: AutomationProfileMap[];
  maps: BattleMapResponse[];
  partyPresets: PartyPresetResponse[];
  loading: boolean;
  saving: boolean;
  errorMessage: string | null;
  onAssignPreset: (map: BattleMapResponse, partyPresetId: number | null) => void;
  onToggleMap: (map: BattleMapResponse) => void;
};

/**
 * 자동전투 profile의 맵 검색, 그룹 탐색, 선택 목록과 맵별 프리셋 선택을 렌더링한다.
 *
 * 서버 저장과 profile 상태 소유권은 화면에 남겨두고, 이 컴포넌트는 현재 props를 표현한 뒤
 * 사용자의 의도를 callback으로 올린다. 따라서 카테고리를 바꿔도 임시 검색·그룹 UI 상태만 초기화된다.
 */
export function AutomationMapSettings({
  categoryId,
  profileMaps,
  maps,
  partyPresets,
  loading,
  saving,
  errorMessage,
  onAssignPreset,
  onToggleMap,
}: AutomationMapSettingsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [presetPickerMapKey, setPresetPickerMapKey] = useState<string | null>(null);
  const [expandedMapGroupKeys, setExpandedMapGroupKeys] = useState<string[]>([]);
  const orderedMaps = useMemo(() => orderBattleMaps(filterDisplayBattleMaps(maps)), [maps]);
  const selectedMaps = useMemo(
    () => buildAutomationProfileSelectedMaps(profileMaps, orderedMaps, categoryId),
    [categoryId, orderedMaps, profileMaps],
  );
  const filteredMaps = useMemo(
    () => filterAutomationProfileMaps(orderedMaps, searchQuery),
    [orderedMaps, searchQuery],
  );
  const unselectedFilteredMaps = useMemo(
    () => filteredMaps.filter((map) => findAutomationProfileMap(profileMaps, map) == null),
    [filteredMaps, profileMaps],
  );
  const unselectedFilteredGroups = useMemo(
    () => groupBattleMaps(unselectedFilteredMaps),
    [unselectedFilteredMaps],
  );
  const searchExpanded = searchQuery.trim().length > 0;

  /** 검색 중에는 모든 결과 그룹을 열고, 평상시에는 사용자가 누른 그룹만 토글한다. */
  const toggleMapGroup = useCallback((groupKey: string) => {
    setExpandedMapGroupKeys((currentKeys) => (
      currentKeys.includes(groupKey)
        ? currentKeys.filter((currentKey) => currentKey !== groupKey)
        : [...currentKeys, groupKey]
    ));
  }, []);

  if (loading) {
    return (
      <View style={styles.inlineState}>
        <ActivityIndicator color={theme.colors.accentGreen} size="small" />
        <Text style={styles.inlineStateText}>맵 불러오는 중</Text>
      </View>
    );
  }
  if (errorMessage) return <Text style={styles.message}>{errorMessage}</Text>;
  if (orderedMaps.length === 0 && selectedMaps.length === 0) {
    return <Text style={styles.mutedText}>{categoryId} 맵이 없습니다.</Text>;
  }

  return (
    <View style={styles.mapPicker}>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setSearchQuery}
        placeholder="맵 검색"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.mapSearchInput}
        value={searchQuery}
      />

      {filteredMaps.length === 0 ? <Text style={styles.mutedText}>검색 결과가 없습니다.</Text> : null}

      {selectedMaps.length > 0 ? (
        <View style={styles.selectedMapPanel}>
          <MapSectionHeader count={selectedMaps.length} title="선택된 맵" />
          <View style={styles.mapList}>
            {selectedMaps.map((map) => (
              <AutomationMapRow
                key={`selected:${buildBattleMapStateKey(map)}`}
                map={map}
                selected
                profileMap={findAutomationProfileMap(profileMaps, map)}
                partyPresets={partyPresets}
                presetPickerOpen={presetPickerMapKey === buildBattleMapStateKey(map)}
                saving={saving}
                onAssignPreset={(partyPresetId) => {
                  setPresetPickerMapKey(null);
                  onAssignPreset(map, partyPresetId);
                }}
                onToggleMap={() => onToggleMap(map)}
                onTogglePresetPicker={() => {
                  const mapStateKey = buildBattleMapStateKey(map);
                  setPresetPickerMapKey((current) => (current === mapStateKey ? null : mapStateKey));
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      <MapSectionHeader count={unselectedFilteredMaps.length} title="맵 목록" />
      {unselectedFilteredMaps.length === 0 && filteredMaps.length > 0 ? (
        <Text style={styles.mutedText}>이 카테고리의 맵은 모두 선택되어 있습니다.</Text>
      ) : null}

      <View style={styles.automationGroupList}>
        {unselectedFilteredGroups.map((group) => {
          const expanded = searchExpanded || expandedMapGroupKeys.includes(group.key);
          return (
            <View key={group.key} style={styles.automationGroupBlock}>
              <AutomationMapGroupRow
                expanded={expanded}
                group={group}
                onPress={() => toggleMapGroup(group.key)}
              />
              {expanded ? (
                <View style={styles.automationMapTreeBranch}>
                  {group.maps.map((map) => (
                    <AutomationMapRow
                      key={buildBattleMapStateKey(map)}
                      map={map}
                      selected={false}
                      profileMap={null}
                      partyPresets={partyPresets}
                      presetPickerOpen={false}
                      saving={saving}
                      onAssignPreset={() => undefined}
                      onToggleMap={() => onToggleMap(map)}
                      onTogglePresetPicker={() => undefined}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MapSectionHeader({ count, title }: { count: number; title: string }) {
  return (
    <View style={styles.mapSectionHeader}>
      <Text style={styles.mapSectionTitle}>{title}</Text>
      <Text style={styles.mapSectionCount}>{count.toLocaleString('en-US')}개</Text>
    </View>
  );
}

function AutomationMapGroupRow({
  group,
  expanded,
  onPress,
}: {
  group: BattleMapGroup;
  expanded: boolean;
  onPress: () => void;
}) {
  const FolderIcon = expanded ? FolderOpen : Folder;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const groupMeta = [
    group.recommendedLevel ? `Lv ${group.recommendedLevel}` : null,
    `${group.maps.length.toLocaleString('en-US')}개`,
  ].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.automationGroupRow,
        expanded && styles.automationGroupRowActive,
        pressed && styles.buttonPressed,
      ]}
    >
      <View style={styles.automationGroupIconBox}>
        <FolderIcon color={theme.colors.accentGreen} size={16} />
      </View>
      <View style={styles.automationGroupTexts}>
        <Text style={styles.automationGroupName} numberOfLines={1}>{group.name}</Text>
        <Text style={styles.automationGroupMeta} numberOfLines={1}>{groupMeta}</Text>
      </View>
      <Chevron color={theme.colors.textMuted} size={14} />
    </Pressable>
  );
}

type AutomationMapRowProps = {
  map: BattleMapResponse;
  selected: boolean;
  profileMap: AutomationProfileMap | null | undefined;
  partyPresets: PartyPresetResponse[];
  presetPickerOpen: boolean;
  saving: boolean;
  onAssignPreset: (partyPresetId: number | null) => void;
  onToggleMap: () => void;
  onTogglePresetPicker: () => void;
};

/** 선택 전에는 추가 명령을, 선택 후에는 연결할 파티 프리셋과 현재 실행 제한을 표시한다. */
function AutomationMapRow({
  map,
  selected,
  profileMap,
  partyPresets,
  presetPickerOpen,
  saving,
  onAssignPreset,
  onToggleMap,
  onTogglePresetPicker,
}: AutomationMapRowProps) {
  const mapName = map.groupName === '저장된 맵' && map.mapCode != null
    ? map.mapCode
    : formatAutomationMapListName(map);
  const mapEditable = map.mapCode != null && map.resolved;
  const mapMeta = [
    map.groupName === '저장된 맵' ? map.groupName : null,
    formatAutomationMapListMeta(map),
    getAutomationMapSkipReason(map),
  ].filter(Boolean).join(' · ') || map.mapCode || '맵 정보 없음';
  const mapUnavailable = saving || !mapEditable;
  const selectedPreset = partyPresets.find((preset) => preset.id === profileMap?.partyPresetId) ?? null;
  const needsPreset = selected && selectedPreset == null;

  return (
    <View style={styles.mapRowBlock}>
      <View style={[
        styles.mapRow,
        selected && styles.mapRowSelected,
        needsPreset && styles.mapRowNeedsPreset,
        mapUnavailable && styles.buttonDisabled,
      ]}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected, disabled: mapUnavailable }}
          disabled={mapUnavailable}
          onPress={onToggleMap}
          style={({ pressed }) => [
            styles.mapToggleArea,
            pressed && !mapUnavailable && styles.buttonPressed,
          ]}
        >
          <View style={[styles.mapSelectMark, selected && styles.mapSelectMarkSelected]}>
            {selected ? <Text style={styles.mapSelectMarkText}>✓</Text> : null}
          </View>
          <View style={styles.mapTexts}>
            <Text style={styles.mapName} numberOfLines={1}>{mapName}</Text>
            <Text style={styles.mapMeta} numberOfLines={1}>{mapMeta}</Text>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={mapUnavailable}
          onPress={selected ? onTogglePresetPicker : onToggleMap}
          style={({ pressed }) => [
            styles.mapPresetButton,
            !selected && styles.mapAddButton,
            needsPreset && styles.mapPresetButtonRequired,
            pressed && !mapUnavailable && styles.buttonPressed,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.mapPresetButtonText,
              !selected && styles.mapAddButtonText,
              needsPreset && styles.mapPresetButtonRequiredText,
            ]}
          >
            {selected ? selectedPreset?.name ?? '프리셋 필요' : '추가'}
          </Text>
          {selected ? (
            <ChevronDown color={needsPreset ? theme.colors.danger : theme.colors.textMuted} size={14} />
          ) : null}
        </Pressable>
      </View>

      {selected && presetPickerOpen ? (
        <View style={styles.presetPicker}>
          {partyPresets.length === 0 ? (
            <Text style={styles.presetPickerEmpty}>저장된 프리셋이 없습니다.</Text>
          ) : partyPresets.map((preset) => {
            const presetSelected = preset.id === profileMap?.partyPresetId;
            return (
              <Pressable
                key={preset.id}
                accessibilityRole="button"
                onPress={() => onAssignPreset(preset.id)}
                style={({ pressed }) => [
                  styles.presetOption,
                  presetSelected && styles.presetOptionSelected,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.presetOptionName} numberOfLines={1}>{preset.name}</Text>
                <Text style={styles.presetOptionMeta}>{formatPresetMemberCount(preset)}</Text>
              </Pressable>
            );
          })}
          {profileMap?.partyPresetId != null ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onAssignPreset(null)}
              style={({ pressed }) => [styles.presetClearButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.presetClearButtonText}>프리셋 해제</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function findAutomationProfileMap(
  profileMaps: AutomationProfileMap[],
  map: BattleMapResponse,
): AutomationProfileMap | null {
  if (map.mapCode == null) return null;
  return profileMaps.find((currentMap) => (
    currentMap.categoryId === map.categoryId && currentMap.mapCode === map.mapCode
  )) ?? null;
}

function formatPresetMemberCount(preset: PartyPresetResponse): string {
  const count = preset.members.filter((member) => member.characterId != null).length;
  return `${count.toLocaleString('en-US')}명`;
}

const styles = StyleSheet.create({
  inlineState: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
  inlineStateText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '800' },
  message: { color: theme.colors.danger, borderWidth: 1, borderColor: theme.colors.danger, borderRadius: theme.radius.sm, padding: theme.spacing.md, fontSize: 13, fontWeight: '800', lineHeight: 19 },
  mutedText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '800', lineHeight: 19 },
  mapPicker: { gap: theme.spacing.sm },
  selectedMapPanel: { gap: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt, padding: theme.spacing.sm },
  mapSectionHeader: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  mapSectionTitle: { color: theme.colors.text, fontSize: 12, fontWeight: '900' },
  mapSectionCount: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '900' },
  mapSearchInput: { minHeight: 38, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, backgroundColor: theme.colors.background, color: theme.colors.text, fontSize: 14, fontWeight: '800', paddingHorizontal: theme.spacing.md },
  automationGroupList: { gap: theme.spacing.sm },
  automationGroupBlock: { gap: theme.spacing.xs },
  automationGroupRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
  automationGroupRowActive: { borderColor: theme.colors.accentGreen },
  automationGroupIconBox: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface },
  automationGroupTexts: { minWidth: 0, flex: 1, gap: 1 },
  automationGroupName: { color: theme.colors.text, fontSize: 13, fontWeight: '900', lineHeight: 18 },
  automationGroupMeta: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '800', lineHeight: 15 },
  automationMapTreeBranch: { marginLeft: 4, gap: theme.spacing.xs, borderLeftWidth: 1, borderLeftColor: theme.colors.border, paddingLeft: 4 },
  mapList: { gap: theme.spacing.sm },
  mapRowBlock: { gap: theme.spacing.xs },
  mapRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, backgroundColor: theme.colors.background, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  mapRowSelected: { borderColor: theme.colors.accentGreen },
  mapRowNeedsPreset: { borderColor: theme.colors.danger },
  mapToggleArea: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6 },
  mapSelectMark: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface },
  mapSelectMarkSelected: { borderColor: theme.colors.accentGreen, backgroundColor: theme.colors.accentGreen },
  mapSelectMarkText: { color: theme.colors.buttonText, fontSize: 12, fontWeight: '900', lineHeight: 14 },
  mapTexts: { flex: 1, minWidth: 0 },
  mapName: { color: theme.colors.text, fontSize: 14, fontWeight: '900', lineHeight: 20 },
  mapMeta: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  mapPresetButton: { maxWidth: 132, minWidth: 74, minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt, paddingHorizontal: theme.spacing.sm },
  mapAddButton: { borderColor: theme.colors.accentGreen, backgroundColor: theme.colors.background },
  mapPresetButtonRequired: { borderColor: theme.colors.danger, backgroundColor: theme.colors.background },
  mapPresetButtonText: { minWidth: 0, color: theme.colors.text, fontSize: 12, fontWeight: '900' },
  mapAddButtonText: { color: theme.colors.accentGreen },
  mapPresetButtonRequiredText: { color: theme.colors.danger },
  presetPicker: { gap: theme.spacing.xs, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, backgroundColor: theme.colors.background, padding: theme.spacing.sm },
  presetPickerEmpty: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  presetOption: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.sm },
  presetOptionSelected: { borderColor: theme.colors.accentGreen },
  presetOptionName: { flex: 1, minWidth: 0, color: theme.colors.text, fontSize: 12, fontWeight: '900' },
  presetOptionMeta: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '800' },
  presetClearButton: { minHeight: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.danger, borderRadius: theme.radius.sm },
  presetClearButtonText: { color: theme.colors.danger, fontSize: 12, fontWeight: '900' },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.82 },
});
