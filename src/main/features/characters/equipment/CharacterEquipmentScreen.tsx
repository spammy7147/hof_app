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
  screen: { gap: theme.spacing.md, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.xs },
  stat: {
    width: "31%",
    flexGrow: 1,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
  },
  statLabel: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, fontWeight: "800" },
  statValue: { fontSize: theme.fontSize.body, color: theme.colors.text, fontWeight: "900", marginTop: theme.spacing.hairline },
  presetBox: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing.xs,
  },
  presetGrid: { flex: 1, flexDirection: "row", gap: theme.spacing.xs },
  presetCard: {
    flex: 1,
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: "#111821",
  },
  presetLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.caption,
    fontWeight: "900",
    textAlign: "center",
  },
  action: {
    minHeight: theme.control.primary,
    minWidth: theme.control.touch,
    paddingHorizontal: theme.spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
  },
  actionFill: { width: "100%" },
  actionWide: {
    width: 82,
    alignSelf: "stretch",
    paddingHorizontal: theme.spacing.xs,
    borderWidth: 1,
    borderColor: "#63383f",
    backgroundColor: "#2b1d22",
  },
  actionText: { fontSize: theme.fontSize.body, color: theme.colors.accentGreen, fontWeight: "800" },
  danger: { color: theme.colors.danger },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: theme.spacing.hairline, marginTop: theme.spacing.hairline },
  sectionTitle: { color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: "900" },
  sectionHint: { color: theme.colors.textMuted, fontSize: theme.fontSize.small },
  list: { gap: theme.spacing.xs },
  slot: {
    minHeight: theme.control.touch,
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: theme.spacing.xs,
    gap: theme.spacing.sm,
    minWidth: theme.control.touch,
  },
  icon: {
    width: 44,
    height: 44,
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.md,
  },
  image: { width: 44, height: 44 },
  body: { flex: 1, gap: theme.spacing.hairline },
  slotHeader: {
    minHeight: theme.control.touch,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  slotIdentity: { flex: 1, gap: theme.spacing.hairline },
  part: { color: theme.colors.accentGreen, fontSize: theme.fontSize.small, fontWeight: "900" },
  name: { fontSize: theme.fontSize.body, color: theme.colors.text, fontWeight: "900" },
  slotAction: {
    color: theme.colors.accentGreen,
    fontSize: theme.fontSize.caption,
    fontWeight: "900",
  },
  description: { fontSize: theme.fontSize.body,
    flexShrink: 1,
    color: theme.colors.textMuted,
    lineHeight: theme.lineHeight.caption,
  },
  modal: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
    paddingTop: theme.spacing.xxl,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  back: { minWidth: 70, minHeight: theme.control.input, justifyContent: "center" },
  backText: { fontSize: theme.fontSize.body, color: theme.colors.text, fontWeight: "800" },
  title: { color: theme.colors.text, fontSize: theme.fontSize.section, fontWeight: "900" },
  search: { fontSize: theme.fontSize.body,
    minHeight: theme.control.input,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    minWidth: theme.control.touch,
  },
  candidateList: { flex: 1 },
  remove: {
    minHeight: theme.control.input,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.xs,
    minWidth: theme.control.touch,
  },
  removeText: { fontSize: theme.fontSize.body, color: theme.colors.danger, fontWeight: "900" },
  candidate: {
    minHeight: theme.control.touch,
    flexDirection: "row",
    gap: theme.spacing.sm,
    padding: theme.spacing.xs,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: "transparent",
    minWidth: theme.control.touch,
  },
  candidateSelected: {
    borderColor: theme.colors.accentGreen,
    backgroundColor: theme.colors.surfaceAlt,
  },
  candidateImage: {
    width: 48,
    height: 48,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
  },
  compare: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
  compareColumns: { flexDirection: "row", alignItems: "center", gap: theme.spacing.xs },
  compareLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.caption,
    fontWeight: "800",
  },
  arrow: { color: theme.colors.accentGreen, fontSize: theme.fontSize.section, fontWeight: "900" },
  equip: {
    minHeight: theme.control.touch,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accentGreen,
    minWidth: theme.control.touch,
  },
  equipText: {
    color: theme.colors.buttonText,
    fontWeight: "900",
    fontSize: theme.fontSize.body,
  },
});
