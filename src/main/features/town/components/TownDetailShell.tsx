import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';

import type { TownMenu } from '../../../domain/townMenus';
import { theme } from '../../../styles/theme';

type TownDetailShellProps = {
  menu: TownMenu;
  onBack: () => void;
  children: ReactNode;
};

/** 하단 마을 탭을 유지하면서 기능별 panel을 담는 공통 상세 화면이다. */
export function TownDetailShell({ menu, onBack, children }: TownDetailShellProps) {
  const titleRef = useRef<Text>(null);

  useEffect(() => {
    const titleHandle = findNodeHandle(titleRef.current);
    if (titleHandle != null) AccessibilityInfo.setAccessibilityFocus(titleHandle);
  }, [menu.id]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="마을 메뉴 목록으로"
          accessibilityHint="이전 마을 메뉴 목록으로 돌아갑니다."
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backIcon}>‹</Text>
          <Text style={styles.backLabel}>목록</Text>
        </Pressable>
        <View style={styles.heading}>
          <Text accessibilityRole="header" accessible ref={titleRef} style={styles.title} testID="town-detail-title">
            {menu.label}
          </Text>
          <Text style={styles.subtitle}>마을 · {categoryLabel(menu.categoryId)}</Text>
        </View>
      </View>

      <View style={styles.body}>{children}</View>
    </View>
  );
}

function categoryLabel(categoryId: TownMenu['categoryId']): string {
  const labels: Record<TownMenu['categoryId'], string> = {
    life: '생활',
    market: '시장',
    pvp: 'PVP',
    agency: '알선소',
    home: '자택',
    smithy: '대장간',
    arcade: '상점가',
    card: '카드 가게',
    special: '특수 시설',
  };
  return labels[categoryId];
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: theme.spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing.sm,
  },
  backButton: {
    minWidth: 64,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
  },
  backIcon: {
    color: theme.colors.accentBlue,
    fontSize: 26,
    lineHeight: 28,
  },
  backLabel: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  heading: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  body: {
    flex: 1,
    minHeight: 160,
    gap: theme.spacing.xs,
  },
  pressed: {
    opacity: 0.75,
  },
});
