import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  findNodeHandle,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type View as NativeView,
} from 'react-native';

import {
  DEFAULT_TOWN_CATEGORY_ID,
  getTownMenuById,
  searchTownMenus,
  type TownCategoryFilterId,
  type TownMenuId,
} from '../domain/townMenus';
import { TownCategoryChips } from '../features/town/components/TownCategoryChips';
import { TownDetailShell } from '../features/town/components/TownDetailShell';
import { TownMenuGrid } from '../features/town/components/TownMenuGrid';
import { theme } from '../styles/theme';

export type TownTabScreenProps = {
  onCaptureListScroll?: () => void;
  onRestoreListScroll?: () => void;
};

/** 승인된 모든 마을 기능을 한 화면에서 검색하고 상세로 여는 단일 shell이다. */
export function TownTabScreen({ onCaptureListScroll, onRestoreListScroll }: TownTabScreenProps) {
  const [categoryId, setCategoryId] = useState<TownCategoryFilterId>(DEFAULT_TOWN_CATEGORY_ID);
  const [query, setQuery] = useState('');
  const [menuId, setMenuId] = useState<TownMenuId | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const menuTriggerRefs = useRef(new Map<TownMenuId, NativeView>());
  const pendingFocusRestore = useRef<TownMenuId | null>(null);

  const visibleMenus = useMemo(() => searchTownMenus(query, categoryId), [categoryId, query]);
  const selectedMenu = menuId == null ? null : getTownMenuById(menuId) ?? null;

  const closeDetail = useCallback(() => {
    pendingFocusRestore.current = menuId;
    setDetailOpen(false);
  }, [menuId]);

  useEffect(() => {
    if (!detailOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeDetail();
      return true;
    });
    return () => subscription.remove();
  }, [closeDetail, detailOpen]);

  useEffect(() => {
    const restoreMenuId = pendingFocusRestore.current;
    if (detailOpen || restoreMenuId == null) return;
    pendingFocusRestore.current = null;
    onRestoreListScroll?.();
    const triggerHandle = findNodeHandle(menuTriggerRefs.current.get(restoreMenuId) ?? null);
    if (triggerHandle != null) AccessibilityInfo.setAccessibilityFocus(triggerHandle);
  }, [detailOpen, onRestoreListScroll]);

  if (detailOpen && selectedMenu != null) {
    return <TownDetailShell menu={selectedMenu} onBack={closeDetail} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.intro}>
        <Text style={styles.title}>마을</Text>
        <Text style={styles.hint}>생활, 거래, 제작과 특수 시설을 한곳에서 이용하세요.</Text>
      </View>

      <View style={styles.searchField}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel="마을 메뉴 검색"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="메뉴명 검색"
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="search"
          style={styles.searchInput}
          value={query}
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityLabel="검색어 지우기"
            accessibilityRole="button"
            onPress={() => setQuery('')}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
          >
            <Text style={styles.clearLabel}>×</Text>
          </Pressable>
        ) : null}
      </View>

      <TownCategoryChips
        onSelectCategory={(nextCategoryId) => {
          setCategoryId(nextCategoryId);
          setMenuId(null);
          setDetailOpen(false);
        }}
        selectedCategoryId={categoryId}
      />

      <View style={styles.resultHeader}>
        <Text style={styles.resultTitle}>{categoryId === 'all' ? '전체 시설' : '선택한 시설'}</Text>
        <Text style={styles.resultCount}>{visibleMenus.length}개</Text>
      </View>

      <TownMenuGrid
        menus={visibleMenus}
        onSelectMenu={(nextMenuId) => {
          onCaptureListScroll?.();
          setMenuId(nextMenuId);
          setDetailOpen(true);
        }}
        onMenuTriggerRef={(nextMenuId, node) => {
          if (node == null) menuTriggerRefs.current.delete(nextMenuId);
          else menuTriggerRefs.current.set(nextMenuId, node);
        }}
        selectedMenuId={menuId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.md,
  },
  intro: {
    gap: theme.spacing.xs,
  },
  title: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  hint: {
    color: theme.colors.textMuted,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accentBlue,
    paddingLeft: theme.spacing.md,
    fontSize: 13,
    lineHeight: 19,
  },
  searchField: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
  },
  searchIcon: {
    color: theme.colors.textMuted,
    fontSize: 20,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 14,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  clearButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearLabel: {
    color: theme.colors.textMuted,
    fontSize: 24,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  resultCount: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
});
