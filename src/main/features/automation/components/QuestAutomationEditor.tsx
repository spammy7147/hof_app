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
  hydrateAutoMatchedMapClearMissions,
  isCombatMission,
  moveMissionMap,
  removeMissionMap,
  selectQuest,
  validateQuestAutomationDraft,
  type QuestAutomationDraft,
  type QuestMissionDraft,
} from '../../../domain/questAutomation';
import { filterAutomationProfileCategories } from '../../../domain/automationProfiles';
import { formatAutomationPresetSelection } from '../../../domain/partyPresets';
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
  areBattleCategoriesLoaded: boolean;
  isBattleCategoriesLoading: boolean;
  battleCategoriesError: string | null;
  mutationMessage: string | null;
  saving: boolean;
  fetchQuests: () => Promise<QuestSnapshot[]>;
  onBack: () => void;
  onDelete: () => Promise<boolean>;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  onClearMutationMessage: () => void;
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
  areBattleCategoriesLoaded,
  isBattleCategoriesLoading,
  battleCategoriesError,
  mutationMessage,
  saving,
  fetchQuests,
  onBack,
  onDelete,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onListPartyPresets,
  onClearMutationMessage,
  onSave,
}: Props) {
  const [section, setSection] = useState<VisibleSection>('ACTIVE');
  const [query, setQuery] = useState('');
  const [snapshots, setSnapshots] = useState<QuestSnapshot[]>([]);
  const [catalog, setCatalog] = useState<BattleMapResponse[]>([]);
  const [presets, setPresets] = useState<PartyPresetResponse[]>([]);
  const [draft, setDraft] = useState<QuestAutomationDraft | null>(null);
  const [questLoading, setQuestLoading] = useState(true);
  const [questLoaded, setQuestLoaded] = useState(false);
  const [questError, setQuestError] = useState<string | null>(null);
  const [presetLoading, setPresetLoading] = useState(true);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [categoryRequested, setCategoryRequested] = useState(false);
  const [mapResources, setMapResources] = useState<Record<string, { loading: boolean; error: string | null }>>({});
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [mapQueries, setMapQueries] = useState<Record<string, string>>({});
  const baselineRef = useRef('');
  const baselineDraftRef = useRef<QuestAutomationDraft | null>(null);
  const draftRef = useRef<QuestAutomationDraft | null>(null);
  const draftSourceRef = useRef('');
  const removedAutoMissionsRef = useRef(new Set<string>());
  const mountedGenerationRef = useRef(0);
  const questGenerationRef = useRef(0);
  const presetGenerationRef = useRef(0);
  const mapGenerationRef = useRef<Record<string, number>>({});
  const mapRequestSequenceRef = useRef(0);
  const mapResourceRef = useRef(mapResources);
  const eligibleCategoryIdsRef = useRef(new Set<string>());
  const requestedCategoriesRef = useRef(false);

  const loadQuests = useCallback(async () => {
    const generation = ++questGenerationRef.current;
    const mountedGeneration = mountedGenerationRef.current;
    setQuestLoading(true);
    setQuestError(null);
    try {
      const nextSnapshots = await fetchQuests();
      if (mountedGeneration === mountedGenerationRef.current && generation === questGenerationRef.current) {
        setSnapshots(nextSnapshots);
        setQuestLoaded(true);
      }
    } catch (error: unknown) {
      if (mountedGeneration === mountedGenerationRef.current && generation === questGenerationRef.current) {
        setQuestError(toUserFacingErrorMessage(error));
      }
    } finally {
      if (mountedGeneration === mountedGenerationRef.current && generation === questGenerationRef.current) {
        setQuestLoading(false);
      }
    }
  }, [fetchQuests]);

  const loadPresets = useCallback(async () => {
    const generation = ++presetGenerationRef.current;
    const mountedGeneration = mountedGenerationRef.current;
    setPresetLoading(true);
    setPresetError(null);
    try {
      const nextPresets = await onListPartyPresets();
      if (mountedGeneration === mountedGenerationRef.current && generation === presetGenerationRef.current) {
        setPresets(nextPresets);
      }
    } catch (error: unknown) {
      if (mountedGeneration === mountedGenerationRef.current && generation === presetGenerationRef.current) {
        setPresetError(toUserFacingErrorMessage(error));
      }
    } finally {
      if (mountedGeneration === mountedGenerationRef.current && generation === presetGenerationRef.current) {
        setPresetLoading(false);
      }
    }
  }, [onListPartyPresets]);

  const loadCategoryMaps = useCallback(async (category: BattleCategoryResponse) => {
    const generation = ++mapRequestSequenceRef.current;
    mapGenerationRef.current[category.id] = generation;
    const mountedGeneration = mountedGenerationRef.current;
    const loadingState = { loading: true, error: null };
    mapResourceRef.current = { ...mapResourceRef.current, [category.id]: loadingState };
    setMapResources(mapResourceRef.current);
    try {
      const maps = await onLoadBattleMaps(category.id);
      if (mountedGeneration !== mountedGenerationRef.current || mapGenerationRef.current[category.id] !== generation || !eligibleCategoryIdsRef.current.has(category.id)) return;
      setCatalog((current) => [
        ...current.filter(({ categoryId }) => categoryId !== category.id),
        ...maps.filter((map): map is BattleMapResponse & { mapCode: string } => map.resolved && map.mapCode != null),
      ]);
      const successState = { loading: false, error: null };
      mapResourceRef.current = { ...mapResourceRef.current, [category.id]: successState };
      setMapResources(mapResourceRef.current);
    } catch (error: unknown) {
      if (mountedGeneration !== mountedGenerationRef.current || mapGenerationRef.current[category.id] !== generation || !eligibleCategoryIdsRef.current.has(category.id)) return;
      const errorState = { loading: false, error: toUserFacingErrorMessage(error) };
      mapResourceRef.current = { ...mapResourceRef.current, [category.id]: errorState };
      setMapResources(mapResourceRef.current);
    }
  }, [onLoadBattleMaps]);

  useEffect(() => {
    void loadQuests();
    void loadPresets();
    return () => {
      mountedGenerationRef.current += 1;
      questGenerationRef.current += 1;
      presetGenerationRef.current += 1;
    };
  }, [loadPresets, loadQuests]);

  useEffect(() => {
    mapResourceRef.current = mapResources;
  }, [mapResources]);

  useEffect(() => {
    if (!areBattleCategoriesLoaded && battleCategories.length === 0 && !isBattleCategoriesLoading && !battleCategoriesError && !requestedCategoriesRef.current) {
      requestedCategoriesRef.current = true;
      setCategoryRequested(true);
      onLoadBattleCategories();
    }
    if (battleCategories.length > 0 || battleCategoriesError || isBattleCategoriesLoading) {
      requestedCategoriesRef.current = false;
      setCategoryRequested(false);
    }
  }, [areBattleCategoriesLoaded, battleCategories.length, battleCategoriesError, isBattleCategoriesLoading, onLoadBattleCategories]);

  const eligibleCategories = useMemo(
    () => filterAutomationProfileCategories(battleCategories).filter(({ enabled }) => enabled),
    [battleCategories],
  );
  const categoryKey = eligibleCategories.map(({ id }) => id).join('|');

  useEffect(() => {
    const eligibleIds = new Set(eligibleCategories.map(({ id }) => id));
    eligibleCategoryIdsRef.current = eligibleIds;
    const nextResources = Object.fromEntries(
      Object.entries(mapResourceRef.current).filter(([id]) => eligibleIds.has(id)),
    );
    for (const id of Object.keys(mapGenerationRef.current)) {
      if (!eligibleIds.has(id)) delete mapGenerationRef.current[id];
    }
    mapResourceRef.current = nextResources;
    setMapResources(nextResources);
    setCatalog((current) => current.filter(({ categoryId }) => eligibleIds.has(categoryId)));
  }, [categoryKey, eligibleCategories]);

  useEffect(() => {
    for (const category of eligibleCategories) {
      if (!mapResourceRef.current[category.id]) void loadCategoryMaps(category);
    }
  }, [categoryKey, eligibleCategories, loadCategoryMaps]);

  useEffect(() => {
    const categorySettled = !isBattleCategoriesLoading && (
      areBattleCategoriesLoaded || battleCategories.length > 0 || battleCategoriesError != null
    );
    const mapsSettled = eligibleCategories.every(({ id }) => {
      const resource = mapResourceRef.current[id];
      return resource != null && !resource.loading;
    });
    if (!questLoaded || !categorySettled || !mapsSettled) return;
    const source = serializeDraftSource(entry, snapshots);
    const nextDraft = buildQuestAutomationDraft(entry, snapshots, catalog);
    const current = draftRef.current;
    if (current == null) {
      removedAutoMissionsRef.current.clear();
      draftSourceRef.current = source;
      baselineDraftRef.current = nextDraft;
      baselineRef.current = serializeDraft(nextDraft);
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setRefreshWarning(false);
      return;
    }
    if (draftSourceRef.current !== source) {
      draftSourceRef.current = source;
      if (serializeDraft(current) === baselineRef.current) {
        removedAutoMissionsRef.current.clear();
        baselineDraftRef.current = nextDraft;
        baselineRef.current = serializeDraft(nextDraft);
        draftRef.current = nextDraft;
        setDraft(nextDraft);
        setRefreshWarning(false);
        return;
      }
      const hydrated = hydrateAutoMatchedMapClearMissions(current, catalog, (questCode, missionKey) => (
        removedAutoMissionsRef.current.has(buildMissionIdentity(questCode, missionKey))
      ));
      baselineDraftRef.current = nextDraft;
      baselineRef.current = serializeDraft(nextDraft);
      if (hydrated !== current) {
        draftRef.current = hydrated;
        setDraft(hydrated);
      }
      setRefreshWarning(true);
      return;
    }
    const hydrated = hydrateAutoMatchedMapClearMissions(current, catalog, (questCode, missionKey) => (
      removedAutoMissionsRef.current.has(buildMissionIdentity(questCode, missionKey))
    ));
    const baseline = baselineDraftRef.current == null
      ? null
      : hydrateAutoMatchedMapClearMissions(baselineDraftRef.current, catalog);
    if (baseline) {
      baselineDraftRef.current = baseline;
      baselineRef.current = serializeDraft(baseline);
    }
    if (hydrated !== current) {
      draftRef.current = hydrated;
      setDraft(hydrated);
    }
  }, [areBattleCategoriesLoaded, battleCategories.length, battleCategoriesError, catalog, eligibleCategories, entry, isBattleCategoriesLoading, questLoaded, mapResources, snapshots]);

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
  const editingDisabled = busy || draft == null;
  const combatMissions = draft?.quests.flatMap(({ missions }) => missions.filter(isCombatMission)) ?? [];
  const hasExplicitPreset = combatMissions.some(({ maps }) => maps.some(({ presetMode }) => presetMode === 'EXPLICIT'));
  const hasMissingCombatMap = combatMissions.some(({ maps }) => maps.length === 0 || maps.some(({ categoryId, mapCode }) => !categoryId || !mapCode));
  const mapErrors = eligibleCategories.filter(({ id }) => mapResources[id]?.error);
  const needsFullCatalog = hasMissingCombatMap || combatMissions.some((mission) => (
    mission.type === 'MAP_CLEAR' && mission.maps.every(({ manuallyOverridden }) => !manuallyOverridden)
  ));
  const categoryLoading = isBattleCategoriesLoading || (!areBattleCategoriesLoaded && battleCategories.length === 0 && !battleCategoriesError && categoryRequested);
  const supportingResourcesBlockSave = combatMissions.length > 0 && (
    (needsFullCatalog && (
      categoryLoading ||
      (battleCategories.length === 0 && battleCategoriesError != null) ||
      eligibleCategories.some(({ id }) => mapResources[id]?.loading) ||
      mapErrors.length > 0
    )) ||
    (hasExplicitPreset && (presetLoading || presetError != null))
  );
  const saveDisabled = busy || questLoading || draft == null || validationErrors.length > 0 || supportingResourcesBlockSave;

  const updateDraft = useCallback((updater: (current: QuestAutomationDraft) => QuestAutomationDraft) => {
    const current = draftRef.current;
    if (!current) return;
    const next = updater(current);
    draftRef.current = next;
    setDraft(next);
  }, []);

  const updateUserMissionMaps = useCallback((questCode: string, missionKey: string, maps: QuestMapSettingRequest[]) => {
    const previous = draftRef.current?.quests
      .find((quest) => quest.questCode === questCode)?.missions
      .find((mission) => mission.key === missionKey)?.maps;
    if (!previous) return;
    const identity = buildMissionIdentity(questCode, missionKey);
    if (previous.length > 0 && maps.length === 0) removedAutoMissionsRef.current.add(identity);
    if (maps.length > 0) removedAutoMissionsRef.current.delete(identity);
    updateDraft((current) => updateMissionMaps(current, questCode, missionKey, maps));
  }, [updateDraft]);

  const renderQuest = useCallback(({ item }: { item: QuestSnapshot }) => {
    const selection = draft?.quests.find(({ questCode }) => questCode === item.questId);
    return (
      <QuestRow
        catalog={catalog}
        disabled={editingDisabled}
        mapQueries={mapQueries}
        presets={presets}
        selected={selection ?? null}
        snapshot={item}
        onMapQuery={(missionKey, value) => setMapQueries((current) => ({
          ...current,
          [buildMapQueryKey(item.questId, missionKey)]: value,
        }))}
        onToggle={() => updateDraft((current) => selectQuest(current, item, !selection, catalog))}
        onUpdateMission={(missionKey, maps) => updateUserMissionMaps(item.questId, missionKey, maps)}
      />
    );
  }, [catalog, draft, editingDisabled, mapQueries, presets, updateDraft, updateUserMissionMaps]);

  const missingSelections = draft?.quests.filter(({ missing }) => missing) ?? [];

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
          onClearMutationMessage();
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
    onClearMutationMessage();
    setLocalBusy(true);
    try {
      const request = buildQuestAutomationRequest(draft, presetIds);
      if (await onSave(request)) {
        baselineDraftRef.current = draft;
        baselineRef.current = serializeDraft(draft);
      }
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

      {mutationMessage ? (
        <Text accessibilityLabel="퀘스트 자동화 작업 오류" accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.problem}>
          {mutationMessage}
        </Text>
      ) : null}
      {categoryLoading ? <Text style={styles.muted}>맵 카테고리 불러오는 중</Text> : null}
      {draft == null && questLoaded ? <Text style={styles.muted}>맵 설정 준비 중</Text> : null}
      {battleCategoriesError ? (
        <ResourceWarning
          label="맵 카테고리"
          retryLabel="맵 카테고리 다시 불러오기"
          onRetry={onLoadBattleCategories}
        />
      ) : null}
      {presetError ? (
        <ResourceWarning label="프리셋" retryLabel="프리셋 다시 불러오기" onRetry={() => loadPresets()} />
      ) : presetLoading ? <Text style={styles.muted}>프리셋 불러오는 중</Text> : null}
      {mapErrors.map((category) => (
        <ResourceWarning
          key={category.id}
          label={`${category.label} 맵`}
          retryLabel={`${category.label} 맵 다시 불러오기`}
          onRetry={() => loadCategoryMaps(category)}
        />
      ))}
      {refreshWarning ? (
        <View style={styles.warningRow}>
          <Text style={styles.problem}>새 서버 설정이 있어요. 편집 중인 변경은 유지했습니다.</Text>
          <Pressable
            accessibilityLabel="서버 설정으로 다시 불러오기"
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              const nextDraft = buildQuestAutomationDraft(entry, snapshots, catalog);
              removedAutoMissionsRef.current.clear();
              draftSourceRef.current = serializeDraftSource(entry, snapshots);
              baselineDraftRef.current = nextDraft;
              baselineRef.current = serializeDraft(nextDraft);
              draftRef.current = nextDraft;
              setDraft(nextDraft);
              setRefreshWarning(false);
            }}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>다시 불러오기</Text>
          </Pressable>
        </View>
      ) : null}

      {questLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={theme.colors.accentGreen} />
          <Text style={styles.muted}>퀘스트 불러오는 중</Text>
        </View>
      ) : questError ? (
        <View style={styles.centerState}>
          <Text style={styles.problem}>퀘스트를 불러오지 못했어요.</Text>
          <Text style={styles.muted}>{questError}</Text>
          <Pressable accessibilityLabel="퀘스트 다시 불러오기" accessibilityRole="button" onPress={() => loadQuests()} style={styles.secondaryButton}>
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
          ListHeaderComponent={missingSelections.length > 0 ? (
            <View style={styles.missingList}>
              {missingSelections.map((selection) => (
                <MissingSelectionCard
                  key={selection.questCode}
                  catalog={catalog}
                  disabled={editingDisabled}
                  mapQueries={mapQueries}
                  presets={presets}
                  selection={selection}
                  onMapQuery={(missionKey, value) => setMapQueries((current) => ({
                    ...current,
                    [buildMapQueryKey(selection.questCode, missionKey)]: value,
                  }))}
                  onRemove={() => updateDraft((current) => ({
                    ...current,
                    quests: current.quests.filter(({ questCode }) => questCode !== selection.questCode),
                  }))}
                  onUpdateMission={(missionKey, maps) => updateUserMissionMaps(selection.questCode, missionKey, maps)}
                />
              ))}
            </View>
          ) : null}
          ListEmptyComponent={<Text style={styles.empty}>{activeTab.empty}</Text>}
          maxToRenderPerBatch={12}
          removeClippedSubviews
          renderItem={renderQuest}
          style={styles.questList}
          windowSize={7}
        />
      )}

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

