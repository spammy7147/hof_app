import type { BackendApiClient } from '../../../services/backendApi';
import type {
  ShopResponse,
  QuestSnapshot,
  TownActionResultResponse,
  TownApiPath,
  TownResultItemResponse,
  TownResultStatus,
  TownRowResponse,
} from '../../../types/api';

type TownBackendTransport = Pick<BackendApiClient, 'fetchTownResource' | 'submitTownAction'> &
  Partial<Pick<BackendApiClient, 'fetchQuests' | 'acceptQuest' | 'claimQuest'>>;

export type TownApi = ReturnType<typeof createTownApi>;

export type TownReadPreviewSnapshot = {
  verifiedAt: string;
  rows: TownRowResponse[];
  notices: string[];
  totalRows: number;
};
export type TownReadState = {
  revision: number;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  awaitingCaptcha?: boolean;
};

/** 기능별 API가 같은 인증 transport를 사용하되 endpoint와 DTO 타입은 각 기능에 남긴다. */
export function createTownApi(backend: TownBackendTransport) {
  const flights = new Map<string, { controller: AbortController; promise: Promise<unknown> }>();
  const shops = new Map<string, { data: ShopResponse; at: number }>();
  const previews = new Map<string, { snapshot: TownReadPreviewSnapshot; at: number }>();
  const readStates = new Map<string, TownReadState>();
  const readListeners = new Set<() => void>();
  let readRevision = 0;
  const notifyReads = () => { for (const listener of readListeners) { try { listener(); } catch { /* 표시 구독자의 실패는 읽기 결과를 바꾸지 않는다. */ } } };
  const retryAt = new Map<string, number>();
  let active = true;
  const mutationListeners = new Set<() => void>();
  const invalidate = () => {
    for (const [path, flight] of flights) {
      flight.controller.abort();
      const previous = readStates.get(path);
      if (previous) readStates.set(path, { ...previous, status: 'error', error: '정보가 변경되었습니다. 다시 확인해 주세요.' });
    }
    flights.clear();
    notifyReads();
  };
  const rememberShop = (path: string, data: ShopResponse) => {
    if (active && !data.stale && Array.isArray(data.items)) shops.set(path, { data: { shopId: data.shopId, items: data.items, stale: false, lastVerifiedAt: data.lastVerifiedAt, result: null }, at: Date.now() });
  };
  const read = <TResponse,>(path: TownApiPath | '/api/quests'): Promise<TResponse> => {
    if (!active) return Promise.reject(new Error('로그인 계정이 변경되었습니다.'));
    if (path === '/api/quests' && !backend.fetchQuests) return Promise.reject(new Error('퀘스트 API가 연결되지 않았습니다.'));
    const previous = flights.get(path);
    if (previous) return previous.promise as Promise<TResponse>;
    if (Date.now() < (retryAt.get(path) ?? 0)) return Promise.reject(new Error('잠시 후 다시 확인해 주세요.'));
    const controller = new AbortController();
    const revision = ++readRevision;
    const flight = { controller, promise: Promise.resolve() as Promise<unknown> };
    const request: Promise<unknown> = path === '/api/quests'
      ? backend.fetchQuests!(controller.signal)
      : backend.fetchTownResource(path, controller.signal);
    flight.promise = request.then((data) => {
      if (!active || flights.get(path) !== flight) throw new Error('이전 조회를 폐기했습니다.');
      retryAt.delete(path);
      if (isRecord(data) && (data.complete === false || data.stale === true)) throw new Error('최신 정보를 완전히 확인하지 못했습니다. 다시 확인해 주세요.');
      let verified: unknown = data;
      if (path.startsWith('/api/town/shops/')) {
        const shop = data as ShopResponse;
        if (shop.stale || !Array.isArray(shop.items)) throw new Error('상점 목록을 확인하지 못했습니다. 다시 확인해 주세요.');
        const shopData = { ...shop, lastVerifiedAt: new Date().toISOString() };
        rememberShop(path, shopData);
        verified = shopData;
      }
      const snapshot = displaySnapshot(verified);
      if (snapshot) {
        previews.delete(path);
        previews.set(path, { snapshot, at: Date.now() });
        if (previews.size > 48) previews.delete(previews.keys().next().value!);
      }
      readStates.set(path, { revision, status: 'ready', error: null });
      notifyReads();
      return verified;
    }).catch((error: unknown) => {
      const seconds = (error as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
      if (active && flights.get(path) === flight) {
        readStates.set(path, {
          revision, status: 'error', error: '최신 정보를 확인하지 못했습니다. 다시 확인해 주세요.',
          awaitingCaptcha: (error as { code?: string } | null)?.code === 'CAPTCHA_REQUIRED',
        });
        notifyReads();
      }
      if (active && flights.get(path) === flight && typeof seconds === 'number' && seconds > 0) retryAt.set(path, Date.now() + seconds * 1_000);
      throw error;
    }).finally(() => { if (flights.get(path) === flight) flights.delete(path); });
    flights.set(path, flight);
    readStates.set(path, { revision, status: 'loading', error: null });
    for (const key of readStates.keys()) {
      if (readStates.size <= 64) break;
      if (!flights.has(key)) readStates.delete(key);
    }
    notifyReads();
    return flight.promise as Promise<TResponse>;
  };
  const mutate = async <TResponse,>(operation: () => Promise<TResponse>): Promise<TResponse> => {
    if (!active) throw new Error('로그인 계정이 변경되었습니다.');
    invalidate();
    try {
      return await operation();
    } finally {
      invalidate();
      for (const listener of mutationListeners) {
        try { listener(); } catch { /* 표시 갱신 실패가 이미 제출한 행동의 결과를 바꾸지 않는다. */ }
      }
    }
  };
  return {
    peekPreview(path: string): TownReadPreviewSnapshot | null {
      const saved = previews.get(path);
      const age = saved ? Date.now() - saved.at : Infinity;
      return active && saved && age >= 0 && age <= 5 * 60_000 ? saved.snapshot : null;
    },
    getReadState(path: string): TownReadState | null { return readStates.get(path) ?? null; },
    subscribeReads(listener: () => void) { readListeners.add(listener); return () => { readListeners.delete(listener); }; },
    peekShop(path: string): ShopResponse | null {
      const saved = shops.get(path);
      return active && saved && Date.now() - saved.at <= 5 * 60_000
        ? { ...saved.data, stale: true, lastVerifiedAt: new Date(saved.at).toISOString() } : null;
    },
    rememberShop,
    activate() { active = true; },
    subscribeMutations(listener: () => void) { mutationListeners.add(listener); return () => { mutationListeners.delete(listener); }; },
    dispose() { active = false; invalidate(); shops.clear(); previews.clear(); readStates.clear(); retryAt.clear(); mutationListeners.clear(); readListeners.clear(); },
    load<TResponse>(path: TownApiPath): Promise<TResponse> { return read<TResponse>(path); },
    submit<TRequest, TResponse>(path: TownApiPath, request: TRequest): Promise<TResponse> {
      return mutate(() => backend.submitTownAction<TRequest, TResponse>(path, request));
    },
    loadQuests() {
      return read<QuestSnapshot[]>('/api/quests');
    },
    acceptQuest(actionNo: string) {
      if (!backend.acceptQuest) return Promise.reject(new Error('퀘스트 수락 API가 연결되지 않았습니다.'));
      return mutate(() => backend.acceptQuest!(actionNo));
    },
    claimQuest(actionNo: string) {
      if (!backend.claimQuest) return Promise.reject(new Error('퀘스트 완료 API가 연결되지 않았습니다.'));
      return mutate(() => backend.claimQuest!(actionNo));
    },
  };
}

/** 표시용 문자·수치만 복사하며 후보 ID·action·이전 행동 결과는 보존하지 않는다. */
function displaySnapshot(data: unknown): TownReadPreviewSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (value.complete === false || value.stale === true) return null;
  const lists = ['items', 'cards', 'baseCards', 'rows', 'primary', 'recipes', 'listings', 'shrines', 'boxes', 'rewards', 'quests', 'raids', 'jobs', 'fighters', 'catches'];
  let source: unknown[] = Array.isArray(data) ? data : lists.map((key) => value[key]).find(Array.isArray) ?? [];
  const rest = isRecord(value.restStatus) ? value.restStatus : null;
  if (source.length === 0 && rest && Array.isArray(rest.facilities)) source = rest.facilities;
  const rows = source.slice(0, 200).flatMap((item, index): TownRowResponse[] => {
    const row = isRecord(item) ? item : {};
    const label = normalizeDisplayText(typeof item === 'string' ? item : row.label ?? row.name);
    if (!label) return [];
    const price = row.price ?? row.cost ?? row.totalPrice ?? row.latestUnitPrice;
    return [{ id: `preview:${index}`, label: label.slice(0, 300), selectable: false,
      detail: normalizeDisplayText(row.detail ?? row.statusText ?? row.mission)?.slice(0, 500) ?? null,
      imageUrl: null, price: typeof price === 'number' ? price : null,
      quantity: typeof row.quantity === 'number' ? row.quantity : null }];
  });
  const notices = ['notice', 'locationName', 'waterStatus', 'challengeNotice', 'warning']
    .map((key) => normalizeDisplayText(value[key])).filter((text): text is string => text != null).map((text) => text.slice(0, 500));
  if (rest && typeof rest.currentTime === 'number') notices.push(`휴식처 이전 상태 · Time ${rest.currentTime} / ${rest.maxTime ?? '?'}`);
  if (isRecord(value.activeJob) && typeof value.activeJob.label === 'string') notices.push(value.activeJob.label);
  return { verifiedAt: new Date().toISOString(), rows, notices, totalRows: source.length };
}

