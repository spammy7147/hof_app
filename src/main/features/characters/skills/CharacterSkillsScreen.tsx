import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type { HofCharacterSkill } from "../../../types/api";
import { theme } from "../../../styles/theme";
import { FixedBottomAction } from "../../../components/FixedBottomAction";
import type { CharacterManagementHubResource } from "../../../domain/characterManagementHubModule";

export function CharacterSkillsScreen({
  characterHub,
}: {
  characterHub: CharacterManagementHubResource;
}) {
  const detail = characterHub.detail!;
  const learnSkill = characterHub.actions.learnSkill;
  const [mode, setMode] = useState<"owned" | "learn">("owned");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HofCharacterSkill | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const skills = mode === "owned" ? detail.learnedSkills : detail.learnableSkills;
  const categories = useMemo(
    () => Array.from(new Set(skills.map((skill) => skill.category || "기타"))),
    [skills],
  );
  const visible = useMemo(
    () => skills.filter((skill) =>
      (!category || (skill.category || "기타") === category) &&
      `${skill.name} ${skill.targetText} ${skill.scopeText} ${skill.spCost} ${skill.multiplierText} ${skill.description} ${skill.category}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ),
    [category, query, skills],
  );
  const groups = useMemo(() => {
    const values = new Map<string, HofCharacterSkill[]>();
    for (const skill of visible) {
      const key = skill.category || "기타";
      values.set(key, [...(values.get(key) ?? []), skill]);
    }
    return Array.from(values.entries());
  }, [visible]);

  const changeMode = (next: "owned" | "learn") => {
    setMode(next);
    setSelected(null);
    setCategory(null);
    setQuery("");
  };

  return (
    <View style={styles.screen}>
      <View accessibilityRole="tablist" style={styles.tabs}>
        <ModeTab label="보유 스킬" active={mode === "owned"} onPress={() => changeMode("owned")} />
        <ModeTab label="배우기" active={mode === "learn"} onPress={() => changeMode("learn")} />
      </View>

      <View style={styles.pointsRow}>
        <Text style={styles.pointsLabel}>남은 Skill Point</Text>
        <Text style={styles.points}>{detail.stats.skillPoints ?? "-"}</Text>
      </View>

      <TextInput
        accessibilityLabel="스킬 검색"
        value={query}
        onChangeText={setQuery}
        placeholder="이름·대상·효과 검색"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.search}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
      >
        <Filter label="전체" active={category == null} onPress={() => { setCategory(null); setSelected(null); }} />
        {categories.map((value) => (
          <Filter
            key={value}
            label={value}
            active={category === value}
            onPress={() => { setCategory(value); setSelected(null); }}
          />
        ))}
      </ScrollView>

      <View style={styles.groups}>
        {groups.map(([group, groupSkills]) => (
          <View key={group} style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle}>{group}</Text>
              <Text style={styles.groupCount}>{groupSkills.length}</Text>
            </View>
            <View style={styles.groupList}>
              {groupSkills.map((skill, index) => (
                <SkillRow
                  key={`${skill.value}-${skill.name}-${index}`}
                  skill={skill}
                  selected={selected === skill}
                  selectable={mode === "learn"}
                  onPress={() => mode === "learn" && setSelected(skill)}
                />
              ))}
            </View>
          </View>
        ))}
        {groups.length === 0 && <Text style={styles.empty}>표시할 스킬이 없습니다.</Text>}
      </View>

      {mode === "learn" && selected ? (
        <FixedBottomAction>
          <View style={styles.learnBar}>
            <View style={styles.learnSummary}>
              <Text style={styles.learnLabel}>선택한 스킬</Text>
              <Text style={styles.learnName}>{selected.name}</Text>
              <Text style={styles.learnCost}>필요 {selected.spCost ?? 0} point</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => learnSkill?.(selected.value)}
              style={styles.learn}
            >
              <Text style={styles.learnText}>배우기</Text>
            </Pressable>
          </View>
        </FixedBottomAction>
      ) : null}
    </View>
  );
}

function ModeTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Filter({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.filter, active && styles.filterActive]}>
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SkillRow({
  skill,
  selected,
  selectable,
  onPress,
}: {
  skill: HofCharacterSkill;
  selected: boolean;
  selectable: boolean;
  onPress: () => void;
}) {
  const judgement = [
    skill.targetText,
    skill.scopeText,
    skill.spCost == null ? null : `${skill.spCost} SP`,
    skill.multiplierText,
  ].filter(Boolean).join(" · ");
  const description = (skill.description ?? "").replace(/항상\s*적용[.·\s]*/gi, "").trim();
  return (
    <Pressable
      accessibilityRole={selectable ? "button" : undefined}
      disabled={!selectable}
      onPress={onPress}
      style={[styles.skill, selected && styles.selected]}
    >
      {skill.iconUrl ? (
        <Image source={{ uri: skill.iconUrl }} style={styles.icon} resizeMode="contain" />
      ) : (
        <View style={styles.icon} />
      )}
      <View style={styles.body}>
        <Text style={styles.name}>{skill.name}</Text>
        {judgement ? <Text style={styles.judgement}>{judgement}</Text> : null}
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md },
  tabs: { flexDirection: "row", gap: theme.spacing.xs },
  tab: {
    flex: 1,
    minHeight: theme.control.touch,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    minWidth: theme.control.touch,
  },
  tabActive: { backgroundColor: "#22483d" },
  tabText: { color: theme.colors.textMuted, fontSize: theme.fontSize.body, fontWeight: "800" },
  tabTextActive: { color: theme.colors.accentGreen },
  pointsRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
  pointsLabel: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, fontWeight: "800" },
  points: { color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: "900" },
  search: { fontSize: theme.fontSize.body,
    minHeight: theme.control.input,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
    minWidth: theme.control.touch,
  },
  filters: { gap: theme.spacing.xs },
  filter: {
    minHeight: theme.control.touch,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: "#18212d",
    minWidth: theme.control.touch,
  },
  filterActive: { borderColor: "#3f8e72", backgroundColor: "#18332b" },
  filterText: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, fontWeight: "800" },
  filterTextActive: { color: theme.colors.accentGreen },
  groups: { gap: theme.spacing.sm },
  group: { gap: theme.spacing.hairline },
  groupHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.xs, paddingHorizontal: theme.spacing.hairline, paddingVertical: theme.spacing.hairline },
  groupTitle: { color: theme.colors.accentAmber, fontSize: theme.fontSize.caption, fontWeight: "900" },
  groupCount: { color: theme.colors.textMuted, fontSize: theme.fontSize.small, fontWeight: "800" },
  groupList: { gap: theme.spacing.hairline },
  skill: {
    minHeight: theme.control.touch,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: "transparent",
    minWidth: theme.control.touch,
  },
  selected: { backgroundColor: "#193229" },
  icon: { width: 30, height: 30, borderRadius: 5, backgroundColor: "#17202b" },
  body: { flex: 1, minWidth: 0, gap: theme.spacing.hairline },
  name: { color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: "900", lineHeight: theme.lineHeight.caption },
  judgement: { color: "#d3dce8", fontSize: theme.fontSize.caption, fontWeight: "700", lineHeight: theme.lineHeight.caption },
  description: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption },
  empty: { fontSize: theme.fontSize.body, color: theme.colors.textMuted, paddingVertical: theme.spacing.lg, textAlign: "center" },
  learnBar: {
    minHeight: theme.control.touch,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
  learnSummary: { flex: 1, minWidth: 0 },
  learnLabel: { color: theme.colors.textMuted, fontSize: theme.fontSize.small, fontWeight: "800" },
  learnName: { color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: "900", marginTop: theme.spacing.hairline },
  learnCost: { color: theme.colors.textMuted, fontSize: theme.fontSize.small, marginTop: theme.spacing.hairline },
  learn: { minHeight: theme.control.primary, minWidth: 88, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.md, backgroundColor: theme.colors.accentGreen },
  learnText: { fontSize: theme.fontSize.body, color: theme.colors.buttonText, fontWeight: "900" },
});