function ResourceWarning({ label, retryLabel, onRetry }: { label: string; retryLabel: string; onRetry: () => void | Promise<unknown> }) {
  return (
    <View style={styles.warningRow}>
      <Text accessibilityLiveRegion="polite" style={styles.problem}>{label}을 불러오지 못했어요.</Text>
      <Pressable accessibilityLabel={retryLabel} accessibilityRole="button" onPress={() => { void onRetry(); }} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>다시 시도</Text>
      </Pressable>
    </View>
  );
}

type MissingSelectionCardProps = {
  selection: QuestAutomationDraft['quests'][number];
  catalog: BattleMapResponse[];
  presets: PartyPresetResponse[];
  mapQueries: Record<string, string>;
  disabled: boolean;
  onRemove: () => void;
  onMapQuery: (missionKey: string, value: string) => void;
  onUpdateMission: (missionKey: string, maps: QuestMapSettingRequest[]) => void;
};

function MissingSelectionCard({ selection, catalog, presets, mapQueries, disabled, onRemove, onMapQuery, onUpdateMission }: MissingSelectionCardProps) {
  const presetIds = presets.map(({ id }) => id);
  return (
    <View style={[styles.questCard, styles.missingCard]}>
      <View style={styles.questHeading}>
        <View style={styles.questCopy}>
          <Text accessibilityLabel={`${selection.questCode} 저장된 선택`} accessibilityRole="header" style={styles.questName}>{selection.questCode}</Text>
          <Text style={styles.problem}>저장된 반복 퀘스트 · 현재 목록에 없음</Text>
        </View>
        <Pressable
          accessibilityLabel={`${selection.questCode} 저장된 선택 제거`}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onRemove}
          style={styles.iconButton}
        >
          <Trash2 color={theme.colors.danger} size={17} />
        </Pressable>
      </View>
      {selection.missions.map((mission) => (
        <View key={mission.key} style={styles.missionBlock}>
          <Text style={styles.missionBadge}>저장된 전투 설정 · {mission.key}</Text>
          <CombatMissionEditor
            catalog={catalog}
            disabled={disabled}
            mapQuery={mapQueries[buildMapQueryKey(selection.questCode, mission.key)] ?? ''}
            mission={mission}
            presetIds={presetIds}
            presets={presets}
            questContext={selection.questCode}
            onMapQuery={(value) => onMapQuery(mission.key, value)}
            onUpdate={(maps) => onUpdateMission(mission.key, maps)}
          />
        </View>
      ))}
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
                  mapQuery={mapQueries[buildMapQueryKey(snapshot.questId, configured.key)] ?? ''}
                  mission={configured}
                  presetIds={presetIds}
                  presets={presets}
                  questContext={snapshot.name || snapshot.questId}
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
  questContext: string;
  onMapQuery: (value: string) => void;
  onUpdate: (maps: QuestMapSettingRequest[]) => void;
};

