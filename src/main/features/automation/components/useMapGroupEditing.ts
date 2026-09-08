import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import {
  buildBattleMapAutomationDraft, buildBattleMapAutomationRequest, validateBattleMapAutomationDraft,
  type BattleMapAutomationDraft,
} from '../../../domain/battleMapAutomation';
import {
  buildAdventureMapAutomationDraft, buildAdventureMapAutomationRequest, validateAdventureMapAutomationDraft,
  type AdventureMapAutomationDraft,
} from '../../../domain/adventureMapAutomation';
import type {
  BattleMapResponse, TypedAutomationEntryResponse,
  UpdateAdventureMapAutomationRequest, UpdateBattleMapAutomationRequest,
} from '../../../types/api';

type NamedRequest<R> = R & { displayName?: string | null };
type EditingProps<R> = {
  entry: TypedAutomationEntryResponse;
  catalog: BattleMapResponse[];
  loading: boolean;
  saving: boolean;
  validPresetIds: number[];
  presetsVerified: boolean;
  onSave: (request: NamedRequest<R>) => Promise<boolean>;
  onBack: () => void;
  onClearMutationMessage: () => void;
};
type MapDraft = { maps: { presetMode: string }[] };
// 두 실제 편집 유형의 설정 형식만 다르며, 저장·기준점·이탈 순서는 아래 hook이 소유한다.
type EditingFormat<D, R> = {
  build: (entry: TypedAutomationEntryResponse, catalog: BattleMapResponse[]) => D;
  request: (draft: D, validPresetIds: number[]) => R;
  validate: (draft: D, validPresetIds: number[], options: { validatePresetMembership: boolean }) => string[];
  serialize: (draft: D) => string;
  source: (entry: TypedAutomationEntryResponse) => string;
  exitMessage: string;
  refreshProgress?: (current: D, server: D) => D;
};

function validateGroup<D extends MapDraft, R>(
  current: { draft: D; groupName: string }, props: EditingProps<R>, format: EditingFormat<D, R>,
) {
  const validationErrors = format.validate(current.draft, props.validPresetIds, {
    validatePresetMembership: props.presetsVerified,
  });
  const nameInvalid = current.groupName.trim().length > 100;
  const invalid = validationErrors.length > 0 || nameInvalid
    || (current.draft.maps.some(({ presetMode }) => presetMode === 'EXPLICIT') && !props.presetsVerified);
  return { validationErrors, nameInvalid, invalid };
}

const battleFormat: EditingFormat<BattleMapAutomationDraft, UpdateBattleMapAutomationRequest> = {
  build: buildBattleMapAutomationDraft,
  request: buildBattleMapAutomationRequest,
  validate: validateBattleMapAutomationDraft,
  serialize: (draft) => JSON.stringify([
    draft.enabled, draft.minimumRemainingTime,
    draft.maps.map(({ categoryId, mapCode, dailyTargetCount, executionOrder, presetMode, partyPresetId }) => (
      [categoryId, mapCode, String(dailyTargetCount), executionOrder, presetMode, partyPresetId]
    )),
  ]),
  source: (entry) => JSON.stringify([entry.enabled, entry.battleMaps, entry.displayName, entry.minimumRemainingTime ?? null]),
  exitMessage: '저장하지 않은 전투 맵 설정이 있습니다.',
  refreshProgress: (current, server) => ({ ...current, dailyProgress: server.dailyProgress }),
};
const adventureFormat: EditingFormat<AdventureMapAutomationDraft, UpdateAdventureMapAutomationRequest> = {
  build: buildAdventureMapAutomationDraft,
  request: buildAdventureMapAutomationRequest,
  validate: validateAdventureMapAutomationDraft,
  serialize: (draft) => JSON.stringify([
    draft.enabled,
    draft.maps.map(({ categoryId, mapCode, presetMode, partyPresetId, executionOrder }) => (
      [categoryId, mapCode, presetMode, partyPresetId, executionOrder]
    )),
  ]),
  source: (entry) => JSON.stringify([entry.enabled, entry.adventureMaps, entry.displayName]),
  exitMessage: '저장하지 않은 모험맵 설정이 있습니다.',
};

export function useBattleMapGroupEditing(props: EditingProps<UpdateBattleMapAutomationRequest>) {
  return useMapGroupEditing(props, battleFormat);
}
export function useAdventureMapGroupEditing(props: EditingProps<UpdateAdventureMapAutomationRequest>) {
  return useMapGroupEditing(props, adventureFormat);
}

