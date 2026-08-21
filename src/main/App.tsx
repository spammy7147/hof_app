import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { LoginScreen } from "./screens/LoginScreen";
import { MainScreen } from "./screens/MainScreen";
import { AppProviders } from "./components/AppProviders";
import { CaptchaChallengeModal } from "./components/CaptchaChallengeModal";
import { BackendApiClient } from "./services/backendApi";
import { useCharacterSync } from "./features/characters/useCharacterSync";
import { useCaptchaGate } from "./features/captcha/useCaptchaGate";
import { useAndroidPushRegistration } from "./features/push/useAndroidPushRegistration";
import { RequiredUpdateGate } from "./features/update/RequiredUpdateGate";
import { isCaptchaRequiredError } from "./domain/captchaGate";
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
import { usePartyPresetCatalog } from "./features/partyPresets/usePartyPresetCatalog";
import { useCharacterManagementHub } from "./features/characters/useCharacterManagementHub";

type ScreenMode = "boot" | "login" | "main";

type AppSession = {
  loggedIn: boolean;
};

/**
 * 앱 전체의 최상위 컴포넌트다.
 *
 * 로그인, Refresh Token 세션 복원, 상태바 데이터, 캐릭터 SSE 동기화,
 * 전투 중 캡차 모달 같은 전역 흐름을 여기에서 조립한다.
 */
export default function App() {
  const api = useMemo(() => new BackendApiClient(), []);
  return (
    <AppProviders style={styles.container}>
      <RequiredUpdateGate api={api}>
        <AppContent api={api} />
      </RequiredUpdateGate>
    </AppProviders>
  );
}

