import { toUserFacingErrorMessage } from './userFacingErrors';
import type {
  CharacterCommand,
  CharacterCommandResult,
  CharacterDeepSyncResponse,
  CharacterIdentityCandidate,
  CharacterPatternApplyRequest,
  CharacterPatternSetting,
  CharacterPatternOperationResult,
  CharacterTransferExecutionResult,
  CharacterTransferPreview,
  CharacterTransferPreviewRequest,
  HofCharacter,
  HofCharacterDetail,
  CharacterStat,
} from '../types/api';

const DEFAULT_FRESHNESS_MS = 30 * 60 * 1000;

export type CharacterManagementHubBackend = {
  loadStoredDetail: (characterId: number) => Promise<HofCharacterDetail>;
  refreshAuthoritativeDetail: (characterId: number) => Promise<HofCharacterDetail>;
  executeCommand?: (command: CharacterCommand) => Promise<CharacterCommandResult>;
  applyPattern?: (
    request: CharacterPatternApplyRequest,
  ) => Promise<CharacterPatternOperationResult>;
  loadSavedPattern?: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  deleteSavedPattern?: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  deepSync?: (
    characterId: number,
    onProgress: (progress: CharacterDeepSyncResponse) => void,
  ) => Promise<CharacterDeepSyncResponse>;
  linkCharacter?: (
    characterId: number,
    newHofCharacterId: string,
  ) => Promise<HofCharacter[] | void>;
  archiveCharacter?: (characterId: number) => Promise<HofCharacter[]>;
  restoreCharacter?: (characterId: number) => Promise<HofCharacter[]>;
  deleteCharacterPermanently?: (characterId: number) => Promise<HofCharacter[]>;
  loadRoster?: () => Promise<HofCharacter[]>;
  publishRoster?: (characters: HofCharacter[]) => void;
  publishDetail?: (detail: HofCharacterDetail) => void;
  previewTransfer?: (
    request: CharacterTransferPreviewRequest,
  ) => Promise<CharacterTransferPreview>;
  executeTransfer?: (
    request: CharacterTransferPreviewRequest,
    onProgress: (progress: CharacterTransferExecutionResult) => void,
  ) => Promise<CharacterTransferExecutionResult>;
  reloadRelatedPresets?: () => Promise<void>;
  beginPatternEdit?: () => Promise<void>;
};

export type CharacterManagementHubActions = {
  select: (character: HofCharacter) => Promise<void>;
  openTransfer: (source: HofCharacter, target: HofCharacter) => Promise<void>;
  close: () => void;
  reloadStored: () => Promise<void>;
  refresh: () => Promise<void>;
  dismissPatternConflict: () => void;
  rename?: (newName: string) => Promise<void>;
  kick?: (confirmationName: string) => Promise<void>;
  knockback?: (confirmationName: string) => Promise<void>;
  pray?: () => Promise<void>;
  prepareItems?: () => Promise<void>;
  removeAllEquipment?: () => Promise<void>;
  useItem?: (itemValue: string) => Promise<void>;
  learnSkill?: (skillValue: string) => Promise<void>;
  changeClass?: (classValue: string) => Promise<void>;
  allocateStats?: (
    amounts: Partial<Record<CharacterStat, number>>,
  ) => Promise<void>;
  equipItem?: (itemValue: string) => Promise<void>;
  removeEquipment?: (equipmentPart: string) => Promise<void>;
  saveEquipmentPreset?: (slotNumber: 1 | 2) => Promise<void>;
  loadEquipmentPreset?: (slotNumber: 1 | 2) => Promise<void>;
  savePattern?: (change: CharacterPatternChange) => Promise<void>;
  resolvePatternConflict?: () => Promise<void>;
  loadSavedPattern?: (slotCode: string) => Promise<CharacterPatternOperationResult>;
  deleteSavedPattern?: (slotCode: string) => Promise<CharacterPatternOperationResult>;
  deepSync?: () => Promise<CharacterDeepSyncResponse | void>;
  linkCharacter?: (newHofCharacterId: string) => Promise<void>;
  linkRosterCharacter?: (
    characterId: number,
    newHofCharacterId: string,
  ) => Promise<void>;
  archiveCharacter?: (characterId: number) => Promise<void>;
  restoreCharacter?: (characterId: number) => Promise<void>;
  deleteCharacterPermanently?: (characterId: number) => Promise<void>;
  previewTransfer?: (
    request: CharacterTransferPreviewRequest,
  ) => Promise<CharacterTransferPreview | void>;
  executeTransfer?: () => Promise<CharacterTransferExecutionResult | void>;
  clearTransfer: () => void;
  beginPatternEdit?: () => Promise<void>;
};

export type CharacterManagementDeepSyncState = {
  status: 'idle' | 'running' | 'completed' | 'error';
  progress: CharacterDeepSyncResponse | null;
  errorMessage: string | null;
};

export type CharacterManagementTransferState = {
  status: 'idle' | 'previewing' | 'ready' | 'running' | 'completed' | 'error';
  sourceCharacter: HofCharacter | null;
  targetCharacterId: number | null;
  request: CharacterTransferPreviewRequest | null;
  preview: CharacterTransferPreview | null;
  progress: CharacterTransferExecutionResult | null;
  result: CharacterTransferExecutionResult | null;
  errorMessage: string | null;
};

