import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2, X } from 'lucide-react-native';

import {
  applyManualMapOverride,
  buildMissionLabel,
  buildMissionProgressLabel,
  buildQuestAutomationDraft,
  buildQuestAutomationRequest,
  filterQuests,
  getMissionReadiness,
  isCombatMission,
  moveMissionMap,
  removeMissionMap,
  selectQuest,
  validateQuestAutomationDraft,
  type QuestAutomationDraft,
  type QuestMissionDraft,
} from '../../../domain/questAutomation';
import { filterAutomationProfileCategories } from '../../../domain/automationProfiles';
import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import { theme } from '../../../styles/theme';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  PartyPresetResponse,
  QuestMapSettingRequest,
  QuestSection,
  QuestSnapshot,
  TypedAutomationEntryResponse,
  UpdateQuestAutomationRequest,
} from '../../../types/api';

type VisibleSection = Extract<QuestSection, 'ACTIVE' | 'AVAILABLE' | 'WAITING'>;

type Props = {
  entry: TypedAutomationEntryResponse;
  battleCategories: BattleCategoryResponse[];
  saving: boolean;
  fetchQuests: () => Promise<QuestSnapshot[]>;
  onBack: () => void;
  onDelete: () => Promise<boolean>;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  onSave: (request: UpdateQuestAutomationRequest) => Promise<boolean>;
};

const TABS: readonly { section: VisibleSection; label: string; empty: string }[] = [
  { section: 'ACTIVE', label: '진행 중', empty: '진행 중인 퀘스트가 없습니다.' },
  { section: 'AVAILABLE', label: '수락 가능', empty: '수락 가능한 퀘스트가 없습니다.' },
  { section: 'WAITING', label: '대기 중', empty: '대기 중인 퀘스트가 없습니다.' },
];

