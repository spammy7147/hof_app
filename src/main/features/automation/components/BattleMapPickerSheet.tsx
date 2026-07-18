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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  buildQuestMapIdentity,
  filterQuestMapOptions,
  type QuestMapFilter,
} from '../../../domain/questAutomation';
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
  onSelect: (map: BattleMapResponse) => void;
};

const FILTERS: ReadonlyArray<{ value: QuestMapFilter; label: string }> = [
  { value: 'ALL', label: '전체' },
  { value: 'BATTLE', label: '전투맵' },
  { value: 'ADVENTURE', label: '모험맵' },
];

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
  onSelect,
}: BattleMapPickerSheetProps) {
  const { bottom } = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<QuestMapFilter>('ALL');
  const titleRef = useRef<ElementRef<typeof Text>>(null);
  const selected = useMemo(() => new Set(selectedMapIdentities), [selectedMapIdentities]);
  const results = useMemo(() => filterQuestMapOptions(maps, query, filter), [filter, maps, query]);
  const subtitle = target?.trim() ? target : '실행할 맵을 선택해 주세요.';
  const title = mode === 'REPLACE' ? '전투맵 변경' : '전투맵 추가';
  const actionLabel = mode === 'REPLACE' ? '변경' : '추가';

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setFilter('ALL');
  }, [visible]);

  function handleShow() {
    const titleNode = findNodeHandle(titleRef.current);
    if (titleNode != null) AccessibilityInfo.setAccessibilityFocus(titleNode);
  }

  function renderMap({ item }: { item: BattleMapResponse }) {
    const identity = buildQuestMapIdentity(item);
    const alreadySelected = selected.has(identity);
    const disabled = alreadySelected || loading;
    const categoryLabel = item.categoryId === 'battle_map' ? '전투맵' : '모험맵';
    const displayedAction = alreadySelected
      ? (mode === 'REPLACE' ? '선택됨' : '추가됨')
      : actionLabel;

    return (
      <View style={styles.mapRow}>
        <View style={styles.mapCopy}>
          <Text style={styles.mapName}>{item.name}</Text>
          {item.groupName ? <Text style={styles.groupName}>{item.groupName}</Text> : null}
          <Text style={styles.category}>{categoryLabel}</Text>
        </View>
        <Pressable
          accessibilityLabel={`${item.name} ${displayedAction}`}
          accessibilityRole="button"
          accessibilityState={{ disabled, selected: alreadySelected }}
          disabled={disabled}
          onPress={() => {
            if (alreadySelected || loading) return;
            onSelect(item);
          }}
          style={({ pressed }) => [
            styles.addButton,
            disabled && styles.addButtonDisabled,
            pressed && !disabled && styles.pressed,
          ]}
        >
          <Text style={[styles.addButtonText, disabled && styles.addButtonTextDisabled]}>
            {displayedAction}
          </Text>
        </Pressable>
      </View>
    );
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

            <View accessibilityRole="radiogroup" style={styles.filterRow}>
              {FILTERS.map(({ value, label }) => {
                const checked = filter === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityLabel={`전투맵 필터 ${label}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked }}
                    accessibilityValue={{ text: value }}
                    onPress={() => setFilter(value)}
                    style={({ pressed }) => [
                      styles.filterChip,
                      checked && styles.filterChipSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.filterText, checked && styles.filterTextSelected]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

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
                data={results}
                extraData={`${selectedMapIdentities.join('\u0001')}\u0000${loading}`}
                keyExtractor={buildQuestMapIdentity}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<Text style={styles.emptyText}>검색 결과가 없습니다.</Text>}
                renderItem={renderMap}
                style={styles.list}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
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
  filterRow: { flexDirection: 'row', gap: theme.spacing.sm, marginVertical: theme.spacing.md },
  filterChip: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: 22, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: theme.spacing.md },
  filterChipSelected: { backgroundColor: theme.colors.accentGreen, borderColor: theme.colors.accentGreen },
  filterText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800' },
  filterTextSelected: { color: theme.colors.buttonText },
  list: { flexShrink: 1 },
  listContent: { gap: theme.spacing.sm },
  mapRow: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md * 2, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 76, padding: theme.spacing.md },
  mapCopy: { flex: 1, minWidth: 0 },
  mapName: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  groupName: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  category: { color: theme.colors.accentGreen, fontSize: 10, fontWeight: '800', marginTop: 3 },
  addButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 44, minWidth: 56, paddingHorizontal: theme.spacing.md },
  addButtonDisabled: { backgroundColor: theme.colors.surfaceAlt },
  addButtonText: { color: theme.colors.buttonText, fontSize: 12, fontWeight: '900' },
  addButtonTextDisabled: { color: theme.colors.textMuted },
  state: { alignItems: 'center', gap: theme.spacing.md, justifyContent: 'center', minHeight: 132, paddingBottom: theme.spacing.xl },
  stateText: { color: theme.colors.textMuted, fontSize: 13 },
  errorText: { color: theme.colors.danger, fontSize: 13, fontWeight: '800' },
  retryButton: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: theme.spacing.lg },
  retryText: { color: theme.colors.text, fontSize: 12, fontWeight: '900' },
  emptyText: { color: theme.colors.textMuted, fontSize: 13, paddingVertical: theme.spacing.xl, textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
