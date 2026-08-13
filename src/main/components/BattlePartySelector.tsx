import { ChevronDown, ChevronUp } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCallback, useMemo, useState } from 'react';

import {
  type BattlePartyMember,
  buildBattlePartyCharacterOptions,
  buildBattlePartyPatternOptions,
  filterBattlePartyCharacterOptions,
  updateBattlePartyMember,
  updateBattlePartyPattern,
} from '../domain/battleParty';
import { displayCharacterJob, displayCharacterName, formatCharacterLevel } from '../domain/characters';
import { theme } from '../styles/theme';
import type { HofCharacter } from '../types/api';

type BattlePartySelectorProps = {
  characters: HofCharacter[];
  party: BattlePartyMember[];
  activeSlotIndex: number;
  onActiveSlotChange: (slotIndex: number) => void;
  onPartyChange: (party: BattlePartyMember[]) => void;
};

/**
 * 5인 전투 파티의 캐릭터와 저장 패턴을 선택하는 공통 컴포넌트다.
 *
 * 전투 탭과 파티 프리셋 편집 화면이 같은 선택 UI를 쓰도록 분리했다.
 */
export function BattlePartySelector({
  characters,
  party,
  activeSlotIndex,
  onActiveSlotChange,
  onPartyChange,
}: BattlePartySelectorProps) {
  const [openCharacterSlotIndex, setOpenCharacterSlotIndex] = useState<number | null>(null);
  const [openPatternSlotIndex, setOpenPatternSlotIndex] = useState<number | null>(null);

  return (
    <View style={styles.container}>
      <View style={styles.slotList}>
        {party.map((member, index) => {
          const character = findCharacter(characters, member.characterId);
          const active = index === activeSlotIndex;
          const characterDropdownOpen = index === openCharacterSlotIndex;
          const patternDropdownOpen = index === openPatternSlotIndex;
          const patternOptions = buildBattlePartyPatternOptions(character, member.patternSlot);
          const selectedPatternLabel = patternOptions.find((option) => option.selected)?.label ?? '패턴 -';
          const hasPatterns = patternOptions.length > 0;

          return (
            <View key={member.slotIndex} style={styles.slotRow}>
              <View style={[styles.slotBox, active && styles.activeSlotBox]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, expanded: characterDropdownOpen }}
                  onPress={() => {
                    onActiveSlotChange(index);
                    setOpenPatternSlotIndex(null);
                    setOpenCharacterSlotIndex((current) => (current === index ? null : index));
                  }}
                  style={({ pressed }) => [
                    styles.slotCharacterButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.slotText}>
                    <Text style={styles.slotName} numberOfLines={1}>
                      {character == null ? '캐릭터 선택' : displayCharacterName(character)}
                    </Text>
                    <Text style={styles.slotMeta} numberOfLines={1}>
                      {character == null
                        ? '비어 있음'
                        : `${formatCharacterLevel(character)} · ${displayCharacterJob(character)}`}
                    </Text>
                  </View>
                  {characterDropdownOpen ? (
                    <ChevronUp color={theme.colors.textMuted} size={16} />
                  ) : (
                    <ChevronDown color={theme.colors.textMuted} size={16} />
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: patternDropdownOpen, disabled: !hasPatterns }}
                  disabled={!hasPatterns}
                  onPress={() => {
                    onActiveSlotChange(index);
                    setOpenCharacterSlotIndex(null);
                    setOpenPatternSlotIndex((current) => (current === index ? null : index));
                  }}
                  style={({ pressed }) => [
                    styles.patternDropdownButton,
                    !hasPatterns && styles.disabledPatternDropdownButton,
                    patternDropdownOpen && styles.activePatternDropdownButton,
                    pressed && hasPatterns && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.patternDropdownText,
                      !hasPatterns && styles.disabledPatternDropdownText,
                    ]}
                    numberOfLines={1}
                  >
                    {character == null ? '패턴 선택' : hasPatterns ? selectedPatternLabel : '패턴 없음'}
                  </Text>
                  {patternDropdownOpen ? (
                    <ChevronUp
                      color={hasPatterns ? theme.colors.textMuted : theme.colors.borderStrong}
                      size={14}
                    />
                  ) : (
                    <ChevronDown
                      color={hasPatterns ? theme.colors.textMuted : theme.colors.borderStrong}
                      size={14}
                    />
                  )}
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>

      {openCharacterSlotIndex != null ? (
        <CharacterDropdown
          activeSlotIndex={openCharacterSlotIndex}
          characters={characters}
          party={party}
          onClose={() => setOpenCharacterSlotIndex(null)}
          onPartyChange={onPartyChange}
          onSelect={() => setOpenCharacterSlotIndex(null)}
        />
      ) : null}

      {openPatternSlotIndex != null ? (
        <PatternDropdown
          activeSlotIndex={openPatternSlotIndex}
          options={buildBattlePartyPatternOptions(
            findCharacter(characters, party[openPatternSlotIndex]?.characterId ?? null),
            party[openPatternSlotIndex]?.patternSlot ?? null,
          )}
          party={party}
          onClose={() => setOpenPatternSlotIndex(null)}
          onPartyChange={onPartyChange}
          onSelect={() => setOpenPatternSlotIndex(null)}
        />
      ) : null}
    </View>
  );
}

type CharacterDropdownProps = {
  activeSlotIndex: number;
  characters: HofCharacter[];
  party: BattlePartyMember[];
  onClose: () => void;
  onPartyChange: (party: BattlePartyMember[]) => void;
  onSelect: () => void;
};

/**
 * 파티 슬롯에 넣을 캐릭터를 검색하고 선택하는 모달이다.
 *
 * 이미 다른 슬롯에서 사용 중인 캐릭터도 목록에는 보여주되, 선택 시 중복 슬롯을 자동으로 정리한다.
 */
function CharacterDropdown({
  activeSlotIndex,
  characters,
  party,
  onClose,
  onPartyChange,
  onSelect,
}: CharacterDropdownProps) {
  const [searchText, setSearchText] = useState('');
  const options = useMemo(
    () => buildBattlePartyCharacterOptions(party, characters, activeSlotIndex),
    [activeSlotIndex, characters, party],
  );
  const filteredOptions = useMemo(
    () => filterBattlePartyCharacterOptions(options, searchText),
    [options, searchText],
  );
  /**
   * 캐릭터 선택 모달의 한 줄을 그린다.
   *
   * 이미 다른 슬롯에서 쓰는 캐릭터는 설명에 표시해서 중복 선택 상황을 사용자가 알 수 있게 한다.
   */
  const renderOption = useCallback(({ item: option }: {
    item: ReturnType<typeof buildBattlePartyCharacterOptions>[number];
  }) => {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: option.selected }}
        onPress={() => {
          onPartyChange(updateBattlePartyMember(
            party,
            activeSlotIndex,
            option.character?.hofCharacterId ?? null,
            characters,
          ));
          onSelect();
        }}
        style={({ pressed }) => [
          styles.dropdownOption,
          option.selected && styles.activeDropdownOption,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.dropdownOptionText}>
          <Text
            style={[styles.optionName, option.selected && styles.activeOptionName]}
            numberOfLines={1}
          >
            {option.character == null ? '선택 없음' : displayCharacterName(option.character)}
          </Text>
          <Text style={styles.optionMeta} numberOfLines={1}>
            {option.character == null
              ? '이 슬롯은 출전하지 않음'
              : `${formatCharacterLevel(option.character)} · ${displayCharacterJob(option.character)}${
                option.alreadyUsed ? ' · 다른 슬롯 사용 중' : ''
              }`}
          </Text>
        </View>
        {option.selected ? <Text style={styles.selectedMark}>선택</Text> : null}
      </Pressable>
    );
  }, [activeSlotIndex, characters, onPartyChange, onSelect, party]);

  return (
    <PickerModal onClose={onClose} title={`${activeSlotIndex + 1}번 캐릭터 선택`}>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onChangeText={setSearchText}
        placeholder="캐릭터 이름 / 직업 / 레벨 검색"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.searchInput}
        value={searchText}
      />
      <FlatList
        data={filteredOptions}
        keyExtractor={(option) => option.character?.hofCharacterId ?? 'none'}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          filteredOptions.length === 1 && filteredOptions[0].character == null
            ? <Text style={styles.emptySearchText}>검색 결과가 없습니다.</Text>
            : null
        }
        renderItem={renderOption}
        style={styles.dropdownScroll}
      />
    </PickerModal>
  );
}

