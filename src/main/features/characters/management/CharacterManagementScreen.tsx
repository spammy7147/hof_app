import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppAlert as Alert } from '../../../platform/AppAlert';
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ChevronRight,
  ChevronsDown,
  Copy,
  GraduationCap,
  PackageOpen,
  Pencil,
  Sparkles,
  UserRoundX,
  type LucideIcon,
} from "lucide-react-native";
import { theme } from "../../../styles/theme";
import { toUserFacingErrorMessage } from "../../../domain/userFacingErrors";
import type { CharacterManagementHubResource } from "../../../domain/characterManagementHubModule";
import { CharacterSyncControl } from '../CharacterSyncScreen';
import { CharacterItemsScreen } from "../items/CharacterItemsScreen";
import { CharacterSettingsTransferScreen } from "../transfer/CharacterSettingsTransferScreen";

export function CharacterManagementScreen({
  characterHub,
}: {
  characterHub: CharacterManagementHubResource;
}) {
  const detail = characterHub.detail!;
  const actions = characterHub.actions;
  const [newName, setNewName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [kickName, setKickName] = useState("");
  const [kickOpen, setKickOpen] = useState(false);
  const [knockbackOpen, setKnockbackOpen] = useState(false);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [itemsBusy, setItemsBusy] = useState(false);
  const [classOpen, setClassOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(
    characterHub.transfer.sourceCharacter != null,
  );
  const identityResolution = characterHub.identityResolution;
  const [showAllIdentityCandidates, setShowAllIdentityCandidates] =
    useState(false);
  const canTransfer = characterHub.actions.previewTransfer != null
    && characterHub.actions.executeTransfer != null;
  const classOptions = (detail.patternOptions ?? []).filter(
    (option) => option.type === "CLASS",
  );
  useEffect(() => {
    setShowAllIdentityCandidates(
      identityResolution?.candidates.every(
        (candidate) => candidate.matchingFields.length === 0,
      ) ?? false,
    );
  }, [identityResolution]);
  const run = (action: () => Promise<void>, confirm?: string) =>
    confirm
      ? Alert.alert("확인", confirm, [
          { text: "취소", style: "cancel" },
          {
            text: "실행",
            style: "destructive",
            onPress: () => void action(),
          },
        ])
      : void action();
  if (transferOpen && canTransfer)
    return (
      <CharacterSettingsTransferScreen
        characterHub={characterHub}
        onBack={() => setTransferOpen(false)}
      />
    );
  return (
    <View style={styles.screen}>
      {itemsOpen && (
        <Modal
          animationType="slide"
          onRequestClose={() => setItemsOpen(false)}
          testID="character-items-modal"
          visible
        >
          <SafeAreaView edges={["top", "bottom"]} style={styles.itemsModal}>
            <CharacterItemsScreen
              characterHub={characterHub}
              onBack={() => setItemsOpen(false)}
            />
          </SafeAreaView>
        </Modal>
      )}
      <SectionHeader title="일반 관리" />
      <View style={styles.actionList}>
        <ActionRow
          icon={Pencil}
          title="이름 변경"
          description={`현재 이름 · ${detail.name}`}
          onPress={() => {
            setNewName("");
            setRenameOpen(true);
          }}
        />
        <ActionRow
          icon={PackageOpen}
          title={itemsBusy ? "아이템 확인 중…" : "아이템 사용"}
          description="성장·초기화와 기타 아이템을 찾아 사용합니다."
          disabled={itemsBusy}
          onPress={() => {
            if (!actions.prepareItems) {
              setItemsOpen(true);
              return;
            }
            setItemsBusy(true);
            void actions.prepareItems()
              .then(() => setItemsOpen(true))
              .catch((error) => Alert.alert("아이템 확인 실패", toUserFacingErrorMessage(error)))
              .finally(() => setItemsBusy(false));
          }}
        />
        <ActionRow
          icon={Sparkles}
          title="기도"
          description={
            detail.faith
              ? `${detail.faith.godName} · ${detail.faith.current.toLocaleString()} / ${detail.faith.max.toLocaleString()}`
              : "현재 캐릭터로 기도합니다."
          }
          onPress={() =>
            actions.pray && run(actions.pray)
          }
        />
        <ActionRow
          icon={GraduationCap}
          title="전직"
          description={classOptions.length > 0 ? `전직 가능한 직업 ${classOptions.length}개` : "현재 전직할 수 없습니다."}
          disabled={classOptions.length === 0}
          onPress={() => {
            setSelectedClass(null);
            setClassOpen(true);
          }}
        />
      </View>

      <SectionHeader title="설정 도구" />
      <View style={styles.actionList}>
        <ActionRow
          icon={Copy}
          title="설정 가져오기"
          description="같은 HOF 계정의 다른 캐릭터 설정을 복사합니다."
          onPress={() => setTransferOpen(true)}
        />
        <CharacterSyncControl characterHub={characterHub} />
      </View>
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
                        void actions.rename?.(newName);
                      },
                    },
                  ])
                }
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={classOpen} transparent animationType="slide" onRequestClose={() => setClassOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setClassOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <Text style={styles.heading}>전직</Text>
            <Text style={styles.description}>서버에서 현재 가능한 전직 후보만 표시합니다.</Text>
            {classOptions.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => setSelectedClass(option.value)}
                style={[styles.classChoice, selectedClass === option.value && styles.classSelected]}
              >
                <Text style={styles.label}>{option.label}</Text>
              </Pressable>
            ))}
            <View style={styles.classCompare}>
              <View style={styles.compareCard}>
                <Text style={styles.compareLabel}>현재</Text>
                <Text style={styles.label}>{detail.job}</Text>
              </View>
              <Text style={styles.arrow}>→</Text>
              <View style={styles.compareCard}>
                <Text style={styles.compareLabel}>변경</Text>
                <Text style={styles.label}>{classOptions.find((option) => option.value === selectedClass)?.label ?? "선택"}</Text>
              </View>
            </View>
            <View style={styles.inline}>
              <Button label="취소" onPress={() => setClassOpen(false)} />
              <Button
                disabled={!selectedClass}
                label="전직"
                onPress={() => {
                  if (!selectedClass) return;
                  const classValue = selectedClass;
                  setClassOpen(false);
                  if (actions.changeClass) run(
                    () => actions.changeClass!(classValue),
                    `${detail.job}에서 ${classOptions.find((option) => option.value === classValue)?.label} 직업으로 전직하시겠습니까?`,
                  );
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
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
                  void characterHub.actions.linkCharacter?.(
                    candidate.hofCharacterId,
                  );
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
      <View style={styles.dangerZone}>
        <SectionHeader title="위험 작업" danger />
        <View style={[styles.actionList, styles.dangerList]}>
          <ActionRow
            icon={ChevronsDown}
            title="Knockback"
            description="목록 맨 뒤로 이동하고 변경된 HOF ID를 다시 연결합니다."
            danger
            onPress={() => setKnockbackOpen(true)}
          />
          <ActionRow
            icon={UserRoundX}
            title="Kick"
            description="HOF 서버에서 캐릭터를 해고하고 앱의 보관함으로 이동합니다."
            danger
            onPress={() => {
              setKickName("");
              setKickOpen(true);
            }}
          />
        </View>
      </View>

      <Modal visible={knockbackOpen} transparent animationType="slide" onRequestClose={() => setKnockbackOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setKnockbackOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <Text style={styles.heading}>Knockback</Text>
            <Text style={styles.description}>{detail.name}을 HOF 캐릭터 목록 맨 뒤로 이동합니다.</Text>
            <View style={styles.warningBox}>
              <Text style={styles.warningTitle}>실행하면</Text>
              <Text style={styles.warningText}>• HOF 저장 파티와 콜로세움 팀 연결이 사라질 수 있습니다.</Text>
              <Text style={styles.warningText}>• 캐릭터의 HOF ID가 변경됩니다.</Text>
              <Text style={styles.warningText}>• 앱이 새 ID를 찾고 기존 캐릭터와 다시 연결합니다.</Text>
            </View>
            <View style={styles.inline}>
              <Button label="취소" onPress={() => setKnockbackOpen(false)} />
              <Button
                danger
                label="계속"
                onPress={() => {
                  setKnockbackOpen(false);
                  void actions.knockback?.(detail.name);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={kickOpen} transparent animationType="slide" onRequestClose={() => setKickOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setKickOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <Text style={styles.heading}>Kick</Text>
            <Text style={styles.description}>캐릭터는 HOF 서버에서 해고되고 앱의 보관함으로 이동합니다.</Text>
            <View style={styles.dangerNotice}>
              <Text style={styles.dangerNoticeText}>이 작업은 HOF 서버에서 되돌릴 수 없습니다. 계속하려면 캐릭터명 {detail.name}을 입력해 주세요.</Text>
            </View>
            <TextInput
              accessibilityLabel="삭제 확인 캐릭터명"
              value={kickName}
              onChangeText={setKickName}
              placeholder={`${detail.name} 입력`}
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />
            <View style={styles.inline}>
              <Button label="취소" onPress={() => setKickOpen(false)} />
              <Button
                danger
                label="Kick"
                disabled={kickName !== detail.name}
                onPress={() => {
                  setKickOpen(false);
                  void actions.kick?.(kickName);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SectionHeader({ title, danger = false }: { title: string; danger?: boolean }) {
  return <Text style={[styles.heading, danger && styles.dangerHeading]}>{title}</Text>;
}

function ActionRow({
  icon: Icon,
  title,
  description,
  onPress,
  danger = false,
  disabled = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const color = danger ? theme.colors.danger : theme.colors.accentBlue;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionRow, disabled && styles.disabled]}
    >
      <View style={[styles.actionIcon, danger && styles.dangerIcon]}>
        <Icon color={color} size={18} />
      </View>
      <View style={styles.actionBody}>
        <Text style={[styles.actionTitle, danger && styles.dangerText]}>{title}</Text>
        <Text style={styles.actionDescription}>{description}</Text>
      </View>
      <ChevronRight color={theme.colors.textMuted} size={18} />
    </Pressable>
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
  screen: { gap: 10, paddingHorizontal: 12, paddingTop: 13 },
  itemsModal: { flex: 1, backgroundColor: theme.colors.background },
  heading: { color: theme.colors.text, fontSize: 14, fontWeight: "900" },
  dangerHeading: { color: theme.colors.danger },
  actionList: {
    overflow: "hidden",
    borderRadius: 11,
    backgroundColor: theme.colors.surface,
  },
  actionRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actionIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#273344",
  },
  dangerIcon: { backgroundColor: "#3b242b" },
  actionBody: { flex: 1, minWidth: 0 },
  actionTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "900" },
  actionDescription: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  dangerZone: { gap: 7, marginTop: 5, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#38272c" },
  dangerList: { backgroundColor: "#2a1b20" },
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
  compareCard: { flex: 1, gap: 4, padding: 9, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt },
  compareLabel: { color: theme.colors.textMuted, fontSize: 10, fontWeight: "800" },
  arrow: { color: theme.colors.accentGreen, fontSize: 20, fontWeight: "900" },
  dangerButton: { backgroundColor: "#3a2229" },
  dangerText: { color: theme.colors.danger },
  warningBox: { gap: 5, padding: 10, borderRadius: 8, backgroundColor: "#32261c" },
  warningTitle: { color: theme.colors.accentAmber, fontWeight: "900" },
  warningText: { color: "#f5d7a1", fontSize: 12, lineHeight: 18 },
  dangerNotice: { padding: 10, borderRadius: 8, backgroundColor: "#341f26" },
  dangerNoticeText: { color: "#ffc1c1", fontSize: 12, lineHeight: 18 },
  disabled: { opacity: 0.35 },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.7)",
  },
  sheet: {
    gap: 13,
    maxHeight: "86%",
    paddingHorizontal: 14,
    paddingBottom: 28,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: theme.colors.surface,
  },
  grip: { width: 36, height: 4, alignSelf: "center", borderRadius: 3, backgroundColor: "#4c596a", marginTop: 9 },
});
