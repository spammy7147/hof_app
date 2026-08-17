import { useMemo, useRef, useState } from "react";
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
  HofCharacterEquipmentCandidate,
} from "../../../types/api";
import { theme } from "../../../styles/theme";

export function CharacterEquipmentScreen({
  detail,
  onCommand,
}: {
  detail: HofCharacterDetail;
  onCommand?: (
    command: CharacterCommand,
  ) => Promise<CharacterCommandResult | void>;
}) {
  const [part, setPart] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const revision = detail.revision;
  const [chosen, setChosen] = useState<HofCharacterEquipmentCandidate | null>(
    null,
  );
  const listRef = useRef<FlatList<HofCharacterEquipmentCandidate>>(null);
  const scrollOffset = useRef(0);
  const candidates = useMemo(
    () =>
      (detail.equipmentCandidates ?? []).filter(
        (item) =>
          (!part || item.typeCode === part) &&
          `${item.name} ${item.description}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [detail.equipmentCandidates, part, query],
  );
  const command = (value: CharacterCommand) => onCommand?.(value);
  return (
    <View style={styles.screen}>
      <View style={styles.stats}>
        <Stat label="Atk" value={detail.stats.atk} />
        <Stat label="Matk" value={detail.stats.matk} />
        <Stat
          label="Handle"
          value={`${detail.stats.handleUsed ?? "-"} / ${detail.stats.handleMax ?? "-"}`}
        />
        <Stat
          label="Def"
          value={`${detail.stats.defBase ?? "-"} + ${detail.stats.defBonus ?? 0}`}
        />
        <Stat
          label="Mdef"
          value={`${detail.stats.mdefBase ?? "-"} + ${detail.stats.mdefBonus ?? 0}`}
        />
        <Stat
          label="Cost"
          value={`${detail.stats.costUsed ?? "-"} / ${detail.stats.costMax ?? "-"}`}
        />
      </View>
      <View style={styles.actions}>
        <Action
          label="전체 해제"
          danger
          onPress={() =>
            command({
              type: "REMOVE_ALL_EQUIPMENT",
              characterId: detail.id,
              expectedRevision: revision,
            })
          }
        />
        <Action
          label="저장 1"
          onPress={() =>
            command({
              type: "SAVE_EQUIPMENT_PRESET",
              characterId: detail.id,
              expectedRevision: revision,
              slotNumber: 1,
            })
          }
        />
        <Action
          label="불러오기 1"
          onPress={() =>
            command({
              type: "LOAD_EQUIPMENT_PRESET",
              characterId: detail.id,
              expectedRevision: revision,
              slotNumber: 1,
            })
          }
        />
        <Action
          label="저장 2"
          onPress={() =>
            command({
              type: "SAVE_EQUIPMENT_PRESET",
              characterId: detail.id,
              expectedRevision: revision,
              slotNumber: 2,
            })
          }
        />
        <Action
          label="불러오기 2"
          onPress={() =>
            command({
              type: "LOAD_EQUIPMENT_PRESET",
              characterId: detail.id,
              expectedRevision: revision,
              slotNumber: 2,
            })
          }
        />
      </View>
      <View style={styles.list}>
        {detail.equipment.map((item) => (
          <Pressable
            key={item.slot}
            onPress={() => {
              setPart(item.slot);
              setChosen(null);
            }}
            style={styles.slot}
          >
            <View style={styles.icon}>
              {item.iconUrl ? (
                <Image
                  source={{ uri: item.iconUrl }}
                  style={styles.image}
                  resizeMode="contain"
                />
              ) : null}
            </View>
            <View style={styles.body}>
              <Text style={styles.part}>{item.part || item.slot}</Text>
              <Text style={styles.name}>{item.name || "비어 있음"}</Text>
              <Text style={styles.description} numberOfLines={2}>
                {item.description}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={part !== null}
        animationType="slide"
        onRequestClose={() => setPart(null)}
      >
        <View style={styles.modal}>
          <View style={styles.head}>
            <Pressable onPress={() => setPart(null)} style={styles.back}>
              <Text style={styles.backText}>‹ 뒤로</Text>
            </Pressable>
            <Text style={styles.title}>{part} 장비</Text>
            <View style={styles.back} />
          </View>
          <TextInput
            accessibilityLabel="장비 검색"
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setChosen(null);
              scrollOffset.current = 0;
            }}
            placeholder="이름·능력치·설명 검색"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.search}
          />
          <FlatList
            ref={listRef}
            style={styles.candidateList}
            data={candidates}
            initialNumToRender={16}
            windowSize={7}
            onScroll={(event) => {
              scrollOffset.current = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={32}
            onContentSizeChange={() => {
              if (scrollOffset.current > 0)
                listRef.current?.scrollToOffset({
                  offset: scrollOffset.current,
                  animated: false,
                });
            }}
            keyExtractor={(item, index) => `${item.value}-${index}`}
            renderItem={({ item }) => (
              <Candidate
                item={item}
                selected={chosen?.value === item.value}
                onSelect={() => setChosen(item)}
              />
            )}
            ListHeaderComponent={
              <Pressable
                onPress={() =>
                  command({
                    type: "REMOVE_EQUIPMENT",
                    characterId: detail.id,
                    expectedRevision: revision,
                    equipmentPart: part ?? "",
                  })
                }
                style={styles.remove}
              >
                <Text style={styles.removeText}>이 부위 해제</Text>
              </Pressable>
            }
          />
          {chosen && (
            <View style={styles.compare}>
              <View style={styles.compareColumns}>
                <View style={styles.body}>
                  <Text style={styles.compareLabel}>현재</Text>
                  <Text style={styles.name}>
                    {detail.equipment.find((item) => item.slot === part)
                      ?.name || "비어 있음"}
                  </Text>
                </View>
                <Text style={styles.arrow}>→</Text>
                <View style={styles.body}>
                  <Text style={styles.compareLabel}>변경</Text>
                  <Text style={styles.name}>{chosen.name}</Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  command({
                    type: "EQUIP_ITEM",
                    characterId: detail.id,
                    expectedRevision: revision,
                    itemValue: chosen.value,
                  })
                }
                style={styles.equip}
              >
                <Text style={styles.equipText}>장착</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}
function Stat({
  label,
  value,
}: {
  label: string;
  value: number | string | null;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value ?? "-"}</Text>
    </View>
  );
}
function Action({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={styles.action}>
      <Text style={[styles.actionText, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}
function Candidate({
  item,
  selected,
  onSelect,
}: {
  item: HofCharacterEquipmentCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={[styles.candidate, selected && styles.candidateSelected]}
    >
      {item.iconUrl ? (
        <Image
          source={{ uri: item.iconUrl }}
          style={styles.candidateImage}
          resizeMode="contain"
        />
      ) : (
        <View style={styles.candidateImage} />
      )}
      <View style={styles.body}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.description}>{item.description}</Text>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  screen: { gap: 14 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stat: {
    width: "31%",
    flexGrow: 1,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    padding: 10,
  },
  statLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "800" },
  statValue: { color: theme.colors.text, fontWeight: "900", marginTop: 3 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  action: {
    minHeight: 48,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
  },
  actionText: { color: theme.colors.accentGreen, fontWeight: "800" },
  danger: { color: theme.colors.danger },
  list: { gap: 5 },
  slot: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 11,
    padding: 9,
    gap: 10,
  },
  icon: {
    width: 44,
    height: 44,
    backgroundColor: theme.colors.background,
    borderRadius: 8,
  },
  image: { width: 44, height: 44 },
  body: { flex: 1, gap: 2 },
  part: { color: theme.colors.accentGreen, fontSize: 10, fontWeight: "900" },
  name: { color: theme.colors.text, fontWeight: "900" },
  description: { color: theme.colors.textMuted, lineHeight: 18 },
  chevron: { color: theme.colors.textMuted, fontSize: 25 },
  modal: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: 14,
    paddingTop: 48,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  back: { minWidth: 70, minHeight: 48, justifyContent: "center" },
  backText: { color: theme.colors.text, fontWeight: "800" },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  search: {
    minHeight: 48,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 11,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  candidateList: { flex: 1 },
  remove: {
    minHeight: 48,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  removeText: { color: theme.colors.danger, fontWeight: "900" },
  candidate: {
    minHeight: 72,
    flexDirection: "row",
    gap: 10,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  candidateSelected: {
    borderColor: theme.colors.accentGreen,
    backgroundColor: theme.colors.surfaceAlt,
  },
  candidateImage: {
    width: 48,
    height: 48,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 8,
  },
  compare: {
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
  },
  compareColumns: { flexDirection: "row", alignItems: "center", gap: 8 },
  compareLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
  },
  arrow: { color: theme.colors.accentGreen, fontSize: 20, fontWeight: "900" },
  equip: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: theme.colors.accentGreen,
  },
  equipText: {
    color: theme.colors.buttonText,
    fontWeight: "900",
    fontSize: 16,
  },
});