export type CharacterManagementHubResource = {
  characters: HofCharacter[];
  selectedCharacter: HofCharacter | null;
  detail: HofCharacterDetail | null;
  isLoading: boolean;
  errorMessage: string | null;
  warningMessage: string | null;
  identityResolution: {
    candidates: CharacterIdentityCandidate[];
    message: string;
  } | null;
  patternConflict: CharacterPatternOperationResult | null;
  deepSync: CharacterManagementDeepSyncState;
  transfer: CharacterManagementTransferState;
  actions: CharacterManagementHubActions;
};

type CharacterManagementHubOptions = {
  now?: () => number;
  freshnessMs?: number;
};

export type CharacterPatternChange = {
  base: CharacterPatternSetting;
  draft: CharacterPatternSetting;
  slotAction?: 'NONE' | 'SAVE_EMPTY' | 'REPLACE';
  targetSlotCode?: string;
  slotName?: string;
};

type CharacterManagementCommandIntent =
  | { type: 'RENAME'; newName: string }
  | { type: 'KICK' | 'KNOCKBACK'; confirmationName: string }
  | { type: 'PRAY' | 'PREPARE_ITEMS' | 'REMOVE_ALL_EQUIPMENT' }
  | { type: 'USE_ITEM'; itemValue: string }
  | { type: 'LEARN_SKILL'; skillValue: string }
  | { type: 'CHANGE_CLASS'; classValue: string }
  | {
      type: 'ALLOCATE_STATS';
      amounts: Partial<Record<CharacterStat, number>>;
    }
  | { type: 'EQUIP_ITEM'; itemValue: string }
  | { type: 'REMOVE_EQUIPMENT'; equipmentPart: string }
  | {
      type: 'SAVE_EQUIPMENT_PRESET' | 'LOAD_EQUIPMENT_PRESET';
      slotNumber: 1 | 2;
    };

/**
 * 선택 캐릭터와 저장·권위 상세의 freshness 정책을 하나의 observable 상태로 관리한다.
 *
 * 화면은 요청 세대나 roster lifecycle을 해석하지 않고 이 resource만 소비한다.
 */
export class CharacterManagementHubModule {
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly freshnessMs: number;
  private accountKey: unknown | null = null;
  private generation = 0;
  private selectionGeneration = 0;
  private transferGeneration = 0;
  private requestGeneration = 0;
  private pendingPatternChange: CharacterPatternChange | null = null;
  private roster = new Map<number, HofCharacter>();
  private resource: CharacterManagementHubResource;

  constructor(
    private readonly backend: CharacterManagementHubBackend,
    options: CharacterManagementHubOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.freshnessMs = options.freshnessMs ?? DEFAULT_FRESHNESS_MS;
    this.resource = emptyResource(
      this.actionsFor(
        this.generation,
        this.selectionGeneration,
        this.transferGeneration,
      ),
    );
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): CharacterManagementHubResource => this.resource;

  activate(accountKey: unknown): void {
    if (this.accountKey != null && Object.is(this.accountKey, accountKey)) return;
    this.accountKey = accountKey;
    this.generation += 1;
    this.selectionGeneration += 1;
    this.transferGeneration += 1;
    this.requestGeneration += 1;
    this.pendingPatternChange = null;
    this.roster = new Map();
    this.replace(emptyResource(
      this.actionsFor(
        this.generation,
        this.selectionGeneration,
        this.transferGeneration,
      ),
    ));
  }

  deactivate(): void {
    this.accountKey = null;
    this.generation += 1;
    this.selectionGeneration += 1;
    this.transferGeneration += 1;
    this.requestGeneration += 1;
    this.pendingPatternChange = null;
    this.roster = new Map();
    this.replace(emptyResource(
      this.actionsFor(
        this.generation,
        this.selectionGeneration,
        this.transferGeneration,
      ),
    ));
  }

  observeRoster(characters: HofCharacter[]): void {
    const roster = new Map(characters.map((character) => [character.id, character]));
    const selected = this.resource.selectedCharacter;
    const transferSource = this.resource.transfer.sourceCharacter;
    let transfer = this.resource.transfer;
    let actions = this.resource.actions;
    if (transferSource) {
      const observedSource = roster.get(transferSource.id);
      if (!observedSource) {
        this.transferGeneration += 1;
        transfer = {
          ...idleTransfer(),
          status: 'error',
          errorMessage: '설정 원본 캐릭터를 더 이상 찾을 수 없습니다.',
        };
        actions = this.actionsFor(
          this.generation,
          this.selectionGeneration,
          this.transferGeneration,
        );
      } else if (observedSource !== transferSource) {
        transfer = { ...transfer, sourceCharacter: observedSource };
      }
    }
    if (!selected) {
      this.roster = roster;
      this.replace({ ...this.resource, characters, transfer, actions });
      return;
    }
    const observed = roster.get(selected.id);
    if (!observed || !isActive(observed)) {
      this.selectionGeneration += 1;
      this.transferGeneration += 1;
      this.requestGeneration += 1;
      this.roster = roster;
      this.replace(emptyResource(
        this.actionsFor(
          this.generation,
          this.selectionGeneration,
          this.transferGeneration,
        ),
        characters,
      ));
      return;
    }
    const detail = observed !== selected && this.resource.detail?.id === observed.id
      ? { ...this.resource.detail, ...observed }
      : this.resource.detail;
    this.roster = roster;
    this.replace({
      ...this.resource,
      characters,
      selectedCharacter: observed,
      detail,
      transfer,
      actions,
    });
  }

