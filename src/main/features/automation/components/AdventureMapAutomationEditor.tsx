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
import { ArrowDown, ArrowLeft, ArrowUp, Save, Trash2 } from 'lucide-react-native';

import {
  adventureMapIdentity,
  buildAdventureMapAutomationDraft,
  buildAdventureMapAutomationRequest,
  describeAdventureMapConstraints,
  describeAdventureMapState,
  filterAdventureAutomationCategories,
  filterAdventureMapCatalog,
  formatAdventureDailyRefresh,
  formatAutomationPresetSelection,
  moveAdventureMapSetting,
  removeAdventureMapSetting,
  selectAdventureMap,
  validateAdventureMapAutomationDraft,
  type AdventureMapAutomationDraft,
} from '../../../domain/adventureMapAutomation';
import {
  buildAdventureMapCatalogRows,
  type AdventureMapCatalogRow,
} from '../../../domain/adventureMapCatalog';
import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import { theme } from '../../../styles/theme';
import type {
  AdventureDailyRefreshResponse,
  BattleCategoryResponse,
  BattleMapResponse,
  PartyPresetResponse,
  TypedAutomationEntryResponse,
  UpdateAdventureMapAutomationRequest,
} from '../../../types/api';
import { BattleMapPresetPickerModal } from './BattleMapPresetPickerModal';
import {
  AdventureMapCatalogGroupRow,
  AdventureMapCatalogMapRow,
} from './AdventureMapCatalogRows';

type Props = {
  entry: TypedAutomationEntryResponse;
  dailyRefresh: AdventureDailyRefreshResponse;
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
  onSave: (request: UpdateAdventureMapAutomationRequest) => Promise<boolean>;
};

type ResourceState = { loading: boolean; error: string | null };
type PresetSession = { generation: number; identity: string };
type ListItem =
  | { key: string; kind: 'HEADING'; title: string }
  | { key: string; kind: 'EMPTY' }
  | { key: string; kind: 'SELECTED'; setting: AdventureMapAutomationDraft['maps'][number]; index: number }
  | { key: string; kind: 'SEARCH' }
  | { key: string; kind: 'NO_RESULTS' }
  | AdventureMapCatalogRow;

