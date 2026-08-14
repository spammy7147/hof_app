import type { ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabBar } from '../components/BottomTabBar';
import { scrollFocusedInputIntoView } from '../components/keyboardAwareScroll';
import { CharacterDetail } from '../components/CharacterDetail';
import { CharacterList } from '../components/CharacterList';
import { GameStatusBar } from '../components/GameStatusBar';
import { PartyPresetList } from '../components/PartyPresetList';
import { PrimaryButton } from '../components/PrimaryButton';
import { DEFAULT_MAIN_TAB_ID, MainTabId } from '../domain/mainTabs';
import { PartyPresetCatalogLoadCoordinator, type PartyPresetCatalogResource } from '../domain/partyPresetCatalogLoader';
import type { UnifiedAutomationController } from '../domain/unifiedAutomationController';
import { toUserFacingErrorMessage } from '../domain/userFacingErrors';
import { theme } from '../styles/theme';
import type {
  BattleCategoryResponse,
  BattleLogResponse,
  BattleLogQuery,
  BattleMapResponse,
  BattleResultResponse,
  BattleStatsResponse,
  AdventureMapStatsPeriod,
  FishingBattleTarget,
  CreatePartyPresetRequest,
  CreatePartyPresetFolderRequest,
  CharacterManagementActionRequest,
  CharacterManagementSnapshot,
  CharacterObservedAction,
  HofCharacter,
  HofCharacterDetail,
  HofObservedStatusResponse,
  HofStatusResponse,
  LoadPatternResponse,
  MovePartyPresetFolderRequest,
  PartyPresetCatalogResponse,
  PartyPresetResponse,
  RenamePartyPresetFolderRequest,
  ReorderPartyPresetFoldersRequest,
  ReorderPartyPresetsRequest,
  RunBattleRequest,
  UpdatePartyPresetRequest,
} from '../types/api';
import { BattleTabScreen } from './BattleTabScreen';
import { DataTabScreen } from './DataTabScreen';
import { HomeTabScreen } from './HomeTabScreen';
import { SettingsTabScreen } from './SettingsTabScreen';
import { TownTabScrollContainer } from './TownTabScrollContainer';
import type { TownApi } from '../features/town/api/townApi';

type MainSession = {
  loggedIn: boolean;
};

type CharacterSubTabId = 'characters' | 'presets';

