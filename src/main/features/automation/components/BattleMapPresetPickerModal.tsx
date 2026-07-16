import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { theme } from '../../../styles/theme';
import type { PartyPresetResponse } from '../../../types/api';

type PresetOption =
  | { key: 'primary'; kind: 'PRIMARY' }
  | { key: string; kind: 'EXPLICIT'; preset: PartyPresetResponse };

type Props = {
  disabled: boolean;
  mapName: string;
  onClose: () => void;
  onSelect: (presetId: number | null) => void;
  presets: PartyPresetResponse[];
  selectedPresetId: number | null;
  selectedPresetMode: 'PRIMARY' | 'EXPLICIT';
  visible: boolean;
};

export function BattleMapPresetPickerModal({
  disabled,
  mapName,
  onClose,
  onSelect,
  presets,
  selectedPresetId,
  selectedPresetMode,
  visible,
}: Props) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const options = useMemo<PresetOption[]>(() => {
    const needle = query.trim().toLocaleLowerCase('ko-KR');
    return [
      { key: 'primary', kind: 'PRIMARY' },
      ...presets.filter(({ name }) => !needle || name.toLocaleLowerCase('ko-KR').includes(needle))
        .map((preset) => ({ key: `preset:${preset.id}`, kind: 'EXPLICIT' as const, preset })),
    ];
  }, [presets, query]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => searchRef.current?.focus()}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="프리셋 선택기 배경 닫기"
          accessibilityRole="button"
          disabled={disabled}
          onPress={onClose}
          style={styles.backdrop}
        />
        <View accessibilityLabel="전투 맵 프리셋 선택기" accessibilityViewIsModal style={styles.panel}>
          <View style={styles.headingRow}>
            <Text accessibilityRole="header" style={styles.title}>{mapName} 프리셋 선택</Text>
            <Pressable
              accessibilityLabel="프리셋 선택기 닫기"
              accessibilityRole="button"
              disabled={disabled}
              onPress={onClose}
              style={styles.closeButton}
            >
              <Text style={styles.closeText}>닫기</Text>
            </Pressable>
          </View>
          <TextInput
            ref={searchRef}
            accessibilityLabel="프리셋 검색"
            autoFocus
            editable={!disabled}
            onChangeText={setQuery}
            placeholder="프리셋 이름 검색"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.search}
            value={query}
          />
          <FlatList
            contentContainerStyle={styles.options}
            data={options}
            extraData={`${selectedPresetMode}:${selectedPresetId ?? ''}:${disabled}`}
            initialNumToRender={12}
            keyboardShouldPersistTaps="handled"
            keyExtractor={({ key }) => key}
            renderItem={({ item }) => {
              const primary = item.kind === 'PRIMARY';
              const checked = primary
                ? selectedPresetMode === 'PRIMARY'
                : selectedPresetMode === 'EXPLICIT' && selectedPresetId === item.preset.id;
              const label = primary ? '대표 프리셋' : item.preset.name;
              const accessibilityLabel = primary ? '대표 프리셋 선택' : `${item.preset.name} 프리셋 선택`;
              return (
                <Pressable
                  accessibilityLabel={accessibilityLabel}
                  accessibilityRole="radio"
                  accessibilityState={{ checked, disabled }}
                  disabled={disabled}
                  onPress={() => onSelect(primary ? null : item.preset.id)}
                  style={[styles.option, checked && styles.optionSelected]}
                >
                  <Text style={styles.optionText}>{label}</Text>
                </Pressable>
              );
            }}
            style={styles.list}
            windowSize={7}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    backgroundColor: theme.colors.overlay,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  panel: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderTopLeftRadius: theme.radius.md + 8,
    borderTopRightRadius: theme.radius.md + 8,
    borderWidth: 1,
    gap: theme.spacing.md,
    maxHeight: '78%',
    padding: theme.spacing.lg,
  },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  title: { color: theme.colors.text, flex: 1, fontSize: 17, fontWeight: '900' },
  closeButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  closeText: { color: theme.colors.text, fontWeight: '800' },
  search: {
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    color: theme.colors.text,
    minHeight: 46,
    paddingHorizontal: theme.spacing.md,
  },
  list: { flexShrink: 1 },
  options: { gap: theme.spacing.xs, paddingBottom: theme.spacing.lg },
  option: {
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  optionSelected: { borderColor: theme.colors.accentGreen },
  optionText: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
});
