import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  findNodeHandle,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ArrowLeft, ChevronRight, Save } from 'lucide-react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';

import {
  battleMapIdentity,
  buildBattleMapAutomationDraft,
  buildBattleMapAutomationRequest,
  buildBattleProgress,
  describeBattleBatch,
  filterBattleAutomationCategories,
  MAX_BATTLE_DAILY_TARGET,
  moveBattleMapSetting,
  parseBattleDailyTarget,
  removeBattleMapSetting,
  selectBattleMap,
  validateBattleMapAutomationDraft,
  type BattleMapAutomationDraft,
} from '../../../domain/battleMapAutomation';
import { buildBattleMapCatalogRows, type BattleMapCatalogRow } from '../../../domain/battleMapCatalog';
import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import type { PartyPresetCatalogResource } from '../../../domain/partyPresetCatalogLoader';
import { formatAutomationPresetSelection } from '../../../domain/partyPresets';
import { theme } from '../../../styles/theme';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  TypedAutomationEntryResponse,
  UpdateBattleMapAutomationRequest,
} from '../../../types/api';
import { BattleMapPresetPickerModal } from './BattleMapPresetPickerModal';
import { AutomationMapEditorTabs, type AutomationMapEditorTab } from './AutomationMapEditorTabs';
import {
  BattleMapCatalogCategoryRow,
  BattleMapCatalogGroupRow,
  BattleMapCatalogMapRow,
  BattleMapCatalogStateRow,
} from './BattleMapCatalogRows';
import { AutomationMapOrderList } from './AutomationMapOrderList';

type Props = {
  entry: TypedAutomationEntryResponse;
  battleCategories: BattleCategoryResponse[];
  areBattleCategoriesLoaded: boolean;
  isBattleCategoriesLoading: boolean;
  battleCategoriesError: string | null;
  mutationMessage: string | null;
  saving: boolean;
  onBack: () => void;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  partyPresetCatalog: PartyPresetCatalogResource;
  onClearMutationMessage: () => void;
  onSave: (request: UpdateBattleMapAutomationRequest) => Promise<boolean>;
};

