import { ChevronDown, ChevronUp, FolderCog, GripVertical, Pencil, Plus, Save, Star, Trash2 } from 'lucide-react-native';
import type { ElementRef, ReactNode, Ref } from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, findNodeHandle, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { FlatList } from 'react-native-gesture-handler';
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
import type { PartyPresetCatalogResource } from '../domain/partyPresetCatalogLoader';
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
  partyPresetCatalog: PartyPresetCatalogResource;
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
type PickerInvocation =
  | { kind: 'preset'; handle: ReturnType<typeof findNodeHandle> }
  | { kind: 'folder'; folderId: number; handle: ReturnType<typeof findNodeHandle> };

/** 캐릭터 탭의 저장 파티 프리셋을 편집하고 정렬한다. */
export function PartyPresetList({
  authenticated,
  characters,
  partyPresetCatalog,
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
  const [presets, setPresets] = useState<PartyPresetResponse[]>(partyPresetCatalog.catalog.presets);
  const [folders, setFolders] = useState<PartyPresetFolderResponse[]>(partyPresetCatalog.catalog.folders);
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
  const [isSaving, setIsSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const presetsRef = useRef(presets);
  const mutationPendingRef = useRef(false);
  const authenticatedRef = useRef(authenticated);
  const previousAuthenticatedRef = useRef(authenticated);
  const accountGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const swipeableNodesRef = useRef(new Map<number, SwipeableMethods>());
  const presetFolderTriggerRef = useRef<ElementRef<typeof Pressable>>(null);
  const folderMoveTriggerRefs = useRef(new Map<number, ElementRef<typeof Pressable>>());
  const presetDragRefs = useRef(new Map<number, () => void>());
  const folderDragRefs = useRef(new Map<number, () => void>());
  const pickerInvocationRef = useRef<PickerInvocation | null>(null);
  const pickerVisibleRef = useRef(false);
  const pickerFocusGenerationRef = useRef(0);
  const pickerFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presetListRef = useRef<FlatList<PartyPresetResponse>>(null);
  const presetEditorNameInputRef = useRef<ElementRef<typeof TextInput>>(null);
  const editorFocusGenerationRef = useRef(0);
  const editorFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presetScrollRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  pickerVisibleRef.current = folderPickerOpen || movingFolderId != null;
  presetsRef.current = presets;
  const catalogIndex = useMemo(() => indexPartyPresetCatalog({ folders, presets }), [folders, presets]);
  const activePresetFolderId = expandedPresetId === 'new'
    ? newDraft?.folderId ?? null
    : typeof expandedPresetId === 'number'
      ? catalogIndex.presetsById.get(expandedPresetId)?.folderId ?? null
      : null;
  const visiblePresets = useMemo(
    () => (catalogIndex.presetIdsByFolder.get(activePresetFolderId) ?? [])
        .map((id) => catalogIndex.presetsById.get(id))
        .filter((preset): preset is PartyPresetResponse => preset != null),
    [activePresetFolderId, catalogIndex],
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

  useLayoutEffect(() => {
    authenticatedRef.current = authenticated;
    if (previousAuthenticatedRef.current === authenticated) return;
    previousAuthenticatedRef.current = authenticated;
    accountGenerationRef.current += 1;
    mutationPendingRef.current = false;
  }, [authenticated]);

  const isCurrentAccountGeneration = useCallback((generation: number) => (
    mountedRef.current
    && authenticatedRef.current
    && accountGenerationRef.current === generation
  ), []);

  const closeOpenSwipeable = useCallback(() => {
    openSwipeableRef.current?.close();
    openSwipeableRef.current = null;
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setFolders([]);
      setPresets([]);
      setExpandedPresetId(null);
      setNewDraft(null);
      setCatalogQuery('');
      setExpandedFolderPath([]);
      setFolderPickerOpen(false);
      setFolderEditMode(false);
      setFolderParentId(null);
      setRenamingFolderId(null);
      setMovingFolderId(null);
      setDeleteConfirmFolderId(null);
      setErrorMessage(null);
      return;
    }
    setFolders(partyPresetCatalog.catalog.folders);
    setPresets(partyPresetCatalog.catalog.presets);
  }, [authenticated, partyPresetCatalog.catalog]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeOpenSwipeable();
      swipeableNodesRef.current.clear();
      folderMoveTriggerRefs.current.clear();
      presetDragRefs.current.clear();
      folderDragRefs.current.clear();
      pickerFocusGenerationRef.current += 1;
      if (pickerFocusTimerRef.current) clearTimeout(pickerFocusTimerRef.current);
      editorFocusGenerationRef.current += 1;
      if (editorFocusTimerRef.current) clearTimeout(editorFocusTimerRef.current);
      if (presetScrollRetryTimerRef.current) clearTimeout(presetScrollRetryTimerRef.current);
    };
  }, [closeOpenSwipeable]);

  useEffect(() => {
    mutationPendingRef.current = false;
    setIsSaving(false);
    setExpandedPresetId(null);
    setNewDraft(null);
    setCatalogQuery('');
    setExpandedFolderPath([]);
    setFolderPickerOpen(false);
    setFolderEditMode(false);
    setFolderParentId(null);
    setMovingFolderId(null);
    setRenamingFolderId(null);
    setFolderNameDraft('');
    setNewFolderName('');
    setDeleteConfirmFolderId(null);
    setErrorMessage(null);
    pickerInvocationRef.current = null;
    pickerFocusGenerationRef.current += 1;
    if (pickerFocusTimerRef.current) clearTimeout(pickerFocusTimerRef.current);
    editorFocusGenerationRef.current += 1;
    if (editorFocusTimerRef.current) clearTimeout(editorFocusTimerRef.current);
    if (presetScrollRetryTimerRef.current) clearTimeout(presetScrollRetryTimerRef.current);
  }, [authenticated]);

  useEffect(() => {
    closeOpenSwipeable();
  }, [closeOpenSwipeable, presets, isSaving]);

  useEffect(() => {
    if (typeof expandedPresetId !== 'number') return;
    const index = visiblePresets.findIndex(({ id }) => id === expandedPresetId);
    if (index < 0) return;
    const generation = ++editorFocusGenerationRef.current;
    presetListRef.current?.scrollToIndex({ animated: true, index, viewPosition: 0.1 });
    if (editorFocusTimerRef.current) clearTimeout(editorFocusTimerRef.current);
    editorFocusTimerRef.current = setTimeout(() => {
      editorFocusTimerRef.current = null;
      if (!mountedRef.current || editorFocusGenerationRef.current !== generation) return;
      const handle = findNodeHandle(presetEditorNameInputRef.current);
      if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
    }, 100);
  }, [expandedPresetId, visiblePresets]);

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

  function openPresetFolderPicker() {
    pickerFocusGenerationRef.current += 1;
    if (pickerFocusTimerRef.current) clearTimeout(pickerFocusTimerRef.current);
    pickerInvocationRef.current = { kind: 'preset', handle: findNodeHandle(presetFolderTriggerRef.current) };
    setFolderPickerOpen(true);
  }

  function openFolderMovePicker(folderId: number) {
    pickerFocusGenerationRef.current += 1;
    if (pickerFocusTimerRef.current) clearTimeout(pickerFocusTimerRef.current);
    pickerInvocationRef.current = {
      kind: 'folder',
      folderId,
      handle: findNodeHandle(folderMoveTriggerRefs.current.get(folderId) ?? null),
    };
    setMovingFolderId(folderId);
  }

  function restorePickerFocusAfterClose() {
    const generation = ++pickerFocusGenerationRef.current;
    if (pickerFocusTimerRef.current) clearTimeout(pickerFocusTimerRef.current);
    pickerFocusTimerRef.current = setTimeout(() => {
      pickerFocusTimerRef.current = null;
      if (!mountedRef.current || pickerVisibleRef.current || pickerFocusGenerationRef.current !== generation) return;
      const invocation = pickerInvocationRef.current;
      if (!invocation || invocation.handle == null) return;
      const liveNode = invocation.kind === 'preset'
        ? presetFolderTriggerRef.current
        : folderMoveTriggerRefs.current.get(invocation.folderId) ?? null;
      const liveHandle = findNodeHandle(liveNode);
      if (liveHandle == null || liveHandle !== invocation.handle) return;
      AccessibilityInfo.setAccessibilityFocus(liveHandle);
      if (pickerInvocationRef.current === invocation) pickerInvocationRef.current = null;
    }, 250);
  }

  function closePresetFolderPicker() {
    setFolderPickerOpen(false);
    restorePickerFocusAfterClose();
  }

  function closeFolderMovePicker() {
    setMovingFolderId(null);
    restorePickerFocusAfterClose();
  }

  async function savePreset() {
    if (!authenticated || mutationPendingRef.current) return;
    const accountGeneration = accountGenerationRef.current;
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
        if (!isCurrentAccountGeneration(accountGeneration)) return;
        setPresets((current) => {
          let siblingOrder = 0;
          return [created, ...current].map((preset) => preset.folderId === created.folderId
            ? { ...preset, displayOrder: siblingOrder++ }
            : preset);
        });
        setNewDraft(null);
        setExpandedPresetId(null);
      } else if (typeof expandedPresetId === 'number') {
        const updated = await onUpdatePartyPreset(expandedPresetId, request);
        if (!isCurrentAccountGeneration(accountGeneration)) return;
        setPresets((current) => current.map((preset) => preset.id === updated.id ? updated : preset));
        setExpandedPresetId(null);
      }
    } catch (error) {
      if (isCurrentAccountGeneration(accountGeneration)) setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      if (isCurrentAccountGeneration(accountGeneration)) {
        mutationPendingRef.current = false;
        setIsSaving(false);
      }
    }
  }

  function discardNewPreset() {
    if (mutationPendingRef.current) return;
    setNewDraft(null);
    setExpandedPresetId(null);
  }

  async function deletePresetById(presetId: number) {
    if (!authenticated || mutationPendingRef.current) return;
    const accountGeneration = accountGenerationRef.current;
    closeOpenSwipeable();
    mutationPendingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await onDeletePartyPreset(presetId);
      if (!isCurrentAccountGeneration(accountGeneration)) return;
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
    } catch (error) {
      if (isCurrentAccountGeneration(accountGeneration)) setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      if (isCurrentAccountGeneration(accountGeneration)) {
        mutationPendingRef.current = false;
        setIsSaving(false);
      }
    }
  }

  async function makePrimary(presetId: number) {
    if (!authenticated || mutationPendingRef.current) return;
    const accountGeneration = accountGenerationRef.current;
    const target = presetsRef.current.find(({ id }) => id === presetId);
    if (target?.isPrimary) return;
    mutationPendingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const updated = await onMakePartyPresetPrimary(presetId);
      if (!isCurrentAccountGeneration(accountGeneration)) return;
      setPresets((current) => current.map((preset) => (
        preset.id === updated.id
          ? { ...updated, isPrimary: true }
          : { ...preset, isPrimary: false }
      )));
    } catch (error) {
      if (isCurrentAccountGeneration(accountGeneration)) setErrorMessage(toUserFacingErrorMessage(error));
    } finally {
      if (isCurrentAccountGeneration(accountGeneration)) {
        mutationPendingRef.current = false;
        setIsSaving(false);
      }
    }
  }

  async function reorderPresets(orderedPresets: PartyPresetResponse[], previous: PartyPresetResponse[]) {
    if (!authenticated || mutationPendingRef.current) return;
    const accountGeneration = accountGenerationRef.current;
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
      if (isCurrentAccountGeneration(accountGeneration)) {
        const savedById = new Map(saved.map((preset) => [preset.id, preset]));
        setPresets((current) => current.map((preset) => savedById.get(preset.id) ?? preset));
      }
    } catch (error) {
      if (isCurrentAccountGeneration(accountGeneration)) {
        setPresets(previousCatalog);
        setErrorMessage(toUserFacingErrorMessage(error));
        try {
          partyPresetCatalog.retry();
        } catch {
          // Keep the captured pre-drag order when authoritative recovery is unavailable.
        }
      }
    } finally {
      if (isCurrentAccountGeneration(accountGeneration)) {
        mutationPendingRef.current = false;
        setIsSaving(false);
      }
    }
  }

  function replaceCatalog(catalog: PartyPresetCatalogResponse) {
    setFolders(catalog.folders);
    setPresets(catalog.presets);
  }

  async function mutateFolder(operation: () => Promise<PartyPresetCatalogResponse>): Promise<boolean> {
    if (!authenticated || mutationPendingRef.current) return false;
    const accountGeneration = accountGenerationRef.current;
    mutationPendingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const catalog = await operation();
      if (!isCurrentAccountGeneration(accountGeneration)) return false;
      replaceCatalog(catalog);
      return true;
    } catch (error) {
      if (isCurrentAccountGeneration(accountGeneration)) setErrorMessage(toUserFacingErrorMessage(error));
      return false;
    } finally {
      if (isCurrentAccountGeneration(accountGeneration)) {
        mutationPendingRef.current = false;
        setIsSaving(false);
      }
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
      closeFolderMovePicker();
      return;
    }
    const displayOrder = catalogIndex.childFolderIdsByParent.get(parentFolderId)?.length ?? 0;
    const succeeded = await mutateFolder(() => onMovePartyPresetFolder(folderId, { parentFolderId, displayOrder }));
    if (succeeded && mountedRef.current) closeFolderMovePicker();
  }

  async function reorderFolders(ordered: PartyPresetFolderResponse[], previous: PartyPresetFolderResponse[]) {
    if (!authenticated || !onReorderPartyPresetFolders || mutationPendingRef.current) return;
    const accountGeneration = accountGenerationRef.current;
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
      if (isCurrentAccountGeneration(accountGeneration)) replaceCatalog(catalog);
    } catch (error) {
      if (isCurrentAccountGeneration(accountGeneration)) {
        setFolders((current) => current.map((folder) => previous.find(({ id }) => id === folder.id) ?? folder));
        setErrorMessage(toUserFacingErrorMessage(error));
        partyPresetCatalog.retry();
      }
    } finally {
      if (isCurrentAccountGeneration(accountGeneration)) {
        mutationPendingRef.current = false;
        setIsSaving(false);
      }
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

  const folderRowActionsRef = useRef({
    editableFolders,
    openChild: setFolderParentId,
    openMove: openFolderMovePicker,
    reorder: reorderFolders,
    requestDelete: setDeleteConfirmFolderId,
    cancelDelete: () => setDeleteConfirmFolderId(null),
    confirmDelete: deleteFolder,
    beginRename: (folderId: number, name: string) => {
      setRenamingFolderId(folderId);
      setFolderNameDraft(name);
    },
    saveRename: renameFolder,
  });
  folderRowActionsRef.current = {
    editableFolders,
    openChild: setFolderParentId,
    openMove: openFolderMovePicker,
    reorder: reorderFolders,
    requestDelete: setDeleteConfirmFolderId,
    cancelDelete: () => setDeleteConfirmFolderId(null),
    confirmDelete: deleteFolder,
    beginRename: (folderId, name) => {
      setRenamingFolderId(folderId);
      setFolderNameDraft(name);
    },
    saveRename: renameFolder,
  };
  const dispatchFolderMoveBy = useCallback((folderId: number, offset: -1 | 1) => {
    const { editableFolders: current, reorder } = folderRowActionsRef.current;
    const from = current.findIndex(({ id }) => id === folderId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= current.length) return;
    const ordered = [...current];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved!);
    void reorder(ordered, current);
  }, []);
  const dispatchFolderOpenChild = useCallback((folderId: number) => folderRowActionsRef.current.openChild(folderId), []);
  const dispatchFolderBeginRename = useCallback((folderId: number, name: string) => folderRowActionsRef.current.beginRename(folderId, name), []);
  const dispatchFolderSaveRename = useCallback((folderId: number) => void folderRowActionsRef.current.saveRename(folderId), []);
  const dispatchFolderOpenMove = useCallback((folderId: number) => folderRowActionsRef.current.openMove(folderId), []);
  const dispatchFolderRequestDelete = useCallback((folderId: number) => folderRowActionsRef.current.requestDelete(folderId), []);
  const dispatchFolderCancelDelete = useCallback(() => folderRowActionsRef.current.cancelDelete(), []);
  const dispatchFolderConfirmDelete = useCallback((folderId: number) => void folderRowActionsRef.current.confirmDelete(folderId), []);
  const registerFolderMoveTrigger = useCallback((folderId: number, node: ElementRef<typeof Pressable> | null) => {
    if (node) folderMoveTriggerRefs.current.set(folderId, node);
    else folderMoveTriggerRefs.current.delete(folderId);
  }, []);
  const presetRowActionsRef = useRef({
    deletePreset: deletePresetById,
    makePrimary,
    movePreset,
    openPreset: (presetId: number) => {
      const preset = presetsRef.current.find(({ id }) => id === presetId);
      if (preset) openPreset(preset);
    },
  });
  presetRowActionsRef.current = {
    deletePreset: deletePresetById,
    makePrimary,
    movePreset,
    openPreset: (presetId) => {
      const preset = presetsRef.current.find(({ id }) => id === presetId);
      if (preset) openPreset(preset);
    },
  };
  const dispatchPresetDelete = useCallback((presetId: number) => void presetRowActionsRef.current.deletePreset(presetId), []);
  const dispatchPresetPrimary = useCallback((presetId: number) => void presetRowActionsRef.current.makePrimary(presetId), []);
  const dispatchPresetMove = useCallback((presetId: number, offset: -1 | 1) => presetRowActionsRef.current.movePreset(presetId, offset), []);
  const dispatchPresetOpen = useCallback((presetId: number) => presetRowActionsRef.current.openPreset(presetId), []);
  const registerSwipeable = useCallback((presetId: number, node: SwipeableMethods | null) => {
    if (node) swipeableNodesRef.current.set(presetId, node);
    else swipeableNodesRef.current.delete(presetId);
  }, []);
  const prepareSwipeable = useCallback((presetId: number) => {
    const next = swipeableNodesRef.current.get(presetId) ?? null;
    if (openSwipeableRef.current && openSwipeableRef.current !== next) openSwipeableRef.current.close();
    openSwipeableRef.current = next;
  }, []);
  const beginPresetDrag = useCallback((presetId: number) => {
    closeOpenSwipeable();
    setIsDragging(true);
    presetDragRefs.current.get(presetId)?.();
  }, [closeOpenSwipeable]);
  const beginFolderDrag = useCallback((folderId: number) => folderDragRefs.current.get(folderId)?.(), []);

  function renderPreset({ item: preset, drag, getIndex, isActive }: RenderItemParams<PartyPresetResponse>) {
    presetDragRefs.current.set(preset.id, drag);
    const index = getIndex() ?? visiblePresetsRef.current.findIndex(({ id }) => id === preset.id);
    const expanded = expandedPresetId === preset.id;
    const interactionDisabled = isSaving || isDragging || isActive;
    return (
      <PartyPresetManagedRow
        count={visiblePresets.length}
        disabled={interactionDisabled}
        editor={expanded ? renderEditor({
            activeSlotIndex,
            characters,
            draftName,
            draftParty,
            folderPath: getPartyPresetFolderPath(catalogIndex, draftFolderId),
            isSaving,
            onActiveSlotChange: setActiveSlotIndex,
            onDelete: () => dispatchPresetDelete(preset.id),
            onNameChange: setDraftName,
            onPartyChange: setDraftParty,
            folderTriggerRef: presetFolderTriggerRef,
            nameInputRef: presetEditorNameInputRef,
            onOpenFolderPicker: openPresetFolderPicker,
            onSave: savePreset,
          }) : null}
        expanded={expanded}
        index={index}
        isPrimary={preset.isPrimary}
        name={preset.name}
        onBeginDrag={beginPresetDrag}
        onDelete={dispatchPresetDelete}
        onMakePrimary={dispatchPresetPrimary}
        onMove={dispatchPresetMove}
        onOpen={dispatchPresetOpen}
        onRegisterSwipeable={registerSwipeable}
        onSwipeableWillOpen={prepareSwipeable}
        presetId={preset.id}
        summary={formatPartyPresetSummary(preset)}
      />
    );
  }

  function renderFolder({ item: folder, drag, getIndex, isActive }: RenderItemParams<PartyPresetFolderResponse>) {
    folderDragRefs.current.set(folder.id, drag);
    const index = getIndex() ?? editableFolders.findIndex(({ id }) => id === folder.id);
    const interactionDisabled = isSaving || isDragging || isActive;
    return (
      <PartyPresetFolderManagerRow
        count={editableFolders.length}
        deleteConfirmation={deleteConfirmFolderId === folder.id}
        disabled={interactionDisabled}
        folderId={folder.id}
        index={index}
        name={folder.name}
        onBeginRename={dispatchFolderBeginRename}
        onBeginDrag={beginFolderDrag}
        onCancelDelete={dispatchFolderCancelDelete}
        onConfirmDelete={dispatchFolderConfirmDelete}
        onMoveBy={dispatchFolderMoveBy}
        onNameChange={setFolderNameDraft}
        onOpenChild={dispatchFolderOpenChild}
        onOpenMove={dispatchFolderOpenMove}
        onRegisterMoveTrigger={registerFolderMoveTrigger}
        onRequestDelete={dispatchFolderRequestDelete}
        onSaveRename={dispatchFolderSaveRename}
        renameValue={renamingFolderId === folder.id ? folderNameDraft : null}
      />
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
            folderTriggerRef: presetFolderTriggerRef,
            nameInputRef: presetEditorNameInputRef,
            onOpenFolderPicker: openPresetFolderPicker,
            onSave: savePreset,
          }) : null}
        </PresetCard>
      ) : null}
      {folderPickerOpen ? (
        <PartyPresetFolderPicker
          index={catalogIndex}
          onCancel={closePresetFolderPicker}
          onConfirm={(folderId) => {
            if (expandedPresetId === 'new') {
              setNewDraft((current) => current ? { ...current, folderId } : current);
            } else {
              setDraftFolderId(folderId);
            }
            closePresetFolderPicker();
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

      {errorMessage ?? partyPresetCatalog.error ? <Text style={styles.errorText}>{errorMessage ?? partyPresetCatalog.error}</Text> : null}
      {partyPresetCatalog.loading ? (
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
              onCancel={closeFolderMovePicker}
              onConfirm={(parentFolderId) => void moveFolder(movingFolderId, parentFolderId)}
              selectedFolderId={catalogIndex.foldersById.get(movingFolderId)?.parentFolderId ?? null}
            />
          ) : null}
        </View>
      ) : expandedPresetId == null && newDraft == null ? (
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
          ref={presetListRef}
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
          onScrollToIndexFailed={({ averageItemLength, index }) => {
            const generation = editorFocusGenerationRef.current;
            presetListRef.current?.scrollToOffset({ animated: true, offset: Math.max(0, averageItemLength * index) });
            if (presetScrollRetryTimerRef.current) clearTimeout(presetScrollRetryTimerRef.current);
            presetScrollRetryTimerRef.current = setTimeout(() => {
              presetScrollRetryTimerRef.current = null;
              if (!mountedRef.current || editorFocusGenerationRef.current !== generation) return;
              presetListRef.current?.scrollToIndex({ animated: true, index, viewPosition: 0.1 });
            }, 50);
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

type PartyPresetManagedRowProps = {
  count: number;
  disabled: boolean;
  editor: ReactNode;
  expanded: boolean;
  index: number;
  isPrimary: boolean;
  name: string;
  presetId: number;
  summary: string;
  onBeginDrag: (presetId: number) => void;
  onDelete: (presetId: number) => void;
  onMakePrimary: (presetId: number) => void;
  onMove: (presetId: number, offset: -1 | 1) => void;
  onOpen: (presetId: number) => void;
  onRegisterSwipeable: (presetId: number, node: SwipeableMethods | null) => void;
  onSwipeableWillOpen: (presetId: number) => void;
};

const PartyPresetManagedRow = memo(function PartyPresetManagedRow({
  count,
  disabled,
  editor,
  expanded,
  index,
  isPrimary,
  name,
  presetId,
  summary,
  onBeginDrag,
  onDelete,
  onMakePrimary,
  onMove,
  onOpen,
  onRegisterSwipeable,
  onSwipeableWillOpen,
}: PartyPresetManagedRowProps) {
  const register = useCallback((node: SwipeableMethods | null) => onRegisterSwipeable(presetId, node), [onRegisterSwipeable, presetId]);
  const prepareSwipe = useCallback(() => onSwipeableWillOpen(presetId), [onSwipeableWillOpen, presetId]);
  const deletePreset = useCallback(() => onDelete(presetId), [onDelete, presetId]);
  const makePrimaryPreset = useCallback(() => onMakePrimary(presetId), [onMakePrimary, presetId]);
  const open = useCallback(() => onOpen(presetId), [onOpen, presetId]);
  const beginDrag = useCallback(() => onBeginDrag(presetId), [onBeginDrag, presetId]);
  const moveUp = useCallback(() => onMove(presetId, -1), [onMove, presetId]);
  const moveDown = useCallback(() => onMove(presetId, 1), [onMove, presetId]);
  const renderRightActions = useCallback(() => (
    <Pressable accessibilityLabel={`${name} 삭제`} accessibilityRole="button" disabled={disabled} onPress={deletePreset} style={({ pressed }) => [styles.swipeDeleteAction, pressed && styles.pressed]}>
      <Trash2 color={theme.colors.buttonText} size={18} />
      <Text style={styles.swipeDeleteText}>삭제</Text>
    </Pressable>
  ), [deletePreset, disabled, name]);
  const renderHandle = useCallback(() => (
    <Pressable
      accessibilityActions={[
        ...(index > 0 ? [{ name: 'decrement' as const, label: '위로 이동' }] : []),
        ...(index < count - 1 ? [{ name: 'increment' as const, label: '아래로 이동' }] : []),
        { name: 'delete' as const, label: '삭제' },
      ]}
      accessibilityHint="길게 누르거나 접근성 동작으로 순서를 바꾸세요"
      accessibilityLabel={`${name} ${index + 1}번째 프리셋 순서 이동`}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      accessibilityValue={{ min: 1, max: count, now: index + 1 }}
      delayLongPress={120}
      disabled={disabled}
      onAccessibilityAction={({ nativeEvent: { actionName } }) => {
        if (actionName === 'decrement') moveUp();
        if (actionName === 'increment') moveDown();
        if (actionName === 'delete') deletePreset();
      }}
      onLongPress={beginDrag}
      style={({ pressed }) => [styles.dragHandle, pressed && styles.pressed]}
    >
      <GripVertical color={theme.colors.textMuted} size={18} />
    </Pressable>
  ), [beginDrag, count, deletePreset, disabled, index, moveDown, moveUp, name]);
  return (
    <ReanimatedSwipeable
      testID={`party-preset-managed-row-${presetId}`}
      ref={register}
      containerStyle={styles.swipeContainer}
      enabled={!disabled}
      friction={2}
      onSwipeableWillOpen={prepareSwipe}
      overshootRight={false}
      renderRightActions={renderRightActions}
      rightThreshold={40}
    >
      <PresetCard expanded={expanded} isPrimary={isPrimary} name={name} onMakePrimary={makePrimaryPreset} onPress={open} renderHandle={renderHandle} summary={summary}>
        {editor}
      </PresetCard>
    </ReanimatedSwipeable>
  );
});

type PartyPresetFolderManagerRowProps = {
  count: number;
  deleteConfirmation: boolean;
  disabled: boolean;
  folderId: number;
  index: number;
  name: string;
  renameValue: string | null;
  onBeginDrag: (folderId: number) => void;
  onBeginRename: (folderId: number, name: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (folderId: number) => void;
  onMoveBy: (folderId: number, offset: -1 | 1) => void;
  onNameChange: (name: string) => void;
  onOpenChild: (folderId: number) => void;
  onOpenMove: (folderId: number) => void;
  onRegisterMoveTrigger: (folderId: number, node: ElementRef<typeof Pressable> | null) => void;
  onRequestDelete: (folderId: number) => void;
  onSaveRename: (folderId: number) => void;
};

const PartyPresetFolderManagerRow = memo(function PartyPresetFolderManagerRow({
  count,
  deleteConfirmation,
  disabled,
  folderId,
  index,
  name,
  renameValue,
  onBeginDrag,
  onBeginRename,
  onCancelDelete,
  onConfirmDelete,
  onMoveBy,
  onNameChange,
  onOpenChild,
  onOpenMove,
  onRegisterMoveTrigger,
  onRequestDelete,
  onSaveRename,
}: PartyPresetFolderManagerRowProps) {
  const moveUp = useCallback(() => onMoveBy(folderId, -1), [folderId, onMoveBy]);
  const moveDown = useCallback(() => onMoveBy(folderId, 1), [folderId, onMoveBy]);
  const openChild = useCallback(() => onOpenChild(folderId), [folderId, onOpenChild]);
  const toggleRename = useCallback(() => {
    if (renameValue != null) onSaveRename(folderId);
    else onBeginRename(folderId, name);
  }, [folderId, name, onBeginRename, onSaveRename, renameValue]);
  const openMove = useCallback(() => onOpenMove(folderId), [folderId, onOpenMove]);
  const registerMove = useCallback((node: ElementRef<typeof Pressable> | null) => onRegisterMoveTrigger(folderId, node), [folderId, onRegisterMoveTrigger]);
  const requestDelete = useCallback(() => onRequestDelete(folderId), [folderId, onRequestDelete]);
  const confirmDelete = useCallback(() => onConfirmDelete(folderId), [folderId, onConfirmDelete]);
  const beginDrag = useCallback(() => onBeginDrag(folderId), [folderId, onBeginDrag]);
  return (
    <View style={styles.folderEditItem} testID={`party-preset-folder-manager-row-${folderId}`}>
      <View style={styles.folderEditRow}>
        <Pressable
          accessibilityActions={[
            ...(index > 0 ? [{ name: 'decrement' as const, label: '위로 이동' }] : []),
            ...(index < count - 1 ? [{ name: 'increment' as const, label: '아래로 이동' }] : []),
          ]}
          accessibilityHint="길게 누르거나 접근성 동작으로 같은 부모의 폴더 순서를 바꾸세요"
          accessibilityLabel={`${name} ${index + 1}번째 폴더 순서 이동`}
          accessibilityRole="adjustable"
          accessibilityState={{ disabled }}
          accessibilityValue={{ min: 1, max: count, now: index + 1 }}
          delayLongPress={120}
          disabled={disabled}
          onAccessibilityAction={({ nativeEvent: { actionName } }) => {
            if (actionName === 'decrement') moveUp();
            if (actionName === 'increment') moveDown();
          }}
          onLongPress={beginDrag}
          style={styles.folderDragHandle}
        >
          <GripVertical color={theme.colors.textMuted} size={18} />
        </Pressable>
        {renameValue != null ? (
          <TextInput accessibilityLabel={`${name} 폴더 이름`} autoFocus onChangeText={onNameChange} style={[styles.nameInput, styles.folderNameInput]} value={renameValue} />
        ) : (
          <Pressable accessibilityLabel={`${name} 하위 폴더 열기`} accessibilityRole="button" onPress={openChild} style={styles.folderNameButton}>
            <Text numberOfLines={1} style={styles.folderNameText}>{name}</Text>
          </Pressable>
        )}
        <Pressable accessibilityLabel={renameValue != null ? `${name} 폴더 이름 저장` : `${name} 폴더 이름 변경`} accessibilityRole="button" disabled={disabled} onPress={toggleRename} style={styles.folderIconButton}>
          {renameValue != null ? <Save color={theme.colors.accentGreen} size={17} /> : <Pencil color={theme.colors.textMuted} size={17} />}
        </Pressable>
        <Pressable ref={registerMove} accessibilityLabel={`${name} 폴더 이동`} accessibilityRole="button" disabled={disabled} onPress={openMove} style={styles.folderIconButton}>
          <FolderCog color={theme.colors.textMuted} size={17} />
        </Pressable>
        <Pressable accessibilityLabel={`${name} 폴더 삭제`} accessibilityRole="button" disabled={disabled} onPress={requestDelete} style={styles.folderIconButton}>
          <Trash2 color={theme.colors.danger} size={17} />
        </Pressable>
      </View>
      {deleteConfirmation ? (
        <View accessibilityLiveRegion="polite" style={styles.folderDeleteConfirmation}>
          <View style={styles.folderDeleteCopy}>
            <Text style={styles.folderDeleteTitle}>{name} 폴더를 삭제할까요?</Text>
            <Text style={styles.folderDeleteMessage}>직접 프리셋은 미지정으로 이동하고, 바로 아래 폴더는 상위로 승격되며 그 프리셋은 그대로 유지됩니다.</Text>
          </View>
          <Pressable accessibilityLabel={`${name} 폴더 삭제 취소`} accessibilityRole="button" disabled={disabled} onPress={onCancelDelete} style={styles.folderConfirmButton}>
            <Text style={styles.folderCancelText}>취소</Text>
          </Pressable>
          <Pressable accessibilityLabel={`${name} 폴더 삭제 확인`} accessibilityRole="button" disabled={disabled} onPress={confirmDelete} style={[styles.folderConfirmButton, styles.folderDeleteButton]}>
            <Text style={styles.folderDeleteButtonText}>삭제</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

const PresetCard = memo(function PresetCard({
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
});

function renderEditor({
  activeSlotIndex,
  characters,
  draftName,
  draftParty,
  folderTriggerRef,
  nameInputRef,
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
  folderTriggerRef: Ref<ElementRef<typeof Pressable>>;
  nameInputRef: Ref<ElementRef<typeof TextInput>>;
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
        ref={nameInputRef}
        accessibilityLabel="프리셋 이름 입력"
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
        ref={folderTriggerRef}
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
