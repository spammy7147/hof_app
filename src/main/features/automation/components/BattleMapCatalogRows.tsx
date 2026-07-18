import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';

import { formatAutomationMapListMeta, formatAutomationMapListName, type BattleMapGroup } from '../../../domain/battleMaps';
import { theme } from '../../../styles/theme';
import type { BattleCategoryResponse, BattleMapResponse } from '../../../types/api';

type BattleMapCatalogCategoryRowProps = {
  category: BattleCategoryResponse;
  expanded: boolean;
  mapCount: number | null;
  onPress: () => void;
};

export function BattleMapCatalogCategoryRow({
  category,
  expanded,
  mapCount,
  onPress,
}: BattleMapCatalogCategoryRowProps) {
  const action = expanded ? '닫기' : '열기';

  return (
    <Pressable
      accessibilityLabel={`${category.label} 카테고리 ${action}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={styles.category}
    >
      <View style={styles.rowContent}>
        <Text style={styles.categoryName}>{category.label}</Text>
        {category.description ? <Text style={styles.description}>{category.description}</Text> : null}
      </View>
      <View style={styles.trailing}>
        <Text style={styles.count}>{mapCount == null ? '확인 중' : `${mapCount}개`}</Text>
        {expanded
          ? <ChevronDown color={theme.colors.textMuted} size={18} />
          : <ChevronRight color={theme.colors.textMuted} size={18} />}
      </View>
    </Pressable>
  );
}

type BattleMapCatalogGroupRowProps = {
  group: BattleMapGroup;
  expanded: boolean;
  onPress: () => void;
};

export function BattleMapCatalogGroupRow({ group, expanded, onPress }: BattleMapCatalogGroupRowProps) {
  const action = expanded ? '닫기' : '열기';
  const details = [group.recommendedLevel == null ? null : `Lv ${group.recommendedLevel}`, `${group.maps.length}개`]
    .filter((detail): detail is string => detail != null)
    .join(' · ');

  return (
    <Pressable
      accessibilityLabel={`${group.name} 그룹 ${action}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={styles.group}
    >
      <View style={styles.rowContent}>
        <Text style={styles.groupName}>{group.name}</Text>
        <Text style={styles.meta}>{details}</Text>
      </View>
      {expanded
        ? <ChevronDown color={theme.colors.textMuted} size={18} />
        : <ChevronRight color={theme.colors.textMuted} size={18} />}
    </Pressable>
  );
}

type BattleMapCatalogMapRowProps = {
  map: BattleMapResponse;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
};

export function BattleMapCatalogMapRow({ map, selected, disabled, onPress }: BattleMapCatalogMapRowProps) {
  const name = formatAutomationMapListName(map);
  const meta = formatAutomationMapListMeta(map);

  return (
    <Pressable
      accessibilityLabel={`${name} 맵 선택`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={() => { if (!disabled) onPress(); }}
      style={[styles.map, selected && styles.mapSelected, disabled && styles.disabled]}
    >
      <View style={styles.rowContent}>
        <Text style={styles.mapName}>{name}</Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      {selected ? <Text style={styles.selected}>선택됨</Text> : null}
    </Pressable>
  );
}

type BattleMapCatalogStateRowProps = {
  category: BattleCategoryResponse;
  state: 'loading' | 'error' | 'empty';
  error: string | null;
  onRetry: () => void;
};

export function BattleMapCatalogStateRow({ category, state, error, onRetry }: BattleMapCatalogStateRowProps) {
  if (state === 'loading') {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={theme.colors.accentGreen} />
        <Text style={styles.stateText}>{category.label} 맵 불러오는 중</Text>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={styles.state}>
        <Text style={styles.errorText}>{error?.trim() || `${category.label} 맵을 불러오지 못했어요.`}</Text>
        <Pressable
          accessibilityLabel={`${category.label} 맵 다시 불러오기`}
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.retry}
        >
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.state}>
      <Text style={styles.stateText}>{category.label} 맵이 없습니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  category: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    minHeight: 52,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  categoryName: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  count: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  description: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  disabled: { opacity: 0.55 },
  errorText: { color: theme.colors.accentAmber, flex: 1, fontSize: 12, lineHeight: 18 },
  group: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginLeft: theme.spacing.lg,
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
  },
  groupName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  map: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginLeft: theme.spacing.xl,
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  mapName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  mapSelected: { backgroundColor: theme.colors.surface, borderColor: theme.colors.accentGreen },
  meta: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  retry: { justifyContent: 'center', minHeight: 44, paddingHorizontal: theme.spacing.sm },
  retryText: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '900' },
  rowContent: { flex: 1 },
  selected: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '900' },
  state: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 44, paddingHorizontal: theme.spacing.xl },
  stateText: { color: theme.colors.textMuted, fontSize: 12 },
  trailing: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
});
