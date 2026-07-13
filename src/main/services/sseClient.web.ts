import type { SseConnectionHandlers, SseConnectionOptions, SseSubscription } from './sseClient';

/**
 * 브라우저 EventSource는 Authorization 헤더를 지원하지 않으므로 fetch stream으로 SSE를 읽는다.
 * 빈 줄로 구분된 event block에서 `event:`와 여러 `data:` 줄을 해석해 네이티브 구현과 같은 callback을 호출한다.
 */
export function createSseConnection(
  url: string,
  handlers: SseConnectionHandlers,
  options: SseConnectionOptions = {},
): SseSubscription {
  const controller = new AbortController();
  let closed = false;

  void fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'text/event-stream',
      ...options.headers,
    },
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok || !response.body) throw new Error(`SSE 연결에 실패했습니다. (HTTP ${response.status})`);
      handlers.onOpen?.();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!closed) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        blocks.forEach((block) => dispatchBlock(block, handlers));
        if (done) break;
      }
      if (!closed && buffer.trim()) dispatchBlock(buffer, handlers);
    })
    .catch((error: unknown) => {
      if (!closed) handlers.onError?.(error);
    })
    .finally(() => {
      if (!closed) handlers.onClose?.();
    });

  return {
    close: () => {
      if (closed) return;
      closed = true;
      controller.abort();
      handlers.onClose?.();
    },
  };
}

function dispatchBlock(block: string, handlers: SseConnectionHandlers): void {
  let eventType = 'message';
  const data: string[] = [];
  block.split('\n').forEach((line) => {
    if (!line || line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, '') : '';
    if (field === 'event') eventType = value;
    if (field === 'data') data.push(value);
  });
  if (!handlers.eventTypes.includes(eventType)) return;
  handlers.onMessage({ type: eventType, data: data.length > 0 ? data.join('\n') : null });
}