  private async select(
    candidate: HofCharacter,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
    transferSource?: HofCharacter,
  ): Promise<void> {
    if (!this.isActiveLease(expectedGeneration, expectedSelectionGeneration)) return;
    const selected = this.roster.get(candidate.id);
    if (!selected || !isActive(selected)) return;
    const observedTransferSource = transferSource
      ? this.roster.get(transferSource.id)
      : undefined;
    if (transferSource && !observedTransferSource) return;
    this.selectionGeneration += 1;
    this.transferGeneration += 1;
    this.pendingPatternChange = null;
    const request = ++this.requestGeneration;
    const generation = this.generation;
    const selectionGeneration = this.selectionGeneration;
    this.replace({
      ...this.resource,
      selectedCharacter: selected,
      detail: null,
      isLoading: true,
      errorMessage: null,
      warningMessage: null,
      identityResolution: null,
      patternConflict: null,
      deepSync: idleDeepSync(),
      transfer: observedTransferSource
        ? {
            ...idleTransfer(),
            sourceCharacter: observedTransferSource,
            targetCharacterId: selected.id,
          }
        : idleTransfer(),
      actions: this.actionsFor(
        generation,
        selectionGeneration,
        this.transferGeneration,
      ),
    });
    await this.loadStored(
      selected.id,
      generation,
      selectionGeneration,
      request,
      true,
      selected,
    );
  }

  private close(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): void {
    if (!this.isActiveLease(expectedGeneration, expectedSelectionGeneration)) return;
    this.selectionGeneration += 1;
    this.transferGeneration += 1;
    this.requestGeneration += 1;
    this.pendingPatternChange = null;
    this.replace(emptyResource(
      this.actionsFor(
        this.generation,
        this.selectionGeneration,
        this.transferGeneration,
      ),
      [...this.roster.values()],
    ));
  }

