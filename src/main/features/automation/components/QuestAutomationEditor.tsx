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
import { ArrowLeft, Save, Trash2 } from 'lucide-react-native';

import {
  addUserQuestMap,
  buildQuestAutomationDraft,
  buildQuestAutomationRequest,
  filterQuests,
  isCombatMission,
  prioritizeSelectedQuests,
  refreshAutomaticQuestMaps,
  removeQuestMap,
  restoreQuestSelection,
  selectQuest,
  updateQuestMaps,
  validateQuestAutomationDraft,
  type QuestAutomationDraft,
  type QuestSelectionDraft,
} from '../../../domain/questAutomation';
import { filterAutomationProfileCategories } from '../../../domain/automationProfiles';
import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import type { PartyPresetCatalogResource } from '../../../domain/partyPresetCatalogModule';
import { theme } from '../../../styles/theme';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  QuestSection,
  QuestSnapshot,
  TypedAutomationEntryResponse,
  UpdateQuestAutomationRequest,
} from '../../../types/api';
import { QuestSummaryCard } from './QuestSummaryCard';

type VisibleSection = Extract<QuestSection, 'ACTIVE' | 'AVAILABLE' | 'WAITING'>;
type DeselectedQuestCacheEntry = { selection: QuestSelectionDraft };

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
  partyPresetCatalog: PartyPresetCatalogResource;
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
  partyPresetCatalog,
  onClearMutationMessage,
  onSave,
}: Props) {
  const [section, setSection] = useState<VisibleSection>('ACTIVE');
  const [query, setQuery] = useState('');
  const [snapshots, setSnapshots] = useState<QuestSnapshot[]>([]);
  const [catalog, setCatalog] = useState<BattleMapResponse[]>([]);
  const [draft, setDraft] = useState<QuestAutomationDraft | null>(null);
  const [questLoading, setQuestLoading] = useState(true);
  const [questLoaded, setQuestLoaded] = useState(false);
  const [questError, setQuestError] = useState<string | null>(null);
  const presetLoading = partyPresetCatalog.loading;
  const presetError = partyPresetCatalog.error;
  const [categoryRequested, setCategoryRequested] = useState(false);
  const [mapResources, setMapResources] = useState<Record<string, { loading: boolean; error: string | null }>>({});
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [undoQuestKey, setUndoQuestKey] = useState<string | null>(null);
  const baselineRef = useRef('');
  const baselineDraftRef = useRef<QuestAutomationDraft | null>(null);
  const draftRef = useRef<QuestAutomationDraft | null>(null);
  const draftSourceRef = useRef('');
  const mountedGenerationRef = useRef(0);
  const questGenerationRef = useRef(0);
  const mapGenerationRef = useRef<Record<string, number>>({});
  const mapRequestSequenceRef = useRef(0);
  const mapResourceRef = useRef(mapResources);
  const eligibleCategoryIdsRef = useRef(new Set<string>());
  const requestedCategoriesRef = useRef(false);
  const deselectedCacheRef = useRef<Record<string, DeselectedQuestCacheEntry>>({});
  const selectionOrderRef = useRef<string[]>([]);
  const undoQuestKeyRef = useRef<string | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoGenerationRef = useRef(0);
  const snapshotsRef = useRef(snapshots);
  const catalogRef = useRef(catalog);
  const isMountedRef = useRef(true);

  snapshotsRef.current = snapshots;
  catalogRef.current = catalog;

  const cancelUndoTimer = useCallback(() => {
    if (undoTimerRef.current == null) return;
    clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
  }, []);

  const clearUndo = useCallback(() => {
    undoGenerationRef.current += 1;
    cancelUndoTimer();
    undoQuestKeyRef.current = null;
    if (isMountedRef.current) setUndoQuestKey(null);
  }, [cancelUndoTimer]);

  const clearUndoForQuest = useCallback((questKey: string) => {
    if (undoQuestKeyRef.current === questKey) clearUndo();
  }, [clearUndo]);

  const offerUndo = useCallback((questKey: string) => {
    cancelUndoTimer();
    const generation = ++undoGenerationRef.current;
    undoQuestKeyRef.current = questKey;
    if (isMountedRef.current) setUndoQuestKey(questKey);
    undoTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current || undoGenerationRef.current !== generation || undoQuestKeyRef.current !== questKey) return;
      undoGenerationRef.current += 1;
      undoTimerRef.current = null;
      undoQuestKeyRef.current = null;
      setUndoQuestKey(null);
    }, 4000);
  }, [cancelUndoTimer]);

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
    return () => {
      mountedGenerationRef.current += 1;
      questGenerationRef.current += 1;
    };
  }, [loadQuests]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      undoGenerationRef.current += 1;
      cancelUndoTimer();
    };
  }, [cancelUndoTimer]);

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
      selectionOrderRef.current = nextDraft.quests.map(({ questKey }) => questKey);
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
        deselectedCacheRef.current = {};
        selectionOrderRef.current = nextDraft.quests.map(({ questKey }) => questKey);
        clearUndo();
        baselineDraftRef.current = nextDraft;
        baselineRef.current = serializeDraft(nextDraft);
        draftRef.current = nextDraft;
        setDraft(nextDraft);
        setRefreshWarning(false);
        return;
      }
      const hydrated = refreshAutomaticQuestMaps(current, catalog);
      baselineDraftRef.current = nextDraft;
      baselineRef.current = serializeDraft(nextDraft);
      if (hydrated !== current) {
        draftRef.current = hydrated;
        setDraft(hydrated);
      }
      setRefreshWarning(true);
      return;
    }
    const hydrated = refreshAutomaticQuestMaps(current, catalog);
    const baseline = baselineDraftRef.current == null
      ? null
      : refreshAutomaticQuestMaps(baselineDraftRef.current, catalog);
    if (baseline) {
      baselineDraftRef.current = baseline;
      baselineRef.current = serializeDraft(baseline);
    }
    if (hydrated !== current) {
      draftRef.current = hydrated;
      setDraft(hydrated);
    }
  }, [areBattleCategoriesLoaded, battleCategories.length, battleCategoriesError, catalog, clearUndo, eligibleCategories, entry, isBattleCategoriesLoading, questLoaded, mapResources, snapshots]);

  const selectedQuestKeys = useMemo(
    () => new Set(draft?.quests.map(({ questKey }) => questKey) ?? []),
    [draft],
  );
  const visibleQuests = useMemo(
    () => prioritizeSelectedQuests(filterQuests(snapshots, section, query), selectedQuestKeys),
    [query, section, selectedQuestKeys, snapshots],
  );
  const presetIds = useMemo(
    () => partyPresetCatalog.catalog.presets.map(({ id }) => id),
    [partyPresetCatalog.catalog.presets],
  );
  const validationErrors = useMemo(
    () => draft ? validateQuestAutomationDraft(draft, presetIds) : [],
    [draft, presetIds],
  );
  const dirty = draft != null && serializeDraft(draft) !== baselineRef.current;
  const busy = saving || localBusy;
  const editingDisabled = busy || draft == null;
  const combatSelections = draft?.quests.filter(({ missing, missions }) => !missing && missions.some(isCombatMission)) ?? [];
  const hasExplicitPreset = combatSelections.some(({ maps }) => maps.some(({ presetMode }) => presetMode === 'EXPLICIT'));
  const hasMissingCombatMap = combatSelections.some(({ maps }) => maps.length === 0 || maps.some(({ categoryId, mapCode }) => !categoryId || !mapCode));
  const mapErrors = eligibleCategories.filter(({ id }) => mapResources[id]?.error);
  const needsFullCatalog = hasMissingCombatMap || combatSelections.some(({ mapMode }) => mapMode === 'AUTO');
  const categoryLoading = isBattleCategoriesLoading || (!areBattleCategoriesLoaded && battleCategories.length === 0 && !battleCategoriesError && categoryRequested);
  const catalogLoading = categoryLoading || eligibleCategories.some(({ id }) => mapResources[id]?.loading);
  const catalogError = mapErrors.length > 0 || battleCategoriesError ? '전투맵을 불러오지 못했어요.' : null;
  const supportingResourcesBlockSave = combatSelections.length > 0 && (
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

  const toggleQuestSelection = useCallback((snapshot: QuestSnapshot) => {
    const current = draftRef.current;
    if (!current) return;
    const existingIndex = current.quests.findIndex(({ questKey }) => questKey === snapshot.questKey);
    if (existingIndex >= 0) {
      deselectedCacheRef.current[snapshot.questKey] = {
        selection: current.quests[existingIndex]!,
      };
      const next = selectQuest(current, snapshot, false, catalogRef.current);
      draftRef.current = next;
      setDraft(next);
      offerUndo(snapshot.questKey);
      return;
    }

    const cached = deselectedCacheRef.current[snapshot.questKey];
    if (!cached) {
      selectionOrderRef.current = [
        ...selectionOrderRef.current.filter((questKey) => questKey !== snapshot.questKey),
        snapshot.questKey,
      ];
    }
    const next = cached
      ? reinsertCachedQuestSelection(current, snapshot, cached, catalogRef.current, selectionOrderRef.current)
      : selectQuest(current, snapshot, true, catalogRef.current);
    draftRef.current = next;
    setDraft(next);
    clearUndoForQuest(snapshot.questKey);
  }, [clearUndoForQuest, offerUndo]);

  const undoDeselection = useCallback(() => {
    const questKey = undoQuestKeyRef.current;
    if (!questKey) return;
    const current = draftRef.current;
    const snapshot = snapshotsRef.current.find(({ questKey: candidate }) => candidate === questKey);
    const cached = deselectedCacheRef.current[questKey];
    if (!current || current.quests.some(({ questKey: candidate }) => candidate === questKey) || !snapshot || !cached) {
      clearUndo();
      return;
    }
    const next = reinsertCachedQuestSelection(current, snapshot, cached, catalogRef.current, selectionOrderRef.current);
    draftRef.current = next;
    setDraft(next);
    clearUndo();
  }, [clearUndo]);

  const updateQuest = useCallback((questKey: string, transform: (selection: QuestSelectionDraft) => QuestSelectionDraft) => {
    updateDraft((current) => updateQuestSelection(current, questKey, transform));
  }, [updateDraft]);

  const retryCatalog = useCallback(() => {
    if (battleCategoriesError) {
      onLoadBattleCategories();
      return;
    }
    const failed = eligibleCategories.filter(({ id }) => mapResourceRef.current[id]?.error != null);
    const categories = failed.length > 0 ? failed : catalog.length === 0 ? eligibleCategories : [];
    for (const category of categories) void loadCategoryMaps(category);
  }, [battleCategoriesError, catalog.length, eligibleCategories, loadCategoryMaps, onLoadBattleCategories]);

  const renderQuest = useCallback(({ item }: { item: QuestSnapshot }) => {
    const selection = draft?.quests.find(({ questKey }) => questKey === item.questKey);
    return (
      <QuestSummaryCard
        catalog={catalog}
        catalogError={catalogError}
        catalogLoading={catalogLoading}
        disabled={editingDisabled}
        partyPresetCatalog={partyPresetCatalog.catalog}
        selected={selection ?? null}
        sectionLabel={sectionLabel(item.section)}
        snapshot={item}
        onRetryCatalog={retryCatalog}
        onToggle={() => toggleQuestSelection(item)}
        onAddMap={(map) => updateQuest(item.questKey, (selection) => addUserQuestMap(selection, map))}
        onRemoveMap={(index) => updateQuest(item.questKey, (selection) => removeQuestMap(selection, index, catalogRef.current))}
        onUpdateMaps={(maps) => updateQuest(item.questKey, (selection) => updateQuestMaps(selection, maps))}
      />
    );
  }, [catalog, catalogError, catalogLoading, draft, editingDisabled, partyPresetCatalog.catalog, retryCatalog, toggleQuestSelection, updateQuest]);

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
    const savedDraft = draftRef.current;
    if (!savedDraft || saveDisabled) return;
    onClearMutationMessage();
    setLocalBusy(true);
    try {
      const request = buildQuestAutomationRequest(savedDraft, presetIds);
      if (await onSave(request)) {
        baselineDraftRef.current = savedDraft;
        baselineRef.current = serializeDraft(savedDraft);
        deselectedCacheRef.current = {};
        selectionOrderRef.current = savedDraft.quests.map(({ questKey }) => questKey);
        clearUndo();
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
        <ResourceWarning label="프리셋" retryLabel="프리셋 다시 불러오기" onRetry={partyPresetCatalog.retry} />
      ) : presetLoading ? <Text style={styles.muted}>프리셋 불러오는 중</Text> : null}
      {mapErrors.map((category) => (
        <ResourceWarning
          key={category.id}
          label={`${category.label} 맵`}
          message={mapResources[category.id]?.error ?? null}
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
              deselectedCacheRef.current = {};
              selectionOrderRef.current = nextDraft.quests.map(({ questKey }) => questKey);
              clearUndo();
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
          keyExtractor={({ questKey }) => questKey}
          ListHeaderComponent={missingSelections.length > 0 ? (
            <View style={styles.missingList}>
              {missingSelections.map((selection) => (
                <MissingSelectionCard
                  key={selection.questKey}
                  disabled={editingDisabled}
                  selection={selection}
                  onRemove={() => {
                    delete deselectedCacheRef.current[selection.questKey];
                    selectionOrderRef.current = selectionOrderRef.current.filter((questKey) => questKey !== selection.questKey);
                    clearUndoForQuest(selection.questKey);
                    updateDraft((current) => ({
                      ...current,
                      quests: current.quests.filter(({ questKey }) => questKey !== selection.questKey),
                    }));
                  }}
                />
              ))}
            </View>
          ) : null}
          ListEmptyComponent={<Text style={styles.empty}>{activeTab.empty}</Text>}
          maxToRenderPerBatch={12}
          nestedScrollEnabled
          removeClippedSubviews
          renderItem={renderQuest}
          style={styles.questList}
          windowSize={7}
        />
      )}

      {validationErrors.length > 0 ? <Text style={styles.problem}>{validationErrors[0]}</Text> : null}

      {undoQuestKey ? (
        <View accessibilityLiveRegion="polite" style={styles.undoSnackbar}>
          <Text style={styles.undoText}>선택 해제됨</Text>
          <Pressable
            accessibilityLabel="선택 해제 되돌리기"
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={undoDeselection}
            style={[styles.undoButton, busy && styles.disabled]}
          >
            <Text style={styles.undoButtonText}>선택 해제 되돌리기</Text>
          </Pressable>
        </View>
      ) : null}

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


function ResourceWarning({
  label,
  message,
  retryLabel,
  onRetry,
}: {
  label: string;
  message?: string | null;
  retryLabel: string;
  onRetry: () => void | Promise<unknown>;
}) {
  const copy = message?.trim() || `${label}을 불러오지 못했어요.`;
  return (
    <View style={styles.warningRow}>
      <Text accessibilityLiveRegion="polite" style={styles.problem}>{copy}</Text>
      <Pressable accessibilityLabel={retryLabel} accessibilityRole="button" onPress={() => { void onRetry(); }} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>다시 시도</Text>
      </Pressable>
    </View>
  );
}

type MissingSelectionCardProps = {
  selection: QuestAutomationDraft['quests'][number];
  disabled: boolean;
  onRemove: () => void;
};

function MissingSelectionCard({ selection, disabled, onRemove }: MissingSelectionCardProps) {
  return (
    <View style={[styles.questCard, styles.missingCard]}>
      <View style={styles.questHeading}>
        <View style={styles.questCopy}>
          <Text accessibilityLabel={`${selection.name} 저장된 선택`} accessibilityRole="header" style={styles.questName}>[{selection.displayCode}] {selection.name}</Text>
          <Text style={styles.problem}>저장된 반복 퀘스트 · 현재 목록에 없음</Text>
        </View>
        <Pressable
          accessibilityLabel={`${selection.name} 저장된 선택 제거`}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onRemove}
          style={styles.iconButton}
        >
          <Trash2 color={theme.colors.danger} size={17} />
        </Pressable>
      </View>
    </View>
  );
}

function reinsertCachedQuestSelection(
  draft: QuestAutomationDraft,
  snapshot: QuestSnapshot,
  cached: DeselectedQuestCacheEntry,
  catalog: readonly BattleMapResponse[],
  selectionOrder: string[],
): QuestAutomationDraft {
  const quests = [
    ...draft.quests.filter(({ questKey }) => questKey !== snapshot.questKey),
    restoreQuestSelection(snapshot, cached.selection, catalog),
  ];
  const knownCodes = new Set(selectionOrder);
  for (const { questKey } of quests) {
    if (knownCodes.has(questKey)) continue;
    knownCodes.add(questKey);
    selectionOrder.push(questKey);
  }
  const rank = new Map(selectionOrder.map((questKey, index) => [questKey, index]));
  return {
    ...draft,
    quests: quests
      .map((selection, index) => ({ selection, index }))
      .sort((left, right) => (
        (rank.get(left.selection.questKey) ?? Number.MAX_SAFE_INTEGER)
        - (rank.get(right.selection.questKey) ?? Number.MAX_SAFE_INTEGER)
        || left.index - right.index
      ))
      .map(({ selection }) => selection),
  };
}

function updateQuestSelection(
  draft: QuestAutomationDraft,
  questKey: string,
  transform: (selection: QuestSelectionDraft) => QuestSelectionDraft,
): QuestAutomationDraft {
  return {
    ...draft,
    quests: draft.quests.map((quest) => quest.questKey === questKey ? transform(quest) : quest),
  };
}
function serializeDraft(draft: QuestAutomationDraft): string { return JSON.stringify(draft); }
function serializeDraftSource(entry: TypedAutomationEntryResponse, snapshots: readonly QuestSnapshot[]): string { return JSON.stringify([entry, snapshots]); }
function sectionLabel(section: QuestSection): string { return TABS.find((tab) => tab.section === section)?.label ?? '완료'; }

const styles = StyleSheet.create({
  screen: { flex: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
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
  listContent: { gap: 6, paddingBottom: theme.spacing.xs },
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
  questHeading: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  questCopy: { flex: 1 },
  questName: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  undoSnackbar: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between', minHeight: 52, paddingHorizontal: theme.spacing.md },
  undoText: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  undoButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: theme.spacing.sm },
  undoButtonText: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '900' },
  footer: { flexDirection: 'row', gap: theme.spacing.sm },
  deleteButton: { alignItems: 'center', borderColor: theme.colors.danger, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, minHeight: 48, justifyContent: 'center', paddingHorizontal: theme.spacing.lg },
  deleteText: { color: theme.colors.danger, fontWeight: '800' },
  saveButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, flex: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 48, justifyContent: 'center' },
  saveText: { color: theme.colors.buttonText, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});
