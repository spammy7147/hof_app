import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import {
  TOWN_CATEGORIES,
  type TownCategoryFilterId,
} from '../../../domain/townMenus';
import { theme } from '../../../styles/theme';

type TownCategoryChipsProps = {
  selectedCategoryId: TownCategoryFilterId;
  onSelectCategory: (categoryId: TownCategoryFilterId) => void;
};

const ALL_CATEGORY = { id: 'all' as const, label: '전체' };

/** 좁은 모바일 화면에서도 모든 마을 분류를 탐색할 수 있는 가로 칩 목록이다. */
export function TownCategoryChips({
  selectedCategoryId,
  onSelectCategory,
}: TownCategoryChipsProps) {
  return (
    <ScrollView
      accessibilityLabel="마을 메뉴 분류"
      contentContainerStyle={styles.content}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {[ALL_CATEGORY, ...TOWN_CATEGORIES].map((category) => {
        const selected = selectedCategoryId === category.id;
        return (
          <Pressable
            accessibilityLabel={`${category.label} 분류`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={category.id}
            onPress={() => onSelectCategory(category.id)}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.selectedChip,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]}>{category.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.md,
  },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.lg,
  },
  selectedChip: {
    borderColor: theme.colors.accentBlue,
    backgroundColor: theme.colors.surfaceAlt,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  selectedLabel: {
    color: theme.colors.text,
  },
  pressed: {
    opacity: 0.75,
  },
});
