import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { CharacterSettingsNavigator } from "../features/characters/CharacterSettingsNavigator";
import type { CharacterManagementHubResource } from "../domain/characterManagementHubModule";
import { theme } from "../styles/theme";
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
} from "../types/api";

type CharacterDetailProps = {
  characterHub?: CharacterManagementHubResource;
  /** #29에서 제거할 구형 화면 fixture 호환 입력이다. */
  character?: HofCharacter;
  detail?: HofCharacterDetail | null;
  isLoading?: boolean;
  errorMessage?: string | null;
  warningMessage?: string | null;
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
  onRefresh?: () => Promise<void>;
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

/** 캐릭터 설정 전용 화면의 loading/error 경계와 탭 navigator만 소유한다. */
export function CharacterDetail({
  characterHub,
  character: legacyCharacter,
  detail: legacyDetail,
  isLoading: legacyLoading = false,
  errorMessage: legacyError = null,
  warningMessage: legacyWarning = null,
  onCommand,
  onApplyPattern,
  onLoadSavedPattern,
  onDeleteSavedPattern,
  onRefresh,
  onBack,
  characters,
  onPreviewTransfer,
  onExecuteTransfer,
  initialTransferSourceId,
  onDeepSync,
  onBeginPatternEdit,
  onLinkCharacter,
}: CharacterDetailProps) {
  const legacyActions = {
    select: async () => undefined,
    close: () => undefined,
    reloadStored: async () => undefined,
    refresh: onRefresh ?? (async () => undefined),
    dismissPatternConflict: () => undefined,
    clearTransfer: () => undefined,
    executeCommand: onCommand,
    applyPattern: onApplyPattern,
    loadSavedPattern: onLoadSavedPattern && legacyDetail
      ? (slotCode: string) => onLoadSavedPattern(legacyDetail.id, slotCode)
      : undefined,
    deleteSavedPattern: onDeleteSavedPattern && legacyDetail
      ? (slotCode: string) => onDeleteSavedPattern(legacyDetail.id, slotCode)
      : undefined,
    deepSync: onDeepSync && legacyDetail
      ? () => onDeepSync(legacyDetail.id)
      : undefined,
    beginPatternEdit: onBeginPatternEdit,
    linkCharacter: onLinkCharacter && legacyDetail
      ? (newHofCharacterId: string) =>
          onLinkCharacter(legacyDetail.id, newHofCharacterId)
      : undefined,
  };
  const resolvedHub = characterHub ?? {
    selectedCharacter: legacyCharacter ?? null,
    detail: legacyDetail ?? null,
    isLoading: legacyLoading,
    errorMessage: legacyError,
    warningMessage: legacyWarning,
    patternConflict: null,
    deepSync: { status: "idle" as const, progress: null, errorMessage: null },
    transfer: {
      status: "idle" as const,
      sourceCharacter: null,
      targetCharacterId: null,
      request: null,
      preview: null,
      progress: null,
      result: null,
      errorMessage: null,
    },
    actions: legacyActions,
  };
  const {
    selectedCharacter: character,
    detail,
    isLoading,
    errorMessage,
    warningMessage,
  } = resolvedHub;
  if (isLoading)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.colors.accentGreen} />
        <Text style={styles.muted}>캐릭터 정보를 불러오는 중입니다.</Text>
      </View>
    );
  if (errorMessage)
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        {errorMessage}
      </Text>
    );
  if (!character || !detail) return null;
  return (
    <View>
      {warningMessage ? (
        <Text accessibilityRole="alert" style={styles.warning}>
          {warningMessage}
        </Text>
      ) : null}
      <CharacterSettingsNavigator
        characterHub={resolvedHub}
        characters={characters}
        initialTransferSourceId={initialTransferSourceId}
        onBack={onBack}
        onPreviewTransfer={onPreviewTransfer}
        onExecuteTransfer={onExecuteTransfer}
      />
    </View>
  );
}

/** 구형 fixture 테스트와 저장 데이터 변환에만 쓰는 호환 helper. */
export function extractAvailableStatPoints(
  statusLines: string[],
): number | null {
  for (const line of statusLines) {
    const match = line.match(/Status\s*[^\d]*Point\s*:\s*(\d+)/i);
    if (match) return Number(match[1]);
  }
  return null;
}

export function statGroupLabel(groupId: string): string {
  return groupId.replace(/^up/i, "").toUpperCase();
}

export function extractPrimaryStatValues(
  statusLines: string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of statusLines) {
    const match = line.match(/^\s*(STR|INT|DEX|SPD|LUK)\s*:\s*([^([]+)/i);
    if (match) {
      const parts = match[2]!.match(/-?\d+/g)?.map(Number) ?? [];
      values[match[1]!.toUpperCase()] =
        parts.length > 0
          ? String(parts.reduce((sum, value) => sum + value, 0))
          : match[2]!.trim();
    }
  }
  return values;
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  muted: { color: theme.colors.textMuted },
  error: { color: theme.colors.danger, padding: 16, lineHeight: 21 },
  warning: {
    color: theme.colors.accentAmber,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: 16,
    paddingVertical: 10,
    lineHeight: 20,
  },
});
