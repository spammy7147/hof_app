import type { ElementRef, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NestableScrollContainer } from "react-native-draggable-flatlist";

import { BottomTabBar } from "../components/BottomTabBar";
import { FixedBottomActionHost } from "../components/FixedBottomAction";
import { scrollFocusedInputIntoView } from "../components/keyboardAwareScroll";
import { CharacterDetail } from "../components/CharacterDetail";
import { CharacterList } from "../components/CharacterList";
import { PartyPresetList } from "../components/PartyPresetList";
import { PrimaryButton } from "../components/PrimaryButton";
import {
  DEFAULT_MAIN_TAB_ID,
  MainRouteId,
} from "../domain/mainTabs";
import {
  PartyPresetCatalogModule,
  type PartyPresetCatalogResource,
} from "../domain/partyPresetCatalogModule";
import type { UnifiedAutomationController } from "../domain/unifiedAutomationController";
import { toUserFacingErrorMessage } from "../domain/userFacingErrors";
import { theme } from "../styles/theme";
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
  CharacterCommand,
  CharacterCommandResult,
  CharacterPatternApplyRequest,
  CharacterPatternOperationResult,
  CharacterTransferExecutionResult,
  CharacterTransferPreview,
  CharacterTransferPreviewRequest,
  CharacterSyncJobResponse,
  CharacterDeepSyncResponse,
  HofCharacter,
  HofCharacterDetail,
  HofObservedStatusResponse,
  HofStatusResponse,
  MovePartyPresetFolderRequest,
  PartyPresetCatalogResponse,
  PartyPresetResponse,
  RenamePartyPresetFolderRequest,
  ReorderPartyPresetFoldersRequest,
  ReorderPartyPresetsRequest,
  RunBattleRequest,
  UpdatePartyPresetRequest,
} from "../types/api";
import { BattleTabScreen } from "./BattleTabScreen";
import { DataTabScreen } from "./DataTabScreen";
import { HomeTabScreen } from "./HomeTabScreen";
import { SettingsTabScreen } from "./SettingsTabScreen";
import { TownTabScrollContainer } from "./TownTabScrollContainer";
import type { TownApi } from "../features/town/api/townApi";

const CHARACTER_DETAIL_STALE_MS = 30 * 60 * 1000;

type MainSession = {
  loggedIn: boolean;
};

type CharacterSubTabId = "characters" | "presets";