type MainScreenProps = {
  session: MainSession | null;
  status: HofStatusResponse | null;
  battleCategories: BattleCategoryResponse[];
  areBattleCategoriesLoaded: boolean;
  isBattleCategoriesLoading: boolean;
  battleCategoriesError: string | null;
  characters: HofCharacter[];
  characterSyncLabel: string | null;
  notice: string | null;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onRunBattle: (request: RunBattleRequest) => Promise<BattleResultResponse>;
  onLoadBattleLogs: (query?: BattleLogQuery) => Promise<BattleLogResponse[]>;
  onLoadBattleStats: (period?: AdventureMapStatsPeriod) => Promise<BattleStatsResponse>;
  onOpenCaptcha: () => void;
  onStatusObserved?: (status: HofObservedStatusResponse) => void;
  automationController: UnifiedAutomationController;
  onGetPartyPresetCatalog: () => Promise<PartyPresetCatalogResponse>;
  onCreatePartyPresetFolder?: (request: CreatePartyPresetFolderRequest) => Promise<PartyPresetCatalogResponse>;
  onRenamePartyPresetFolder?: (folderId: number, request: RenamePartyPresetFolderRequest) => Promise<PartyPresetCatalogResponse>;
  onReorderPartyPresetFolders?: (request: ReorderPartyPresetFoldersRequest) => Promise<PartyPresetCatalogResponse>;
  onMovePartyPresetFolder?: (folderId: number, request: MovePartyPresetFolderRequest) => Promise<PartyPresetCatalogResponse>;
  onDeletePartyPresetFolder?: (folderId: number) => Promise<PartyPresetCatalogResponse>;
  onCreatePartyPreset: (
    request: CreatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onUpdatePartyPreset: (
    presetId: number,
    request: UpdatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onMakePartyPresetPrimary: (presetId: number) => Promise<PartyPresetResponse>;
  onReorderPartyPresets: (request: ReorderPartyPresetsRequest) => Promise<PartyPresetResponse[]>;
  onDeletePartyPreset: (presetId: number) => Promise<null>;
  onLoadCharacterDetail: (hofCharacterId: string) => Promise<HofCharacterDetail>;
  onLoadCharacterManagement?: (hofCharacterId: string) => Promise<CharacterManagementSnapshot>;
  onExecuteCharacterAction?: (
    hofCharacterId: string,
    request: CharacterManagementActionRequest,
  ) => Promise<CharacterManagementSnapshot>;
  onLoadPattern: (hofCharacterId: string, slot: number) => Promise<LoadPatternResponse>;
  onLogout: () => void;
  onOpenLogin: () => void;
  townApi?: TownApi;
  resolveCaptcha?: () => Promise<void>;
};

/**
 * 로그인 이후의 메인 화면이다.
 *
 * 상단 상태바, 현재 탭 화면, 하단 탭 바를 조립하고 각 탭에 필요한 callback을 전달한다.
 */
export function MainScreen({
  session,
  status,
  battleCategories,
  areBattleCategoriesLoaded,
  isBattleCategoriesLoading,
  battleCategoriesError,
  characters,
  characterSyncLabel,
  notice,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onRunBattle,
  onLoadBattleLogs,
  onLoadBattleStats,
  onOpenCaptcha,
  onStatusObserved,
  automationController,
  onGetPartyPresetCatalog,
  onCreatePartyPresetFolder,
  onRenamePartyPresetFolder,
  onReorderPartyPresetFolders,
  onMovePartyPresetFolder,
  onDeletePartyPresetFolder,
  onCreatePartyPreset,
  onUpdatePartyPreset,
  onMakePartyPresetPrimary,
  onReorderPartyPresets,
  onDeletePartyPreset,
  onLoadCharacterDetail,
  onLoadCharacterManagement,
  onExecuteCharacterAction,
  onLoadPattern,
  onLogout,
  onOpenLogin,
  townApi,
  resolveCaptcha,
}: MainScreenProps) {
  const catalogCoordinatorRef = useRef(new PartyPresetCatalogLoadCoordinator());
  const [partyPresetCatalog, setPartyPresetCatalog] = useState<PartyPresetCatalogResponse>({ folders: [], presets: [] });
  const partyPresetCatalogRef = useRef(partyPresetCatalog);
  const presetMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const [partyPresetCatalogLoading, setPartyPresetCatalogLoading] = useState(false);
  const [partyPresetCatalogError, setPartyPresetCatalogError] = useState<string | null>(null);
  const authenticated = Boolean(session?.loggedIn);
  const authenticatedRef = useRef(authenticated);
  const previousAuthenticatedRef = useRef(authenticated);
  const accountGenerationRef = useRef(0);
  authenticatedRef.current = authenticated;
  partyPresetCatalogRef.current = partyPresetCatalog;

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      authenticatedRef.current = false;
      accountGenerationRef.current += 1;
      catalogCoordinatorRef.current.invalidate();
    };
  }, []);

  const loadPartyPresetCatalog = useCallback(async (force = false) => {
    if (!authenticatedRef.current) return;
    const operation = catalogCoordinatorRef.current.start(onGetPartyPresetCatalog, force);
    if (operation == null) return;
    setPartyPresetCatalogLoading(true);
    setPartyPresetCatalogError(null);
    const result = await operation;
    if (result.status === 'stale') return;
    setPartyPresetCatalogLoading(false);
    if (result.status === 'failure') {
      setPartyPresetCatalogError('파티 프리셋을 불러오지 못했습니다.');
      return;
    }
    partyPresetCatalogRef.current = result.catalog;
    setPartyPresetCatalog(result.catalog);
  }, [onGetPartyPresetCatalog]);

  useLayoutEffect(() => {
    if (previousAuthenticatedRef.current !== authenticated) {
      previousAuthenticatedRef.current = authenticated;
      accountGenerationRef.current += 1;
    }
    if (!authenticated) {
      catalogCoordinatorRef.current.invalidate();
      const emptyCatalog = { folders: [], presets: [] };
      partyPresetCatalogRef.current = emptyCatalog;
      setPartyPresetCatalog(emptyCatalog);
      setPartyPresetCatalogLoading(false);
      setPartyPresetCatalogError(null);
      return;
    }
    void loadPartyPresetCatalog();
    return () => catalogCoordinatorRef.current.invalidate();
  }, [authenticated, loadPartyPresetCatalog]);

  const adoptPartyPresetCatalog = useCallback((catalog: PartyPresetCatalogResponse) => {
    if (!authenticatedRef.current) return;
    const result = catalogCoordinatorRef.current.replace(catalog);
    if (result.status === 'success') {
      partyPresetCatalogRef.current = result.catalog;
      setPartyPresetCatalog(result.catalog);
      setPartyPresetCatalogLoading(false);
      setPartyPresetCatalogError(null);
    }
  }, []);
  const updatePartyPresetCatalog = useCallback((update: (catalog: PartyPresetCatalogResponse) => PartyPresetCatalogResponse) => {
    adoptPartyPresetCatalog(update(partyPresetCatalogRef.current));
  }, [adoptPartyPresetCatalog]);
  const runPresetMutation = useCallback(<T,>(
    operation: () => Promise<T>,
    apply: (result: T) => void,
  ): Promise<T> => {
    const accountGeneration = accountGenerationRef.current;
    const queued = presetMutationQueueRef.current.then(async () => {
      if (!mountedRef.current || !authenticatedRef.current || accountGeneration !== accountGenerationRef.current) {
        throw new Error('Party preset mutation cancelled');
      }
      const result = await operation();
      if (mountedRef.current && authenticatedRef.current && accountGeneration === accountGenerationRef.current) {
        apply(result);
        await loadPartyPresetCatalog(true);
      }
      return result;
    });
    presetMutationQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [loadPartyPresetCatalog]);
  const retryPartyPresetCatalog = useCallback(() => { void loadPartyPresetCatalog(true); }, [loadPartyPresetCatalog]);
  const partyPresetCatalogResource = useMemo<PartyPresetCatalogResource>(() => ({
    catalog: partyPresetCatalog,
    loading: partyPresetCatalogLoading,
    error: partyPresetCatalogError,
    retry: retryPartyPresetCatalog,
  }), [partyPresetCatalog, partyPresetCatalogError, partyPresetCatalogLoading, retryPartyPresetCatalog]);

  const createPreset = useCallback((request: CreatePartyPresetRequest) => runPresetMutation(
    () => onCreatePartyPreset(request),
    (created) => updatePartyPresetCatalog((catalog) => projectPresetUpsert(catalog, created)),
  ), [onCreatePartyPreset, runPresetMutation, updatePartyPresetCatalog]);
  const updatePreset = useCallback((presetId: number, request: UpdatePartyPresetRequest) => runPresetMutation(
    () => onUpdatePartyPreset(presetId, request),
    (updated) => updatePartyPresetCatalog((catalog) => projectPresetUpsert(catalog, updated)),
  ), [onUpdatePartyPreset, runPresetMutation, updatePartyPresetCatalog]);
  const makePresetPrimary = useCallback((presetId: number) => runPresetMutation(
    () => onMakePartyPresetPrimary(presetId),
    (updated) => updatePartyPresetCatalog((catalog) => ({
      ...catalog,
      presets: catalog.presets.map((preset) => preset.id === updated.id
        ? { ...updated, isPrimary: true }
        : { ...preset, isPrimary: false }),
    })),
  ), [onMakePartyPresetPrimary, runPresetMutation, updatePartyPresetCatalog]);
  const reorderPresets = useCallback((request: ReorderPartyPresetsRequest) => runPresetMutation(
    () => onReorderPartyPresets(request),
    (presets) => updatePartyPresetCatalog((catalog) => mergePresetMutationResponse(catalog, presets)),
  ), [onReorderPartyPresets, runPresetMutation, updatePartyPresetCatalog]);
  const deletePreset = useCallback((presetId: number) => runPresetMutation(
    () => onDeletePartyPreset(presetId),
    () => updatePartyPresetCatalog((catalog) => ({
      ...catalog,
      presets: catalog.presets.filter((preset) => preset.id !== presetId),
    })),
  ), [onDeletePartyPreset, runPresetMutation, updatePartyPresetCatalog]);
  const createPresetFolder = useCallback(async (request: CreatePartyPresetFolderRequest) => {
    if (!onCreatePartyPresetFolder) throw new Error('폴더 만들기를 사용할 수 없습니다.');
    const accountGeneration = accountGenerationRef.current;
    const catalog = await onCreatePartyPresetFolder(request);
    if (!authenticatedRef.current || accountGeneration !== accountGenerationRef.current) return catalog;
    adoptPartyPresetCatalog(catalog);
    return catalog;
  }, [adoptPartyPresetCatalog, onCreatePartyPresetFolder]);
  const renamePresetFolder = useCallback(async (folderId: number, request: RenamePartyPresetFolderRequest) => {
    if (!onRenamePartyPresetFolder) throw new Error('폴더 이름 변경을 사용할 수 없습니다.');
    const accountGeneration = accountGenerationRef.current;
    const catalog = await onRenamePartyPresetFolder(folderId, request);
    if (!authenticatedRef.current || accountGeneration !== accountGenerationRef.current) return catalog;
    adoptPartyPresetCatalog(catalog);
    return catalog;
  }, [adoptPartyPresetCatalog, onRenamePartyPresetFolder]);
  const reorderPresetFolders = useCallback(async (request: ReorderPartyPresetFoldersRequest) => {
    if (!onReorderPartyPresetFolders) throw new Error('폴더 순서 변경을 사용할 수 없습니다.');
    const accountGeneration = accountGenerationRef.current;
    const catalog = await onReorderPartyPresetFolders(request);
    if (!authenticatedRef.current || accountGeneration !== accountGenerationRef.current) return catalog;
    adoptPartyPresetCatalog(catalog);
    return catalog;
  }, [adoptPartyPresetCatalog, onReorderPartyPresetFolders]);
  const movePresetFolder = useCallback(async (folderId: number, request: MovePartyPresetFolderRequest) => {
    if (!onMovePartyPresetFolder) throw new Error('폴더 이동을 사용할 수 없습니다.');
    const accountGeneration = accountGenerationRef.current;
    const catalog = await onMovePartyPresetFolder(folderId, request);
    if (!authenticatedRef.current || accountGeneration !== accountGenerationRef.current) return catalog;
    adoptPartyPresetCatalog(catalog);
    return catalog;
  }, [adoptPartyPresetCatalog, onMovePartyPresetFolder]);
  const deletePresetFolder = useCallback(async (folderId: number) => {
    if (!onDeletePartyPresetFolder) throw new Error('폴더 삭제를 사용할 수 없습니다.');
    const accountGeneration = accountGenerationRef.current;
    const catalog = await onDeletePartyPresetFolder(folderId);
    if (!authenticatedRef.current || accountGeneration !== accountGenerationRef.current) return catalog;
    adoptPartyPresetCatalog(catalog);
    return catalog;
  }, [adoptPartyPresetCatalog, onDeletePartyPresetFolder]);
  const [activeTabId, setActiveTabId] = useState<MainTabId>(DEFAULT_MAIN_TAB_ID);
  const [pendingBattleTarget, setPendingBattleTarget] = useState<FishingBattleTarget | null>(null);
  const consumePendingBattleTarget = useCallback(() => setPendingBattleTarget(null), []);
  const [characterSubTabId, setCharacterSubTabId] = useState<CharacterSubTabId>('characters');
  const [selectedCharacter, setSelectedCharacter] = useState<HofCharacter | null>(null);
  const [selectedCharacterDetail, setSelectedCharacterDetail] = useState<HofCharacterDetail | null>(null);
  const [characterActions, setCharacterActions] = useState<CharacterObservedAction[]>([]);
  const [isCharacterDetailLoading, setIsCharacterDetailLoading] = useState(false);
  const [characterDetailError, setCharacterDetailError] = useState<string | null>(null);
  const [automationEditorOpen, setAutomationEditorOpen] = useState(false);
  const [dataLogOpen, setDataLogOpen] = useState(false);
  const [townDetailOpen, setTownDetailOpen] = useState(false);
  const isCharacterDetailOpen = activeTabId === 'characters' && selectedCharacter != null;
  const townDetailFullScreen = activeTabId === 'town' && townDetailOpen;
  const showGlobalChrome = !automationEditorOpen && !dataLogOpen && !townDetailFullScreen && !isCharacterDetailOpen;

  /**
   * SSE 동기화로 characters 배열이 갱신되면 현재 선택된 캐릭터 객체도 최신 값으로 교체한다.
   *
   * 같은 hofCharacterId를 더 이상 찾지 못하면 동기화 중 사라진 캐릭터로 보고 상세 화면을 닫는다.
   */
  useEffect(() => {
    if (!selectedCharacter) return;
    const refreshedCharacter = characters.find(
      (character) => character.hofCharacterId === selectedCharacter.hofCharacterId,
    );
    setSelectedCharacter(refreshedCharacter ?? null);
  }, [characters, selectedCharacter?.hofCharacterId]);

  /**
   * 캐릭터 상세 화면에서 선택 캐릭터의 상세 정보를 불러온다.
   *
   * 사용자가 빠르게 다른 캐릭터로 이동해도 이전 요청 결과가 늦게 도착해 화면을 덮어쓰지 않도록 cancelled 플래그를 사용한다.
   */
  useEffect(() => {
    if (!selectedCharacter || !session?.loggedIn) {
      setSelectedCharacterDetail(null);
      setCharacterActions([]);
      setIsCharacterDetailLoading(false);
      setCharacterDetailError(null);
      return;
    }

    let cancelled = false;
    setSelectedCharacterDetail(null);
    setIsCharacterDetailLoading(true);
    setCharacterDetailError(null);

    (onLoadCharacterManagement
      ? onLoadCharacterManagement(selectedCharacter.hofCharacterId)
      : onLoadCharacterDetail(selectedCharacter.hofCharacterId).then((character) => ({
          character,
          actions: [],
          messages: [],
          characters: [],
          targetRemoved: false,
        })))
      .then((snapshot) => {
        if (!cancelled) {
          if (!snapshot.character) throw new Error('캐릭터 정보를 확인하지 못했습니다.');
          setSelectedCharacterDetail(snapshot.character);
          setCharacterActions(snapshot.actions);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCharacterDetailError(toUserFacingErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCharacterDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onLoadCharacterDetail, onLoadCharacterManagement, selectedCharacter?.hofCharacterId, session?.loggedIn]);

  async function handleCharacterAction(
    request: CharacterManagementActionRequest,
  ): Promise<CharacterManagementSnapshot> {
    if (!selectedCharacter) throw new Error('캐릭터를 선택해 주세요.');
    if (!onExecuteCharacterAction) throw new Error('캐릭터 관리 작업을 사용할 수 없습니다.');
    const snapshot = await onExecuteCharacterAction(selectedCharacter.hofCharacterId, request);
    if (!snapshot.character) {
      setSelectedCharacter(null);
      setSelectedCharacterDetail(null);
      setCharacterActions([]);
      return snapshot;
    }
    if (snapshot.character.hofCharacterId !== selectedCharacter.hofCharacterId) {
      setSelectedCharacter(snapshot.character);
    }
    setSelectedCharacterDetail(snapshot.character);
    setCharacterActions(snapshot.actions);
    return snapshot;
  }

  async function handleLoadPattern(hofCharacterId: string, slot: number): Promise<LoadPatternResponse> {
    const response = await onLoadPattern(hofCharacterId, slot);
    if (response.character?.hofCharacterId === selectedCharacter?.hofCharacterId) {
      setSelectedCharacterDetail(response.character);
    }
    return response;
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      {showGlobalChrome ? <GameStatusBar status={status} /> : null}

      <View
        accessibilityLabel={
          townDetailFullScreen
            ? '마을 상세 전체 화면'
            : isCharacterDetailOpen
              ? '캐릭터 상세 전체 화면'
              : undefined
        }
        style={[styles.content, (townDetailFullScreen || isCharacterDetailOpen) && styles.fullScreenContent]}
      >
        {renderSystemMessage(session, notice, onOpenLogin)}
        {renderActiveTab({
          activeTabId,
          authenticated: session?.loggedIn === true,
          battleCategories,
          areBattleCategoriesLoaded,
          isBattleCategoriesLoading,
          battleCategoriesError,
          characters,
          characterSyncLabel,
          onLoadBattleCategories,
          onLoadBattleMaps,
          onRunBattle,
          onLoadBattleLogs,
          onLoadBattleStats,
          onOpenCaptcha,
          onStatusObserved,
          automationController,
          partyPresetCatalog: partyPresetCatalogResource,
          onCreatePartyPresetFolder: onCreatePartyPresetFolder ? createPresetFolder : undefined,
          onRenamePartyPresetFolder: onRenamePartyPresetFolder ? renamePresetFolder : undefined,
          onReorderPartyPresetFolders: onReorderPartyPresetFolders ? reorderPresetFolders : undefined,
          onMovePartyPresetFolder: onMovePartyPresetFolder ? movePresetFolder : undefined,
          onDeletePartyPresetFolder: onDeletePartyPresetFolder ? deletePresetFolder : undefined,
          onCreatePartyPreset: createPreset,
          onUpdatePartyPreset: updatePreset,
          onMakePartyPresetPrimary: makePresetPrimary,
          onReorderPartyPresets: reorderPresets,
          onDeletePartyPreset: deletePreset,
          onLoadPattern: handleLoadPattern,
          onLogout,
          characterDetailError,
          isCharacterDetailLoading,
          selectedCharacter,
          selectedCharacterDetail,
          characterActions,
          characterSubTabId,
          setCharacterSubTabId,
          setSelectedCharacter,
          closeCharacterDetail: () => setSelectedCharacter(null),
          onExecuteCharacterAction: handleCharacterAction,
          townApi,
          resolveCaptcha,
          pendingBattleTarget,
          consumePendingBattleTarget,
          onOpenFishingBattle: (target) => {
            setPendingBattleTarget(target);
            setActiveTabId('battle');
          },
          onAutomationEditorModeChange: setAutomationEditorOpen,
          onDataLogModeChange: setDataLogOpen,
          onTownDetailOpenChange: setTownDetailOpen,
        })}
      </View>

      {showGlobalChrome ? <BottomTabBar activeTabId={activeTabId} onChangeTab={setActiveTabId} /> : null}
    </SafeAreaView>
  );
}

function projectPresetUpsert(
  catalog: PartyPresetCatalogResponse,
  updated: PartyPresetResponse,
): PartyPresetCatalogResponse {
  const existing = catalog.presets.find(({ id }) => id === updated.id) ?? null;
  const sourceFolderId = existing?.folderId;
  const targetFolderId = updated.folderId;
  const withoutUpdated = catalog.presets.filter(({ id }) => id !== updated.id);
  const affectedFolderIds = new Set<number | null>([targetFolderId]);
  if (sourceFolderId !== undefined) affectedFolderIds.add(sourceFolderId);
  const normalizedById = new Map<number, PartyPresetResponse>();

  for (const folderId of affectedFolderIds) {
    const siblings = withoutUpdated
      .filter((preset) => preset.folderId === folderId)
      .sort(comparePresetOrder);
    if (folderId === targetFolderId) {
      const staysInFolder = existing?.folderId === targetFolderId;
      const insertionIndex = staysInFolder
        ? Math.max(0, Math.min(updated.displayOrder, siblings.length))
        : 0;
      siblings.splice(insertionIndex, 0, updated);
    }
    siblings.forEach((preset, displayOrder) => {
      normalizedById.set(preset.id, { ...preset, displayOrder });
    });
  }

  const presets = catalog.presets.map((preset) => normalizedById.get(preset.id) ?? preset);
  if (!existing) presets.push(normalizedById.get(updated.id) ?? { ...updated, displayOrder: 0 });
  return { ...catalog, presets };
}

function mergePresetMutationResponse(
  catalog: PartyPresetCatalogResponse,
  returned: PartyPresetResponse[],
): PartyPresetCatalogResponse {
  const returnedById = new Map(returned.map((preset) => [preset.id, preset]));
  const existingIds = new Set(catalog.presets.map(({ id }) => id));
  return {
    ...catalog,
    presets: [
      ...catalog.presets.map((preset) => returnedById.get(preset.id) ?? preset),
      ...returned.filter(({ id }) => !existingIds.has(id)),
    ],
  };
}

function comparePresetOrder(left: PartyPresetResponse, right: PartyPresetResponse): number {
  return left.displayOrder - right.displayOrder || left.id - right.id;
}

type RenderActiveTabArgs = {
  activeTabId: MainTabId;
  authenticated: boolean;
  battleCategories: BattleCategoryResponse[];
  areBattleCategoriesLoaded: boolean;
  isBattleCategoriesLoading: boolean;
  battleCategoriesError: string | null;
  characters: HofCharacter[];
  characterSyncLabel: string | null;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onRunBattle: (request: RunBattleRequest) => Promise<BattleResultResponse>;
  onLoadBattleLogs: (query?: BattleLogQuery) => Promise<BattleLogResponse[]>;
  onLoadBattleStats: (period?: AdventureMapStatsPeriod) => Promise<BattleStatsResponse>;
  onOpenCaptcha: () => void;
  onStatusObserved?: (status: HofObservedStatusResponse) => void;
  automationController: UnifiedAutomationController;
  partyPresetCatalog: PartyPresetCatalogResource;
  onCreatePartyPresetFolder?: (request: CreatePartyPresetFolderRequest) => Promise<PartyPresetCatalogResponse>;
  onRenamePartyPresetFolder?: (folderId: number, request: RenamePartyPresetFolderRequest) => Promise<PartyPresetCatalogResponse>;
  onReorderPartyPresetFolders?: (request: ReorderPartyPresetFoldersRequest) => Promise<PartyPresetCatalogResponse>;
  onMovePartyPresetFolder?: (folderId: number, request: MovePartyPresetFolderRequest) => Promise<PartyPresetCatalogResponse>;
  onDeletePartyPresetFolder?: (folderId: number) => Promise<PartyPresetCatalogResponse>;
  onCreatePartyPreset: (
    request: CreatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onUpdatePartyPreset: (
    presetId: number,
    request: UpdatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onMakePartyPresetPrimary: (presetId: number) => Promise<PartyPresetResponse>;
  onReorderPartyPresets: (request: ReorderPartyPresetsRequest) => Promise<PartyPresetResponse[]>;
  onDeletePartyPreset: (presetId: number) => Promise<null>;
  onLoadPattern: (hofCharacterId: string, slot: number) => Promise<LoadPatternResponse>;
  onLogout: () => void;
  characterDetailError: string | null;
  isCharacterDetailLoading: boolean;
  selectedCharacter: HofCharacter | null;
  selectedCharacterDetail: HofCharacterDetail | null;
  characterActions: CharacterObservedAction[];
  characterSubTabId: CharacterSubTabId;
  setCharacterSubTabId: (tabId: CharacterSubTabId) => void;
  setSelectedCharacter: (character: HofCharacter | null) => void;
  closeCharacterDetail: () => void;
  onExecuteCharacterAction: (request: CharacterManagementActionRequest) => Promise<CharacterManagementSnapshot>;
  onAutomationEditorModeChange: (active: boolean) => void;
  onDataLogModeChange: (active: boolean) => void;
  onTownDetailOpenChange: (open: boolean) => void;
  townApi?: TownApi;
  resolveCaptcha?: () => Promise<void>;
  onOpenFishingBattle: (target: FishingBattleTarget) => void;
  pendingBattleTarget: FishingBattleTarget | null;
  consumePendingBattleTarget: () => void;
};

/**
 * 현재 선택된 하단 탭에 맞는 실제 화면 컴포넌트를 선택한다.
 *
 * MainScreen이 가진 공통 상태와 API callback을 각 탭이 필요한 형태로 나누어 전달하는 라우터 역할을 한다.
 */
function renderActiveTab({
  activeTabId,
  authenticated,
  battleCategories,
  areBattleCategoriesLoaded,
  isBattleCategoriesLoading,
  battleCategoriesError,
  characters,
  characterSyncLabel,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onRunBattle,
  onLoadBattleLogs,
  onLoadBattleStats,
  onOpenCaptcha,
  onStatusObserved,
  automationController,
  partyPresetCatalog,
  onCreatePartyPresetFolder,
  onRenamePartyPresetFolder,
  onReorderPartyPresetFolders,
  onMovePartyPresetFolder,
  onDeletePartyPresetFolder,
  onCreatePartyPreset,
  onUpdatePartyPreset,
  onMakePartyPresetPrimary,
  onReorderPartyPresets,
  onDeletePartyPreset,
  onLoadPattern,
  onLogout,
  characterDetailError,
  isCharacterDetailLoading,
  selectedCharacter,
  selectedCharacterDetail,
  characterActions,
  characterSubTabId,
  setCharacterSubTabId,
  setSelectedCharacter,
  closeCharacterDetail,
  onExecuteCharacterAction,
  onAutomationEditorModeChange,
  onTownDetailOpenChange,
  townApi,
  resolveCaptcha,
  onOpenFishingBattle,
  pendingBattleTarget,
  consumePendingBattleTarget,
  onDataLogModeChange,
}: RenderActiveTabArgs) {
  switch (activeTabId) {
    case 'home':
      return (
        <HomeTabScreen
          authenticated={authenticated}
          battleCategories={battleCategories}
          areBattleCategoriesLoaded={areBattleCategoriesLoaded}
          isBattleCategoriesLoading={isBattleCategoriesLoading}
          battleCategoriesError={battleCategoriesError}
          onLoadBattleCategories={onLoadBattleCategories}
          onLoadBattleMaps={onLoadBattleMaps}
          partyPresetCatalog={partyPresetCatalog}
          automationController={automationController}
          onOpenCaptcha={onOpenCaptcha}
          onStatusObserved={onStatusObserved}
          onDetailModeChange={onAutomationEditorModeChange}
          townApi={townApi}
        />
      );
    case 'battle':
      return (
        <BattleTabScreen
          authenticated={authenticated}
          categories={battleCategories}
          isLoading={isBattleCategoriesLoading}
          errorMessage={battleCategoriesError}
          characters={characters}
          onLoadCategories={onLoadBattleCategories}
          onLoadMaps={onLoadBattleMaps}
          partyPresetCatalog={partyPresetCatalog}
          onRunBattle={onRunBattle}
          initialTarget={pendingBattleTarget}
          onInitialTargetConsumed={consumePendingBattleTarget}
        />
      );
    case 'characters':
      return selectedCharacter ? (
        <View style={[styles.tabPanel, styles.detailPanel]}>
          <CharacterDetailScroll>
            <CharacterDetail
              character={selectedCharacter}
              detail={selectedCharacterDetail}
              isLoading={isCharacterDetailLoading}
              errorMessage={characterDetailError}
              onLoadPattern={onLoadPattern}
              actions={characterActions}
              onExecuteAction={onExecuteCharacterAction}
              onBack={closeCharacterDetail}
            />
          </CharacterDetailScroll>
        </View>
      ) : (
        <View style={styles.tabPanel}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>캐릭터</Text>
            <View style={styles.sectionActions}>
              <Text style={styles.sectionMeta}>{characterSyncLabel ?? `${characters.length}명`}</Text>
            </View>
          </View>
          <View style={styles.characterSubTabs}>
            <CharacterSubTabButton
              active={characterSubTabId === 'characters'}
              label="캐릭터창"
              onPress={() => setCharacterSubTabId('characters')}
            />
            <CharacterSubTabButton
              active={characterSubTabId === 'presets'}
              label="프리셋"
              onPress={() => setCharacterSubTabId('presets')}
            />
          </View>
          {characterSubTabId === 'characters' ? (
            <CharacterList characters={characters} onSelectCharacter={setSelectedCharacter} />
          ) : (
            <PartyPresetList
              authenticated={authenticated}
              characters={characters}
              partyPresetCatalog={partyPresetCatalog}
              onCreatePartyPresetFolder={onCreatePartyPresetFolder}
              onRenamePartyPresetFolder={onRenamePartyPresetFolder}
              onReorderPartyPresetFolders={onReorderPartyPresetFolders}
              onMovePartyPresetFolder={onMovePartyPresetFolder}
              onDeletePartyPresetFolder={onDeletePartyPresetFolder}
              onCreatePartyPreset={onCreatePartyPreset}
              onUpdatePartyPreset={onUpdatePartyPreset}
              onMakePartyPresetPrimary={onMakePartyPresetPrimary}
              onReorderPartyPresets={onReorderPartyPresets}
              onDeletePartyPreset={onDeletePartyPreset}
            />
          )}
        </View>
      );
    case 'town':
      return (
        <TownTabScrollContainer
          townApi={townApi}
          resolveCaptcha={resolveCaptcha}
          onOpenFishingBattle={onOpenFishingBattle}
          characters={characters}
          partyPresetCatalog={partyPresetCatalog}
          onRunBattle={onRunBattle}
          onDetailOpenChange={onTownDetailOpenChange}
        />
      );
    case 'data':
      return (
        <DataTabScreen
          authenticated={authenticated}
          onLoadBattleLogs={onLoadBattleLogs}
          onLoadBattleStats={onLoadBattleStats}
          onFullScreenChange={onDataLogModeChange}
        />
      );
    case 'settings':
      return (
        <TabScrollContainer>
          <SettingsTabScreen
            authenticated={authenticated}
            onLogout={onLogout}
            onOpenCaptcha={onOpenCaptcha}
          />
        </TabScrollContainer>
      );
  }
}

/**
 * 캐릭터 탭 내부의 캐릭터창/프리셋 하위 탭 버튼이다.
 */
function CharacterSubTabButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.characterSubTabButton,
        active && styles.activeCharacterSubTabButton,
        pressed && styles.characterSubTabButtonPressed,
      ]}
    >
      <Text style={[styles.characterSubTabText, active && styles.activeCharacterSubTabText]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 로그인 상태 경고와 전역 안내 메시지를 화면 상단에 표시한다.
 *
 * 메시지가 없고 로그인도 정상이라면 null을 반환해서 빈 영역을 만들지 않는다.
 */
function renderSystemMessage(
  session: MainSession | null,
  notice: string | null,
  onOpenLogin: () => void,
) {
  const shouldShowNotice = notice != null && notice.length > 0;
  const shouldShowAuthPanel = !session?.loggedIn;
  if (!shouldShowNotice && !shouldShowAuthPanel) return null;

  return (
    <View style={styles.systemMessages}>
      {shouldShowNotice ? <Text style={styles.notice}>{notice}</Text> : null}

      {shouldShowAuthPanel ? (
        <View style={styles.authPanel}>
          <Text style={styles.authText}>저장 로그인 확인이 실패하면 로그인 화면에서 다시 시도하세요.</Text>
          <PrimaryButton label="로그인 화면" variant="secondary" onPress={onOpenLogin} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * 스크롤이 필요한 탭 화면에 공통 padding과 ScrollView 설정을 적용한다.
 */
function TabScrollContainer({ children }: { children: ReactNode }) {
  const scrollRef = useRef<ScrollView>(null);
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onFocus={(event) => scrollFocusedInputIntoView(scrollRef.current, event.nativeEvent.target)}
      ref={scrollRef}
      style={styles.tabScroller}
    >
      {children}
    </ScrollView>
  );
}

function CharacterDetailScroll({ children }: { children: ReactNode }) {
  const scrollRef = useRef<ScrollView>(null);
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.detailContainer}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onFocus={(event) => scrollFocusedInputIntoView(scrollRef.current, event.nativeEvent.target)}
      ref={scrollRef}
      style={styles.tabScroller}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
  },
  fullScreenContent: {
    backgroundColor: theme.colors.background,
  },
  tabScroller: {
    flex: 1,
  },
  tabPanel: {
    flex: 1,
    gap: 10,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
  },
  detailPanel: {
    gap: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  detailContainer: {
    paddingBottom: 0,
  },
  systemMessages: {
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
  notice: {
    color: theme.colors.text,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accentAmber,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    fontSize: 14,
    lineHeight: 20,
  },
  authPanel: {
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  authText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  sectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30,
  },
  sectionMeta: {
    color: theme.colors.accentGreen,
    fontSize: 15,
    fontWeight: '900',
  },
  characterSubTabs: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.header,
    padding: theme.spacing.xs,
  },
  characterSubTabButton: {
    minHeight: 34,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.sm,
  },
  activeCharacterSubTabButton: {
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surfaceAlt,
  },
  characterSubTabButtonPressed: {
    opacity: 0.82,
  },
  characterSubTabText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  activeCharacterSubTabText: {
    color: theme.colors.accentAmber,
  },
  settingsPanel: {
    gap: theme.spacing.lg,
  },
});
