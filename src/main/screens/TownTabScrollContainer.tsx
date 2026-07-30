import { useRef } from 'react';
import { ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { theme } from '../styles/theme';
import { TownTabScreen } from './TownTabScreen';

/** 마을 목록의 외부 ScrollView 위치를 상세 전환 동안 보존한다. */
export function TownTabScrollContainer() {
  const scrollRef = useRef<ScrollView>(null);
  const currentOffset = useRef(0);
  const capturedListOffset = useRef(0);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    currentOffset.current = event.nativeEvent.contentOffset.y;
  }

  return (
    <ScrollView
      accessibilityLabel="마을 화면 스크롤"
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      onScroll={handleScroll}
      ref={scrollRef}
      scrollEventThrottle={16}
      style={styles.scroller}
    >
      <TownTabScreen
        onCaptureListScroll={() => { capturedListOffset.current = currentOffset.current; }}
        onRestoreListScroll={() => {
          scrollRef.current?.scrollTo({ animated: false, y: capturedListOffset.current });
        }}
      />
    </ScrollView>
  );
}

const styles = {
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  scroller: {
    flex: 1,
  },
} as const;
