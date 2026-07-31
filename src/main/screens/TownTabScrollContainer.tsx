import { useRef, useState } from 'react';
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { theme } from '../styles/theme';
import { TownTabScreen } from './TownTabScreen';
import type { TownApi } from '../features/town/api/townApi';
import type { FishingBattleTarget } from '../types/api';
import type { TownMenuId } from '../domain/townMenus';

/** 마을 목록의 외부 ScrollView 위치를 상세 전환 동안 보존한다. */
export function TownTabScrollContainer({ townApi, resolveCaptcha, onOpenFishingBattle }: {
  townApi?: TownApi;
  resolveCaptcha?: () => Promise<void>;
  onOpenFishingBattle?: (target: FishingBattleTarget) => void;
} = {}) {
  const scrollRef = useRef<ScrollView>(null);
  const currentOffset = useRef(0);
  const capturedListOffset = useRef(0);
  const [menuId, setMenuId] = useState<TownMenuId | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    currentOffset.current = event.nativeEvent.contentOffset.y;
  }

  return (
    <View accessibilityLabel="마을 탭 컨테이너" style={styles.scroller}>
      <TownTabScreen
        townApi={townApi}
        resolveCaptcha={resolveCaptcha}
        onOpenFishingBattle={onOpenFishingBattle}
        controlledMenuId={menuId}
        controlledDetailOpen={detailOpen}
        onDetailStateChange={(nextMenuId, open) => { setMenuId(nextMenuId); setDetailOpen(open); }}
        onCaptureListScroll={() => { capturedListOffset.current = currentOffset.current; }}
        onRestoreListScroll={() => {
          scrollRef.current?.scrollTo({ animated: false, y: capturedListOffset.current });
        }}
        renderContent={(content, virtualized) => virtualized ? (
          <View accessibilityLabel="마을 가상 목록 화면" style={[styles.scroller, styles.container]}>{content}</View>
        ) : (
          <ScrollView
            accessibilityLabel="마을 화면 스크롤"
            contentContainerStyle={styles.container}
            contentInsetAdjustmentBehavior="automatic"
            onScroll={handleScroll}
            ref={scrollRef}
            scrollEventThrottle={16}
            style={styles.scroller}
          >
            {content}
          </ScrollView>
        )}
      />
    </View>
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