  private async reloadStored(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<void> {
    if (!this.isActiveLease(expectedGeneration, expectedSelectionGeneration)) return;
    const selected = this.resource.selectedCharacter;
    if (!selected) return;
    const request = ++this.requestGeneration;
    await this.loadStored(
      selected.id,
      this.generation,
      this.selectionGeneration,
      request,
      false,
      selected,
    );
  }

  private async loadStored(
    characterId: number,
    generation: number,
    selectionGeneration: number,
    request: number,
    initial: boolean,
    rosterBaseline: HofCharacter,
  ): Promise<void> {
    try {
      const detail = await this.backend.loadStoredDetail(characterId);
      if (!this.isCurrent(characterId, generation, selectionGeneration, request)) return;
      const mergedDetail = this.mergeRosterObservedAfter(detail, rosterBaseline);
      this.replace({
        ...this.resource,
        detail: mergedDetail,
        isLoading: false,
        errorMessage: null,
        warningMessage: null,
      });
      this.backend.publishDetail?.(mergedDetail);
      if (this.isStale(mergedDetail)) {
        const refreshBaseline = this.resource.selectedCharacter ?? rosterBaseline;
        void this.refreshAuthority(
          characterId,
          generation,
          selectionGeneration,
          request,
          false,
          refreshBaseline,
        );
      }
    } catch (error: unknown) {
      if (!this.isCurrent(characterId, generation, selectionGeneration, request)) return;
      const message = toUserFacingErrorMessage(error);
      const blocksDetail = initial || this.resource.detail == null;
      this.replace({
        ...this.resource,
        detail: blocksDetail ? null : this.resource.detail,
        isLoading: false,
        errorMessage: blocksDetail ? message : null,
        warningMessage: blocksDetail ? null : message,
      });
    }
  }

  private async refresh(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<void> {
    if (!this.isActiveLease(expectedGeneration, expectedSelectionGeneration)) return;
    const selected = this.resource.selectedCharacter;
    if (!selected) return;
    const request = ++this.requestGeneration;
    await this.refreshAuthority(
      selected.id,
      this.generation,
      this.selectionGeneration,
      request,
      true,
      selected,
    );
  }

  private async refreshAuthority(
    characterId: number,
    generation: number,
    selectionGeneration: number,
    request: number,
    reportError: boolean,
    rosterBaseline: HofCharacter,
  ): Promise<void> {
    try {
      const detail = await this.backend.refreshAuthoritativeDetail(characterId);
      if (!this.isCurrent(characterId, generation, selectionGeneration, request)) return;
      const mergedDetail = this.mergeRosterObservedAfter(detail, rosterBaseline);
      this.replace({
        ...this.resource,
        detail: mergedDetail,
        errorMessage: null,
        warningMessage: null,
      });
      this.backend.publishDetail?.(mergedDetail);
    } catch (error: unknown) {
      if (
        !reportError ||
        !this.isCurrent(characterId, generation, selectionGeneration, request)
      ) return;
      const message = toUserFacingErrorMessage(error);
      const blocksDetail = this.resource.detail == null;
      this.replace({
        ...this.resource,
        errorMessage: blocksDetail ? message : null,
        warningMessage: blocksDetail ? null : message,
      });
    }
  }

  private isStale(detail: HofCharacterDetail): boolean {
    const syncedAt = detail.detailSyncedAt
      ? Date.parse(detail.detailSyncedAt)
      : Number.NaN;
    return !Number.isFinite(syncedAt) || this.now() - syncedAt >= this.freshnessMs;
  }

  private isCurrent(
    characterId: number,
    generation: number,
    selectionGeneration: number,
    request: number,
  ): boolean {
    return this.accountKey != null
      && this.generation === generation
      && this.selectionGeneration === selectionGeneration
      && this.requestGeneration === request
      && this.resource.selectedCharacter?.id === characterId;
  }

  private isActiveGeneration(expectedGeneration: number): boolean {
    return this.accountKey != null && this.generation === expectedGeneration;
  }

  private isActiveLease(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): boolean {
    return this.isActiveGeneration(expectedGeneration)
      && this.selectionGeneration === expectedSelectionGeneration;
  }

  private actionsFor(
    generation: number,
    selectionGeneration: number,
    transferGeneration: number,
  ): CharacterManagementHubActions {
    const actions: CharacterManagementHubActions = {
      select: (character) => this.select(character, generation, selectionGeneration),
      openTransfer: (source, target) => this.select(
        target,
        generation,
        selectionGeneration,
        source,
      ),
      close: () => this.close(generation, selectionGeneration),
      reloadStored: () => this.reloadStored(generation, selectionGeneration),
      refresh: () => this.refresh(generation, selectionGeneration),
      dismissPatternConflict: () =>
        this.dismissPatternConflict(generation, selectionGeneration),
      clearTransfer: () =>
        this.clearTransfer(generation, selectionGeneration, transferGeneration),
    };
    if (this.backend.executeCommand) {
      actions.rename = (newName) => this.executeCommandIntent(
        { type: 'RENAME', newName },
        generation,
        selectionGeneration,
      );
      actions.kick = (confirmationName) => this.executeCommandIntent(
        { type: 'KICK', confirmationName },
        generation,
        selectionGeneration,
      );
      actions.knockback = (confirmationName) => this.executeCommandIntent(
        { type: 'KNOCKBACK', confirmationName },
        generation,
        selectionGeneration,
      );
      actions.pray = () => this.executeCommandIntent(
        { type: 'PRAY' },
        generation,
        selectionGeneration,
      );
      actions.prepareItems = () => this.executeCommandIntent(
        { type: 'PREPARE_ITEMS' },
        generation,
        selectionGeneration,
      );
      actions.removeAllEquipment = () => this.executeCommandIntent(
        { type: 'REMOVE_ALL_EQUIPMENT' },
        generation,
        selectionGeneration,
      );
      actions.useItem = (itemValue) => this.executeCommandIntent(
        { type: 'USE_ITEM', itemValue },
        generation,
        selectionGeneration,
      );
      actions.learnSkill = (skillValue) => this.executeCommandIntent(
        { type: 'LEARN_SKILL', skillValue },
        generation,
        selectionGeneration,
      );
      actions.changeClass = (classValue) => this.executeCommandIntent(
        { type: 'CHANGE_CLASS', classValue },
        generation,
        selectionGeneration,
      );
      actions.allocateStats = (amounts) => this.executeCommandIntent(
        { type: 'ALLOCATE_STATS', amounts },
        generation,
        selectionGeneration,
      );
      actions.equipItem = (itemValue) => this.executeCommandIntent(
        { type: 'EQUIP_ITEM', itemValue },
        generation,
        selectionGeneration,
      );
      actions.removeEquipment = (equipmentPart) => this.executeCommandIntent(
        { type: 'REMOVE_EQUIPMENT', equipmentPart },
        generation,
        selectionGeneration,
      );
      actions.saveEquipmentPreset = (slotNumber) => this.executeCommandIntent(
        { type: 'SAVE_EQUIPMENT_PRESET', slotNumber },
        generation,
        selectionGeneration,
      );
      actions.loadEquipmentPreset = (slotNumber) => this.executeCommandIntent(
        { type: 'LOAD_EQUIPMENT_PRESET', slotNumber },
        generation,
        selectionGeneration,
      );
    }
    if (this.backend.applyPattern) {
      actions.savePattern = (change) =>
        this.savePattern(change, generation, selectionGeneration);
      actions.resolvePatternConflict = () =>
        this.resolvePatternConflict(generation, selectionGeneration);
    }
    if (this.backend.loadSavedPattern) {
      actions.loadSavedPattern = (slotCode) =>
        this.loadSavedPattern(slotCode, generation, selectionGeneration);
    }
    if (this.backend.deleteSavedPattern) {
      actions.deleteSavedPattern = (slotCode) =>
        this.deleteSavedPattern(slotCode, generation, selectionGeneration);
    }
    if (this.backend.deepSync) {
      actions.deepSync = () => this.deepSync(generation, selectionGeneration);
    }
    if (this.backend.linkCharacter) {
      actions.linkCharacter = (newHofCharacterId) =>
        this.linkCharacter(newHofCharacterId, generation, selectionGeneration);
      actions.linkRosterCharacter = (characterId, newHofCharacterId) =>
        this.linkRosterCharacter(characterId, newHofCharacterId, generation);
    }
    if (this.backend.archiveCharacter) {
      actions.archiveCharacter = (characterId) => this.mutateRoster(
        characterId,
        this.backend.archiveCharacter!,
        generation,
      );
    }
    if (this.backend.restoreCharacter) {
      actions.restoreCharacter = (characterId) => this.mutateRoster(
        characterId,
        this.backend.restoreCharacter!,
        generation,
      );
    }
    if (this.backend.deleteCharacterPermanently) {
      actions.deleteCharacterPermanently = (characterId) => this.mutateRoster(
        characterId,
        this.backend.deleteCharacterPermanently!,
        generation,
      );
    }
    if (this.backend.beginPatternEdit) {
      actions.beginPatternEdit = () =>
        this.beginPatternEdit(generation, selectionGeneration);
    }
    if (this.backend.previewTransfer) {
      actions.previewTransfer = (request) =>
        this.previewTransfer(
          request,
          generation,
          selectionGeneration,
          transferGeneration,
        );
    }
    if (this.backend.executeTransfer) {
      actions.executeTransfer = () =>
        this.executeTransfer(
          generation,
          selectionGeneration,
          transferGeneration,
        );
    }
    return actions;
  }

  private async executeCommand(
    command: CharacterCommand,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<CharacterCommandResult | void> {
    const execute = this.backend.executeCommand;
    if (!execute || !this.isCurrentTarget(
      command.characterId,
      expectedGeneration,
      expectedSelectionGeneration,
    )) {
      return undefined;
    }
    const result = await execute(command);
    if (!this.isCurrentTarget(
      command.characterId,
      expectedGeneration,
      expectedSelectionGeneration,
    )) {
      return undefined;
    }
    if (result.type === 'IdentityResolutionRequired') {
      this.replace({
        ...this.resource,
        identityResolution: {
          candidates: result.candidates,
          message: result.message,
        },
      });
    } else {
      this.replace({ ...this.resource, identityResolution: null });
      const roster = await this.backend.loadRoster?.();
      if (!this.isCurrentTarget(
        command.characterId,
        expectedGeneration,
        expectedSelectionGeneration,
      )) return undefined;
      if (roster) {
        this.observeRoster(roster);
        this.backend.publishRoster?.(roster);
      }
      if (!this.isCurrentTarget(
        command.characterId,
        expectedGeneration,
        expectedSelectionGeneration,
      )) return result;
      await this.reloadStored(expectedGeneration, expectedSelectionGeneration);
      if (!this.isCurrentTarget(
        command.characterId,
        expectedGeneration,
        expectedSelectionGeneration,
      )) {
        return undefined;
      }
    }
    return result;
  }

  private async executeCommandIntent(
    intent: CharacterManagementCommandIntent,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<void> {
    const target = this.currentTarget(
      expectedGeneration,
      expectedSelectionGeneration,
    );
    const detail = this.resource.detail;
    if (!target || !detail || detail.id !== target.id) return;
    await this.executeCommand(
      toCharacterCommand(intent, target.id, detail.revision),
      expectedGeneration,
      expectedSelectionGeneration,
    );
  }

  private async applyPattern(
    request: CharacterPatternApplyRequest,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<CharacterPatternOperationResult> {
    const apply = this.backend.applyPattern;
    if (!apply || !this.isCurrentTarget(
      request.characterId,
      expectedGeneration,
      expectedSelectionGeneration,
    )) {
      return {};
    }
    const result = await apply(request);
    if (!this.isCurrentTarget(
      request.characterId,
      expectedGeneration,
      expectedSelectionGeneration,
    )) {
      return {};
    }
    if (isPatternConflict(result)) {
      this.replace({ ...this.resource, patternConflict: result });
      return result;
    }
    this.replace({ ...this.resource, patternConflict: null });
    await this.reloadStored(expectedGeneration, expectedSelectionGeneration);
    return this.isCurrentTarget(
      request.characterId,
      expectedGeneration,
      expectedSelectionGeneration,
    )
      ? result
      : {};
  }

  private async savePattern(
    change: CharacterPatternChange,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
    force = false,
  ): Promise<void> {
    const detail = this.resource.detail;
    const target = this.currentTarget(
      expectedGeneration,
      expectedSelectionGeneration,
    );
    if (!detail || !target || detail.id !== target.id) return;
    this.pendingPatternChange = change;
    const result = await this.applyPattern(
      {
        characterId: target.id,
        baseRevision: detail.revision,
        base: change.base,
        draft: { ...change.draft, baseRevision: detail.revision },
        slotAction: change.slotAction,
        targetSlotCode: change.targetSlotCode,
        slotName: change.slotName,
        force,
      },
      expectedGeneration,
      expectedSelectionGeneration,
    );
    if (!isPatternConflict(result)) this.pendingPatternChange = null;
  }

  private async resolvePatternConflict(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<void> {
    const change = this.pendingPatternChange;
    if (!change) return;
    await this.savePattern(
      change,
      expectedGeneration,
      expectedSelectionGeneration,
      true,
    );
  }

  private async loadSavedPattern(
    slotCode: string,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<CharacterPatternOperationResult> {
    const load = this.backend.loadSavedPattern;
    const selected = this.currentTarget(expectedGeneration, expectedSelectionGeneration);
    if (!load || !selected) return {};
    const result = await load(selected.id, slotCode);
    if (!this.isCurrentTarget(
      selected.id,
      expectedGeneration,
      expectedSelectionGeneration,
    )) return {};
    await this.reloadStored(expectedGeneration, expectedSelectionGeneration);
    return this.isCurrentTarget(
      selected.id,
      expectedGeneration,
      expectedSelectionGeneration,
    ) ? result : {};
  }

  private async deleteSavedPattern(
    slotCode: string,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<CharacterPatternOperationResult> {
    const remove = this.backend.deleteSavedPattern;
    const selected = this.currentTarget(expectedGeneration, expectedSelectionGeneration);
    if (!remove || !selected) return {};
    const result = await remove(selected.id, slotCode);
    if (!this.isCurrentTarget(
      selected.id,
      expectedGeneration,
      expectedSelectionGeneration,
    )) return {};
    await this.reloadStored(expectedGeneration, expectedSelectionGeneration);
    return this.isCurrentTarget(
      selected.id,
      expectedGeneration,
      expectedSelectionGeneration,
    ) ? result : {};
  }

  private async deepSync(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<CharacterDeepSyncResponse | void> {
    const synchronize = this.backend.deepSync;
    const selected = this.currentTarget(expectedGeneration, expectedSelectionGeneration);
    if (
      !synchronize ||
      !selected ||
      this.resource.deepSync.status === 'running'
    ) return undefined;
    this.replace({
      ...this.resource,
      deepSync: {
        status: 'running',
        progress: { characterId: selected.id, progress: [] },
        errorMessage: null,
      },
    });
    try {
      const result = await synchronize(selected.id, (progress) => {
        if (!this.isCurrentTarget(
          selected.id,
          expectedGeneration,
          expectedSelectionGeneration,
        )) return;
        this.replace({
          ...this.resource,
          deepSync: { status: 'running', progress, errorMessage: null },
        });
      });
      if (!this.isCurrentTarget(
        selected.id,
        expectedGeneration,
        expectedSelectionGeneration,
      )) return undefined;
      await this.reloadStored(expectedGeneration, expectedSelectionGeneration);
      if (!this.isCurrentTarget(
        selected.id,
        expectedGeneration,
        expectedSelectionGeneration,
      )) return undefined;
      this.replace({
        ...this.resource,
        deepSync: { status: 'completed', progress: result, errorMessage: null },
      });
      return result;
    } catch (error: unknown) {
      if (!this.isCurrentTarget(
        selected.id,
        expectedGeneration,
        expectedSelectionGeneration,
      )) return undefined;
      this.replace({
        ...this.resource,
        deepSync: {
          status: 'error',
          progress: this.resource.deepSync.progress,
          errorMessage: toUserFacingErrorMessage(error),
        },
      });
      return undefined;
    }
  }

  private async linkCharacter(
    newHofCharacterId: string,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<void> {
    const link = this.backend.linkCharacter;
    const selected = this.currentTarget(expectedGeneration, expectedSelectionGeneration);
    if (!link || !selected) return;
    const roster = await link(selected.id, newHofCharacterId);
    if (!this.isCurrentTarget(
      selected.id,
      expectedGeneration,
      expectedSelectionGeneration,
    )) return;
    if (roster) {
      this.observeRoster(roster);
      this.backend.publishRoster?.(roster);
    }
    if (!this.isCurrentTarget(
      selected.id,
      expectedGeneration,
      expectedSelectionGeneration,
    )) return;
    this.replace({ ...this.resource, identityResolution: null });
    await this.refresh(expectedGeneration, expectedSelectionGeneration);
  }

  private async linkRosterCharacter(
    characterId: number,
    newHofCharacterId: string,
    expectedGeneration: number,
  ): Promise<void> {
    const link = this.backend.linkCharacter;
    if (!link || !this.isActiveGeneration(expectedGeneration)) return;
    const roster = await link(characterId, newHofCharacterId);
    if (!this.isActiveGeneration(expectedGeneration)) return;
    if (roster) {
      this.observeRoster(roster);
      this.backend.publishRoster?.(roster);
    }
    const selected = this.resource.selectedCharacter;
    if (selected?.id === characterId) await this.resource.actions.refresh();
  }

  private async mutateRoster(
    characterId: number,
    mutation: (characterId: number) => Promise<HofCharacter[]>,
    expectedGeneration: number,
  ): Promise<void> {
    if (!this.isActiveGeneration(expectedGeneration) || !this.roster.has(characterId)) {
      return;
    }
    const roster = await mutation(characterId);
    if (!this.isActiveGeneration(expectedGeneration)) return;
    this.observeRoster(roster);
    this.backend.publishRoster?.(roster);
  }

  private async beginPatternEdit(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<void> {
    const begin = this.backend.beginPatternEdit;
    if (!begin || !this.currentTarget(
      expectedGeneration,
      expectedSelectionGeneration,
    )) return;
    await begin();
  }

  private async previewTransfer(
    request: CharacterTransferPreviewRequest,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
    expectedTransferGeneration: number,
  ): Promise<CharacterTransferPreview | void> {
    const preview = this.backend.previewTransfer;
    const target = this.currentTarget(
      expectedGeneration,
      expectedSelectionGeneration,
    );
    const source = this.roster.get(request.sourceCharacterId);
    if (
      !preview ||
      this.transferGeneration !== expectedTransferGeneration ||
      this.resource.transfer.status === 'previewing' ||
      this.resource.transfer.status === 'running' ||
      !target ||
      !source ||
      source.id === target.id ||
      request.targetCharacterId !== target.id
    ) return undefined;
    const transferGeneration = ++this.transferGeneration;
    this.replace({
      ...this.resource,
      transfer: {
        status: 'previewing',
        sourceCharacter: source,
        targetCharacterId: target.id,
        request,
        preview: null,
        progress: null,
        result: null,
        errorMessage: null,
      },
      actions: this.actionsFor(
        expectedGeneration,
        expectedSelectionGeneration,
        transferGeneration,
      ),
    });
    try {
      const result = await preview(request);
      if (!this.isCurrentTransfer(
        source.id,
        target.id,
        expectedGeneration,
        expectedSelectionGeneration,
        transferGeneration,
      )) return undefined;
      if (
        result.sourceCharacterId !== source.id ||
        result.targetCharacterId !== target.id
      ) {
        throw new Error('설정 가져오기 대상이 요청과 일치하지 않습니다.');
      }
      this.replace({
        ...this.resource,
        transfer: { ...this.resource.transfer, status: 'ready', preview: result },
      });
      return result;
    } catch (error: unknown) {
      if (!this.isCurrentTransfer(
        source.id,
        target.id,
        expectedGeneration,
        expectedSelectionGeneration,
        transferGeneration,
      )) return undefined;
      this.replace({
        ...this.resource,
        transfer: {
          ...this.resource.transfer,
          status: 'error',
          errorMessage: toUserFacingErrorMessage(error),
        },
      });
      return undefined;
    }
  }

  private async executeTransfer(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
    expectedTransferGeneration: number,
  ): Promise<CharacterTransferExecutionResult | void> {
    const execute = this.backend.executeTransfer;
    const transfer = this.resource.transfer;
    const source = transfer.sourceCharacter;
    const targetCharacterId = transfer.targetCharacterId;
    const request = transfer.request;
    if (
      !execute ||
      this.transferGeneration !== expectedTransferGeneration ||
      transfer.status !== 'ready' ||
      !transfer.preview?.executable ||
      !source ||
      targetCharacterId == null ||
      !request ||
      !this.isCurrentTarget(
        targetCharacterId,
        expectedGeneration,
        expectedSelectionGeneration,
      )
    ) return undefined;
    const transferGeneration = this.transferGeneration;
    this.replace({
      ...this.resource,
      transfer: {
        ...transfer,
        status: 'running',
        progress: null,
        result: null,
        errorMessage: null,
      },
    });
    let result: CharacterTransferExecutionResult;
    try {
      result = await execute(request, (progress) => {
        if (
          progress.targetCharacterId !== targetCharacterId ||
          !this.isCurrentTransfer(
            source.id,
            targetCharacterId,
            expectedGeneration,
            expectedSelectionGeneration,
            transferGeneration,
          )
        ) return;
        this.replace({
          ...this.resource,
          transfer: { ...this.resource.transfer, progress },
        });
      });
    } catch (error: unknown) {
      if (!this.isCurrentTransfer(
        source.id,
        targetCharacterId,
        expectedGeneration,
        expectedSelectionGeneration,
        transferGeneration,
      )) return undefined;
      this.replace({
        ...this.resource,
        transfer: {
          ...this.resource.transfer,
          status: 'error',
          errorMessage: toUserFacingErrorMessage(error),
        },
      });
      return undefined;
    }
    if (!this.isCurrentTransfer(
      source.id,
      targetCharacterId,
      expectedGeneration,
      expectedSelectionGeneration,
      transferGeneration,
    )) return undefined;
    if (result.targetCharacterId !== targetCharacterId) {
      this.replace({
        ...this.resource,
        transfer: {
          ...this.resource.transfer,
          status: 'error',
          errorMessage: '설정 가져오기 결과 대상이 요청과 일치하지 않습니다.',
        },
      });
      return undefined;
    }
    this.replace({
      ...this.resource,
      transfer: { ...this.resource.transfer, progress: result, result },
    });
    await this.refresh(expectedGeneration, expectedSelectionGeneration);
    if (!this.isCurrentTransfer(
      source.id,
      targetCharacterId,
      expectedGeneration,
      expectedSelectionGeneration,
      transferGeneration,
    )) return undefined;
    let relatedPresetError: string | null = null;
    try {
      await this.backend.reloadRelatedPresets?.();
    } catch (error: unknown) {
      relatedPresetError = toUserFacingErrorMessage(error);
    }
    if (!this.isCurrentTransfer(
      source.id,
      targetCharacterId,
      expectedGeneration,
      expectedSelectionGeneration,
      transferGeneration,
    )) return undefined;
    this.replace({
      ...this.resource,
      transfer: {
        ...this.resource.transfer,
        status: 'completed',
        progress: result,
        result,
        errorMessage: relatedPresetError,
      },
    });
    return result;
  }

  private clearTransfer(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
    expectedTransferGeneration: number,
  ): void {
    if (
      !this.isActiveLease(expectedGeneration, expectedSelectionGeneration) ||
      this.transferGeneration !== expectedTransferGeneration ||
      this.resource.transfer.status === 'running'
    ) return;
    this.transferGeneration += 1;
    this.replace({
      ...this.resource,
      transfer: idleTransfer(),
      actions: this.actionsFor(
        expectedGeneration,
        expectedSelectionGeneration,
        this.transferGeneration,
      ),
    });
  }

  private isCurrentTransfer(
    sourceCharacterId: number,
    targetCharacterId: number,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
    expectedTransferGeneration: number,
  ): boolean {
    return this.transferGeneration === expectedTransferGeneration
      && this.roster.has(sourceCharacterId)
      && this.isCurrentTarget(
        targetCharacterId,
        expectedGeneration,
        expectedSelectionGeneration,
      );
  }

  private dismissPatternConflict(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): void {
    if (!this.isActiveLease(expectedGeneration, expectedSelectionGeneration)) return;
    this.pendingPatternChange = null;
    this.replace({ ...this.resource, patternConflict: null });
  }

  private currentTarget(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): HofCharacter | null {
    return this.isActiveLease(expectedGeneration, expectedSelectionGeneration)
      ? this.resource.selectedCharacter
      : null;
  }

  private isCurrentTarget(
    characterId: number,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): boolean {
    return this.isActiveLease(expectedGeneration, expectedSelectionGeneration)
      && this.resource.selectedCharacter?.id === characterId;
  }

  private mergeRosterObservedAfter(
    detail: HofCharacterDetail,
    rosterBaseline: HofCharacter,
  ): HofCharacterDetail {
    const observed = this.roster.get(detail.id);
    return observed && observed !== rosterBaseline && isActive(observed)
      ? { ...detail, ...observed }
      : detail;
  }

  private replace(next: CharacterManagementHubResource): void {
    if (this.resource === next) return;
    this.resource = next;
    for (const listener of this.listeners) listener();
  }
}

function emptyResource(
  actions: CharacterManagementHubActions,
  characters: HofCharacter[] = [],
): CharacterManagementHubResource {
  return {
    characters,
    selectedCharacter: null,
    detail: null,
    isLoading: false,
    errorMessage: null,
    warningMessage: null,
    identityResolution: null,
    patternConflict: null,
    deepSync: idleDeepSync(),
    transfer: idleTransfer(),
    actions,
  };
}

function isActive(character: HofCharacter): boolean {
  return (character.lifecycle ?? 'ACTIVE') === 'ACTIVE';
}

function toCharacterCommand(
  intent: CharacterManagementCommandIntent,
  characterId: number,
  expectedRevision: string,
): CharacterCommand {
  switch (intent.type) {
    case 'RENAME':
      return { ...intent, characterId, expectedRevision };
    case 'KICK':
    case 'KNOCKBACK':
      return { ...intent, characterId, expectedRevision };
    case 'PRAY':
    case 'PREPARE_ITEMS':
    case 'REMOVE_ALL_EQUIPMENT':
      return { ...intent, characterId, expectedRevision };
    case 'USE_ITEM':
      return { ...intent, characterId, expectedRevision };
    case 'LEARN_SKILL':
      return { ...intent, characterId, expectedRevision };
    case 'CHANGE_CLASS':
      return { ...intent, characterId, expectedRevision };
    case 'ALLOCATE_STATS':
      return { ...intent, characterId, expectedRevision };
    case 'EQUIP_ITEM':
      return { ...intent, characterId, expectedRevision };
    case 'REMOVE_EQUIPMENT':
      return { ...intent, characterId, expectedRevision };
    case 'SAVE_EQUIPMENT_PRESET':
    case 'LOAD_EQUIPMENT_PRESET':
      return { ...intent, characterId, expectedRevision };
  }
}

function isPatternConflict(result: CharacterPatternOperationResult): boolean {
  return result.currentRevision != null || (result.rowDiffs?.length ?? 0) > 0;
}

function idleDeepSync(): CharacterManagementDeepSyncState {
  return { status: 'idle', progress: null, errorMessage: null };
}

function idleTransfer(): CharacterManagementTransferState {
  return {
    status: 'idle',
    sourceCharacter: null,
    targetCharacterId: null,
    request: null,
    preview: null,
    progress: null,
    result: null,
    errorMessage: null,
  };
}
