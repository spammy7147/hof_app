import { useCallback, useEffect, useRef, useState } from "react";
import { mergeBattleMapAvailability } from '../../domain/battleMaps';
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
  const retryAt = useRef(new Map<string, number>());
  const displays = useRef(new Map<string, { value: unknown; at: number }>());
  const displayEpoch = useRef(0);
  const displayFlights = useRef(new Map<string, Promise<unknown>>());
  const invalidateDisplays = useCallback(() => { displayEpoch.current++; displays.current.clear(); displayFlights.current.clear(); }, []);
  const peekDisplay = useCallback(<T,>(key: string): T | null => {
    assertActiveGeneration();
    const saved = displays.current.get(key);
    const age = saved ? Date.now() - saved.at : Infinity;
    return saved && age >= 0 && age <= 5 * 60_000 ? saved.value as T : null;
  }, [assertActiveGeneration]);
  const readDisplay = useCallback(<T,>(key: string, operation: () => Promise<T>): Promise<T> => {
    assertActiveGeneration();
    if (Date.now() < (retryAt.current.get(key) ?? 0)) return Promise.reject(new Error('잠시 후 다시 확인해 주세요.'));
    const existing = displayFlights.current.get(key);
    if (existing) return existing as Promise<T>;
    const epoch = displayEpoch.current;
    const flight = operation().then(value => {
      assertActiveGeneration();
      if (epoch !== displayEpoch.current || displayFlights.current.get(key) !== flight) {
        throw new Error('변경된 이전 조회를 폐기했습니다. 다시 확인해 주세요.');
      }
      retryAt.current.delete(key);
      displays.current.delete(key);
      displays.current.set(key, { value, at: Date.now() });
      if (displays.current.size > 24) displays.current.delete(displays.current.keys().next().value!);
      return value;
    }).catch((error: unknown) => {
      const seconds = (error as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
      if (epoch === displayEpoch.current && displayFlights.current.get(key) === flight && typeof seconds === 'number' && seconds > 0) {
        retryAt.current.set(key, Date.now() + seconds * 1_000);
      }
      throw error;
    }).finally(() => { if (displayFlights.current.get(key) === flight) displayFlights.current.delete(key); });
    displayFlights.current.set(key, flight);
    return flight;
  }, [assertActiveGeneration]);
  const catalog = useRef(new Map<string, BattleMapResponse[]>());
  const loadedCatalogs = useRef(new Set<string>());
  const flights = useRef(new Map<string, { controller: AbortController; promise: Promise<BattleMapResponse[]> }>());
  const invalidateAvailability = useCallback(() => {
    for (const [key, flight] of flights.current) if (key.startsWith('availability:')) {
      flight.controller.abort(); flights.current.delete(key);
    }
  }, []);
  useEffect(() => () => {
    for (const flight of flights.current.values()) flight.controller.abort();
    flights.current.clear(); catalog.current.clear(); loadedCatalogs.current.clear(); retryAt.current.clear();
    displayEpoch.current++; displays.current.clear(); displayFlights.current.clear();
  }, []);
  const readMaps = useCallback((categoryId: string, kind: 'catalog' | 'availability') => {
    assertActiveGeneration();
    const key = `${kind}:${categoryId}`;
    if (Date.now() < (retryAt.current.get(key) ?? 0)) return Promise.reject(new Error('잠시 후 맵을 다시 확인해 주세요.'));
    const existing = flights.current.get(key);
    if (existing) return existing.promise;
    if (kind === 'catalog' && loadedCatalogs.current.has(categoryId)) return Promise.resolve(catalog.current.get(categoryId)!);
    const controller = new AbortController();
    const flight = { controller, promise: Promise.resolve([]) as Promise<BattleMapResponse[]> };
    const request = kind === 'catalog' ? api.fetchBattleMapCatalog(categoryId, controller.signal) : api.fetchBattleMapAvailability(categoryId, controller.signal);
    flight.promise = request.then((maps) => {
      assertActiveGeneration();
      if (flights.current.get(key) !== flight) throw new Error('이전 맵 조회를 폐기했습니다.');
      retryAt.current.delete(key);
      const known = catalog.current.get(categoryId) ?? [];
      const combined = kind === 'catalog' ? mergeBattleMapAvailability(maps, known) : mergeBattleMapAvailability(known, maps);
      catalog.current.set(categoryId, combined.map((map) => ({ ...map, enabled: false })));
      if (kind === 'catalog') loadedCatalogs.current.add(categoryId);
      return kind === 'catalog' ? catalog.current.get(categoryId)! : maps;
    }).catch((error: unknown) => {
      const seconds = (error as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
      if (flights.current.get(key) === flight && typeof seconds === 'number' && seconds > 0) retryAt.current.set(key, Date.now() + seconds * 1_000);
      throw error;
    }).finally(() => { if (flights.current.get(key) === flight) flights.current.delete(key); });
    flights.current.set(key, flight);
    return flight.promise;
  }, [api, assertActiveGeneration]);
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
      return readMaps(categoryId, 'availability');
    },
    [readMaps],
  );

  const loadBattleMapCatalog = useCallback(
    (categoryId: string): Promise<BattleMapResponse[]> => readMaps(categoryId, 'catalog'),
    [readMaps],
  );

  /**
   * 전투 실행 API를 호출하고, 캡차가 필요하면 모달 인증 후 같은 요청을 한 번 재시도한다.
   */
  const runBattle = useCallback(
    async (request: RunBattleRequest): Promise<BattleResultResponse> => {
      assertActiveGeneration();
      invalidateAvailability(); invalidateDisplays();
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
      } finally { invalidateAvailability(); invalidateDisplays(); }
    },
    [api, assertActiveGeneration, waitForCaptchaResolution, invalidateAvailability, invalidateDisplays],
  );

  const loadBattleLogs = useCallback(
    (query?: BattleLogQuery): Promise<BattleLogResponse[]> =>
      readDisplay(logDisplayKey(query), () => api.fetchBattleLogs(query)),
    [api, readDisplay],
  );

  const loadBattleStats = useCallback(
    (period?: AdventureMapStatsPeriod, date?: string): Promise<BattleStatsResponse> =>
      readDisplay(statsDisplayKey(period, date), () => api.fetchBattleStats(period, date)),
    [api, readDisplay],
  );

  return {
    invalidateDisplays,
    categories: battleCategories,
    loaded: areBattleCategoriesLoaded,
    loading: isBattleCategoriesLoading,
    errorMessage: battleCategoriesError,
    loadCategories: loadBattleCategories,
    loadMaps: loadBattleMaps,
    loadMapCatalog: loadBattleMapCatalog,
    run: runBattle,
    peekLogs: (query?: BattleLogQuery) => peekDisplay<BattleLogResponse[]>(logDisplayKey(query)),
    peekStats: (period?: AdventureMapStatsPeriod, date?: string) => peekDisplay<BattleStatsResponse>(statsDisplayKey(period, date)),
    loadLogs: loadBattleLogs,
    loadLogHtml: (logId: number) => api.fetchBattleLogHtml(logId),
    loadStats: loadBattleStats,
  };
}

function logDisplayKey(query?: BattleLogQuery): string {
  return `logs:${JSON.stringify([query?.outcome ?? null, query?.offset ?? 0, query?.limit ?? 40])}`;
}
function statsDisplayKey(period?: AdventureMapStatsPeriod, date?: string): string {
  return `stats:${period ?? 'default'}:${period === 'DAY' ? date ?? '' : ''}`;
}