type PatternDropdownProps = {
  activeSlotIndex: number;
  options: ReturnType<typeof buildBattlePartyPatternOptions>;
  party: BattlePartyMember[];
  onClose: () => void;
  onPartyChange: (party: BattlePartyMember[]) => void;
  onSelect: () => void;
};

/**
 * 선택된 캐릭터의 저장 패턴 슬롯을 고르는 모달이다.
 */
function PatternDropdown({
  activeSlotIndex,
  options,
  party,
  onClose,
  onPartyChange,
  onSelect,
}: PatternDropdownProps) {
  /**
   * 저장 패턴 선택 모달의 한 줄을 그린다.
   */
  const renderOption = useCallback(({ item: option }: {
    item: ReturnType<typeof buildBattlePartyPatternOptions>[number];
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: option.selected }}
      onPress={() => {
        onPartyChange(updateBattlePartyPattern(party, activeSlotIndex, option.slot));
        onSelect();
      }}
      style={({ pressed }) => [
        styles.dropdownOption,
        option.selected && styles.activeDropdownOption,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.dropdownOptionText}>
        <Text
          style={[styles.optionName, option.selected && styles.activeOptionName]}
          numberOfLines={1}
        >
          {option.label}
        </Text>
        <Text style={styles.optionMeta} numberOfLines={1}>
          선택한 캐릭터에 저장된 패턴
        </Text>
      </View>
      {option.selected ? <Text style={styles.selectedMark}>선택</Text> : null}
    </Pressable>
  ), [activeSlotIndex, onPartyChange, onSelect, party]);

  return (
    <PickerModal onClose={onClose} title={`${activeSlotIndex + 1}번 패턴 선택`}>
      <FlatList
        data={options}
        keyExtractor={(option) => String(option.slot)}
        renderItem={renderOption}
        style={styles.dropdownScroll}
      />
    </PickerModal>
  );
}

