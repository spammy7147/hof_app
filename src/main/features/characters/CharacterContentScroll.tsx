import { useRef, type ElementRef, type ReactNode } from 'react';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';
import { scrollFocusedInputIntoView } from '../../components/keyboardAwareScroll';

/** 상세와 가져오기 본문만 스크롤한다. 탐색 헤더는 이 영역 밖에 둔다. */
export function CharacterContentScroll({ children }: { children: ReactNode }) {
  const ref = useRef<ElementRef<typeof NestableScrollContainer>>(null);
  return <NestableScrollContainer
    automaticallyAdjustKeyboardInsets
    contentContainerStyle={{ paddingBottom: 28 }}
    contentInsetAdjustmentBehavior="automatic"
    keyboardDismissMode="interactive"
    keyboardShouldPersistTaps="handled"
    onFocus={(event) => scrollFocusedInputIntoView(ref.current, event.nativeEvent.target)}
    ref={ref}
    style={{ flex: 1, minHeight: 0 }}
  >{children}</NestableScrollContainer>;
}