function CombatMissionEditor({ mission, catalog, presets, presetIds, mapQuery, disabled, questContext, onMapQuery, onUpdate }: CombatMissionEditorProps) {
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
            <Pressable accessibilityLabel={`${questContext} · ${mission.key} ${index + 1}번째 맵 위로`} accessibilityRole="button" accessibilityState={{ disabled: disabled || index === 0 }} disabled={disabled || index === 0} onPress={() => { if (!disabled && index > 0) onUpdate(moveMissionMap(mission.maps, index, index - 1)); }} style={styles.smallIcon}><ArrowUp color={theme.colors.textMuted} size={15} /></Pressable>
            <Pressable accessibilityLabel={`${questContext} · ${mission.key} ${index + 1}번째 맵 아래로`} accessibilityRole="button" accessibilityState={{ disabled: disabled || index === mission.maps.length - 1 }} disabled={disabled || index === mission.maps.length - 1} onPress={() => { if (!disabled && index < mission.maps.length - 1) onUpdate(moveMissionMap(mission.maps, index, index + 1)); }} style={styles.smallIcon}><ArrowDown color={theme.colors.textMuted} size={15} /></Pressable>
            <Pressable accessibilityLabel={`${questContext} · ${mission.key} ${index + 1}번째 맵 제거`} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => { if (!disabled) onUpdate(removeMissionMap(mission.maps, index)); }} style={styles.smallIcon}><X color={theme.colors.danger} size={15} /></Pressable>
          </View>
          {map.mapCode ? (
            <View style={styles.presetRow}>
              <Pressable accessibilityLabel={`${questContext} · ${mission.key} ${index + 1}번째 맵 대표 프리셋`} accessibilityRole="radio" accessibilityState={{ checked: map.presetMode === 'PRIMARY', disabled }} disabled={disabled} onPress={() => updatePreset(index, null)} style={[styles.choice, map.presetMode === 'PRIMARY' && styles.choiceActive]}><Text style={styles.choiceText}>{formatAutomationPresetSelection({ presetMode: 'PRIMARY', partyPresetId: null }, presets)}</Text></Pressable>
              {presets.map((preset) => <Pressable key={preset.id} accessibilityLabel={`${questContext} · ${mission.key} ${index + 1}번째 맵 ${preset.name} 프리셋`} accessibilityRole="radio" accessibilityState={{ checked: map.partyPresetId === preset.id, disabled }} disabled={disabled} onPress={() => updatePreset(index, preset.id)} style={[styles.choice, map.partyPresetId === preset.id && styles.choiceActive]}><Text style={styles.choiceText}>{preset.name}</Text></Pressable>)}
            </View>
          ) : null}
        </View>
      ))}
      {pendingIndex >= 0 ? (
        <View style={styles.picker}>
          <TextInput accessibilityLabel={`${questContext} · ${mission.key} 맵 검색`} editable={!disabled} onChangeText={onMapQuery} placeholder="맵 이름 검색" placeholderTextColor={theme.colors.textMuted} style={styles.mapSearch} value={mapQuery} />
          {options.map((map) => <Pressable key={`${map.categoryId}:${map.mapCode}`} accessibilityLabel={`${questContext} · ${mission.key} · ${map.name} 맵 선택`} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => chooseMap(map)} style={styles.mapOption}><Text style={styles.mapOptionText}>{map.name}</Text><Text style={styles.muted}>{map.groupName}</Text></Pressable>)}
          {options.length === 0 ? <Text style={styles.muted}>검색 결과가 없습니다.</Text> : null}
        </View>
      ) : null}
      {canAdd && pendingIndex < 0 ? (
        <Pressable accessibilityLabel={`${questContext} · ${mission.key} 맵 추가`} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={addMap} style={styles.addMapButton}>
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

function buildMapQueryKey(questCode: string, missionKey: string): string { return `${questCode}\u0000${missionKey}`; }
function buildMissionIdentity(questCode: string, missionKey: string): string { return `${questCode}\u0000${missionKey}`; }
function serializeDraft(draft: QuestAutomationDraft): string { return JSON.stringify(draft); }
function serializeDraftSource(entry: TypedAutomationEntryResponse, snapshots: readonly QuestSnapshot[]): string { return JSON.stringify([entry, snapshots]); }
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
  questList: { flex: 1 },
  missingList: { gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  missingCard: { borderColor: theme.colors.accentAmber },
  warningRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
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
