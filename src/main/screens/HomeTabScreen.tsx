import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Info } from 'lucide-react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';

import type { UnifiedAutomationController } from '../domain/unifiedAutomationController';
import type { PartyPresetCatalogResource } from '../domain/partyPresetCatalogLoader';
import { UnifiedAutomationDashboard } from '../features/automation/components/UnifiedAutomationDashboard';
import { AdventureMapAutomationEditor } from '../features/automation/components/AdventureMapAutomationEditor';
import { BattleMapAutomationEditor } from '../features/automation/components/BattleMapAutomationEditor';
import { QuestAutomationEditor } from '../features/automation/components/QuestAutomationEditor';
import { UnifiedAutomationSettings } from '../features/automation/components/UnifiedAutomationSettings';
import { NewAutomationEditor } from '../features/automation/components/NewAutomationEditor';
import { AutomationHistoryScreen } from '../features/automation/components/AutomationHistoryScreen';
import { theme } from '../styles/theme';
import type { TownApi } from '../features/town/api/townApi';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  AutomationType,
  HofObservedStatusResponse,
  RaidPubResponse,
  TypedAutomationEntryResponse,
  UpdateFishingAutomationRequest,
  UpdateRaidAutomationRequest,
  UpdateUnionAutomationRequest,
} from '../types/api';

type HomeTabScreenProps = {
  authenticated: boolean;
  battleCategories: BattleCategoryResponse[];
  areBattleCategoriesLoaded: boolean;
  isBattleCategoriesLoading: boolean;
  battleCategoriesError: string | null;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  partyPresetCatalog: PartyPresetCatalogResource;
  automationController: UnifiedAutomationController;
  onOpenCaptcha: () => void;
  onStatusObserved?: (status: HofObservedStatusResponse) => void;
  onDetailModeChange?: (active: boolean) => void;
  townApi?: TownApi;
};

type HomeRoute = 'dashboard' | 'settings' | 'editor' | 'history';

/**
 * 공유 자동화 store를 구독하고 대시보드·설정·편집 화면을 전환하는 홈 화면이다.
 *
 * 설정 요청과 큐는 App이 소유한 `UnifiedAutomationController`에 남으므로 탭 전환으로 이 컴포넌트가
 * unmount돼도 중단되지 않는다. 화면에는 현재 전용 편집 항목과 하위 경로만 로컬 state로 둔다.
 */
