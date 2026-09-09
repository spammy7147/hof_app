import EventSource from 'react-native-sse';

import type { SseConnectionHandlers, SseConnectionOptions, SseSubscription } from './sseClient';

/**
 * iOS/Android에서 react-native-sse를 이용해 Spring SSE endpoint에 연결한다.
 */
export function createSseConnection(
  url: string,
  handlers: SseConnectionHandlers,
  options: SseConnectionOptions = {},
): SseSubscription {
  const eventSource = new EventSource<string>(url, {
    headers: {
      Accept: 'text/event-stream',
      ...options.headers,
    },
  });

  const listeners = handlers.eventTypes.map((eventType) => {
    const listener = (event: { type: string; data?: string | null }) => {
      handlers.onMessage({
        type: event.type,
        data: event.data ?? null,
      });
    };
    eventSource.addEventListener(eventType, listener);
    return { eventType, listener };
  });

  eventSource.addEventListener('open', () => handlers.onOpen?.());
  eventSource.addEventListener('error', (event) => handlers.onError?.(event));
  eventSource.addEventListener('close', () => handlers.onClose?.());

  return {
    close: () => {
      listeners.forEach(({ eventType, listener }) => {
        eventSource.removeEventListener(eventType, listener);
      });
      eventSource.close();
      // react-native-sse는 error callback이 반환된 뒤에도 polling을 예약한다.
      // callback 안에서 닫은 경우 그 뒤에 생긴 예약까지 취소한다.
      queueMicrotask(() => eventSource.close());
    },
  };
}
