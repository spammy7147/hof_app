import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';

import type { TownMenu } from '../../../domain/townMenus';
import { theme } from '../../../styles/theme';

type TownDetailShellProps = {
  menu: TownMenu;
  onBack: () => void;
  children?: ReactNode;
};

/** 하단 마을 탭을 유지하면서 기능별 panel을 담는 공통 상세 화면이다. */
export function TownDetailShell({ menu, onBack, children }: TownDetailShellProps) {
  const titleRef = useRef<Text>(null);

  useEffect(() => {
    const titleHandle = findNodeHandle(titleRef.current);
    if (titleHandle != null) AccessibilityInfo.setAccessibilityFocus(titleHandle);
  }, []);

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

      <View style={styles.body}>
        {children ?? (
          <>
            <Text style={styles.placeholderTitle}>{menu.label}</Text>
            <Text style={styles.placeholderText}>기능 연결을 준비하고 있습니다.</Text>
          </>
        )}
      </View>
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
    gap: theme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing.md,
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
    gap: theme.spacing.xs,
  },
  title: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  body: {
    minHeight: 160,
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  placeholderTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  placeholderText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  pressed: {
    opacity: 0.75,
  },
});
