import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { HofCharacterDetail } from "../../../types/api";
import { theme } from "../../../styles/theme";
import type { CharacterManagementHubResource } from "../../../domain/characterManagementHubModule";

export function CharacterItemsScreen({
  characterHub,
  onBack,
}: {
  characterHub: CharacterManagementHubResource;
  onBack: () => void;
}) {
  const detail = characterHub.detail!;
  const useItem = characterHub.actions.useItem;
  const [tab, setTab] = useState<"growth" | "other">("growth");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [lastUse, setLastUse] = useState<{
    value: string;
    name: string;
    before: number | null;
    observation: HofCharacterDetail["equipmentCandidates"];
  } | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const allItems = useMemo(
    () => (detail.equipmentCandidates ?? []).filter((item) =>
      ["resetitem", "characteritem"].includes(item.typeCode)),
    [detail.equipmentCandidates],
  );
  const items = useMemo(
    () => allItems.filter((item) => {
      const matchesTab = query.trim()
        ? true
        : tab === "growth"
          ? item.typeCode === "resetitem"
          : item.typeCode === "characteritem";
      return matchesTab && `${item.name} ${item.description}`
        .toLowerCase()
        .includes(query.toLowerCase());
    }),
    [allItems, query, tab],
  );
  const chosen = items.find((item) => item.value === selected);
  useEffect(() => {
    if (!lastUse || detail.equipmentCandidates === lastUse.observation) return;
    const after = allItems.find((item) => item.value === lastUse.value)?.quantity ?? 0;
    setOutcome(
      lastUse.before == null
        ? `${lastUse.name} 사용 후 캐릭터 정보를 갱신했습니다.`
        : `${lastUse.name} 수량 ${lastUse.before} → ${after}`,
    );
    setLastUse(null);
    setSelected(null);
  }, [allItems, detail.equipmentCandidates, lastUse]);
  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <Pressable onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹ 관리</Text>
        </Pressable>
        <Text style={styles.title}>아이템 사용</Text>
        <View style={styles.back} />
      </View>
      <View style={styles.tabs}>
        <Tab
          label="성장·초기화"
          active={tab === "growth"}
          onPress={() => {
            setTab("growth");
            setSelected(null);
          }}
        />
        <Tab
          label="기타 아이템"
          active={tab === "other"}
          onPress={() => {
            setTab("other");
            setSelected(null);
          }}
        />
      </View>
      <TextInput
        accessibilityLabel="아이템 검색"
        value={query}
        onChangeText={setQuery}
        placeholder="이름·효과 검색"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.search}
      />
      <FlatList
        accessibilityLabel="사용 가능한 아이템"
        contentContainerStyle={styles.listContent}
        data={items}
        extraData={selected}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item, index) => `${item.value}-${index}`}
        ListHeaderComponent={query.trim() ? (
          <Text style={styles.searchSummary}>성장·초기화와 기타 아이템을 함께 검색합니다.</Text>
        ) : null}
        ListFooterComponent={outcome ? <Text style={styles.outcome}>{outcome}</Text> : null}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setSelected(item.value)}
            style={[styles.item, selected === item.value && styles.selected]}
          >
            {item.iconUrl ? (
              <Image source={{ uri: item.iconUrl }} style={styles.icon} />
            ) : (
              <View style={styles.fallbackIcon}>
                <Text style={styles.fallbackText}>{item.name.slice(0, 1)}</Text>
              </View>
            )}
            <View style={styles.body}>
              <View style={styles.itemTitleRow}>
                <Text style={styles.name}>{item.name}</Text>
                {item.quantity != null ? <Text style={styles.quantity}>x{item.quantity}</Text> : null}
              </View>
              {query.trim() ? (
                <Text style={styles.category}>
                  {itemCategoryLabel(item.typeCode)}
                </Text>
              ) : null}
              <Text style={styles.description}>{item.description}</Text>
            </View>
          </Pressable>
        )}
        style={styles.list}
      />
      {chosen && (
        <View testID="item-use-footer" style={styles.bottom}>
          <View style={styles.body}>
            <Text style={styles.name}>{chosen.name}</Text>
            <Text style={styles.description}>
              {detail.name}에게 사용합니다.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => Alert.alert(
              "아이템 사용",
              `${detail.name}에게 ${chosen.name}${chosen.quantity != null ? ` x${chosen.quantity}` : ""}을(를) 사용하시겠습니까?\n${chosen.description}`,
              [
                { text: "취소", style: "cancel" },
                {
                  text: "사용",
                  onPress: () => {
                    setOutcome(null);
                    setLastUse({
                      value: chosen.value,
                      name: chosen.name,
                      before: chosen.quantity ?? null,
                      observation: detail.equipmentCandidates,
                    });
                    void useItem?.(chosen.value);
                  },
                },
              ],
            )}
            style={styles.use}
          >
            <Text style={styles.useText}>
              사용
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function itemCategoryLabel(typeCode: string): string {
  if (typeCode === "resetitem") return "성장·초기화";
  return "기타 아이템";
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
  screen: {
    flex: 1,
    gap: 11,
    backgroundColor: theme.colors.background,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  back: { minWidth: 72, minHeight: 48, justifyContent: "center" },
  backText: { color: theme.colors.text, fontWeight: "800" },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  tabs: { flexDirection: "row", gap: 5 },
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
  search: {
    minHeight: 48,
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.text,
    borderRadius: 10,
    paddingHorizontal: 13,
  },
  list: { flex: 1 },
  listContent: { gap: 5 },
  searchSummary: { color: theme.colors.textMuted, lineHeight: 19, paddingVertical: 4 },
  item: {
    minHeight: 72,
    flexDirection: "row",
    gap: 10,
    padding: 10,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  selected: { borderColor: theme.colors.accentGreen },
  icon: { width: 44, height: 44 },
  fallbackIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: theme.colors.background,
  },
  fallbackText: { color: theme.colors.textMuted, fontWeight: "900" },
  body: { flex: 1, gap: 3 },
  itemTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { color: theme.colors.text, fontWeight: "900" },
  quantity: { color: theme.colors.accentGreen, fontWeight: "900" },
  category: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: "800" },
  description: { color: theme.colors.textMuted, lineHeight: 19 },
  outcome: {
    color: theme.colors.accentGreen,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    padding: 12,
  },
  bottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.colors.surface,
    padding: 10,
    borderRadius: 12,
  },
  use: {
    minWidth: 90,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: theme.colors.accentGreen,
  },
  useText: { color: theme.colors.buttonText, fontWeight: "900" },
});
