import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppAlert as Alert } from '../../../platform/AppAlert';
import {
  NestableDraggableFlatList,
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import type { HofCharacterPatternOption } from "../../../types/api";
import { theme } from "../../../styles/theme";
import { FixedBottomAction } from "../../../components/FixedBottomAction";
import type { CharacterManagementHubResource } from "../../../domain/characterManagementHubModule";

type Row = { key: string; judge: string; quantity: string; skill: string };
const GUARD_OPTIONS = [
  "always",
  "never",
  "life25",
  "life50",
  "life75",
  "prob25",
  "prpb50",
  "prob75",
];
export function CharacterPatternScreen({
  characterHub,
  onImportSettings,
}: {
  characterHub: CharacterManagementHubResource;
  onImportSettings?: () => void;
}) {
  const detail = characterHub.detail!;
  const savePattern = characterHub.actions.savePattern;
  const onLoadSaved = characterHub.actions.loadSavedPattern;
  const onDeleteSaved = characterHub.actions.deleteSavedPattern;
  const onBeginEdit = characterHub.actions.beginPatternEdit;
  const initial = useMemo<Row[]>(
    () =>
      detail.actionPatterns.map((row, index) => ({
        key: `server-${index}`,
        judge: row.judge,
        quantity: row.quantity,
        skill: row.skill,
      })),
    [detail.actionPatterns],
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
  const [setupOpen, setSetupOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [standaloneSaveOpen, setStandaloneSaveOpen] = useState(false);
  const [alsoSave, setAlsoSave] = useState(false);
  const [slotName, setSlotName] = useState("");
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const visibleConflict = characterHub.patternConflict;
  const dismissConflict = characterHub.actions.dismissPatternConflict;
  const { pending, appliedVersion } = characterHub.patternOperation;
  const [inputError, setInputError] = useState<string | null>(null);
  const [automationPauseNotice, setAutomationPauseNotice] = useState(false);
  const rowKey = useRef(0);
  const pauseRequested = useRef(false);
  const keepDraft = useRef(false);
  const returnToSlots = useRef(false);
  const applied = useRef({ characterId: detail.id, version: appliedVersion });
  const base = useRef({
    rows: detail.actionPatterns.map(({ judge, quantity, skill }) => ({ judge, quantity, skill })),
    position: detail.positionGuard.selectedPosition,
    guard: detail.positionGuard.guardValue,
  });
  const capacity = initial.length;
  useEffect(() => {
    const explicitChange = applied.current.characterId !== detail.id || applied.current.version !== appliedVersion;
    if (keepDraft.current && !explicitChange) return;
    if (explicitChange) {
      setSlotsOpen(applied.current.characterId === detail.id && returnToSlots.current);
      returnToSlots.current = false;
    }
    applied.current = { characterId: detail.id, version: appliedVersion };
    keepDraft.current = false;
    setInputError(null);
    base.current = {
      rows: initial.map(({ judge, quantity, skill }) => ({ judge, quantity, skill })),
      position: detail.positionGuard.selectedPosition,
      guard: detail.positionGuard.guardValue,
    };
    setRows(initial);
    setSelected(0);
    setPosition(detail.positionGuard.selectedPosition);
    setGuard(detail.positionGuard.guardValue);
    setPendingSlot(null);
    setSlotName("");
    setSetupOpen(false);
    setCommitOpen(false);
    setStandaloneSaveOpen(false);
    setAlsoSave(false);
    setAutomationPauseNotice(false);
    pauseRequested.current = false;
  }, [detail.id, detail.positionGuard, initial, appliedVersion]);
  const beginEdit = () => {
    keepDraft.current = true;
    if (pauseRequested.current) return;
    pauseRequested.current = true;
    if (onBeginEdit) {
      setAutomationPauseNotice(true);
      void onBeginEdit();
    }
  };
  const closeCommit = () => {
    returnToSlots.current = false;
    setCommitOpen(false);
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
    if (pending) return;
    setInputError(null);
    beginEdit();
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };
  const add = () => {
    if (pending) return;
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
    if (pending) return;
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
  ) => {
    if (pending) return;
    const invalidRow = rows.findIndex((row) => !/^-?\d+$/.test(row.quantity)
      || Number(row.quantity) < -2147483648 || Number(row.quantity) > 2147483647);
    if (invalidRow >= 0) {
      setInputError(`${invalidRow + 1}번 행 기준값을 정수로 입력해 주세요.`);
      return;
    }
    setInputError(null);
    keepDraft.current = true;
    await savePattern?.({
      base: base.current,
      draft: {
        rows: settingRows(rows),
        position,
        guard,
      },
      slotAction,
      targetSlotCode,
      slotName: name,
    });
  };
  const dirty =
    JSON.stringify(settingRows(rows)) !==
      JSON.stringify(base.current.rows) ||
    position !== base.current.position ||
    guard !== base.current.guard;
  const feedback = inputError ? (
    <Text accessibilityRole="alert" style={styles.warning}>{inputError}</Text>
  ) : <PatternFeedback characterHub={characterHub} />;
  const loadedSlotCount = detail.patternSlots.filter((slot) => slot.canLoad).length;
  const emptySlotCount = detail.patternSlots.length - loadedSlotCount;
  return (
    <View style={styles.screen}>
      {!commitOpen && !standaloneSaveOpen && !slotsOpen && feedback}
      <View style={styles.quickRow}>
        <Pressable accessibilityRole="button" onPress={() => setSlotsOpen(true)} style={styles.savedBar}>
          <View style={styles.savedCopy}>
            <Text style={styles.savedTitle}>저장 패턴</Text>
            <Text style={styles.savedValue}>{loadedSlotCount}개{emptySlotCount > 0 ? ` · 빈 슬롯 ${emptySlotCount}개` : ""}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        {onImportSettings && (
          <Pressable accessibilityRole="button" disabled={pending} onPress={onImportSettings} style={styles.importButton}>
            <Text style={styles.importText}>다른 캐릭터{`\n`}가져오기</Text>
          </Pressable>
        )}
      </View>
      <Pressable accessibilityRole="button" disabled={pending} onPress={() => setSetupOpen(true)} style={styles.setupBar}>
        <Text style={styles.setupLabel}>위치</Text>
        <Text style={styles.setupValue}>{positionText(position)}</Text>
        <Text style={styles.setupLabel}>호위</Text>
        <Text style={[styles.setupValue, styles.guardValue]} numberOfLines={1}>{guardText(guard)}</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      {automationPauseNotice && (
        <Text style={styles.pauseNotice}>
          패턴 편집을 시작해 자동화를 일시 정지했습니다. 자동화 화면에서 직접 재개해 주세요.
        </Text>
      )}
      <NestableDraggableFlatList
        scrollEnabled={false}
        data={rows}
        keyExtractor={(row) => row.key}
        onDragEnd={({ data, to }) => {
          if (pending) return;
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
                disabled={pending}
                onPress={() => setSelected(index)}
                onLongPress={drag}
                delayLongPress={180}
                style={styles.handle}
              >
                <Text style={styles.handleText}>≡</Text>
              </Pressable>
              <View testID={`pattern-row-controls-${index + 1}`} style={styles.rowMain}>
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
                <TextInput
                  accessibilityLabel={`${index + 1}번 기준값`}
                  editable={!pending}
                  keyboardType="number-pad"
                  value={row.quantity}
                  onChangeText={(value) =>
                    update(index, { quantity: value.replace(/[^\d-]/g, "") })
                  }
                  style={styles.quantity}
                />
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
      <FixedBottomAction>
        <Pressable
          accessibilityRole="button"
          disabled={pending || rows.length !== capacity}
          onPress={() => {
            returnToSlots.current = false;
            setCommitOpen(true);
          }}
          style={[styles.save, rows.length !== capacity && styles.disabled]}
        >
          <Text style={styles.saveText}>저장</Text>
        </Pressable>
      </FixedBottomAction>
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
      <Modal visible={setupOpen} transparent animationType="slide" onRequestClose={() => setSetupOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSetupOpen(false)} />
          <ScrollView style={styles.scrollSheet} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>위치·호위 선택</Text>
            <Text style={styles.sheetNote}>선택한 위치·호위는 하단 저장 버튼을 누를 때 HOF 서버에 반영됩니다.</Text>
            <Text style={styles.sheetLabel}>위치</Text>
            <View style={styles.segmentRow}>
              {detail.positionGuard.positions.map((item) => (
                <Pill
                  key={item.value}
                  label={positionText(item.value)}
                  active={position === item.value}
                  onPress={() => { if (pending) return; beginEdit(); setPosition(item.value); }}
                />
              ))}
            </View>
            <Text style={styles.sheetLabel}>호위</Text>
            <View style={styles.guardOptions}>
              {GUARD_OPTIONS.map((value) => (
                <Pill
                  key={value}
                  label={guardText(value)}
                  active={guard === value}
                  onPress={() => { if (pending) return; beginEdit(); setGuard(value); }}
                />
              ))}
            </View>
            <View style={styles.selectionSummary}>
              <Text style={styles.sheetLabel}>선택됨</Text>
              <Text style={styles.selectionValue}>{positionText(position)} · {guardText(guard)}</Text>
            </View>
            <Pressable onPress={() => setSetupOpen(false)} style={styles.primarySheetButton}>
              <Text style={styles.primarySheetButtonText}>완료</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={commitOpen && !visibleConflict} transparent animationType="slide" onRequestClose={closeCommit}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeCommit} />
          <ScrollView style={styles.scrollSheet} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>저장</Text>
            {feedback}
            <Text style={styles.sheetNote}>패턴 {rows.length}행을 저장한 뒤 위치·호위를 저장하고 전체 설정을 확인합니다.</Text>
            {emptySlotCount > 0 && (
              <Pressable
                accessibilityRole="checkbox"
                disabled={pending}
                accessibilityState={{ checked: alsoSave }}
                onPress={() => {
                  const next = !alsoSave;
                  setAlsoSave(next);
                  if (next && !pendingSlot) setPendingSlot(detail.patternSlots.find((slot) => !slot.canLoad)?.slot ?? null);
                }}
                style={[styles.saveOption, alsoSave && styles.saveOptionActive]}
              >
                <View style={[styles.checkbox, alsoSave && styles.checkboxActive]}>
                  <Text style={styles.checkboxText}>{alsoSave ? "✓" : ""}</Text>
                </View>
                <View style={styles.savedCopy}>
                  <Text style={styles.slotName}>현재 설정 저장 후 빈 슬롯에도 보관</Text>
                  <Text style={styles.sheetNote}>현재 설정을 검증한 다음 선택한 슬롯에 저장합니다.</Text>
                </View>
              </Pressable>
            )}
            {alsoSave && (
              <>
                <Text style={styles.sheetLabel}>저장할 빈 슬롯</Text>
                <View style={styles.segmentRow}>
                  {detail.patternSlots.filter((slot) => !slot.canLoad).map((slot) => (
                    <Pill
                      key={slot.slot}
                      label={`빈 슬롯 ${Number(slot.slot) + 1}`}
                      active={pendingSlot === slot.slot}
                      onPress={() => { if (!pending) setPendingSlot(slot.slot); }}
                    />
                  ))}
                </View>
                <TextInput
                  accessibilityLabel="패턴 저장 이름"
                  editable={!pending}
                  maxLength={6}
                  value={slotName}
                  onChangeText={setSlotName}
                  placeholder="이름 · 최대 6자"
                  placeholderTextColor={theme.colors.textMuted}
                  style={styles.slotNameInput}
                />
              </>
            )}
            <View style={styles.controls}>
              <Pressable onPress={closeCommit} style={styles.control}><Text style={styles.controlText}>취소</Text></Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={pending || (alsoSave && (!pendingSlot || !slotName.trim()))}
                onPress={() => {
                  void apply(alsoSave ? "SAVE_EMPTY" : "NONE", pendingSlot ?? undefined, slotName.trim() || undefined);
                }}
                style={[styles.primarySheetButton, alsoSave && (!pendingSlot || !slotName.trim()) && styles.disabled]}
              >
                <Text style={styles.primarySheetButtonText}>{alsoSave ? "저장하고 슬롯에도 보관" : "현재 설정 저장"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={standaloneSaveOpen && !visibleConflict} transparent animationType="slide" onRequestClose={() => setStandaloneSaveOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setStandaloneSaveOpen(false)} />
          <ScrollView style={styles.scrollSheet} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>빈 슬롯</Text>
            {feedback}
            <TextInput
              accessibilityLabel="패턴 저장 이름"
              editable={!pending}
              maxLength={6}
              value={slotName}
              onChangeText={setSlotName}
              placeholder="이름 · 최대 6자"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.slotNameInput}
            />
            <View style={styles.controls}>
              <Pressable onPress={() => setStandaloneSaveOpen(false)} style={styles.control}><Text style={styles.controlText}>취소</Text></Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={pending || !slotName.trim() || !pendingSlot}
                onPress={() => {
                  void apply("SAVE_EMPTY", pendingSlot ?? undefined, slotName.trim());
                }}
                style={[styles.primarySheetButton, (!slotName.trim() || !pendingSlot) && styles.disabled]}
              >
                <Text style={styles.primarySheetButtonText}>저장</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
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
          <ScrollView style={styles.scrollSheet} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle}>저장 패턴</Text>
            {feedback}
            {dirty && (
              <View>
                <Text style={styles.sheetNote}>편집한 내용이 있습니다. 슬롯에 보관하거나 교체하려면 현재 설정을 먼저 저장해 주세요.</Text>
                <Pressable accessibilityRole="button" disabled={pending} onPress={() => {
                  returnToSlots.current = true;
                  setSlotsOpen(false);
                  setCommitOpen(true);
                }} style={styles.primarySheetButton}>
                  <Text style={styles.primarySheetButtonText}>현재 설정 저장으로 이동</Text>
                </Pressable>
              </View>
            )}
            {detail.patternSlots.map((slot) => (
              <View key={slot.slot} style={styles.slot}>
                <Text style={[styles.slotName, styles.slotLabel]}>
                  {slot.canLoad ? slot.label : "빈 슬롯"}
                </Text>
                <View style={styles.slotActions}>
                  {slot.canLoad ? (
                    <>
                      <SlotAction
                        label="불러오기"
                        disabled={pending}
                        onPress={() => {
                          const load = () => {
                            setSlotsOpen(false);
                            void onLoadSaved?.(slot.slot);
                          };
                          if (dirty) {
                            Alert.alert("저장 패턴 불러오기", "적용하지 않은 편집 내용이 있습니다. 저장 패턴을 불러올까요?", [
                              { text: "취소", style: "cancel" },
                              { text: "불러오기", onPress: load },
                            ]);
                          } else load();
                        }}
                      />
                      <SlotAction
                        label="교체"
                        disabled={pending || dirty}
                        onPress={() => {
                          Alert.alert("저장 패턴 교체", `기존 “${slot.label}” 슬롯을 삭제한 뒤 현재 서버 설정을 같은 이름으로 다시 저장합니다.`, [
                            { text: "취소", style: "cancel" },
                            { text: "교체", onPress: () => {
                              setSlotsOpen(false);
                              void apply("REPLACE", slot.slot, slot.label);
                            } },
                          ]);
                        }}
                      />
                      <SlotAction
                        danger
                        label="삭제"
                        disabled={pending}
                        onPress={() => {
                          setSlotsOpen(false);
                          void onDeleteSaved?.(slot.slot);
                        }}
                      />
                    </>
                  ) : (
                    <SlotAction
                      label="저장"
                      disabled={pending || dirty}
                      onPress={() => {
                        if (pendingSlot !== slot.slot) setSlotName("");
                        setPendingSlot(slot.slot);
                        setSlotsOpen(false);
                        setStandaloneSaveOpen(true);
                      }}
                    />
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
      <Modal
        visible={visibleConflict != null}
        transparent
        animationType="slide"
        onRequestClose={dismissConflict}
      >
        <View style={styles.overlay}>
          <ScrollView style={styles.scrollSheet} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle}>
              서버에서 패턴이 변경되었습니다
            </Text>
            <Text style={styles.warning}>
              변경된 행을 확인한 뒤 현재 초안으로 덮어쓸지 선택해 주세요.
            </Text>
            {(visibleConflict?.rowDiffs ?? []).map((diff) => (
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
                onPress={dismissConflict}
                style={styles.control}
              >
                <Text style={styles.controlText}>취소</Text>
              </Pressable>
              <Pressable
                disabled={pending}
                onPress={() => {
                  void characterHub.actions.resolvePatternConflict?.();
                }}
                style={styles.control}
              >
                <Text style={styles.deleteText}>덮어쓰기</Text>
              </Pressable>
            </View>
          </ScrollView>
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

function PatternFeedback({ characterHub }: { characterHub: CharacterManagementHubResource }) {
  const { pending, result } = characterHub.patternOperation;
  const [showServer, setShowServer] = useState(false);
  if (pending) return <Text accessibilityRole="alert" style={styles.sheetNote}>패턴 변경을 처리하고 있습니다.</Text>;
  if (!result || result.type === 'Conflict') return null;
  const needsCheck = result.type === 'RefreshRequired' || result.type === 'PartiallyApplied';
  const nextStep = ({ POSITION_GUARD: '위치·호위 저장', SAVE_SLOT: '패턴 슬롯 보관' } as Record<string, string>)[result.nextStep ?? ''];
  const detail = characterHub.detail;
  return (
    <View>
      <Text accessibilityRole="alert" style={result.type === 'Completed' ? styles.sheetNote : styles.warning}>{result.message}</Text>
      {result.type === 'PartiallyApplied' && (
        <>
          <Text style={styles.sheetNote}>완료한 단계: {result.completedSteps}</Text>
          {nextStep && <Text style={styles.sheetNote}>다음 단계: {nextStep}</Text>}
        </>
      )}
      {needsCheck && (
        <Pressable accessibilityRole="button" onPress={() => {
          setShowServer(true);
          void characterHub.actions.refresh();
        }} style={styles.control}>
          <Text style={styles.controlText}>현재 서버 상태 다시 확인</Text>
        </Pressable>
      )}
      {showServer && needsCheck && detail && (
        <View>
          <Text style={styles.sheetLabel}>마지막으로 확인한 서버 설정</Text>
          <Text style={styles.sheetNote}>편집 내용은 유지됩니다. 확인만으로 변경을 다시 제출하지 않습니다.</Text>
          {characterHub.warningMessage && <Text accessibilityRole="alert" style={styles.warning}>{characterHub.warningMessage}</Text>}
          <Text style={styles.sheetNote}>{positionText(detail.positionGuard.selectedPosition)} · {guardText(detail.positionGuard.guardValue)}</Text>
          {detail.actionPatterns.map((row, index) => (
            <Text key={index} style={styles.sheetNote}>{index + 1}행 · {row.judgeText} · {row.quantity} · {row.skillText}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function positionText(value: string) {
  if (value === "front") return "전방";
  if (value === "back") return "후방";
  return value;
}

function guardText(value: string) {
  return ({
    always: "반드시 지킨다",
    never: "지키지 않는다",
    life25: "체력이 25% 이상이면 지킨다",
    life50: "체력이 50% 이상이면 지킨다",
    life75: "체력이 75% 이상이면 지킨다",
    prob25: "25% 확률로 지킨다",
    prpb50: "50% 확률로 지킨다",
    prob50: "50% 확률로 지킨다",
    prob75: "75% 확률로 지킨다",
  } as Record<string, string>)[value] ?? value;
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
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.slotTouch, disabled && styles.disabled]}>
      <Text style={danger ? styles.danger : styles.slotAction}>{label}</Text>
    </Pressable>
  );
}

type PatternPickerEntry =
  | { kind: "CATEGORY"; key: string; label: string }
  | {
      kind: "OPTION";
      key: string;
      option: HofCharacterPatternOption;
      categoryKey: string | null;
      categoryLabel: string | null;
    };

function buildPatternPickerEntries(
  type: "CONDITION" | "SKILL",
  options: HofCharacterPatternOption[],
  query: string,
): PatternPickerEntry[] {
  let categoryKey: string | null = null;
  let categoryLabel: string | null = null;
  const entries = options.map<PatternPickerEntry>((option, index) => {
    if (type === "CONDITION" && option.category?.trim()) {
      categoryKey = `category-${index}-${option.value}`;
      categoryLabel = option.label;
      return {
        kind: "CATEGORY",
        key: categoryKey,
        label: categoryLabel,
      };
    }
    return {
      kind: "OPTION",
      key: `option-${index}-${option.value}`,
      option,
      categoryKey,
      categoryLabel,
    };
  });
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return entries;
  const matchingOptions = entries.filter(
    (entry): entry is Extract<PatternPickerEntry, { kind: "OPTION" }> =>
      entry.kind === "OPTION" &&
      `${entry.option.label} ${entry.categoryLabel ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery),
  );
  const matchingKeys = new Set(matchingOptions.map((entry) => entry.key));
  const matchingCategories = new Set(
    matchingOptions.flatMap((entry) =>
      entry.categoryKey ? [entry.categoryKey] : [],
    ),
  );
  return entries.filter((entry) =>
    entry.kind === "CATEGORY"
      ? matchingCategories.has(entry.key)
      : matchingKeys.has(entry.key),
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
  const filtered = useMemo(
    () => buildPatternPickerEntries(type, options, query),
    [options, query, type],
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
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            if (item.kind === "CATEGORY") {
              return (
                <View accessibilityRole="header" style={styles.optionCategory}>
                  <Text style={styles.optionCategoryText}>{item.label}</Text>
                </View>
              );
            }
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => onSelect(item.option.value)}
                style={styles.option}
              >
                <Text style={styles.optionText}>{item.option.label}</Text>
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  screen: { gap: 9, paddingHorizontal: 10, paddingTop: 10 },
  quickRow: { flexDirection: "row", gap: 8 },
  savedBar: {
    minHeight: 50,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  savedCopy: { flex: 1, minWidth: 0, gap: 2 },
  savedTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "900" },
  savedValue: { color: theme.colors.textMuted, fontSize: 10, fontWeight: "700" },
  importButton: { width: 86, minHeight: 50, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, backgroundColor: "#172130" },
  importText: { color: theme.colors.text, fontSize: 11, fontWeight: "800", lineHeight: 15, textAlign: "center" },
  setupBar: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 11, borderRadius: 9, backgroundColor: "#17202b" },
  setupLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: "800" },
  setupValue: { color: theme.colors.text, fontSize: 11, fontWeight: "900" },
  guardValue: { flex: 1 },
  chevron: { color: theme.colors.textMuted, fontSize: 26 },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "transparent",
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "transparent",
    overflow: "hidden",
    marginBottom: 2,
  },
  rowSelected: { backgroundColor: "#193229", borderColor: "#326d5a" },
  dragging: { opacity: 0.75, borderColor: theme.colors.accentGreen },
  handle: { width: 34, alignItems: "center", justifyContent: "center" },
  handleText: { color: theme.colors.textMuted, fontSize: 19 },
  rowMain: { flex: 1, flexDirection: "row", gap: 4, paddingVertical: 3 },
  choice: { flex: 1, justifyContent: "center", paddingHorizontal: 5 },
  choiceLabel: {
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
  },
  choiceText: {
    color: theme.colors.text,
    lineHeight: 16,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  quantity: {
    width: 48,
    minHeight: 42,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
    color: theme.colors.text,
    backgroundColor: theme.colors.background,
    fontSize: 13,
    paddingVertical: 0,
    textAlign: "center",
    textAlignVertical: "center",
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
  segmentRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  guardOptions: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  pill: {
    minHeight: 38,
    paddingHorizontal: 11,
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
  scrollSheet: {
    flexGrow: 0,
    maxHeight: "78%",
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  sheetContent: { paddingHorizontal: 14, paddingBottom: 22, gap: 7 },
  grip: { width: 36, height: 4, alignSelf: "center", borderRadius: 3, backgroundColor: "#4c596a", marginVertical: 8 },
  sheetTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  sheetNote: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 17 },
  sheetLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "800", marginTop: 5 },
  selectionSummary: { gap: 3, padding: 9, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt },
  selectionValue: { color: theme.colors.text, fontSize: 12, fontWeight: "900" },
  primarySheetButton: { minHeight: 48, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: theme.colors.accentGreen },
  primarySheetButtonText: { color: theme.colors.buttonText, fontWeight: "900", textAlign: "center" },
  saveOption: { flexDirection: "row", alignItems: "center", gap: 9, padding: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 9, backgroundColor: "#17202b" },
  saveOptionActive: { borderColor: "#326d5a", backgroundColor: "#18332b" },
  checkbox: { width: 22, height: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 5 },
  checkboxActive: { borderColor: theme.colors.accentGreen, backgroundColor: theme.colors.accentGreen },
  checkboxText: { color: theme.colors.buttonText, fontWeight: "900" },
  slot: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  slotName: { flex: 1, minWidth: 0, color: theme.colors.text, fontWeight: "800" },
  slotLabel: { minWidth: 48 },
  slotActions: { flexDirection: "row", flexWrap: "wrap", flexShrink: 1, gap: 8, marginLeft: 8 },
  slotTouch: {
    width: 64,
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
  option: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionCategory: {
    minHeight: 34,
    justifyContent: "center",
    backgroundColor: "#1c1a16",
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 8,
    marginBottom: 2,
  },
  optionCategoryText: {
    color: theme.colors.accentAmber,
    fontSize: 12,
    fontWeight: "900",
  },
  optionText: { color: theme.colors.text, fontSize: 15, lineHeight: 20 },
});
