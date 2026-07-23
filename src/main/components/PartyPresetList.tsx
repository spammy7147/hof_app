import { ChevronDown, ChevronUp, GripVertical, Plus, Save, Star, Trash2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';

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
  onCreatePartyPreset: (request: CreatePartyPresetRequest) => Promise<PartyPresetResponse>;
  onUpdatePartyPreset: (presetId: number, request: UpdatePartyPresetRequest) => Promise<PartyPresetResponse>;
  onMakePartyPresetPrimary: (presetId: number) => Promise<PartyPresetResponse>;
  onReorderPartyPresets: (request: ReorderPartyPresetsRequest) => Promise<PartyPresetResponse[]>;
  onDeletePartyPreset: (presetId: number) => Promise<null>;
};

type ExpandedPresetId = number | 'new' | null;
type NewPresetDraft = { name: string; party: BattlePartyMember[] };

/** 캐릭터 탭의 저장 파티 프리셋을 편집하고 정렬한다. */
export function PartyPresetList({
  authenticated,
  characters,
  onListPartyPresets,
  onCreatePartyPreset,
  onUpdatePartyPreset,
  onMakePartyPresetPrimary,
  onReorderPartyPresets,
  onDeletePartyPreset,
}: PartyPresetListProps) {
  const [presets, setPresets] = useState<PartyPresetResponse[]>([]);
  const [expandedPresetId, setExpandedPresetId] = useState<ExpandedPresetId>(null);
  const [newDraft, setNewDraft] = useState<NewPresetDraft | null>(null);
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const [draftName, setDraftName] = useState('');
  const [draftParty, setDraftParty] = useState<BattlePartyMember[]>(emptyPartyMembers());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const presetsRef = useRef(presets);
  const mutationPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const swipeableNodesRef = useRef(new Map<number, SwipeableMethods>());
  presetsRef.current = presets;

  const closeOpenSwipeable = useCallback(() => {
    openSwipeableRef.current?.close();
    openSwipeableRef.current = null;
  }, []);

  const loadPresets = useCallback(async () => {
    if (!authenticated) {
      setPresets([]);
      setExpandedPresetId(null);
      setNewDraft(null);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const loaded = await onListPartyPresets();
      if (mountedRef.current) setPresets(loaded);
    } catch (error) {
      if (mountedRef.current) setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [authenticated, onListPartyPresets]);

  useEffect(() => {
    mountedRef.current = true;
    void loadPresets();
    return () => {
      mountedRef.current = false;
      closeOpenSwipeable();
      swipeableNodesRef.current.clear();
    };
  }, [closeOpenSwipeable, loadPresets]);

  useEffect(() => {
    closeOpenSwipeable();
  }, [closeOpenSwipeable, presets, isSaving]);

  function openPreset(preset: PartyPresetResponse) {
    setExpandedPresetId((current) => {
      if (current === preset.id) return null;
      setDraftName(preset.name);
      setDraftParty(createPartyFromPreset(preset));
      setActiveSlotIndex(0);
      return preset.id;
    });
  }

  function openNewPreset() {
    if (newDraft == null) {
      const request = buildCreatePartyPresetRequest();
      setNewDraft({ name: request.name, party: request.members });
    }
    setActiveSlotIndex(0);
    setExpandedPresetId('new');
  }

  function toggleNewPreset() {
    setExpandedPresetId((current) => current === 'new' ? null : 'new');
  }

  async function savePreset() {
    if (!authenticated || mutationPendingRef.current) return;
    const editingNew = expandedPresetId === 'new';
    const name = editingNew ? newDraft?.name ?? '' : draftName;
    const party = editingNew ? newDraft?.party ?? emptyPartyMembers() : draftParty;
    const request = { name: name.trim(), members: normalizeDraftParty(party) };
    if (!request.name) {
      setErrorMessage('프리셋 이름을 입력하세요.');
      return;
    }

    mutationPendingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      if (editingNew) {
        const created = await onCreatePartyPreset(request);
        if (!mountedRef.current) return;
        setPresets((current) => [created, ...current].map((preset, displayOrder) => ({ ...preset, displayOrder })));
        setNewDraft(null);
        setExpandedPresetId(null);
      } else if (typeof expandedPresetId === 'number') {
        const updated = await onUpdatePartyPreset(expandedPresetId, request);
        if (!mountedRef.current) return;
        setPresets((current) => current.map((preset) => preset.id === updated.id ? updated : preset));
        setExpandedPresetId(null);
      }
    } catch (error) {
      if (mountedRef.current) setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      mutationPendingRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }

  function discardNewPreset() {
    if (mutationPendingRef.current) return;
    setNewDraft(null);
    setExpandedPresetId(null);
  }

  async function deletePresetById(presetId: number) {
    if (!authenticated || mutationPendingRef.current) return;
    closeOpenSwipeable();
    mutationPendingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await onDeletePartyPreset(presetId);
      if (!mountedRef.current) return;
      setPresets((current) => current
        .filter((preset) => preset.id !== presetId)
        .map((preset, displayOrder) => ({ ...preset, displayOrder })));
      setExpandedPresetId((current) => current === presetId ? null : current);
    } catch (error) {
      if (mountedRef.current) setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      mutationPendingRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }

  async function makePrimary(presetId: number) {
    if (!authenticated || mutationPendingRef.current) return;
    const target = presetsRef.current.find(({ id }) => id === presetId);
    if (target?.isPrimary) return;
    mutationPendingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const updated = await onMakePartyPresetPrimary(presetId);
      if (!mountedRef.current) return;
      setPresets((current) => current.map((preset) => (
        preset.id === updated.id
          ? { ...updated, isPrimary: true }
          : { ...preset, isPrimary: false }
      )));
    } catch (error) {
      if (mountedRef.current) setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      mutationPendingRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }

  async function reorderPresets(orderedPresets: PartyPresetResponse[], previous: PartyPresetResponse[]) {
    if (!authenticated || mutationPendingRef.current) return;
    const live = presetsRef.current;
    if (live.length !== previous.length || live.some((preset, index) => preset !== previous[index])) return;
    const optimistic = orderedPresets.map((preset, displayOrder) => ({ ...preset, displayOrder }));
    mutationPendingRef.current = true;
    setPresets(optimistic);
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const saved = await onReorderPartyPresets({ presetIds: optimistic.map(({ id }) => id) });
      if (mountedRef.current) setPresets(saved);
    } catch (error) {
      if (mountedRef.current) {
        setPresets(previous);
        setErrorMessage(toUserFacingErrorMessage(error));
        try {
          setPresets(await onListPartyPresets());
        } catch {
          // Keep the captured pre-drag order when authoritative recovery is unavailable.
        }
      }
    } finally {
      mutationPendingRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }

  function movePreset(presetId: number, offset: -1 | 1) {
    const previous = presetsRef.current;
    const from = previous.findIndex(({ id }) => id === presetId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= previous.length) return;
    const ordered = [...previous];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved!);
    void reorderPresets(ordered, previous);
  }

  function renderPreset({ item: preset, drag, getIndex, isActive }: RenderItemParams<PartyPresetResponse>) {
    const index = getIndex() ?? presetsRef.current.findIndex(({ id }) => id === preset.id);
    const expanded = expandedPresetId === preset.id;
    const interactionDisabled = isSaving || isDragging || isActive;
    const deleteAction = () => void deletePresetById(preset.id);
    return (
      <ReanimatedSwipeable
        ref={(node) => {
          if (node) swipeableNodesRef.current.set(preset.id, node);
          else swipeableNodesRef.current.delete(preset.id);
        }}
        containerStyle={styles.swipeContainer}
        enabled={!interactionDisabled}
        friction={2}
        onSwipeableWillOpen={() => {
          const next = swipeableNodesRef.current.get(preset.id) ?? null;
          if (openSwipeableRef.current && openSwipeableRef.current !== next) openSwipeableRef.current.close();
          openSwipeableRef.current = next;
        }}
        overshootRight={false}
        renderRightActions={() => (
          <Pressable
            accessibilityLabel={`${preset.name} 삭제`}
            accessibilityRole="button"
            disabled={interactionDisabled}
            onPress={deleteAction}
            style={({ pressed }) => [styles.swipeDeleteAction, pressed && styles.pressed]}
          >
            <Trash2 color={theme.colors.buttonText} size={18} />
            <Text style={styles.swipeDeleteText}>삭제</Text>
          </Pressable>
        )}
        rightThreshold={40}
      >
        <PresetCard
          expanded={expanded}
          isPrimary={preset.isPrimary}
          name={preset.name}
          summary={formatPartyPresetSummary(preset)}
          onMakePrimary={() => void makePrimary(preset.id)}
          onPress={() => openPreset(preset)}
          renderHandle={() => (
            <Pressable
              accessibilityActions={[
                ...(index > 0 ? [{ name: 'decrement' as const, label: '위로 이동' }] : []),
                ...(index < presets.length - 1 ? [{ name: 'increment' as const, label: '아래로 이동' }] : []),
                { name: 'delete' as const, label: '삭제' },
              ]}
              accessibilityHint="길게 누르거나 접근성 동작으로 순서를 바꾸세요"
              accessibilityLabel={`${preset.name} ${index + 1}번째 프리셋 순서 이동`}
              accessibilityRole="adjustable"
              accessibilityState={{ disabled: interactionDisabled }}
              accessibilityValue={{ min: 1, max: presets.length, now: index + 1 }}
              delayLongPress={120}
              disabled={interactionDisabled}
              onAccessibilityAction={({ nativeEvent: { actionName } }) => {
                if (actionName === 'decrement') movePreset(preset.id, -1);
                if (actionName === 'increment') movePreset(preset.id, 1);
                if (actionName === 'delete') deleteAction();
              }}
              onLongPress={() => {
                closeOpenSwipeable();
                setIsDragging(true);
                drag();
              }}
              style={({ pressed }) => [styles.dragHandle, pressed && styles.pressed]}
            >
              <GripVertical color={theme.colors.textMuted} size={18} />
            </Pressable>
          )}
        >
          {expanded ? renderEditor({
            activeSlotIndex,
            characters,
            draftName,
            draftParty,
            isSaving,
            onActiveSlotChange: setActiveSlotIndex,
            onDelete: deleteAction,
            onNameChange: setDraftName,
            onPartyChange: setDraftParty,
            onSave: savePreset,
          }) : null}
        </PresetCard>
      </ReanimatedSwipeable>
    );
  }

  const listHeader = (
    <View style={styles.listHeader}>
      {presets.length === 0 && newDraft == null ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle}>프리셋 0개</Text>
          <Text style={styles.stateText}>자주 쓰는 파티와 패턴을 프리셋으로 저장하세요.</Text>
        </View>
      ) : null}
      {newDraft ? (
        <PresetCard
          expanded={expandedPresetId === 'new'}
          isPrimary={false}
          name={newDraft.name || '새 프리셋'}
          summary={formatDraftPartySummary(newDraft.party)}
          onMakePrimary={null}
          onPress={toggleNewPreset}
          renderHandle={null}
        >
          {expandedPresetId === 'new' ? renderEditor({
            activeSlotIndex,
            characters,
            draftName: newDraft.name,
            draftParty: newDraft.party,
            isSaving,
            onActiveSlotChange: setActiveSlotIndex,
            onDelete: discardNewPreset,
            onNameChange: (name) => setNewDraft((current) => current ? { ...current, name } : current),
            onPartyChange: (party) => setNewDraft((current) => current ? { ...current, party } : current),
            onSave: savePreset,
          }) : null}
        </PresetCard>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>프리셋</Text>
        <Pressable
          accessibilityLabel="프리셋 추가"
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
          <Text style={styles.addButtonText}>추가</Text>
        </Pressable>
      </View>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
      {isLoading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color={theme.colors.accentGreen} />
          <Text style={styles.stateText}>프리셋을 불러오는 중</Text>
        </View>
      ) : (
        <DraggableFlatList
          containerStyle={styles.list}
          contentContainerStyle={styles.listContent}
          contentInsetAdjustmentBehavior="automatic"
          data={presets}
          keyExtractor={({ id }) => id.toString()}
          ListHeaderComponent={listHeader}
          onDragBegin={() => {
            closeOpenSwipeable();
            setIsDragging(true);
          }}
          onDragEnd={({ data, from, to }) => {
            setIsDragging(false);
            if (from === to) return;
            return reorderPresets(data, presets);
          }}
          renderItem={renderPreset}
          style={styles.list}
        />
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
  onMakePrimary: (() => void) | null;
  onPress: () => void;
  renderHandle: (() => ReactNode) | null;
};

function PresetCard({
  children,
  expanded,
  isPrimary,
  name,
  summary,
  onMakePrimary,
  onPress,
  renderHandle,
}: PresetCardProps) {
  return (
    <View style={[styles.card, expanded && styles.expandedCard]}>
      <View style={styles.cardHeader}>
        {renderHandle?.()}
        {onMakePrimary ? (
          <Pressable
            accessibilityLabel={`${name} ${isPrimary ? '대표 프리셋' : '대표로 지정'}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: isPrimary }}
            disabled={isPrimary}
            onPress={onMakePrimary}
            style={({ pressed }) => [styles.primaryStar, pressed && !isPrimary && styles.pressed]}
          >
            <Star
              color={isPrimary ? theme.colors.accentAmber : theme.colors.textMuted}
              fill={isPrimary ? theme.colors.accentAmber : 'transparent'}
              size={18}
            />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel={`${name} 프리셋 ${expanded ? '접기' : '펼치기'}`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={onPress}
          style={({ pressed }) => [styles.cardHeaderButton, pressed && styles.pressed]}
        >
          <Text style={styles.cardTitle} numberOfLines={1}>{name}</Text>
          <View style={styles.cardSide}>
            <Text style={styles.cardSummary}>{summary}</Text>
            {expanded ? (
              <ChevronUp color={theme.colors.textMuted} size={18} />
            ) : (
              <ChevronDown color={theme.colors.textMuted} size={18} />
            )}
          </View>
        </Pressable>
      </View>
      {expanded ? <View style={styles.cardBody}>{children}</View> : null}
    </View>
  );
}

function renderEditor({
  activeSlotIndex,
  characters,
  draftName,
  draftParty,
  isSaving,
  onActiveSlotChange,
  onDelete,
  onNameChange,
  onPartyChange,
  onSave,
}: {
  activeSlotIndex: number;
  characters: HofCharacter[];
  draftName: string;
  draftParty: BattlePartyMember[];
  isSaving: boolean;
  onActiveSlotChange: (slotIndex: number) => void;
  onDelete: () => void;
  onNameChange: (name: string) => void;
  onPartyChange: (party: BattlePartyMember[]) => void;
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

function formatDraftPartySummary(party: BattlePartyMember[]): string {
  const memberCount = normalizeDraftParty(party).filter((member) => member.characterId != null).length;
  return `${memberCount.toLocaleString('en-US')}명 설정`;
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: theme.spacing.sm },
  toolbar: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
  toolbarTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  addButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, borderRadius: theme.radius.md, backgroundColor: theme.colors.accentGreen, paddingHorizontal: 12 },
  addButtonText: { color: theme.colors.background, fontSize: 14, fontWeight: '900' },
  list: { flex: 1 },
  listContent: { paddingBottom: theme.spacing.xl },
  listHeader: { gap: 8, paddingBottom: 8 },
  swipeContainer: { borderCurve: 'continuous', borderRadius: theme.radius.md, marginBottom: 8, overflow: 'hidden' },
  swipeDeleteAction: { alignItems: 'center', backgroundColor: theme.colors.danger, justifyContent: 'center', width: 72 },
  swipeDeleteText: { color: theme.colors.buttonText, fontSize: 11, fontWeight: '900', marginTop: 2 },
  card: { borderWidth: 1, borderColor: theme.colors.border, borderCurve: 'continuous', borderRadius: theme.radius.md, backgroundColor: theme.colors.surface, paddingHorizontal: 8, paddingVertical: 8 },
  expandedCard: { borderColor: theme.colors.borderStrong },
  cardHeader: { minHeight: 32, flexDirection: 'row', alignItems: 'center' },
  cardHeaderButton: { minWidth: 0, flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dragHandle: { alignItems: 'center', justifyContent: 'center', minHeight: 44, width: 32 },
  primaryStar: { alignItems: 'center', justifyContent: 'center', minHeight: 44, width: 34 },
  cardTitle: { minWidth: 0, flex: 1, color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  cardSide: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardSummary: { color: theme.colors.accentGreen, fontSize: 13, fontWeight: '900' },
  cardBody: { marginTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.spacing.sm },
  editor: { gap: theme.spacing.sm },
  inputLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '900' },
  nameInput: { minHeight: 38, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, color: theme.colors.text, backgroundColor: theme.colors.surfaceAlt, fontSize: 14, fontWeight: '800', paddingHorizontal: theme.spacing.md },
  editorActions: { flexDirection: 'row', gap: theme.spacing.sm },
  primaryActionButton: { minHeight: 36, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs, borderRadius: theme.radius.md, backgroundColor: theme.colors.accentGreen },
  secondaryActionButton: { minHeight: 36, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs, borderWidth: 1, borderColor: theme.colors.danger, borderRadius: theme.radius.md },
  primaryActionText: { color: theme.colors.background, fontSize: 13, fontWeight: '900' },
  secondaryActionText: { color: theme.colors.danger, fontSize: 13, fontWeight: '900' },
  errorText: { color: theme.colors.danger, borderWidth: 1, borderColor: theme.colors.danger, borderRadius: theme.radius.sm, padding: theme.spacing.md, fontSize: 13, fontWeight: '800', lineHeight: 19 },
  stateBox: { minHeight: 116, justifyContent: 'center', gap: theme.spacing.xs, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface, padding: theme.spacing.lg },
  stateTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '900' },
  stateText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '700' },
  disabledButton: { opacity: 0.5 },
  pressed: { opacity: 0.82 },
});
