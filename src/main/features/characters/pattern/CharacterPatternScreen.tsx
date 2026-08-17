import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DraggableFlatList, {
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import type {
  CharacterPatternApplyRequest,
  CharacterPatternOperationResult,
  HofCharacterDetail,
  HofCharacterPatternOption,
} from "../../../types/api";
import { theme } from "../../../styles/theme";

type Row = { key: string; judge: string; quantity: string; skill: string };
type PendingApply = {
  slotAction: "NONE" | "SAVE_EMPTY" | "REPLACE";
  targetSlotCode?: string;
  name?: string;
};
export function CharacterPatternScreen({
  detail,
  onApply,
  onLoadSaved,
  onDeleteSaved,
  onBeginEdit,
}: {
  detail: HofCharacterDetail;
  onApply?: (
    request: CharacterPatternApplyRequest,
  ) => Promise<CharacterPatternOperationResult>;
  onLoadSaved?: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  onDeleteSaved?: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  onBeginEdit?: () => Promise<void>;
}) {
  const initial = useMemo<Row[]>(
    () =>
      detail.actionPatterns.map((row, index) => ({
        key: `server-${index}`,
        judge: row.judge,
        quantity: row.quantity,
        skill: row.skill,
      })),
    [detail],
  );
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState(0);
  const [picker, setPicker] = useState<{
    index: number;
    type: "CONDITION" | "SKILL";
  } | null>(null);
  const [position, setPosition] = useState(
    detail.positionGuard.selectedPosition,
  );
  const [guard, setGuard] = useState(detail.positionGuard.guardValue);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [slotName, setSlotName] = useState("");
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const [conflict, setConflict] =
    useState<CharacterPatternOperationResult | null>(null);
  const [conflictedApply, setConflictedApply] = useState<PendingApply | null>(
    null,
  );
  const [automationPauseNotice, setAutomationPauseNotice] = useState(false);
  const rowKey = useRef(0);
  const pauseRequested = useRef(false);
  const capacity = initial.length;
  useEffect(() => {
    setRows(initial);
    setSelected(0);
    setPosition(detail.positionGuard.selectedPosition);
    setGuard(detail.positionGuard.guardValue);
    setPendingSlot(null);
    setSlotName("");
    setAutomationPauseNotice(false);
    pauseRequested.current = false;
  }, [detail.revision]);
  const beginEdit = () => {
    if (pauseRequested.current) return;
    pauseRequested.current = true;
    if (onBeginEdit) {
      setAutomationPauseNotice(true);
      void onBeginEdit();
    }
  };
  const conditionOptions = (detail.patternOptions ?? []).filter(
    (option) => option.type === "CONDITION",
  );
  const skillOptions = (detail.patternOptions ?? []).filter(
    (option) => option.type === "SKILL",
  );
  const newDefaultRow = (): Row => ({
    key: `draft-${rowKey.current++}`,
    judge: conditionOptions[0]?.value ?? "",
    quantity: "0",
    skill: skillOptions[0]?.value ?? "",
  });
  const label = (type: "CONDITION" | "SKILL", value: string) =>
    detail.patternOptions?.find(
      (item) => item.type === type && item.value === value,
    )?.label ?? value;
  const update = (index: number, patch: Partial<Row>) => {
    beginEdit();
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };
  const add = () => {
    if (rows.length <= capacity) {
      beginEdit();
      setRows((current) => [
        ...current.slice(0, selected),
        newDefaultRow(),
        ...current.slice(selected),
      ]);
    }
  };
  const remove = () => {
    beginEdit();
    setRows((current) => {
      const next = current.filter((_, index) => index !== selected);
      while (next.length < capacity) next.push(newDefaultRow());
      setSelected(Math.min(selected, next.length - 1));
      return next;
    });
  };
  const settingRows = (values: Row[]) =>
    values.map(({ judge, quantity, skill }) => ({ judge, quantity, skill }));
  const apply = async (
    slotAction: "NONE" | "SAVE_EMPTY" | "REPLACE" = "NONE",
    targetSlotCode?: string,
    name?: string,
    force = false,
  ) => {
    const result = await onApply?.({
      characterId: detail.id,
      baseRevision: detail.revision,
      base: {
        rows: settingRows(initial),
        position: detail.positionGuard.selectedPosition,
        guard: detail.positionGuard.guardValue,
      },
      draft: {
        baseRevision: detail.revision,
        rows: settingRows(rows),
        position,
        guard,
      },
      slotAction,
      targetSlotCode,
      slotName: name,
      force,
    });
    if (
      result &&
      (result.currentRevision || (result.rowDiffs?.length ?? 0) > 0)
    ) {
      setConflictedApply({ slotAction, targetSlotCode, name });
      setConflict(result);
    } else {
      setConflictedApply(null);
      setPendingSlot(null);
      setSlotName("");
    }
    return result;
  };
  const dirty =
    JSON.stringify(settingRows(rows)) !==
      JSON.stringify(settingRows(initial)) ||
    position !== detail.positionGuard.selectedPosition ||
    guard !== detail.positionGuard.guardValue;
  return (
    <View style={styles.screen}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setSlotsOpen(true)}
        style={styles.savedBar}
      >
        <Text style={styles.savedTitle}>저장 패턴</Text>
        <Text style={styles.savedValue}>
          {detail.patternSlots
            .filter((slot) => slot.canLoad)
            .map((slot) => slot.label)
            .join(" · ") || "빈 슬롯"}
        </Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      {automationPauseNotice && (
        <Text style={styles.pauseNotice}>
          패턴 편집을 시작해 자동화를 일시 정지했습니다. 자동화 화면에서 직접 재개해 주세요.
        </Text>
      )}
      <DraggableFlatList
        scrollEnabled={false}
        data={rows}
        keyExtractor={(row) => row.key}
        onDragEnd={({ data, to }) => {
          beginEdit();
          setRows(data);
          setSelected(to);
        }}
        renderItem={({
          item: row,
          getIndex,
          drag,
          isActive,
        }: RenderItemParams<Row>) => {
          const index = getIndex() ?? 0;
          return (
            <Pressable
              onPress={() => setSelected(index)}
              style={[
                styles.row,
                selected === index && styles.rowSelected,
                isActive && styles.dragging,
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${index + 1}번 행 이동`}
                onPress={() => setSelected(index)}
                onLongPress={drag}
                delayLongPress={180}
                style={styles.handle}
              >
                <Text style={styles.handleText}>≡</Text>
              </Pressable>
              <View style={styles.rowMain}>
                <Pressable
                  accessibilityLabel={`${index + 1}번 행동 조건 선택`}
                  onPress={() => setPicker({ index, type: "CONDITION" })}
                  style={styles.choice}
                >
                  <Text style={styles.choiceLabel}>조건</Text>
                  <Text style={styles.choiceText}>
                    {label("CONDITION", row.judge)}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`${index + 1}번 실행 스킬 선택`}
                  onPress={() => setPicker({ index, type: "SKILL" })}
                  style={styles.choice}
                >
                  <Text style={styles.choiceLabel}>스킬</Text>
                  <Text style={styles.choiceText}>
                    {label("SKILL", row.skill)}
                  </Text>
                </Pressable>
              </View>
              <TextInput
                accessibilityLabel={`${index + 1}번 기준값`}
                keyboardType="number-pad"
                value={row.quantity}
                onChangeText={(value) =>
                  update(index, { quantity: value.replace(/[^\d-]/g, "") })
                }
                style={styles.quantity}
              />
            </Pressable>
          );
        }}
      />
      {rows.length > capacity && (
        <Text style={styles.warning}>
          추가한 행을 적용하려면 원하는 행 하나를 삭제해 주세요.
        </Text>
      )}
      <View style={styles.controls}>
        <Pressable onPress={add} style={styles.control}>
          <Text style={styles.controlText}>+ 추가</Text>
        </Pressable>
        <Pressable onPress={remove} style={styles.control}>
          <Text style={styles.deleteText}>삭제</Text>
        </Pressable>
      </View>
      <View style={styles.setting}>
        <Text style={styles.settingTitle}>위치</Text>
        <View style={styles.pills}>
          {detail.positionGuard.positions.map((item) => (
            <Pill
              key={item.value}
              label={item.value}
              active={position === item.value}
              onPress={() => {
                beginEdit();
                setPosition(item.value);
              }}
            />
          ))}
        </View>
        <Text style={styles.settingTitle}>호위</Text>
        <View style={styles.pills}>
          {[
            "always",
            "never",
            "life25",
            "life50",
            "life75",
            "prob25",
            "prpb50",
            "prob75",
          ].map((value) => (
            <Pill
              key={value}
              label={value}
              active={guard === value}
              onPress={() => {
                beginEdit();
                setGuard(value);
              }}
            />
          ))}
        </View>
      </View>
      {pendingSlot && (
        <TextInput
          accessibilityLabel="패턴 저장 이름"
          maxLength={6}
          value={slotName}
          onChangeText={setSlotName}
          placeholder="이름"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.slotNameInput}
        />
      )}
      <Pressable
        accessibilityRole="button"
        disabled={
          rows.length !== capacity || (pendingSlot != null && !slotName.trim())
        }
        onPress={() =>
          void apply(
            pendingSlot ? "SAVE_EMPTY" : "NONE",
            pendingSlot ?? undefined,
            slotName.trim() || undefined,
          )
        }
        style={[
          styles.save,
          (rows.length !== capacity ||
            (pendingSlot != null && !slotName.trim())) &&
            styles.disabled,
        ]}
      >
        <Text style={styles.saveText}>
          {pendingSlot ? "저장 후 슬롯에 보관" : "저장"}
        </Text>
      </Pressable>
      <PatternPicker
        visible={picker !== null}
        type={picker?.type ?? "CONDITION"}
        options={picker?.type === "SKILL" ? skillOptions : conditionOptions}
        onClose={() => setPicker(null)}
        onSelect={(value) => {
          if (picker)
            update(
              picker.index,
              picker.type === "SKILL" ? { skill: value } : { judge: value },
            );
          setPicker(null);
        }}
      />
      <Modal
        visible={slotsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSlotsOpen(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSlotsOpen(false)}
          />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>저장 패턴</Text>
            {detail.patternSlots.map((slot) => (
              <View key={slot.slot} style={styles.slot}>
                <Text style={styles.slotName}>
                  {slot.canLoad ? slot.label : "빈 슬롯"}
                </Text>
                <View style={styles.slotActions}>
                  {slot.canLoad ? (
                    <>
                      <SlotAction
                        label="불러오기"
                        onPress={() => {
                          setSlotsOpen(false);
                          void onLoadSaved?.(detail.id, slot.slot);
                        }}
                      />
                      <SlotAction
                        label="교체"
                        onPress={() => {
                          setSlotsOpen(false);
                          void apply("REPLACE", slot.slot, slot.label);
                        }}
                      />
                      <SlotAction
                        danger
                        label="삭제"
                        onPress={() => {
                          setSlotsOpen(false);
                          void onDeleteSaved?.(detail.id, slot.slot);
                        }}
                      />
                    </>
                  ) : (
                    <SlotAction
                      label={dirty ? "저장과 함께" : "저장"}
                      onPress={() => {
                        setPendingSlot(slot.slot);
                        setSlotsOpen(false);
                      }}
                    />
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>
      </Modal>
      <Modal
        visible={conflict != null}
        transparent
        animationType="slide"
        onRequestClose={() => setConflict(null)}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              서버에서 패턴이 변경되었습니다
            </Text>
            <Text style={styles.warning}>
              변경된 행을 확인한 뒤 현재 초안으로 덮어쓸지 선택해 주세요.
            </Text>
            {(conflict?.rowDiffs ?? []).map((diff) => (
              <View key={diff.rowNumber} style={styles.conflictCard}>
                <Text style={styles.conflictNumber}>{diff.rowNumber}행</Text>
                <Text style={styles.conflictLabel}>편집 시작 당시</Text>
                <Text style={styles.conflictRow}>
                  {formatPatternRow(diff.before)}
                </Text>
                <Text style={styles.conflictLabel}>현재 서버</Text>
                <Text style={styles.conflictRow}>
                  {formatPatternRow(diff.current)}
                </Text>
              </View>
            ))}
            <View style={styles.controls}>
              <Pressable
                onPress={() => setConflict(null)}
                style={styles.control}
              >
                <Text style={styles.controlText}>취소</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setConflict(null);
                  const pending = conflictedApply;
                  if (pending)
                    void apply(
                      pending.slotAction,
                      pending.targetSlotCode,
                      pending.name,
                      true,
                    );
                }}
                style={styles.control}
              >
                <Text style={styles.deleteText}>덮어쓰기</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function formatPatternRow(
  row: { judge: string; quantity: string; skill: string } | null,
) {
  return row ? `${row.judge} · ${row.quantity} · ${row.skill}` : "행 없음";
}

function Pill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}
function SlotAction({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={styles.slotTouch}>
      <Text style={danger ? styles.danger : styles.slotAction}>{label}</Text>
    </Pressable>
  );
}
function PatternPicker({
  visible,
  type,
  options,
  onClose,
  onSelect,
}: {
  visible: boolean;
  type: "CONDITION" | "SKILL";
  options: HofCharacterPatternOption[];
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = options.filter((option) =>
    `${option.label} ${option.category ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.full}>
        <View style={styles.pickerHead}>
          <Pressable onPress={onClose} style={styles.back}>
            <Text style={styles.controlText}>‹ 뒤로</Text>
          </Pressable>
          <Text style={styles.sheetTitle}>
            {type === "SKILL" ? "스킬 선택" : "조건 선택"}
          </Text>
          <View style={styles.back} />
        </View>
        <TextInput
          accessibilityLabel="검색"
          value={query}
          onChangeText={setQuery}
          placeholder="이름·설명 검색"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.search}
        />
        <FlatList
          data={filtered}
          keyExtractor={(item, index) => `${item.value}-${index}`}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onSelect(item.value)}
              style={styles.option}
            >
              <Text style={styles.optionCategory}>{item.category}</Text>
              <Text style={styles.optionText}>{item.label}</Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  screen: { gap: 14 },
  savedBar: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  savedTitle: { color: theme.colors.accentGreen, fontWeight: "900" },
  savedValue: { flex: 1, color: theme.colors.text, fontWeight: "700" },
  chevron: { color: theme.colors.textMuted, fontSize: 26 },
  row: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
    overflow: "hidden",
    marginBottom: 5,
  },
  rowSelected: { borderColor: theme.colors.accentGreen },
  dragging: { opacity: 0.8, borderColor: theme.colors.accentGreen },
  handle: { width: 42, alignItems: "center", justifyContent: "center" },
  handleText: { color: theme.colors.textMuted, fontSize: 22 },
  rowMain: { flex: 1, flexDirection: "row", gap: 4, paddingVertical: 5 },
  choice: { flex: 1, justifyContent: "center", paddingHorizontal: 8 },
  choiceLabel: {
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
  },
  choiceText: {
    color: theme.colors.text,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 2,
  },
  quantity: {
    width: 48,
    color: theme.colors.text,
    backgroundColor: theme.colors.background,
    textAlign: "center",
    fontWeight: "800",
  },
  warning: { color: theme.colors.accentAmber, lineHeight: 19 },
  pauseNotice: {
    color: theme.colors.textMuted,
    lineHeight: 19,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  controls: { flexDirection: "row", gap: 7 },
  control: {
    minHeight: 48,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
  },
  controlText: { color: theme.colors.text, fontWeight: "900" },
  deleteText: { color: theme.colors.danger, fontWeight: "900" },
  setting: { gap: 8 },
  settingTitle: { color: theme.colors.text, fontWeight: "900", marginTop: 4 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    minHeight: 42,
    paddingHorizontal: 13,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceAlt,
  },
  pillActive: { backgroundColor: "#22483d" },
  pillText: { color: theme.colors.textMuted },
  pillTextActive: { color: theme.colors.accentGreen, fontWeight: "900" },
  slotNameInput: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.text,
    textAlign: "center",
    fontWeight: "800",
  },
  save: {
    minHeight: 52,
    backgroundColor: theme.colors.accentGreen,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { color: theme.colors.buttonText, fontWeight: "900", fontSize: 16 },
  disabled: { opacity: 0.35 },
  overlay: {
    flex: 1,
    backgroundColor: theme.colors.overlay,
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "78%",
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    gap: 7,
  },
  sheetTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  slot: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  slotName: { color: theme.colors.text, fontWeight: "800" },
  slotActions: { flexDirection: "row", gap: 4 },
  slotTouch: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  slotAction: { color: theme.colors.accentGreen, fontWeight: "800" },
  danger: { color: theme.colors.danger, fontWeight: "800" },
  conflictRow: { color: theme.colors.text, lineHeight: 20 },
  conflictCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    padding: 10,
    gap: 2,
  },
  conflictNumber: { color: theme.colors.accentAmber, fontWeight: "900" },
  conflictLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 3,
  },
  full: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: 16,
    paddingTop: 48,
  },
  pickerHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  back: { minWidth: 70, minHeight: 48, justifyContent: "center" },
  search: {
    minHeight: 48,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 11,
    paddingHorizontal: 14,
    marginVertical: 10,
  },
  option: { paddingVertical: 10, gap: 2 },
  optionCategory: {
    color: theme.colors.accentAmber,
    fontSize: 11,
    fontWeight: "800",
  },
  optionText: { color: theme.colors.text, fontSize: 15, lineHeight: 20 },
});