function AppContent({ api }: { api: BackendApiClient }) {
  const townApi = useMemo(() => createTownApi(api), [api]);
  const automationController = useMemo(
    () =>
      new UnifiedAutomationController({
        fetch: () => api.fetchUnifiedAutomation(),
        create: (request) => api.createAutomationEntry(request),
        delete: (entryId) => api.deleteAutomationEntry(entryId),
        reorder: (entryIds) => api.reorderAutomationEntries(entryIds),
        updateQuest: (request) => api.updateQuestAutomation(request),
        updateHomeQuest: (request) => api.updateHomeQuestAutomation(request),
        updateBattle: (request) => api.updateBattleMapAutomation(request),
        updateAdventure: (request) => api.updateAdventureMapAutomation(request),
        updateFishing: (request) => api.updateFishingAutomation(request),
        updateUnion: (request) => api.updateUnionAutomation(request),
        updateRaid: (request) => api.updateRaidAutomation(request),
        fetchHistory: (cursor) => api.fetchAutomationHistory(cursor),
        fetchQuests: () => api.fetchQuests(),
        changeState: (action) => api.changeUnifiedAutomationState(action),
      }),
    [api],
  );
  const [mode, setMode] = useState<ScreenMode>("boot");
  const [session, setSession] = useState<AppSession | null>(null);
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
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [manualActionPending, setManualActionPending] = useState(false);
  const describeError = useCallback(
    (error: unknown): string => toUserFacingErrorMessage(error),
    [],
  );

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

  const {
    characters,
    characterSyncLabel,
    characterSyncJob,
    syncCharacterRoster,
    startCharacterFullSync,
    stopCharacterSync,
    resumeCharacterSync,
    loadSavedCharacters,
    startAutomaticSyncIfRequired,
    upsertCharacter,
    replaceCharacters,
    resetCharacterSync,
  } = useCharacterSync({ api, describeError, onNotice: setNotice });
  const beginCharacterPatternEdit = useCallback(
    () => automationController.changeState("pause"),
    [automationController],
  );
  const reloadRelatedPartyPresets = useCallback(
    () => partyPresetCatalog.actions.refresh(),
    [partyPresetCatalog.actions],
  );
  const characterHub = useCharacterManagementHub(
    api,
    session?.loggedIn === true ? session : null,
    characters,
    {
      publishRoster: replaceCharacters,
      publishDetail: upsertCharacter,
      reloadRelatedPresets: reloadRelatedPartyPresets,
      beginPatternEdit: beginCharacterPatternEdit,
    },
  );
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

  /**
   * 로그인 직후 필요한 초기 데이터들을 병렬로 불러온다.
   */
  const hydrateAfterLogin = useCallback(async () => {
    const results = await Promise.allSettled([
      refreshStatus(),
      loadSavedCharacters(),
    ]);

    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      setNotice(describeError(failed.reason));
      return;
    }
    const statusResult = results[0];
    if (statusResult.status === "fulfilled") {
      await startAutomaticSyncIfRequired(
        statusResult.value.characterSyncRequired,
      );
    }
  }, [
    describeError,
    loadSavedCharacters,
    refreshStatus,
    startAutomaticSyncIfRequired,
  ]);

  /**
   * HOF 로그인 요청부터 저장 여부 처리, 초기 데이터 로딩까지 한 번에 수행한다.
   */
  const loginAndHydrate = useCallback(
    async (loginId: string, password: string) => {
      setIsLoggingIn(true);
      setLoginError(null);

      try {
        const loginResponse = await api.login({ loginId, password });
        const nextSession: AppSession = {
          loggedIn: Boolean(loginResponse.accessToken),
        };

        // 같은 앱 프로세스에서 다른 계정으로 로그인해도 이전 계정의 진행 요청과 snapshot을 넘기지 않는다.
        automationController.reset();
        setSession(nextSession);
        setMode("main");
        setNotice(null);

        await hydrateAfterLogin();
      } catch (error) {
        const message = describeError(error);
        setLoginError(message);
        setNotice(message);
        throw error;
      } finally {
        setIsLoggingIn(false);
      }
    },
    [api, automationController, describeError, hydrateAfterLogin],
  );

  useEffect(() => {
    let cancelled = false;

    /**
     * 앱 시작 시 refresh token으로 세션을 복원하고, 유효한 세션이 없으면 로그인 화면으로 이동한다.
     */
    async function boot() {
      try {
        await api.restoreSession();
      } catch {
        if (!cancelled) setMode("login");
        return;
      }
      if (cancelled) return;

      setSession({
        loggedIn: true,
      });
      setMode("main");
      setNotice(null);
      await hydrateAfterLogin();
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, [api, hydrateAfterLogin]);

  /**
   * 로그인 화면에서 직접 입력한 ID/PW로 로그인할 때 호출된다.
   */
  const handleManualLogin = useCallback(
    async (loginId: string, password: string) => {
      await loginAndHydrate(loginId, password);
    },
    [loginAndHydrate],
  );

  /**
   * 서버 token family와 앱의 세션 상태를 모두 지우고 로그인 화면으로 돌아간다.
   */
  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    automationController.reset();
    resetCaptchaGate(new Error("로그아웃되었습니다."));
    setSession(null);
    resetCharacterSync();
    setBattleCategories([]);
    setAreBattleCategoriesLoaded(false);
    setBattleCategoriesError(null);
    setStatus(null);
    setNotice(null);
    setLoginError(null);
    setMode("login");
  }, [api, automationController, resetCaptchaGate, resetCharacterSync]);

  let content;
  if (mode === "boot") {
    content = (
      <View style={styles.bootContainer}>
        <ActivityIndicator color={theme.colors.accentGreen} />
        <Text style={styles.bootText}>앱 준비 중</Text>
      </View>
    );
  } else if (mode === "login") {
    content = (
      <LoginScreen
        errorMessage={loginError}
        isSubmitting={isLoggingIn}
        onSubmit={handleManualLogin}
      />
    );
  } else {
    content = (
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
        onLoadBattleLogs={loadBattleLogs}
        onLoadBattleStats={loadBattleStats}
        onOpenCaptcha={handleOpenCaptchaModal}
        onStatusObserved={handleStatusObserved}
        automationController={automationController}
        partyPresetCatalog={partyPresetCatalog}
        onLogout={handleLogout}
        onOpenLogin={() => setMode("login")}
        townApi={townApi}
        resolveCaptcha={waitForCaptchaResolution}
      />
    );
  }

  return (
    <View style={styles.container}>
      {content}
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
});
