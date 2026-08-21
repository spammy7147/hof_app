import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { CharacterSettingsNavigator } from "../features/characters/CharacterSettingsNavigator";
import type { CharacterManagementHubResource } from "../domain/characterManagementHubModule";
import { theme } from "../styles/theme";

type CharacterDetailProps = {
  characterHub: CharacterManagementHubResource;
};

/** 캐릭터 설정 전용 화면의 loading/error 경계와 탭 navigator만 소유한다. */
export function CharacterDetail({ characterHub }: CharacterDetailProps) {
  const {
    selectedCharacter: character,
    detail,
    isLoading,
    errorMessage,
    warningMessage,
  } = characterHub;
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
        characterHub={characterHub}
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
