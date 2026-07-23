import { ChevronDown, ChevronUp, Plus, Save, Star, Trash2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BattlePartySelector } from './BattlePartySelector';
import { BATTLE_PARTY_SIZE, type BattlePartyMember } from '../domain/battleParty';
import {
  buildCreatePartyPresetRequest,
  createPartyFromPreset,
  emptyPartyMembers,
  formatPartyPresetSummary,
} from '../domain/partyPresets';
import { toUserFacingErrorMessage } from '../domain/userFacingErrors';
import { theme } from '../styles/theme';
import type {
  CreatePartyPresetRequest,
  HofCharacter,
  PartyPresetResponse,
  ReorderPartyPresetsRequest,
  UpdatePartyPresetRequest,
} from '../types/api';

type PartyPresetListProps = {
  authenticated: boolean;
  characters: HofCharacter[];
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  onCreatePartyPreset: (
    request: CreatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onUpdatePartyPreset: (
    presetId: number,
    request: UpdatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onMakePartyPresetPrimary: (presetId: number) => Promise<PartyPresetResponse>;
  onReorderPartyPresets: (request: ReorderPartyPresetsRequest) => Promise<PartyPresetResponse[]>;
  onDeletePartyPreset: (presetId: number) => Promise<null>;
};

type ExpandedPresetId = number | 'new' | null;

/**
 * 캐릭터 탭의 `프리셋` 하위 화면이다.
 *
 * 프리셋 목록은 컴팩트하게 보여주고, 사용자가 카드를 펼쳤을 때만 이름/파티/패턴 편집 UI를 표시한다.
 */
export function PartyPresetList({
  authenticated,
  characters,
  onListPartyPresets,
  onCreatePartyPreset,
  onUpdatePartyPreset,
  onMakePartyPresetPrimary,
  onDeletePartyPreset,
}: PartyPresetListProps) {
  const [presets, setPresets] = useState<PartyPresetResponse[]>([]);
  const [expandedPresetId, setExpandedPresetId] = useState<ExpandedPresetId>(null);
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const [draftName, setDraftName] = useState('');
  const [draftParty, setDraftParty] = useState<BattlePartyMember[]>(emptyPartyMembers());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * 현재 로그인 계정의 파티 프리셋 목록을 백엔드에서 읽어온다.
   */
  const loadPresets = useCallback(async () => {
    if (!authenticated) {
      setPresets([]);
      setExpandedPresetId(null);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      setPresets(await onListPartyPresets());
    } catch (error) {
      setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [authenticated, onListPartyPresets]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  /**
   * 기존 프리셋 카드를 펼치거나, 이미 펼쳐진 카드를 다시 눌러 접는다.
   */
  function openPreset(preset: PartyPresetResponse) {
    setExpandedPresetId((current) => {
      if (current === preset.id) return null;
      setDraftName(preset.name);
      setDraftParty(createPartyFromPreset(preset));
      setActiveSlotIndex(0);
      return preset.id;
    });
  }

  /**
   * 아직 저장되지 않은 새 프리셋 편집 카드를 연다.
   */
  function openNewPreset() {
    const request = buildCreatePartyPresetRequest();
    setDraftName(request.name);
    setDraftParty(request.members);
    setActiveSlotIndex(0);
    setExpandedPresetId('new');
  }

  /**
   * 새 프리셋 생성 또는 기존 프리셋 수정을 백엔드에 저장한다.
   *
   * 저장이 성공하면 방금 편집하던 카드를 접어서 목록 화면으로 되돌리고,
   * 저장이 실패하면 사용자가 내용을 바로 수정할 수 있도록 펼쳐진 상태를 유지한다.
   */
  async function savePreset() {
    if (!authenticated) {
      setErrorMessage('로그인 계정이 없습니다.');
      return;
    }

    const request = {
      name: draftName.trim(),
      members: normalizeDraftParty(draftParty),
    };
    if (!request.name) {
      setErrorMessage('프리셋 이름을 입력하세요.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    try {
      if (expandedPresetId === 'new') {
        const created = await onCreatePartyPreset(request);
        setPresets((current) => [created, ...current]);
        setExpandedPresetId(null);
        setDraftName(created.name);
        setDraftParty(createPartyFromPreset(created));
      } else if (typeof expandedPresetId === 'number') {
        const updated = await onUpdatePartyPreset(expandedPresetId, request);
        setPresets((current) => current.map((preset) => (preset.id === updated.id ? updated : preset)));
        setExpandedPresetId(null);
        setDraftName(updated.name);
        setDraftParty(createPartyFromPreset(updated));
      }
    } catch (error) {
      setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * 펼쳐진 프리셋을 삭제한다. 저장 전 새 프리셋이면 화면에서만 닫는다.
   */
  async function deletePreset() {
    if (expandedPresetId === 'new') {
      setExpandedPresetId(null);
      return;
    }
    if (!authenticated || typeof expandedPresetId !== 'number') return;

    setIsSaving(true);
    setErrorMessage(null);
    try {
      await onDeletePartyPreset(expandedPresetId);
      setPresets((current) => current.filter((preset) => preset.id !== expandedPresetId));
      setExpandedPresetId(null);
    } catch (error) {
      setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function makePrimary(presetId: number) {
    if (!authenticated || isSaving) return;
    const target = presets.find(({ id }) => id === presetId);
    if (target?.isPrimary) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const updated = await onMakePartyPresetPrimary(presetId);
      setPresets((current) => current.map((preset) => (
        preset.id === updated.id
          ? { ...updated, isPrimary: true }
          : { ...preset, isPrimary: false }
      )));
    } catch (error) {
      setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>프리셋</Text>
        <Pressable
          accessibilityRole="button"
          disabled={!authenticated || isSaving}
          onPress={openNewPreset}
          style={({ pressed }) => [
            styles.addButton,
            (!authenticated || isSaving) && styles.disabledButton,
            pressed && authenticated && !isSaving && styles.pressed,
          ]}
        >
          <Plus color={theme.colors.background} size={16} strokeWidth={3} />
          <Text style={styles.addButtonText}>+ 추가</Text>
        </Pressable>
      </View>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      {isLoading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color={theme.colors.accentGreen} />
          <Text style={styles.stateText}>프리셋을 불러오는 중</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          contentInsetAdjustmentBehavior="automatic"
          style={styles.list}
        >
          {presets.length === 0 && expandedPresetId !== 'new' ? (
            <View style={styles.stateBox}>
              <Text style={styles.stateTitle}>프리셋 0개</Text>
              <Text style={styles.stateText}>자주 쓰는 파티와 패턴을 프리셋으로 저장하세요.</Text>
            </View>
          ) : null}

          {expandedPresetId === 'new' ? (
            <PresetCard
              expanded
              isPrimary={false}
              name={draftName || '새 프리셋'}
              summary={formatDraftPartySummary(draftParty)}
              onPress={openNewPreset}
            >
              {renderEditor({
                activeSlotIndex,
                characters,
                draftName,
                draftParty,
                isSaving,
                isPrimary: false,
                onActiveSlotChange: setActiveSlotIndex,
                onDelete: deletePreset,
                onNameChange: setDraftName,
                onPartyChange: setDraftParty,
                onMakePrimary: null,
                onSave: savePreset,
              })}
            </PresetCard>
          ) : null}

          {presets.map((preset) => {
            const expanded = expandedPresetId === preset.id;

            return (
              <PresetCard
                key={preset.id}
                expanded={expanded}
                isPrimary={preset.isPrimary}
                name={preset.name}
                summary={formatPartyPresetSummary(preset)}
                onPress={() => openPreset(preset)}
              >
                {expanded ? renderEditor({
                  activeSlotIndex,
                  characters,
                  draftName,
                  draftParty,
                  isSaving,
                  isPrimary: preset.isPrimary,
                  onActiveSlotChange: setActiveSlotIndex,
                  onDelete: deletePreset,
                  onNameChange: setDraftName,
                  onPartyChange: setDraftParty,
                  onMakePrimary: () => makePrimary(preset.id),
                  onSave: savePreset,
                }) : null}
              </PresetCard>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

type PresetCardProps = {
  children: ReactNode;
  expanded: boolean;
  isPrimary: boolean;
  name: string;
  summary: string;
  onPress: () => void;
};

/**
 * 프리셋 목록의 카드 껍데기다.
 *
 * 접힌 상태에서는 이름과 요약만 보여주고, 펼쳐진 상태에서만 children으로 받은 편집 폼을 렌더링한다.
 */
function PresetCard({
  children,
  expanded,
  isPrimary,
  name,
  summary,
  onPress,
}: PresetCardProps) {
  return (
    <View style={[styles.card, expanded && styles.expandedCard]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onPress}
        style={({ pressed }) => [styles.cardHeader, pressed && styles.pressed]}
      >
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{name}</Text>
          {isPrimary ? (
            <View accessibilityLabel={`${name} 대표 프리셋`} style={styles.primaryBadge}>
              <Star color={theme.colors.accentAmber} fill={theme.colors.accentAmber} size={13} />
              <Text style={styles.primaryBadgeText}>대표</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.cardSide}>
          <Text style={styles.cardSummary}>{summary}</Text>
          {expanded ? (
            <ChevronUp color={theme.colors.textMuted} size={18} />
          ) : (
            <ChevronDown color={theme.colors.textMuted} size={18} />
          )}
        </View>
      </Pressable>
      {expanded ? <View style={styles.cardBody}>{children}</View> : null}
    </View>
  );
}

/**
 * 펼쳐진 프리셋 카드 안에 들어가는 실제 편집 폼을 렌더링한다.
 */
function renderEditor({
  activeSlotIndex,
  characters,
  draftName,
  draftParty,
  isSaving,
  isPrimary,
  onActiveSlotChange,
  onDelete,
  onNameChange,
  onPartyChange,
  onMakePrimary,
  onSave,
}: {
  activeSlotIndex: number;
  characters: HofCharacter[];
  draftName: string;
  draftParty: BattlePartyMember[];
  isSaving: boolean;
  isPrimary: boolean;
  onActiveSlotChange: (slotIndex: number) => void;
  onDelete: () => void;
  onNameChange: (name: string) => void;
  onPartyChange: (party: BattlePartyMember[]) => void;
  onMakePrimary: (() => void) | null;
  onSave: () => void;
}) {
  return (
    <View style={styles.editor}>
      <Text style={styles.inputLabel}>프리셋 이름</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onNameChange}
        placeholder="프리셋 이름"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.nameInput}
        value={draftName}
      />
      <BattlePartySelector
        activeSlotIndex={activeSlotIndex}
        characters={characters}
        onActiveSlotChange={onActiveSlotChange}
        onPartyChange={onPartyChange}
        party={draftParty}
      />
      {onMakePrimary ? (
        <Pressable
          accessibilityLabel={`${draftName} 대표로 지정`}
          accessibilityRole="button"
          accessibilityState={{ disabled: isSaving || isPrimary }}
          disabled={isSaving || isPrimary}
          onPress={onMakePrimary}
          style={({ pressed }) => [
            styles.primaryPresetButton,
            isPrimary && styles.primaryPresetButtonActive,
            (isSaving || isPrimary) && styles.disabledButton,
            pressed && !isSaving && !isPrimary && styles.pressed,
          ]}
        >
          <Star color={isPrimary ? theme.colors.accentAmber : theme.colors.text} fill={isPrimary ? theme.colors.accentAmber : 'transparent'} size={16} />
          <Text style={styles.primaryPresetButtonText}>{isPrimary ? '대표 프리셋' : '대표로 지정'}</Text>
        </Pressable>
      ) : null}
      <View style={styles.editorActions}>
        <Pressable
          accessibilityRole="button"
          disabled={isSaving}
          onPress={onDelete}
          style={({ pressed }) => [
            styles.secondaryActionButton,
            isSaving && styles.disabledButton,
            pressed && !isSaving && styles.pressed,
          ]}
        >
          <Trash2 color={theme.colors.danger} size={16} strokeWidth={2.5} />
          <Text style={styles.secondaryActionText}>삭제</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isSaving}
          onPress={onSave}
          style={({ pressed }) => [
            styles.primaryActionButton,
            isSaving && styles.disabledButton,
            pressed && !isSaving && styles.pressed,
          ]}
        >
          <Save color={theme.colors.background} size={16} strokeWidth={2.5} />
          <Text style={styles.primaryActionText}>{isSaving ? '저장 중' : '저장'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * 저장 직전 파티 배열을 항상 5칸으로 맞추고, 비어 있는 캐릭터의 패턴 슬롯을 제거한다.
 */
function normalizeDraftParty(party: BattlePartyMember[]): BattlePartyMember[] {
  const bySlot = new Map(
    party
      .filter((member) => Number.isInteger(member.slotIndex) && member.slotIndex >= 0 && member.slotIndex < BATTLE_PARTY_SIZE)
      .map((member) => [member.slotIndex, member]),
  );

  return emptyPartyMembers().map((emptyMember) => {
    const member = bySlot.get(emptyMember.slotIndex);
    if (member == null) return emptyMember;

    return {
      slotIndex: emptyMember.slotIndex,
      characterId: member.characterId,
      patternSlot: member.characterId == null ? null : member.patternSlot,
    };
  });
}

/**
 * 아직 저장 전인 draft 파티의 설정 인원 요약을 만든다.
 */
function formatDraftPartySummary(party: BattlePartyMember[]): string {
  const memberCount = normalizeDraftParty(party)
    .filter((member) => member.characterId != null)
    .length;

  return `${memberCount.toLocaleString('en-US')}명 설정`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: theme.spacing.sm,
  },
  toolbar: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  toolbarTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  addButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accentGreen,
    paddingHorizontal: 12,
  },
  addButtonText: {
    color: theme.colors.background,
    fontSize: 14,
    fontWeight: '900',
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 8,
    paddingBottom: theme.spacing.xl,
  },
  card: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  expandedCard: {
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
  },
  cardHeader: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitle: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  cardTitleRow: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  primaryBadgeText: {
    color: theme.colors.accentAmber,
    fontSize: 11,
    fontWeight: '900',
  },
  cardSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardSummary: {
    color: theme.colors.accentGreen,
    fontSize: 13,
    fontWeight: '900',
  },
  cardBody: {
    marginTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.sm,
  },
  editor: {
    gap: theme.spacing.sm,
  },
  inputLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  nameInput: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.md,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: theme.spacing.md,
  },
  editorActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  primaryPresetButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
  },
  primaryPresetButtonActive: {
    borderColor: theme.colors.accentAmber,
  },
  primaryPresetButtonText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  primaryActionButton: {
    minHeight: 36,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accentGreen,
  },
  secondaryActionButton: {
    minHeight: 36,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: theme.radius.md,
  },
  primaryActionText: {
    color: theme.colors.background,
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryActionText: {
    color: theme.colors.danger,
    fontSize: 13,
    fontWeight: '900',
  },
  errorText: {
    color: theme.colors.danger,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.md,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 19,
  },
  stateBox: {
    minHeight: 116,
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  stateTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  stateText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.82,
  },
});
