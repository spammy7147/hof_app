import type { BackendApiClient } from '../../../services/backendApi';
import type {
  TownActionResultResponse,
  TownApiPath,
  TownResultItemResponse,
  TownResultStatus,
  TownRowResponse,
} from '../../../types/api';

type TownBackendTransport = Pick<BackendApiClient, 'fetchTownResource' | 'submitTownAction'> &
  Partial<Pick<BackendApiClient, 'fetchQuests' | 'acceptQuest' | 'claimQuest'>>;

export type TownApi = ReturnType<typeof createTownApi>;

/** 기능별 API가 같은 인증 transport를 사용하되 endpoint와 DTO 타입은 각 기능에 남긴다. */
export function createTownApi(backend: TownBackendTransport) {
  return {
    load<TResponse>(path: TownApiPath): Promise<TResponse> {
      return backend.fetchTownResource<TResponse>(path);
    },
    submit<TRequest, TResponse>(path: TownApiPath, request: TRequest): Promise<TResponse> {
      return backend.submitTownAction<TRequest, TResponse>(path, request);
    },
    loadQuests() {
      if (!backend.fetchQuests) return Promise.reject(new Error('퀘스트 API가 연결되지 않았습니다.'));
      return backend.fetchQuests();
    },
    acceptQuest(actionNo: string) {
      if (!backend.acceptQuest) return Promise.reject(new Error('퀘스트 수락 API가 연결되지 않았습니다.'));
      return backend.acceptQuest(actionNo);
    },
    claimQuest(actionNo: string) {
      if (!backend.claimQuest) return Promise.reject(new Error('퀘스트 완료 API가 연결되지 않았습니다.'));
      return backend.claimQuest(actionNo);
    },
  };
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
