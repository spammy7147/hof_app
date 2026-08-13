type KeyboardScrollResponder = {
  scrollResponderScrollNativeHandleToKeyboard?: (
    target: unknown,
    additionalOffset?: number,
    preventNegativeScrollOffset?: boolean,
  ) => void;
};

export type KeyboardScrollable = KeyboardScrollResponder & {
  getScrollResponder?: () => KeyboardScrollResponder | null | undefined;
};

/** 포커스된 입력란이 소프트 키보드 위에 남도록 가장 가까운 스크롤 컨테이너를 이동한다. */
export function scrollFocusedInputIntoView(
  scrollable: unknown,
  target: unknown,
  additionalOffset = 24,
): void {
  const candidate = scrollable as KeyboardScrollable | null;
  const responder = candidate?.getScrollResponder?.() ?? candidate;
  responder?.scrollResponderScrollNativeHandleToKeyboard?.(target, additionalOffset, true);
}
