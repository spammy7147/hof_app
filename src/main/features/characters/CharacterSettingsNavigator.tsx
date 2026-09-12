import { useCallback, useEffect, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";

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
  active?: boolean;
};

export function CharacterSettingsNavigator(
  props: CharacterSettingsNavigatorProps,
) {
  const [tab, setTab] = useState<Tab>(
    props.characterHub.transfer.sourceCharacter ? "management" : "status",
  );
  const [statusHelpOpen, setStatusHelpOpen] = useState(false);
  const [transferTab, setTransferTab] = useState<"pattern" | "management" | null>(
    props.characterHub.transfer.sourceCharacter ? "management" : null,
  );
  const detail = props.characterHub.detail;
  const canTransfer = props.characterHub.actions.previewTransfer != null
    && props.characterHub.actions.executeTransfer != null;
  const close = props.characterHub.actions.close;
  const clearTransfer = props.characterHub.actions.clearTransfer;
  const transferOpen = canTransfer && transferTab === tab;
  const closeTransfer = useCallback(() => {
    clearTransfer();
    setTransferTab(null);
  }, [clearTransfer]);
  useEffect(() => {
    if (props.active === false) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (transferOpen) closeTransfer();
      else close();
      return true;
    });
    return () => subscription.remove();
  }, [close, closeTransfer, props.active, transferOpen]);
  if (!detail) return null;
  return (
    <View style={styles.root}>
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
      {transferOpen && (
        <CharacterSettingsTransferScreen
          characterHub={props.characterHub}
          onBack={closeTransfer}
          backLabel={tab === "pattern" ? "패턴" : "관리"}
        />
      )}
      {tab === "pattern" && !transferOpen && (
        <CharacterPatternScreen
          characterHub={props.characterHub}
          onImportSettings={
            canTransfer
              ? () => setTransferTab("pattern")
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
      {tab === "management" && !transferOpen && (
        <CharacterManagementScreen
          characterHub={props.characterHub}
          onImportSettings={() => setTransferTab("management")}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingBottom: 28 },
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
