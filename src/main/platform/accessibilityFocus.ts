import { AccessibilityInfo, findNodeHandle, Platform, UIManager } from 'react-native';

type FocusNode = Parameters<typeof findNodeHandle>[0];
type WebUIManager = { focus(node: FocusNode): void };

/** 웹은 DOM ref 자체를, 네이티브는 handle을 보존해 호출 당시의 대상을 식별한다. */
export function getAccessibilityFocusTarget(node: FocusNode) {
  return Platform.OS === 'web' ? node : findNodeHandle(node);
}

/** RN Web의 UIManager가 제목 등 비대화형 요소에도 programmatic focus를 허용한다. */
export function focusAccessibilityTarget(target: ReturnType<typeof getAccessibilityFocusTarget>) {
  if (target == null) return;
  // 웹의 DOM focus는 RN 네이티브 타입에 선언되어 있지 않다.
  if (Platform.OS === 'web') (UIManager as typeof UIManager & WebUIManager).focus(target);
  else AccessibilityInfo.setAccessibilityFocus(target as number);
}
