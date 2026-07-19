import { useCallback, useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  findNodeHandle,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Save, Trash2 } from 'lucide-react-native';

import {
  battleMapIdentity,
  buildBattleMapAutomationDraft,
  buildBattleMapAutomationRequest,
  buildBattleProgress,
  describeBattleBatch,
  filterBattleAutomationCategories,
  moveBattleMapSetting,
  parseBattleDailyTarget,
  removeBattleMapSetting,
  selectBattleMap,
  validateBattleMapAutomationDraft,
  type BattleMapAutomationDraft,
} from '../../../domain/battleMapAutomation';
import { buildBattleMapCatalogRows, type BattleMapCatalogRow } from '../../../domain/battleMapCatalog';
import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import { formatAutomationPresetSelection } from '../../../domain/partyPresets';
import { theme } from '../../../styles/theme';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  PartyPresetResponse,
  TypedAutomationEntryResponse,
  UpdateBattleMapAutomationRequest,
} from '../../../types/api';
import { BattleMapPresetPickerModal } from './BattleMapPresetPickerModal';
import {
  BattleMapCatalogCategoryRow,
  BattleMapCatalogGroupRow,
  BattleMapCatalogMapRow,
  BattleMapCatalogStateRow,
} from './BattleMapCatalogRows';

type Props = {
  entry: TypedAutomationEntryResponse;
  battleCategories: BattleCategoryResponse[];
  areBattleCategoriesLoaded: boolean;
  isBattleCategoriesLoading: boolean;
  battleCategoriesError: string | null;
  mutationMessage: string | null;
  saving: boolean;
  onBack: () => void;
  onDelete: () => Promise<boolean>;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  onClearMutationMessage: () => void;
  onSave: (request: UpdateBattleMapAutomationRequest) => Promise<boolean>;
};

type ResourceState = { loading: boolean; error: string | null };
type EditorListItem =
  | { key: string; kind: 'HEADING'; title: string }
  | { key: string; kind: 'SELECTED_EMPTY' }
  | { key: string; kind: 'SELECTED'; setting: BattleMapAutomationDraft['maps'][number]; index: number }
  | { key: string; kind: 'CATALOG_SEARCH' }
  | { key: string; kind: 'CATALOG_EMPTY' }
  | { key: string; kind: 'CATALOG_ROW'; row: BattleMapCatalogRow };