export function AdventureMapAutomationEditor({
  entry,
  dailyRefresh,
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
  const [draft, setDraft] = useState<AdventureMapAutomationDraft>(() => buildAdventureMapAutomationDraft(entry, []));
  const [catalog, setCatalog] = useState<BattleMapResponse[]>([]);
  const [presets, setPresets] = useState<PartyPresetResponse[]>([]);
  const [mapState, setMapState] = useState<ResourceState>({ loading: true, error: null });
  const [presetState, setPresetState] = useState<ResourceState>({ loading: true, error: null });
  const [query, setQuery] = useState('');
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);
  const [activePresetSession, setActivePresetSession] = useState<PresetSession | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const requestedCategoriesRef = useRef(false);
  const mountedRef = useRef(true);
  const mountedGenerationRef = useRef(0);
  const mapGenerationRef = useRef(0);
  const presetGenerationRef = useRef(0);
  const draftRef = useRef(draft);
  const queryRef = useRef(query);
  const baselineRef = useRef(serializeDraft(draft));
  const entrySettingsRef = useRef(serializeEntrySettings(entry));
  const controlsDisabledRef = useRef(false);
  const busyRef = useRef(false);
  const presetSessionGenerationRef = useRef(0);
  const presetSessionRef = useRef<PresetSession | null>(null);

  const updateDraft = useCallback((updater: (current: AdventureMapAutomationDraft) => AdventureMapAutomationDraft) => {
    const next = updater(draftRef.current);
    draftRef.current = next;
    setDraft(next);
  }, []);
  const updateEditableDraft = useCallback((updater: (current: AdventureMapAutomationDraft) => AdventureMapAutomationDraft) => {
    if (controlsDisabledRef.current) return;
    updateDraft((current) => controlsDisabledRef.current ? current : updater(current));
  }, [updateDraft]);

  useEffect(() => () => {
    mountedRef.current = false;
    busyRef.current = true;
    controlsDisabledRef.current = true;
    presetSessionRef.current = null;
    presetSessionGenerationRef.current += 1;
    mountedGenerationRef.current += 1;
    mapGenerationRef.current += 1;
    presetGenerationRef.current += 1;
  }, []);

  const loadPresets = useCallback(async () => {
    const generation = ++presetGenerationRef.current;
    const mountedGeneration = mountedGenerationRef.current;
    setPresetState({ loading: true, error: null });
    try {
      const next = await onListPartyPresets();
      if (!mountedRef.current
        || mountedGeneration !== mountedGenerationRef.current
        || generation !== presetGenerationRef.current) return;
      setPresets(next);
      setPresetState({ loading: false, error: null });
    } catch (error: unknown) {
      if (mountedRef.current
        && mountedGeneration === mountedGenerationRef.current
        && generation === presetGenerationRef.current) {
        setPresetState({ loading: false, error: toUserFacingErrorMessage(error) });
      }
    }
  }, [onListPartyPresets]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    if (!areBattleCategoriesLoaded && battleCategories.length === 0 && !isBattleCategoriesLoading
      && !battleCategoriesError && !requestedCategoriesRef.current) {
      requestedCategoriesRef.current = true;
      onLoadBattleCategories();
    }
  }, [
    areBattleCategoriesLoaded,
    battleCategories.length,
    battleCategoriesError,
    isBattleCategoriesLoading,
    onLoadBattleCategories,
  ]);

  const adventureCategory = useMemo(
    () => filterAdventureAutomationCategories(battleCategories)[0] ?? null,
    [battleCategories],
  );

  const loadMaps = useCallback(async () => {
    const generation = ++mapGenerationRef.current;
    const mountedGeneration = mountedGenerationRef.current;
    if (!adventureCategory && (!areBattleCategoriesLoaded || isBattleCategoriesLoading)) {
      setMapState({ loading: true, error: null });
      return;
    }
    if (!adventureCategory) {
      setMapState({ loading: false, error: battleCategoriesError ?? '모험맵 카테고리를 찾을 수 없습니다.' });
      return;
    }
    setMapState({ loading: true, error: null });
    try {
      const next = await onLoadBattleMaps(adventureCategory.id);
      if (!mountedRef.current
        || mountedGeneration !== mountedGenerationRef.current
        || generation !== mapGenerationRef.current) return;
      const resolved = filterAdventureMapCatalog(next, '');
      setCatalog(resolved);
      updateDraft((current) => ({
        ...current,
        maps: current.maps.map((setting) => {
          const observed = resolved.find((map) => map.mapCode != null
            && adventureMapIdentity({ categoryId: map.categoryId, mapCode: map.mapCode }) === adventureMapIdentity(setting)) ?? null;
          return observed
            ? {
              ...setting,
              displayName: observed.name || setting.displayName,
              groupName: observed.groupName,
              recommendedLevel: observed.recommendedLevel,
              resolved: true,
              observed,
            }
            : {
              ...setting,
              resolved: false,
              observed: null,
            };
        }),
      }));
      setMapState({ loading: false, error: null });
    } catch (error: unknown) {
      if (mountedRef.current
        && mountedGeneration === mountedGenerationRef.current
        && generation === mapGenerationRef.current) {
        setMapState({ loading: false, error: toUserFacingErrorMessage(error) });
      }
    }
  }, [
    adventureCategory,
    areBattleCategoriesLoaded,
    battleCategoriesError,
    isBattleCategoriesLoading,
    onLoadBattleMaps,
    updateDraft,
  ]);

  useEffect(() => {
    void loadMaps();
  }, [loadMaps]);

  const draftDirty = serializeDraft(draft) !== baselineRef.current;
  useEffect(() => {
    const source = serializeEntrySettings(entry);
    if (source === entrySettingsRef.current) return;
    if (draftDirty) return;
    const next = buildAdventureMapAutomationDraft(entry, catalog);
    entrySettingsRef.current = source;
    draftRef.current = next;
    setDraft(next);
    baselineRef.current = serializeDraft(next);
  }, [catalog, draftDirty, entry]);

  const validPresetIds = useMemo(() => presets.map(({ id }) => id), [presets]);
  const presetsVerified = !presetState.loading && presetState.error == null;
  const errors = useMemo(
    () => validateAdventureMapAutomationDraft(draft, validPresetIds, {
      validatePresetMembership: presetsVerified,
    }),
    [draft, presetsVerified, validPresetIds],
  );
  const busy = saving || localBusy;
  const controlsDisabled = busy || mapState.loading;
  controlsDisabledRef.current = controlsDisabled;
  busyRef.current = busy;
  queryRef.current = query;
  const dirty = draftDirty;
  const hasExplicitPreset = draft.maps.some(({ presetMode }) => presetMode === 'EXPLICIT');
  const saveDisabled = controlsDisabled || errors.length > 0
    || (hasExplicitPreset && !presetsVerified);
  const activePresetIdentity = activePresetSession?.identity ?? null;
  const activePresetSetting = activePresetIdentity == null
    ? null
    : draft.maps.find((setting) => adventureMapIdentity(setting) === activePresetIdentity) ?? null;
  const searching = query.trim().length > 0;
  const catalogRows = useMemo(() => buildAdventureMapCatalogRows({
    catalog,
    expandedGroupKeys,
    query,
  }), [catalog, expandedGroupKeys, query]);
  const items = useMemo<ListItem[]>(() => [
    { key: 'selected-title', kind: 'HEADING', title: '선택한 모험맵 · 실행 순서' },
    ...(draft.maps.length === 0
      ? [{ key: 'empty', kind: 'EMPTY' } as const]
      : draft.maps.map((setting, index) => ({
        key: `selected:${adventureMapIdentity(setting)}`,
        kind: 'SELECTED' as const,
        setting,
        index,
      }))),
    { key: 'catalog-title', kind: 'HEADING', title: '모험맵 찾기' },
    { key: 'search', kind: 'SEARCH' },
    ...catalogRows.rows,
    ...(searching && !mapState.loading && mapState.error == null && battleCategoriesError == null && catalogRows.matchCount === 0
      ? [{ key: 'catalog-no-results', kind: 'NO_RESULTS' } as const]
      : []),
  ], [battleCategoriesError, catalogRows.matchCount, catalogRows.rows, draft.maps, mapState.error, mapState.loading, searching]);

  const closePresetPicker = useCallback((session: PresetSession | null) => {
    if (!isSamePresetSession(presetSessionRef.current, session)) return;
    presetSessionRef.current = null;
    setActivePresetSession((current) => isSamePresetSession(current, session) ? null : current);
  }, []);

  useEffect(() => {
    if (activePresetSession != null && (activePresetSetting == null || controlsDisabled)) {
      closePresetPicker(activePresetSession);
    }
  }, [activePresetSession, activePresetSetting, closePresetPicker, controlsDisabled]);

  const openPresetPicker = useCallback((identity: string) => {
    if (controlsDisabledRef.current) return;
    const session = { generation: ++presetSessionGenerationRef.current, identity };
    presetSessionRef.current = session;
    setActivePresetSession(session);
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

  function requestBack() {
    if (busyRef.current) return;
    if (!dirty) return onBack();
    Alert.alert('변경 사항을 버릴까요?', '저장하지 않은 모험맵 설정이 있습니다.', [
      { text: '계속 편집', style: 'cancel' },
      { text: '나가기', style: 'destructive', onPress: () => {
        if (!busyRef.current) onBack();
      } },
    ]);
  }

  function confirmDelete() {
    if (controlsDisabledRef.current) return;
    Alert.alert('모험맵 자동화를 삭제할까요?', '선택한 모험맵 설정이 삭제됩니다.', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => {
        if (controlsDisabledRef.current) return;
        controlsDisabledRef.current = true;
        busyRef.current = true;
        setLocalBusy(true);
        onClearMutationMessage();
        try {
          if (await onDelete() && mountedRef.current) onBack();
        } finally {
          if (mountedRef.current) setLocalBusy(false);
        }
      } },
    ]);
  }

  async function save() {
    if (saveDisabled || controlsDisabledRef.current) return;
    controlsDisabledRef.current = true;
    busyRef.current = true;
    setLocalBusy(true);
    onClearMutationMessage();
    try {
      const submittedDraft = draftRef.current;
      const request = buildAdventureMapAutomationRequest(submittedDraft, validPresetIds);
      const submittedBaseline = serializeDraft(submittedDraft);
      if (await onSave(request)) baselineRef.current = submittedBaseline;
    } finally {
      if (mountedRef.current) setLocalBusy(false);
    }
  }

  const renderItem = useCallback(({ item }: { item: ListItem }) => {
    if (item.kind === 'HEADING') return <Text style={styles.sectionTitle}>{item.title}</Text>;
    if (item.kind === 'EMPTY') return <Text style={styles.muted}>아래 목록에서 실행할 모험맵을 추가해 주세요.</Text>;
    if (item.kind === 'SEARCH') {
      return <TextInput accessibilityLabel="모험맵 검색" editable={!controlsDisabled} onChangeText={(nextQuery) => { queryRef.current = nextQuery; setQuery(nextQuery); }} placeholder="맵 이름, 그룹, 추천 레벨 검색" placeholderTextColor={theme.colors.textMuted} style={styles.search} value={query} />;
    }
    if (item.kind === 'NO_RESULTS') return <Text style={styles.muted}>검색 가능한 모험맵이 없습니다.</Text>;
    if (item.kind === 'GROUP') {
      return (
        <AdventureMapCatalogGroupRow
          expanded={item.expanded}
          group={item.group}
          interactionDisabled={searching}
          onPress={() => toggleCatalogGroup(item.group.key)}
        />
      );
    }
    if (item.kind === 'MAP') {
      const selected = draft.maps.some((setting) => adventureMapIdentity(setting) === adventureMapIdentity(item.map));
      return (
        <AdventureMapCatalogMapRow
          disabled={controlsDisabled}
          map={item.map}
          onPress={() => updateEditableDraft((current) => {
            const currentlySelected = current.maps.some(
              (setting) => adventureMapIdentity(setting) === adventureMapIdentity(item.map),
            );
            return selectAdventureMap(current, item.map, !currentlySelected);
          })}
          selected={selected}
        />
      );
    }
    const { setting, index } = item;
    const state = setting.observed == null
      ? { label: '현재 상태 확인 불가', detail: '저장된 설정은 유지되며 목록 갱신 후 다시 확인합니다.' }
      : describeAdventureMapState(setting.observed);
    const presetLabel = formatAutomationPresetSelection(setting, presets);
    const constraints = describeAdventureMapConstraints(setting.observed);
    return (
      <View style={styles.card}>
        <View style={styles.rowHeading}>
          <View style={styles.copy}>
            <Text style={styles.mapName}>{setting.displayName}</Text>
            <Text style={styles.state}>{state.label}</Text>
          </View>
          <Pressable accessibilityLabel={`${setting.displayName} 위로`} disabled={controlsDisabled || index === 0} onPress={() => updateEditableDraft((current) => moveAdventureMapSetting(current, index, index - 1))} style={styles.iconButton}><ArrowUp color={theme.colors.textMuted} size={16} /></Pressable>
          <Pressable accessibilityLabel={`${setting.displayName} 아래로`} disabled={controlsDisabled || index === draft.maps.length - 1} onPress={() => updateEditableDraft((current) => moveAdventureMapSetting(current, index, index + 1))} style={styles.iconButton}><ArrowDown color={theme.colors.textMuted} size={16} /></Pressable>
          <Pressable accessibilityLabel={`${setting.displayName} 제거`} disabled={controlsDisabled} onPress={() => updateEditableDraft((current) => removeAdventureMapSetting(current, index))} style={styles.iconButton}><Trash2 color={theme.colors.danger} size={16} /></Pressable>
        </View>
        {state.detail ? <Text style={styles.muted}>{state.detail}</Text> : null}
        <View style={styles.constraintList}>
          {constraints.map((constraint) => (
            <Text key={constraint.key} style={styles.constraintChip}>{constraint.label}</Text>
          ))}
        </View>
        <View accessibilityLabel={`${setting.displayName} 현재 프리셋: ${presetLabel}`} style={styles.presetSummary}>
          <Text style={styles.muted}>현재 프리셋</Text>
          <Text style={styles.choiceText}>{presetLabel}</Text>
        </View>
        <Pressable accessibilityLabel={`${setting.displayName} 프리셋 선택 열기`} disabled={controlsDisabled} onPress={() => openPresetPicker(adventureMapIdentity(setting))} style={styles.choice}><Text style={styles.choiceText}>프리셋 변경</Text></Pressable>
      </View>
    );
  }, [controlsDisabled, draft.maps, openPresetPicker, presets, query, searching, toggleCatalogGroup, updateEditableDraft]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="모험맵 자동화 뒤로" disabled={busy} onPress={requestBack} style={styles.iconButton}><ArrowLeft color={theme.colors.text} size={21} /></Pressable>
        <View style={styles.copy}>
          <Text style={styles.title}>모험맵 자동화</Text>
          <Text style={styles.subtitle}>상태와 관계없이 선택하고 실행 순서를 정하세요.</Text>
        </View>
        <Switch accessibilityLabel="모험맵 자동화 사용" disabled={controlsDisabled} value={draft.enabled} onValueChange={(enabled) => updateEditableDraft((current) => ({ ...current, enabled }))} />
      </View>
      <View style={styles.refreshBand}>
        <Text style={styles.refreshTitle}>한국 날짜 00시 초기화</Text>
        <Text style={styles.refreshText}>{formatAdventureDailyRefresh(dailyRefresh)}</Text>
      </View>
      {mutationMessage ? <Text accessibilityRole="alert" style={styles.problem}>{mutationMessage}</Text> : null}
      {battleCategoriesError ? <ResourceWarning label="맵 카테고리" onRetry={onLoadBattleCategories} /> : null}
      {mapState.error ? <ResourceWarning label="모험맵" onRetry={loadMaps} /> : null}
      {presetState.error ? <ResourceWarning label="프리셋" onRetry={loadPresets} /> : presetState.loading ? <Text style={styles.muted}>프리셋 불러오는 중</Text> : null}
      <FlatList contentContainerStyle={styles.content} data={items} initialNumToRender={12} keyboardShouldPersistTaps="handled" keyExtractor={(item) => item.key} renderItem={renderItem} windowSize={7} />
      <BattleMapPresetPickerModal
        disabled={controlsDisabled}
        mapName={activePresetSetting?.displayName ?? ''}
        onClose={() => closePresetPicker(activePresetSession)}
        onSelect={(presetId) => {
          const session = activePresetSession;
          if (controlsDisabledRef.current || session == null
            || !isSamePresetSession(presetSessionRef.current, session)) return;
          updateEditableDraft((current) => ({
            ...current,
            maps: current.maps.map((map) => adventureMapIdentity(map) !== session.identity ? map : presetId == null
              ? { ...map, presetMode: 'PRIMARY', partyPresetId: null }
              : { ...map, presetMode: 'EXPLICIT', partyPresetId: presetId }),
          }));
          closePresetPicker(session);
        }}
        presets={presets}
        selectedPresetId={activePresetSetting?.partyPresetId ?? null}
        selectedPresetMode={activePresetSetting?.presetMode ?? 'PRIMARY'}
        visible={activePresetSetting != null && !controlsDisabled}
      />
      {errors.length > 0 ? <Text accessibilityRole="alert" style={styles.problem}>{errors[0]}</Text> : null}
      <View style={styles.footer}>
        <Pressable accessibilityLabel="모험맵 자동화 삭제" disabled={controlsDisabled} onPress={confirmDelete} style={styles.deleteButton}><Trash2 color={theme.colors.danger} size={17} /><Text style={styles.deleteText}>삭제</Text></Pressable>
        <Pressable accessibilityLabel="모험맵 자동화 저장" disabled={saveDisabled} onPress={() => save()} style={[styles.saveButton, saveDisabled && styles.disabled]}>{busy ? <ActivityIndicator color={theme.colors.buttonText} size="small" /> : <Save color={theme.colors.buttonText} size={17} />}<Text style={styles.saveText}>저장</Text></Pressable>
      </View>
    </View>
  );
}