type ResourceState = { loading: boolean; error: string | null };
type EditorListItem =
  | { key: string; kind: 'HEADING'; title: string }
  | { key: string; kind: 'SELECTED_EMPTY' }
  | { key: string; kind: 'SELECTED_LIST' }
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
  onLoadBattleCategories,
  onLoadBattleMaps,
  partyPresetCatalog,
  onClearMutationMessage,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<BattleMapAutomationDraft>(() => buildBattleMapAutomationDraft(entry, []));
  const [catalog, setCatalog] = useState<BattleMapResponse[]>([]);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<AutomationMapEditorTab>('SELECTED');
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);
  const [activePresetIdentity, setActivePresetIdentity] = useState<string | null>(null);
  const presetState = { loading: partyPresetCatalog.loading, error: partyPresetCatalog.error };
  const [mapStates, setMapStates] = useState<Record<string, ResourceState>>({});
  const [localBusy, setLocalBusy] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [serverRefreshWarning, setServerRefreshWarning] = useState(false);
  const draftRef = useRef(draft);
  const queryRef = useRef(query);
  const baselineRef = useRef(serializeEditableDraft(draft));
  const entrySettingsRef = useRef(serializeEntrySettings(entry));
  const mountedGenerationRef = useRef(0);
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

  const validPresetIds = useMemo(
    () => partyPresetCatalog.catalog.presets.map(({ id }) => id),
    [partyPresetCatalog.catalog.presets],
  );
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
  const selectedItems = useMemo<EditorListItem[]>(() => [
    { key: 'selected-heading', kind: 'HEADING', title: '선택한 맵 · 실행 순서' },
    ...(draft.maps.length === 0
      ? [{ key: 'selected-empty', kind: 'SELECTED_EMPTY' } as const]
      : [{ key: 'selected-list', kind: 'SELECTED_LIST' } as const]),
  ], [draft.maps.length]);
  const catalogItems = useMemo<EditorListItem[]>(() => [
    { key: 'catalog-heading', kind: 'HEADING', title: '맵 찾기' },
    ...catalogResult.rows.map((row) => ({
      key: `catalog:${row.key}`,
      kind: 'CATALOG_ROW' as const,
      row,
    })),
    ...(catalogSearchEmpty
      ? [{ key: 'catalog-empty', kind: 'CATALOG_EMPTY' } as const]
      : []),
  ], [catalogResult.rows, catalogSearchEmpty]);

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

  const deleteSelectedMap = useCallback((identity: string) => {
    updateEditableDraft((current) => {
      const index = current.maps.findIndex((map) => battleMapIdentity(map) === identity);
      return index < 0 ? current : removeBattleMapSetting(current, index);
    });
  }, [updateEditableDraft]);

  const moveSelectedMap = useCallback((identity: string, offset: -1 | 1) => {
    updateEditableDraft((current) => {
      const index = current.maps.findIndex((map) => battleMapIdentity(map) === identity);
      return index < 0 ? current : moveBattleMapSetting(current, index, index + offset);
    });
  }, [updateEditableDraft]);

  const reorderSelectedMaps = useCallback((orderedIds: string[]) => {
    updateEditableDraft((current) => reorderBattleDraft(current, orderedIds));
  }, [updateEditableDraft]);

  const renderSelectedMap = useCallback((setting: BattleMapAutomationDraft['maps'][number], { disabled }: { disabled: boolean }) => {
    const identity = battleMapIdentity(setting);
    const successes = draft.dailyProgress[identity]?.successfulRuns ?? 0;
    const dailyTarget = validBattleDailyTarget(setting.dailyTargetCount);
    const progress = dailyTarget == null ? null : buildBattleProgress({ target: dailyTarget, successes });
    const selectedPreset = setting.presetMode === 'EXPLICIT'
      ? partyPresetCatalog.catalog.presets.find(({ id }) => id === setting.partyPresetId)
      : null;
    const presetSummary = presetState.loading
      ? '프리셋 확인 중'
      : presetState.error
        ? '프리셋 확인 불가'
        : formatAutomationPresetSelection(setting, partyPresetCatalog.catalog.presets);
    const progressSummary = buildBattleProgressSummary(setting, successes, dailyTarget, progress?.remaining ?? null);
    return (
      <>
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.mapName}>{setting.displayName}</Text>
        <View accessibilityLabel={`${setting.displayName} 오늘 진행 요약`} style={styles.progressRow}>
          <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.progressSummary, progress?.complete && styles.complete]}>{progressSummary}</Text>
          <TextInput
            accessibilityLabel={`${setting.displayName} 일일 목표`}
            editable={!disabled}
            keyboardType="number-pad"
            onChangeText={(value) => updateEditableDraft((current) => ({
              ...current,
              maps: current.maps.map((map) => battleMapIdentity(map) === identity
                ? { ...map, dailyTargetCount: value }
                : map),
            }))}
            style={styles.compactTargetInput}
            value={String(setting.dailyTargetCount)}
          />
        </View>
        {setting.presetMode === 'EXPLICIT' && presetsVerified && !selectedPreset ? <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.problem}>선택한 프리셋이 삭제되었습니다. 다른 프리셋을 선택해 주세요.</Text> : null}
        <Pressable
          ref={(node) => {
            if (node) presetTriggerNodesRef.current.set(identity, node);
            else presetTriggerNodesRef.current.delete(identity);
          }}
          accessibilityLabel={`${setting.displayName} 프리셋 선택 열기`}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          accessibilityValue={{ text: presetSummary }}
          disabled={disabled}
          onPress={() => openPresetPicker(identity)}
          style={[styles.choice, disabled && styles.disabled]}
        >
          <Text style={styles.choiceLabel}>프리셋</Text>
          <Text numberOfLines={1} style={styles.choiceText}>{presetSummary}</Text>
          <ChevronRight color={theme.colors.textMuted} size={16} />
        </Pressable>
      </>
    );
  }, [draft.dailyProgress, openPresetPicker, partyPresetCatalog.catalog.presets, presetsVerified, presetState.error, presetState.loading, updateEditableDraft]);

  const renderListItem = useCallback(({ item }: { item: EditorListItem }) => {
    if (item.kind === 'HEADING') return <Text style={styles.sectionTitle}>{item.title}</Text>;
    if (item.kind === 'SELECTED_EMPTY') {
      return <Text style={styles.muted}>맵 추가 탭에서 실행할 맵을 추가해 주세요.</Text>;
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

    return (
      <AutomationMapOrderList
        data={draft.maps}
        disabled={controlsDisabled}
        getId={battleMapIdentity}
        getLabel={battleMapLabel}
        onDelete={deleteSelectedMap}
        onMove={moveSelectedMap}
        onReorder={reorderSelectedMaps}
        renderContent={renderSelectedMap}
        nested
      />
    );
  }, [controlsDisabled, deleteSelectedMap, draft.maps, loadCategoryMaps, moveSelectedMap, query, renderSelectedMap, reorderSelectedMaps, toggleCatalogCategory, toggleCatalogGroup, updateDraft]);

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
      {presetState.error ? <ResourceWarning label="프리셋" retryLabel="프리셋 다시 불러오기" onRetry={partyPresetCatalog.retry} /> : presetState.loading ? <Text style={styles.muted}>프리셋 불러오는 중</Text> : null}

      <AutomationMapEditorTabs activeTab={activeTab} onChange={setActiveTab} selectedCount={draft.maps.length} />
      {activeTab === 'CATALOG' ? <TextInput accessibilityLabel="전투 맵 검색" editable onChangeText={(value) => {
        queryRef.current = value;
        setQuery(value);
      }} placeholder="추가할 맵 이름, 그룹, 추천 레벨 검색" placeholderTextColor={theme.colors.textMuted} style={styles.search} value={query} /> : null}

      <NestableScrollContainer contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" style={styles.scroller}>
        {(activeTab === 'SELECTED' ? selectedItems : catalogItems)
          .map((item) => <Fragment key={item.key}>{renderListItem({ item })}</Fragment>)}
      </NestableScrollContainer>

      <BattleMapPresetPickerModal
        disabled={controlsDisabled}
        mapName={activePresetSetting?.displayName ?? ''}
        onClose={() => closePresetPicker(true)}
        onSelect={(presetId) => {
          if (controlsDisabledRef.current || activePresetIdentity == null) return;
          updateEditableDraft((current) => updatePreset(current, activePresetIdentity, presetId));
          closePresetPicker(true);
        }}
        catalog={partyPresetCatalog.catalog}
        selectedPresetId={activePresetSetting?.partyPresetId ?? null}
        selectedPresetMode={activePresetSetting?.presetMode ?? 'PRIMARY'}
        visible={activePresetSetting != null && !controlsDisabled}
      />

      {validationErrors.length > 0 ? <Text accessibilityLabel="전투 맵 자동화 입력 오류" accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.problem}>{validationErrors[0]}</Text> : null}
      <View style={styles.footer}>
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

