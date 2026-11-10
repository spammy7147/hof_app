import { Check, Folder, FolderOpen, Inbox, X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAccessibilityFocusTarget, focusAccessibilityTarget } from '../platform/accessibilityFocus';

import {
  canMovePartyPresetFolder,
  getPartyPresetFolderPath,
  type PartyPresetCatalogIndex,
} from '../domain/partyPresetCatalog';
import { theme } from '../styles/theme';

type FolderChoice = {
  disabled: boolean;
  folderId: number | null;
  name: string;
  parentPath: string | null;
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
      name: movingFolderId == null ? '미지정' : '루트',
      parentPath: null,
      path: movingFolderId == null ? '미지정' : '루트',
    };
    const folders = orderedFolderIdsDepthFirst(index)
      .map((folderId): FolderChoice => {
        const folder = index.foldersById.get(folderId)!;
        return {
          disabled: movingFolderId != null
            && !canMovePartyPresetFolder(index, movingFolderId, folderId),
          folderId,
          name: folder.name,
          parentPath: folder.parentFolderId == null ? null : getPartyPresetFolderPath(index, folder.parentFolderId),
          path: getPartyPresetFolderPath(index, folderId),
        };
      });
    return allowUnassigned || movingFolderId != null ? [nullChoice, ...folders] : folders;
  }, [allowUnassigned, index, movingFolderId]);

  const selectChoice = useCallback((folderId: number | null) => setPendingFolderId(folderId), []);
  const renderChoice = useCallback(({ item }: ListRenderItemInfo<FolderChoice>) => (
    <FolderChoiceRow
      disabled={item.disabled}
      folderId={item.folderId}
      name={item.name}
      parentPath={item.parentPath}
      path={item.path}
      selected={pendingFolderId === item.folderId}
      onSelect={selectChoice}
    />
  ), [pendingFolderId, selectChoice]);
  const keyExtractor = useCallback((item: FolderChoice) => item.folderId?.toString() ?? 'null', []);
  const confirm = useCallback(() => onConfirm(pendingFolderId), [onConfirm, pendingFolderId]);
  const handleShow = useCallback(() => {
    const titleNode = getAccessibilityFocusTarget(titleRef.current);
    if (titleNode != null) focusAccessibilityTarget(titleNode);
  }, []);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      onShow={handleShow}
      presentationStyle="overFullScreen"
      transparent
      visible
    >
      <SafeAreaView edges={['top', 'bottom']} style={styles.overlay}>
        <Pressable accessibilityLabel="폴더 선택 배경 닫기" accessibilityRole="button" onPress={onCancel} style={styles.backdrop} />
        <View accessibilityLabel="폴더 위치 선택기" accessibilityViewIsModal style={styles.root}>
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text ref={titleRef} accessible accessibilityRole="header" style={styles.title}>폴더 위치</Text>
              <Text style={styles.description}>{movingFolderId == null ? '프리셋을 보관할 폴더를 선택하세요.' : '이동할 상위 폴더를 선택하세요.'}</Text>
            </View>
            <Pressable accessibilityLabel="폴더 선택 닫기" accessibilityRole="button" onPress={onCancel} style={styles.closeButton}>
              <X color={theme.colors.textMuted} size={18} />
            </Pressable>
          </View>
          <FlatList
            contentContainerStyle={styles.listContent}
            data={choices}
            keyExtractor={keyExtractor}
            renderItem={renderChoice}
            style={styles.list}
          />
          <View style={styles.actions}>
            <Pressable accessibilityLabel="폴더 위치 취소" accessibilityRole="button" onPress={onCancel} style={styles.actionButton}>
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
            <Pressable accessibilityLabel="폴더 위치 확인" accessibilityRole="button" onPress={confirm} style={[styles.actionButton, styles.confirmButton]}>
              <Check color={theme.colors.background} size={18} />
              <Text style={styles.confirmText}>선택 완료</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
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
  name,
  parentPath,
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
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={select}
      style={({ pressed }) => [styles.choice, selected && styles.selectedChoice, disabled && styles.disabled,
        pressed && !disabled && styles.pressed]}
    >
      {folderId == null ? <Inbox color={selected ? theme.colors.accentGreen : theme.colors.textMuted} size={18} />
        : selected ? <FolderOpen color={theme.colors.accentGreen} size={18} />
          : <Folder color={theme.colors.textMuted} size={18} />}
      <View style={styles.choiceCopy}>
        <Text numberOfLines={2} style={[styles.choiceText, selected && styles.selectedText, disabled && styles.disabledText]}>{name}</Text>
        {parentPath ? <Text numberOfLines={2} style={styles.parentPath}>{parentPath}</Text> : null}
      </View>
      {selected ? <Check color={theme.colors.accentGreen} size={18} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing.lg },
  backdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: theme.colors.overlay },
  root: { width: '100%', maxWidth: 520, maxHeight: '85%', gap: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface, padding: theme.spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  heading: { flex: 1, minWidth: 0, gap: theme.spacing.sm },
  title: { color: theme.colors.text, fontSize: theme.fontSize.section, fontWeight: '900' },
  description: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption },
  closeButton: { minWidth: theme.control.touch, minHeight: theme.control.touch, alignItems: 'center', justifyContent: 'center' },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { gap: theme.spacing.xs },
  choice: { minHeight: theme.control.touch, minWidth: theme.control.touch, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xl, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderCurve: 'continuous', paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md },
  selectedChoice: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.accentGreen },
  choiceCopy: { flex: 1, minWidth: 0, gap: theme.spacing.xs },
  choiceText: { color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: '800', lineHeight: theme.lineHeight.body },
  selectedText: { color: theme.colors.accentGreen },
  parentPath: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
  disabledText: { color: theme.colors.textMuted },
  actions: { flexDirection: 'row', gap: theme.spacing.sm },
  actionButton: { minHeight: theme.control.touch, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs, borderRadius: theme.radius.md, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.colors.border, minWidth: theme.control.touch, },
  confirmButton: { minHeight: theme.control.primary, borderColor: theme.colors.accentGreen, backgroundColor: theme.colors.accentGreen },
  cancelText: { color: theme.colors.textMuted, fontSize: theme.fontSize.body, fontWeight: '900' },
  confirmText: { color: theme.colors.background, fontSize: theme.fontSize.body, fontWeight: '900' },
});
