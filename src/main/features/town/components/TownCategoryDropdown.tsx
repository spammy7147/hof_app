import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../styles/theme';

export function TownCategoryDropdown({ data, disabled, onSelect, triggerLabel }: { data: { categories: Array<{ id: string; label: string; current: boolean }>; currentCategoryId: string | null }; disabled: boolean; onSelect: (id: string) => void; triggerLabel: string }) {
  const [open, setOpen] = useState(false);
  const selected = data.categories.find((category) => category.id === data.currentCategoryId)
    ?? data.categories.find((category) => category.current)
    ?? null;
  const close = () => setOpen(false);
  return <View style={styles.materialField}>
    <Text style={styles.label}>종류</Text>
    <Pressable accessibilityLabel={triggerLabel} accessibilityRole="button" accessibilityState={{ disabled, expanded: open }} disabled={disabled} onPress={() => setOpen(true)} style={({ pressed }) => [styles.dropdown, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text numberOfLines={1} style={[styles.dropdownText, !selected && styles.dropdownPlaceholder]}>{selected?.label ?? '종류를 선택하세요'}</Text>
      <Text style={styles.chevron}>⌄</Text>
    </Pressable>
    <Modal animationType="fade" onRequestClose={close} transparent visible={open}>
      <View accessibilityViewIsModal style={styles.modalRoot}>
        <Pressable accessibilityLabel={`${triggerLabel} 닫기`} accessibilityRole="button" onPress={close} style={styles.modalBackdrop} />
        <View style={styles.dropdownSheet}>
          <View style={styles.dropdownHeader}>
            <Text style={styles.dropdownTitle}>{triggerLabel}</Text>
            <Pressable accessibilityLabel={`${triggerLabel} 닫기`} accessibilityRole="button" onPress={close} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable>
          </View>
          <ScrollView accessibilityRole="radiogroup" keyboardShouldPersistTaps="handled" style={styles.materialOptions}>
            {data.categories.map((category) => <CategoryOption key={category.id} checked={category.id === selected?.id} label={category.label} disabled={disabled} onPress={() => { if (disabled) return; close(); if (category.id !== selected?.id) onSelect(category.id); }} />)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}
function CategoryOption({ checked, label, accessibilityLabel = `${label} 분류`, disabled, onPress }: { checked: boolean; label: string; accessibilityLabel?: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="radio" accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={[styles.materialOption, checked && styles.materialOptionSelected]}>
    <View style={[styles.radio, checked && styles.radioSelected]}>{checked ? <View style={styles.radioDot} /> : null}</View>
    <Text style={styles.optionLabel}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  label: { color: theme.colors.text, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  materialField: { gap: theme.spacing.xs },
  dropdown: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', minHeight: 46, paddingHorizontal: theme.spacing.md },
  dropdownText: { flex: 1, color: theme.colors.text, fontWeight: '700' },
  dropdownPlaceholder: { color: theme.colors.textMuted },
  chevron: { color: theme.colors.textMuted, fontSize: 22, marginLeft: theme.spacing.sm },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { backgroundColor: theme.colors.overlay, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  dropdownSheet: { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderTopLeftRadius: theme.radius.md, borderTopRightRadius: theme.radius.md, borderWidth: 1, maxHeight: '70%', padding: theme.spacing.lg },
  dropdownHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: theme.spacing.md },
  dropdownTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  closeButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  closeText: { color: theme.colors.textMuted, fontSize: 26 },
  materialOptions: { flexGrow: 0 },
  materialOption: { alignItems: 'center', borderBottomColor: theme.colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 62, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  materialOptionSelected: { backgroundColor: theme.colors.surfaceAlt },
  optionLabel: { flex: 1, color: theme.colors.text, fontWeight: '800' },
  radio: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: 10, borderWidth: 2, height: 20, justifyContent: 'center', width: 20 },
  radioSelected: { borderColor: theme.colors.accentGreen },
  radioDot: { backgroundColor: theme.colors.accentGreen, borderRadius: 5, height: 10, width: 10 },
});
