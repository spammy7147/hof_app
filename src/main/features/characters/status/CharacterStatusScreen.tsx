import { useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type {
  CharacterCommand,
  CharacterCommandResult,
  CharacterStat,
  HofCharacterDetail,
  HofCharacterStatusEffect,
} from "../../../types/api";
import { theme } from "../../../styles/theme";
import { CHARACTER_PATTERN_THRESHOLDS, recommendPatternStats } from "../../../domain/characterStats";

const STAT_GUIDES: Array<[CharacterStat, string, string]> = [
  ["STR", "힘 기반 물리 공격력 증가", "HP 증가(상) · Real STR 10당 Handle 1 증가"],
  ["INT", "인트 기반 마법 공격력 증가", "HP 증가(하) · 패턴 요구 수치에 1:1 반영"],
  ["DEX", "덱스 기반 물리 공격력 증가", "HP 증가(하) · Real DEX 5당 Handle 1 증가 · 소환력 증가(하)"],
  ["SPD", "더 빠르게 행동", "패턴 요구 수치에 5:1 반영"],
  ["LUK", "럭 크리티컬·럭 회피에 영향", "소환력 증가(상)"],
];

export function CharacterStatusScreen({
  detail,
  onCommand,
  helpOpen = false,
  onOpenHelp,
  onCloseHelp,
}: {
  detail: HofCharacterDetail;
  onCommand?: (command: CharacterCommand) => Promise<CharacterCommandResult | void>;
  helpOpen?: boolean;
  onOpenHelp?: () => void;
  onCloseHelp?: () => void;
}) {
  const [targetOpen, setTargetOpen] = useState(false);
  const [targetPatterns, setTargetPatterns] = useState<number | null>(null);
  const [effectDetail, setEffectDetail] = useState<HofCharacterStatusEffect | null>(null);
  const [amounts, setAmounts] = useState<Partial<Record<CharacterStat, string>>>({});
  const stats = detail.stats;
  const statRows: Array<[CharacterStat, number | null | undefined, number | null | undefined]> = [
    ["STR", stats.strReal, stats.strBonus],
    ["INT", stats.intReal, stats.intBonus],
    ["DEX", stats.dexReal, stats.dexBonus],
    ["SPD", stats.spdReal, stats.spdBonus],
    ["LUK", stats.lukReal, stats.lukBonus],
  ];
  const used = useMemo(
    () => Object.values(amounts).reduce((sum, value) => sum + (Number(value) || 0), 0),
    [amounts],
  );
  const plans = CHARACTER_PATTERN_THRESHOLDS.map((_, index) =>
    recommendPatternStats(stats.intReal ?? 0, stats.spdReal ?? 0, stats.statusPoints ?? 0, index + 1),
  );
  const recommendations = plans.filter((value) => value != null);
  const recommendation = recommendations.find((value) => value.additionalPatterns === targetPatterns) ?? null;
  const displayEffects = useMemo(
    () => (detail.statusEffects ?? []).flatMap((effect) => {
      const valueText = effect.valueText.replace(/_{8,}/g, " ").replace(/\s+/g, " ").trim();
      if (!valueText || /^[|｜¦]+$/.test(valueText)) return [];
      return [{ ...effect, valueText }];
    }),
    [detail.statusEffects],
  );
  const expPercent = stats.expMaxed
    ? 100
    : Math.max(0, Math.min(100, ((stats.expCurrent ?? 0) / Math.max(1, stats.expMax ?? 1)) * 100));

  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <View style={styles.portrait}>
          {detail.imageUrl ? (
            <Image source={{ uri: detail.imageUrl }} resizeMode="contain" style={styles.portraitImage} />
          ) : (
            <Text style={styles.portraitFallback}>{detail.name.slice(0, 1)}</Text>
          )}
        </View>
        <View style={styles.heroBody}>
          <View style={styles.nameRow}>
            <View style={styles.heroBody}>
              <Text style={styles.characterName}>{detail.name}</Text>
              <Text style={styles.characterMeta}>Lv.{detail.level ?? "-"} · {detail.job}</Text>
            </View>
            <Pressable accessibilityLabel="스탯 도움말" accessibilityRole="button" onPress={onOpenHelp} style={styles.helpButton}>
              <Text style={styles.helpButtonText}>?</Text>
            </Pressable>
          </View>
          <View style={styles.expHead}>
            <Text style={styles.caption}>EXP</Text>
            <Text style={styles.caption}>
              {stats.expMaxed ? "MAX" : `${formatNumber(stats.expCurrent)} / ${formatNumber(stats.expMax)}`}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${expPercent}%` }]} />
          </View>
          <Text style={styles.freshness}>{formatFreshness(detail.detailSyncedAt ?? null)}</Text>
        </View>
      </View>

      <View style={styles.vitals}>
        <Vital label="HP" base={stats.hpBase} bonus={stats.hpBonus} />
        <Vital label="SP" base={stats.spBase} bonus={stats.spBonus} />
      </View>

      <View style={styles.statStrip}>
        {statRows.map(([name, real, bonus]) => (
          <View key={name} style={styles.statSummary}>
            <Text style={styles.caption}>{name}</Text>
            <Text style={styles.statSummaryValue}>{real ?? "-"} + {bonus ?? 0}</Text>
          </View>
        ))}
      </View>

      {displayEffects.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>상태 효과</Text>
          <View style={styles.effects}>
            {displayEffects.map((effect, index) => (
              <Pressable
                key={`${effect.name}-${index}`}
                accessibilityRole={effect.description ? "button" : undefined}
                disabled={!effect.description}
                onPress={() => setEffectDetail(effect)}
                style={[styles.effect, effect.active === true && styles.effectActive, effect.active === false && styles.effectInactive]}
              >
                <Text style={[styles.effectText, effect.active === true && styles.effectTextActive]}>{effect.valueText}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {detail.faith && (
        <View style={styles.faith}>
          <View style={styles.faithHead}>
            <Text style={styles.caption}>신앙 · {detail.faith.godName}</Text>
            <Text style={styles.faithValue}>{detail.faith.current.toLocaleString()} / {detail.faith.max.toLocaleString()}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(100, (detail.faith.current / Math.max(1, detail.faith.max)) * 100)}%` }]} />
          </View>
        </View>
      )}

      <View style={styles.allocate}>
        <View style={styles.allocateHead}>
          <Text style={styles.sectionTitle}>스탯 배분</Text>
          <View style={styles.pointValue}>
            <Text style={styles.caption}>남은 STATUS POINT</Text>
            <Text style={styles.pointNumber}>{Math.max(0, (stats.statusPoints ?? 0) - used)}</Text>
          </View>
        </View>
        <View style={styles.allocateList}>
          {statRows.map(([name, real]) => {
            const added = Number(amounts[name]) || 0;
            return (
              <View key={name} style={styles.allocateRow}>
                <Text style={styles.allocateName}>{name}</Text>
                <Text style={styles.allocateValue}>{real ?? "-"}{added > 0 ? ` → ${(real ?? 0) + added}` : ""}</Text>
                <TextInput
                  accessibilityRole="spinbutton"
                  accessibilityLabel={`${name} 추가 포인트`}
                  keyboardType="number-pad"
                  value={amounts[name] ?? ""}
                  onChangeText={(value) => setAmounts((current) => ({ ...current, [name]: value.replace(/\D/g, "") }))}
                  placeholder="0"
                  placeholderTextColor={theme.colors.textMuted}
                  style={styles.pointInput}
                />
              </View>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={used <= 0 || used > (stats.statusPoints ?? 0)}
          onPress={() => onCommand?.({
            type: "ALLOCATE_STATS",
            characterId: detail.id,
            expectedRevision: detail.revision,
            amounts: Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, Number(value) || 0])),
          })}
          style={[styles.apply, (used <= 0 || used > (stats.statusPoints ?? 0)) && styles.disabled]}
        >
          <Text style={styles.applyText}>스탯 올리기{used > 0 ? ` · ${used}pt` : ""}</Text>
        </Pressable>
      </View>

      <Modal visible={helpOpen} transparent animationType="slide" onRequestClose={onCloseHelp}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onCloseHelp} />
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>스탯 역할</Text>
              <Text style={styles.sheetSubtitle}>패턴 요구 수치는 Real INT와 Real SPD만 사용합니다.</Text>
              {STAT_GUIDES.map(([name, primary, secondary]) => (
                <View key={name} style={styles.guideRow}>
                  <Text style={styles.guideName}>{name}</Text>
                  <Text style={styles.guideText}>{primary}{"\n"}{secondary}</Text>
                </View>
              ))}
              <View style={styles.formula}>
                <Text style={styles.formulaLabel}>패턴 요구 수치</Text>
                <Text style={styles.formulaText}>Real INT + (Real SPD ÷ 5의 정수 몫)</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setTargetOpen(true)} style={styles.targetSelect}>
                <Text style={styles.targetLabel}>원하는 추가 패턴 수</Text>
                <View style={styles.targetValueRow}>
                  <Text style={styles.targetValue}>기본 + {targetPatterns ?? "선택"}</Text>
                  <Text style={styles.chevron}>⌄</Text>
                </View>
              </Pressable>
              <View style={styles.thresholds}>
                {CHARACTER_PATTERN_THRESHOLDS.map((threshold, index) => (
                  <View key={threshold} style={[styles.threshold, targetPatterns != null && index < targetPatterns && styles.thresholdActive]}>
                    <Text style={styles.thresholdValue}>{threshold}</Text>
                    <Text style={styles.thresholdLabel}>기본 +{index + 1}</Text>
                  </View>
                ))}
              </View>
              {recommendation && (
                <View style={styles.recommendation}>
                  <View style={styles.recommendCells}>
                    <RecommendCell label="Real INT" value={`+${recommendation.addInt}`} />
                    <RecommendCell label="Real SPD" value={`+${recommendation.addSpd}`} />
                  </View>
                  <View style={styles.recommendSummary}>
                    <Text style={styles.recommendText}>{recommendation.pointsUsed}pt 사용</Text>
                    <Text style={styles.recommendRemaining}>{recommendation.pointsRemaining}pt 남음</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setAmounts((current) => ({ ...current, INT: String(recommendation.addInt), SPD: String(recommendation.addSpd) }));
                      onCloseHelp?.();
                    }}
                    style={styles.recommendButton}
                  >
                    <Text style={styles.recommendButtonText}>배분에 반영</Text>
                  </Pressable>
                </View>
              )}
              <Pressable onPress={onCloseHelp} style={styles.closeButton}><Text style={styles.closeText}>닫기</Text></Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={targetOpen} transparent animationType="slide" onRequestClose={() => setTargetOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTargetOpen(false)} />
          <View style={styles.targetSheet}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>원하는 추가 패턴 수</Text>
            {CHARACTER_PATTERN_THRESHOLDS.map((_, index) => {
              const plan = plans[index];
              return (
                <Pressable
                  key={index}
                  accessibilityRole="button"
                  disabled={!plan}
                  onPress={() => { setTargetPatterns(index + 1); setTargetOpen(false); }}
                  style={[styles.targetOption, !plan && styles.disabled]}
                >
                  <Text style={styles.targetOptionText}>기본 + {index + 1}</Text>
                  <Text style={styles.targetOptionMeta}>{plan ? `INT +${plan.addInt} · SPD +${plan.addSpd}` : "선택할 수 없음"}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      <Modal visible={effectDetail != null} transparent animationType="slide" onRequestClose={() => setEffectDetail(null)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEffectDetail(null)} />
          <View style={styles.targetSheet}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>{effectDetail?.valueText}</Text>
            <Text style={styles.sheetSubtitle}>{effectDetail?.description}</Text>
            <Pressable onPress={() => setEffectDetail(null)} style={styles.closeButton}><Text style={styles.closeText}>닫기</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Vital({ label, base, bonus }: { label: string; base?: number | null; bonus?: number | null }) {
  const total = base == null ? null : base + (bonus ?? 0);
  return (
    <View style={styles.vital}>
      <Text style={styles.caption}>{label}</Text>
      <Text style={styles.vitalTotal}>{total == null ? "-" : total.toLocaleString()}</Text>
      <Text style={styles.vitalBreakdown}>{base == null ? "" : `${formatNumber(base)} + ${formatNumber(bonus ?? 0)}`}</Text>
    </View>
  );
}

function RecommendCell({ label, value }: { label: string; value: string }) {
  return <View style={styles.recommendCell}><Text style={styles.caption}>{label}</Text><Text style={styles.recommendCellValue}>{value}</Text></View>;
}

function formatNumber(value: number | null | undefined) {
  return value == null ? "-" : value.toLocaleString();
}

function formatFreshness(value: string | null) {
  if (!value) return "동기화 필요";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? "방금 동기화" : `${minutes}분 전 동기화`;
}

const styles = StyleSheet.create({
  screen: { gap: 12, paddingHorizontal: 12, paddingTop: 14 },
  hero: { flexDirection: "row", gap: 12 },
  portrait: {
    width: 72,
    height: 72,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceAlt,
  },
  portraitImage: { width: 68, height: 68 },
  portraitFallback: { color: theme.colors.text, fontSize: 24, fontWeight: "900" },
  heroBody: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  characterName: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  characterMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  helpButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  helpButtonText: { color: theme.colors.accentBlue, fontWeight: "900" },
  expHead: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  caption: { color: theme.colors.textMuted, fontSize: 10, fontWeight: "800" },
  progressTrack: { height: 5, marginTop: 4, borderRadius: 4, overflow: "hidden", backgroundColor: "#273242" },
  progressFill: { height: "100%", backgroundColor: theme.colors.accentGreen },
  freshness: { color: theme.colors.textMuted, fontSize: 9, marginTop: 5, textAlign: "right" },
  vitals: { flexDirection: "row", gap: 7 },
  vital: { flex: 1, padding: 10, borderRadius: 9, backgroundColor: theme.colors.surface },
  vitalTotal: { color: theme.colors.text, fontSize: 17, fontWeight: "900", marginTop: 3 },
  vitalBreakdown: { color: theme.colors.accentBlue, fontSize: 10, marginTop: 2 },
  statStrip: { flexDirection: "row", gap: 5 },
  statSummary: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 8, backgroundColor: theme.colors.surface },
  statSummaryValue: { color: theme.colors.text, fontSize: 11, fontWeight: "900", marginTop: 4 },
  section: { gap: 7, paddingTop: 2 },
  sectionTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "900" },
  effects: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  effect: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 7, backgroundColor: "#192330" },
  effectActive: { backgroundColor: "#193229" },
  effectInactive: { opacity: 0.65 },
  effectText: { color: "#d5dde8", fontSize: 11, fontWeight: "700" },
  effectTextActive: { color: theme.colors.accentGreen },
  faith: { padding: 10, borderRadius: 9, backgroundColor: theme.colors.surface },
  faithHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  faithValue: { color: theme.colors.text, fontSize: 11, fontWeight: "900" },
  allocate: { gap: 8, padding: 11, borderRadius: 12, backgroundColor: "#18212c" },
  allocateHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pointValue: { alignItems: "flex-end" },
  pointNumber: { color: theme.colors.accentGreen, fontSize: 18, fontWeight: "900" },
  allocateList: { gap: 2 },
  allocateRow: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 7 },
  allocateName: { width: 42, color: theme.colors.text, fontWeight: "900" },
  allocateValue: { flex: 1, color: theme.colors.textMuted, fontSize: 12 },
  pointInput: {
    width: 92,
    minHeight: 44,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 7,
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 20,
    paddingVertical: 0,
    textAlign: "center",
    textAlignVertical: "center",
    fontWeight: "900",
  },
  apply: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: theme.colors.accentGreen },
  applyText: { color: theme.colors.buttonText, fontWeight: "900" },
  disabled: { opacity: 0.35 },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.72)" },
  sheet: {
    maxHeight: "82%",
    paddingHorizontal: 14,
    paddingBottom: 24,
    borderTopLeftRadius: 19,
    borderTopRightRadius: 19,
    backgroundColor: "#1b2430",
  },
  targetSheet: {
    maxHeight: "76%",
    gap: 7,
    paddingHorizontal: 14,
    paddingBottom: 24,
    borderTopLeftRadius: 19,
    borderTopRightRadius: 19,
    backgroundColor: "#1b2430",
  },
  grip: { width: 36, height: 4, alignSelf: "center", borderRadius: 3, backgroundColor: "#4c596a", marginVertical: 9 },
  sheetTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  sheetSubtitle: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 8 },
  guideRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#2c3746" },
  guideName: { color: theme.colors.accentBlue, fontSize: 12, fontWeight: "900" },
  guideText: { color: "#d4dde8", fontSize: 11, lineHeight: 17, marginTop: 3 },
  formula: { gap: 4, marginTop: 10, padding: 12, borderRadius: 8, backgroundColor: "#121923" },
  formulaLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "800" },
  formulaText: { color: theme.colors.text, fontSize: 15, fontWeight: "900", lineHeight: 22 },
  targetSelect: { marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt },
  targetLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "800" },
  targetValueRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  targetValue: { color: theme.colors.text, fontSize: 14, fontWeight: "900" },
  chevron: { color: theme.colors.textMuted, fontSize: 18 },
  thresholds: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
  threshold: { width: "18%", flexGrow: 1, alignItems: "center", paddingVertical: 6, borderRadius: 7, backgroundColor: "#222c39" },
  thresholdActive: { backgroundColor: "#193229" },
  thresholdValue: { color: theme.colors.text, fontSize: 11, fontWeight: "900" },
  thresholdLabel: { color: theme.colors.textMuted, fontSize: 8, marginTop: 2 },
  recommendation: { gap: 8, marginTop: 10, padding: 10, borderRadius: 9, backgroundColor: "#18251f" },
  recommendCells: { flexDirection: "row", gap: 6 },
  recommendCell: { flex: 1, padding: 8, borderRadius: 7, backgroundColor: "#223129" },
  recommendCellValue: { color: theme.colors.text, fontSize: 14, fontWeight: "900", marginTop: 3 },
  recommendSummary: { flexDirection: "row", justifyContent: "space-between" },
  recommendText: { color: theme.colors.text, fontSize: 11 },
  recommendRemaining: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: "900" },
  recommendButton: { minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 7, backgroundColor: theme.colors.accentGreen },
  recommendButtonText: { color: theme.colors.buttonText, fontWeight: "900" },
  closeButton: { minHeight: 42, alignItems: "center", justifyContent: "center", marginTop: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt },
  closeText: { color: theme.colors.text, fontWeight: "900" },
  targetOption: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, borderRadius: 9, backgroundColor: theme.colors.surfaceAlt },
  targetOptionText: { color: theme.colors.text, fontWeight: "900" },
  targetOptionMeta: { color: theme.colors.textMuted, fontSize: 11 },
});