function ResourceWarning({ label, onRetry }: { label: string; onRetry: () => void | Promise<unknown> }) {
  return <View style={styles.warning}><Text style={styles.problem}>{label}을 불러오지 못했어요.</Text><Pressable onPress={() => { void onRetry(); }} style={styles.choice}><Text style={styles.choiceText}>다시 시도</Text></Pressable></View>;
}
function serializeDraft(draft: AdventureMapAutomationDraft): string {
  return JSON.stringify([draft.enabled, draft.maps.map(({ categoryId, mapCode, presetMode, partyPresetId, executionOrder }) => [categoryId, mapCode, presetMode, partyPresetId, executionOrder])]);
}
function serializeEntrySettings(entry: TypedAutomationEntryResponse): string {
  return JSON.stringify([entry.enabled, entry.adventureMaps]);
}
function isSamePresetSession(left: PresetSession | null, right: PresetSession | null): boolean {
  return left != null && right != null
    && left.generation === right.generation
    && left.identity === right.identity;
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: theme.spacing.sm, padding: theme.spacing.lg },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  copy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  refreshBand: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: 2, padding: theme.spacing.md },
  refreshTitle: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' },
  refreshText: { color: theme.colors.accentGreen, fontSize: 13, fontWeight: '900' },
  content: { gap: theme.spacing.md, paddingBottom: theme.spacing.lg },
  sectionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '900', marginTop: theme.spacing.sm },
  search: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, color: theme.colors.text, minHeight: 46, paddingHorizontal: theme.spacing.md },
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md + 4, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  rowHeading: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  mapName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  state: { color: theme.colors.accentAmber, fontSize: 11, fontWeight: '800' },
  runnable: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '800' },
  constraintList: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  constraintChip: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, color: theme.colors.textMuted, fontSize: 10, fontWeight: '700', paddingHorizontal: theme.spacing.sm, paddingVertical: 4 },
  muted: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  problem: { color: theme.colors.accentAmber, fontSize: 11, lineHeight: 16 },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  presetSummary: { gap: 2 },
  choice: { borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: theme.spacing.md },
  choiceText: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  warning: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  footer: { flexDirection: 'row', gap: theme.spacing.sm },
  deleteButton: { alignItems: 'center', borderColor: theme.colors.danger, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, minHeight: 48, justifyContent: 'center', paddingHorizontal: theme.spacing.lg },
  deleteText: { color: theme.colors.danger, fontWeight: '800' },
  saveButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, flex: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 48, justifyContent: 'center' },
  saveText: { color: theme.colors.buttonText, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});
