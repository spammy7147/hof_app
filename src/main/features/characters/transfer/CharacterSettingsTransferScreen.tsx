import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CharacterContentScroll } from '../CharacterContentScroll';
import { AppAlert as Alert } from '../../../platform/AppAlert';

import type {
  CharacterPatternSetting,
  CharacterTransferPreview,
  CharacterTransferPreviewRequest,
  HofCharacterDetail,
} from "../../../types/api";
import { theme } from "../../../styles/theme";
import { FixedBottomAction } from "../../../components/FixedBottomAction";
import type { CharacterManagementHubResource } from "../../../domain/characterManagementHubModule";

type Props = {
  characterHub: CharacterManagementHubResource;
  onBack: () => void;
  backLabel?: "패턴" | "관리";
};

export function CharacterSettingsTransferScreen({
  characterHub,
  onBack,
  backLabel = "관리",
}: Props) {
  const target = characterHub.detail!;
  const { characters, transfer } = characterHub;
  const transferRequest = transfer.request;
  const resolvedInitialSourceId =
    transferRequest?.sourceCharacterId ?? transfer.sourceCharacter?.id ?? null;
  const initialSource = characters.find(
    (item) => item.id === resolvedInitialSourceId,
  );
  const [sourceTab, setSourceTab] = useState<"ACTIVE" | "MISSING" | "ARCHIVED">(
    initialSource?.lifecycle ?? "ACTIVE",
  );
  const [sourceId, setSourceId] = useState<number | null>(
    resolvedInitialSourceId,
  );
  const [sourceQuery, setSourceQuery] = useState("");
  const [selectedSlots, setSelectedSlots] = useState<string[]>(
    transferRequest?.transfer.savedPatternMappings.map(({ sourceSlot }) => sourceSlot)
      ?? [],
  );
  const [targetBySource, setTargetBySource] = useState<Record<string, string>>(
    Object.fromEntries(
      transferRequest?.transfer.savedPatternMappings.map(
        ({ sourceSlot, targetSlot }) => [sourceSlot, targetSlot],
      ) ?? [],
    ),
  );
  const [includeCurrentPattern, setIncludeCurrentPattern] = useState(
    transferRequest?.transfer.includeCurrentPattern ?? true,
  );
  const [includeStats, setIncludeStats] = useState(
    transferRequest?.transfer.includeStats ?? false,
  );
  const [includeSkills, setIncludeSkills] = useState(
    transferRequest?.transfer.includeSkills ?? false,
  );
  const [includeEquipment, setIncludeEquipment] = useState(
    transferRequest?.transfer.includeEquipment ?? false,
  );
  const preview = transfer.preview;
  const result = transfer.progress ?? transfer.result;
  const observed = result?.currentSettings;
  const busy = transfer.status === "previewing" || transfer.status === "running";
  const error = transfer.errorMessage;
  const primaryRunsPreview = preview == null
    || transfer.status !== "ready";
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

  const clearTransfer = characterHub.actions.clearTransfer;
  const toggleSlot = (slot: string) => {
    if (busy) return;
    clearTransfer();
    setSelectedSlots((current) =>
      current.includes(slot)
        ? current.filter((value) => value !== slot)
        : [...current, slot],
    );
  };
  const cycleTarget = (sourceSlot: string) => {
    if (busy) return;
    if (targetSlots.length === 0) return;
    const current = targetBySource[sourceSlot] ?? targetSlots[0]!.slot;
    const next =
      targetSlots[
        (targetSlots.findIndex((item) => item.slot === current) + 1) %
          targetSlots.length
      ]!.slot;
    setTargetBySource((values) => ({ ...values, [sourceSlot]: next }));
    clearTransfer();
  };
  const previewTransfer = async () => {
    if (!request) return;
    await characterHub.actions.previewTransfer?.(request);
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
            await characterHub.actions.executeTransfer?.();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel === "관리" ? "관리로 돌아가기" : "패턴으로 돌아가기"}
          onPress={onBack}
          style={styles.touch}
        >
          <Text style={styles.muted}>‹ {backLabel}</Text>
        </Pressable>
        <Text style={styles.title}>설정 가져오기</Text>
        <View style={styles.touch} />
      </View>
      <CharacterContentScroll>
      <View style={styles.tabs}>
        {(["ACTIVE", "MISSING", "ARCHIVED"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => {
              if (busy) return;
              setSourceTab(value);
              setSourceId(null);
              setSourceQuery("");
              setSelectedSlots([]);
              clearTransfer();
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
              if (busy) return;
              setSourceId(item.id);
              setSelectedSlots([]);
              clearTransfer();
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
                if (busy) return;
                setIncludeCurrentPattern(!includeCurrentPattern);
                clearTransfer();
              }}
            />
            <Toggle
              label="스탯"
              selected={includeStats}
              onPress={() => {
                if (busy) return;
                setIncludeStats(!includeStats);
                clearTransfer();
              }}
            />
            <Toggle
              label="스킬"
              selected={includeSkills}
              onPress={() => {
                if (busy) return;
                setIncludeSkills(!includeSkills);
                clearTransfer();
              }}
            />
            <Toggle
              label="현재 장비·저장 1·2"
              selected={includeEquipment}
              onPress={() => {
                if (busy) return;
                setIncludeEquipment(!includeEquipment);
                clearTransfer();
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
              <View style={styles.stepContent}>
                <Text style={styles.stepText}>{transferStepLabel(step, target)}</Text>
                {step.setting && <PatternSettingSummary setting={step.setting} target={target} />}
                {step.identity?.description ? <Text style={styles.muted}>{step.identity.description}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      )}
      {result && (
        <View style={styles.preview}>
          <Text style={styles.heading}>실행 결과</Text>
          {result.outcome && (
            <Text accessibilityRole={result.outcome === "COMPLETED" ? "text" : "alert"}
              style={result.outcome === "COMPLETED" ? styles.heading : styles.warning}>
              {{
                COMPLETED: "설정 가져오기를 완료했습니다.",
                PARTIALLY_APPLIED: "일부 항목을 완료하지 못했습니다.",
                RECHECK_REQUIRED: "현재 캐릭터 설정을 다시 확인해야 합니다.",
                PREVIEW_CHANGED: "변경된 미리보기를 다시 확인해야 합니다.",
              }[result.outcome]}
            </Text>
          )}
          {result.message && <Text style={styles.muted}>{result.message}</Text>}
          {!result.outcome && transfer.result && <Text style={styles.warning}>
            이전 작업에는 최종 확인 정보가 없습니다. 현재 캐릭터 설정을 확인해 주세요.
          </Text>}
          {observed && <View>
              <Text style={styles.heading}>확인된 현재 캐릭터 설정</Text>
              <PatternSettingSummary setting={observed.pattern} target={target} />
              {observed.equipment != null && <Text style={styles.muted}>
                장비 · {observed.equipment.length ? observed.equipment.map(item => item.name).join(", ") : "장착 장비 없음"}
              </Text>}
          </View>}
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
      {source ? (
        <FixedBottomAction>
          <View style={styles.fixedActions}>
            {preview && !primaryRunsPreview ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void previewTransfer()}
                style={[styles.secondary, busy && styles.disabled]}
              >
                <Text style={styles.secondaryText}>다시 확인</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={busy || (!primaryRunsPreview && !preview.executable)}
              onPress={() => void (
                primaryRunsPreview ? previewTransfer() : executeTransfer()
              )}
              style={[
                styles.primary,
                styles.fixedActionButton,
                (busy || (!primaryRunsPreview && !preview.executable)) && styles.disabled,
              ]}
            >
              <Text style={styles.primaryText}>
                {busy
                  ? "확인 중…"
                  : primaryRunsPreview
                    ? preview == null ? "가져오기 확인" : "다시 확인"
                    : "가져오기"}
              </Text>
            </Pressable>
          </View>
        </FixedBottomAction>
      ) : null}
      </CharacterContentScroll>
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
  screen: { flex: 1, minHeight: 0, gap: 12 },
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
  fixedActions: { flexDirection: "row", gap: 8 },
  fixedActionButton: { flex: 1 },
  secondary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 11,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.surfaceAlt,
  },
  secondaryText: { color: theme.colors.text, fontWeight: "900" },
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
  stepContent: { flex: 1, gap: 4, paddingVertical: 8 },
  stepText: { color: theme.colors.text, lineHeight: 19 },
  warning: { color: "#f1bd67", lineHeight: 20 },
  error: { color: theme.colors.danger, lineHeight: 20 },
});

function PatternSettingSummary({ setting, target }: { setting: CharacterPatternSetting; target: HofCharacterDetail }) {
  return <View>
    {setting.rows.map((row, index) => (
      <Text key={index} style={styles.muted}>
        {index + 1}. {target.patternOptions?.find(option => option.type === "CONDITION" && option.value === row.judge)?.label || row.judge}{" "}
        {row.quantity} → {target.patternOptions?.find(option => option.type === "SKILL" && option.value === row.skill)?.label || row.skill}
      </Text>
    ))}
    <Text style={styles.muted}>
      위치 · {setting.position === "front" ? "전열" : setting.position === "back" ? "후열" : setting.position}
      {" / 호위 · "}{target.positionGuard.guardValue === setting.guard ? target.positionGuard.guardText || setting.guard : setting.guard}
    </Text>
  </View>;
}

function transferStepLabel(step: CharacterTransferPreview["steps"][number], target: HofCharacterDetail) {
  if (step.sourceSlot && step.targetSlot) {
    return `저장 패턴 ${step.name || step.sourceSlot} → 대상 슬롯 ${step.targetSlot}${step.replacesExisting ? " 교체" : " 저장"}`;
  }
  if (step.amounts) return `스탯 배분 · ${Object.entries(step.amounts).map(([stat, amount]) => `${stat} +${amount}`).join(" · ")}`;
  if (step.skillValue) {
    const skill = [...target.learnedSkills, ...target.learnableSkills].find(item => item.value === step.skillValue);
    return `스킬 습득 · ${skill?.name ? `${skill.name} (${step.skillValue})` : step.skillValue}`;
  }
  if (step.itemValue) return `${step.equipmentPart ?? "장비"} · ${step.identity?.name ||
    target.equipmentCandidates?.find(item => item.value === step.itemValue)?.name || step.itemValue}`;
  if (step.slotNumber != null) return `장비 설정을 슬롯 ${step.slotNumber}에 저장합니다.`;
  if (step.type === "REMOVE_ALL_EQUIPMENT" || step.id.endsWith(":clear")) return "현재 장비를 모두 해제합니다.";
  if (step.id.includes("equipment")) return "장비 설정을 적용합니다.";
  if (step.id === "preserve-current-pattern") return "대상의 최초 패턴·위치·호위를 복원합니다.";
  if (step.id.includes("current-pattern")) return "현재 패턴·위치·호위를 적용합니다.";
  return "선택한 설정을 적용합니다.";
}
