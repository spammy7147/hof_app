import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { LoginScreen } from "./screens/LoginScreen";
import { MainScreen } from "./screens/MainScreen";
import { AppProviders } from "./components/AppProviders";
import { CaptchaChallengeModal } from "./components/CaptchaChallengeModal";
import { BackendApiClient } from "./services/backendApi";
import { getAppBackendApiClient } from "./services/appRuntime";
import { useCharacterSync } from "./features/characters/useCharacterSync";
import { useCaptchaGate } from "./features/captcha/useCaptchaGate";
import { useCaptchaPassMaintenance } from "./features/captcha/useCaptchaPassMaintenance";
import { useAndroidPushRegistration } from "./features/push/useAndroidPushRegistration";
import { RequiredUpdateGate } from "./features/update/RequiredUpdateGate";
import { isCaptchaRequiredError } from "./domain/captchaGate";
import { canOpenManualPassChallenge, captchaPassWarning } from "./domain/captchaPassMaintenance";
import { mergeObservedHofStatus } from "./domain/hofStatus";
import { UnifiedAutomationController } from "./domain/unifiedAutomationController";
import { toUserFacingErrorMessage } from "./domain/userFacingErrors";
import type {
  BattleCategoryResponse,
  BattleLogResponse,
  BattleLogQuery,
  BattleMapResponse,
  BattleResultResponse,
  BattleStatsResponse,
  AdventureMapStatsPeriod,
  HofStatusResponse,
  HofObservedStatusResponse,
  RunBattleRequest,
} from "./types/api";
import { theme } from "./styles/theme";
import { createTownApi } from "./features/town/api/townApi";
import { loadPartyPresetPatterns } from "./features/partyPresets/loadPartyPresetPatterns";
import { usePartyPresetCatalog } from "./features/partyPresets/usePartyPresetCatalog";
import { useCharacterManagementHub } from "./features/characters/useCharacterManagementHub";
import { useAppSessionLifecycle } from "./features/auth/useAppSessionLifecycle";
import {
  useAuthenticatedBootstrap,
  type BootstrapResource,
} from "./features/auth/useAuthenticatedBootstrap";

type AppSession = {
  loggedIn: boolean;
  generation: number;
};

/**
 * 앱 전체의 최상위 컴포넌트다.
 *
 * 로그인, Refresh Token 세션 복원, 상태바 데이터, 캐릭터 SSE 동기화,
 * 전투 중 캡차 모달 같은 전역 흐름을 여기에서 조립한다.
 */
export default function App() {
  const api = getAppBackendApiClient();
  return (
    <AppProviders style={styles.container}>
      <RequiredUpdateGate api={api}>
        <AppContent api={api} />
      </RequiredUpdateGate>
    </AppProviders>
  );
}

function AppContent({ api }: { api: BackendApiClient }) {
  const sessionLifecycle = useAppSessionLifecycle(api);
  const state = sessionLifecycle.state;
  const activeGeneration = state.kind === "AUTHENTICATED"
    ? state.generation
    : state.kind === "RECOVERY_WAITING"
      ? state.generation
      : null;

  let content: ReactNode;
  if (activeGeneration != null) {
    content = (
      <AuthenticatedApp
        api={api}
        generation={activeGeneration}
        key={activeGeneration}
        onAccountSwitch={sessionLifecycle.endForAccountSwitch}
        onLogout={sessionLifecycle.logout}
      />
    );
  } else if (state.kind === "UNAUTHENTICATED" || state.kind === "AUTHENTICATING") {
    content = (
      <LoginScreen
        errorMessage={state.kind === "UNAUTHENTICATED" && state.errorMessage
          ? toUserFacingErrorMessage(state.errorMessage)
          : null}
        isSubmitting={state.kind === "AUTHENTICATING"}
        onSubmit={sessionLifecycle.login}
      />
    );
  } else {
    content = (
      <View style={styles.bootContainer}>
        <ActivityIndicator color={theme.colors.accentGreen} />
        <Text style={styles.bootText}>
          {state.kind === "ENDING" ? "로그인 정리 중" : "로그인 상태 확인 중"}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {content}
      {state.kind === "RECOVERY_WAITING" ? (
        <SessionRecoveryOverlay
          errorMessage={toUserFacingErrorMessage(state.errorMessage)}
          onRetry={sessionLifecycle.retryRecovery}
          retryDelaySeconds={state.retryDelaySeconds}
        />
      ) : null}
      {activeGeneration == null ? <StatusBar style="light" /> : null}
    </View>
  );
}

function SessionRecoveryOverlay({
  errorMessage,
  retryDelaySeconds,
  onRetry,
}: {
  errorMessage: string;
  retryDelaySeconds: number;
  onRetry: () => Promise<void>;
}) {
  return (
    <View
      accessibilityLabel="로그인 상태 복구 중"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={styles.sessionRecoveryOverlay}
    >
      <View style={styles.sessionRecoveryCard}>
        <ActivityIndicator color={theme.colors.accentGreen} />
        <Text style={styles.sessionRecoveryTitle}>로그인 상태 복구 중</Text>
        <Text style={styles.sessionRecoveryMessage}>
          {errorMessage}{"\n"}
          {retryDelaySeconds}초 뒤 다시 확인합니다.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => { void onRetry(); }}
          style={styles.sessionRecoveryButton}
        >
          <Text style={styles.sessionRecoveryButtonText}>지금 다시 시도</Text>
        </Pressable>
      </View>
    </View>
  );
}

