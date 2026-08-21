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
  HofCharacterEquipmentCandidate,
} from "../../../types/api";
import { theme } from "../../../styles/theme";
import type { CharacterManagementHubResource } from "../../../domain/characterManagementHubModule";

export function CharacterEquipmentScreen({
  characterHub,
}: {
  characterHub: CharacterManagementHubResource;
}) {
  const detail = characterHub.detail!;
  const actions = characterHub.actions;
  const [part, setPart] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<HofCharacterEquipmentCandidate | null>(
    null,
  );
  const listRef = useRef<FlatList<HofCharacterEquipmentCandidate>>(null);
  const scrollOffset = useRef(0);
  const candidateType = part === "shield" ? "armor" : part;
  const candidates = useMemo(
    () =>
      (detail.equipmentCandidates ?? []).filter(
        (item) =>
          (!candidateType || item.typeCode === candidateType) &&
          `${item.name} ${item.description}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [candidateType, detail.equipmentCandidates, query],
  );
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
      <View testID="equipment-preset-controls" style={styles.presetBox}>
        <View testID="equipment-preset-grid" style={styles.presetGrid}>
          <PresetCard slotNumber={1} actions={actions} />
          <PresetCard slotNumber={2} actions={actions} />
        </View>
        <Action
          label="전체 해제"
          accessibilityLabel="전체 장비 해제"
          danger
          wide
          onPress={() => void actions.removeAllEquipment?.()}
        />
      </View>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>현재 장비</Text>
        <Text style={styles.sectionHint}>카드를 눌러 변경</Text>
      </View>
      <View style={styles.list}>
        {detail.equipment.map((item) => {
          const partLabel = item.part || item.slot;
          return (
            <Pressable
              key={item.slot}
              accessibilityRole="button"
              accessibilityLabel={`${partLabel} 장비 변경`}
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
                <View style={styles.slotHeader}>
                  <View style={styles.slotIdentity}>
                    <Text style={styles.part}>{partLabel}</Text>
                    <Text style={styles.name}>{item.name || "비어 있음"}</Text>
                  </View>
                  <Text style={styles.slotAction}>변경 ›</Text>
                </View>
                {item.description ? (
                  <Text style={styles.description}>{item.description}</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
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
                onPress={() => void actions.removeEquipment?.(part ?? "")}
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
                onPress={() => void actions.equipItem?.(chosen.value)}
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
  accessibilityLabel,
  onPress,
  danger = false,
  fill = false,
  wide = false,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  danger?: boolean;
  fill?: boolean;
  wide?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={[
        styles.action,
        fill && styles.actionFill,
        wide && styles.actionWide,
      ]}
    >
      <Text style={[styles.actionText, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

function PresetCard({
  slotNumber,
  actions,
}: {
  slotNumber: 1 | 2;
  actions: CharacterManagementHubResource["actions"];
}) {
  return (
    <View testID={`equipment-preset-${slotNumber}`} style={styles.presetCard}>
      <Text style={styles.presetLabel}>장비 {slotNumber}</Text>
      <Action
        label="불러오기"
        accessibilityLabel={`장비 ${slotNumber} 불러오기`}
        fill
        onPress={() => void actions.loadEquipmentPreset?.(slotNumber)}
      />
      <Action
        label="저장"
        accessibilityLabel={`장비 ${slotNumber} 저장`}
        fill
        onPress={() => void actions.saveEquipmentPreset?.(slotNumber)}
      />
    </View>
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
  screen: { gap: 12, paddingHorizontal: 12, paddingTop: 12 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stat: {
    width: "31%",
    flexGrow: 1,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 9,
    padding: 9,
  },
  statLabel: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "800" },
  statValue: { color: theme.colors.text, fontWeight: "900", marginTop: 3 },
  presetBox: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 7,
  },
  presetGrid: { flex: 1, flexDirection: "row", gap: 7 },
  presetCard: {
    flex: 1,
    gap: 6,
    padding: 8,
    borderRadius: 9,
    backgroundColor: "#111821",
  },
  presetLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  action: {
    minHeight: 40,
    minWidth: 0,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 8,
  },
  actionFill: { width: "100%" },
  actionWide: {
    width: 82,
    alignSelf: "stretch",
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: "#63383f",
    backgroundColor: "#2b1d22",
  },
  actionText: { color: theme.colors.accentGreen, fontWeight: "800" },
  danger: { color: theme.colors.danger },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2, marginTop: 2 },
  sectionTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "900" },
  sectionHint: { color: theme.colors.textMuted, fontSize: 10 },
  list: { gap: 5 },
  slot: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 10,
    padding: 8,
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
  slotHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  slotIdentity: { flex: 1, gap: 2 },
  part: { color: theme.colors.accentGreen, fontSize: 10, fontWeight: "900" },
  name: { color: theme.colors.text, fontWeight: "900" },
  slotAction: {
    color: theme.colors.accentGreen,
    fontSize: 12,
    fontWeight: "900",
  },
  description: {
    flexShrink: 1,
    color: theme.colors.textMuted,
    lineHeight: 18,
  },
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
