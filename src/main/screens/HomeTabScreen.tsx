import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ElementRef, type ReactNode } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Info } from 'lucide-react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';

import type { BattleResource } from '../features/battle/useBattleResource';
import type { AutomationPresetEditor } from '../domain/automationPresetEditor';
import { confirmPresetNavigation } from '../features/automation/confirmPresetNavigation';
import type { UnifiedAutomationController } from '../domain/unifiedAutomationController';
import type { PartyPresetCatalogResource } from '../domain/partyPresetCatalogModule';
import { UnifiedAutomationDashboard } from '../features/automation/components/UnifiedAutomationDashboard';
import { AdventureMapAutomationEditor } from '../features/automation/components/AdventureMapAutomationEditor';
import { BattleMapAutomationEditor } from '../features/automation/components/BattleMapAutomationEditor';
import { QuestAutomationEditor } from '../features/automation/components/QuestAutomationEditor';
import { UnifiedAutomationSettings } from '../features/automation/components/UnifiedAutomationSettings';
import { AutomationPresetDetail, AutomationPresets } from '../features/automation/components/AutomationPresets';
import { NewAutomationEditor } from '../features/automation/components/NewAutomationEditor';
import { ColosseumAutomationEditor } from '../features/automation/components/ColosseumAutomationEditor';
import { HomeQuestAutomationEditor } from '../features/automation/components/HomeQuestAutomationEditor';
import { AutomationHistoryScreen } from '../features/automation/components/AutomationHistoryScreen';
import { theme } from '../styles/theme';
import { scrollFocusedInputIntoView } from '../components/keyboardAwareScroll';
import { HomeStatusSummary } from '../components/HomeStatusSummary';
import type { TownApi } from '../features/town/api/townApi';
import type {
  AutomationType,
  HofObservedStatusResponse,
  HofStatusResponse,
  RaidPubResponse,
  HomeResponse,
  ColosseumBattleResponse,
  TypedAutomationEntryResponse,
  UpdateFishingAutomationRequest,
  UpdateRaidAutomationRequest,
  UpdateUnionAutomationRequest,
} from '../types/api';

type HomeTabScreenProps = {
  authenticated: boolean;
  status: HofStatusResponse | null;
  battle: BattleResource;
  partyPresetCatalog: PartyPresetCatalogResource;
  automationController: UnifiedAutomationController;
  onOpenCaptcha: () => void;
  onOpenAppSettings: () => void;
  onStatusObserved?: (status: HofObservedStatusResponse) => void;
  onDetailModeChange?: (active: boolean) => void;
  townApi?: TownApi;
};

const subscribeToNothing = () => () => undefined;
const noPresetSnapshot = () => null;

type HomeRoute = 'dashboard' | 'settings' | 'preset' | 'editor' | 'history';

/**
 * 공유 자동화 store를 구독하고 대시보드·설정·편집 화면을 전환하는 홈 화면이다.
 *
 * 설정 요청과 큐는 App이 소유한 `UnifiedAutomationController`에 남으므로 탭 전환으로 이 컴포넌트가
 * unmount돼도 중단되지 않는다. 화면에는 현재 전용 편집 항목과 하위 경로만 로컬 state로 둔다.
 */
