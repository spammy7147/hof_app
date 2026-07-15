import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import {
  CalendarDays,
  ChevronRight,
  GripVertical,
  ListTodo,
  Plus,
  TimerReset,
  X,
} from 'lucide-react-native';
import {
  NestableDraggableFlatList,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import {
  CANONICAL_UNIFIED_MODULE_TYPES,
  getUnifiedModuleTypeLabel,
} from '../../../domain/unifiedAutomation';
import { theme } from '../../../styles/theme';
import type {
  UnifiedAutomationModuleResponse,
  UnifiedAutomationModuleType,
} from '../../../types/api';

type Props = {
  modules: UnifiedAutomationModuleResponse[];
  savingModuleIds: number[];
  reordering: boolean;
  onAdd: (type: UnifiedAutomationModuleType) => void;
  onEdit: (module: UnifiedAutomationModuleResponse) => void;
  onReorder: (modules: UnifiedAutomationModuleResponse[]) => void;
  onToggle: (module: UnifiedAutomationModuleResponse) => void;
};

/**
 * 서버에 실제로 저장된 모듈만 우선순위 순서로 보여주는 설정 목록이다.
 *
 * 드래그가 끝나면 부모가 먼저 화면 순서를 바꾸고 백그라운드 저장 큐에 전달한다. 개별 토글은 해당
 * 행만 비활성화하므로 다른 모듈 편집이나 토글이 불필요하게 막히지 않는다.
 */
export function UnifiedAutomationSettings({
  modules,
  savingModuleIds,
  reordering,
  onAdd,
  onEdit,
  onReorder,
  onToggle,
}: Props) {
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const addableTypes = CANONICAL_UNIFIED_MODULE_TYPES.filter((type) => !modules.some((module) => module.moduleType === type));
  const renderItem = useCallback((params: RenderItemParams<UnifiedAutomationModuleResponse>) => (
    <AutomationModuleRow
      {...params}
      saving={savingModuleIds.includes(params.item.id)}
      onEdit={onEdit}
      onToggle={onToggle}
    />
  ), [onEdit, onToggle, savingModuleIds]);

  return (
    <View style={styles.stack}>
      <View style={styles.listHeader}>
        <View style={styles.headerCopy}>
          <Text style={styles.sectionTitle}>자동화 구성</Text>
          <Text style={styles.helper}>위에서부터 실행하며 변경은 다음 작업부터 적용돼요.</Text>
        </View>
        <Pressable
          accessibilityLabel={typePickerOpen ? '자동화 유형 선택 닫기' : '자동화 추가'}
          accessibilityRole="button"
          onPress={() => setTypePickerOpen((open) => !open)}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          {typePickerOpen ? <X color={theme.colors.buttonText} size={17} /> : <Plus color={theme.colors.buttonText} size={17} />}
          <Text style={styles.addButtonText}>{typePickerOpen ? '닫기' : '자동화 추가'}</Text>
        </Pressable>
      </View>

      {typePickerOpen ? (
        <View style={styles.typePicker}>
          <Text style={styles.typePickerTitle}>추가할 자동화 유형</Text>
          <View style={styles.typeGrid}>
            {addableTypes.map((type) => (
              <Pressable
                key={type}
                accessibilityRole="button"
                onPress={() => {
                  setTypePickerOpen(false);
                  onAdd(type);
                }}
                style={({ pressed }) => [styles.typeOption, pressed && styles.pressed]}
              >
                <ModuleTypeIcon type={type} />
                <Text numberOfLines={2} style={styles.typeOptionText}>{getUnifiedModuleTypeLabel(type)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {modules.length === 0 ? (
        <View style={styles.emptyState}>
          <ListTodo color={theme.colors.textMuted} size={24} />
          <View style={styles.emptyCopy}>
            <Text style={styles.emptyTitle}>아직 자동화가 없습니다.</Text>
            <Text style={styles.helper}>필요한 항목만 추가해 나만의 실행 순서를 만드세요.</Text>
          </View>
        </View>
      ) : (
        <NestableDraggableFlatList
          activationDistance={8}
          data={modules}
          keyExtractor={(module) => String(module.id)}
          onDragEnd={({ data, from, to }) => {
            if (from !== to) onReorder(data);
          }}
          renderItem={renderItem}
        />
      )}

      {reordering ? <Text style={styles.savingText}>우선순위 저장 중</Text> : null}
    </View>
  );
}

type AutomationModuleRowProps = RenderItemParams<UnifiedAutomationModuleResponse> & {
  saving: boolean;
  onEdit: (module: UnifiedAutomationModuleResponse) => void;
  onToggle: (module: UnifiedAutomationModuleResponse) => void;
};

function AutomationModuleRow({
  item,
  drag,
  isActive,
  saving,
  onEdit,
  onToggle,
}: AutomationModuleRowProps) {
  const readiness = item.ready ? item.summary : item.summary || '설정을 확인해 주세요';
  return (
    <View style={[styles.row, isActive && styles.rowActive]}>
      <Pressable
        accessibilityHint="길게 눌러 위아래로 이동하세요"
        accessibilityLabel={`${item.displayName} 우선순위 이동`}
        delayLongPress={120}
        disabled={saving}
        onLongPress={drag}
        style={({ pressed }) => [styles.dragHandle, pressed && styles.pressed]}
      >
        <GripVertical color={theme.colors.textMuted} size={20} />
      </Pressable>

      <Pressable
        accessibilityLabel={`${item.displayName} 편집`}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
        disabled={saving}
        onPress={() => onEdit(item)}
        style={({ pressed }) => [
          styles.rowCopyButton,
          saving && styles.disabled,
          pressed && !saving && styles.pressed,
        ]}
      >
        <Text numberOfLines={1} style={styles.rowTitle}>{item.displayName}</Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {getUnifiedModuleTypeLabel(item.moduleType)} · {readiness}
        </Text>
      </Pressable>

      <Switch
        accessibilityLabel={`${item.displayName} ${item.enabled ? '끄기' : '켜기'}`}
        disabled={saving}
        onValueChange={() => onToggle(item)}
        thumbColor={item.enabled ? theme.colors.buttonText : theme.colors.textMuted}
        trackColor={{ false: theme.colors.border, true: theme.colors.accentGreen }}
        value={item.enabled}
      />
      <Pressable
        accessibilityLabel={`${item.displayName} 상세 설정`}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
        disabled={saving}
        onPress={() => onEdit(item)}
        style={({ pressed }) => [
          styles.editButton,
          saving && styles.disabled,
          pressed && !saving && styles.pressed,
        ]}
      >
        <ChevronRight color={theme.colors.textMuted} size={18} />
      </Pressable>
    </View>
  );
}

function ModuleTypeIcon({ type }: { type: UnifiedAutomationModuleType }) {
  const props = { color: theme.colors.accentGreen, size: 18 };
  switch (type) {
    case 'TIME_BURN': return <TimerReset {...props} />;
    case 'DAILY_ADVENTURE': return <CalendarDays {...props} />;
    default: return <ListTodo {...props} />;
  }
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing.md },
  listHeader: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '900' },
  helper: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  addButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.sm, flexDirection: 'row', gap: 5, minHeight: 38, paddingHorizontal: 11 },
  addButtonText: { color: theme.colors.buttonText, fontSize: 13, fontWeight: '900' },
  typePicker: { borderBottomColor: theme.colors.border, borderBottomWidth: 1, gap: theme.spacing.sm, paddingBottom: theme.spacing.md },
  typePickerTitle: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  typeOption: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, flexBasis: '31%', flexGrow: 1, gap: 6, justifyContent: 'center', minHeight: 68, padding: theme.spacing.sm },
  typeOptionText: { color: theme.colors.text, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  emptyState: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: theme.radius.md, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 84, padding: theme.spacing.md },
  emptyCopy: { flex: 1 },
  emptyTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  row: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', gap: 6, marginBottom: theme.spacing.sm, minHeight: 60, paddingHorizontal: 6 },
  rowActive: { borderColor: theme.colors.accentGreen, opacity: 0.96 },
  dragHandle: { alignItems: 'center', height: 44, justifyContent: 'center', width: 34 },
  rowCopyButton: { flex: 1, minWidth: 0, paddingVertical: 9 },
  rowTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  rowMeta: { color: theme.colors.textMuted, fontSize: 11, marginTop: 3 },
  editButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 28 },
  savingText: { color: theme.colors.textMuted, fontSize: 11, textAlign: 'right' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});