type AuthenticatedAppProps = {
  api: BackendApiClient;
  generation: number;
  onLogout: () => Promise<void>;
  onAccountSwitch: () => Promise<void>;
};

function AuthenticatedApp({
  api,
  generation,
  onLogout,
  onAccountSwitch,
}: AuthenticatedAppProps) {
  const townApi = useMemo(() => createTownApi(api), [api]);
  const automationController = useMemo(
    () =>
      new UnifiedAutomationController({
        fetch: () => api.fetchUnifiedAutomation(),
        create: (request) => api.createAutomationEntry(request),
        delete: (entryId, settingsRevision) => api.deleteAutomationEntry(entryId, settingsRevision),
        reorder: (entryIds) => api.reorderAutomationEntries(entryIds),
        moveMap: (targetEntryId, request) => api.moveMapBetweenGroups(targetEntryId, request),
        updateQuest: (request) => api.updateQuestAutomation(request),
        updateHomeQuest: (request) => api.updateHomeQuestAutomation(request),
        updateBattle: (request) => api.updateBattleMapAutomation(request),
        updateAdventure: (request) => api.updateAdventureMapAutomation(request),
        updateBattleGroup: (entryId, request) => api.updateBattleMapGroup(entryId, request),
        updateAdventureGroup: (entryId, request) => api.updateAdventureMapGroup(entryId, request),
        updateFishing: (request) => api.updateFishingAutomation(request),
        updateUnion: (request) => api.updateUnionAutomation(request),
        updateRaid: (request) => api.updateRaidAutomation(request),
        fetchHistory: (cursor) => api.fetchAutomationHistory(cursor),
        fetchConvergence: () => api.fetchAutomationConvergence(),
        allowFreshDecision: (attemptId) => api.allowFreshAutomationDecision(attemptId),
        fetchQuests: () => api.fetchQuests(),
        changeState: (action) => api.changeUnifiedAutomationState(action),
      }),
    [api],
  );
  const session = useMemo<AppSession | null>(
    () => ({ loggedIn: true, generation }),
    [generation],
  );
  const partyPresetCatalog = usePartyPresetCatalog(
    api,
    session?.loggedIn === true ? session : null,
  );
  const [battleCategories, setBattleCategories] = useState<
    BattleCategoryResponse[]
  >([]);
  const [areBattleCategoriesLoaded, setAreBattleCategoriesLoaded] =
    useState(false);
  const [isBattleCategoriesLoading, setIsBattleCategoriesLoading] =
    useState(false);
  const [battleCategoriesError, setBattleCategoriesError] = useState<
    string | null
  >(null);
  const [status, setStatus] = useState<HofStatusResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualActionPending, setManualActionPending] = useState(false);
  const describeError = useCallback(
    (error: unknown): string => toUserFacingErrorMessage(error),
    [],
  );
  const passMaintenance = useCaptchaPassMaintenance({
    api,
    authenticated: session?.loggedIn === true,
    describeError,
  });
  const passWarning = captchaPassWarning(passMaintenance.state);

  useEffect(
    () => api.subscribeManualActionState(setManualActionPending),
    [api],
  );

  /** 전역 안내가 화면을 영구 점유하지 않도록 잠시 보여준 뒤 자동으로 닫는다. */
  useEffect(() => {
    if (notice == null) return undefined;

    const timer = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const beginCharacterPatternEdit = useCallback(
    () => automationController.changeState("pause"),
    [automationController],
  );
  const reloadRelatedPartyPresets = useCallback(
    () => partyPresetCatalog.actions.refresh(),
    [partyPresetCatalog.actions],
  );
  const {
    resource: characterHub,
    observations: characterObservations,
  } = useCharacterManagementHub(
    api,
    session?.loggedIn === true ? session : null,
    {
      reloadRelatedPresets: reloadRelatedPartyPresets,
      beginPatternEdit: beginCharacterPatternEdit,
    },
  );
  const {
    characterSyncLabel,
    characterSyncJob,
    syncCharacterRoster,
    startCharacterFullSync,
    stopCharacterSync,
    resumeCharacterSync,
    loadSavedCharacters,
    startAutomaticSyncIfRequired,
    resetCharacterSync,
  } = useCharacterSync({
    api,
    describeError,
    onNotice: setNotice,
    observations: characterObservations,
  });
  const {
    visible: captchaModalVisible,
    blocking: captchaModalBlocking,
    captcha: currentCaptcha,
    message: captchaMessage,
    errorMessage: captchaErrorMessage,
    isLoading: isCaptchaLoading,
    isSubmitting: isCaptchaSubmitting,
    isAutoSolving: isCaptchaAutoSolving,
    open: openCaptchaModal,
    close: closeCaptchaModal,
    submitAnswer: submitGlobalCaptchaAnswer,
    retryAutomatic: retryGlobalCaptchaAutomatically,
    waitForResolution: waitForCaptchaResolution,
    reset: resetCaptchaGate,
  } = useCaptchaGate({
    authenticated: session?.loggedIn === true,
    api,
    describeError,
  });
  const captchaImageSource = currentCaptcha?.imageUrl
    ? api.getAuthenticatedImageSource(currentCaptcha.imageUrl)
    : null;

  /** 설정 화면에서 pending 캡차를 직접 확인할 때 blocking 없이 모달을 연다. */
  const handleOpenCaptchaModal = useCallback(() => {
    void openCaptchaModal();
  }, [openCaptchaModal]);
  useAndroidPushRegistration({
    api,
    authenticated: session?.loggedIn === true,
    onOpenCaptcha: handleOpenCaptchaModal,
  });
  /**
   * HOF 홈 상태를 다시 읽어 상단 상태바의 Time/Funds/Work/Auction을 갱신한다.
   */
  const refreshStatus = useCallback(async () => {
    const nextStatus = await api.fetchStatus();
    setStatus(nextStatus);
    return nextStatus;
  }, [api]);

  const handleStatusObserved = useCallback(
    (observed: HofObservedStatusResponse) => {
      setStatus((current) => mergeObservedHofStatus(current, observed));
    },
    [],
  );

  useEffect(
    () => api.subscribeHofStatus?.(handleStatusObserved),
    [api, handleStatusObserved],
  );

  /**
   * 전투 탭에서 사용할 큰 카테고리 목록을 백엔드에서 불러온다.
   */
  const loadBattleCategories = useCallback(async () => {
    setIsBattleCategoriesLoading(true);
    setBattleCategoriesError(null);

    try {
      setBattleCategories(await api.fetchBattleCategories());
      setAreBattleCategoriesLoaded(true);
    } catch (error) {
      setBattleCategoriesError(describeError(error));
    } finally {
      setIsBattleCategoriesLoading(false);
    }
  }, [api, describeError]);

  /**
   * 선택한 전투 카테고리의 맵 목록을 불러온다.
   */
  const loadBattleMaps = useCallback(
    (categoryId: string): Promise<BattleMapResponse[]> => {
      return api.fetchBattleMaps(categoryId);
    },
    [api],
  );

  /**
   * 전투 실행 API를 호출하고, 캡차가 필요하면 모달 인증 후 같은 요청을 한 번 재시도한다.
   */
  const runBattle = useCallback(
    async (request: RunBattleRequest): Promise<BattleResultResponse> => {
      try {
        return await api.runBattle(request);
      } catch (error) {
        if (!isCaptchaRequiredError(error)) {
          throw error;
        }

        const resumePromise = waitForCaptchaResolution().catch(
          (resumeError: unknown) => {
            throw resumeError;
          },
        );
        await resumePromise;

        return await api.runBattle(request);
      }
    },
    [api, waitForCaptchaResolution],
  );

  const loadBattleLogs = useCallback(
    (query?: BattleLogQuery): Promise<BattleLogResponse[]> =>
      api.fetchBattleLogs(query),
    [api],
  );

  const loadBattleStats = useCallback(
    (period?: AdventureMapStatsPeriod): Promise<BattleStatsResponse> =>
      api.fetchBattleStats(period),
    [api],
  );

  const bootstrap = useAuthenticatedBootstrap({
    generation,
    loadStatus: refreshStatus,
    loadCharacters: loadSavedCharacters,
    startAutomaticSyncIfRequired,
    describeError,
  });

  const resetAuthenticatedResources = useCallback((reason: string) => {
    automationController.reset();
    resetCaptchaGate(new Error(reason));
    resetCharacterSync();
  }, [automationController, resetCaptchaGate, resetCharacterSync]);

  /** 로컬 로그인 세대 resource를 먼저 닫고 server token family 폐기를 마무리한다. */
  const handleLogout = useCallback(async () => {
    resetAuthenticatedResources("로그아웃되었습니다.");
    await onLogout();
  }, [onLogout, resetAuthenticatedResources]);

  /** 계정 전환은 이전 로그인 세대를 끝낸 뒤 비인증 로그인 화면으로 이동한다. */
  const handleAccountSwitch = useCallback(async () => {
    resetAuthenticatedResources("계정 전환을 시작했습니다.");
    await onAccountSwitch();
  }, [onAccountSwitch, resetAuthenticatedResources]);

  const content = (
    <MainScreen
        session={session}
        status={status}
        battleCategories={battleCategories}
        areBattleCategoriesLoaded={areBattleCategoriesLoaded}
        isBattleCategoriesLoading={isBattleCategoriesLoading}
        battleCategoriesError={battleCategoriesError}
        characterHub={characterHub}
        characterSyncLabel={characterSyncLabel}
        characterSyncJob={characterSyncJob}
        onSyncCharacterRoster={syncCharacterRoster}
        onStartCharacterFullSync={startCharacterFullSync}
        onStopCharacterSync={stopCharacterSync}
        onResumeCharacterSync={resumeCharacterSync}
        notice={notice}
        onLoadBattleCategories={loadBattleCategories}
        onLoadBattleMaps={loadBattleMaps}
        onRunBattle={runBattle}
        onLoadPresetPatterns={(preset, characters) => loadPartyPresetPatterns(api, preset, characters)}
        onLoadBattleLogs={loadBattleLogs}
        onLoadBattleStats={loadBattleStats}
        onOpenCaptcha={handleOpenCaptchaModal}
        onStatusObserved={handleStatusObserved}
        automationController={automationController}
        partyPresetCatalog={partyPresetCatalog}
        onLogout={handleLogout}
        onOpenLogin={handleAccountSwitch}
        townApi={townApi}
        resolveCaptcha={waitForCaptchaResolution}
        captchaPassMaintenance={passMaintenance.state}
        captchaPassMaintenanceBusy={passMaintenance.busy}
        captchaPassMaintenanceError={passMaintenance.errorMessage}
        captchaPassWarning={passWarning}
        captchaPassWarningActionable={canOpenManualPassChallenge(passMaintenance.state)}
        onRefreshCaptchaPassMaintenance={passMaintenance.refresh}
        onToggleCaptchaPassMaintenance={passMaintenance.updateEnabled}
    />
  );

  return (
    <View style={styles.container}>
      {content}
      {bootstrap.status.kind === "error" || bootstrap.characters.kind === "error" ? (
        <AuthenticatedBootstrapRecovery
          characters={bootstrap.characters}
          onRetryCharacters={bootstrap.retryCharacters}
          onRetryStatus={bootstrap.retryStatus}
          status={bootstrap.status}
        />
      ) : null}
      {manualActionPending ? (
        <View
          accessibilityLabel="요청 처리 중"
          accessibilityLiveRegion="polite"
          accessibilityRole="progressbar"
          style={styles.manualActionOverlay}
        >
          <View style={styles.manualActionCard}>
            <ActivityIndicator color={theme.colors.accentGreen} />
            <Text style={styles.manualActionText}>요청 처리 중</Text>
          </View>
        </View>
      ) : null}
      <CaptchaChallengeModal
        visible={captchaModalVisible}
        captcha={currentCaptcha}
        imageSource={captchaImageSource}
        isLoading={isCaptchaLoading}
        isSubmitting={isCaptchaSubmitting}
        isAutoSolving={isCaptchaAutoSolving}
        message={captchaMessage}
        errorMessage={captchaErrorMessage}
        blocking={captchaModalBlocking}
        onRefresh={() => {
          void openCaptchaModal({ blocking: captchaModalBlocking });
        }}
        onAutoRetry={() => {
          void retryGlobalCaptchaAutomatically();
        }}
        onSubmit={submitGlobalCaptchaAnswer}
        onRequestClose={closeCaptchaModal}
      />
      <StatusBar style="light" />
    </View>
  );
}

function AuthenticatedBootstrapRecovery({
  status,
  characters,
  onRetryStatus,
  onRetryCharacters,
}: {
  status: BootstrapResource<{ characterSyncRequired: boolean }>;
  characters: BootstrapResource<true>;
  onRetryStatus: () => Promise<void>;
  onRetryCharacters: () => Promise<void>;
}) {
  return (
    <View accessibilityRole="alert" style={styles.bootstrapRecovery}>
      <Text style={styles.bootstrapRecoveryTitle}>일부 정보를 준비하지 못했습니다.</Text>
      {status.kind === "error" ? (
        <View style={styles.bootstrapRecoveryRow}>
          <Text style={styles.bootstrapRecoveryMessage}>상태 · {status.errorMessage}</Text>
          <Pressable accessibilityRole="button" onPress={() => { void onRetryStatus(); }}>
            <Text style={styles.bootstrapRecoveryAction}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}
      {characters.kind === "error" ? (
        <View style={styles.bootstrapRecoveryRow}>
          <Text style={styles.bootstrapRecoveryMessage}>캐릭터 · {characters.errorMessage}</Text>
          <Pressable accessibilityRole="button" onPress={() => { void onRetryCharacters(); }}>
            <Text style={styles.bootstrapRecoveryAction}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const NOTICE_DURATION_MS = 5_000;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  bootContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
  },
  bootText: {
    color: theme.colors.textMuted,
    fontSize: 15,
  },
  manualActionOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: theme.colors.overlay,
    justifyContent: "center",
  },
  manualActionCard: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.lg,
  },
  manualActionText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  bootstrapRecovery: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.danger,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    gap: theme.spacing.xs,
    left: theme.spacing.md,
    padding: theme.spacing.md,
    position: "absolute",
    right: theme.spacing.md,
    top: theme.spacing.md,
    zIndex: 10,
  },
  bootstrapRecoveryTitle: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  bootstrapRecoveryRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing.sm,
    justifyContent: "space-between",
  },
  bootstrapRecoveryMessage: {
    color: theme.colors.textMuted,
    flex: 1,
    fontSize: 12,
  },
  bootstrapRecoveryAction: {
    color: theme.colors.accentGreen,
    fontSize: 12,
    fontWeight: "800",
  },
  sessionRecoveryOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: theme.colors.overlay,
    justifyContent: "center",
    padding: theme.spacing.xl,
  },
  sessionRecoveryCard: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing.sm,
    maxWidth: 420,
    padding: theme.spacing.xl,
    width: "100%",
  },
  sessionRecoveryTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  sessionRecoveryMessage: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  sessionRecoveryButton: {
    borderColor: theme.colors.accentGreen,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  sessionRecoveryButtonText: {
    color: theme.colors.accentGreen,
    fontSize: 14,
    fontWeight: "800",
  },
});