function useMapGroupEditing<D extends MapDraft, R extends object>(props: EditingProps<R>, format: EditingFormat<D, R>) {
  const [state, setState] = useState(() => {
    const draft = format.build(props.entry, []);
    const groupName = props.entry.displayName ?? '';
    return { draft, groupName, baseline: format.serialize(draft), baselineName: groupName,
      source: format.source(props.entry), serverRefreshWarning: false };
  });
  const stateRef = useRef(state);
  const propsRef = useRef(props);
  propsRef.current = props;
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const pendingRef = useRef(false);
  const [localBusy, setLocalBusy] = useState(false);
  const update = useCallback((next: typeof state) => {
    if (!mountedRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);
  const isBusy = useCallback(() => !mountedRef.current || pendingRef.current || propsRef.current.saving, []);
  const isEditingDisabled = useCallback(() => isBusy() || propsRef.current.loading, [isBusy]);
  const getDraft = useCallback(() => stateRef.current.draft, []);
  const updateDraft = useCallback((updater: (current: D) => D) => {
    const current = stateRef.current;
    update({ ...current, draft: updater(current.draft) });
  }, [update]);
  const updateEditableDraft = useCallback((updater: (current: D) => D) => {
    if (!isEditingDisabled()) updateDraft(updater);
  }, [isEditingDisabled, updateDraft]);
  const setGroupName = useCallback((groupName: string) => {
    if (!isEditingDisabled()) update({ ...stateRef.current, groupName });
  }, [isEditingDisabled, update]);
  const isDirty = useCallback(() => {
    const current = stateRef.current;
    return format.serialize(current.draft) !== current.baseline || current.groupName !== current.baselineName;
  }, [format]);
  const dirty = isDirty();

  useEffect(() => {
    const current = stateRef.current;
    const source = format.source(props.entry);
    const changed = source !== current.source;
    if (!format.refreshProgress && (!changed || isDirty())) return;
    const server = format.build(props.entry, props.catalog);
    if (changed && !isDirty()) {
      const groupName = props.entry.displayName ?? '';
      update({ draft: server, groupName, baseline: format.serialize(server), baselineName: groupName,
        source, serverRefreshWarning: false });
    } else if (format.refreshProgress) {
      // 전투맵은 편집을 보존하며 진행량을 반영하고 경고한다. 모험맵은 깨끗해질 때까지 서버 설정을 기다린다.
      update({ ...current, source, draft: format.refreshProgress(current.draft, server),
        serverRefreshWarning: current.serverRefreshWarning || changed });
    }
  }, [props.entry, props.catalog, state.groupName, dirty, format, isDirty, update]);

  const { validationErrors, nameInvalid, invalid } = validateGroup(state, props, format);
  const busy = props.saving || localBusy;
  const controlsDisabled = busy || props.loading;
  const saveDisabled = controlsDisabled || invalid;

  const runMutation = useCallback(async (operation: () => Promise<unknown>) => {
    if (isEditingDisabled()) return;
    const generation = generationRef.current;
    pendingRef.current = true;
    setLocalBusy(true);
    try {
      propsRef.current.onClearMutationMessage();
      await operation();
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        pendingRef.current = false;
        setLocalBusy(false);
      }
    }
  }, [isEditingDisabled]);

  const save = useCallback(async () => {
    const current = stateRef.current;
    const latest = propsRef.current;
    const name = current.groupName.trim();
    if (validateGroup(current, latest, format).invalid) return;
    await runMutation(async () => {
      const generation = generationRef.current;
      const baseline = format.serialize(current.draft);
      const request = format.request(current.draft, latest.validPresetIds);
      const payload = latest.entry.settingsRevision == null && name.length === 0
        ? request : { ...request, displayName: name || null };
      if (await latest.onSave(payload) && mountedRef.current && generation === generationRef.current) {
        update({ ...stateRef.current, baseline, baselineName: name });
      }
    });
  }, [format, runMutation, update]);
  const requestBack = useCallback(() => {
    if (isBusy()) return;
    if (!isDirty()) return propsRef.current.onBack();
    Alert.alert('변경 사항을 버릴까요?', format.exitMessage, [
      { text: '계속 편집', style: 'cancel' },
      { text: '나가기', style: 'destructive', onPress: () => {
        if (!isBusy()) propsRef.current.onBack();
      } },
    ]);
  }, [format, isBusy, isDirty]);

  return { draft: state.draft, groupName: state.groupName, serverRefreshWarning: state.serverRefreshWarning,
    busy, controlsDisabled, saveDisabled, validationErrors, nameInvalid,
    getDraft, updateDraft, updateEditableDraft, setGroupName, isEditingDisabled, runMutation, save, requestBack };
}
