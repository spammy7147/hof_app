import { useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  findNodeHandle,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  buildQuestMapCatalogGroupKey,
  buildQuestMapCatalogRows,
  type QuestMapCatalogRow,
} from '../../../domain/questMapCatalog';
import { theme } from '../../../styles/theme';
import type { BattleMapResponse } from '../../../types/api';

export type BattleMapPickerSheetProps = {
  visible: boolean;
  mode: 'ADD' | 'REPLACE';
  target: string | null;
  maps: BattleMapResponse[];
  selectedMapIdentities: string[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onToggle: (map: BattleMapResponse) => void;
};

export function BattleMapPickerSheet({
  visible,
  mode,
  target,
  maps,
  selectedMapIdentities,
  loading,
  error,
  onClose,
  onRetry,
  onToggle,
}: BattleMapPickerSheetProps) {
  const { bottom } = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => defaultCategoryIds(maps));
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() => defaultGroupKeys(maps));
  const titleRef = useRef<ElementRef<typeof Text>>(null);
  const selectedIdentities = useMemo(() => new Set(selectedMapIdentities), [selectedMapIdentities]);
  const rows = useMemo(() => buildQuestMapCatalogRows({
    maps,
    selectedIdentities,
    expandedCategoryIds,
    expandedGroupKeys,
    query,
  }), [expandedCategoryIds, expandedGroupKeys, maps, query, selectedIdentities]);
  const subtitle = target?.trim() ? target : '실행할 맵을 선택해 주세요.';
  const title = mode === 'REPLACE' ? '전투맵 변경' : '전투맵 추가';
  const searching = query.trim().length > 0;

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setExpandedCategoryIds(defaultCategoryIds(maps));
    setExpandedGroupKeys(defaultGroupKeys(maps));
  }, [visible]);

  function handleShow() {
    const titleNode = findNodeHandle(titleRef.current);
    if (titleNode != null) AccessibilityInfo.setAccessibilityFocus(titleNode);
  }

  function toggleCategory(categoryId: string) {
    if (searching) return;
    setExpandedCategoryIds((current) => toggleSetValue(current, categoryId));
  }

  function toggleGroup(groupKey: string) {
    if (searching) return;
    setExpandedGroupKeys((current) => toggleSetValue(current, groupKey));
  }

  function renderRow({ item }: { item: QuestMapCatalogRow }) {
    if (item.kind === 'SELECTED_HEADING') {
      return <Text accessibilityRole="header" style={styles.selectedHeading}>선택한 맵</Text>;
    }
    if (item.kind === 'CATEGORY') {
      const action = item.expanded ? '닫기' : '열기';
      return (
        <Pressable
          accessibilityLabel={searching ? `${item.label} 카테고리 검색 결과` : `${item.label} 카테고리 ${action}`}
          accessibilityRole="button"
          accessibilityState={searching ? { disabled: true, expanded: item.expanded } : { expanded: item.expanded }}
          disabled={searching}
          onPress={() => toggleCategory(item.categoryId)}
          style={({ pressed }) => [styles.categoryRow, pressed && !searching && styles.pressed]}
        >
          <Text style={styles.categoryName}>{item.label}</Text>
          <View style={styles.trailing}>
            <Text style={styles.count}>{item.count}개</Text>
            {item.expanded
              ? <ChevronDown color={theme.colors.textMuted} size={18} />
              : <ChevronRight color={theme.colors.textMuted} size={18} />}
          </View>
        </Pressable>
      );
    }
    if (item.kind === 'GROUP') {
      const action = item.expanded ? '닫기' : '열기';
      return (
        <Pressable
          accessibilityLabel={searching ? `${item.name} 그룹 검색 결과` : `${item.name} 그룹 ${action}`}
          accessibilityRole="button"
          accessibilityState={searching ? { disabled: true, expanded: item.expanded } : { expanded: item.expanded }}
          disabled={searching}
          onPress={() => toggleGroup(item.groupKey)}
          style={({ pressed }) => [styles.groupRow, pressed && !searching && styles.pressed]}
        >
          <View style={styles.rowCopy}>
            <Text numberOfLines={1} style={styles.groupName}>{item.name}</Text>
            <Text style={styles.meta}>{item.meta}</Text>
          </View>
          {item.expanded
            ? <ChevronDown color={theme.colors.textMuted} size={18} />
            : <ChevronRight color={theme.colors.textMuted} size={18} />}
        </Pressable>
      );
    }

    return renderMapCard(item.map, item.kind === 'SELECTED_MAP', loading, onToggle);
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} onShow={handleShow} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityHint="전투맵 선택 창을 닫습니다"
          accessibilityLabel="전투맵 선택 배경 닫기"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
          pointerEvents="box-none"
          style={styles.keyboardAvoiding}
        >
          <View accessibilityLabel="전투맵 선택" accessibilityViewIsModal style={[styles.panel, { paddingBottom: bottom }]}>
            <View style={styles.dragHandle} />
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text ref={titleRef} accessibilityLabel={title} accessibilityRole="header" style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
              </View>
              <Pressable
                accessibilityHint="전투맵 선택 창을 닫습니다"
                accessibilityLabel="전투맵 선택 닫기"
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>

            <TextInput
              accessibilityLabel="전투맵 검색"
              onChangeText={setQuery}
              placeholder="맵 이름 또는 지역 검색"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.search}
              value={query}
            />

            {loading ? (
              <View accessibilityLiveRegion="polite" style={styles.state}>
                <ActivityIndicator color={theme.colors.accentGreen} />
                <Text style={styles.stateText}>전투맵을 불러오는 중입니다.</Text>
              </View>
            ) : error ? (
              <View accessibilityLiveRegion="polite" style={styles.state}>
                <Text style={styles.errorText}>전투맵을 불러오지 못했어요.</Text>
                <Pressable
                  accessibilityLabel="전투맵 다시 불러오기"
                  accessibilityRole="button"
                  onPress={onRetry}
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.retryText}>다시 불러오기</Text>
                </Pressable>
              </View>
            ) : (
              <FlatList
                contentContainerStyle={[styles.listContent, { paddingBottom: theme.spacing.xl }]}
                data={rows}
                extraData={`${selectedMapIdentities.join('\u0001')}\u0000${loading}`}
                keyExtractor={({ key }) => key}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<Text style={styles.emptyText}>검색 결과가 없습니다.</Text>}
                renderItem={renderRow}
                style={styles.list}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function renderMapCard(
  map: BattleMapResponse,
  selected: boolean,
  loading: boolean,
  onToggle: (map: BattleMapResponse) => void,
) {
  const selectable = Boolean(map.mapCode?.trim());
  const disabled = loading || !selectable;
  const meta = [map.groupName?.trim() || null, map.recommendedLevel?.trim() ? `Lv ${map.recommendedLevel.trim()}` : null]
    .filter((part): part is string => part != null)
    .join(' · ');
  return (
    <Pressable
      accessibilityLabel={`${map.name} 맵 ${selected ? '선택 해제' : '선택'}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={() => { if (!disabled) onToggle(map); }}
      style={({ pressed }) => [
        styles.mapRow,
        selected && styles.mapRowSelected,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text numberOfLines={2} style={styles.mapName}>{map.name}</Text>
      {meta ? <Text numberOfLines={1} style={styles.meta}>{meta}</Text> : null}
    </Pressable>
  );
}

function defaultCategoryIds(maps: readonly BattleMapResponse[]): Set<string> {
  return new Set(maps.filter(isSupportedMap).map(({ categoryId }) => categoryId));
}

function defaultGroupKeys(maps: readonly BattleMapResponse[]): Set<string> {
  return new Set(maps.filter(isSupportedMap).map(buildQuestMapCatalogGroupKey));
}

function isSupportedMap(map: BattleMapResponse): boolean {
  return map.resolved && (map.categoryId === 'battle_map' || map.categoryId === 'adventure_map');
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: theme.colors.overlay, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  keyboardAvoiding: { flex: 1, justifyContent: 'flex-end' },
  panel: { backgroundColor: theme.colors.header, borderColor: theme.colors.borderStrong, borderTopLeftRadius: theme.radius.md * 3, borderTopRightRadius: theme.radius.md * 3, borderTopWidth: 1, maxHeight: '84%', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm },
  dragHandle: { alignSelf: 'center', backgroundColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, height: 4, marginBottom: theme.spacing.md, width: 42 },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: theme.spacing.md, marginBottom: theme.spacing.md },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: theme.spacing.xs },
  closeButton: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  closeText: { color: theme.colors.textMuted, fontSize: 26, fontWeight: '300', lineHeight: 30 },
  search: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, color: theme.colors.text, fontSize: 14, minHeight: 44, paddingHorizontal: theme.spacing.md },
  list: { flexShrink: 1, marginTop: theme.spacing.md },
  listContent: { gap: 6 },
  selectedHeading: { color: theme.colors.text, fontSize: 13, fontWeight: '900', paddingHorizontal: 2, paddingVertical: 4 },
  categoryRow: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', minHeight: 54, paddingHorizontal: theme.spacing.md, paddingVertical: 6 },
  categoryName: { color: theme.colors.text, flex: 1, fontSize: 14, fontWeight: '900' },
  trailing: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  count: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' },
  groupRow: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, marginLeft: theme.spacing.md, minHeight: 48, paddingHorizontal: theme.spacing.md, paddingVertical: 5 },
  rowCopy: { flex: 1, minWidth: 0 },
  groupName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  mapRow: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, marginLeft: theme.spacing.lg, minHeight: 46, paddingHorizontal: theme.spacing.md, paddingVertical: 7 },
  mapRowSelected: { backgroundColor: theme.colors.surface, borderColor: theme.colors.accentGreen, marginLeft: 0 },
  mapName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  meta: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  disabled: { opacity: 0.55 },
  state: { alignItems: 'center', gap: theme.spacing.md, justifyContent: 'center', minHeight: 132, paddingBottom: theme.spacing.xl },
  stateText: { color: theme.colors.textMuted, fontSize: 13 },
  errorText: { color: theme.colors.danger, fontSize: 13, fontWeight: '800' },
  retryButton: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: theme.spacing.lg },
  retryText: { color: theme.colors.text, fontSize: 12, fontWeight: '900' },
  emptyText: { color: theme.colors.textMuted, fontSize: 13, paddingVertical: theme.spacing.xl, textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
