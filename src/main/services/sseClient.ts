/** 플랫폼 구현이 전달하는 event 이름과 raw data 한 건이다. */
export type SseMessage = {
  type: string;
  data: string | null;
};

/** web/native 구현에 공통으로 전달하는 SSE 연결 callback 계약이다. */
export type SseConnectionHandlers = {
  eventTypes: string[];
  onMessage: (message: SseMessage) => void;
  onOpen?: () => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
};

/** 화면과 hook이 플랫폼 구현을 몰라도 연결을 닫을 수 있는 최소 handle이다. */
export type SseSubscription = {
  close: () => void;
};

/** Bearer 인증처럼 플랫폼 SSE 구현에 전달할 연결 옵션이다. */
export type SseConnectionOptions = {
  headers?: Record<string, string>;
};

/**
 * 플랫폼별 SSE 구현이 같은 함수 이름을 제공하도록 맞춘 공통 선언이다.
 *
 * 실제 구현은 `sseClient.web.ts` 또는 `sseClient.native.ts`가 담당한다.
 */
export function createSseConnection(
  _url: string,
  _handlers: SseConnectionHandlers,
  _options: SseConnectionOptions = {},
): SseSubscription {
  throw new Error('SSE is implemented by platform-specific files.');
}
