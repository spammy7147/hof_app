import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppAlert as Alert } from '../platform/AppAlert';
import { focusAccessibilityTarget, getAccessibilityFocusTarget } from '../platform/accessibilityFocus';

import {
  displayCharacterName,
  formatCharacterLevel,
  sortCharactersByRosterOrder,
} from "../domain/characters";
import { normalizeHofAssetUrl } from "../domain/hofAssets";
import { theme } from "../styles/theme";
import type { HofCharacter } from "../types/api";
import type { CharacterManagementHubResource } from "../domain/characterManagementHubModule";

type CharacterListProps = {
  characterHub: CharacterManagementHubResource;
  active?: boolean;
};

/**
 * 동기화된 캐릭터 목록을 HOF roster 원본 순서로 보여주는 화면 조각이다.
 */
export function CharacterList({
  characterHub,
  active = true,
}: CharacterListProps) {
  const { characters } = characterHub;
  const [lifecycle, setLifecycle] = useState<"ACTIVE" | "MISSING" | "ARCHIVED">(
    "ACTIVE",
  );
  const [query, setQuery] = useState("");
  const listRef = useRef<FlatList<HofCharacter>>(null);
  const lifecycleRef = useRef<View>(null);
  const rowRefs = useRef(new Map<number, View>());
  const currentOffset = useRef(0);
  const returnTo = useRef<{ characterId: number; offset: number; index: number } | null>(null);
  const restoringFocus = useRef(false);
  const finishFocusRestore = useCallback((node: View | null) => {
    focusAccessibilityTarget(getAccessibilityFocusTarget(node));
    returnTo.current = null;
    restoringFocus.current = false;
  }, []);
  const setRowRef = useCallback((id: number, node: View | null) => {
    if (node) rowRefs.current.set(id, node);
    else rowRefs.current.delete(id);
    if (active && node && restoringFocus.current && returnTo.current?.characterId === id) {
      finishFocusRestore(node);
    }
  }, [active, finishFocusRestore]);
  const [linkTarget, setLinkTarget] = useState<HofCharacter | null>(null);
  const [copySource, setCopySource] = useState<HofCharacter | null>(null);
  const [copyQuery, setCopyQuery] = useState("");
  const [newHofCharacterId, setNewHofCharacterId] = useState("");
  const [restoringCharacterId, setRestoringCharacterId] = useState<number | null>(
    null,
  );
  const visibleCharacters = useMemo(
    () =>
      characters.filter(
        (character) =>
          (character.lifecycle ?? "ACTIVE") === lifecycle &&
          `${character.name} ${character.job}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [characters, lifecycle, query],
  );
  const orderedCharacters = useMemo(
    () => sortCharactersByRosterOrder(visibleCharacters),
    [visibleCharacters],
  );
  const copyTargets = useMemo(
    () =>
      characters.filter(
        (item) =>
          (item.lifecycle ?? "ACTIVE") === "ACTIVE" &&
          item.id !== copySource?.id &&
          `${item.name} ${item.job}`
            .toLowerCase()
            .includes(copyQuery.toLowerCase()),
      ),
    [characters, copyQuery, copySource?.id],
  );
  const charactersById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );
  useEffect(() => {
    if (!active) {
      restoringFocus.current = false;
      return;
    }
    const target = returnTo.current;
    if (!target) return;
    restoringFocus.current = true;
    listRef.current?.scrollToOffset({ offset: target.offset, animated: false });
    const index = orderedCharacters.findIndex((item) => item.id === target.characterId);
    const row = index < 0 ? null : rowRefs.current.get(target.characterId);
    if (index >= 0 && (index !== target.index || !row)) {
      // 마운트된 행도 화면 밖에 있을 수 있으므로 순서가 바뀌면 현재 위치로 이동한다.
      listRef.current?.scrollToIndex({ index, animated: false });
      if (row) finishFocusRestore(row);
    } else {
      finishFocusRestore(row ?? lifecycleRef.current);
    }
  }, [active, finishFocusRestore, orderedCharacters]);
  /**
   * row 컴포넌트는 ID만 넘기므로 실제 캐릭터 객체를 찾아 상위 화면에 전달한다.
   */
  const handlePressCharacter = useCallback(
    (characterId: number) => {
      const character = charactersById.get(characterId);
      if (character) {
        returnTo.current = { characterId, offset: currentOffset.current, index: orderedCharacters.findIndex((item) => item.id === characterId) };
        restoringFocus.current = false;
        Keyboard.dismiss();
        void characterHub.actions.select(character);
      }
    },
    [characterHub.actions, charactersById, orderedCharacters],
  );
  const handleRestoreCharacter = useCallback(
    async (characterId: number) => {
      if (!characterHub.actions.restoreCharacter || restoringCharacterId !== null) return;
      setRestoringCharacterId(characterId);
      try {
        await characterHub.actions.restoreCharacter(characterId);
      } catch (error) {
        Alert.alert(
          "복원 실패",
          error instanceof Error ? error.message : "캐릭터를 복원하지 못했습니다.",
        );
      } finally {
        setRestoringCharacterId(null);
      }
    },
    [characterHub.actions, restoringCharacterId],
  );
  /**
   * SectionList의 캐릭터 한 명 row를 렌더링한다.
   */
  const renderItem = useCallback(
    ({ item }: { item: HofCharacter }) => (
      <CharacterRow
        characterId={item.id}
        imageUrl={item.imageUrl ?? null}
        job={item.job.trim() || "미분류"}
        levelText={formatCharacterLevel(item)}
        name={displayCharacterName(item)}
        lifecycle={item.lifecycle ?? "ACTIVE"}
        onPressCharacter={handlePressCharacter}
        onRowRef={setRowRef}
        onArchive={() => void characterHub.actions.archiveCharacter?.(item.id)}
        restoring={restoringCharacterId === item.id}
        restoreDisabled={restoringCharacterId !== null}
        onRestore={() => void handleRestoreCharacter(item.id)}
        onDelete={() =>
          Alert.alert(
            "영구 삭제",
            `${item.name}의 보관된 설정을 영구 삭제하시겠습니까?`,
            [
              { text: "취소", style: "cancel" },
              {
                text: "삭제",
                style: "destructive",
                onPress: () => void characterHub.actions.deleteCharacterPermanently?.(item.id),
              },
            ],
          )
        }
        onLink={() => {
          setLinkTarget(item);
          setNewHofCharacterId("");
        }}
        onCopy={() => {
          setCopyQuery("");
          setCopySource(item);
        }}
      />
    ),
    [
      handlePressCharacter,
      characterHub.actions,
      handleRestoreCharacter,
      restoringCharacterId,
      setRowRef,
    ],
  );
  if (characters.length === 0) {
    return (
      <View ref={lifecycleRef} accessible accessibilityRole="header" accessibilityLabel="캐릭터 0명" style={styles.empty}>
        <Text style={styles.emptyTitle}>캐릭터 0명</Text>
        <Text style={styles.emptyText}>
          로그인 후 캐릭터 동기화를 진행하세요.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      <View style={styles.lifecycleTabs}>
        {(["ACTIVE", "MISSING", "ARCHIVED"] as const).map((value) => (
          <Pressable
            key={value}
            ref={lifecycle === value ? lifecycleRef : undefined}
            accessibilityRole="button"
            accessibilityLabel={value === "ACTIVE" ? "캐릭터" : value === "MISSING" ? "사라짐" : "보관함"}
            accessibilityState={{ selected: lifecycle === value }}
            onPress={() => setLifecycle(value)}
            style={[
              styles.lifecycleTab,
              lifecycle === value && styles.lifecycleTabActive,
            ]}
          >
            <Text
              style={[
                styles.lifecycleText,
                lifecycle === value && styles.lifecycleTextActive,
              ]}
            >
              {value === "ACTIVE"
                ? "캐릭터"
                : value === "MISSING"
                  ? "사라짐"
                  : "보관함"}{" "}
              {
                characters.filter(
                  (item) => (item.lifecycle ?? "ACTIVE") === value,
                ).length
              }
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="캐릭터 검색"
        value={query}
        onChangeText={setQuery}
        placeholder="이름·직업 검색"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.search}
      />
      <FlatList
        accessibilityLabel="캐릭터 목록"
        ref={listRef}
        onScroll={(event) => {
          if (active) currentOffset.current = event.nativeEvent.contentOffset.y;
        }}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          if (active && restoringFocus.current) {
            listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
          }
        }}
        scrollEventThrottle={16}
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="automatic"
        data={orderedCharacters}
        ItemSeparatorComponent={ListItemSeparator}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        style={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>표시할 캐릭터가 없습니다.</Text>
          </View>
        }
      />
      <Modal
        transparent
        animationType="fade"
        visible={linkTarget != null}
        onRequestClose={() => setLinkTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>새 HOF ID 연결</Text>
            <Text style={styles.modalText}>
              {linkTarget?.name}과 같은 캐릭터인지 확인한 뒤 연결해 주세요.
            </Text>
            <TextInput
              accessibilityLabel="새 HOF 캐릭터 ID"
              autoCapitalize="none"
              value={newHofCharacterId}
              onChangeText={setNewHofCharacterId}
              placeholder="새 HOF 캐릭터 ID"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.search}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setLinkTarget(null)}
                style={styles.actionButton}
              >
                <Text style={styles.actionText}>취소</Text>
              </Pressable>
              <Pressable
                disabled={!newHofCharacterId.trim()}
                onPress={() => {
                  const target = linkTarget;
                  setLinkTarget(null);
                  if (target)
                    void characterHub.actions.linkRosterCharacter?.(
                      target.id,
                      newHofCharacterId.trim(),
                    );
                }}
                style={[
                  styles.actionButton,
                  styles.primaryButton,
                  !newHofCharacterId.trim() && styles.disabled,
                ]}
              >
                <Text style={styles.primaryText}>연결</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={copySource != null}
        onRequestClose={() => setCopySource(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>설정을 받을 캐릭터</Text>
            <Text style={styles.modalText}>
              {copySource?.name}의 설정을 복사할 사용 중 캐릭터를 선택해 주세요.
            </Text>
            <TextInput
              accessibilityLabel="대상 캐릭터 검색"
              value={copyQuery}
              onChangeText={setCopyQuery}
              placeholder="이름·직업 검색"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.search}
            />
            <FlatList
              data={copyTargets}
              keyExtractor={(target) => String(target.id)}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={12}
              windowSize={7}
              style={styles.targetList}
              ItemSeparatorComponent={ListItemSeparator}
              renderItem={({ item: target }) => (
                <Pressable
                  onPress={() => {
                    const source = copySource;
                    setCopySource(null);
                    if (source) {
                      returnTo.current = { characterId: source.id, offset: currentOffset.current, index: orderedCharacters.findIndex((item) => item.id === source.id) };
                      restoringFocus.current = false;
                      Keyboard.dismiss();
                      void characterHub.actions.openTransfer(source, target);
                    }
                  }}
                  style={styles.targetRow}
                >
                  <Text style={styles.name}>{target.name}</Text>
                  <Text style={styles.meta}>
                    {formatCharacterLevel(target)} · {target.job}
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.modalText}>선택할 캐릭터가 없습니다.</Text>
              }
            />
            <Pressable
              onPress={() => setCopySource(null)}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>취소</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

type CharacterRowProps = {
  characterId: number;
  imageUrl: string | null;
  name: string;
  levelText: string;
  job: string;
  lifecycle: "ACTIVE" | "MISSING" | "ARCHIVED";
  onPressCharacter: (characterId: number) => void;
  onRowRef: (id: number, node: View | null) => void;
  onArchive: () => void;
  onRestore: () => void;
  restoring?: boolean;
  restoreDisabled?: boolean;
  onDelete: () => void;
  onLink: () => void;
  onCopy: () => void;
};

/**
 * 캐릭터 목록의 한 줄이다.
 *
 * memo로 감싸서 SSE 동기화 중 다른 캐릭터가 추가되어도 변경되지 않은 row 렌더링을 줄인다.
 */
const CharacterRow = memo(function CharacterRow({
  characterId,
  imageUrl,
  name,
  levelText,
  job,
  lifecycle,
  onPressCharacter,
  onRowRef,
  onArchive,
  onRestore,
  restoring = false,
  restoreDisabled = false,
  onDelete,
  onLink,
  onCopy,
}: CharacterRowProps) {
  const normalizedImageUrl = normalizeHofAssetUrl(imageUrl);
  /**
   * 부모에게 전체 row 객체 대신 로컬 캐릭터 기록 ID를 전달한다.
   */
  const handlePress = useCallback(() => {
    onPressCharacter(characterId);
  }, [characterId, onPressCharacter]);

  return (
    <View style={styles.rowCard}>
      <Pressable
        ref={(node) => onRowRef(characterId, node)}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${levelText}, ${job}`}
        disabled={lifecycle !== "ACTIVE"}
        onPress={handlePress}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.avatar}>
          {normalizedImageUrl ? (
            <Image
              source={{ uri: normalizedImageUrl }}
              style={styles.avatarImage}
              resizeMode="contain"
            />
          ) : (
            <Text style={styles.avatarText}>{name.slice(0, 1)}</Text>
          )}
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {levelText} · {job}
          </Text>
        </View>
      </Pressable>
      {lifecycle !== "ACTIVE" && (
        <View style={styles.rowActions}>
          {lifecycle === "MISSING" ? (
            <>
              <Action label="새 ID 연결" onPress={onLink} />
              <Action label="설정 복사" onPress={onCopy} />
              <Action label="보관" onPress={onArchive} />
            </>
          ) : (
            <>
              <Action label="설정 복사" onPress={onCopy} />
              <Action
                label={restoring ? "복원 중…" : "복원"}
                disabled={restoreDisabled}
                onPress={onRestore}
              />
              <Action label="영구 삭제" danger onPress={onDelete} />
            </>
          )}
        </View>
      )}
    </View>
  );
});

