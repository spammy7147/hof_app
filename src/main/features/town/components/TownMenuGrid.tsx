import { Image } from 'expo-image';
import { FlatList, Pressable, StyleSheet, Text, View, type View as NativeView } from 'react-native';

import type { TownMenu, TownMenuId } from '../../../domain/townMenus';
import { TOWN_ICON_SOURCES } from '../../../screens/townAssets';
import { theme } from '../../../styles/theme';

type TownMenuGridProps = {
  menus: readonly TownMenu[];
  selectedMenuId: TownMenuId | null;
  onSelectMenu: (menuId: TownMenuId) => void;
  onMenuTriggerRef?: (menuId: TownMenuId, node: NativeView | null) => void;
};

/** 마을 기능을 긴 이름도 읽을 수 있는 모바일 2열 카드로 표시한다. */
export function TownMenuGrid({
  menus,
  selectedMenuId,
  onSelectMenu,
  onMenuTriggerRef,
}: TownMenuGridProps) {
  return (
    <FlatList
      columnWrapperStyle={styles.row}
      data={[...menus]}
      // 외부 ScrollView가 이동을 맡으므로 복귀 직후에도 전체 메뉴 높이가 필요하다.
      initialNumToRender={menus.length}
      keyExtractor={({ id }) => id}
      ListEmptyComponent={<EmptyMenuList />}
      numColumns={2}
      renderItem={({ item }) => {
        const selected = item.id === selectedMenuId;
        return (
          <View style={styles.cell}>
            <Pressable
              accessibilityLabel={`${item.label} 열기`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelectMenu(item.id)}
              ref={(node) => onMenuTriggerRef?.(item.id, node)}
              style={({ pressed }) => [
                styles.card,
                selected && styles.selectedCard,
                pressed && styles.pressed,
              ]}
            >
              <Image
                accessible={false}
                contentFit="contain"
                source={TOWN_ICON_SOURCES[item.iconId]}
                style={styles.icon}
              />
              <Text
                numberOfLines={2}
                style={[styles.label, selected && styles.selectedLabel]}
                testID="town-menu-label"
              >
                {item.label}
              </Text>
            </Pressable>
          </View>
        );
      }}
      scrollEnabled={false}
    />
  );
}

function EmptyMenuList() {
  return (
    <View accessibilityLiveRegion="polite" style={styles.empty}>
      <Text style={styles.emptyTitle}>검색 결과가 없습니다.</Text>
      <Text style={styles.emptyText}>다른 메뉴명이나 분류를 선택해 보세요.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  cell: {
    flex: 1,
    maxWidth: '50%',
  },
  card: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  selectedCard: {
    borderColor: theme.colors.accentAmber,
    backgroundColor: theme.colors.surfaceAlt,
  },
  icon: {
    width: 26,
    height: 26,
  },
  label: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  selectedLabel: {
    color: theme.colors.accentAmber,
  },
  empty: {
    minHeight: 128,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
});
