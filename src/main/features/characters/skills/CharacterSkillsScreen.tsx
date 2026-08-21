import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type {
  CharacterCommand,
  CharacterCommandResult,
  HofCharacterDetail,
  HofCharacterSkill,
} from "../../../types/api";
import { theme } from "../../../styles/theme";
import { FixedBottomAction } from "../../../components/FixedBottomAction";
import type { CharacterManagementHubResource } from "../../../domain/characterManagementHubModule";

export function CharacterSkillsScreen({
  characterHub,
  detail: legacyDetail,
  onCommand: legacyCommand,
}: {
  characterHub?: CharacterManagementHubResource;
  detail?: HofCharacterDetail;
  onCommand?: (command: CharacterCommand) => Promise<CharacterCommandResult | void>;
}) {
  const detail = (characterHub?.detail ?? legacyDetail) as HofCharacterDetail;
  const onCommand = characterHub?.actions.executeCommand ?? legacyCommand;
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
              onPress={() => onCommand?.({
                type: "LEARN_SKILL",
                characterId: detail.id,
                expectedRevision: detail.revision,
                skillValue: selected.value,
              })}
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
  screen: { gap: 10, paddingHorizontal: 12, paddingTop: 12 },
  tabs: { flexDirection: "row", gap: 5 },
  tab: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: theme.colors.surfaceAlt,
  },
  tabActive: { backgroundColor: "#22483d" },
  tabText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: "800" },
  tabTextActive: { color: theme.colors.accentGreen },
  pointsRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
  },
  pointsLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "800" },
  points: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  search: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 9,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
  },
  filters: { gap: 5 },
  filter: {
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 17,
    backgroundColor: "#18212d",
  },
  filterActive: { borderColor: "#3f8e72", backgroundColor: "#18332b" },
  filterText: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "800" },
  filterTextActive: { color: theme.colors.accentGreen },
  groups: { gap: 10 },
  group: { gap: 2 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4, paddingVertical: 2 },
  groupTitle: { color: theme.colors.accentAmber, fontSize: 11, fontWeight: "900" },
  groupCount: { color: theme.colors.textMuted, fontSize: 10, fontWeight: "800" },
  groupList: { gap: 2 },
  skill: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 5,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  selected: { backgroundColor: "#193229" },
  icon: { width: 30, height: 30, borderRadius: 5, backgroundColor: "#17202b" },
  body: { flex: 1, minWidth: 0, gap: 1 },
  name: { color: theme.colors.text, fontSize: 13, fontWeight: "900", lineHeight: 18 },
  judgement: { color: "#d3dce8", fontSize: 11, fontWeight: "700", lineHeight: 16 },
  description: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  empty: { color: theme.colors.textMuted, paddingVertical: 24, textAlign: "center" },
  learnBar: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
  },
  learnSummary: { flex: 1, minWidth: 0 },
  learnLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: "800" },
  learnName: { color: theme.colors.text, fontSize: 13, fontWeight: "900", marginTop: 2 },
  learnCost: { color: theme.colors.textMuted, fontSize: 10, marginTop: 2 },
  learn: { minHeight: 46, minWidth: 88, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: theme.colors.accentGreen },
  learnText: { color: theme.colors.buttonText, fontWeight: "900" },
});
