import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ArrowLeft, RefreshCw } from "lucide-react-native";

import type {
  CharacterTransferExecutionResult,
  CharacterTransferPreview,
  CharacterTransferPreviewRequest,
  HofCharacter,
} from "../../types/api";
import type { CharacterManagementHubResource } from "../../domain/characterManagementHubModule";
import { theme } from "../../styles/theme";
import { CharacterStatusScreen } from "./status/CharacterStatusScreen";
import { CharacterPatternScreen } from "./pattern/CharacterPatternScreen";
import { CharacterEquipmentScreen } from "./equipment/CharacterEquipmentScreen";
import { CharacterSkillsScreen } from "./skills/CharacterSkillsScreen";
import { CharacterManagementScreen } from "./management/CharacterManagementScreen";
import { CharacterSettingsTransferScreen } from "./transfer/CharacterSettingsTransferScreen";

type Tab = "status" | "pattern" | "equipment" | "skills" | "management";
const tabs: Array<[Tab, string]> = [
  ["status", "정보"],
  ["pattern", "패턴"],
  ["equipment", "장비"],
  ["skills", "스킬"],
  ["management", "관리"],
];

export type CharacterSettingsNavigatorProps = {
  characterHub: CharacterManagementHubResource;
  onBack?: () => void;
  characters?: HofCharacter[];
  onPreviewTransfer?: (
    request: CharacterTransferPreviewRequest,
  ) => Promise<CharacterTransferPreview>;
  onExecuteTransfer?: (
    request: CharacterTransferPreviewRequest,
    onProgress?: (progress: CharacterTransferExecutionResult) => void,
  ) => Promise<CharacterTransferExecutionResult>;
  initialTransferSourceId?: number | null;
};

export function CharacterSettingsNavigator(
  props: CharacterSettingsNavigatorProps,
) {
  const [tab, setTab] = useState<Tab>(
    props.initialTransferSourceId ? "management" : "status",
  );
  const [statusHelpOpen, setStatusHelpOpen] = useState(false);
  const [patternTransferOpen, setPatternTransferOpen] = useState(false);
  const detail = props.characterHub.detail;
  if (!detail) return null;
  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          onPress={props.onBack}
          accessibilityLabel="캐릭터 목록으로"
          style={styles.iconButton}
        >
          <ArrowLeft color={theme.colors.text} size={21} />
        </Pressable>
        <Text style={styles.title}>캐릭터 설정</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void props.characterHub.actions.refresh()}
          accessibilityLabel="캐릭터 동기화"
          style={styles.iconButton}
        >
          <RefreshCw color={theme.colors.text} size={19} />
        </Pressable>
      </View>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {tabs.map(([id, label]) => (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
            onPress={() => setTab(id)}
            style={[styles.tab, tab === id && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === "status" && (
        <CharacterStatusScreen
          characterHub={props.characterHub}
          helpOpen={statusHelpOpen}
          onCloseHelp={() => setStatusHelpOpen(false)}
          onOpenHelp={() => setStatusHelpOpen(true)}
        />
      )}
      {tab === "pattern" && patternTransferOpen && props.onPreviewTransfer && props.onExecuteTransfer ? (
        <CharacterSettingsTransferScreen
          target={detail}
          characters={props.characters ?? []}
          onBack={() => setPatternTransferOpen(false)}
          onPreview={props.onPreviewTransfer}
          onExecute={props.onExecuteTransfer}
        />
      ) : tab === "pattern" && (
        <CharacterPatternScreen
          characterHub={props.characterHub}
          onImportSettings={
            props.onPreviewTransfer && props.onExecuteTransfer
              ? () => setPatternTransferOpen(true)
              : undefined
          }
        />
      )}
      {tab === "equipment" && (
        <CharacterEquipmentScreen characterHub={props.characterHub} />
      )}
      {tab === "skills" && (
        <CharacterSkillsScreen characterHub={props.characterHub} />
      )}
      {tab === "management" && (
        <CharacterManagementScreen
          characterHub={props.characterHub}
          characters={props.characters ?? []}
          initialTransferSourceId={props.initialTransferSourceId}
          onPreviewTransfer={props.onPreviewTransfer}
          onExecuteTransfer={props.onExecuteTransfer}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingBottom: 28 },
  top: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    backgroundColor: theme.colors.header,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: theme.colors.surfaceAlt,
  },
  title: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  tabs: {
    minHeight: 44,
    flexDirection: "row",
    backgroundColor: "#111821",
    borderBottomWidth: 1,
    borderBottomColor: "#2c3746",
  },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: theme.colors.accentGreen },
  tabText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: "800" },
  tabTextActive: { color: theme.colors.accentGreen },
});
