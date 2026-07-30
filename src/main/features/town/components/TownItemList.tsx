import { Image } from 'expo-image';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type { TownRowResponse } from '../../../types/api';

type TownItemListProps = {
  rows: TownRowResponse[];
  selectionMode?: 'none' | 'single' | 'multiple';
  selectedIds?: readonly string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  emptyMessage?: string;
};

/** 긴 HOF 후보 목록을 가상화하고 서버가 허용한 행만 선택하게 한다. */
export function TownItemList({
  rows,
  selectionMode = 'none',
  selectedIds = [],
  onSelectionChange,
  emptyMessage = '표시할 항목이 없습니다.',
}: TownItemListProps) {
  const selected = new Set(selectedIds);

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      nestedScrollEnabled
      initialNumToRender={12}
      windowSize={7}
      ListEmptyComponent={<Text style={styles.empty}>{emptyMessage}</Text>}
      renderItem={({ item }) => {
        const isSelected = selected.has(item.id);
        const disabled = !item.selectable || selectionMode === 'none' || !onSelectionChange;
        return (
          <Pressable
            accessibilityLabel={`${item.label}${disabled ? ' 선택 불가' : ' 선택'}`}
            accessibilityRole={selectionMode === 'single' ? 'radio' : 'checkbox'}
            accessibilityState={{ disabled, selected: isSelected }}
            disabled={disabled}
            onPress={() => {
              if (!onSelectionChange) return;
              if (selectionMode === 'single') {
                onSelectionChange([item.id]);
                return;
              }
              onSelectionChange(isSelected
                ? selectedIds.filter((id) => id !== item.id)
                : [...selectedIds, item.id]);
            }}
            style={({ pressed }) => [
              styles.row,
              isSelected && styles.selectedRow,
              disabled && styles.disabledRow,
              pressed && !disabled && styles.pressedRow,
            ]}
          >
            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.image} /> : null}
            <View style={styles.content}>
              <Text style={styles.label}>{item.label}</Text>
              {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
              <View style={styles.metadata}>
                {item.price !== null ? <Text style={styles.meta}>${item.price.toLocaleString()}</Text> : null}
                {item.quantity !== null ? <Text style={styles.meta}>보유 {item.quantity.toLocaleString()}</Text> : null}
                {!item.selectable ? <Text style={styles.unavailable}>선택 불가</Text> : null}
              </View>
            </View>
          </Pressable>
        );
      }}
    />
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
  selectedRow: { borderColor: theme.colors.accentGreen, borderWidth: 2 },
  disabledRow: { opacity: 0.68 },
  pressedRow: { opacity: 0.82 },
  image: { borderRadius: theme.radius.sm, height: 44, width: 44 },
  content: { flex: 1, gap: theme.spacing.xs },
  label: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  detail: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  meta: { color: theme.colors.accentAmber, fontSize: 12 },
  unavailable: { color: theme.colors.textMuted, fontSize: 12 },
  empty: { color: theme.colors.textMuted, padding: theme.spacing.xl, textAlign: 'center' },
});
