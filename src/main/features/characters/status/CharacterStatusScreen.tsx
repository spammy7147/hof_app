import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  CharacterCommand,
  CharacterCommandResult,
  CharacterStat,
  HofCharacterDetail,
} from "../../../types/api";
import { theme } from "../../../styles/theme";
import {
  CHARACTER_PATTERN_THRESHOLDS,
  recommendPatternStats,
} from "../../../domain/characterStats";

export function CharacterStatusScreen({
  detail,
  onCommand,
  helpOpen = false,
  onCloseHelp,
}: {
  detail: HofCharacterDetail;
  onCommand?: (
    command: CharacterCommand,
  ) => Promise<CharacterCommandResult | void>;
  helpOpen?: boolean;
  onCloseHelp?: () => void;
}) {
  const [targetOpen, setTargetOpen] = useState(false);
  const [targetPatterns, setTargetPatterns] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<
    Partial<Record<CharacterStat, string>>
  >({});
  const stats = detail.stats;
  const statRows: Array<
    [CharacterStat, number | null | undefined, number | null | undefined]
  > = [
    ["STR", stats.strReal, stats.strBonus],
    ["INT", stats.intReal, stats.intBonus],
    ["DEX", stats.dexReal, stats.dexBonus],
    ["SPD", stats.spdReal, stats.spdBonus],
    ["LUK", stats.lukReal, stats.lukBonus],
  ];
  const used = useMemo(
    () =>
      Object.values(amounts).reduce(
        (sum, value) => sum + (Number(value) || 0),
        0,
      ),
    [amounts],
  );
  const revision = detail.revision;
  const recommendations = CHARACTER_PATTERN_THRESHOLDS.map((_, index) =>
    recommendPatternStats(
      stats.intReal ?? 0,
      stats.spdReal ?? 0,
      stats.statusPoints ?? 0,
      index + 1,
    ),
  ).filter((value) => value != null);
  const recommendation =
    recommendations.find(
      (value) => value.additionalPatterns === targetPatterns,
    ) ?? null;
  return (
    <View style={styles.screen}>
      <View style={styles.vitals}>
        <Metric
          label="EXP"
          value={
            stats.expMaxed
              ? "MAX"
              : `${stats.expCurrent ?? "-"} / ${stats.expMax ?? "-"}`
          }
        />
        <Metric
          label="HP"
          value={`${stats.hpBase ?? "-"} + ${stats.hpBonus ?? 0}`}
        />
        <Metric
          label="SP"
          value={`${stats.spBase ?? "-"} + ${stats.spBonus ?? 0}`}
        />
      </View>
      <View style={styles.statBox}>
        {statRows.map(([name, real, bonus]) => (
          <View key={name} style={styles.statRow}>
            <Text style={styles.statName}>{name}</Text>
            <Text style={styles.statValue}>
              {real ?? "-"} + {bonus ?? 0}
            </Text>
            <TextInput
              accessibilityRole="spinbutton"
              accessibilityLabel={`${name} 추가 포인트`}
              keyboardType="number-pad"
              value={amounts[name] ?? ""}
              onChangeText={(value) =>
                setAmounts((current) => ({
                  ...current,
                  [name]: value.replace(/\D/g, ""),
                }))
              }
              placeholder="0"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.pointInput}
            />
          </View>
        ))}
      </View>
      <View style={styles.recommendBox}>
        <Text style={styles.recommendLabel}>원하는 추가 패턴 수</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setTargetOpen(true)}
          style={styles.dropdown}
        >
          <Text style={styles.dropdownText}>
            기본 + {targetPatterns ?? "선택"}
          </Text>
          <Text style={styles.dropdownText}>⌄</Text>
        </Pressable>
        {recommendation && (
          <View style={styles.recommendResult}>
            <Text style={styles.recommendValue}>
              INT +{recommendation.addInt} · SPD +{recommendation.addSpd}
            </Text>
            <Text style={styles.effectDescription}>
              {recommendation.pointsUsed}pt 사용 ·{" "}
              {recommendation.pointsRemaining}pt 남음
            </Text>
            <Pressable
              onPress={() =>
                setAmounts((current) => ({
                  ...current,
                  INT: String(recommendation.addInt),
                  SPD: String(recommendation.addSpd),
                }))
              }
              style={styles.fillButton}
            >
              <Text style={styles.fillText}>입력에 반영</Text>
            </Pressable>
          </View>
        )}
      </View>
      <View style={styles.pointFooter}>
        <Text style={styles.pointText}>
          Status Point {Math.max(0, (stats.statusPoints ?? 0) - used)}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={used <= 0 || used > (stats.statusPoints ?? 0)}
          onPress={() =>
            onCommand?.({
              type: "ALLOCATE_STATS",
              characterId: detail.id,
              expectedRevision: revision,
              amounts: Object.fromEntries(
                Object.entries(amounts).map(([key, value]) => [
                  key,
                  Number(value) || 0,
                ]),
              ),
            })
          }
          style={[
            styles.apply,
            (used <= 0 || used > (stats.statusPoints ?? 0)) && styles.disabled,
          ]}
        >
          <Text style={styles.applyText}>적용</Text>
        </Pressable>
      </View>
      {(detail.statusEffects?.length ?? 0) > 0 && (
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>상태 효과</Text>
          {detail.statusEffects?.map((effect, index) => (
            <View key={`${effect.name}-${index}`} style={styles.effect}>
              <Text
                style={[
                  styles.effectName,
                  effect.active === true && styles.active,
                ]}
              >
                {effect.valueText}
              </Text>
              {effect.description ? (
                <Text style={styles.effectDescription}>
                  {effect.description}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
      {detail.faith && (
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>신앙 · {detail.faith.godName}</Text>
          <View style={styles.gauge}>
            <View
              style={[
                styles.gaugeFill,
                {
                  width: `${Math.min(100, (detail.faith.current / Math.max(1, detail.faith.max)) * 100)}%`,
                },
              ]}
            />
          </View>
          <Text style={styles.effectDescription}>
            {detail.faith.current.toLocaleString()} /{" "}
            {detail.faith.max.toLocaleString()}
          </Text>
        </View>
      )}
      <Modal
        visible={helpOpen}
        transparent
        animationType="fade"
        onRequestClose={onCloseHelp}
      >
        <Pressable style={styles.overlay} onPress={onCloseHelp}>
          <View style={styles.sheet}>
            <Text style={styles.sectionTitle}>스탯과 패턴</Text>
            <Text style={styles.helpBody}>
              패턴 요구 수치 = Real INT + ⌊Real SPD ÷ 5⌋
            </Text>
            <Text style={styles.helpBody}>
              증가 구간 · 10 · 15 · 30 · 50 · 80 · 120 · 160 · 200 · 250
            </Text>
            <Text style={styles.helpBody}>
              STR은 물리 공격과 HP, INT는 마법과 패턴, DEX는 물리와 Handle,
              SPD는 행동 속도와 패턴, LUK은 크리티컬·회피·소환에 영향을 줍니다.
            </Text>
          </View>
        </Pressable>
      </Modal>
      <Modal
        visible={targetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setTargetOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setTargetOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sectionTitle}>원하는 추가 패턴 수</Text>
            {recommendations.map((item) => (
              <Pressable
                key={item.additionalPatterns}
                onPress={() => {
                  setTargetPatterns(item.additionalPatterns);
                  setTargetOpen(false);
                }}
                style={styles.targetOption}
              >
                <Text style={styles.targetText}>
                  기본 + {item.additionalPatterns}
                </Text>
                <Text style={styles.effectDescription}>
                  INT +{item.addInt} · SPD +{item.addSpd}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { gap: 16 },
  sectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  vitals: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  metric: {
    minWidth: 98,
    flexGrow: 1,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 12,
    padding: 12,
  },
  metricLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
  },
  metricValue: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 4,
  },
  statBox: { gap: 5 },
  statRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  statName: { width: 44, color: theme.colors.accentGreen, fontWeight: "900" },
  statValue: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  pointInput: {
    width: 64,
    height: 38,
    borderRadius: 8,
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    textAlign: "center",
    fontWeight: "800",
  },
  recommendBox: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceAlt,
  },
  recommendLabel: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  dropdown: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 13,
    borderRadius: 9,
    backgroundColor: theme.colors.background,
  },
  dropdownText: {
    color: theme.colors.text,
    fontWeight: "900",
    textAlign: "center",
  },
  recommendResult: { gap: 4 },
  recommendValue: {
    color: theme.colors.accentGreen,
    fontSize: 17,
    fontWeight: "900",
  },
  fillButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: theme.colors.surface,
  },
  fillText: { color: theme.colors.text, fontWeight: "900" },
  targetOption: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: theme.colors.surfaceAlt,
  },
  targetText: { color: theme.colors.text, fontWeight: "900" },
  pointFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pointText: { color: theme.colors.text, fontWeight: "800" },
  apply: {
    minHeight: 48,
    minWidth: 110,
    backgroundColor: theme.colors.accentGreen,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.35 },
  applyText: { color: "#07120e", fontWeight: "900" },
  block: { gap: 8, marginTop: 4 },
  effect: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    padding: 11,
    gap: 3,
  },
  effectName: { color: theme.colors.textMuted, fontWeight: "800" },
  active: { color: theme.colors.accentGreen },
  effectDescription: { color: theme.colors.textMuted, lineHeight: 20 },
  gauge: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: theme.colors.background,
  },
  gaugeFill: { height: "100%", backgroundColor: theme.colors.accentGreen },
  overlay: { flex: 1, backgroundColor: "#0009", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 22,
    gap: 14,
  },
  helpBody: { color: theme.colors.text, lineHeight: 22 },
});
