import { Image } from 'expo-image';
import { useRef, type ReactElement, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { scrollFocusedInputIntoView } from '../../../components/keyboardAwareScroll';
import { FixedBottomAction } from '../../../components/FixedBottomAction';
import { theme } from '../../../styles/theme';
import type { TownRowResponse } from '../../../types/api';

type TownItemListProps = {
  rows: TownRowResponse[];
  selectionMode?: 'none' | 'single' | 'multiple' | 'grouped-single' | 'mixed';
  selectedIds?: readonly string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  selectionGroup?: (row: TownRowResponse) => string;
  selectionRole?: (row: TownRowResponse) => 'radio' | 'checkbox';
  /** 한 가상 목록 안에서 기록/안내 행만 선택 control이 아닌 텍스트로 표시한다. */
  displayOnlyRow?: (row: TownRowResponse) => boolean;
  emptyMessage?: string | null;
  header?: ReactElement | null;
  stickyHeader?: boolean;
  footer?: ReactElement | null;
  fixedAction?: ReactElement | null;
  style?: StyleProp<ViewStyle>;
  labelTextStyle?: StyleProp<TextStyle> | ((row: TownRowResponse) => StyleProp<TextStyle>);
  renderTrailing?: (row: TownRowResponse) => ReactNode;
  renderItemFooter?: (row: TownRowResponse) => ReactNode;
  renderSelectedFooter?: (row: TownRowResponse) => ReactNode;
  showSelectionAvailability?: boolean;
  selectionDisabled?: boolean;
};

/** 긴 HOF 후보 목록을 가상화하고 서버가 허용한 행만 선택하게 한다. */
export function TownItemList({
  rows,
  selectionMode = 'none',
  selectedIds = [],
  onSelectionChange,
  selectionGroup,
  selectionRole,
  displayOnlyRow,
  emptyMessage = '표시할 항목이 없습니다.',
  header,
  stickyHeader = false,
  footer,
  fixedAction,
  style,
  labelTextStyle,
  renderTrailing,
  renderItemFooter,
  renderSelectedFooter,
  showSelectionAvailability = false,
  selectionDisabled = false,
}: TownItemListProps) {
  const selected = new Set(selectedIds);
  const listRef = useRef<FlatList<TownRowResponse>>(null);
  const displayedRows = showSelectionAvailability
    ? rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => Number(right.row.selectable) - Number(left.row.selectable) || left.index - right.index)
      .map(({ row }) => row)
    : rows;

  return (
    <>
      <FlatList
      automaticallyAdjustKeyboardInsets
      ref={listRef}
      onFocus={(event) => scrollFocusedInputIntoView(listRef.current, event.nativeEvent.target)}
      style={style}
      data={displayedRows}
      keyExtractor={(row) => row.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      nestedScrollEnabled
      initialNumToRender={12}
      windowSize={7}
      ListHeaderComponent={header}
      stickyHeaderIndices={stickyHeader && header != null ? [0] : undefined}
      ListFooterComponent={footer}
      ListEmptyComponent={emptyMessage == null ? null : <Text style={styles.empty}>{emptyMessage}</Text>}
      renderItem={({ item }) => {
        const isSelected = selected.has(item.id);
        const displayOnly = selectionMode === 'none' || displayOnlyRow?.(item) === true;
        const disabled = !item.selectable || displayOnly || !onSelectionChange || selectionDisabled;
        const accessibilityRole = displayOnly
          ? 'text'
          : selectionRole?.(item) ?? (selectionMode === 'single' || selectionMode === 'grouped-single'
            ? 'radio'
            : selectionMode === 'multiple' ? 'checkbox' : 'text');
        const accessibilityState = displayOnly
          ? undefined
          : { disabled, checked: isSelected };
        const accessibilityLabel = item.accessibilityLabel ?? (displayOnly
          ? item.label
          : `${selectionMode === 'grouped-single' && item.detail ? `${item.detail} ` : ''}${item.label}${disabled ? ' 선택 불가' : ' 선택'}`);
        const handlePress = () => {
          if (!onSelectionChange) return;
          if (selectionMode === 'single') {
            onSelectionChange([item.id]);
            return;
          }
          if (selectionMode === 'grouped-single' || selectionMode === 'mixed') {
            const group = selectionGroup?.(item);
            const withoutGroup = selectedIds.filter((id) => {
              const selectedRow = rows.find((row) => row.id === id);
              return selectedRow == null || selectionGroup?.(selectedRow) !== group;
            });
            onSelectionChange(isSelected ? withoutGroup : [...withoutGroup, item.id]);
            return;
          }
          onSelectionChange(isSelected
            ? selectedIds.filter((id) => id !== item.id)
            : [...selectedIds, item.id]);
        };
        const trailing = renderTrailing?.(item);
        const itemFooter = renderItemFooter?.(item) ?? (isSelected ? renderSelectedFooter?.(item) : null);
        const resolvedLabelTextStyle = typeof labelTextStyle === 'function' ? labelTextStyle(item) : labelTextStyle;
        const content = <>
          {item.imageUrl ? <Image accessible={false} source={{ uri: item.imageUrl }} style={styles.image} /> : null}
          <View style={styles.content}>
            <Text style={[styles.label, resolvedLabelTextStyle]}>{item.label}</Text>
            {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
            <View style={styles.metadata}>
              {item.price !== null ? <Text style={styles.meta}>${item.price.toLocaleString()}</Text> : null}
              {item.quantity !== null ? <Text style={styles.meta}>보유 {item.quantity.toLocaleString()}</Text> : null}
              {showSelectionAvailability && !displayOnly ? (
                <View style={[styles.availabilityBadge, item.selectable ? styles.availableBadge : styles.unavailableBadge]}>
                  <Text style={[styles.availabilityText, item.selectable ? styles.availableText : styles.unavailableText]}>
                    {item.selectable ? '선택 가능' : '선택 불가'}
                  </Text>
                </View>
              ) : !displayOnly && !item.selectable ? <Text style={styles.unavailable}>선택 불가</Text> : null}
            </View>
          </View>
        </>;
        const card = (
          <Pressable
            accessibilityLabel={accessibilityLabel}
            accessibilityRole={accessibilityRole}
            accessibilityState={accessibilityState}
            disabled={disabled}
            onPress={handlePress}
            style={({ pressed }) => [
              styles.row,
              trailing != null && styles.inlineRow,
              showSelectionAvailability && !displayOnly && (item.selectable ? styles.availableRow : styles.unavailableRow),
              isSelected && styles.selectedRow,
              disabled && !displayOnly && styles.disabledRow,
              pressed && !disabled && styles.pressedRow,
            ]}
          >
            {content}
          </Pressable>
        );
        if (itemFooter != null) {
          return <View style={[
            styles.expandedRow,
            showSelectionAvailability && !displayOnly && (item.selectable ? styles.availableRow : styles.unavailableRow),
            isSelected && styles.selectedRow,
            disabled && !displayOnly && styles.disabledRow,
          ]}>
            <Pressable
              accessibilityLabel={accessibilityLabel}
              accessibilityRole={accessibilityRole}
              accessibilityState={accessibilityState}
              disabled={disabled}
              onPress={handlePress}
              style={({ pressed }) => [styles.expandedCard, pressed && styles.pressedRow]}
            >
              {content}
            </Pressable>
            <View style={styles.selectedFooter}>{itemFooter}</View>
          </View>;
        }
        return trailing == null ? card : <View style={styles.rowLayout}>{card}{trailing}</View>;
      }}
      />
      {fixedAction ? <FixedBottomAction>{fixedAction}</FixedBottomAction> : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    minHeight: 64,
    padding: theme.spacing.md,
  },
  rowLayout: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  inlineRow: { flex: 1, marginBottom: 0 },
  expandedRow: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    marginBottom: theme.spacing.sm,
    overflow: 'hidden',
  },
  expandedCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
    minHeight: 64,
    padding: theme.spacing.md,
  },
  selectedFooter: {
    borderTopColor: theme.colors.border,
    borderTopWidth: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
  },
  selectedRow: { borderColor: theme.colors.accentGreen, borderWidth: 2 },
  availableRow: { backgroundColor: 'rgba(124, 224, 181, 0.06)', borderColor: theme.colors.accentGreen },
  unavailableRow: { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
  disabledRow: { opacity: 0.68 },
  pressedRow: { opacity: 0.82 },
  image: { borderRadius: theme.radius.sm, height: 44, width: 44 },
  content: { flex: 1, gap: theme.spacing.xs },
  label: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  detail: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  meta: { color: theme.colors.accentAmber, fontSize: 12 },
  availabilityBadge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: theme.spacing.sm, paddingVertical: 2 },
  availableBadge: { backgroundColor: 'rgba(124, 224, 181, 0.12)', borderColor: theme.colors.accentGreen },
  unavailableBadge: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong },
  availabilityText: { fontSize: 11, fontWeight: '800' },
  availableText: { color: theme.colors.accentGreen },
  unavailableText: { color: theme.colors.textMuted },
  unavailable: { color: theme.colors.textMuted, fontSize: 12 },
  empty: { color: theme.colors.textMuted, padding: theme.spacing.xl, textAlign: 'center' },
});
