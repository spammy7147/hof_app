import { useCallback, useState } from "react";
import type { BackendApiClient } from "../../services/backendApi";
import { isCaptchaRequiredError } from "../../domain/captchaGate";
import type {
  BattleCategoryResponse, BattleLogResponse, BattleLogQuery, BattleMapResponse,
  BattleResultResponse, BattleStatsResponse, AdventureMapStatsPeriod, RunBattleRequest,
} from "../../types/api";

type Options = {
  api: BackendApiClient;
  describeError: (error: unknown) => string;
  assertActiveGeneration: () => void;
  waitForCaptchaResolution: () => Promise<void>;
};

export type BattleResource = ReturnType<typeof useBattleResource>;

/** 로그인 세대 동안 전투 카탈로그를 유지하고 캡차 해결 후 같은 전투를 한 번만 재시도한다. */
export function useBattleResource({
  api, describeError, assertActiveGeneration, waitForCaptchaResolution,
}: Options) {
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
      assertActiveGeneration();
      try {
        const result = await api.runBattle(request);
        assertActiveGeneration();
        return result;
      } catch (error) {
        assertActiveGeneration();
        if (!isCaptchaRequiredError(error)) {
          throw error;
        }

        const resumePromise = waitForCaptchaResolution().catch(
          (resumeError: unknown) => {
            throw resumeError;
          },
        );
        await resumePromise;

        assertActiveGeneration();
        const result = await api.runBattle(request);
        assertActiveGeneration();
        return result;
      }
    },
    [api, assertActiveGeneration, waitForCaptchaResolution],
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

  return {
    categories: battleCategories,
    loaded: areBattleCategoriesLoaded,
    loading: isBattleCategoriesLoading,
    errorMessage: battleCategoriesError,
    loadCategories: loadBattleCategories,
    loadMaps: loadBattleMaps,
    run: runBattle,
    loadLogs: loadBattleLogs,
    loadStats: loadBattleStats,
  };
}
