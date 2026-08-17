import { useState } from "react";
import {
  Alert,
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
  CharacterDeepSyncResponse,
  CharacterTransferExecutionResult,
  CharacterTransferPreview,
  CharacterTransferPreviewRequest,
  HofCharacter,
  HofCharacterDetail,
} from "../../../types/api";
import { theme } from "../../../styles/theme";
import { toUserFacingErrorMessage } from "../../../domain/userFacingErrors";
import { CharacterItemsScreen } from "../items/CharacterItemsScreen";
import { CharacterSettingsTransferScreen } from "../transfer/CharacterSettingsTransferScreen";

export function CharacterManagementScreen({
  detail,
  characters,
  initialTransferSourceId,
  onCommand,
  onDeepSync,
  onPreviewTransfer,
  onExecuteTransfer,
  onLinkCharacter,
}: {
  detail: HofCharacterDetail;
  characters: HofCharacter[];
  initialTransferSourceId?: number | null;
  onCommand?: (
    command: CharacterCommand,
  ) => Promise<CharacterCommandResult | void>;
  onDeepSync?: (
    characterId: number,
    onProgress?: (progress: CharacterDeepSyncResponse) => void,
  ) => Promise<CharacterDeepSyncResponse>;
  onPreviewTransfer?: (
    request: CharacterTransferPreviewRequest,
  ) => Promise<CharacterTransferPreview>;
  onExecuteTransfer?: (
    request: CharacterTransferPreviewRequest,
    onProgress?: (progress: CharacterTransferExecutionResult) => void,
  ) => Promise<CharacterTransferExecutionResult>;
  onLinkCharacter?: (
    characterId: number,
    newHofCharacterId: string,
  ) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [kickName, setKickName] = useState("");
  const [itemsOpen, setItemsOpen] = useState(false);
  const [classOpen, setClassOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(
    initialTransferSourceId != null,
  );
  const [identityResolution, setIdentityResolution] = useState<Extract<
    CharacterCommandResult,
    { candidates: unknown }
  > | null>(null);
  const [showAllIdentityCandidates, setShowAllIdentityCandidates] =
    useState(false);
  const [deepSyncProgress, setDeepSyncProgress] =
    useState<CharacterDeepSyncResponse | null>(null);
  const [deepSyncBusy, setDeepSyncBusy] = useState(false);
  const [deepSyncError, setDeepSyncError] = useState<string | null>(null);
  const revision = detail.revision;
  const classOptions = (detail.patternOptions ?? []).filter(
    (option) => option.type === "CLASS",
  );
  const execute = async (command: CharacterCommand) => {
    const result = await onCommand?.(command);
    if (result?.type === "IdentityResolutionRequired") {
      setIdentityResolution(result);
      setShowAllIdentityCandidates(
        result.candidates.every((candidate) => candidate.matchingFields.length === 0),
      );
    }
  };
  const run = (command: CharacterCommand, confirm?: string) =>
    confirm
      ? Alert.alert("확인", confirm, [
          { text: "취소", style: "cancel" },
          {
            text: "실행",
            style: "destructive",
            onPress: () => void execute(command),
          },
        ])
      : void execute(command);
  if (itemsOpen)
    return (
      <CharacterItemsScreen
        detail={detail}
        onBack={() => setItemsOpen(false)}
        onCommand={onCommand}
      />
    );
  if (transferOpen && onPreviewTransfer && onExecuteTransfer)
    return (
      <CharacterSettingsTransferScreen
        target={detail}
        characters={characters}
        initialSourceId={initialTransferSourceId}
        onBack={() => setTransferOpen(false)}
        onPreview={onPreviewTransfer}
        onExecute={onExecuteTransfer}
      />
    );
  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>일반 관리</Text>
      <View style={styles.grid}>
        <Button
          label="이름 변경"
          onPress={() => {
            setNewName("");
            setRenameOpen(true);
          }}
        />
        <Button label="아이템 사용" onPress={() => setItemsOpen(true)} />
        <Button
          label="기도"
          onPress={() =>
            run({
              type: "PRAY",
              characterId: detail.id,
              expectedRevision: revision,
            })
          }
        />
        <Button
          label="전직"
          disabled={classOptions.length === 0}
          onPress={() => setClassOpen(!classOpen)}
        />
        <Button label="설정 가져오기" onPress={() => setTransferOpen(true)} />
        <Button
          label={deepSyncBusy ? "동기화 중…" : "전체 설정 동기화"}
          disabled={deepSyncBusy}
          onPress={() => {
            if (!onDeepSync) return;
            setDeepSyncBusy(true);
            setDeepSyncError(null);
            setDeepSyncProgress({ characterId: detail.id, progress: [] });
            void onDeepSync(detail.id, setDeepSyncProgress)
              .catch((error) => setDeepSyncError(toUserFacingErrorMessage(error)))
              .finally(() => setDeepSyncBusy(false));
          }}
        />
      </View>
      {deepSyncProgress && (
        <View style={styles.card}>
          <Text style={styles.label}>전체 설정 동기화</Text>
          {deepSyncProgress.progress.length === 0 ? (
            <Text style={styles.description}>작업을 시작하고 있습니다.</Text>
          ) : (
            deepSyncProgress.progress.slice(-5).map((step, index) => (
              <Text
                key={`${step.phase}-${step.completedSteps}-${index}`}
                style={styles.description}
              >
                {deepSyncProgressLabel(step)} · {step.completedSteps}/
                {step.totalSteps}
              </Text>
            ))
          )}
        </View>
      )}
      {deepSyncError && <Text style={styles.error}>{deepSyncError}</Text>}
      <Modal
        visible={renameOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setRenameOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setRenameOpen(false)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.heading}>이름 변경</Text>
            <Text style={styles.description}>
              반각 16문자까지 입력할 수 있습니다. 이름 변경 중에는 Knockback을 실행할 수 없습니다.
            </Text>
            <TextInput
              accessibilityLabel="새 캐릭터명"
              value={newName}
              onChangeText={setNewName}
              maxLength={16}
              autoFocus
              style={styles.input}
            />
            <View style={styles.inline}>
              <Button label="취소" onPress={() => setRenameOpen(false)} />
              <Button
                label="변경"
                disabled={!newName.trim()}
                onPress={() =>
                  Alert.alert("이름 변경", `${detail.name}의 이름을 ${newName}으로 변경하시겠습니까?`, [
                    { text: "취소", style: "cancel" },
                    {
                      text: "변경",
                      onPress: () => {
                        setRenameOpen(false);
                        void execute({
                          type: "RENAME",
                          characterId: detail.id,
                          expectedRevision: revision,
                          newName,
                        });
                      },
                    },
                  ])
                }
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {classOpen && (
        <View style={styles.card}>
          <Text style={styles.label}>전직 · 현재 {detail.job}</Text>
          {classOptions.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setSelectedClass(option.value)}
              style={[
                styles.classChoice,
                selectedClass === option.value && styles.classSelected,
              ]}
            >
              <Text style={styles.label}>{option.label}</Text>
            </Pressable>
          ))}
          <View style={styles.classCompare}>
            <Text style={styles.description}>{detail.job}</Text>
            <Text style={styles.arrow}>→</Text>
            <Text style={styles.label}>
              {classOptions.find((option) => option.value === selectedClass)
                ?.label ?? "선택"}
            </Text>
          </View>
          <Button
            disabled={!selectedClass}
            label="전직"
            onPress={() =>
              selectedClass &&
              run(
                {
                  type: "CHANGE_CLASS",
                  characterId: detail.id,
                  expectedRevision: revision,
                  classValue: selectedClass,
                },
                `${detail.job}에서 ${classOptions.find((option) => option.value === selectedClass)?.label} 직업으로 전직하시겠습니까?`,
              )
            }
          />
        </View>
      )}
      {identityResolution && (
        <View style={styles.card}>
          <Text style={styles.label}>새 HOF ID 연결</Text>
          <Text style={styles.description}>{identityResolution.message}</Text>
          {identityResolution.candidates
            .filter(
              (candidate) =>
                showAllIdentityCandidates ||
                candidate.matchingFields.length > 0,
            )
            .map((candidate) => (
              <Pressable
                key={candidate.hofCharacterId}
                accessibilityRole="button"
                onPress={() => {
                  if (onLinkCharacter) {
                    void onLinkCharacter(
                      detail.id,
                      candidate.hofCharacterId,
                    ).then(() => setIdentityResolution(null));
                  }
                }}
                style={styles.classChoice}
              >
                <Text style={styles.label}>{candidate.name}</Text>
                <Text style={styles.description}>
                  Lv.{candidate.level ?? "-"} · {candidate.job} · ID{" "}
                  {candidate.hofCharacterId}
                </Text>
              </Pressable>
            ))}
          {!showAllIdentityCandidates &&
            identityResolution.candidates.some(
              (candidate) => candidate.matchingFields.length === 0,
            ) && (
              <Button
                label="전체 캐릭터 보기"
                onPress={() => setShowAllIdentityCandidates(true)}
              />
            )}
        </View>
      )}
      <Text style={[styles.heading, styles.dangerHeading]}>위험 작업</Text>
      <View style={styles.card}>
        <Text style={styles.description}>
          Knockback은 HOF ID와 캐릭터 순서를 바꿉니다. 작업 후 새 ID를 자동으로
          확인합니다.
        </Text>
        <Button
          danger
          label="Knockback"
          onPress={() =>
            run(
              {
                type: "KNOCKBACK",
                characterId: detail.id,
                expectedRevision: revision,
                confirmationName: detail.name,
              },
              "저장 파티와 팀 연결에 영향을 줄 수 있습니다. 계속하시겠습니까?",
            )
          }
        />
      </View>
      <View style={styles.card}>
        <Text style={styles.description}>
          Kick은 캐릭터를 삭제하고 앱의 보관함으로 이동합니다.
        </Text>
        <TextInput
          accessibilityLabel="삭제 확인 캐릭터명"
          value={kickName}
          onChangeText={setKickName}
          placeholder={detail.name}
          placeholderTextColor={theme.colors.textMuted}
          style={styles.input}
        />
        <Button
          danger
          label="Kick"
          disabled={kickName !== detail.name}
          onPress={() =>
            run(
              {
                type: "KICK",
                characterId: detail.id,
                expectedRevision: revision,
                confirmationName: kickName,
              },
              "이 작업은 되돌리기 어렵습니다. 캐릭터를 삭제하시겠습니까?",
            )
          }
        />
      </View>
    </View>
  );
}
function Button({
  label,
  onPress,
  danger = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        danger && styles.dangerButton,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, danger && styles.dangerText]}>
        {label}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  screen: { gap: 12 },
  heading: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  dangerHeading: { color: theme.colors.danger, marginTop: 8 },
  card: {
    gap: 10,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 12,
    padding: 13,
  },
  label: { color: theme.colors.text, fontWeight: "800" },
  description: { color: theme.colors.textMuted, lineHeight: 20 },
  error: { color: theme.colors.danger, lineHeight: 20 },
  inline: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    minHeight: 48,
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    borderRadius: 9,
    paddingHorizontal: 12,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  button: {
    minHeight: 48,
    minWidth: 100,
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: 10,
    paddingHorizontal: 13,
  },
  buttonText: { color: theme.colors.accentGreen, fontWeight: "900" },
  classChoice: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: theme.colors.background,
  },
  classSelected: { borderColor: theme.colors.accentGreen },
  classCompare: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  arrow: { color: theme.colors.accentGreen, fontSize: 20, fontWeight: "900" },
  dangerButton: { backgroundColor: "#3a2229" },
  dangerText: { color: theme.colors.danger },
  disabled: { opacity: 0.35 },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.7)",
  },
  sheet: {
    gap: 13,
    padding: 20,
    paddingBottom: 28,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: theme.colors.surface,
  },
});

function deepSyncProgressLabel(
  step: CharacterDeepSyncResponse["progress"][number],
) {
  if (step.phase === "CURRENT") return "현재 설정 확인";
  if (step.phase === "SAVED_PATTERN")
    return `저장 패턴 ${step.patternSlotCode ?? ""} 확인`;
  if (step.phase === "EQUIPMENT_PRESET")
    return `장비 저장 ${step.equipmentSlotNumber ?? ""} 확인`;
  if (step.phase === "RESTORE") return "원래 설정 복구";
  return "완료";
}