export function QuestAutomationEditor({
  entry,
  battleCategories,
  saving,
  fetchQuests,
  onBack,
  onDelete,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onListPartyPresets,
  onSave,
}: Props) {
  const [section, setSection] = useState<VisibleSection>('ACTIVE');
  const [query, setQuery] = useState('');
  const [snapshots, setSnapshots] = useState<QuestSnapshot[]>([]);
  const [catalog, setCatalog] = useState<BattleMapResponse[]>([]);
  const [presets, setPresets] = useState<PartyPresetResponse[]>([]);
  const [draft, setDraft] = useState<QuestAutomationDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [mapQueries, setMapQueries] = useState<Record<string, string>>({});
  const baselineRef = useRef('');
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    setLoadError(null);
    if (battleCategories.length === 0) onLoadBattleCategories();
    try {
      const enabledCategories = filterAutomationProfileCategories(battleCategories).filter(({ enabled }) => enabled);
      const [nextSnapshots, nextPresets, ...mapGroups] = await Promise.all([
        fetchQuests(),
        onListPartyPresets(),
        ...enabledCategories.map(({ id }) => onLoadBattleMaps(id)),
      ]);
      if (generation !== generationRef.current) return;
      const nextCatalog = (mapGroups as BattleMapResponse[][]).flat().filter(
        (map): map is BattleMapResponse & { mapCode: string } => map.resolved && map.mapCode != null,
      );
      const nextDraft = buildQuestAutomationDraft(entry, nextSnapshots, nextCatalog);
      setSnapshots(nextSnapshots);
      setCatalog(nextCatalog);
      setPresets(nextPresets);
      setDraft(nextDraft);
      baselineRef.current = serializeDraft(nextDraft);
    } catch (error: unknown) {
      if (generation === generationRef.current) {
        setLoadError(toUserFacingErrorMessage(error));
      }
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [battleCategories, entry, fetchQuests, onListPartyPresets, onLoadBattleCategories, onLoadBattleMaps]);

  useEffect(() => {
    void load();
    return () => { generationRef.current += 1; };
  }, [load]);

  const visibleQuests = useMemo(
    () => filterQuests(snapshots, section, query),
    [query, section, snapshots],
  );
  const presetIds = useMemo(() => presets.map(({ id }) => id), [presets]);
  const validationErrors = useMemo(
    () => draft ? validateQuestAutomationDraft(draft, presetIds) : [],
    [draft, presetIds],
  );
  const dirty = draft != null && serializeDraft(draft) !== baselineRef.current;
  const busy = saving || localBusy;
  const saveDisabled = busy || loading || draft == null || validationErrors.length > 0;

  const updateDraft = useCallback((updater: (current: QuestAutomationDraft) => QuestAutomationDraft) => {
    setDraft((current) => current ? updater(current) : current);
  }, []);

  const renderQuest = useCallback(({ item }: { item: QuestSnapshot }) => {
    const selection = draft?.quests.find(({ questCode }) => questCode === item.questId);
    return (
      <QuestRow
        catalog={catalog}
        disabled={busy}
        mapQueries={mapQueries}
        presets={presets}
        selected={selection ?? null}
        snapshot={item}
        onMapQuery={(missionKey, value) => setMapQueries((current) => ({ ...current, [missionKey]: value }))}
        onToggle={() => updateDraft((current) => selectQuest(current, item, !selection, catalog))}
        onUpdateMission={(missionKey, maps) => updateDraft((current) => updateMissionMaps(current, item.questId, missionKey, maps))}
      />
    );
  }, [busy, catalog, draft, mapQueries, presets, updateDraft]);

  function requestBack() {
    if (!dirty) {
      onBack();
      return;
    }
    Alert.alert('변경 사항을 버릴까요?', '저장하지 않은 퀘스트 설정이 있습니다.', [
      { text: '계속 편집', style: 'cancel' },
      { text: '나가기', style: 'destructive', onPress: onBack },
    ]);
  }

  function confirmDelete() {
    Alert.alert('퀘스트 자동화를 삭제할까요?', '저장한 퀘스트와 맵 설정도 함께 삭제됩니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          if (busy) return;
          setLocalBusy(true);
          try {
            if (await onDelete()) onBack();
          } finally {
            setLocalBusy(false);
          }
        },
      },
    ]);
  }

  async function save() {
    if (!draft || saveDisabled) return;
    setLocalBusy(true);
    try {
      const request = buildQuestAutomationRequest(draft, presetIds);
      if (await onSave(request)) baselineRef.current = serializeDraft(draft);
    } finally {
      setLocalBusy(false);
    }
  }

  const activeTab = TABS.find((tab) => tab.section === section)!;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="퀘스트 자동화 뒤로" accessibilityRole="button" disabled={busy} onPress={requestBack} style={styles.iconButton}>
          <ArrowLeft color={theme.colors.text} size={21} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>퀘스트 자동화</Text>
          <Text style={styles.subtitle}>선택한 반복 퀘스트 설정은 목록에서 잠시 사라져도 유지돼요.</Text>
        </View>
        {draft ? (
          <Switch
            accessibilityLabel="퀘스트 자동화 사용"
            disabled={busy}
            onValueChange={(enabled) => updateDraft((current) => ({ ...current, enabled }))}
            value={draft.enabled}
          />
        ) : null}
      </View>

      <View style={styles.tabs}>
        {TABS.map((tab) => {
          const count = snapshots.filter(({ section: candidate }) => candidate === tab.section).length;
          return (
            <Pressable
              key={tab.section}
              accessibilityLabel={`${tab.label} 탭`}
              accessibilityRole="tab"
              accessibilityState={{ selected: section === tab.section }}
              onPress={() => setSection(tab.section)}
              style={[styles.tab, section === tab.section && styles.tabActive]}
            >
              <Text style={[styles.tabText, section === tab.section && styles.tabTextActive]}>{tab.label} {count}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        accessibilityLabel="퀘스트 검색"
        editable={!busy}
        onChangeText={setQuery}
        placeholder="퀘스트명 또는 미션 검색"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.search}
        value={query}
      />

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={theme.colors.accentGreen} />
          <Text style={styles.muted}>퀘스트 불러오는 중</Text>
        </View>
      ) : loadError ? (
        <View style={styles.centerState}>
          <Text style={styles.problem}>퀘스트를 불러오지 못했어요.</Text>
          <Text style={styles.muted}>{loadError}</Text>
          <Pressable accessibilityLabel="퀘스트 다시 불러오기" accessibilityRole="button" onPress={() => load()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={visibleQuests}
          initialNumToRender={12}
          keyboardShouldPersistTaps="handled"
          keyExtractor={({ questId }) => questId}
          ListEmptyComponent={<Text style={styles.empty}>{activeTab.empty}</Text>}
          maxToRenderPerBatch={12}
          removeClippedSubviews
          renderItem={renderQuest}
          windowSize={7}
        />
      )}

      {draft?.quests.some(({ missing }) => missing) ? (
        <Text style={styles.muted}>현재 목록에서 사라진 선택 퀘스트도 저장 시 그대로 유지됩니다.</Text>
      ) : null}
      {validationErrors.length > 0 ? <Text style={styles.problem}>{validationErrors[0]}</Text> : null}

      <View style={styles.footer}>
        <Pressable accessibilityLabel="퀘스트 자동화 삭제" accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={confirmDelete} style={[styles.deleteButton, busy && styles.disabled]}>
          <Trash2 color={theme.colors.danger} size={17} />
          <Text style={styles.deleteText}>삭제</Text>
        </Pressable>
        <Pressable accessibilityLabel="퀘스트 자동화 저장" accessibilityRole="button" accessibilityState={{ busy, disabled: saveDisabled }} disabled={saveDisabled} onPress={() => save()} style={[styles.saveButton, saveDisabled && styles.disabled]}>
          {busy ? <ActivityIndicator color={theme.colors.buttonText} size="small" /> : <Save color={theme.colors.buttonText} size={17} />}
          <Text style={styles.saveText}>저장</Text>
        </Pressable>
      </View>
    </View>
  );
}