function validBattleDailyTarget(value: string | number): number | null {
  const parsed = parseBattleDailyTarget(value);
  return parsed != null && parsed > 0 && parsed <= MAX_BATTLE_DAILY_TARGET ? parsed : null;
}

function buildBattleProgressSummary(
  setting: BattleMapAutomationDraft['maps'][number],
  successes: number,
  dailyTarget: number | null,
  remaining: number | null,
): string {
  const availability = setting.resolved ? '' : '현재 맵 목록에 없음 · ';
  if (dailyTarget == null || remaining == null) {
    return `${availability}오늘 ${successes}회 성공 · 목표 확인 필요 · 목표 확인 후 실행`;
  }
  return `${availability}오늘 ${successes}/${dailyTarget} · ${remaining}회 남음 · ${describeBattleBatch({ supportsThreeBattles: setting.supportsThreeBattles, remaining })}`;
}

function battleMapLabel(setting: BattleMapAutomationDraft['maps'][number]): string {
  return setting.displayName;
}

function reorderBattleDraft(draft: BattleMapAutomationDraft, orderedIds: string[]): BattleMapAutomationDraft {
  if (orderedIds.length !== draft.maps.length || new Set(orderedIds).size !== orderedIds.length) return draft;
  const byId = new Map(draft.maps.map((setting) => [battleMapIdentity(setting), setting]));
  const maps = orderedIds.map((identity, executionOrder) => {
    const setting = byId.get(identity);
    return setting == null ? null : { ...setting, executionOrder };
  });
  return maps.some((setting) => setting == null) ? draft : { ...draft, maps: maps as BattleMapAutomationDraft['maps'] };
}

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
  scroller: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  content: { gap: 6, paddingBottom: theme.spacing.lg },
  section: { gap: theme.spacing.xs },
  sectionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '900' },
  mapName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  progressRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  progressSummary: { color: theme.colors.textMuted, flex: 1, fontSize: 11, lineHeight: 16 },
  compactTargetInput: { borderColor: theme.colors.borderStrong, borderRadius: 9, borderWidth: 1, color: theme.colors.text, minHeight: 32, paddingHorizontal: 0, textAlign: 'center', textAlignVertical: 'center', width: 44 },
  complete: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '900' },
  choice: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: 9, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, minHeight: 32, paddingHorizontal: theme.spacing.xs },
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
  saveButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, flex: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 48, justifyContent: 'center' },
  saveText: { color: theme.colors.buttonText, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});