export function HomeTabScreen({
  authenticated,
  battle,
  status,
  partyPresetCatalog,
  automationController,
  onOpenCaptcha,
  onOpenAppSettings,
  onStatusObserved,
  onDetailModeChange,
  townApi,
}: HomeTabScreenProps) {
  const {
    categories: battleCategories,
    loaded: areBattleCategoriesLoaded,
    loading: isBattleCategoriesLoading,
    errorMessage: battleCategoriesError,
    loadCategories: onLoadBattleCategories,
    loadMapCatalog: onLoadBattleMaps,
  } = battle;

  const loadRaidTargets = useCallback((): Promise<RaidPubResponse> => townApi == null
    ? Promise.reject(new Error('레이드 목록 API를 사용할 수 없습니다.'))
    : townApi.load<RaidPubResponse>('/api/town/raid'), [townApi]);
  const loadHomeQuests = useCallback((): Promise<HomeResponse> => townApi == null
    ? Promise.reject(new Error('자택 관리 API를 사용할 수 없습니다.'))
    : townApi.load<HomeResponse>('/api/town/home'), [townApi]);
  const loadColosseum = useCallback((): Promise<ColosseumBattleResponse> => townApi == null
    ? Promise.reject(new Error('콜로세움 API를 사용할 수 없습니다.'))
    : townApi.load<ColosseumBattleResponse>('/api/town/pvp/colosseum'), [townApi]);
  const [route, setRoute] = useState<HomeRoute>('dashboard');
  const [typedEditorEntry, setTypedEditorEntry] = useState<TypedAutomationEntryResponse | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scrollRef = useRef<ElementRef<typeof NestableScrollContainer>>(null);
  const presetEditor = automationController.presetEditor;
  const settingsController = presetEditor?.draft ?? automationController;
  const presetState = useSyncExternalStore<ReturnType<AutomationPresetEditor['getSnapshot']> | null>(
    presetEditor?.subscribe ?? subscribeToNothing, presetEditor?.getSnapshot ?? noPresetSnapshot, noPresetSnapshot);
  const live = useSyncExternalStore(automationController.subscribe, automationController.getSnapshot, automationController.getSnapshot);
  const settings = useSyncExternalStore(settingsController.subscribe, settingsController.getSnapshot, settingsController.getSnapshot);
  const editing = route === 'preset' || route === 'editor' || (route === 'settings' && !presetEditor);
  const aggregate = editing ? settings.aggregate : live.aggregate;
  const { loading, actionSaving } = live;
  const { savingEntryIds, savingTypes, reordering } = settings;
  const { error, message } = editing ? settings : live;

  useEffect(() => {
    if (!authenticated) automationController.reset();
  }, [authenticated, automationController]);

  useEffect(() => {
    if (authenticated && route === 'settings' && presetEditor) void presetEditor.initialize();
  }, [authenticated, presetEditor, route]);

  useEffect(() => {
    if (route !== 'settings' && route !== 'preset') return undefined;
    const subscription = BackHandler?.addEventListener('hardwareBackPress', () => {
      confirmPresetNavigation(presetEditor, () => setRoute(route === 'preset' ? 'settings' : 'dashboard'));
      return true;
    });
    return () => subscription?.remove();
  }, [presetEditor, route]);

  useEffect(() => {
    if (!presetState?.dirty || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [presetState?.dirty]);

  useEffect(() => {
    if (aggregate?.hofStatus) onStatusObserved?.(aggregate.hofStatus);
  }, [aggregate?.hofStatus, onStatusObserved]);

  useEffect(() => () => {
    onDetailModeChange?.(false);
  }, [onDetailModeChange]);

  useEffect(() => {
    if (!authenticated || route !== 'dashboard') return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = async () => {
      try {
        await automationController.load();
      } finally {
        if (!cancelled) {
          timer = setTimeout(() => { void refresh(); }, 3_000);
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer != null) clearTimeout(timer);
    };
  }, [authenticated, automationController, route]);

  function openPreset(id: number | null, name?: string) {
    if (!presetEditor) return;
    confirmPresetNavigation(presetEditor, () => { void (async () => {
      if (!await presetEditor.select(id) || !mounted.current) return;
      if (name) presetEditor.setName(name);
      setRoute('preset');
    })(); });
  }

  function openModule(entryId: number) {
    if (presetEditor) {
      confirmPresetNavigation(presetEditor, () => { void (async () => {
        if (!await presetEditor.beginCurrentEdit() || !mounted.current) return;
        const entry = presetEditor.draft.getSnapshot().aggregate?.entries.find(item => item.id === entryId);
        if (entry) openEntryDetail(entry); else setRoute('preset');
      })(); });
      return;
    }
    const entry = aggregate?.entries.find(({ id }) => id === entryId);
    if (entry) openEntryDetail(entry);
  }

  function openEntryDetail(entry: TypedAutomationEntryResponse) {
    if (entry.type === 'QUEST' || entry.type === 'HOME_QUEST' || entry.type === 'BATTLE_MAP' || entry.type === 'ADVENTURE_MAP' || entry.type === 'RAID' || entry.type === 'UNION' || entry.type === 'FISHING' || entry.type === 'COLOSSEUM') {
      if (presetState?.busy || savingEntryIds.includes(entry.id) || savingTypes.includes(entry.type)) {
        settingsController.showMessage('이 자동화를 저장하고 있어요. 완료된 뒤 다시 열어 주세요.');
        return;
      }
      setTypedEditorEntry(entry);
      settingsController.clearMessage();
      onDetailModeChange?.(true);
      setRoute('editor');
      return;
    }
  }

  function toggleEntry(entry: TypedAutomationEntryResponse) {
    if (entry.type === 'COLOSSEUM') return settingsController.saveColosseumSettings({ enabled: !entry.enabled });
    if (entry.type === 'QUEST') {
      return settingsController.saveQuestSettings({ enabled: !entry.enabled, quests: entry.quests });
    }
    if (entry.type === 'HOME_QUEST') {
      return settingsController.saveHomeQuestSettings({ enabled: !entry.enabled, quests: entry.homeQuests ?? [] });
    }
    if (entry.type === 'BATTLE_MAP') {
      if (!entry.enabled && entry.battleMaps.length === 0) {
        settingsController.showMessage('맵이 없는 묶음은 활성화할 수 없어요. 먼저 맵을 추가해 주세요.');
        return Promise.resolve(false);
      }
      return settingsController.saveBattleMapGroup(entry.id, {
        settingsRevision: entry.settingsRevision ?? '0',
        displayName: entry.displayName ?? null,
        enabled: !entry.enabled,
        maps: entry.battleMaps,
        minimumRemainingTime: entry.minimumRemainingTime ?? null,
      });
    }
    if (entry.type === 'ADVENTURE_MAP') {
      if (!entry.enabled && entry.adventureMaps.length === 0) {
        settingsController.showMessage('맵이 없는 묶음은 활성화할 수 없어요. 먼저 맵을 추가해 주세요.');
        return Promise.resolve(false);
      }
      return settingsController.saveAdventureMapGroup(entry.id, {
        settingsRevision: entry.settingsRevision ?? '0',
        displayName: entry.displayName ?? null,
        enabled: !entry.enabled,
        maps: entry.adventureMaps,
      });
    }
    if (entry.type === 'FISHING') return settingsController.saveFishingSettings({
      enabled: !entry.enabled,
      maps: entry.fishingMaps ?? [],
    });
    if (entry.type === 'UNION') return settingsController.saveUnionSettings({ enabled: !entry.enabled, maps: entry.unionMaps ?? [] });
    return settingsController.saveRaidSettings({ enabled: !entry.enabled, targets: entry.raidTargets ?? [] });
  }

  const closeEditor = useCallback(() => {
    setTypedEditorEntry(null);
    settingsController.clearMessage();
    onDetailModeChange?.(false);
    setRoute(presetEditor ? 'preset' : 'settings');
  }, [settingsController, onDetailModeChange, presetEditor]);

  const fetchQuestSnapshots = useCallback(
    () => settingsController.fetchQuests(),
    [settingsController],
  );

  function withPresetContext(content: ReactNode) {
    return presetEditor ? <View style={styles.scroller}>
      <Text style={styles.draftBanner}>{presetState?.name || '새 프리셋'} · 변경은 이 구성의 초안에 반영돼요.</Text>
      {content}
    </View> : content;
  }

  let editorContent: ReactNode = null;
  if (aggregate && route === 'editor' && typedEditorEntry?.type === 'QUEST') {
    const currentEntry = aggregate.entries.find(({ id }) => id === typedEditorEntry.id);
    const entry = currentEntry?.type === 'QUEST' ? currentEntry : typedEditorEntry;
    editorContent = (
      <QuestAutomationEditor
        battleCategories={battleCategories}
        areBattleCategoriesLoaded={areBattleCategoriesLoaded}
        isBattleCategoriesLoading={isBattleCategoriesLoading}
        battleCategoriesError={battleCategoriesError}
        entry={entry}
        fetchQuests={fetchQuestSnapshots}
        mutationMessage={message ?? error}
        saving={savingEntryIds.includes(entry.id) || savingTypes.includes('QUEST')}
        onBack={closeEditor}
        onDelete={() => settingsController.deleteEntry(entry.id)}
        partyPresetCatalog={partyPresetCatalog}
        onClearMutationMessage={() => settingsController.clearMessage()}
        onLoadBattleCategories={onLoadBattleCategories}
        onLoadBattleMaps={battle.loadMapCatalog}
        onSave={async (request) => {
          const saved = await settingsController.saveQuestSettings(request);
          if (saved) closeEditor();
          return saved;
        }}
      />
    );
  }

  if (aggregate && route === 'editor' && typedEditorEntry?.type === 'COLOSSEUM') {
    const entry = aggregate.entries.find(({ id }) => id === typedEditorEntry.id) ?? typedEditorEntry;
    editorContent = <ColosseumAutomationEditor entry={entry} loadColosseum={loadColosseum}
      saving={savingEntryIds.includes(entry.id) || savingTypes.includes('COLOSSEUM')}
      mutationMessage={message ?? error} onBack={closeEditor}
      onDelete={() => settingsController.deleteEntry(entry.id)}
      onSave={async (request) => { const saved = await settingsController.saveColosseumSettings(request); if (saved) closeEditor(); return saved; }} />;
  }

  if (aggregate && route === 'editor' && typedEditorEntry?.type === 'HOME_QUEST') {
    const currentEntry = aggregate.entries.find(({ id }) => id === typedEditorEntry.id);
    const entry = currentEntry?.type === 'HOME_QUEST' ? currentEntry : typedEditorEntry;
    editorContent = <HomeQuestAutomationEditor
      entry={entry}
      loadHome={loadHomeQuests}
      mutationMessage={message ?? error}
      onBack={closeEditor}
      onDelete={() => settingsController.deleteEntry(entry.id)}
      onSave={async (request) => {
        const saved = await settingsController.saveHomeQuestSettings(request);
        if (saved) closeEditor();
        return saved;
      }}
      saving={savingEntryIds.includes(entry.id) || savingTypes.includes('HOME_QUEST')}
    />;
  }

  if (aggregate && route === 'editor' && typedEditorEntry?.type === 'BATTLE_MAP') {
    const currentEntry = aggregate.entries.find(({ id }) => id === typedEditorEntry.id);
    const entry = currentEntry?.type === 'BATTLE_MAP' ? currentEntry : typedEditorEntry;
    editorContent = (
      <BattleMapAutomationEditor
        battleCategories={battleCategories}
        areBattleCategoriesLoaded={areBattleCategoriesLoaded}
        isBattleCategoriesLoading={isBattleCategoriesLoading}
        battleCategoriesError={battleCategoriesError}
        entry={entry}
        observedTimeMax={aggregate.hofStatus?.timeMax ?? status?.timeMax ?? null}
        mutationMessage={message ?? error}
        saving={savingEntryIds.includes(entry.id) || savingTypes.includes('BATTLE_MAP')}
        onBack={closeEditor}
        partyPresetCatalog={partyPresetCatalog}
        onClearMutationMessage={() => settingsController.clearMessage()}
        onLoadBattleCategories={onLoadBattleCategories}
        onLoadBattleMaps={onLoadBattleMaps}
        otherMapGroups={aggregate.entries.filter((candidate) => candidate.type === 'BATTLE_MAP' && candidate.id !== entry.id)}
        onMoveMap={(sourceEntryId, categoryId, mapCode, targetExecutionOrder) => {
          const source = aggregate.entries.find((candidate) => candidate.id === sourceEntryId && candidate.type === 'BATTLE_MAP');
          if (!source) {
            settingsController.showMessage('원본 전투 맵 묶음을 다시 확인해 주세요.');
            return Promise.resolve(false);
          }
          return settingsController.moveMapBetweenGroups(entry.id, {
            sourceEntryId,
            sourceSettingsRevision: source.settingsRevision ?? '0',
            targetSettingsRevision: entry.settingsRevision ?? '0',
            categoryId,
            mapCode,
            targetExecutionOrder,
          });
        }}
        onSave={async (request) => {
          const saved = await settingsController.saveBattleMapGroup(entry.id, {
            settingsRevision: entry.settingsRevision ?? '0',
            displayName: request.displayName ?? entry.displayName ?? null,
            enabled: request.enabled,
            maps: request.maps,
            minimumRemainingTime: request.minimumRemainingTime,
          });
          if (saved) closeEditor();
          return saved;
        }}
      />
    );
  }

  if (aggregate && route === 'editor' && typedEditorEntry?.type === 'ADVENTURE_MAP') {
    const currentEntry = aggregate.entries.find(({ id }) => id === typedEditorEntry.id);
    const entry = currentEntry?.type === 'ADVENTURE_MAP' ? currentEntry : typedEditorEntry;
    editorContent = (
      <AdventureMapAutomationEditor
        battleCategories={battleCategories}
        areBattleCategoriesLoaded={areBattleCategoriesLoaded}
        isBattleCategoriesLoading={isBattleCategoriesLoading}
        battleCategoriesError={battleCategoriesError}
        dailyRefresh={aggregate.runtime.dailyRefresh}
        entry={entry}
        mutationMessage={message ?? error}
        saving={savingEntryIds.includes(entry.id) || savingTypes.includes('ADVENTURE_MAP')}
        onBack={closeEditor}
        partyPresetCatalog={partyPresetCatalog}
        onClearMutationMessage={() => settingsController.clearMessage()}
        onLoadBattleCategories={onLoadBattleCategories}
        onLoadBattleMaps={onLoadBattleMaps}
        otherMapGroups={aggregate.entries.filter((candidate) => candidate.type === 'ADVENTURE_MAP' && candidate.id !== entry.id)}
        onMoveMap={(sourceEntryId, categoryId, mapCode, targetExecutionOrder) => {
          const source = aggregate.entries.find((candidate) => candidate.id === sourceEntryId && candidate.type === 'ADVENTURE_MAP');
          if (!source) {
            settingsController.showMessage('원본 모험맵 묶음을 다시 확인해 주세요.');
            return Promise.resolve(false);
          }
          return settingsController.moveMapBetweenGroups(entry.id, {
            sourceEntryId,
            sourceSettingsRevision: source.settingsRevision ?? '0',
            targetSettingsRevision: entry.settingsRevision ?? '0',
            categoryId,
            mapCode,
            targetExecutionOrder,
          });
        }}
        onSave={async (request) => {
          const saved = await settingsController.saveAdventureMapGroup(entry.id, {
            settingsRevision: entry.settingsRevision ?? '0',
            displayName: request.displayName ?? entry.displayName ?? null,
            enabled: request.enabled,
            maps: request.maps,
          });
          if (saved) closeEditor();
          return saved;
        }}
      />
    );
  }

  if (aggregate && route === 'editor' && typedEditorEntry && typedEditorEntry.type in { RAID: 1, UNION: 1, FISHING: 1 }) {
    const currentEntry = aggregate.entries.find(({ id }) => id === typedEditorEntry.id) ?? typedEditorEntry;
    editorContent = (<NewAutomationEditor
      entry={currentEntry} saving={savingEntryIds.includes(currentEntry.id) || savingTypes.includes(currentEntry.type)}
      mutationMessage={message ?? error} onBack={closeEditor} onLoadBattleMaps={onLoadBattleMaps}
      onLoadRaidTargets={loadRaidTargets}
      partyPresetCatalog={partyPresetCatalog} onSave={async (request) => {
        let saved = false;
        if (currentEntry.type === 'FISHING') saved = await settingsController.saveFishingSettings(request as UpdateFishingAutomationRequest);
        else if (currentEntry.type === 'UNION') saved = await settingsController.saveUnionSettings(request as UpdateUnionAutomationRequest);
        else saved = await settingsController.saveRaidSettings(request as UpdateRaidAutomationRequest);
        if (saved) closeEditor(); return saved;
      }}
    />);
  }

  if (editorContent) return withPresetContext(editorContent);

  if (route === 'history') return <AutomationHistoryScreen
    onBack={() => { onDetailModeChange?.(false); setRoute('dashboard'); }}
    load={(cursor) => automationController.fetchHistory(cursor)}
    loadConvergence={() => automationController.fetchConvergence()}
    allowFreshDecision={(attemptId) => automationController.allowFreshDecision(attemptId)}
    allowLocalFreshDecision={(actionId) => automationController.allowLocalFreshDecision(actionId)}
  />;

  const showPageHeader = route !== 'editor';
  const settingsPage = route === 'settings' || route === 'preset';
  const pageHeader = showPageHeader ? (<View style={[styles.header, settingsPage && styles.fixedHeader]}>
          {settingsPage ? (
            <Pressable accessibilityLabel={route === 'preset' ? '프리셋 목록으로' : '통합 자동화로'} accessibilityRole="button"
              onPress={() => confirmPresetNavigation(presetEditor, () => setRoute(route === 'preset' ? 'settings' : 'dashboard'))} style={styles.iconButton}>
              <ArrowLeft color={theme.colors.text} size={20} />
            </Pressable>
          ) : null}
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{route === 'dashboard' ? '통합 자동화' : presetEditor && route === 'settings' ? '자동화 프리셋' : '자동화 설정'}</Text>
            <Text style={styles.subtitle}>{route === 'dashboard' ? '앱을 닫아도 서버에서 계속 진행돼요'
              : route === 'settings' && presetEditor ? '프리셋을 선택해 자동화를 설정하세요' : '이 프리셋의 자동화 항목과 판단 순서를 설정해요'}</Text>
          </View>
          <Pressable
            accessibilityLabel="자동화 실행 규칙 보기"
            accessibilityRole="button"
            onPress={() => setRulesOpen((current) => !current)}
            style={styles.iconButton}
          >
            <Info color={theme.colors.textMuted} size={20} />
          </Pressable>
        </View>) : null;
  return (
    <View style={styles.scroller}>
    {settingsPage ? pageHeader : null}
    <NestableScrollContainer
      key={route}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onFocus={(event) => scrollFocusedInputIntoView(scrollRef.current, event.nativeEvent.target)}
      ref={scrollRef}
      style={styles.scroller}
    >
      {route === 'dashboard' ? (
        <HomeStatusSummary
          onOpenSettings={onOpenAppSettings}
          status={aggregate?.hofStatus ?? status}
        />
      ) : null}

      {!settingsPage ? pageHeader : null}

      {showPageHeader && rulesOpen ? (
        <View style={styles.ruleBand}>
          <Text style={styles.ruleTitle}>실행 규칙</Text>
          <Text style={styles.ruleText}>사용 중인 자동화 항목을 위에서부터 판단 순서대로 확인해요.</Text>
          <Text style={styles.ruleText}>{editing && presetEditor ? '편집·전체 저장은 현재 실행에 영향을 주지 않아요. 전체 적용은 일시정지 후 진행해요.' : '현재 전투 중 설정을 바꾸면 다음 작업을 고를 때부터 적용돼요.'}</Text>
          <Text style={styles.ruleText}>캡차 인증이 필요해요 상태에서는 인증 후 자동화를 이어가요.</Text>
          <Text style={styles.ruleText}>전투에 사용할 파티를 선택해 주세요 상태에서는 해당 설정만 보완하면 돼요.</Text>
        </View>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}
      {loading && !aggregate ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={theme.colors.accentGreen} />
          <Text style={styles.muted}>자동화 상태 확인 중</Text>
        </View>
      ) : null}
      {!authenticated ? <Text style={styles.message}>로그인 후 통합 자동화를 설정할 수 있어요.</Text> : null}

      {aggregate && route === 'dashboard' ? (
        <UnifiedAutomationDashboard
          aggregate={aggregate}
          busy={actionSaving}
          onChangeState={(action) => { void automationController.changeState(action); }}
          onOpenCaptcha={onOpenCaptcha}
          onOpenModule={openModule}
          onOpenSettings={() => setRoute('settings')}
          onOpenHistory={() => { onDetailModeChange?.(true); setRoute('history'); }}
        />
      ) : null}

      {route === 'settings' && presetEditor ? (
        <AutomationPresets editor={presetEditor} lifecycle={live.aggregate?.runtime.lifecycle ?? 'STOPPED'}
          onRefresh={() => { void automationController.load(); void (presetState?.loaded ? presetEditor.refresh() : presetEditor.initialize()); }}
          onOpen={openPreset} />
      ) : null}

      {route === 'preset' && presetEditor ? (
        <AutomationPresetDetail editor={presetEditor} lifecycle={live.aggregate?.runtime.lifecycle ?? 'STOPPED'}
          onRefresh={() => { void automationController.load(); }}
          onPause={() => { void automationController.changeState('pause'); }} onDeleted={() => setRoute('settings')}>
          <View pointerEvents={presetState?.busy ? 'none' : 'auto'} accessibilityElementsHidden={presetState?.busy}
              importantForAccessibility={presetState?.busy ? 'no-hide-descendants' : 'auto'}>
              {aggregate ? <UnifiedAutomationSettings
                draftMode={presetEditor != null}
                entries={aggregate.entries} error={message} reordering={reordering}
                savingEntryIds={savingEntryIds} savingTypes={savingTypes}
                onAdd={(type: AutomationType) => settingsController.createEntry(type)}
                onDelete={(entryId) => settingsController.deleteEntry(entryId)} onDetail={openEntryDetail}
                onReorder={(entries) => settingsController.reorderEntries(entries)}
                onToggle={(entry) => { void toggleEntry(entry); }}
              /> : <Text style={styles.muted}>프리셋 구성을 불러오는 중</Text>}
            </View>
        </AutomationPresetDetail>
      ) : route === 'settings' && !presetEditor ? (
        <View pointerEvents={presetState?.busy ? 'none' : 'auto'} accessibilityElementsHidden={presetState?.busy}
              importantForAccessibility={presetState?.busy ? 'no-hide-descendants' : 'auto'}>
              {aggregate ? <UnifiedAutomationSettings
                draftMode={presetEditor != null}
                entries={aggregate.entries} error={message} reordering={reordering}
                savingEntryIds={savingEntryIds} savingTypes={savingTypes}
                onAdd={(type: AutomationType) => settingsController.createEntry(type)}
                onDelete={(entryId) => settingsController.deleteEntry(entryId)} onDetail={openEntryDetail}
                onReorder={(entries) => settingsController.reorderEntries(entries)}
                onToggle={(entry) => { void toggleEntry(entry); }}
              /> : <Text style={styles.muted}>프리셋 구성을 불러오는 중</Text>}
            </View>
      ) : null}

    </NestableScrollContainer>
    </View>
  );
}


const styles = StyleSheet.create({
  scroller: { flex: 1 },
  draftBanner: { color: theme.colors.accentGreen, backgroundColor: theme.colors.surface, padding: theme.spacing.md, fontSize: theme.fontSize.body },
  container: { gap: theme.layout.sectionGap, padding: theme.layout.screenPadding, paddingBottom: theme.spacing.xl },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  fixedHeader: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.spacing.sm },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: '900' },
  subtitle: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, marginTop: theme.spacing.hairline },
  iconButton: { alignItems: 'center', borderRadius: theme.radius.md, height: 44, justifyContent: 'center', width: 44, minHeight: theme.control.touch, minWidth: theme.control.touch, },
  ruleBand: { borderBottomColor: theme.colors.border, borderBottomWidth: 1, gap: theme.spacing.xs, paddingBottom: theme.spacing.md },
  ruleTitle: { color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: '800', marginBottom: theme.spacing.hairline },
  ruleText: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption },
  loadingBox: { alignItems: 'center', gap: theme.spacing.xs, padding: theme.spacing.xl },
  message: { borderLeftColor: theme.colors.accentAmber, borderLeftWidth: 3, color: theme.colors.text, fontSize: theme.fontSize.body, lineHeight: theme.lineHeight.caption, paddingLeft: theme.spacing.sm },
  muted: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption },
});
