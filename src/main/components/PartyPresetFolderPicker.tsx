import { Check, Circle, X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import {
  canMovePartyPresetFolder,
  getPartyPresetFolderPath,
  type PartyPresetCatalogIndex,
} from '../domain/partyPresetCatalog';
import { theme } from '../styles/theme';

type FolderChoice = {
  disabled: boolean;
  folderId: number | null;
  path: string;
};

export type PartyPresetFolderPickerProps = {
  index: PartyPresetCatalogIndex;
  selectedFolderId: number | null;
  movingFolderId?: number;
  allowUnassigned?: boolean;
  onCancel: () => void;
  onConfirm: (folderId: number | null) => void;
};

/** 프리셋 위치 또는 폴더 이동 목적지를 확인 후에만 반환한다. */
export function PartyPresetFolderPicker({
  index,
  selectedFolderId,
  movingFolderId,
  allowUnassigned = true,
  onCancel,
  onConfirm,
}: PartyPresetFolderPickerProps) {
  const [pendingFolderId, setPendingFolderId] = useState<number | null>(selectedFolderId);
  const titleRef = useRef<ElementRef<typeof Text>>(null);
  useEffect(() => setPendingFolderId(selectedFolderId), [selectedFolderId]);

  const choices = useMemo<FolderChoice[]>(() => {
    const nullChoice: FolderChoice = {
      disabled: false,
      folderId: null,
      path: movingFolderId == null ? '미지정' : '루트',
    };
    const folders = orderedFolderIdsDepthFirst(index)
      .map((folderId): FolderChoice => ({
        disabled: movingFolderId != null
          && !canMovePartyPresetFolder(index, movingFolderId, folderId),
        folderId,
        path: getPartyPresetFolderPath(index, folderId),
      }));
    return allowUnassigned || movingFolderId != null ? [nullChoice, ...folders] : folders;
  }, [allowUnassigned, index, movingFolderId]);

  const selectChoice = useCallback((folderId: number | null) => setPendingFolderId(folderId), []);
  const renderChoice = useCallback(({ item }: ListRenderItemInfo<FolderChoice>) => (
    <FolderChoiceRow
      disabled={item.disabled}
      folderId={item.folderId}
      path={item.path}
      selected={pendingFolderId === item.folderId}
      onSelect={selectChoice}
    />
  ), [pendingFolderId, selectChoice]);
  const keyExtractor = useCallback((item: FolderChoice) => item.folderId?.toString() ?? 'null', []);
  const confirm = useCallback(() => onConfirm(pendingFolderId), [onConfirm, pendingFolderId]);
  const handleShow = useCallback(() => {
    const titleNode = findNodeHandle(titleRef.current);
    if (titleNode != null) AccessibilityInfo.setAccessibilityFocus(titleNode);
  }, []);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onCancel}
      onShow={handleShow}
      presentationStyle="formSheet"
      visible
    >
      <View accessibilityLabel="폴더 위치 선택기" accessibilityViewIsModal style={styles.root}>
        <Text ref={titleRef} accessible accessibilityRole="header" style={styles.title}>폴더 위치</Text>
        <FlatList
          data={choices}
          keyExtractor={keyExtractor}
          renderItem={renderChoice}
          style={styles.list}
        />
        <View style={styles.actions}>
          <Pressable accessibilityLabel="폴더 위치 취소" accessibilityRole="button" onPress={onCancel} style={styles.actionButton}>
            <X color={theme.colors.textMuted} size={18} />
            <Text style={styles.cancelText}>취소</Text>
          </Pressable>
          <Pressable accessibilityLabel="폴더 위치 확인" accessibilityRole="button" onPress={confirm} style={[styles.actionButton, styles.confirmButton]}>
            <Check color={theme.colors.background} size={18} />
            <Text style={styles.confirmText}>확인</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function orderedFolderIdsDepthFirst(index: PartyPresetCatalogIndex): number[] {
  const result: number[] = [];
  const pending = [...(index.childFolderIdsByParent.get(null) ?? [])].reverse();
  while (pending.length > 0) {
    const folderId = pending.pop();
    if (folderId == null) break;
    result.push(folderId);
    const children = index.childFolderIdsByParent.get(folderId) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!);
  }
  return result;
}

const FolderChoiceRow = memo(function FolderChoiceRow({
  disabled,
  folderId,
  path,
  selected,
  onSelect,
}: FolderChoice & { selected: boolean; onSelect: (folderId: number | null) => void }) {
  const select = useCallback(() => onSelect(folderId), [folderId, onSelect]);
  return (
    <Pressable
      accessibilityLabel={selected ? `현재 폴더 위치 ${path}` : `폴더 위치 ${path}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={select}
      style={[styles.choice, selected && styles.selectedChoice, disabled && styles.disabled]}
    >
      <Circle
        color={selected ? theme.colors.accentGreen : theme.colors.textMuted}
        fill={selected ? theme.colors.accentGreen : 'transparent'}
        size={16}
      />
      <Text numberOfLines={2} style={[styles.choiceText, disabled && styles.disabledText]}>{path}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, gap: theme.spacing.sm, backgroundColor: theme.colors.surface, padding: theme.spacing.md },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  list: { flex: 1 },
  choice: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.sm, borderCurve: 'continuous', paddingHorizontal: theme.spacing.sm },
  selectedChoice: { backgroundColor: theme.colors.surfaceAlt },
  choiceText: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  disabledText: { color: theme.colors.textMuted },
  actions: { flexDirection: 'row', gap: theme.spacing.sm },
  actionButton: { minHeight: 44, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs, borderRadius: theme.radius.md, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.colors.border },
  confirmButton: { borderColor: theme.colors.accentGreen, backgroundColor: theme.colors.accentGreen },
  cancelText: { color: theme.colors.textMuted, fontWeight: '900' },
  confirmText: { color: theme.colors.background, fontWeight: '900' },
});