function Action({
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
        styles.rowAction,
        danger && styles.dangerAction,
        disabled && styles.rowActionDisabled,
      ]}
    >
      <Text style={[styles.rowActionText, danger && styles.dangerText]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 캐릭터 목록의 행 사이 간격을 책임지는 작은 컴포넌트다.
 */
function ListItemSeparator() {
  return <View style={styles.itemSeparator} />;
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: theme.spacing.xl,
  },
  lifecycleTabs: { flexDirection: "row", gap: theme.spacing.xs, marginBottom: theme.spacing.sm },
  lifecycleTab: {
    minHeight: theme.control.input,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    minWidth: theme.control.touch,
  },
  lifecycleTabActive: { backgroundColor: "#22483d" },
  lifecycleText: { fontSize: theme.fontSize.body, color: theme.colors.textMuted, fontWeight: "800" },
  lifecycleTextActive: { color: theme.colors.accentGreen },
  search: { fontSize: theme.fontSize.body,
    minHeight: theme.control.input,
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.text,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    minWidth: theme.control.touch,
  },
  itemSeparator: {
    height: theme.layout.rowGap,
  },
  row: {
    minHeight: theme.control.touch,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    minWidth: theme.control.touch,
  },
  rowCard: { gap: theme.spacing.xs },
  rowActions: { flexDirection: "row", gap: theme.spacing.xs },
  rowAction: {
    flex: 1,
    minHeight: theme.control.input,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    minWidth: theme.control.touch,
  },
  rowActionDisabled: { opacity: 0.55 },
  rowActionText: {
    color: theme.colors.accentGreen,
    fontWeight: "900",
    fontSize: theme.fontSize.body,
  },
  dangerAction: { backgroundColor: "#3a2229" },
  dangerText: { color: theme.colors.danger },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    padding: theme.spacing.lg,
    backgroundColor: "rgba(0,0,0,.72)",
  },
  modalCard: {
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
  modalTitle: { color: theme.colors.text, fontSize: theme.fontSize.section, fontWeight: "900" },
  modalText: { fontSize: theme.fontSize.body, color: theme.colors.textMuted, lineHeight: theme.lineHeight.body },
  modalActions: { flexDirection: "row", gap: theme.spacing.xs },
  targetList: { maxHeight: 360 },
  targetRow: {
    minHeight: theme.control.touch,
    justifyContent: "center",
    gap: theme.spacing.hairline,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    minWidth: theme.control.touch,
  },
  actionButton: {
    flex: 1,
    minHeight: theme.control.input,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    minWidth: theme.control.touch,
  },
  actionText: { fontSize: theme.fontSize.body, color: theme.colors.text, fontWeight: "800" },
  primaryButton: { backgroundColor: theme.colors.accentGreen },
  primaryText: { fontSize: theme.fontSize.body, color: theme.colors.buttonText, fontWeight: "900" },
  disabled: { opacity: 0.35 },
  rowPressed: {
    opacity: 0.82,
  },
  avatar: {
    width: theme.icon.avatar,
    height: theme.icon.avatar,
    borderRadius: theme.radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    overflow: "hidden",
  },
  avatarText: {
    color: theme.colors.text,
    fontSize: theme.fontSize.body,
    fontWeight: "900",
  },
  avatarImage: {
    width: theme.icon.avatar,
    height: theme.icon.avatar,
    borderRadius: theme.radius.sm,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  name: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.fontSize.body,
    fontWeight: "900",
  },
  meta: {
    maxWidth: "48%",
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.caption,
    fontWeight: "800",
    textAlign: "right",
  },
  empty: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: theme.fontSize.body,
    fontWeight: "800",
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.body,
  },
});
