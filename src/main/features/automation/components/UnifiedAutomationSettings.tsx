import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { GripVertical, Map, MoreHorizontal, Plus, ScrollText, Swords } from 'lucide-react-native';
import {
  NestableDraggableFlatList,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import {
  AUTOMATION_TYPE_METADATA,
  hasAllAutomationTypes,
} from '../../../domain/typedAutomation';
import { theme } from '../../../styles/theme';
import type { AutomationType, TypedAutomationEntryResponse } from '../../../types/api';
import { AutomationAddSheet } from './AutomationAddSheet';

type Props = {
  entries: TypedAutomationEntryResponse[];
  error: string | null;
  reordering: boolean;
  savingEntryIds: number[];
  savingTypes: AutomationType[];
  onAdd: (type: AutomationType) => Promise<boolean>;
  onDelete: (entryId: number) => Promise<boolean>;
  onDetail: (entry: TypedAutomationEntryResponse) => void;
  onReorder: (entries: TypedAutomationEntryResponse[]) => void;
  onToggle: (entry: TypedAutomationEntryResponse) => void;
};

export function UnifiedAutomationSettings({
  entries,
  error,
  reordering,
  savingEntryIds,
  savingTypes,
  onAdd,
  onDelete,
  onDetail,
  onReorder,
  onToggle,
}: Props) {
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [menuEntry, setMenuEntry] = useState<TypedAutomationEntryResponse | null>(null);
  const allTypesAdded = hasAllAutomationTypes(entries);
  const renderItem = useCallback((params: RenderItemParams<TypedAutomationEntryResponse>) => (
    <AutomationEntryRow
      {...params}
      saving={savingEntryIds.includes(params.item.id)}
      onMore={setMenuEntry}
      onToggle={onToggle}
    />
  ), [onToggle, savingEntryIds]);
  const menuBusy = menuEntry != null && savingEntryIds.includes(menuEntry.id);

  function confirmDelete(entry: TypedAutomationEntryResponse) {
    const metadata = AUTOMATION_TYPE_METADATA[entry.type];
    Alert.alert(
      `${metadata.label} 자동화를 삭제할까요?`,
      '저장한 세부 설정도 함께 삭제됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            void onDelete(entry.id).then((deleted) => {
              if (deleted) setMenuEntry(null);
            });
          },
        },
      ],
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>실행 우선순위</Text>
        <Text style={styles.helper}>위에서부터 실행하며 변경은 다음 작업부터 적용돼요.</Text>
      </View>

      {entries.length === 0 ? (
        <View style={styles.emptyState}>
          <ScrollText color={theme.colors.textMuted} size={24} />
          <View style={styles.emptyCopy}>
            <Text style={styles.emptyTitle}>아직 자동화가 없습니다.</Text>
            <Text style={styles.helper}>필요한 항목만 추가해 실행 순서를 만드세요.</Text>
          </View>
        </View>
      ) : (
        <NestableDraggableFlatList
          activationDistance={8}
          data={entries}
          keyExtractor={(entry) => String(entry.id)}
          onDragEnd={({ data, from, to }) => {
            if (from !== to) onReorder(data);
          }}
          renderItem={renderItem}
        />
      )}

      <Pressable
        accessibilityHint={allTypesAdded ? '추가할 수 있는 자동화 유형이 없습니다' : '자동화 유형 선택 창을 엽니다'}
        accessibilityLabel={allTypesAdded ? '모든 자동화가 추가되었습니다' : '자동화 추가'}
        accessibilityRole="button"
        accessibilityState={{ disabled: allTypesAdded }}
        disabled={allTypesAdded}
        onPress={() => setAddSheetOpen(true)}
        style={({ pressed }) => [
          styles.addButton,
          allTypesAdded && styles.disabled,
          pressed && !allTypesAdded && styles.pressed,
        ]}
      >
        <Plus color={allTypesAdded ? theme.colors.textMuted : theme.colors.accentGreen} size={18} />
        <Text style={[styles.addButtonText, allTypesAdded && styles.addButtonTextDisabled]}>
          {allTypesAdded ? '모든 자동화가 추가되었습니다' : '자동화 추가'}
        </Text>
      </Pressable>
      <Text style={styles.helper}>
        {allTypesAdded
          ? '다른 유형을 추가하려면 기존 자동화를 삭제해 주세요.'
          : '자동화 유형별로 하나씩 추가할 수 있습니다.'}
      </Text>
      {reordering ? <Text style={styles.savingText}>우선순위 저장 중</Text> : null}

      <AutomationAddSheet
        entries={entries}
        error={error}
        onAdd={onAdd}
        onClose={() => setAddSheetOpen(false)}
        pendingTypes={savingTypes}
        visible={addSheetOpen}
      />

      <Modal
        animationType="fade"
        onRequestClose={() => setMenuEntry(null)}
        transparent
        visible={menuEntry != null}
      >
        <View style={styles.menuRoot}>
          <Pressable
            accessibilityLabel="자동화 메뉴 닫기"
            accessibilityRole="button"
            onPress={() => setMenuEntry(null)}
            style={styles.menuBackdrop}
          />
          {menuEntry ? (
            <View accessibilityViewIsModal style={styles.menu}>
              <Text style={styles.menuTitle}>{AUTOMATION_TYPE_METADATA[menuEntry.type].label}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: menuBusy }}
                disabled={menuBusy}
                onPress={() => {
                  setMenuEntry(null);
                  onDetail(menuEntry);
                }}
                style={({ pressed }) => [styles.menuAction, pressed && styles.pressed]}
              >
                <Text style={styles.menuActionText}>상세 설정</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: menuBusy, disabled: menuBusy }}
                disabled={menuBusy}
                onPress={() => confirmDelete(menuEntry)}
                style={({ pressed }) => [styles.menuAction, pressed && styles.pressed]}
              >
                <Text style={styles.deleteText}>삭제</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