type MainScreenProps = {
  session: MainSession | null;
  status: HofStatusResponse | null;
  battleCategories: BattleCategoryResponse[];
  areBattleCategoriesLoaded: boolean;
  isBattleCategoriesLoading: boolean;
  battleCategoriesError: string | null;
  characters: HofCharacter[];
  characterSyncLabel: string | null;
  characterSyncJob?: CharacterSyncJobResponse | null;
  onSyncCharacterRoster?: () => Promise<void>;
  onStartCharacterFullSync?: () => Promise<void>;
  onStopCharacterSync?: () => Promise<void>;
  onResumeCharacterSync?: () => Promise<void>;
  notice: string | null;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onRunBattle: (request: RunBattleRequest) => Promise<BattleResultResponse>;
  onLoadBattleLogs: (query?: BattleLogQuery) => Promise<BattleLogResponse[]>;
  onLoadBattleStats: (
    period?: AdventureMapStatsPeriod,
  ) => Promise<BattleStatsResponse>;
  onOpenCaptcha: () => void;
  onStatusObserved?: (status: HofObservedStatusResponse) => void;
  automationController: UnifiedAutomationController;
  onGetPartyPresetCatalog: () => Promise<PartyPresetCatalogResponse>;
  onCreatePartyPresetFolder?: (
    request: CreatePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  onRenamePartyPresetFolder?: (
    folderId: number,
    request: RenamePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  onReorderPartyPresetFolders?: (
    request: ReorderPartyPresetFoldersRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  onMovePartyPresetFolder?: (
    folderId: number,
    request: MovePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  onDeletePartyPresetFolder?: (
    folderId: number,
  ) => Promise<PartyPresetCatalogResponse>;
  onCreatePartyPreset: (
    request: CreatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onUpdatePartyPreset: (
    presetId: number,
    request: UpdatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onMakePartyPresetPrimary: (presetId: number) => Promise<PartyPresetResponse>;
  onReorderPartyPresets: (
    request: ReorderPartyPresetsRequest,
  ) => Promise<PartyPresetResponse[]>;
  onDeletePartyPreset: (presetId: number) => Promise<null>;
  onLoadCharacterDetail: (characterId: number) => Promise<HofCharacterDetail>;
  onExecuteCharacterCommand?: (
    command: CharacterCommand,
  ) => Promise<CharacterCommandResult>;
  onApplyCharacterPattern?: (
    request: CharacterPatternApplyRequest,
  ) => Promise<CharacterPatternOperationResult>;
  onLoadSavedCharacterPattern?: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  onDeleteSavedCharacterPattern?: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  onRefreshCharacterDetail?: (
    characterId: number,
  ) => Promise<HofCharacterDetail>;
  onDeepSyncCharacter?: (
    characterId: number,
    onProgress?: (progress: CharacterDeepSyncResponse) => void,
  ) => Promise<CharacterDeepSyncResponse>;
  onArchiveCharacter?: (characterId: number) => Promise<void>;
  onRestoreCharacter?: (characterId: number) => Promise<void>;
  onDeleteCharacterPermanently?: (characterId: number) => Promise<void>;
  onLinkCharacter?: (
    characterId: number,
    newHofCharacterId: string,
  ) => Promise<void>;
  onPreviewCharacterTransfer?: (
    request: CharacterTransferPreviewRequest,
  ) => Promise<CharacterTransferPreview>;
  onExecuteCharacterTransfer?: (
    request: CharacterTransferPreviewRequest,
    onProgress?: (progress: CharacterTransferExecutionResult) => void,
  ) => Promise<CharacterTransferExecutionResult>;
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
  characterSyncJob,
  onSyncCharacterRoster,
  onStartCharacterFullSync,
  onStopCharacterSync,
  onResumeCharacterSync,
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
  onExecuteCharacterCommand,
  onApplyCharacterPattern,
  onLoadSavedCharacterPattern,
  onDeleteSavedCharacterPattern,
  onRefreshCharacterDetail,
  onDeepSyncCharacter,
  onArchiveCharacter,
  onRestoreCharacter,
  onDeleteCharacterPermanently,
  onLinkCharacter,
  onPreviewCharacterTransfer,
  onExecuteCharacterTransfer,
  onLogout,
  onOpenLogin,
  townApi,
  resolveCaptcha,
}: MainScreenProps) {
  const authenticated = Boolean(session?.loggedIn);
  const partyPresetCatalogModule = useMemo(
    () =>
      new PartyPresetCatalogModule({
        loadCatalog: onGetPartyPresetCatalog,
        createPreset: onCreatePartyPreset,
        updatePreset: onUpdatePartyPreset,
      }),
    [onCreatePartyPreset, onGetPartyPresetCatalog, onUpdatePartyPreset],
  );
  const partyPresetAccountKeyRef = useRef({});
  const partyPresetCatalogResource = useSyncExternalStore(
    partyPresetCatalogModule.subscribe,
    partyPresetCatalogModule.getSnapshot,
    partyPresetCatalogModule.getSnapshot,
  );

  useLayoutEffect(() => {
    if (!authenticated) {
      partyPresetCatalogModule.deactivate();
      return;
    }
    void partyPresetCatalogModule.activate(partyPresetAccountKeyRef.current);
    return () => partyPresetCatalogModule.deactivate();
  }, [authenticated, partyPresetCatalogModule]);

  const createPreset = useCallback(
    (request: CreatePartyPresetRequest) =>
      partyPresetCatalogModule.createPreset(request),
    [partyPresetCatalogModule],
  );
  const updatePreset = useCallback(
    (presetId: number, request: UpdatePartyPresetRequest) =>
      partyPresetCatalogModule.updatePreset(presetId, request),
    [partyPresetCatalogModule],
  );
  const makePresetPrimary = useCallback(
    (presetId: number) =>
      partyPresetCatalogModule.runCompatibilityMutation(
        () => onMakePartyPresetPrimary(presetId),
        (catalog, updated) => ({
          ...catalog,
          presets: catalog.presets.map((preset) =>
            preset.id === updated.id
              ? { ...updated, isPrimary: true }
              : { ...preset, isPrimary: false },
          ),
        }),
      ),
    [onMakePartyPresetPrimary, partyPresetCatalogModule],
  );
  const reorderPresets = useCallback(
    (request: ReorderPartyPresetsRequest) =>
      partyPresetCatalogModule.runCompatibilityMutation(
        () => onReorderPartyPresets(request),
        (catalog, presets) => mergePresetMutationResponse(catalog, presets),
      ),
    [onReorderPartyPresets, partyPresetCatalogModule],
  );
  const deletePreset = useCallback(
    (presetId: number) =>
      partyPresetCatalogModule.runCompatibilityMutation(
        () => onDeletePartyPreset(presetId),
        (catalog) => ({
          ...catalog,
          presets: catalog.presets.filter((preset) => preset.id !== presetId),
        }),
      ),
    [onDeletePartyPreset, partyPresetCatalogModule],
  );
  const createPresetFolder = useCallback(
    (request: CreatePartyPresetFolderRequest) => {
      if (!onCreatePartyPresetFolder)
        throw new Error("폴더 만들기를 사용할 수 없습니다.");
      return partyPresetCatalogModule.runCompatibilityMutation(
        () => onCreatePartyPresetFolder(request),
        (_, catalog) => catalog,
        false,
      );
    },
    [onCreatePartyPresetFolder, partyPresetCatalogModule],
  );
  const renamePresetFolder = useCallback(
    (folderId: number, request: RenamePartyPresetFolderRequest) => {
      if (!onRenamePartyPresetFolder)
        throw new Error("폴더 이름 변경을 사용할 수 없습니다.");
      return partyPresetCatalogModule.runCompatibilityMutation(
        () => onRenamePartyPresetFolder(folderId, request),
        (_, catalog) => catalog,
        false,
      );
    },
    [onRenamePartyPresetFolder, partyPresetCatalogModule],
  );
  const reorderPresetFolders = useCallback(
    (request: ReorderPartyPresetFoldersRequest) => {
      if (!onReorderPartyPresetFolders)
        throw new Error("폴더 순서 변경을 사용할 수 없습니다.");
      return partyPresetCatalogModule.runCompatibilityMutation(
        () => onReorderPartyPresetFolders(request),
        (_, catalog) => catalog,
        false,
      );
    },
    [onReorderPartyPresetFolders, partyPresetCatalogModule],
  );
  const movePresetFolder = useCallback(
    (folderId: number, request: MovePartyPresetFolderRequest) => {
      if (!onMovePartyPresetFolder)
        throw new Error("폴더 이동을 사용할 수 없습니다.");
      return partyPresetCatalogModule.runCompatibilityMutation(
        () => onMovePartyPresetFolder(folderId, request),
        (_, catalog) => catalog,
        false,
      );
    },
    [onMovePartyPresetFolder, partyPresetCatalogModule],
  );
  const deletePresetFolder = useCallback(
    (folderId: number) => {
      if (!onDeletePartyPresetFolder)
        throw new Error("폴더 삭제를 사용할 수 없습니다.");
      return partyPresetCatalogModule.runCompatibilityMutation(
        () => onDeletePartyPresetFolder(folderId),
        (_, catalog) => catalog,
        false,
      );
    },
    [onDeletePartyPresetFolder, partyPresetCatalogModule],
  );
  const [activeTabId, setActiveTabId] =
    useState<MainRouteId>(DEFAULT_MAIN_TAB_ID);
  const [pendingBattleTarget, setPendingBattleTarget] =
    useState<FishingBattleTarget | null>(null);
  const consumePendingBattleTarget = useCallback(
    () => setPendingBattleTarget(null),
    [],
  );
  const [characterSubTabId, setCharacterSubTabId] =
    useState<CharacterSubTabId>("characters");
  const [selectedCharacter, setSelectedCharacter] =
    useState<HofCharacter | null>(null);
  const [selectedCharacterDetail, setSelectedCharacterDetail] =
    useState<HofCharacterDetail | null>(null);
  const [transferSourceCharacterId, setTransferSourceCharacterId] = useState<
    number | null
  >(null);
  const [isCharacterDetailLoading, setIsCharacterDetailLoading] =
    useState(false);
  const [characterDetailError, setCharacterDetailError] = useState<
    string | null
  >(null);
  const [automationEditorOpen, setAutomationEditorOpen] = useState(false);
  const [dataLogOpen, setDataLogOpen] = useState(false);
  const [townDetailOpen, setTownDetailOpen] = useState(false);
  const isCharacterDetailOpen =
    activeTabId === "characters" && selectedCharacter != null;
  const townDetailFullScreen = activeTabId === "town" && townDetailOpen;
  const showBottomTabs =
    activeTabId !== "settings" &&
    !automationEditorOpen &&
    !dataLogOpen &&
    !townDetailFullScreen &&
    !isCharacterDetailOpen;

  /**
   * SSE 동기화로 characters 배열이 갱신되면 현재 선택된 캐릭터 객체도 최신 값으로 교체한다.
   *
   * 같은 hofCharacterId를 더 이상 찾지 못하면 동기화 중 사라진 캐릭터로 보고 상세 화면을 닫는다.
   */
  useEffect(() => {
    if (!selectedCharacter) return;
    const refreshedCharacter = characters.find(
      (character) => character.id === selectedCharacter.id,
    );
    setSelectedCharacter(
      refreshedCharacter &&
        (refreshedCharacter.lifecycle ?? "ACTIVE") === "ACTIVE"
        ? refreshedCharacter
        : null,
    );
  }, [characters, selectedCharacter?.id]);

  /**
   * 캐릭터 상세 화면에서 선택 캐릭터의 상세 정보를 불러온다.
   *
   * 사용자가 빠르게 다른 캐릭터로 이동해도 이전 요청 결과가 늦게 도착해 화면을 덮어쓰지 않도록 cancelled 플래그를 사용한다.
   */
  useEffect(() => {
    if (!selectedCharacter || !session?.loggedIn) {
      setSelectedCharacterDetail(null);
      setIsCharacterDetailLoading(false);
      setCharacterDetailError(null);
      return;
    }

    let cancelled = false;
    setSelectedCharacterDetail(null);
    setIsCharacterDetailLoading(true);
    setCharacterDetailError(null);

    onLoadCharacterDetail(selectedCharacter.id)
      .then((character) => {
        if (!cancelled) {
          setSelectedCharacterDetail(character);
          const syncedAt = character.detailSyncedAt
            ? new Date(character.detailSyncedAt).getTime()
            : 0;
          if (
            onRefreshCharacterDetail &&
            Date.now() - syncedAt >= CHARACTER_DETAIL_STALE_MS
          ) {
            void onRefreshCharacterDetail(character.id)
              .then((refreshed) => {
                if (!cancelled) setSelectedCharacterDetail(refreshed);
              })
              .catch(() => undefined);
          }
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
  }, [
    onLoadCharacterDetail,
    onRefreshCharacterDetail,
    selectedCharacter?.id,
    session?.loggedIn,
  ]);

  async function handleTypedCharacterCommand(
    command: CharacterCommand,
  ): Promise<CharacterCommandResult | void> {
    if (!selectedCharacter || !onExecuteCharacterCommand) return undefined;
    const result = await onExecuteCharacterCommand(command);
    setSelectedCharacterDetail(
      await onLoadCharacterDetail(selectedCharacter.id),
    );
    return result;
  }

  async function handleTypedPattern(
    request: CharacterPatternApplyRequest,
  ): Promise<CharacterPatternOperationResult> {
    if (!selectedCharacter || !onApplyCharacterPattern) return {};
    const result = await onApplyCharacterPattern(request);
    const conflicted =
      result.currentRevision != null || (result.rowDiffs?.length ?? 0) > 0;
    if (!conflicted) {
      setSelectedCharacterDetail(
        await onLoadCharacterDetail(selectedCharacter.id),
      );
    }
    return result;
  }
  async function handleLoadSavedPattern(characterId: number, slotCode: string) {
    if (!onLoadSavedCharacterPattern) return {};
    const result = await onLoadSavedCharacterPattern(characterId, slotCode);
    setSelectedCharacterDetail(await onLoadCharacterDetail(characterId));
    return result;
  }
  async function handleDeleteSavedPattern(
    characterId: number,
    slotCode: string,
  ) {
    if (!onDeleteSavedCharacterPattern) return {};
    const result = await onDeleteSavedCharacterPattern(characterId, slotCode);
    setSelectedCharacterDetail(await onLoadCharacterDetail(characterId));
    return result;
  }

  async function handleCharacterRefresh(): Promise<void> {
    if (!selectedCharacter) return;
    const refreshed = onRefreshCharacterDetail
      ? await onRefreshCharacterDetail(selectedCharacter.id)
      : await onLoadCharacterDetail(selectedCharacter.id);
    setSelectedCharacterDetail(refreshed);
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View
        accessibilityLabel={
          townDetailFullScreen
            ? "마을 상세 전체 화면"
            : isCharacterDetailOpen
              ? "캐릭터 상세 전체 화면"
              : undefined
        }
        style={[
          styles.content,
          (townDetailFullScreen || isCharacterDetailOpen) &&
            styles.fullScreenContent,
        ]}
      >
        <FixedBottomActionHost>
          {renderSystemMessage(session, notice, onOpenLogin)}
          {renderActiveTab({
          activeTabId,
          status,
          authenticated: session?.loggedIn === true,
          battleCategories,
          areBattleCategoriesLoaded,
          isBattleCategoriesLoading,
          battleCategoriesError,
          characters,
          characterSyncLabel,
          characterSyncJob,
          onSyncCharacterRoster,
          onStartCharacterFullSync,
          onStopCharacterSync,
          onResumeCharacterSync,
          onLoadBattleCategories,
          onLoadBattleMaps,
          onRunBattle,
          onLoadBattleLogs,
          onLoadBattleStats,
          onOpenCaptcha,
          onOpenAppSettings: () => setActiveTabId("settings"),
          onCloseAppSettings: () => setActiveTabId("home"),
          onStatusObserved,
          automationController,
          partyPresetCatalog: partyPresetCatalogResource,
          onCreatePartyPresetFolder: onCreatePartyPresetFolder
            ? createPresetFolder
            : undefined,
          onRenamePartyPresetFolder: onRenamePartyPresetFolder
            ? renamePresetFolder
            : undefined,
          onReorderPartyPresetFolders: onReorderPartyPresetFolders
            ? reorderPresetFolders
            : undefined,
          onMovePartyPresetFolder: onMovePartyPresetFolder
            ? movePresetFolder
            : undefined,
          onDeletePartyPresetFolder: onDeletePartyPresetFolder
            ? deletePresetFolder
            : undefined,
          onCreatePartyPreset: createPreset,
          onUpdatePartyPreset: updatePreset,
          onMakePartyPresetPrimary: makePresetPrimary,
          onReorderPartyPresets: reorderPresets,
          onDeletePartyPreset: deletePreset,
          onLogout,
          characterDetailError,
          isCharacterDetailLoading,
          selectedCharacter,
          selectedCharacterDetail,
          characterSubTabId,
          setCharacterSubTabId,
          setSelectedCharacter: (character) => {
            setTransferSourceCharacterId(null);
            setSelectedCharacter(character);
          },
          transferSourceCharacterId,
          onCopyCharacterSettings: (source, target) => {
            setTransferSourceCharacterId(source.id);
            setSelectedCharacter(target);
          },
          closeCharacterDetail: () => {
            setTransferSourceCharacterId(null);
            setSelectedCharacter(null);
          },
          onExecuteCharacterCommand: handleTypedCharacterCommand,
          onApplyCharacterPattern: handleTypedPattern,
          onLoadSavedCharacterPattern: handleLoadSavedPattern,
          onDeleteSavedCharacterPattern: handleDeleteSavedPattern,
          onRefreshCharacterDetail: handleCharacterRefresh,
          onDeepSyncCharacter,
          onArchiveCharacter,
          onRestoreCharacter,
          onDeleteCharacterPermanently,
          onLinkCharacter,
          onPreviewCharacterTransfer,
          onExecuteCharacterTransfer,
          townApi,
          resolveCaptcha,
          pendingBattleTarget,
          consumePendingBattleTarget,
          onOpenFishingBattle: (target) => {
            setPendingBattleTarget(target);
            setActiveTabId("battle");
          },
          onAutomationEditorModeChange: setAutomationEditorOpen,
          onDataLogModeChange: setDataLogOpen,
          onTownDetailOpenChange: setTownDetailOpen,
          })}
        </FixedBottomActionHost>
      </View>

      {showBottomTabs ? (
        <BottomTabBar activeTabId={activeTabId} onChangeTab={setActiveTabId} />
      ) : null}
    </SafeAreaView>
  );
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

type RenderActiveTabArgs = {
  activeTabId: MainRouteId;
  status: HofStatusResponse | null;
  authenticated: boolean;
  battleCategories: BattleCategoryResponse[];
  areBattleCategoriesLoaded: boolean;
  isBattleCategoriesLoading: boolean;
  battleCategoriesError: string | null;
  characters: HofCharacter[];
  characterSyncLabel: string | null;
  characterSyncJob?: CharacterSyncJobResponse | null;
  onSyncCharacterRoster?: () => Promise<void>;
  onStartCharacterFullSync?: () => Promise<void>;
  onStopCharacterSync?: () => Promise<void>;
  onResumeCharacterSync?: () => Promise<void>;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onRunBattle: (request: RunBattleRequest) => Promise<BattleResultResponse>;
  onLoadBattleLogs: (query?: BattleLogQuery) => Promise<BattleLogResponse[]>;
  onLoadBattleStats: (
    period?: AdventureMapStatsPeriod,
  ) => Promise<BattleStatsResponse>;
  onOpenCaptcha: () => void;
  onOpenAppSettings: () => void;
  onCloseAppSettings: () => void;
  onStatusObserved?: (status: HofObservedStatusResponse) => void;
  automationController: UnifiedAutomationController;
  partyPresetCatalog: PartyPresetCatalogResource;
  onCreatePartyPresetFolder?: (
    request: CreatePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  onRenamePartyPresetFolder?: (
    folderId: number,
    request: RenamePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  onReorderPartyPresetFolders?: (
    request: ReorderPartyPresetFoldersRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  onMovePartyPresetFolder?: (
    folderId: number,
    request: MovePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  onDeletePartyPresetFolder?: (
    folderId: number,
  ) => Promise<PartyPresetCatalogResponse>;
  onCreatePartyPreset: (
    request: CreatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onUpdatePartyPreset: (
    presetId: number,
    request: UpdatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onMakePartyPresetPrimary: (presetId: number) => Promise<PartyPresetResponse>;
  onReorderPartyPresets: (
    request: ReorderPartyPresetsRequest,
  ) => Promise<PartyPresetResponse[]>;
  onDeletePartyPreset: (presetId: number) => Promise<null>;
  onLogout: () => void;
  characterDetailError: string | null;
  isCharacterDetailLoading: boolean;
  selectedCharacter: HofCharacter | null;
  selectedCharacterDetail: HofCharacterDetail | null;
  characterSubTabId: CharacterSubTabId;
  setCharacterSubTabId: (tabId: CharacterSubTabId) => void;
  setSelectedCharacter: (character: HofCharacter | null) => void;
  transferSourceCharacterId: number | null;
  onCopyCharacterSettings: (source: HofCharacter, target: HofCharacter) => void;
  closeCharacterDetail: () => void;
  onExecuteCharacterCommand: (
    command: CharacterCommand,
  ) => Promise<CharacterCommandResult | void>;
  onApplyCharacterPattern: (
    request: CharacterPatternApplyRequest,
  ) => Promise<CharacterPatternOperationResult>;
  onLoadSavedCharacterPattern: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  onDeleteSavedCharacterPattern: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  onRefreshCharacterDetail: () => Promise<void>;
  onDeepSyncCharacter?: (
    characterId: number,
    onProgress?: (progress: CharacterDeepSyncResponse) => void,
  ) => Promise<CharacterDeepSyncResponse>;
  onArchiveCharacter?: (characterId: number) => Promise<void>;
  onRestoreCharacter?: (characterId: number) => Promise<void>;
  onDeleteCharacterPermanently?: (characterId: number) => Promise<void>;
  onLinkCharacter?: (
    characterId: number,
    newHofCharacterId: string,
  ) => Promise<void>;
  onPreviewCharacterTransfer?: (
    request: CharacterTransferPreviewRequest,
  ) => Promise<CharacterTransferPreview>;
  onExecuteCharacterTransfer?: (
    request: CharacterTransferPreviewRequest,
    onProgress?: (progress: CharacterTransferExecutionResult) => void,
  ) => Promise<CharacterTransferExecutionResult>;
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
  status,
  authenticated,
  battleCategories,
  areBattleCategoriesLoaded,
  isBattleCategoriesLoading,
  battleCategoriesError,
  characters,
  characterSyncLabel,
  characterSyncJob,
  onSyncCharacterRoster,
  onStartCharacterFullSync,
  onStopCharacterSync,
  onResumeCharacterSync,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onRunBattle,
  onLoadBattleLogs,
  onLoadBattleStats,
  onOpenCaptcha,
  onOpenAppSettings,
  onCloseAppSettings,
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
  onLogout,
  characterDetailError,
  isCharacterDetailLoading,
  selectedCharacter,
  selectedCharacterDetail,
  characterSubTabId,
  setCharacterSubTabId,
  setSelectedCharacter,
  transferSourceCharacterId,
  onCopyCharacterSettings,
  closeCharacterDetail,
  onExecuteCharacterCommand,
  onApplyCharacterPattern,
  onLoadSavedCharacterPattern,
  onDeleteSavedCharacterPattern,
  onRefreshCharacterDetail,
  onDeepSyncCharacter,
  onArchiveCharacter,
  onRestoreCharacter,
  onDeleteCharacterPermanently,
  onLinkCharacter,
  onPreviewCharacterTransfer,
  onExecuteCharacterTransfer,
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
    case "home":
      return (
        <HomeTabScreen
          authenticated={authenticated}
          status={status}
          battleCategories={battleCategories}
          areBattleCategoriesLoaded={areBattleCategoriesLoaded}
          isBattleCategoriesLoading={isBattleCategoriesLoading}
          battleCategoriesError={battleCategoriesError}
          onLoadBattleCategories={onLoadBattleCategories}
          onLoadBattleMaps={onLoadBattleMaps}
          partyPresetCatalog={partyPresetCatalog}
          automationController={automationController}
          onOpenCaptcha={onOpenCaptcha}
          onOpenAppSettings={onOpenAppSettings}
          onStatusObserved={onStatusObserved}
          onDetailModeChange={onAutomationEditorModeChange}
          townApi={townApi}
        />
      );
    case "battle":
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
    case "characters":
      return selectedCharacter ? (
        <View style={[styles.tabPanel, styles.detailPanel]}>
          <CharacterDetailScroll>
            <CharacterDetail
              character={selectedCharacter}
              detail={selectedCharacterDetail}
              isLoading={isCharacterDetailLoading}
              errorMessage={characterDetailError}
              onCommand={onExecuteCharacterCommand}
              onApplyPattern={onApplyCharacterPattern}
              onLoadSavedPattern={onLoadSavedCharacterPattern}
              onDeleteSavedPattern={onDeleteSavedCharacterPattern}
              onRefresh={onRefreshCharacterDetail}
              onDeepSync={onDeepSyncCharacter}
              onBeginPatternEdit={() =>
                automationController.changeState("pause")
              }
              onLinkCharacter={onLinkCharacter}
              characters={characters}
              onPreviewTransfer={onPreviewCharacterTransfer}
              onExecuteTransfer={onExecuteCharacterTransfer}
              initialTransferSourceId={transferSourceCharacterId}
              onBack={closeCharacterDetail}
            />
          </CharacterDetailScroll>
        </View>
      ) : (
        <View style={styles.tabPanel}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>캐릭터</Text>
            <View style={styles.sectionActions}>
              <Text style={styles.sectionMeta}>
                {characterSyncLabel ?? `${characters.length}명`}
              </Text>
              {characterSyncLabel == null &&
                characterSyncJob?.status !== "running" &&
                characterSyncJob?.status !== "pending" &&
                characterSyncJob?.status !== "stopped" &&
                onSyncCharacterRoster && (
                  <Pressable
                    accessibilityLabel="캐릭터 목록 동기화"
                    accessibilityRole="button"
                    onPress={() => void onSyncCharacterRoster()}
                    style={styles.syncControl}
                  >
                    <Text style={styles.syncControlText}>목록 동기화</Text>
                  </Pressable>
                )}
              {characterSyncLabel == null &&
                characterSyncJob?.status !== "running" &&
                characterSyncJob?.status !== "pending" &&
                characterSyncJob?.status !== "stopped" &&
                onStartCharacterFullSync && (
                  <Pressable
                    accessibilityLabel="전체 캐릭터 상세 동기화"
                    accessibilityRole="button"
                    onPress={() => void onStartCharacterFullSync()}
                    style={[styles.syncControl, styles.syncControlPrimary]}
                  >
                    <Text
                      style={[
                        styles.syncControlText,
                        styles.syncControlPrimaryText,
                      ]}
                    >
                      전체 상세 동기화
                    </Text>
                  </Pressable>
                )}
              {(characterSyncJob?.status === "running" ||
                characterSyncJob?.status === "pending") && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void onStopCharacterSync?.()}
                  style={styles.syncControl}
                >
                  <Text style={styles.syncControlText}>
                    현재 캐릭터 후 중지
                  </Text>
                </Pressable>
              )}
              {characterSyncJob?.status === "stopped" && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void onResumeCharacterSync?.()}
                  style={styles.syncControl}
                >
                  <Text style={styles.syncControlText}>이어하기</Text>
                </Pressable>
              )}
            </View>
          </View>
          <View style={styles.characterSubTabs}>
            <CharacterSubTabButton
              active={characterSubTabId === "characters"}
              label="캐릭터창"
              onPress={() => setCharacterSubTabId("characters")}
            />
            <CharacterSubTabButton
              active={characterSubTabId === "presets"}
              label="프리셋"
              onPress={() => setCharacterSubTabId("presets")}
            />
          </View>
          {characterSubTabId === "characters" ? (
            <CharacterList
              characters={characters}
              onSelectCharacter={setSelectedCharacter}
              onArchiveCharacter={onArchiveCharacter}
              onRestoreCharacter={onRestoreCharacter}
              onDeleteCharacterPermanently={onDeleteCharacterPermanently}
              onLinkCharacter={onLinkCharacter}
              onCopySettings={onCopyCharacterSettings}
            />
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
    case "town":
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
    case "data":
      return (
        <DataTabScreen
          authenticated={authenticated}
          onLoadBattleLogs={onLoadBattleLogs}
          onLoadBattleStats={onLoadBattleStats}
          onFullScreenChange={onDataLogModeChange}
        />
      );
    case "settings":
      return (
        <TabScrollContainer>
          <SettingsTabScreen
            authenticated={authenticated}
            onBack={onCloseAppSettings}
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
      <Text
        style={[
          styles.characterSubTabText,
          active && styles.activeCharacterSubTabText,
        ]}
      >
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
          <Text style={styles.authText}>
            저장 로그인 확인이 실패하면 로그인 화면에서 다시 시도하세요.
          </Text>
          <PrimaryButton
            label="로그인 화면"
            variant="secondary"
            onPress={onOpenLogin}
          />
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
      onFocus={(event) =>
        scrollFocusedInputIntoView(scrollRef.current, event.nativeEvent.target)
      }
      ref={scrollRef}
      style={styles.tabScroller}
    >
      {children}
    </ScrollView>
  );
}

function CharacterDetailScroll({ children }: { children: ReactNode }) {
  const scrollRef = useRef<ElementRef<typeof NestableScrollContainer>>(null);
  return (
    <NestableScrollContainer
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.detailContainer}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onFocus={(event) =>
        scrollFocusedInputIntoView(scrollRef.current, event.nativeEvent.target)
      }
      ref={scrollRef}
      style={styles.tabScroller}
    >
      {children}
    </NestableScrollContainer>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  sectionActions: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 30,
  },
  sectionMeta: {
    color: theme.colors.accentGreen,
    fontSize: 15,
    fontWeight: "900",
  },
  syncControl: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: theme.colors.surfaceAlt,
  },
  syncControlText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  syncControlPrimary: {
    backgroundColor: theme.colors.accentGreen,
  },
  syncControlPrimaryText: {
    color: theme.colors.buttonText,
  },
  characterSubTabs: {
    flexDirection: "row",
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
    alignItems: "center",
    justifyContent: "center",
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
    fontWeight: "900",
  },
  activeCharacterSubTabText: {
    color: theme.colors.accentAmber,
  },
  settingsPanel: {
    gap: theme.spacing.lg,
  },
});