type QuestRowProps = {
  snapshot: QuestSnapshot;
  selected: QuestAutomationDraft['quests'][number] | null;
  catalog: BattleMapResponse[];
  presets: PartyPresetResponse[];
  mapQueries: Record<string, string>;
  disabled: boolean;
  onToggle: () => void;
  onMapQuery: (missionKey: string, value: string) => void;
  onUpdateMission: (missionKey: string, maps: QuestMapSettingRequest[]) => void;
};

function QuestRow({ snapshot, selected, catalog, presets, mapQueries, disabled, onToggle, onMapQuery, onUpdateMission }: QuestRowProps) {
  const presetIds = presets.map(({ id }) => id);
  return (
    <View style={[styles.questCard, selected && styles.questCardSelected]}>
      <View style={styles.questHeading}>
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
        <View style={styles.questCopy}>
          <Text style={styles.questName}>{snapshot.name}</Text>
          <Text style={styles.muted}>{sectionLabel(snapshot.section)} · 원본 순서 {snapshot.sourceOrder + 1}</Text>
        </View>
      </View>
      {snapshot.missions.map((mission) => {
        const configured = selected?.missions.find(({ key }) => key === mission.key);
        const progress = buildMissionProgressLabel(mission);
        return (
          <View key={mission.key} style={styles.missionBlock}>
            <View style={styles.missionTitleLine}>
              <Text style={styles.missionBadge}>{buildMissionLabel(mission)}</Text>
              {progress ? <Text style={styles.progress}>{progress}</Text> : null}
            </View>
            {selected && configured ? (
              isCombatMission(configured) ? (
                <CombatMissionEditor
                  catalog={catalog}
                  disabled={disabled}
                  mapQuery={mapQueries[configured.key] ?? ''}
                  mission={configured}
                  presetIds={presetIds}
                  presets={presets}
                  onMapQuery={(value) => onMapQuery(configured.key, value)}
                  onUpdate={(maps) => onUpdateMission(configured.key, maps)}
                />
              ) : <Text style={styles.muted}>맵 설정이 필요 없는 미션입니다.</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

type CombatMissionEditorProps = {
  mission: QuestMissionDraft;
  catalog: BattleMapResponse[];
  presets: PartyPresetResponse[];
  presetIds: number[];
  mapQuery: string;
  disabled: boolean;
  onMapQuery: (value: string) => void;
  onUpdate: (maps: QuestMapSettingRequest[]) => void;
};

function CombatMissionEditor({ mission, catalog, presets, presetIds, mapQuery, disabled, onMapQuery, onUpdate }: CombatMissionEditorProps) {
  const readiness = getMissionReadiness(mission, presetIds);
  const needle = mapQuery.trim().toLocaleLowerCase();
  const options = catalog.filter((map) => !needle || `${map.name} ${map.groupName ?? ''}`.toLocaleLowerCase().includes(needle)).slice(0, 20);
  const pendingIndex = mission.maps.findIndex(({ mapCode }) => !mapCode);
  const canAdd = mission.type === 'MONSTER_KILL' || mission.maps.length === 0;

  function addMap() {
    if (disabled || !canAdd) return;
    onMapQuery('');
    onUpdate([...mission.maps, {
      missionKey: mission.key,
      categoryId: '',
      mapCode: '',
      executionOrder: mission.maps.length,
      manuallyOverridden: true,
      presetMode: 'PRIMARY',
      partyPresetId: null,
    }]);
  }

  function chooseMap(selected: BattleMapResponse) {
    if (disabled) return;
    const index = pendingIndex >= 0 ? pendingIndex : 0;
    const current = mission.maps[index];
    if (!current) return;
    onUpdate(mission.maps.map((map, currentIndex) => currentIndex === index ? applyManualMapOverride(map, selected) : map));
    onMapQuery('');
  }

  function updatePreset(index: number, partyPresetId: number | null) {
    if (disabled) return;
    onUpdate(mission.maps.map((map, currentIndex) => currentIndex !== index ? map : partyPresetId == null
      ? { ...map, presetMode: 'PRIMARY', partyPresetId: null }
      : { ...map, presetMode: 'EXPLICIT', partyPresetId }));
  }

  return (
    <View style={styles.combatEditor}>
      <Text style={[styles.readiness, readiness === '맵 설정 필요' || readiness === '프리셋 설정 필요' ? styles.problem : null]}>{readiness}</Text>
      {mission.maps.map((map, index) => (
        <View key={`${mission.key}:${index}`} style={styles.mapCard}>
          <View style={styles.mapHeading}>
            <Text style={styles.mapName}>{map.mapCode ? catalog.find((candidate) => candidate.categoryId === map.categoryId && candidate.mapCode === map.mapCode)?.name ?? map.mapCode : '맵을 선택해 주세요'}</Text>
            <Pressable accessibilityLabel={`${mission.key} ${index + 1}번째 맵 위로`} accessibilityRole="button" accessibilityState={{ disabled: disabled || index === 0 }} disabled={disabled || index === 0} onPress={() => { if (!disabled && index > 0) onUpdate(moveMissionMap(mission.maps, index, index - 1)); }} style={styles.smallIcon}><ArrowUp color={theme.colors.textMuted} size={15} /></Pressable>
            <Pressable accessibilityLabel={`${mission.key} ${index + 1}번째 맵 아래로`} accessibilityRole="button" accessibilityState={{ disabled: disabled || index === mission.maps.length - 1 }} disabled={disabled || index === mission.maps.length - 1} onPress={() => { if (!disabled && index < mission.maps.length - 1) onUpdate(moveMissionMap(mission.maps, index, index + 1)); }} style={styles.smallIcon}><ArrowDown color={theme.colors.textMuted} size={15} /></Pressable>
            <Pressable accessibilityLabel={`${mission.key} ${index + 1}번째 맵 제거`} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => { if (!disabled) onUpdate(removeMissionMap(mission.maps, index)); }} style={styles.smallIcon}><X color={theme.colors.danger} size={15} /></Pressable>
          </View>
          {map.mapCode ? (
            <View style={styles.presetRow}>
              <Pressable accessibilityLabel={`${mission.key} ${index + 1}번째 맵 대표 프리셋`} accessibilityRole="radio" accessibilityState={{ checked: map.presetMode === 'PRIMARY', disabled }} disabled={disabled} onPress={() => updatePreset(index, null)} style={[styles.choice, map.presetMode === 'PRIMARY' && styles.choiceActive]}><Text style={styles.choiceText}>대표 프리셋</Text></Pressable>
              {presets.map((preset) => <Pressable key={preset.id} accessibilityLabel={`${mission.key} ${index + 1}번째 맵 ${preset.name} 프리셋`} accessibilityRole="radio" accessibilityState={{ checked: map.partyPresetId === preset.id, disabled }} disabled={disabled} onPress={() => updatePreset(index, preset.id)} style={[styles.choice, map.partyPresetId === preset.id && styles.choiceActive]}><Text style={styles.choiceText}>{preset.name}</Text></Pressable>)}
            </View>
          ) : null}
        </View>
      ))}
      {pendingIndex >= 0 ? (
        <View style={styles.picker}>
          <TextInput accessibilityLabel={`${mission.key} 맵 검색`} editable={!disabled} onChangeText={onMapQuery} placeholder="맵 이름 검색" placeholderTextColor={theme.colors.textMuted} style={styles.mapSearch} value={mapQuery} />
          {options.map((map) => <Pressable key={`${map.categoryId}:${map.mapCode}`} accessibilityLabel={`${map.name} 맵 선택`} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => chooseMap(map)} style={styles.mapOption}><Text style={styles.mapOptionText}>{map.name}</Text><Text style={styles.muted}>{map.groupName}</Text></Pressable>)}
          {options.length === 0 ? <Text style={styles.muted}>검색 결과가 없습니다.</Text> : null}
        </View>
      ) : null}
      {canAdd && pendingIndex < 0 ? (
        <Pressable accessibilityLabel={`${mission.key} 맵 추가`} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={addMap} style={styles.addMapButton}>
          <Plus color={theme.colors.accentGreen} size={16} /><Text style={styles.addMapText}>맵 추가</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function updateMissionMaps(draft: QuestAutomationDraft, questCode: string, missionKey: string, maps: QuestMapSettingRequest[]): QuestAutomationDraft {
  return {
    ...draft,
    quests: draft.quests.map((quest) => quest.questCode !== questCode ? quest : {
      ...quest,
      missions: quest.missions.map((mission) => mission.key === missionKey ? { ...mission, maps } : mission),
    }),
  };
}

function serializeDraft(draft: QuestAutomationDraft): string { return JSON.stringify(draft); }
function sectionLabel(section: QuestSection): string { return TABS.find((tab) => tab.section === section)?.label ?? '완료'; }

const styles = StyleSheet.create({
  screen: { flex: 1, gap: theme.spacing.md, padding: theme.spacing.lg },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  tabs: { flexDirection: 'row', gap: theme.spacing.xs },
  tab: { alignItems: 'center', borderBottomColor: theme.colors.border, borderBottomWidth: 2, flex: 1, minHeight: 44, justifyContent: 'center' },
  tabActive: { borderBottomColor: theme.colors.accentGreen },
  tabText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800' },
  tabTextActive: { color: theme.colors.accentGreen },
  search: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, color: theme.colors.text, minHeight: 46, paddingHorizontal: theme.spacing.md },
  listContent: { gap: theme.spacing.sm, paddingBottom: theme.spacing.sm },
  centerState: { alignItems: 'center', gap: theme.spacing.sm, minHeight: 180, justifyContent: 'center' },
  empty: { color: theme.colors.textMuted, padding: theme.spacing.xl, textAlign: 'center' },
  muted: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  problem: { color: theme.colors.accentAmber, fontSize: 11, lineHeight: 16 },
  secondaryButton: { borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.lg },
  secondaryButtonText: { color: theme.colors.text, fontWeight: '800' },
  questCard: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md + 4, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  questCardSelected: { borderColor: theme.colors.accentGreen },
  questHeading: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  checkbox: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: 5, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  checkboxSelected: { backgroundColor: theme.colors.accentGreen, borderColor: theme.colors.accentGreen },
  checkboxText: { color: theme.colors.buttonText, fontSize: 18, fontWeight: '900' },
  questCopy: { flex: 1 },
  questName: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  missionBlock: { borderTopColor: theme.colors.border, borderTopWidth: 1, gap: theme.spacing.sm, paddingTop: theme.spacing.sm },
  missionTitleLine: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  missionBadge: { color: theme.colors.text, flex: 1, fontSize: 12, fontWeight: '700' },
  progress: { color: theme.colors.accentBlue, fontSize: 11, fontWeight: '800' },
  combatEditor: { gap: theme.spacing.sm },
  readiness: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '800' },
  mapCard: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: theme.spacing.sm, padding: theme.spacing.sm },
  mapHeading: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  mapName: { color: theme.colors.text, flex: 1, fontSize: 12, fontWeight: '800' },
  smallIcon: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  choice: { borderColor: theme.colors.borderStrong, borderRadius: 14, borderWidth: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  choiceActive: { borderColor: theme.colors.accentGreen },
  choiceText: { color: theme.colors.text, fontSize: 10, fontWeight: '700' },
  picker: { gap: theme.spacing.xs },
  mapSearch: { borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.sm },
  mapOption: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  mapOptionText: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  addMapButton: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, minHeight: 44, justifyContent: 'center' },
  addMapText: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800' },
  footer: { flexDirection: 'row', gap: theme.spacing.sm },
  deleteButton: { alignItems: 'center', borderColor: theme.colors.danger, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, minHeight: 48, justifyContent: 'center', paddingHorizontal: theme.spacing.lg },
  deleteText: { color: theme.colors.danger, fontWeight: '800' },
  saveButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, flex: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 48, justifyContent: 'center' },
  saveText: { color: theme.colors.buttonText, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});