type AutomationEntryRowProps = RenderItemParams<TypedAutomationEntryResponse> & {
  saving: boolean;
  onMore: (entry: TypedAutomationEntryResponse) => void;
  onToggle: (entry: TypedAutomationEntryResponse) => void;
};

function AutomationEntryRow({
  item,
  drag,
  isActive,
  saving,
  onMore,
  onToggle,
}: AutomationEntryRowProps) {
  const metadata = AUTOMATION_TYPE_METADATA[item.type];
  const summary = getEntrySummary(item);
  const warning = item.warnings[0];
  return (
    <View style={[styles.row, isActive && styles.rowActive]}>
      <Pressable
        accessibilityHint="길게 눌러 위아래로 이동하세요"
        accessibilityLabel={`${metadata.label} 우선순위 이동`}
        delayLongPress={120}
        disabled={saving}
        onLongPress={drag}
        style={({ pressed }) => [styles.dragHandle, pressed && styles.pressed]}
      >
        <GripVertical color={theme.colors.textMuted} size={20} />
      </Pressable>
      <View style={styles.typeIcon}><AutomationTypeIcon type={item.type} /></View>
      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <Text numberOfLines={1} style={styles.rowTitle}>{metadata.label}</Text>
          <Text style={[styles.statusChip, !item.ready && styles.warningChip]}>
            {item.ready ? '준비됨' : '확인 필요'}
          </Text>
          {warning ? <Text style={[styles.statusChip, styles.warningChip]}>경고</Text> : null}
        </View>
        <Text numberOfLines={1} style={styles.rowMeta}>{warning ?? summary}</Text>
      </View>
      <Switch
        accessibilityLabel={`${metadata.label} ${item.enabled ? '끄기' : '켜기'}`}
        disabled={saving}
        onValueChange={() => onToggle(item)}
        thumbColor={item.enabled ? theme.colors.buttonText : theme.colors.textMuted}
        trackColor={{ false: theme.colors.border, true: theme.colors.accentGreen }}
        value={item.enabled}
      />
      <Pressable
        accessibilityLabel={`${metadata.label} 더 보기`}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
        disabled={saving}
        onPress={() => onMore(item)}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
      >
        <MoreHorizontal color={theme.colors.textMuted} size={21} />
      </Pressable>
    </View>
  );
}

function getEntrySummary(entry: TypedAutomationEntryResponse): string {
  if (entry.type === 'QUEST') return `선택 ${entry.quests.length}개`;
  if (entry.type === 'BATTLE_MAP') return `전투 맵 ${entry.battleMaps.length}개`;
  return `모험 맵 ${entry.adventureMaps.length}개`;
}

function AutomationTypeIcon({ type }: { type: AutomationType }) {
  const iconProps = { color: theme.colors.accentGreen, size: 18 };
  if (type === 'QUEST') return <ScrollText {...iconProps} />;
  if (type === 'BATTLE_MAP') return <Swords {...iconProps} />;
  return <Map {...iconProps} />;
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing.md },
  listHeader: { gap: 2 },
  sectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '900' },
  helper: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  emptyState: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: theme.radius.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 84, padding: theme.spacing.md },
  emptyCopy: { flex: 1 },
  emptyTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  row: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md + 4, borderWidth: 1, flexDirection: 'row', gap: 5, marginBottom: theme.spacing.sm, minHeight: 70, paddingHorizontal: 5 },
  rowActive: { borderColor: theme.colors.accentGreen, opacity: 0.96 },
  dragHandle: { alignItems: 'center', height: 44, justifyContent: 'center', width: 32 },
  typeIcon: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, height: 36, justifyContent: 'center', width: 36 },
  rowCopy: { flex: 1, minWidth: 0, paddingVertical: theme.spacing.sm },
  rowTitleLine: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  rowTitle: { color: theme.colors.text, flexShrink: 1, fontSize: 14, fontWeight: '900' },
  rowMeta: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4 },
  statusChip: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, color: theme.colors.accentGreen, fontSize: 9, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3 },
  warningChip: { color: theme.colors.accentAmber },
  moreButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 32 },
  addButton: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md + 6, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'center', minHeight: 54, paddingHorizontal: theme.spacing.md },
  addButtonText: { color: theme.colors.accentGreen, fontSize: 14, fontWeight: '900' },
  addButtonTextDisabled: { color: theme.colors.textMuted },
  savingText: { color: theme.colors.textMuted, fontSize: 11, textAlign: 'right' },
  menuRoot: { flex: 1, justifyContent: 'center', padding: theme.spacing.xl },
  menuBackdrop: { backgroundColor: 'rgba(0, 0, 0, 0.58)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  menu: { alignSelf: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.md + 4, borderWidth: 1, maxWidth: 280, padding: theme.spacing.sm, width: '100%' },
  menuTitle: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '800', paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  menuAction: { borderRadius: theme.radius.sm, minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.md },
  menuActionText: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  deleteText: { color: theme.colors.danger, fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
});