/** 누락된 selectable은 선택 불가로 처리해 HOF에 없던 radio/checkbox를 앱이 만들지 않는다. */
export function normalizeTownRow(value: Partial<TownRowResponse>): TownRowResponse {
  return {
    id: normalizeIdentifier(value.id),
    label: normalizeDisplayText(value.label) ?? '이름 없는 항목',
    accessibilityLabel: normalizeDisplayText(value.accessibilityLabel) ?? undefined,
    selectable: value.selectable === true,
    detail: normalizeDisplayText(value.detail),
    imageUrl: normalizeImageUrl(value.imageUrl),
    price: normalizeNullableNumber(value.price),
    quantity: normalizeNullableNumber(value.quantity),
  };
}

/** 알려진 결과 필드만 복사하고 HTML 문서처럼 보이는 메시지는 표시 대상에서 제외한다. */
export function normalizeTownResult(value: unknown): TownActionResultResponse {
  const source = isRecord(value) ? value : {};
  const messages = Array.isArray(source.messages)
    ? source.messages
      .map(normalizeDisplayText)
      .filter((message): message is string => message !== null)
      .slice(0, 20)
    : [];
  const items = Array.isArray(source.items)
    ? source.items
      .filter(isRecord)
      .map(normalizeTownResultItem)
      .filter((item): item is TownResultItemResponse => item !== null)
      .slice(0, 100)
    : [];

  return {
    status: normalizeResultStatus(source.status),
    messages,
    items,
    refreshRequired: source.refreshRequired !== false,
  };
}

function normalizeTownResultItem(value: Record<string, unknown>): TownResultItemResponse | null {
  const name = normalizeDisplayText(value.name);
  if (!name) return null;
  return {
    name,
    quantity: normalizeNullableNumber(value.quantity),
    imageUrl: normalizeImageUrl(value.imageUrl),
    detail: normalizeDisplayText(value.detail),
  };
}

function normalizeResultStatus(value: unknown): TownResultStatus {
  return value === 'SUCCESS' || value === 'FAILURE' || value === 'INFORMATIONAL'
    ? value
    : 'UNKNOWN';
}

function normalizeIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}

function normalizeDisplayText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /<\/?[a-z][^>]*>/i.test(trimmed)) return null;
  return trimmed.slice(0, 500);
}

function normalizeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && !/[<>]/.test(trimmed) ? trimmed : null;
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