export function BattleMapAutomationEditor({
  entry,
  battleCategories,
  areBattleCategoriesLoaded,
  isBattleCategoriesLoading,
  battleCategoriesError,
  mutationMessage,
  saving,
  onBack,
  onDelete,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onListPartyPresets,
  onClearMutationMessage,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<BattleMapAutomationDraft>(() => buildBattleMapAutomationDraft(entry, []));
  const [catalog, setCatalog] = useState<BattleMapResponse[]>([]);
  const [query, setQuery] = useState('');
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);
  const [activePresetIdentity, setActivePresetIdentity] = useState<string | null>(null);
  const [presets, setPresets] = useState<PartyPresetResponse[]>([]);
  const [presetState, setPresetState] = useState<ResourceState>({ loading: true, error: null });
  const [mapStates, setMapStates] = useState<Record<string, ResourceState>>({});
  const [localBusy, setLocalBusy] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [serverRefreshWarning, setServerRefreshWarning] = useState(false);
  const draftRef = useRef(draft);
  const queryRef = useRef(query);
  const baselineRef = useRef(serializeEditableDraft(draft));
  const entrySettingsRef = useRef(serializeEntrySettings(entry));
  const mountedGenerationRef = useRef(0);
  const presetGenerationRef = useRef(0);
  const mapGenerationRef = useRef<Record<string, number>>({});
  const mapSequenceRef = useRef(0);
  const eligibleIdsRef = useRef(new Set<string>());
  const requestedCategoriesRef = useRef(false);
  const mountedRef = useRef(false);
  const controlsDisabledRef = useRef(false);
  const presetTriggerNodesRef = useRef(new Map<string, ElementRef<typeof Pressable>>());
  const invokingPresetTriggerRef = useRef<{
    identity: string;
    nodeHandle: ReturnType<typeof findNodeHandle>;
  } | null>(null);
  const presetFocusGenerationRef = useRef(0);
  const restorePresetFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateDraft = useCallback((updater: (current: BattleMapAutomationDraft) => BattleMapAutomationDraft) => {
    const next = updater(draftRef.current);
    draftRef.current = next;
    setDraft(next);
  }, []);
  const updateEditableDraft = useCallback((updater: (current: BattleMapAutomationDraft) => BattleMapAutomationDraft) => {
    if (controlsDisabledRef.current) return;
    updateDraft((current) => controlsDisabledRef.current ? current : updater(current));
  }, [updateDraft]);

  const loadPresets = useCallback(async () => {
    const generation = ++presetGenerationRef.current;
    const mountedGeneration = mountedGenerationRef.current;
    setPresetState({ loading: true, error: null });
    try {
      const next = await onListPartyPresets();
      if (mountedGeneration === mountedGenerationRef.current && generation === presetGenerationRef.current) {
        setPresets(next);
        setPresetState({ loading: false, error: null });
      }
    } catch (error: unknown) {
      if (mountedGeneration === mountedGenerationRef.current && generation === presetGenerationRef.current) {
        setPresetState({ loading: false, error: toUserFacingErrorMessage(error) });
      }
    }
  }, [onListPartyPresets]);

  const loadCategoryMaps = useCallback(async (category: BattleCategoryResponse) => {
    const generation = ++mapSequenceRef.current;
    const mountedGeneration = mountedGenerationRef.current;
    mapGenerationRef.current[category.id] = generation;
    setMapStates((current) => ({ ...current, [category.id]: { loading: true, error: null } }));
    try {
      const maps = await onLoadBattleMaps(category.id);
      if (mountedGeneration !== mountedGenerationRef.current
        || generation !== mapGenerationRef.current[category.id]
        || !eligibleIdsRef.current.has(category.id)) return;
      const resolved = maps.filter((map): map is BattleMapResponse & { mapCode: string } => map.resolved && map.mapCode != null);
      setCatalog((current) => [...current.filter(({ categoryId }) => categoryId !== category.id), ...resolved]);
      setMapStates((current) => ({ ...current, [category.id]: { loading: false, error: null } }));
    } catch (error: unknown) {
      if (mountedGeneration !== mountedGenerationRef.current
        || generation !== mapGenerationRef.current[category.id]
        || !eligibleIdsRef.current.has(category.id)) return;
      setMapStates((current) => ({
        ...current,
        [category.id]: { loading: false, error: toUserFacingErrorMessage(error) },
      }));
    }
  }, [onLoadBattleMaps]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mountedGenerationRef.current += 1;
      presetGenerationRef.current += 1;
      mapGenerationRef.current = {};
      presetFocusGenerationRef.current += 1;
      presetTriggerNodesRef.current.clear();
      invokingPresetTriggerRef.current = null;
      if (restorePresetFocusTimerRef.current) {
        clearTimeout(restorePresetFocusTimerRef.current);
        restorePresetFocusTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    if (!areBattleCategoriesLoaded && battleCategories.length === 0 && !isBattleCategoriesLoading
      && !battleCategoriesError && !requestedCategoriesRef.current) {
      requestedCategoriesRef.current = true;
      onLoadBattleCategories();
    }
    if (areBattleCategoriesLoaded || battleCategories.length > 0 || isBattleCategoriesLoading || battleCategoriesError) {
      requestedCategoriesRef.current = false;
    }
  }, [areBattleCategoriesLoaded, battleCategories.length, battleCategoriesError, isBattleCategoriesLoading, onLoadBattleCategories]);

  const eligibleCategories = useMemo(
    () => filterBattleAutomationCategories(battleCategories).filter(({ enabled }) => enabled),
    [battleCategories],
  );
  const categoryKey = eligibleCategories.map(({ id }) => id).join('|');

  useEffect(() => {
    const eligibleIds = new Set(eligibleCategories.map(({ id }) => id));
    eligibleIdsRef.current = eligibleIds;
    setCatalog((current) => current.filter(({ categoryId }) => eligibleIds.has(categoryId)));
    setMapStates((current) => Object.fromEntries(Object.entries(current).filter(([id]) => eligibleIds.has(id))));
    for (const id of Object.keys(mapGenerationRef.current)) {
      if (!eligibleIds.has(id)) delete mapGenerationRef.current[id];
    }
    for (const category of eligibleCategories) {
      if (mapGenerationRef.current[category.id] == null) void loadCategoryMaps(category);
    }
  }, [categoryKey, eligibleCategories, loadCategoryMaps]);

  useEffect(() => {
    if (draftReady) return;
    const categoriesSettled = battleCategoriesError != null
      || areBattleCategoriesLoaded
      || battleCategories.length > 0;
    const mapsSettled = eligibleCategories.every(({ id }) => {
      const state = mapStates[id];
      return state != null && !state.loading;
    });
    if (categoriesSettled && (battleCategoriesError != null || mapsSettled)) setDraftReady(true);
  }, [areBattleCategoriesLoaded, battleCategories.length, battleCategoriesError, draftReady, eligibleCategories, mapStates]);

  useEffect(() => {
    if (catalog.length === 0) return;
    const hydrate = (current: BattleMapAutomationDraft): BattleMapAutomationDraft => ({
      ...current,
      maps: current.maps.map((setting) => {
        const found = catalog.find((candidate) => candidate.mapCode != null
          && battleMapIdentity(candidate as { categoryId: string; mapCode: string }) === battleMapIdentity(setting));
        return found ? {
          ...setting,
          displayName: found.name || setting.displayName,
          groupName: found.groupName,
          recommendedLevel: found.recommendedLevel,
          resolved: true,
          supportsThreeBattles: found.supportsThreeBattles ?? null,
        } : setting;
      }),
    });
    updateDraft(hydrate);
  }, [catalog, updateDraft]);

  useEffect(() => {
    const source = serializeEntrySettings(entry);
    const settingsChanged = source !== entrySettingsRef.current;
    entrySettingsRef.current = source;
    const next = buildBattleMapAutomationDraft(entry, catalog);
    if (settingsChanged && serializeEditableDraft(draftRef.current) === baselineRef.current) {
      draftRef.current = next;
      setDraft(next);
      baselineRef.current = serializeEditableDraft(next);
      setServerRefreshWarning(false);
    } else {
      updateDraft((current) => ({ ...current, dailyProgress: next.dailyProgress }));
      if (settingsChanged) setServerRefreshWarning(true);
    }
  }, [catalog, entry, updateDraft]);

  const validPresetIds = useMemo(() => presets.map(({ id }) => id), [presets]);
  const presetsVerified = !presetState.loading && presetState.error == null;
  const validationErrors = useMemo(
    () => validateBattleMapAutomationDraft(
      draft,
      validPresetIds,
      { validatePresetMembership: presetsVerified },
    ),
    [draft, presetsVerified, validPresetIds],
  );
  const busy = saving || localBusy;
  const controlsDisabled = busy || !draftReady;
  controlsDisabledRef.current = controlsDisabled;
  queryRef.current = query;
  const dirty = serializeEditableDraft(draft) !== baselineRef.current;
  const hasExplicitPreset = draft.maps.some(({ presetMode }) => presetMode === 'EXPLICIT');
  const saveDisabled = controlsDisabled || validationErrors.length > 0
    || (hasExplicitPreset && (presetState.loading || presetState.error != null));
  const catalogResult = useMemo(() => buildBattleMapCatalogRows({
    categories: eligibleCategories,
    catalog,
    categoryStates: mapStates,
    expandedCategoryId,
    expandedGroupKeys,
    query,
  }), [catalog, eligibleCategories, expandedCategoryId, expandedGroupKeys, mapStates, query]);
  const categoryLoading = isBattleCategoriesLoading
    || (!areBattleCategoriesLoaded && battleCategories.length === 0 && !battleCategoriesError);
  const catalogSearchEmpty = query.trim().length > 0
    && catalogResult.matchCount === 0
    && !categoryLoading
    && battleCategoriesError == null
    && eligibleCategories.every(({ id }) => {
      const state = mapStates[id];
      return state != null && !state.loading && state.error == null;
    });
  const activePresetSetting = activePresetIdentity == null
    ? null
    : draft.maps.find((setting) => battleMapIdentity(setting) === activePresetIdentity) ?? null;
  const closePresetPicker = useCallback((restoreFocus: boolean) => {
    const focusGeneration = ++presetFocusGenerationRef.current;
    const invocation = invokingPresetTriggerRef.current;
    setActivePresetIdentity(null);
    if (restorePresetFocusTimerRef.current) {
      clearTimeout(restorePresetFocusTimerRef.current);
      restorePresetFocusTimerRef.current = null;
    }
    if (!restoreFocus || !invocation) {
      invokingPresetTriggerRef.current = null;
      return;
    }
    restorePresetFocusTimerRef.current = setTimeout(() => {
      restorePresetFocusTimerRef.current = null;
      const clearInvocation = () => {
        if (invokingPresetTriggerRef.current === invocation) invokingPresetTriggerRef.current = null;
      };
      if (
        !mountedRef.current
        || controlsDisabledRef.current
        || presetFocusGenerationRef.current !== focusGeneration
        || !draftRef.current.maps.some((setting) => battleMapIdentity(setting) === invocation.identity)
      ) {
        clearInvocation();
        return;
      }
      const liveNode = presetTriggerNodesRef.current.get(invocation.identity) ?? null;
      const liveHandle = findNodeHandle(liveNode);
      if (liveHandle != null && liveHandle === invocation.nodeHandle) {
        AccessibilityInfo.setAccessibilityFocus(liveHandle);
      }
      clearInvocation();
    }, 250);
  }, []);
  const openPresetPicker = useCallback((identity: string) => {
    if (controlsDisabledRef.current) return;
    presetFocusGenerationRef.current += 1;
    if (restorePresetFocusTimerRef.current) {
      clearTimeout(restorePresetFocusTimerRef.current);
      restorePresetFocusTimerRef.current = null;
    }
    const triggerNode = presetTriggerNodesRef.current.get(identity) ?? null;
    invokingPresetTriggerRef.current = {
      identity,
      nodeHandle: findNodeHandle(triggerNode),
    };
    setActivePresetIdentity(identity);
  }, []);
  const toggleCatalogCategory = useCallback((categoryId: string) => {
    if (queryRef.current.trim().length > 0) return;
    setExpandedCategoryId((current) => queryRef.current.trim().length > 0
      ? current
      : current === categoryId ? null : categoryId);
    setExpandedGroupKeys((current) => queryRef.current.trim().length > 0 ? current : []);
  }, []);
  const toggleCatalogGroup = useCallback((groupKey: string) => {
    if (queryRef.current.trim().length > 0) return;
    setExpandedGroupKeys((current) => {
      if (queryRef.current.trim().length > 0) return current;
      return current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey];
    });
  }, []);
  const listItems = useMemo<EditorListItem[]>(() => [
    { key: 'selected-heading', kind: 'HEADING', title: '선택한 맵 · 실행 순서' },
    ...(draft.maps.length === 0
      ? [{ key: 'selected-empty', kind: 'SELECTED_EMPTY' } as const]
      : draft.maps.map((setting, index) => ({
        key: `selected:${battleMapIdentity(setting)}`,
        kind: 'SELECTED' as const,
        setting,
        index,
      }))),
    { key: 'catalog-heading', kind: 'HEADING', title: '맵 찾기' },
    { key: 'catalog-search', kind: 'CATALOG_SEARCH' },
    ...catalogResult.rows.map((row) => ({
      key: `catalog:${row.key}`,
      kind: 'CATALOG_ROW' as const,
      row,
    })),
    ...(catalogSearchEmpty
      ? [{ key: 'catalog-empty', kind: 'CATALOG_EMPTY' } as const]
      : []),
  ], [catalogResult.rows, catalogSearchEmpty, draft.maps]);

  useEffect(() => {
    if (activePresetIdentity != null && (controlsDisabled || activePresetSetting == null)) {
      closePresetPicker(false);
    }
  }, [activePresetIdentity, activePresetSetting, closePresetPicker, controlsDisabled]);

  function requestBack() {
    if (busy) return;
    if (!dirty) return onBack();
    Alert.alert('변경 사항을 버릴까요?', '저장하지 않은 전투 맵 설정이 있습니다.', [
      { text: '계속 편집', style: 'cancel' },
      { text: '나가기', style: 'destructive', onPress: onBack },
    ]);
  }

  function confirmDelete() {
    if (controlsDisabled) return;
    Alert.alert('전투 맵 자동화를 삭제할까요?', '맵 설정은 삭제되지만 오늘 성공 횟수는 서버에 유지됩니다.', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => {
        if (controlsDisabledRef.current) return;
        controlsDisabledRef.current = true;
        onClearMutationMessage();
        setLocalBusy(true);
        try {
          if (await onDelete()) onBack();
        } finally {
          setLocalBusy(false);
        }
      } },
    ]);
  }

  async function save() {
    if (saveDisabled || controlsDisabledRef.current) return;
    controlsDisabledRef.current = true;
    onClearMutationMessage();
    setLocalBusy(true);
    try {
      const submittedDraft = draftRef.current;
      const request = buildBattleMapAutomationRequest(submittedDraft, validPresetIds);
      const submittedBaseline = serializeEditableDraft(submittedDraft);
      if (await onSave(request)) baselineRef.current = submittedBaseline;
    } finally {
      setLocalBusy(false);
    }
  }

  const renderListItem = useCallback(({ item }: { item: EditorListItem }) => {
    if (item.kind === 'HEADING') return <Text style={styles.sectionTitle}>{item.title}</Text>;
    if (item.kind === 'SELECTED_EMPTY') {
      return <Text style={styles.muted}>아래 목록에서 실행할 맵을 선택해 주세요.</Text>;
    }
    if (item.kind === 'CATALOG_SEARCH') {
      return <TextInput accessibilityLabel="전투 맵 검색" editable onChangeText={(value) => {
        queryRef.current = value;
        setQuery(value);
      }} placeholder="맵 이름, 그룹, 추천 레벨 검색" placeholderTextColor={theme.colors.textMuted} style={styles.search} value={query} />;
    }
    if (item.kind === 'CATALOG_EMPTY') return <Text style={styles.muted}>검색 가능한 맵이 없습니다.</Text>;
    if (item.kind === 'CATALOG_ROW') {
      const { row } = item;
      if (row.kind === 'CATEGORY') {
        const interactionDisabled = query.trim().length > 0;
        return <BattleMapCatalogCategoryRow category={row.category} expanded={row.expanded} interactionDisabled={interactionDisabled} mapCount={row.mapCount} onPress={() => { if (!interactionDisabled) toggleCatalogCategory(row.category.id); }} />;
      }
      if (row.kind === 'STATE') {
        return <BattleMapCatalogStateRow category={row.category} error={row.error} onRetry={() => { void loadCategoryMaps(row.category); }} state={row.state} />;
      }
      if (row.kind === 'GROUP') {
        const interactionDisabled = query.trim().length > 0;
        return <BattleMapCatalogGroupRow expanded={row.expanded} group={row.group} interactionDisabled={interactionDisabled} onPress={() => { if (!interactionDisabled) toggleCatalogGroup(row.group.key); }} />;
      }
      const { map } = row;
      const identity = map.mapCode == null ? null : battleMapIdentity({ categoryId: map.categoryId, mapCode: map.mapCode });
      const selected = identity != null && draft.maps.some((setting) => battleMapIdentity(setting) === identity);
      return <BattleMapCatalogMapRow disabled={controlsDisabled} map={map} onPress={() => {
        if (controlsDisabledRef.current) return;
        updateDraft((current) => {
          if (controlsDisabledRef.current) return current;
          const currentlySelected = identity != null
            && current.maps.some((setting) => battleMapIdentity(setting) === identity);
          return selectBattleMap(current, map, !currentlySelected);
        });
      }} selected={selected} />;
    }

    const { setting, index } = item;
    const identity = battleMapIdentity(setting);
    const successes = draft.dailyProgress[identity]?.successfulRuns ?? 0;
    const parsedDailyTarget = parseBattleDailyTarget(setting.dailyTargetCount);
    const dailyTarget = parsedDailyTarget != null && parsedDailyTarget > 0 ? parsedDailyTarget : null;
    const progress = dailyTarget == null ? null : buildBattleProgress({ target: dailyTarget, successes });
    const selectedPreset = setting.presetMode === 'EXPLICIT'
      ? presets.find(({ id }) => id === setting.partyPresetId)
      : null;
    const presetSummary = presetState.loading
        ? '프리셋 확인 중'
        : presetState.error
          ? '프리셋 확인 불가'
          : formatAutomationPresetSelection(setting, presets);
    return (
      <View style={[styles.card, progress?.complete && styles.completeCard]}>
        <View style={styles.rowHeading}>
          <View style={styles.mapCopy}>
            <Text style={styles.mapName}>{setting.displayName}</Text>
            {!setting.resolved ? <Text style={styles.problem}>현재 맵 목록에 없음 · 저장된 설정</Text> : null}
          </View>
          <Pressable accessibilityLabel={`${setting.displayName} 맵 위로`} accessibilityRole="button" accessibilityState={{ disabled: controlsDisabled || index === 0 }} disabled={controlsDisabled || index === 0} onPress={() => updateEditableDraft((current) => moveBattleMapSetting(current, index, index - 1))} style={styles.smallIcon}><ArrowUp color={theme.colors.textMuted} size={16} /></Pressable>
          <Pressable accessibilityLabel={`${setting.displayName} 맵 아래로`} accessibilityRole="button" accessibilityState={{ disabled: controlsDisabled || index === draft.maps.length - 1 }} disabled={controlsDisabled || index === draft.maps.length - 1} onPress={() => updateEditableDraft((current) => moveBattleMapSetting(current, index, index + 1))} style={styles.smallIcon}><ArrowDown color={theme.colors.textMuted} size={16} /></Pressable>
          <Pressable accessibilityLabel={`${setting.displayName} 맵 제거`} accessibilityRole="button" accessibilityState={{ disabled: controlsDisabled }} disabled={controlsDisabled} onPress={() => updateEditableDraft((current) => removeBattleMapSetting(current, index))} style={styles.smallIcon}><Trash2 color={theme.colors.danger} size={16} /></Pressable>
        </View>
        <TextInput accessibilityLabel={`${setting.displayName} 일일 목표`} editable={!controlsDisabled} keyboardType="number-pad" onChangeText={(value) => updateEditableDraft((current) => ({ ...current, maps: current.maps.map((map) => battleMapIdentity(map) === identity ? { ...map, dailyTargetCount: value } : map) }))} style={styles.targetInput} value={String(setting.dailyTargetCount)} />
        {progress == null ? (
          <>
            <Text style={styles.muted}>오늘 {successes}회 성공 · 목표 확인 필요</Text>
            <Text style={styles.batch}>목표 확인 후 실행</Text>
          </>
        ) : (
          <>
            <Text style={styles.muted}>오늘 {successes}/{dailyTarget} · {progress.remaining}회 남음</Text>
            <View accessibilityLabel={`${setting.displayName} 오늘 진행률`} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress.percent) }} style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress.percent}%` }]} />
            </View>
            <Text style={progress.complete ? styles.complete : styles.batch}>{describeBattleBatch({ supportsThreeBattles: setting.supportsThreeBattles, remaining: progress.remaining })}</Text>
          </>
        )}
        {setting.presetMode === 'EXPLICIT' && presetsVerified && !selectedPreset ? <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.problem}>선택한 프리셋이 삭제되었습니다. 다른 프리셋을 선택해 주세요.</Text> : null}
        <Pressable
          ref={(node) => {
            if (node) presetTriggerNodesRef.current.set(identity, node);
            else presetTriggerNodesRef.current.delete(identity);
          }}
          accessibilityLabel={`${setting.displayName} 프리셋 선택 열기`}
          accessibilityRole="button"
          accessibilityState={{ disabled: controlsDisabled }}
          accessibilityValue={{ text: presetSummary }}
          disabled={controlsDisabled}
          onPress={() => openPresetPicker(identity)}
          style={[styles.choice, controlsDisabled && styles.disabled]}
        >
          <Text style={styles.choiceLabel}>프리셋</Text>
          <Text numberOfLines={1} style={styles.choiceText}>{presetSummary}</Text>
          <ChevronRight color={theme.colors.textMuted} size={16} />
        </Pressable>
      </View>
    );
  }, [controlsDisabled, draft, loadCategoryMaps, openPresetPicker, presets, presetsVerified, presetState.error, presetState.loading, query, toggleCatalogCategory, toggleCatalogGroup, updateDraft, updateEditableDraft]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="전투 맵 자동화 뒤로" accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={requestBack} style={styles.iconButton}>
          <ArrowLeft color={theme.colors.text} size={21} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>전투 맵 자동화</Text>
          <Text style={styles.subtitle}>맵별 오늘 목표와 실행 순서를 설정하세요.</Text>
        </View>
        <Switch accessibilityLabel="전투 맵 자동화 사용" disabled={controlsDisabled} value={draft.enabled} onValueChange={(enabled) => updateEditableDraft((current) => ({ ...current, enabled }))} />
      </View>

      {mutationMessage ? <Text accessibilityLabel="전투 맵 자동화 작업 오류" accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.problem}>{mutationMessage}</Text> : null}
      {serverRefreshWarning ? <Text accessibilityLabel="전투 맵 자동화 서버 갱신 알림" accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.problem}>새 서버 설정이 있지만 편집 중인 변경은 유지했습니다.</Text> : null}
      {categoryLoading ? <Text style={styles.muted}>맵 카테고리 불러오는 중</Text> : null}
      {battleCategoriesError ? <ResourceWarning label="맵 카테고리" retryLabel="맵 카테고리 다시 불러오기" onRetry={onLoadBattleCategories} /> : null}
      {presetState.error ? <ResourceWarning label="프리셋" retryLabel="프리셋 다시 불러오기" onRetry={loadPresets} /> : presetState.loading ? <Text style={styles.muted}>프리셋 불러오는 중</Text> : null}

      <FlatList contentContainerStyle={styles.content} data={listItems} initialNumToRender={12} keyboardShouldPersistTaps="handled" keyExtractor={editorListKey} renderItem={renderListItem} windowSize={7} />

      <BattleMapPresetPickerModal
        disabled={controlsDisabled}
        mapName={activePresetSetting?.displayName ?? ''}
        onClose={() => closePresetPicker(true)}
        onSelect={(presetId) => {
          if (controlsDisabledRef.current || activePresetIdentity == null) return;
          updateEditableDraft((current) => updatePreset(current, activePresetIdentity, presetId));
          closePresetPicker(true);
        }}
        presets={presets}
        selectedPresetId={activePresetSetting?.partyPresetId ?? null}
        selectedPresetMode={activePresetSetting?.presetMode ?? 'PRIMARY'}
        visible={activePresetSetting != null && !controlsDisabled}
      />

      {validationErrors.length > 0 ? <Text accessibilityLabel="전투 맵 자동화 입력 오류" accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.problem}>{validationErrors[0]}</Text> : null}
      <View style={styles.footer}>
        <Pressable accessibilityLabel="전투 맵 자동화 삭제" accessibilityRole="button" accessibilityState={{ disabled: controlsDisabled }} disabled={controlsDisabled} onPress={confirmDelete} style={[styles.deleteButton, controlsDisabled && styles.disabled]}><Trash2 color={theme.colors.danger} size={17} /><Text style={styles.deleteText}>삭제</Text></Pressable>
        <Pressable accessibilityLabel="전투 맵 자동화 저장" accessibilityRole="button" accessibilityState={{ busy, disabled: saveDisabled }} disabled={saveDisabled} onPress={() => save()} style={[styles.saveButton, saveDisabled && styles.disabled]}>{busy ? <ActivityIndicator color={theme.colors.buttonText} size="small" /> : <Save color={theme.colors.buttonText} size={17} />}<Text style={styles.saveText}>저장</Text></Pressable>
      </View>
    </View>
  );
}

function ResourceWarning({ label, retryLabel, onRetry }: { label: string; retryLabel: string; onRetry: () => void | Promise<unknown> }) {
  return <View style={styles.warningRow}><Text style={styles.problem}>{label}을 불러오지 못했어요.</Text><Pressable accessibilityLabel={retryLabel} accessibilityRole="button" onPress={() => { void onRetry(); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>다시 시도</Text></Pressable></View>;
}

function updatePreset(draft: BattleMapAutomationDraft, identity: string, presetId: number | null): BattleMapAutomationDraft {
  return {
    ...draft,
    maps: draft.maps.map((map) => battleMapIdentity(map) !== identity ? map : presetId == null
      ? { ...map, presetMode: 'PRIMARY', partyPresetId: null }
      : { ...map, presetMode: 'EXPLICIT', partyPresetId: presetId }),
  };
}

function editorListKey(item: EditorListItem): string { return item.key; }

function serializeEditableDraft(draft: BattleMapAutomationDraft): string {
  return JSON.stringify([
    draft.enabled,
    draft.maps.map(({ categoryId, mapCode, dailyTargetCount, executionOrder, presetMode, partyPresetId }) => (
      [categoryId, mapCode, String(dailyTargetCount), executionOrder, presetMode, partyPresetId]
    )),
  ]);
}
function serializeEntrySettings(entry: TypedAutomationEntryResponse): string {
  return JSON.stringify([entry.enabled, entry.battleMaps]);
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: theme.spacing.xs, padding: theme.spacing.lg },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  content: { gap: 6, paddingBottom: theme.spacing.lg },
  section: { gap: theme.spacing.xs },
  sectionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '900' },
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md + 4, borderWidth: 1, gap: theme.spacing.xs, padding: theme.spacing.sm },
  completeCard: { borderColor: theme.colors.accentGreen },
  rowHeading: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  mapCopy: { flex: 1 },
  mapName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  smallIcon: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  targetInput: { borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.sm },
  progressTrack: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 2, height: 4, overflow: 'hidden' },
  progressFill: { backgroundColor: theme.colors.accentGreen, height: 4 },
  batch: { color: theme.colors.text, fontSize: 11, fontWeight: '800' },
  complete: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '900' },
  choice: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 44, paddingHorizontal: theme.spacing.sm },
  choiceActive: { borderColor: theme.colors.accentGreen },
  choiceLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '700' },
  choiceText: { color: theme.colors.text, flex: 1, fontSize: 11, fontWeight: '700' },
  search: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, color: theme.colors.text, minHeight: 46, paddingHorizontal: theme.spacing.md },
  warningRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  secondaryButton: { borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.md },
  secondaryText: { color: theme.colors.text, fontWeight: '800' },
  muted: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  problem: { color: theme.colors.accentAmber, fontSize: 11, lineHeight: 16 },
  footer: { flexDirection: 'row', gap: theme.spacing.sm },
  deleteButton: { alignItems: 'center', borderColor: theme.colors.danger, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, minHeight: 48, justifyContent: 'center', paddingHorizontal: theme.spacing.lg },
  deleteText: { color: theme.colors.danger, fontWeight: '800' },
  saveButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, flex: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 48, justifyContent: 'center' },
  saveText: { color: theme.colors.buttonText, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});