export function HomeTabScreen({
  authenticated,
  battleCategories,
  areBattleCategoriesLoaded,
  isBattleCategoriesLoading,
  battleCategoriesError,
  onLoadBattleCategories,
  onLoadBattleMaps,
  partyPresetCatalog,
  automationController,
  onOpenCaptcha,
  onStatusObserved,
  onDetailModeChange,
  townApi,
}: HomeTabScreenProps) {
  const loadRaidTargets = useCallback((): Promise<RaidPubResponse> => townApi == null
    ? Promise.reject(new Error('레이드 목록 API를 사용할 수 없습니다.'))
    : townApi.load<RaidPubResponse>('/api/town/raid'), [townApi]);
  const [route, setRoute] = useState<HomeRoute>('dashboard');
  const [typedEditorEntry, setTypedEditorEntry] = useState<TypedAutomationEntryResponse | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const {
    aggregate,
    loading,
    actionSaving,
    savingEntryIds,
    savingTypes,
    reordering,
    error,
    message,
  } = useSyncExternalStore(
    automationController.subscribe,
    automationController.getSnapshot,
    automationController.getSnapshot,
  );

  useEffect(() => {
    if (!authenticated) automationController.reset();
  }, [authenticated, automationController]);

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

  function openModule(entryId: number) {
    const entry = aggregate?.entries.find(({ id }) => id === entryId);
    if (entry) openEntryDetail(entry);
  }

  function openEntryDetail(entry: TypedAutomationEntryResponse) {
    if (entry.type === 'QUEST' || entry.type === 'BATTLE_MAP' || entry.type === 'ADVENTURE_MAP' || entry.type === 'RAID' || entry.type === 'UNION' || entry.type === 'FISHING') {
      if (savingEntryIds.includes(entry.id) || savingTypes.includes(entry.type)) {
        automationController.showMessage('이 자동화를 저장하고 있어요. 완료된 뒤 다시 열어 주세요.');
        return;
      }
      setTypedEditorEntry(entry);
      automationController.clearMessage();
      onDetailModeChange?.(true);
      setRoute('editor');
      return;
    }
  }

  function toggleEntry(entry: TypedAutomationEntryResponse) {
    if (entry.type === 'QUEST') {
      return automationController.saveQuestSettings({ enabled: !entry.enabled, quests: entry.quests });
    }
    if (entry.type === 'BATTLE_MAP') {
      return automationController.saveBattleMapSettings({ enabled: !entry.enabled, maps: entry.battleMaps });
    }
    if (entry.type === 'ADVENTURE_MAP') return automationController.saveAdventureMapSettings({ enabled: !entry.enabled, maps: entry.adventureMaps });
    if (entry.type === 'FISHING') return automationController.saveFishingSettings({
      enabled: !entry.enabled,
      maps: entry.fishingMaps ?? [],
      ...(entry.fishingMaps?.length ? {} : entry.fishing ?? {}),
    });
    if (entry.type === 'UNION') return automationController.saveUnionSettings({ enabled: !entry.enabled, maps: entry.unionMaps ?? [] });
    return automationController.saveRaidSettings({ enabled: !entry.enabled, targets: entry.raidTargets ?? [] });
  }

  const closeEditor = useCallback(() => {
    setTypedEditorEntry(null);
    automationController.clearMessage();
    onDetailModeChange?.(false);
    setRoute('settings');
  }, [automationController, onDetailModeChange]);

  const fetchQuestSnapshots = useCallback(
    () => automationController.fetchQuests(),
    [automationController],
  );

  if (aggregate && route === 'editor' && typedEditorEntry?.type === 'QUEST') {
    const currentEntry = aggregate.entries.find(({ id }) => id === typedEditorEntry.id);
    const entry = currentEntry?.type === 'QUEST' ? currentEntry : typedEditorEntry;
    return (
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
        onDelete={() => automationController.deleteEntry(entry.id)}
        partyPresetCatalog={partyPresetCatalog}
        onClearMutationMessage={() => automationController.clearMessage()}
        onLoadBattleCategories={onLoadBattleCategories}
        onLoadBattleMaps={onLoadBattleMaps}
        onSave={async (request) => {
          const saved = await automationController.saveQuestSettings(request);
          if (saved) closeEditor();
          return saved;
        }}
      />
    );
  }

  if (aggregate && route === 'editor' && typedEditorEntry?.type === 'BATTLE_MAP') {
    const currentEntry = aggregate.entries.find(({ id }) => id === typedEditorEntry.id);
    const entry = currentEntry?.type === 'BATTLE_MAP' ? currentEntry : typedEditorEntry;
    return (
      <BattleMapAutomationEditor
        battleCategories={battleCategories}
        areBattleCategoriesLoaded={areBattleCategoriesLoaded}
        isBattleCategoriesLoading={isBattleCategoriesLoading}
        battleCategoriesError={battleCategoriesError}
        entry={entry}
        mutationMessage={message ?? error}
        saving={savingEntryIds.includes(entry.id) || savingTypes.includes('BATTLE_MAP')}
        onBack={closeEditor}
        partyPresetCatalog={partyPresetCatalog}
        onClearMutationMessage={() => automationController.clearMessage()}
        onLoadBattleCategories={onLoadBattleCategories}
        onLoadBattleMaps={onLoadBattleMaps}
        onSave={async (request) => {
          const saved = await automationController.saveBattleMapSettings(request);
          if (saved) closeEditor();
          return saved;
        }}
      />
    );
  }

  if (aggregate && route === 'editor' && typedEditorEntry?.type === 'ADVENTURE_MAP') {
    const currentEntry = aggregate.entries.find(({ id }) => id === typedEditorEntry.id);
    const entry = currentEntry?.type === 'ADVENTURE_MAP' ? currentEntry : typedEditorEntry;
    return (
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
        onClearMutationMessage={() => automationController.clearMessage()}
        onLoadBattleCategories={onLoadBattleCategories}
        onLoadBattleMaps={onLoadBattleMaps}
        onSave={async (request) => {
          const saved = await automationController.saveAdventureMapSettings(request);
          if (saved) closeEditor();
          return saved;
        }}
      />
    );
  }

  if (aggregate && route === 'editor' && typedEditorEntry && typedEditorEntry.type in { RAID: 1, UNION: 1, FISHING: 1 }) {
    const currentEntry = aggregate.entries.find(({ id }) => id === typedEditorEntry.id) ?? typedEditorEntry;
    return <NewAutomationEditor
      entry={currentEntry} saving={savingEntryIds.includes(currentEntry.id) || savingTypes.includes(currentEntry.type)}
      mutationMessage={message ?? error} onBack={closeEditor} onLoadBattleMaps={onLoadBattleMaps}
      onLoadRaidTargets={loadRaidTargets}
      partyPresetCatalog={partyPresetCatalog} onSave={async (request) => {
        let saved = false;
        if (currentEntry.type === 'FISHING') saved = await automationController.saveFishingSettings(request as UpdateFishingAutomationRequest);
        else if (currentEntry.type === 'UNION') saved = await automationController.saveUnionSettings(request as UpdateUnionAutomationRequest);
        else saved = await automationController.saveRaidSettings(request as UpdateRaidAutomationRequest);
        if (saved) closeEditor(); return saved;
      }}
    />;
  }

  if (route === 'history') return <AutomationHistoryScreen onBack={() => { onDetailModeChange?.(false); setRoute('dashboard'); }} load={(cursor) => automationController.fetchHistory(cursor)} />;

  const showPageHeader = route !== 'editor';
  return (
    <NestableScrollContainer
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.scroller}
    >
      {showPageHeader ? (
        <View style={styles.header}>
          {route === 'settings' ? (
            <Pressable accessibilityLabel="통합 자동화로" onPress={() => setRoute('dashboard')} style={styles.iconButton}>
              <ArrowLeft color={theme.colors.text} size={20} />
            </Pressable>
          ) : null}
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{route === 'dashboard' ? '통합 자동화' : '자동화 설정'}</Text>
            <Text style={styles.subtitle}>{route === 'dashboard' ? '앱을 닫아도 서버에서 계속 진행돼요' : '필요한 항목만 추가하고 드래그로 우선순위를 정하세요'}</Text>
          </View>
          <Pressable
            accessibilityLabel="자동화 실행 규칙 보기"
            accessibilityRole="button"
            onPress={() => setRulesOpen((current) => !current)}
            style={styles.iconButton}
          >
            <Info color={theme.colors.textMuted} size={20} />
          </Pressable>
        </View>
      ) : null}

      {showPageHeader && rulesOpen ? (
        <View style={styles.ruleBand}>
          <Text style={styles.ruleTitle}>실행 규칙</Text>
          <Text style={styles.ruleText}>사용 중인 모듈을 위에서부터 우선순위대로 확인해요.</Text>
          <Text style={styles.ruleText}>현재 전투 중 설정을 바꾸면 다음 작업을 고를 때부터 적용돼요.</Text>
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

      {aggregate && route === 'settings' ? (
        <UnifiedAutomationSettings
          entries={aggregate.entries}
          error={message}
          reordering={reordering}
          savingEntryIds={savingEntryIds}
          savingTypes={savingTypes}
          onAdd={(type: AutomationType) => automationController.createEntry(type)}
          onDelete={(entryId) => automationController.deleteEntry(entryId)}
          onDetail={openEntryDetail}
          onReorder={(entries) => automationController.reorderEntries(entries)}
          onToggle={(entry) => { void toggleEntry(entry); }}
        />
      ) : null}

    </NestableScrollContainer>
  );
}


const styles = StyleSheet.create({
  scroller: { flex: 1 },
  container: { gap: theme.spacing.md, padding: theme.spacing.lg, paddingBottom: theme.spacing.xl },
  header: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 21, fontWeight: '900' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3 },
  iconButton: { alignItems: 'center', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  ruleBand: { borderBottomColor: theme.colors.border, borderBottomWidth: 1, gap: 5, paddingBottom: theme.spacing.md },
  ruleTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800', marginBottom: 2 },
  ruleText: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  loadingBox: { alignItems: 'center', gap: 8, padding: theme.spacing.xl },
  message: { borderLeftColor: theme.colors.accentAmber, borderLeftWidth: 3, color: theme.colors.text, fontSize: 13, lineHeight: 19, paddingLeft: theme.spacing.sm },
  muted: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
});