type PickerModalProps = {
  children: ReactNode;
  onClose: () => void;
  title: string;
};

/**
 * 캐릭터 선택과 패턴 선택에서 함께 쓰는 하단 모달 껍데기다.
 */
function PickerModal({ children, onClose, title }: PickerModalProps) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible
    >
      <View style={styles.modalRoot}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalCloseButton}>
              <Text style={styles.modalCloseText}>닫기</Text>
            </Pressable>
          </View>
          {children}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/**
 * 파티 슬롯에 저장된 HOF 캐릭터 ID로 실제 캐릭터 객체를 찾는다.
 */
function findCharacter(characters: HofCharacter[], characterId: string | null): HofCharacter | null {
  if (characterId == null) return null;
  return characters.find((character) => character.hofCharacterId === characterId) ?? null;
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.xs,
  },
  slotList: {
    gap: 6,
  },
  slotRow: {
    minWidth: 0,
  },
  slotBox: {
    minHeight: 54,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  slotCharacterButton: {
    minWidth: 0,
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  activeSlotBox: {
    borderColor: theme.colors.accentGreen,
    backgroundColor: theme.colors.surfaceAlt,
  },
  slotText: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  slotName: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  slotMeta: {
    flexShrink: 0,
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  patternDropdownButton: {
    width: 90,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: theme.spacing.xs,
  },
  activePatternDropdownButton: {
    borderColor: theme.colors.accentGreen,
  },
  disabledPatternDropdownButton: {
    opacity: 0.52,
  },
  patternDropdownText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  disabledPatternDropdownText: {
    color: theme.colors.textMuted,
  },
  searchInput: {
    minHeight: 42,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  dropdownScroll: {
    maxHeight: 260,
  },
  dropdownOption: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  activeDropdownOption: {
    backgroundColor: theme.colors.surfaceAlt,
  },
  dropdownOptionText: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  optionName: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  activeOptionName: {
    color: theme.colors.accentGreen,
  },
  optionMeta: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  selectedMark: {
    color: theme.colors.accentGreen,
    fontSize: 11,
    fontWeight: '900',
  },
  emptySearchText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  pressed: {
    opacity: 0.78,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  modalSheet: {
    maxHeight: '72%',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderStrong,
    borderTopLeftRadius: theme.radius.md,
    borderTopRightRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    paddingBottom: theme.spacing.md,
  },
  modalHeader: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
  },
  modalTitle: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  modalCloseButton: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
  },
  modalCloseText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '900',
  },
});
