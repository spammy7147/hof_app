import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type {
  CharacterCommand,
  CharacterCommandResult,
  CharacterDeepSyncResponse,
  CharacterPatternApplyRequest,
  CharacterPatternOperationResult,
  CharacterTransferExecutionResult,
  CharacterTransferPreview,
  CharacterTransferPreviewRequest,
  HofCharacter,
  HofCharacterDetail,
} from "../../types/api";
import { theme } from "../../styles/theme";
import { CharacterStatusScreen } from "./status/CharacterStatusScreen";
import { CharacterPatternScreen } from "./pattern/CharacterPatternScreen";
import { CharacterEquipmentScreen } from "./equipment/CharacterEquipmentScreen";
import { CharacterSkillsScreen } from "./skills/CharacterSkillsScreen";
import { CharacterManagementScreen } from "./management/CharacterManagementScreen";

type Tab = "status" | "pattern" | "equipment" | "skills" | "management";
const tabs: Array<[Tab, string]> = [
  ["status", "정보"],
  ["pattern", "패턴"],
  ["equipment", "장비"],
  ["skills", "스킬"],
  ["management", "관리"],
];

export type CharacterSettingsNavigatorProps = {
  character: HofCharacter;
  detail: HofCharacterDetail;
  onBack?: () => void;
  onRefresh?: () => Promise<void>;
  onCommand?: (
    command: CharacterCommand,
  ) => Promise<CharacterCommandResult | void>;
  onApplyPattern?: (
    request: CharacterPatternApplyRequest,
  ) => Promise<CharacterPatternOperationResult>;
  onLoadSavedPattern?: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  onDeleteSavedPattern?: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  characters?: HofCharacter[];
  onPreviewTransfer?: (
    request: CharacterTransferPreviewRequest,
  ) => Promise<CharacterTransferPreview>;
  onExecuteTransfer?: (
    request: CharacterTransferPreviewRequest,
    onProgress?: (progress: CharacterTransferExecutionResult) => void,
  ) => Promise<CharacterTransferExecutionResult>;
  initialTransferSourceId?: number | null;
  onDeepSync?: (
    characterId: number,
    onProgress?: (progress: CharacterDeepSyncResponse) => void,
  ) => Promise<CharacterDeepSyncResponse>;
  onBeginPatternEdit?: () => Promise<void>;
  onLinkCharacter?: (
    characterId: number,
    newHofCharacterId: string,
  ) => Promise<void>;
};

export function CharacterSettingsNavigator(
  props: CharacterSettingsNavigatorProps,
) {
  const [tab, setTab] = useState<Tab>(
    props.initialTransferSourceId ? "management" : "status",
  );
  const [statusHelpOpen, setStatusHelpOpen] = useState(false);
  const common = { detail: props.detail, onCommand: props.onCommand };
  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          onPress={props.onBack}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ 목록</Text>
        </Pressable>
        <Text style={styles.title}>캐릭터 설정</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void props.onRefresh?.()}
          style={styles.sync}
        >
          <Text style={styles.syncText}>동기화</Text>
        </Pressable>
      </View>
      <View style={styles.identity}>
        <View style={styles.identityText}>
          <Text style={styles.name}>{props.character.name}</Text>
          <Text style={styles.meta}>
            Lv.{props.character.level ?? "-"} · {props.character.job}
          </Text>
        </View>
        {tab === "status" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="스탯 도움말"
            onPress={() => setStatusHelpOpen(true)}
            style={styles.help}
          >
            <Text style={styles.helpText}>?</Text>
          </Pressable>
        )}
        <Text style={styles.fresh}>
          {formatFreshness(props.detail.detailSyncedAt ?? null)}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
      >
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
      </ScrollView>
      {tab === "status" && (
        <CharacterStatusScreen
          {...common}
          helpOpen={statusHelpOpen}
          onCloseHelp={() => setStatusHelpOpen(false)}
        />
      )}
      {tab === "pattern" && (
        <CharacterPatternScreen
          detail={props.detail}
          onBeginEdit={props.onBeginPatternEdit}
          onApply={props.onApplyPattern}
          onLoadSaved={props.onLoadSavedPattern}
          onDeleteSaved={props.onDeleteSavedPattern}
        />
      )}
      {tab === "equipment" && <CharacterEquipmentScreen {...common} />}
      {tab === "skills" && <CharacterSkillsScreen {...common} />}
      {tab === "management" && (
        <CharacterManagementScreen
          {...common}
          characters={props.characters ?? []}
          initialTransferSourceId={props.initialTransferSourceId}
          onDeepSync={props.onDeepSync}
          onLinkCharacter={props.onLinkCharacter}
          onPreviewTransfer={props.onPreviewTransfer}
          onExecuteTransfer={props.onExecuteTransfer}
        />
      )}
    </View>
  );
}

function formatFreshness(value: string | null) {
  if (!value) return "동기화 필요";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  return minutes < 1 ? "방금 동기화" : `${minutes}분 전`;
}

const styles = StyleSheet.create({
  root: { gap: 12, paddingBottom: 28 },
  top: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  back: { minHeight: 48, minWidth: 72, justifyContent: "center" },
  backText: { color: theme.colors.textMuted, fontSize: 15, fontWeight: "700" },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  sync: {
    minHeight: 48,
    minWidth: 72,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  syncText: { color: theme.colors.accentGreen, fontWeight: "800" },
  identity: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  identityText: { flex: 1 },
  name: { color: theme.colors.text, fontSize: 26, fontWeight: "900" },
  meta: { color: theme.colors.textMuted, marginTop: 3 },
  fresh: { color: theme.colors.textMuted, fontSize: 12 },
  help: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  helpText: {
    color: theme.colors.accentGreen,
    fontWeight: "900",
    fontSize: 18,
  },
  tabs: { gap: 4 },
  tab: {
    minHeight: 48,
    minWidth: 66,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: theme.colors.accentGreen },
  tabText: { color: theme.colors.textMuted, fontWeight: "700" },
  tabTextActive: { color: theme.colors.text },
});
