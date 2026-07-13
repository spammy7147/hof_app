import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import {
  DEFAULT_TOWN_CATEGORY_ID,
  DEFAULT_TOWN_SECTION_ID,
  TOWN_CATEGORIES,
  getTownMenusForCategory,
  type TownCategoryId,
  type TownMenuId,
  type TownSectionId,
} from '../domain/townMenus';
import { theme } from '../styles/theme';
import { TOWN_ICON_SOURCES } from './townAssets';

/** APK의 마을 기능을 고정 카테고리로 탐색하는 화면이다. */
export function TownTabScreen() {
  const [selectedSectionId, setSelectedSectionId] = useState<TownSectionId>(DEFAULT_TOWN_SECTION_ID);
  const [selectedCategoryId, setSelectedCategoryId] = useState<TownCategoryId>(DEFAULT_TOWN_CATEGORY_ID);
  const [selectedMenuId, setSelectedMenuId] = useState<TownMenuId | null>(null);

  const visibleMenus = useMemo(
    () => getTownMenusForCategory(selectedCategoryId),
    [selectedCategoryId],
  );
  const selectedMenu = visibleMenus.find((menu) => menu.id === selectedMenuId) ?? null;

  function selectCategory(categoryId: TownCategoryId) {
    setSelectedCategoryId(categoryId);
    setSelectedMenuId(null);
  }

  return (
    <View style={styles.container}>
      <View accessibilityRole="tablist" style={styles.sectionTabs}>
        <SectionTab
          active={selectedSectionId === 'town'}
          label="마을"
          onPress={() => setSelectedSectionId('town')}
        />
        <SectionTab
          active={selectedSectionId === 'quest'}
          label="퀘·교환"
          onPress={() => setSelectedSectionId('quest')}
        />
      </View>

      {selectedSectionId === 'town' ? (
        <>
          <Text style={styles.hint}>상점·생활·교환 기능을 분류별로 선택하세요.</Text>

          <View accessibilityRole="tablist" style={styles.categoryTabs}>
            {TOWN_CATEGORIES.map((category) => {
              const active = category.id === selectedCategoryId;
              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  key={category.id}
                  onPress={() => selectCategory(category.id)}
                  style={({ pressed }) => [
                    styles.categoryTab,
                    active && styles.activeCategoryTab,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.categoryLabel, active && styles.activeCategoryLabel]}>
                    {category.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.menuGrid}>
            {visibleMenus.map((menu) => {
              const selected = menu.id === selectedMenuId;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={menu.id}
                  onPress={() => setSelectedMenuId(menu.id)}
                  style={({ pressed }) => [
                    styles.menuButton,
                    selected && styles.selectedMenuButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Image
                    accessible={false}
                    contentFit="contain"
                    source={TOWN_ICON_SOURCES[menu.iconId]}
                    style={styles.menuIcon}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.menuLabel, selected && styles.selectedMenuLabel]}
                  >
                    {menu.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.selectionPanel}>
            <Text style={styles.selectionTitle}>
              {selectedMenu?.label ?? '메뉴를 선택해 주세요'}
            </Text>
            <Text style={styles.selectionText}>
              {selectedMenu ? '서비스 준비 중' : '원하는 마을 기능을 누르면 여기에 표시돼요.'}
            </Text>
          </View>
        </>
      ) : (
        <View style={styles.selectionPanel}>
          <Text style={styles.selectionTitle}>퀘·교환</Text>
          <Text style={styles.selectionText}>퀘스트와 교환 기능을 연결할 준비 화면이에요.</Text>
        </View>
      )}
    </View>
  );
}

function SectionTab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sectionTab,
        active && styles.activeSectionTab,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.sectionLabel, active && styles.activeSectionLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.md,
  },
  sectionTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sectionTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  activeSectionTab: {
    borderBottomColor: theme.colors.accentBlue,
  },
  sectionLabel: {
    color: theme.colors.textMuted,
    fontSize: 16,
    fontWeight: '800',
  },
  activeSectionLabel: {
    color: theme.colors.text,
  },
  hint: {
    color: theme.colors.textMuted,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accentBlue,
    paddingLeft: theme.spacing.md,
    fontSize: 13,
    lineHeight: 19,
  },
  categoryTabs: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  categoryTab: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
  },
  activeCategoryTab: {
    borderColor: theme.colors.accentBlue,
    backgroundColor: theme.colors.surfaceAlt,
  },
  categoryLabel: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  activeCategoryLabel: {
    color: theme.colors.text,
  },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.sm,
  },
  menuButton: {
    width: '48.7%',
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.sm,
  },
  selectedMenuButton: {
    borderColor: theme.colors.accentAmber,
    backgroundColor: theme.colors.surfaceAlt,
  },
  menuIcon: {
    width: 24,
    height: 24,
  },
  menuLabel: {
    flexShrink: 1,
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  selectedMenuLabel: {
    color: theme.colors.accentAmber,
  },
  selectionPanel: {
    minHeight: 96,
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  selectionTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  selectionText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  pressed: {
    opacity: 0.75,
  },
});
