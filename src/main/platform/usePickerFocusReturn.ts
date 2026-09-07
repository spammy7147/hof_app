import { useCallback, useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { focusAccessibilityTarget, getAccessibilityFocusTarget } from './accessibilityFocus';

type FocusNode = Parameters<typeof getAccessibilityFocusTarget>[0];
type Options<Key> = {
  getTarget: (key: Key) => FocusNode;
  canRestore: (key: Key) => boolean;
};

/** 선택창이 닫힌 뒤에도 호출 당시의 같은 ref와 플랫폼 대상에만 포커스를 돌려준다. */
export function usePickerFocusReturn<Key>({ getTarget, canRestore }: Options<Key>) {
  const latest = useRef({ getTarget, canRestore });
  latest.current = { getTarget, canRestore };
  const mounted = useRef(false);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invocation = useRef<{
    key: Key;
    node: FocusNode;
    target: ReturnType<typeof getAccessibilityFocusTarget>;
  } | null>(null);

  const cancel = useCallback(() => {
    generation.current += 1;
    invocation.current = null;
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel(); };
  }, [cancel]);

  const open = useCallback((key: Key) => {
    cancel();
    if (!mounted.current) return;
    const node = latest.current.getTarget(key);
    invocation.current = { key, node, target: getAccessibilityFocusTarget(node) };
  }, [cancel]);

  const close = useCallback((restore = true) => {
    if (!restore) { cancel(); return; }
    const captured = invocation.current;
    if (!captured) return;
    cancel();
    if (captured.node == null || captured.target == null) return;
    const expectedGeneration = generation.current;
    // Android TalkBack은 창 전환 뒤 약 600ms까지 초기 포커스를 다시 고르므로 그 뒤에 복귀한다.
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!mounted.current || generation.current !== expectedGeneration || !latest.current.canRestore(captured.key)) return;
      const node = latest.current.getTarget(captured.key);
      if (node !== captured.node) return;
      const target = getAccessibilityFocusTarget(node);
      if (target != null && target === captured.target) focusAccessibilityTarget(target);
    }, Platform.OS === 'android' ? 700 : 250);
  }, [cancel]);

  return { open, close, cancel };
}
