import { useEffect } from "react";
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { ArrowLeft, RefreshCw } from "lucide-react-native";

import { CharacterSettingsNavigator } from "../features/characters/CharacterSettingsNavigator";
import type { CharacterManagementHubResource } from "../domain/characterManagementHubModule";
import { theme } from "../styles/theme";

type CharacterDetailProps = {
  characterHub: CharacterManagementHubResource;
  active?: boolean;
};

/** 조회 상태에 관계없이 목록 복귀를 제공하고 정상 상세의 탭 탐색을 조립한다. */
export function CharacterDetail({ characterHub, active = true }: CharacterDetailProps) {
  const {
    selectedCharacter: character,
    detail,
    isLoading,
    errorMessage,
    warningMessage,
  } = characterHub;
  const ready = !isLoading && !errorMessage && detail != null;
  const close = characterHub.actions.close;
  useEffect(() => {
    if (!active || !character || ready) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [active, character, close, ready]);
  if (!character) return null;
  return (
    <View>
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="캐릭터 목록으로"
          onPress={close}
          style={styles.iconButton}
        >
          <ArrowLeft color={theme.colors.text} size={21} />
        </Pressable>
        <Text style={styles.title}>캐릭터 설정</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="캐릭터 동기화"
          disabled={isLoading}
          onPress={() => void characterHub.actions.refresh()}
          style={styles.iconButton}
        >
          <RefreshCw color={theme.colors.text} size={19} />
        </Pressable>
      </View>
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.accentGreen} />
          <Text style={styles.muted}>캐릭터 정보를 불러오는 중입니다.</Text>
        </View>
      ) : errorMessage ? (
        <Text accessibilityRole="alert" style={styles.error}>{errorMessage}</Text>
      ) : !detail ? (
        <Text accessibilityRole="alert" style={styles.error}>캐릭터 정보를 표시할 수 없습니다.</Text>
      ) : (
        <>
          {warningMessage ? (
            <Text accessibilityRole="alert" style={styles.warning}>
              {warningMessage}
            </Text>
          ) : null}
          <CharacterSettingsNavigator
            key={character.id}
            characterHub={characterHub}
            active={active}
          />
        </>
      )}
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
