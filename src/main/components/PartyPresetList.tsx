import { ChevronDown, ChevronUp, FolderCog, GripVertical, Pencil, Plus, Save, Star, Trash2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';

import { BattlePartySelector } from './BattlePartySelector';
import { PartyPresetFolderPicker } from './PartyPresetFolderPicker';
import { PartyPresetSearchResults } from './PartyPresetSearchResults';
import { PartyPresetTree, type PartyPresetExpandedPath } from './PartyPresetTree';
import { BATTLE_PARTY_SIZE, type BattlePartyMember } from '../domain/battleParty';
import {
  buildCreatePartyPresetRequest,
  createPartyFromPreset,
  emptyPartyMembers,
  formatPartyPresetSummary,
} from '../domain/partyPresets';
import { toUserFacingErrorMessage } from '../domain/userFacingErrors';
import { getPartyPresetFolderPath, indexPartyPresetCatalog, searchPartyPresetCatalog } from '../domain/partyPresetCatalog';
import { theme } from '../styles/theme';
import type {
  CreatePartyPresetRequest,
  CreatePartyPresetFolderRequest,
  HofCharacter,
  MovePartyPresetFolderRequest,
  PartyPresetCatalogResponse,
  PartyPresetFolderResponse,
  PartyPresetResponse,
  RenamePartyPresetFolderRequest,
  ReorderPartyPresetFoldersRequest,
  ReorderPartyPresetsRequest,
  UpdatePartyPresetRequest,
} from '../types/api';

type PartyPresetListProps = {
  authenticated: boolean;
  characters: HofCharacter[];
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  onGetPartyPresetCatalog?: () => Promise<PartyPresetCatalogResponse>;
  onCreatePartyPreset: (request: CreatePartyPresetRequest) => Promise<PartyPresetResponse>;
  onUpdatePartyPreset: (presetId: number, request: UpdatePartyPresetRequest) => Promise<PartyPresetResponse>;
  onMakePartyPresetPrimary: (presetId: number) => Promise<PartyPresetResponse>;
  onReorderPartyPresets: (request: ReorderPartyPresetsRequest) => Promise<PartyPresetResponse[]>;
  onDeletePartyPreset: (presetId: number) => Promise<null>;
  onCreatePartyPresetFolder?: (request: CreatePartyPresetFolderRequest) => Promise<PartyPresetCatalogResponse>;
  onRenamePartyPresetFolder?: (folderId: number, request: RenamePartyPresetFolderRequest) => Promise<PartyPresetCatalogResponse>;
  onReorderPartyPresetFolders?: (request: ReorderPartyPresetFoldersRequest) => Promise<PartyPresetCatalogResponse>;
  onMovePartyPresetFolder?: (folderId: number, request: MovePartyPresetFolderRequest) => Promise<PartyPresetCatalogResponse>;
  onDeletePartyPresetFolder?: (folderId: number) => Promise<PartyPresetCatalogResponse>;
};

type ExpandedPresetId = number | 'new' | null;
type NewPresetDraft = { name: string; party: BattlePartyMember[]; folderId: number | null };

/** 캐릭터 탭의 저장 파티 프리셋을 편집하고 정렬한다. */
export function PartyPresetList({
  authenticated,
  characters,
  onListPartyPresets,
  onGetPartyPresetCatalog,
  onCreatePartyPreset,
  onUpdatePartyPreset,
  onMakePartyPresetPrimary,
  onReorderPartyPresets,
  onDeletePartyPreset,
  onCreatePartyPresetFolder,
  onRenamePartyPresetFolder,
  onReorderPartyPresetFolders,
  onMovePartyPresetFolder,
  onDeletePartyPresetFolder,
}: PartyPresetListProps) {
  const [presets, setPresets] = useState<PartyPresetResponse[]>([]);
  const [folders, setFolders] = useState<PartyPresetFolderResponse[]>([]);
  const [expandedPresetId, setExpandedPresetId] = useState<ExpandedPresetId>(null);
  const [newDraft, setNewDraft] = useState<NewPresetDraft | null>(null);
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const [draftName, setDraftName] = useState('');
  const [draftParty, setDraftParty] = useState<BattlePartyMember[]>(emptyPartyMembers());
  const [draftFolderId, setDraftFolderId] = useState<number | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [expandedFolderPath, setExpandedFolderPath] = useState<PartyPresetExpandedPath>([]);
  const [folderEditMode, setFolderEditMode] = useState(false);
  const [folderParentId, setFolderParentId] = useState<number | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [movingFolderId, setMovingFolderId] = useState<number | null>(null);
  const [deleteConfirmFolderId, setDeleteConfirmFolderId] = useState<number | null>(null);
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
  const catalogIndex = useMemo(() => indexPartyPresetCatalog({ folders, presets }), [folders, presets]);
  const activePresetFolderId = expandedPresetId === 'new'
    ? newDraft?.folderId ?? null
    : typeof expandedPresetId === 'number'
      ? catalogIndex.presetsById.get(expandedPresetId)?.folderId ?? null
      : null;
  const visiblePresets = useMemo(
    () => onGetPartyPresetCatalog
      ? presets.filter(({ folderId }) => folderId === activePresetFolderId)
      : presets,
    [activePresetFolderId, onGetPartyPresetCatalog, presets],
  );
  const visiblePresetsRef = useRef(visiblePresets);
  visiblePresetsRef.current = visiblePresets;
  const searchResults = useMemo(
    () => searchPartyPresetCatalog(catalogIndex, catalogQuery),
    [catalogIndex, catalogQuery],
  );
  const editableFolders = useMemo(() => (
    (catalogIndex.childFolderIdsByParent.get(folderParentId) ?? [])
      .map((id) => catalogIndex.foldersById.get(id))
      .filter((folder): folder is PartyPresetFolderResponse => folder != null)
  ), [catalogIndex, folderParentId]);
  const folderParentAtMaxDepth = folderParentId != null
    && partyPresetFolderDepth(catalogIndex.foldersById, folderParentId) >= 5;

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
      if (onGetPartyPresetCatalog) {
        const loaded = await onGetPartyPresetCatalog();
        if (mountedRef.current) {
          setFolders(loaded.folders);
          setPresets(loaded.presets);
        }
      } else {
        const loaded = await onListPartyPresets();
        if (mountedRef.current) setPresets(loaded);
      }
    } catch (error) {
      if (mountedRef.current) setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [authenticated, onGetPartyPresetCatalog, onListPartyPresets]);

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
      setDraftFolderId(preset.folderId);
      setActiveSlotIndex(0);
      return preset.id;
    });
  }

  function openNewPreset() {
    if (newDraft == null) {
      const request = buildCreatePartyPresetRequest();
      setNewDraft({ name: request.name, party: request.members, folderId: null });
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
    const folderId = editingNew ? newDraft?.folderId ?? null : draftFolderId;
    const request = { name: name.trim(), members: normalizeDraftParty(party), folderId };
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
        setPresets((current) => {
          let siblingOrder = 0;
          return [created, ...current].map((preset) => preset.folderId === created.folderId
            ? { ...preset, displayOrder: siblingOrder++ }
            : preset);
        });
        setNewDraft(null);
        setExpandedPresetId(null);
        if (onGetPartyPresetCatalog) {
          try {
            const catalog = await onGetPartyPresetCatalog();
            if (mountedRef.current) replaceCatalog(catalog);
          } catch { /* Keep the successful local mutation. */ }
        }
      } else if (typeof expandedPresetId === 'number') {
        const updated = await onUpdatePartyPreset(expandedPresetId, request);
        if (!mountedRef.current) return;
        setPresets((current) => current.map((preset) => preset.id === updated.id ? updated : preset));
        setExpandedPresetId(null);
        if (onGetPartyPresetCatalog) {
          try {
            const catalog = await onGetPartyPresetCatalog();
            if (mountedRef.current) replaceCatalog(catalog);
          } catch { /* Keep the successful local mutation. */ }
        }
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
      setPresets((current) => {
        const deletedFolderId = current.find(({ id }) => id === presetId)?.folderId ?? null;
        let siblingOrder = 0;
        return current
          .filter((preset) => preset.id !== presetId)
          .map((preset) => preset.folderId === deletedFolderId
            ? { ...preset, displayOrder: siblingOrder++ }
            : preset);
      });
      setExpandedPresetId((current) => current === presetId ? null : current);
      if (onGetPartyPresetCatalog) {
        try {
          const catalog = await onGetPartyPresetCatalog();
          if (mountedRef.current) replaceCatalog(catalog);
        } catch { /* Keep the successful local mutation. */ }
      }
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
    const live = visiblePresetsRef.current;
    if (live.length !== previous.length || live.some((preset, index) => preset !== previous[index])) return;
    const previousCatalog = presetsRef.current;
    const optimistic = orderedPresets.map((preset, displayOrder) => ({ ...preset, displayOrder }));
    const optimisticById = new Map(optimistic.map((preset) => [preset.id, preset]));
    mutationPendingRef.current = true;
    setPresets((current) => current.map((preset) => optimisticById.get(preset.id) ?? preset));
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const saved = await onReorderPartyPresets({
        folderId: activePresetFolderId,
        presetIds: optimistic.map(({ id }) => id),
      });
      if (mountedRef.current) {
        const savedById = new Map(saved.map((preset) => [preset.id, preset]));
        setPresets((current) => current.map((preset) => savedById.get(preset.id) ?? preset));
      }
    } catch (error) {
      if (mountedRef.current) {
        setPresets(previousCatalog);
        setErrorMessage(toUserFacingErrorMessage(error));
        try {
          if (onGetPartyPresetCatalog) {
            const catalog = await onGetPartyPresetCatalog();
            if (mountedRef.current) replaceCatalog(catalog);
          } else {
            const loaded = await onListPartyPresets();
            if (mountedRef.current) setPresets(loaded);
          }
        } catch {
          // Keep the captured pre-drag order when authoritative recovery is unavailable.
        }
      }
    } finally {
      mutationPendingRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }

  function replaceCatalog(catalog: PartyPresetCatalogResponse) {
    setFolders(catalog.folders);
    setPresets(catalog.presets);
  }

  async function mutateFolder(operation: () => Promise<PartyPresetCatalogResponse>): Promise<boolean> {
    if (!authenticated || mutationPendingRef.current) return false;
    mutationPendingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const catalog = await operation();
      if (mountedRef.current) replaceCatalog(catalog);
      return true;
    } catch (error) {
      if (mountedRef.current) setErrorMessage(toUserFacingErrorMessage(error));
      return false;
    } finally {
      mutationPendingRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name || !onCreatePartyPresetFolder || folderParentAtMaxDepth) return;
    const succeeded = await mutateFolder(() => onCreatePartyPresetFolder({ name, parentFolderId: folderParentId }));
    if (succeeded && mountedRef.current) setNewFolderName('');
  }

  async function renameFolder(folderId: number) {
    const name = folderNameDraft.trim();
    if (!name || !onRenamePartyPresetFolder) return;
    const succeeded = await mutateFolder(() => onRenamePartyPresetFolder(folderId, { name }));
    if (succeeded && mountedRef.current) setRenamingFolderId(null);
  }

  async function deleteFolder(folderId: number) {
    if (!onDeletePartyPresetFolder) return;
    const succeeded = await mutateFolder(() => onDeletePartyPresetFolder(folderId));
    if (succeeded && mountedRef.current) setDeleteConfirmFolderId(null);
  }

  async function moveFolder(folderId: number, parentFolderId: number | null) {
    if (!onMovePartyPresetFolder) return;
    const currentParentFolderId = catalogIndex.foldersById.get(folderId)?.parentFolderId;
    if (currentParentFolderId === parentFolderId) {
      setMovingFolderId(null);
      return;
    }
    const displayOrder = catalogIndex.childFolderIdsByParent.get(parentFolderId)?.length ?? 0;
    const succeeded = await mutateFolder(() => onMovePartyPresetFolder(folderId, { parentFolderId, displayOrder }));
    if (succeeded && mountedRef.current) setMovingFolderId(null);
  }

  async function reorderFolders(ordered: PartyPresetFolderResponse[], previous: PartyPresetFolderResponse[]) {
    if (!onReorderPartyPresetFolders || mutationPendingRef.current) return;
    const optimisticIds = new Set(ordered.map(({ id }) => id));
    const optimistic = folders.map((folder) => {
      if (!optimisticIds.has(folder.id)) return folder;
      const displayOrder = ordered.findIndex(({ id }) => id === folder.id);
      return { ...folder, displayOrder };
    });
    setFolders(optimistic);
    mutationPendingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const catalog = await onReorderPartyPresetFolders({
        parentFolderId: folderParentId,
        folderIds: ordered.map(({ id }) => id),
      });
      if (mountedRef.current) replaceCatalog(catalog);
    } catch (error) {
      if (mountedRef.current) {
        setFolders((current) => current.map((folder) => previous.find(({ id }) => id === folder.id) ?? folder));
        setErrorMessage(toUserFacingErrorMessage(error));
        if (onGetPartyPresetCatalog) {
          try {
            const catalog = await onGetPartyPresetCatalog();
            if (mountedRef.current) replaceCatalog(catalog);
          } catch { /* Keep captured order. */ }
        }
      }
    } finally {
      mutationPendingRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }

  function movePreset(presetId: number, offset: -1 | 1) {
    const previous = visiblePresetsRef.current;
    const from = previous.findIndex(({ id }) => id === presetId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= previous.length) return;
    const ordered = [...previous];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved!);
    void reorderPresets(ordered, previous);
  }

  function renderPreset({ item: preset, drag, getIndex, isActive }: RenderItemParams<PartyPresetResponse>) {
    const index = getIndex() ?? visiblePresetsRef.current.findIndex(({ id }) => id === preset.id);
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
                ...(index < visiblePresets.length - 1 ? [{ name: 'increment' as const, label: '아래로 이동' }] : []),
                { name: 'delete' as const, label: '삭제' },
              ]}
              accessibilityHint="길게 누르거나 접근성 동작으로 순서를 바꾸세요"
              accessibilityLabel={`${preset.name} ${index + 1}번째 프리셋 순서 이동`}
              accessibilityRole="adjustable"
              accessibilityState={{ disabled: interactionDisabled }}
              accessibilityValue={{ min: 1, max: visiblePresets.length, now: index + 1 }}
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
            folderPath: getPartyPresetFolderPath(catalogIndex, draftFolderId),
            isSaving,
            onActiveSlotChange: setActiveSlotIndex,
            onDelete: deleteAction,
            onNameChange: setDraftName,
            onPartyChange: setDraftParty,
            onOpenFolderPicker: () => setFolderPickerOpen(true),
            onSave: savePreset,
          }) : null}
        </PresetCard>
      </ReanimatedSwipeable>
    );
  }

  function renderFolder({ item: folder, drag, getIndex, isActive }: RenderItemParams<PartyPresetFolderResponse>) {
    const index = getIndex() ?? editableFolders.findIndex(({ id }) => id === folder.id);
    const interactionDisabled = isSaving || isDragging || isActive;
    const moveBy = (offset: -1 | 1) => {
      const to = index + offset;
      if (to < 0 || to >= editableFolders.length) return;
      const ordered = [...editableFolders];
      const [moved] = ordered.splice(index, 1);
      ordered.splice(to, 0, moved!);
      void reorderFolders(ordered, editableFolders);
    };
    return (
      <View style={styles.folderEditItem}>
        <View style={styles.folderEditRow}>
        <Pressable
          accessibilityActions={[
            ...(index > 0 ? [{ name: 'decrement' as const, label: '위로 이동' }] : []),
            ...(index < editableFolders.length - 1 ? [{ name: 'increment' as const, label: '아래로 이동' }] : []),
          ]}
          accessibilityHint="길게 누르거나 접근성 동작으로 같은 부모의 폴더 순서를 바꾸세요"
          accessibilityLabel={`${folder.name} ${index + 1}번째 폴더 순서 이동`}
          accessibilityRole="adjustable"
          accessibilityState={{ disabled: interactionDisabled }}
          accessibilityValue={{ min: 1, max: editableFolders.length, now: index + 1 }}
          delayLongPress={120}
          disabled={interactionDisabled}
          onAccessibilityAction={({ nativeEvent: { actionName } }) => {
            if (actionName === 'decrement') moveBy(-1);
            if (actionName === 'increment') moveBy(1);
          }}
          onLongPress={drag}
          style={styles.folderDragHandle}
        >
          <GripVertical color={theme.colors.textMuted} size={18} />
        </Pressable>
        {renamingFolderId === folder.id ? (
          <TextInput
            accessibilityLabel={`${folder.name} 폴더 이름`}
            autoFocus
            onChangeText={setFolderNameDraft}
            style={[styles.nameInput, styles.folderNameInput]}
            value={folderNameDraft}
          />
        ) : (
          <Pressable
            accessibilityLabel={`${folder.name} 하위 폴더 열기`}
            accessibilityRole="button"
            onPress={() => setFolderParentId(folder.id)}
            style={styles.folderNameButton}
          >
            <Text numberOfLines={1} style={styles.folderNameText}>{folder.name}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityLabel={renamingFolderId === folder.id ? `${folder.name} 폴더 이름 저장` : `${folder.name} 폴더 이름 변경`}
          accessibilityRole="button"
          disabled={interactionDisabled}
          onPress={() => {
            if (renamingFolderId === folder.id) void renameFolder(folder.id);
            else { setRenamingFolderId(folder.id); setFolderNameDraft(folder.name); }
          }}
          style={styles.folderIconButton}
        >
          {renamingFolderId === folder.id ? <Save color={theme.colors.accentGreen} size={17} /> : <Pencil color={theme.colors.textMuted} size={17} />}
        </Pressable>
        <Pressable
          accessibilityLabel={`${folder.name} 폴더 이동`}
          accessibilityRole="button"
          disabled={interactionDisabled}
          onPress={() => setMovingFolderId(folder.id)}
          style={styles.folderIconButton}
        >
          <FolderCog color={theme.colors.textMuted} size={17} />
        </Pressable>
        <Pressable
          accessibilityLabel={`${folder.name} 폴더 삭제`}
          accessibilityRole="button"
          disabled={interactionDisabled}
          onPress={() => setDeleteConfirmFolderId(folder.id)}
          style={styles.folderIconButton}
        >
          <Trash2 color={theme.colors.danger} size={17} />
        </Pressable>
        </View>
        {deleteConfirmFolderId === folder.id ? (
          <View accessibilityLiveRegion="polite" style={styles.folderDeleteConfirmation}>
            <View style={styles.folderDeleteCopy}>
              <Text style={styles.folderDeleteTitle}>{folder.name} 폴더를 삭제할까요?</Text>
              <Text style={styles.folderDeleteMessage}>프리셋은 삭제되지 않고 미지정으로 이동합니다.</Text>
            </View>
            <Pressable
              accessibilityLabel={`${folder.name} 폴더 삭제 취소`}
              accessibilityRole="button"
              disabled={interactionDisabled}
              onPress={() => setDeleteConfirmFolderId(null)}
              style={styles.folderConfirmButton}
            >
              <Text style={styles.folderCancelText}>취소</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`${folder.name} 폴더 삭제 확인`}
              accessibilityRole="button"
              disabled={interactionDisabled}
              onPress={() => void deleteFolder(folder.id)}
              style={[styles.folderConfirmButton, styles.folderDeleteButton]}
            >
              <Text style={styles.folderDeleteButtonText}>삭제</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
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
            folderPath: getPartyPresetFolderPath(catalogIndex, newDraft.folderId),
            isSaving,
            onActiveSlotChange: setActiveSlotIndex,
            onDelete: discardNewPreset,
            onNameChange: (name) => setNewDraft((current) => current ? { ...current, name } : current),
            onPartyChange: (party) => setNewDraft((current) => current ? { ...current, party } : current),
            onOpenFolderPicker: () => setFolderPickerOpen(true),
            onSave: savePreset,
          }) : null}
        </PresetCard>
      ) : null}
      {folderPickerOpen ? (
        <PartyPresetFolderPicker
          index={catalogIndex}
          onCancel={() => setFolderPickerOpen(false)}
          onConfirm={(folderId) => {
            if (expandedPresetId === 'new') {
              setNewDraft((current) => current ? { ...current, folderId } : current);
            } else {
              setDraftFolderId(folderId);
            }
            setFolderPickerOpen(false);
          }}
          selectedFolderId={expandedPresetId === 'new' ? newDraft?.folderId ?? null : draftFolderId}
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>프리셋</Text>
        {folders.length > 0 || onCreatePartyPresetFolder ? (
          <Pressable
            accessibilityLabel={folderEditMode ? '폴더 편집 종료' : '폴더 편집 시작'}
            accessibilityRole="button"
            disabled={!authenticated || isSaving}
            onPress={() => setFolderEditMode((current) => !current)}
            style={styles.folderModeButton}
          >
            <FolderCog color={theme.colors.textMuted} size={17} />
            <Text style={styles.folderModeText}>{folderEditMode ? '완료' : '폴더 편집'}</Text>
          </Pressable>
        ) : null}
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
      ) : folderEditMode ? (
        <View style={styles.folderManager}>
          <View style={styles.folderManagerHeader}>
            {folderParentId != null ? (
              <Pressable accessibilityLabel="상위 폴더로 이동" accessibilityRole="button" onPress={() => setFolderParentId(catalogIndex.foldersById.get(folderParentId)?.parentFolderId ?? null)} style={styles.folderIconButton}>
                <ChevronUp color={theme.colors.textMuted} size={18} />
              </Pressable>
            ) : null}
            <Text style={styles.folderManagerPath}>{folderParentId == null ? '루트' : getPartyPresetFolderPath(catalogIndex, folderParentId)}</Text>
            <TextInput accessibilityLabel="새 폴더 이름" onChangeText={setNewFolderName} placeholder="새 폴더" placeholderTextColor={theme.colors.textMuted} style={[styles.nameInput, styles.newFolderInput]} value={newFolderName} />
            <Pressable
              accessibilityHint={folderParentAtMaxDepth ? '폴더는 최대 5단계까지 만들 수 있습니다' : undefined}
              accessibilityLabel="현재 위치에 폴더 추가"
              accessibilityRole="button"
              disabled={!newFolderName.trim() || isSaving || !onCreatePartyPresetFolder || folderParentAtMaxDepth}
              onPress={() => void createFolder()}
              style={styles.folderIconButton}
            >
              <Plus color={theme.colors.accentGreen} size={18} />
            </Pressable>
          </View>
          <DraggableFlatList
            containerStyle={styles.list}
            contentContainerStyle={styles.listContent}
            data={editableFolders}
            keyExtractor={({ id }) => id.toString()}
            onDragBegin={() => setIsDragging(true)}
            onDragEnd={({ data, from, to }) => {
              setIsDragging(false);
              if (from !== to) void reorderFolders(data, editableFolders);
            }}
            renderItem={renderFolder}
            style={styles.list}
          />
          {movingFolderId != null ? (
            <PartyPresetFolderPicker
              allowUnassigned={false}
              index={catalogIndex}
              movingFolderId={movingFolderId}
              onCancel={() => setMovingFolderId(null)}
              onConfirm={(parentFolderId) => void moveFolder(movingFolderId, parentFolderId)}
              selectedFolderId={catalogIndex.foldersById.get(movingFolderId)?.parentFolderId ?? null}
            />
          ) : null}
        </View>
      ) : onGetPartyPresetCatalog && expandedPresetId == null && newDraft == null ? (
        <View style={styles.catalogBrowser}>
          <TextInput
            accessibilityLabel="프리셋 이름 검색"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setCatalogQuery}
            placeholder="프리셋 이름 검색"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.nameInput}
            value={catalogQuery}
          />
          {catalogQuery.trim() ? (
            <PartyPresetSearchResults
              onSelectPreset={openPreset}
              results={searchResults}
              selectedPresetId={null}
            />
          ) : (
            <PartyPresetTree
              expandedPath={expandedFolderPath}
              index={catalogIndex}
              onExpandedPathChange={setExpandedFolderPath}
              onSelectPreset={openPreset}
              selectedPresetId={null}
            />
          )}
        </View>
      ) : (
        <DraggableFlatList
          containerStyle={styles.list}
          contentContainerStyle={styles.listContent}
          contentInsetAdjustmentBehavior="automatic"
          data={visiblePresets}
          keyExtractor={({ id }) => id.toString()}
          ListHeaderComponent={listHeader}
          onDragBegin={() => {
            closeOpenSwipeable();
            setIsDragging(true);
          }}
          onDragEnd={({ data, from, to }) => {
            setIsDragging(false);
            if (from === to) return;
            return reorderPresets(data, visiblePresets);
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
  folderPath,
  isSaving,
  onActiveSlotChange,
  onDelete,
  onNameChange,
  onPartyChange,
  onOpenFolderPicker,
  onSave,
}: {
  activeSlotIndex: number;
  characters: HofCharacter[];
  draftName: string;
  draftParty: BattlePartyMember[];
  folderPath: string;
  isSaving: boolean;
  onActiveSlotChange: (slotIndex: number) => void;
  onDelete: () => void;
  onNameChange: (name: string) => void;
  onPartyChange: (party: BattlePartyMember[]) => void;
  onOpenFolderPicker: () => void;
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
      <Text style={styles.inputLabel}>폴더 위치</Text>
      <Pressable
        accessibilityLabel="폴더 위치 선택"
        accessibilityRole="button"
        disabled={isSaving}
        onPress={onOpenFolderPicker}
        style={styles.folderLocationButton}
      >
        <Text style={styles.folderLocationText}>{folderPath}</Text>
        <ChevronDown color={theme.colors.textMuted} size={18} />
      </Pressable>
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

function partyPresetFolderDepth(
  foldersById: ReadonlyMap<number, PartyPresetFolderResponse>,
  folderId: number,
): number {
  const visited = new Set<number>();
  let depth = 0;
  let currentFolderId: number | null = folderId;
  while (currentFolderId != null && !visited.has(currentFolderId)) {
    visited.add(currentFolderId);
    depth += 1;
    currentFolderId = foldersById.get(currentFolderId)?.parentFolderId ?? null;
  }
  return depth;
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: theme.spacing.sm },
  toolbar: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
  toolbarTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  folderModeButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, borderRadius: theme.radius.md, borderCurve: 'continuous', paddingHorizontal: theme.spacing.sm },
  folderModeText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '900' },
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
  folderLocationButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderCurve: 'continuous', backgroundColor: theme.colors.surfaceAlt, paddingHorizontal: theme.spacing.md },
  folderLocationText: { minWidth: 0, flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  folderManager: { flex: 1, gap: theme.spacing.sm },
  catalogBrowser: { flex: 1, gap: theme.spacing.sm },
  folderManagerHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  folderManagerPath: { minWidth: 48, maxWidth: 120, color: theme.colors.text, fontSize: 13, fontWeight: '900' },
  newFolderInput: { minWidth: 0, flex: 1 },
  folderEditItem: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  folderEditRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  folderDeleteConfirmation: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, paddingBottom: theme.spacing.sm, paddingHorizontal: theme.spacing.sm },
  folderDeleteCopy: { minWidth: 0, flex: 1, gap: 2 },
  folderDeleteTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '900' },
  folderDeleteMessage: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' },
  folderConfirmButton: { minHeight: 44, minWidth: 52, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.colors.border },
  folderDeleteButton: { borderColor: theme.colors.danger, backgroundColor: theme.colors.danger },
  folderCancelText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '900' },
  folderDeleteButtonText: { color: theme.colors.buttonText, fontSize: 12, fontWeight: '900' },
  folderDragHandle: { minHeight: 44, width: 44, alignItems: 'center', justifyContent: 'center' },
  folderNameButton: { minHeight: 44, minWidth: 0, flex: 1, justifyContent: 'center' },
  folderNameText: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  folderNameInput: { minWidth: 0, flex: 1 },
  folderIconButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
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
