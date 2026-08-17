import { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type {
  CharacterTransferExecutionResult,
  CharacterTransferPreview,
  CharacterTransferPreviewRequest,
  HofCharacter,
  HofCharacterDetail,
} from "../../../types/api";
import { theme } from "../../../styles/theme";
import { toUserFacingErrorMessage } from "../../../domain/userFacingErrors";

type Props = {
  target: HofCharacterDetail;
  characters: HofCharacter[];
  onBack: () => void;
  onPreview: (
    request: CharacterTransferPreviewRequest,
  ) => Promise<CharacterTransferPreview>;
  onExecute: (
    request: CharacterTransferPreviewRequest,
    onProgress?: (progress: CharacterTransferExecutionResult) => void,
  ) => Promise<CharacterTransferExecutionResult>;
  initialSourceId?: number | null;
};

export function CharacterSettingsTransferScreen({
  target,
  characters,
  initialSourceId,
  onBack,
  onPreview,
  onExecute,
}: Props) {
  const initialSource = characters.find((item) => item.id === initialSourceId);
  const [sourceTab, setSourceTab] = useState<"ACTIVE" | "MISSING" | "ARCHIVED">(
    initialSource?.lifecycle ?? "ACTIVE",
  );
  const [sourceId, setSourceId] = useState<number | null>(
    initialSourceId ?? null,
  );
  const [sourceQuery, setSourceQuery] = useState("");
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [targetBySource, setTargetBySource] = useState<Record<string, string>>(
    {},
  );
  const [includeCurrentPattern, setIncludeCurrentPattern] = useState(true);
  const [includeStats, setIncludeStats] = useState(false);
  const [includeSkills, setIncludeSkills] = useState(false);
  const [includeEquipment, setIncludeEquipment] = useState(false);
  const [preview, setPreview] = useState<CharacterTransferPreview | null>(null);
  const [result, setResult] = useState<CharacterTransferExecutionResult | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sources = useMemo(() => {
    const normalized = sourceQuery.trim().toLowerCase();
    return characters.filter(
      (item) =>
        item.id !== target.id &&
        (item.lifecycle ?? "ACTIVE") === sourceTab &&
        (!normalized ||
          `${item.name} ${item.job}`.toLowerCase().includes(normalized)),
    );
  }, [characters, sourceQuery, sourceTab, target.id]);
  const source = characters.find((item) => item.id === sourceId) ?? null;
  const sourceSlots =
    source?.patternSlots?.filter((slot) => slot.canLoad) ?? [];
  const targetSlots = target.patternSlots;

  const request = useMemo<CharacterTransferPreviewRequest | null>(
    () =>
      source
        ? {
            sourceCharacterId: source.id,
            targetCharacterId: target.id,
            transfer: {
              includeCurrentPattern,
              savedPatternMappings: selectedSlots.map((sourceSlot, index) => ({
                sourceSlot,
                targetSlot:
                  targetBySource[sourceSlot] ??
                  targetSlots[index]?.slot ??
                  targetSlots[0]?.slot ??
                  sourceSlot,
              })),
              includeStats,
              includeSkills,
              includeEquipment,
            },
          }
        : null,
    [
      includeCurrentPattern,
      includeEquipment,
      includeSkills,
      includeStats,
      selectedSlots,
      source,
      target.id,
      targetBySource,
      targetSlots,
    ],
  );

  const toggleSlot = (slot: string) => {
    setPreview(null);
    setResult(null);
    setSelectedSlots((current) =>
      current.includes(slot)
        ? current.filter((value) => value !== slot)
        : [...current, slot],
    );
  };
  const cycleTarget = (sourceSlot: string) => {
    if (targetSlots.length === 0) return;
    const current = targetBySource[sourceSlot] ?? targetSlots[0]!.slot;
    const next =
      targetSlots[
        (targetSlots.findIndex((item) => item.slot === current) + 1) %
          targetSlots.length
      ]!.slot;
    setTargetBySource((values) => ({ ...values, [sourceSlot]: next }));
    setPreview(null);
  };
  const previewTransfer = async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await onPreview(request));
    } catch (caught) {
      setError(toUserFacingErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const executeTransfer = async () => {
    if (!request || !preview?.executable) return;
    Alert.alert(
      "설정 가져오기",
      `${source?.name}의 선택한 설정을 ${target.name}에게 적용하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "가져오기",
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              setResult(await onExecute(request, setResult));
            } catch (caught) {
              setError(toUserFacingErrorMessage(caught));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.touch}>
          <Text style={styles.muted}>‹ 관리</Text>
        </Pressable>
        <Text style={styles.title}>설정 가져오기</Text>
        <View style={styles.touch} />
      </View>
      <View style={styles.tabs}>
        {(["ACTIVE", "MISSING", "ARCHIVED"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => {
              setSourceTab(value);
              setSourceId(null);
              setSourceQuery("");
              setSelectedSlots([]);
              setPreview(null);
            }}
            style={[styles.tab, sourceTab === value && styles.tabActive]}
          >
            <Text
              style={[
                styles.tabText,
                sourceTab === value && styles.tabTextActive,
              ]}
            >
              {value === "ACTIVE"
                ? "캐릭터"
                : value === "MISSING"
                  ? "사라짐"
                  : "보관함"}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="원본 캐릭터 검색"
        value={sourceQuery}
        onChangeText={setSourceQuery}
        placeholder="이름·직업 검색"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.search}
      />
      <FlatList
        data={sources}
        keyExtractor={(item) => String(item.id)}
        initialNumToRender={12}
        windowSize={7}
        nestedScrollEnabled
        style={styles.cards}
        ItemSeparatorComponent={() => <View style={styles.cardGap} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              setSourceId(item.id);
              setSelectedSlots([]);
              setPreview(null);
            }}
            style={[styles.character, sourceId === item.id && styles.selected]}
          >
            <Text style={styles.characterName}>{item.name}</Text>
            <Text style={styles.muted}>
              Lv.{item.level ?? "-"} · {item.job}
            </Text>
          </Pressable>
        )}
      />
      {source && (
        <>
          <Text style={styles.heading}>가져올 설정</Text>
          <View style={styles.options}>
            <Toggle
              label="현재 패턴·위치·호위"
              selected={includeCurrentPattern}
              onPress={() => {
                setIncludeCurrentPattern(!includeCurrentPattern);
                setPreview(null);
              }}
            />
            <Toggle
              label="스탯"
              selected={includeStats}
              onPress={() => {
                setIncludeStats(!includeStats);
                setPreview(null);
              }}
            />
            <Toggle
              label="스킬"
              selected={includeSkills}
              onPress={() => {
                setIncludeSkills(!includeSkills);
                setPreview(null);
              }}
            />
            <Toggle
              label="현재 장비·저장 1·2"
              selected={includeEquipment}
              onPress={() => {
                setIncludeEquipment(!includeEquipment);
                setPreview(null);
              }}
            />
          </View>
          <Text style={styles.heading}>저장 패턴</Text>
          <View style={styles.slots}>
            {sourceSlots.map((slot) => (
              <Pressable
                key={slot.slot}
                onPress={() => toggleSlot(slot.slot)}
                style={[
                  styles.slot,
                  selectedSlots.includes(slot.slot) && styles.selected,
                ]}
              >
                <Text style={styles.slotName}>{slot.label}</Text>
              </Pressable>
            ))}
          </View>
          {selectedSlots.map((slot) => {
            const sourceName =
              sourceSlots.find((item) => item.slot === slot)?.label ?? slot;
            const targetSlot = targetBySource[slot] ?? targetSlots[0]?.slot;
            const targetName =
              targetSlots.find((item) => item.slot === targetSlot)?.label ??
              "빈 슬롯";
            return (
              <Pressable
                key={slot}
                onPress={() => cycleTarget(slot)}
                style={styles.mapping}
              >
                <Text style={styles.mappingText}>{sourceName}</Text>
                <Text style={styles.arrow}>→</Text>
                <View style={styles.mappingTarget}>
                  <Text style={styles.mappingText}>{targetName}</Text>
                  <Text style={styles.muted}>눌러서 대상 변경</Text>
                </View>
              </Pressable>
            );
          })}
          <Pressable
            disabled={busy}
            onPress={() => void previewTransfer()}
            style={[styles.primary, busy && styles.disabled]}
          >
            <Text style={styles.primaryText}>
              {busy ? "확인 중…" : "가져오기 확인"}
            </Text>
          </Pressable>
        </>
      )}
      {preview && (
        <View style={styles.preview}>
          <Text style={styles.heading}>
            {preview.executable ? "적용할 수 있습니다" : "확인이 필요합니다"}
          </Text>
          <Text style={styles.muted}>
            작업 {preview.steps.length}개 · 안내 {preview.issues.length}개
          </Text>
          {preview.issues.map((issue) => (
            <Text
              key={`${issue.code}-${issue.itemKey}`}
              style={
                issue.severity === "BLOCKING" ? styles.error : styles.warning
              }
            >
              • {issue.message}
            </Text>
          ))}
          {preview.steps.map((step, index) => (
            <View key={step.id} style={styles.step}>
              <Text style={styles.stepNumber}>{index + 1}</Text>
              <Text style={styles.stepText}>{transferStepLabel(step)}</Text>
            </View>
          ))}
          <Pressable
            disabled={!preview.executable || busy}
            onPress={() => void executeTransfer()}
            style={[
              styles.primary,
              (!preview.executable || busy) && styles.disabled,
            ]}
          >
            <Text style={styles.primaryText}>가져오기</Text>
          </Pressable>
        </View>
      )}
      {result && (
        <View style={styles.preview}>
          <Text style={styles.heading}>실행 결과</Text>
          {result.results.map((item) => (
            <Text
              key={item.stepId}
              style={item.status === "FAILED" ? styles.error : styles.muted}
            >
              {item.status === "COMPLETED"
                ? "완료"
                : item.status === "SKIPPED"
                  ? "건너뜀"
                  : "실패"}{" "}
              · {item.stepId}
              {item.message ? ` · ${item.message}` : ""}
            </Text>
          ))}
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function Toggle({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.toggle, selected && styles.selected]}
    >
      <Text style={styles.toggleText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 12 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  touch: { minWidth: 72, minHeight: 48, justifyContent: "center" },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  tabs: { flexDirection: "row", gap: 4 },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 9,
  },
  tabActive: { backgroundColor: "#22483d" },
  tabText: { color: theme.colors.textMuted, fontWeight: "800" },
  tabTextActive: { color: theme.colors.accentGreen },
  cards: { maxHeight: 280 },
  cardGap: { height: 6 },
  search: {
    minHeight: 48,
    borderRadius: 10,
    paddingHorizontal: 13,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
  },
  character: {
    minHeight: 56,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: "transparent",
  },
  selected: {
    borderColor: theme.colors.accentGreen,
    backgroundColor: "#18332b",
  },
  characterName: { color: theme.colors.text, fontWeight: "900" },
  muted: { color: theme.colors.textMuted },
  heading: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  toggle: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: "transparent",
  },
  toggleText: { color: theme.colors.text, fontWeight: "800" },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  slot: {
    minHeight: 48,
    minWidth: 96,
    justifyContent: "center",
    paddingHorizontal: 11,
    borderRadius: 9,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: "transparent",
  },
  slotName: { color: theme.colors.text, fontWeight: "800" },
  mapping: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceAlt,
  },
  mappingText: { color: theme.colors.text, fontWeight: "800" },
  mappingTarget: { flex: 1 },
  arrow: { color: theme.colors.accentGreen, fontWeight: "900" },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: theme.colors.accentGreen,
  },
  primaryText: { color: theme.colors.buttonText, fontWeight: "900" },
  disabled: { opacity: 0.35 },
  preview: {
    gap: 8,
    padding: 13,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceAlt,
  },
  step: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 8,
    paddingHorizontal: 9,
    backgroundColor: theme.colors.background,
  },
  stepNumber: {
    width: 22,
    color: theme.colors.accentGreen,
    fontWeight: "900",
    textAlign: "center",
  },
  stepText: { flex: 1, color: theme.colors.text, lineHeight: 19 },
  warning: { color: "#f1bd67", lineHeight: 20 },
  error: { color: theme.colors.danger, lineHeight: 20 },
});

function transferStepLabel(step: CharacterTransferPreview["steps"][number]) {
  if (step.sourceSlot && step.targetSlot) {
    return `저장 패턴 ${step.name || step.sourceSlot} → 대상 슬롯 ${step.targetSlot}${step.replacesExisting ? " 교체" : " 저장"}`;
  }
  if (step.amounts) return "추가 가능한 스탯을 배분합니다.";
  if (step.skillValue) return "배울 수 있는 스킬을 습득합니다.";
  if (step.itemValue) return `${step.equipmentPart ?? "장비"} 장비를 적용합니다.`;
  if (step.id.includes("equipment")) return "장비 설정을 적용합니다.";
  if (step.id.includes("current-pattern")) return "현재 패턴·위치·호위를 적용합니다.";
  return "선택한 설정을 적용합니다.";
}
