import { useMemo, useState } from "react";
import {
  FlatList,
  Image,
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
  HofCharacterDetail,
  HofCharacterSkill,
} from "../../../types/api";
import { theme } from "../../../styles/theme";

export function CharacterSkillsScreen({
  detail,
  onCommand,
}: {
  detail: HofCharacterDetail;
  onCommand?: (
    command: CharacterCommand,
  ) => Promise<CharacterCommandResult | void>;
}) {
  const [mode, setMode] = useState<"owned" | "learn">("owned");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HofCharacterSkill | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const skills =
    mode === "owned" ? detail.learnedSkills : detail.learnableSkills;
  const categories = useMemo(
    () => Array.from(new Set(skills.map((skill) => skill.category || "기타"))),
    [skills],
  );
  const visible = useMemo(
    () =>
      skills.filter(
        (skill) =>
          (!category || (skill.category || "기타") === category) &&
          `${skill.name} ${skill.targetText} ${skill.scopeText} ${skill.description} ${skill.category}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [category, skills, query],
  );
  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
          <Tab
            label="보유 스킬"
            active={mode === "owned"}
            onPress={() => {
              setMode("owned");
              setSelected(null);
              setCategory(null);
            }}
          />
          <Tab
            label="배우기"
            active={mode === "learn"}
            onPress={() => {
              setMode("learn");
              setSelected(null);
              setCategory(null);
            }}
          />
      </View>
      <View style={styles.pointsRow}>
        <Text style={styles.pointsLabel}>남은 Skill Point</Text>
        <Text style={styles.points}>{detail.stats.skillPoints ?? "-"}</Text>
      </View>
      <View style={styles.filters}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setCategoryPickerOpen(true)}
          style={styles.categoryButton}
        >
          <Text style={styles.categoryButtonText}>{category ?? "전체 분류"}</Text>
          <Text style={styles.categoryButtonText}>⌄</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="스킬 검색"
          value={query}
          onChangeText={setQuery}
          placeholder="이름·대상·효과 검색"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.search}
        />
      </View>
      <View style={styles.list}>
        {visible.map((skill, index) => (
          <Pressable
            key={`${skill.value}-${skill.name}-${index}`}
            onPress={() => mode === "learn" && setSelected(skill)}
            style={[styles.skill, selected === skill && styles.selected]}
          >
            {skill.iconUrl ? (
              <Image
                source={{ uri: skill.iconUrl }}
                style={styles.icon}
                resizeMode="contain"
              />
            ) : null}
            <View style={styles.body}>
              <Text style={styles.name}>{skill.name}</Text>
              <Text style={styles.judgement}>
                {[
                  skill.category,
                  skill.targetText,
                  skill.scopeText,
                  skill.spCost == null ? null : `${skill.spCost} SP`,
                  skill.multiplierText,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <Text style={styles.description}>{skill.description}</Text>
            </View>
          </Pressable>
        ))}
      </View>
      {mode === "learn" && selected ? (
        <View style={styles.learnBar}>
          <View style={styles.body}>
            <Text style={styles.name}>{selected.name}</Text>
            <Text style={styles.judgement}>
              필요 {selected.spCost ?? 0} point
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              onCommand?.({
                type: "LEARN_SKILL",
                characterId: detail.id,
                expectedRevision: detail.revision,
                skillValue: selected.value,
              })
            }
            style={styles.learn}
          >
            <Text style={styles.learnText}>배우기</Text>
          </Pressable>
        </View>
      ) : null}
      <Modal
        visible={categoryPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryPickerOpen(false)}
      >
        <Pressable
          onPress={() => setCategoryPickerOpen(false)}
          style={styles.modalBackdrop}
        >
          <View style={styles.categorySheet}>
            <FlatList
              data={[null, ...categories] as Array<string | null>}
              keyExtractor={(item) => item ?? "__all__"}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setCategory(item);
                    setSelected(null);
                    setCategoryPickerOpen(false);
                  }}
                  style={[styles.categoryRow, category === item && styles.categoryRowActive]}
                >
                  <Text style={styles.categoryRowText}>{item ?? "전체 분류"}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
function Tab({
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
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  screen: { gap: 12 },
  tabs: { flex: 1, flexDirection: "row", gap: 5 },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceAlt,
  },
  tabActive: { backgroundColor: "#22483d" },
  tabText: { color: theme.colors.textMuted, fontWeight: "800" },
  tabTextActive: { color: theme.colors.accentGreen },
  pointsRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
  },
  pointsLabel: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  points: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  filters: { flexDirection: "row", gap: 6 },
  categoryButton: {
    minHeight: 48,
    minWidth: 112,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceAlt,
  },
  categoryButtonText: { color: theme.colors.text, fontWeight: "800" },
  search: {
    flex: 1,
    minHeight: 48,
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.text,
    borderRadius: 10,
    paddingHorizontal: 13,
  },
  list: { gap: 5 },
  skill: {
    minHeight: 82,
    flexDirection: "row",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: "transparent",
  },
  selected: { borderColor: theme.colors.accentGreen },
  icon: { width: 42, height: 42 },
  body: { flex: 1, gap: 3 },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  judgement: { color: "#cbd5e1", lineHeight: 19, fontWeight: "600" },
  description: { color: theme.colors.textMuted, lineHeight: 19 },
  learnBar: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: 13,
    padding: 10,
  },
  learn: {
    minHeight: 48,
    minWidth: 90,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: theme.colors.accentGreen,
  },
  learnText: { color: theme.colors.buttonText, fontWeight: "900" },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.68)",
  },
  categorySheet: {
    maxHeight: "66%",
    padding: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: theme.colors.surface,
  },
  categoryRow: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 12,
    marginVertical: 2,
    borderRadius: 9,
  },
  categoryRowActive: { backgroundColor: "#22483d" },
  categoryRowText: { color: theme.colors.text, fontWeight: "800" },
});
