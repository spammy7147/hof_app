import { toUserFacingErrorMessage } from './userFacingErrors';
import type {
  CharacterCommand,
  CharacterCommandResult,
  CharacterDeepSyncResponse,
  CharacterOperationJob,
  CharacterRecoveryPreview,
  CharacterIdentityCandidate,
  CharacterPatternApplyRequest,
  CharacterPatternSetting,
  CharacterPatternOperationResult,
  CharacterTransferExecutionResult,
  CharacterTransferPreview,
  CharacterTransferPreviewRequest,
  CharacterTransferExecuteRequest,
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
    onJob?: (job: CharacterOperationJob) => void,
  ) => Promise<CharacterDeepSyncResponse>;
  loadCurrentOperation?: (characterId?: number) => Promise<CharacterOperationJob | null>;
  loadOperation?: (jobId: number) => Promise<CharacterOperationJob>;
  retryRecovery?: (jobId: number, onJob: (job: CharacterOperationJob) => void) => Promise<CharacterOperationJob>;
  previewRecovery?: (jobId: number) => Promise<CharacterRecoveryPreview>;
  acceptRecovery?: (jobId: number, token: string) => Promise<CharacterOperationJob>;
  linkCharacter?: (
    characterId: number,
    newHofCharacterId: string,
  ) => Promise<HofCharacter[] | void>;
  archiveCharacter?: (characterId: number) => Promise<HofCharacter[]>;
  restoreCharacter?: (characterId: number) => Promise<HofCharacter[]>;
  deleteCharacterPermanently?: (characterId: number) => Promise<HofCharacter[]>;
  loadRoster?: () => Promise<HofCharacter[]>;
  previewTransfer?: (
    request: CharacterTransferPreviewRequest,
  ) => Promise<CharacterTransferPreview>;
  executeTransfer?: (
    request: CharacterTransferExecuteRequest,
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
  savePattern?: (change: CharacterPatternChange) => Promise<CharacterPatternOperationResult | void>;
  resolvePatternConflict?: () => Promise<void>;
  loadSavedPattern?: (slotCode: string) => Promise<CharacterPatternOperationResult>;
  deleteSavedPattern?: (slotCode: string) => Promise<CharacterPatternOperationResult>;
  deepSync?: () => Promise<CharacterDeepSyncResponse | void>;
  checkRecovery?: () => Promise<void>;
  retryRecovery?: () => Promise<void>;
  previewRecovery?: () => Promise<void>;
  acceptRecovery?: () => Promise<void>;
  dismissRecoveryPreview?: () => void;
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
  job?: CharacterOperationJob | null;
  preview?: CharacterRecoveryPreview | null;
  recoveryBusy?: boolean;
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
  patternOperation: {
    pending: boolean;
    result: CharacterPatternOperationResult | null;
    appliedVersion: number;
  };
  deepSync: CharacterManagementDeepSyncState;
  transfer: CharacterManagementTransferState;
  actions: CharacterManagementHubActions;
};

export type CharacterManagementObservationSink = {
  beginRosterObservation: () => (
    characters: HofCharacter[],
  ) => boolean;
  observeCharacter: (character: HofCharacter) => boolean;
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
  private rosterAuthorityGeneration = 0;
  private rosterProjectionGeneration = 0;
  private rosterProjectionGenerationById = new Map<number, number>();
  private rosterObservationRequest = 0;
  private pendingPatternChange: CharacterPatternChange | null = null;
  private recoveryPreviewGeneration = 0;
  private recoveryRequestGeneration = 0;
  private recoveryActionKind: 'check' | 'retry' | 'preview' | 'accept' | null = null;
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
    this.rosterAuthorityGeneration += 1;
    this.rosterProjectionGeneration += 1;
    this.rosterObservationRequest += 1;
    this.pendingPatternChange = null;
    this.roster = new Map();
    this.rosterProjectionGenerationById.clear();
    this.replace(emptyResource(
      this.actionsFor(
        this.generation,
        this.selectionGeneration,
        this.transferGeneration,
      ),
    ));
    void this.recoveryAction('check', this.generation, this.selectionGeneration);
  }

  deactivate(): void {
    this.accountKey = null;
    this.generation += 1;
    this.selectionGeneration += 1;
    this.transferGeneration += 1;
    this.requestGeneration += 1;
    this.rosterAuthorityGeneration += 1;
    this.rosterProjectionGeneration += 1;
    this.rosterObservationRequest += 1;
    this.pendingPatternChange = null;
    this.roster = new Map();
    this.rosterProjectionGenerationById.clear();
    this.replace(emptyResource(
      this.actionsFor(
        this.generation,
        this.selectionGeneration,
        this.transferGeneration,
      ),
    ));
  }

  observeRoster(characters: HofCharacter[]): void {
    this.rosterAuthorityGeneration += 1;
    this.rosterProjectionGeneration += 1;
    this.rosterObservationRequest += 1;
    this.rosterProjectionGenerationById.clear();
    this.applyRoster(characters);
  }

  createObservationSink(accountKey: unknown): CharacterManagementObservationSink {
    return {
      beginRosterObservation: () => {
        const request = ++this.rosterObservationRequest;
        const authorityGeneration = this.rosterAuthorityGeneration;
        const projectionGeneration = this.rosterProjectionGeneration;
        return (characters) => {
          if (
            !this.isObservationAccount(accountKey) ||
            request !== this.rosterObservationRequest ||
            authorityGeneration !== this.rosterAuthorityGeneration
          ) return false;
          this.applyRoster(mergeFresherCharacterProjections(
            [...this.roster.values()],
            characters,
            new Set(
              [...this.rosterProjectionGenerationById]
                .filter(([, generation]) => generation > projectionGeneration)
                .map(([characterId]) => characterId),
            ),
          ));
          return true;
        };
      },
      observeCharacter: (character) => {
        if (!this.isObservationAccount(accountKey)) return false;
        this.projectCharacter(character);
        return true;
      },
    };
  }

  private isObservationAccount(accountKey: unknown): boolean {
    return this.accountKey != null && Object.is(this.accountKey, accountKey);
  }

  private projectCharacter(character: HofCharacter): void {
    this.rosterProjectionGeneration += 1;
    const current = [...this.roster.values()];
    const projected = upsertFresherCharacterProjection(
      current,
      character,
    );
    if (projected !== current) {
      this.rosterProjectionGenerationById.set(
        character.id,
        this.rosterProjectionGeneration,
      );
    }
    this.applyRoster(projected);
  }

  private projectAuthoritativeCharacter(character: HofCharacter): void {
    this.rosterProjectionGeneration += 1;
    this.rosterProjectionGenerationById.set(
      character.id,
      this.rosterProjectionGeneration,
    );
    const current = [...this.roster.values()];
    this.applyRoster(this.roster.has(character.id)
      ? current.map((item) => item.id === character.id ? character : item)
      : [...current, character]);
  }

  private applyRoster(characters: HofCharacter[]): void {
    const roster = new Map(characters.map((character) => [character.id, character]));
    for (const characterId of this.rosterProjectionGenerationById.keys()) {
      if (!roster.has(characterId)) {
        this.rosterProjectionGenerationById.delete(characterId);
      }
    }
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
    this.recoveryPreviewGeneration += 1;
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
      patternOperation: { pending: false, result: null, appliedVersion: 0 },
      deepSync: { ...this.resource.deepSync, preview: null },
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
    await Promise.all([
      this.loadStored(selected.id, generation, selectionGeneration, request, true, this.rosterProjectionGeneration),
      this.recoveryAction('check', generation, selectionGeneration),
    ]);
  }

  private close(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): void {
    if (!this.isActiveLease(expectedGeneration, expectedSelectionGeneration)) return;
    this.selectionGeneration += 1;
    this.recoveryPreviewGeneration += 1;
    this.transferGeneration += 1;
    this.requestGeneration += 1;
    this.pendingPatternChange = null;
    this.replace({ ...emptyResource(
      this.actionsFor(
        this.generation,
        this.selectionGeneration,
        this.transferGeneration,
      ),
      [...this.roster.values()],
    ), deepSync: { ...this.resource.deepSync, preview: null } });
    void this.recoveryAction('check', this.generation, this.selectionGeneration);
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
      this.rosterProjectionGeneration,
    );
  }

  private async loadStored(
    characterId: number,
    generation: number,
    selectionGeneration: number,
    request: number,
    initial: boolean,
    rosterProjectionBaseline: number,
  ): Promise<void> {
    try {
      const detail = await this.backend.loadStoredDetail(characterId);
      if (!this.isCurrent(characterId, generation, selectionGeneration, request)) return;
      const mergedDetail = this.mergeRosterObservedAfter(
        detail,
        rosterProjectionBaseline,
      );
      this.projectAuthoritativeCharacter(mergedDetail);
      this.replace({
        ...this.resource,
        detail: mergedDetail,
        isLoading: false,
        errorMessage: null,
        warningMessage: null,
      });
      if (this.isStale(mergedDetail)) {
        void this.refreshAuthority(
          characterId,
          generation,
          selectionGeneration,
          request,
          false,
          this.rosterProjectionGeneration,
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
      this.rosterProjectionGeneration,
    );
  }

  private async refreshAuthority(
    characterId: number,
    generation: number,
    selectionGeneration: number,
    request: number,
    reportError: boolean,
    rosterProjectionBaseline: number,
  ): Promise<void> {
    try {
      const detail = await this.backend.refreshAuthoritativeDetail(characterId);
      if (!this.isCurrent(characterId, generation, selectionGeneration, request)) return;
      const mergedDetail = this.mergeRosterObservedAfter(
        detail,
        rosterProjectionBaseline,
      );
      this.projectAuthoritativeCharacter(mergedDetail);
      this.replace({
        ...this.resource,
        detail: mergedDetail,
        errorMessage: null,
        warningMessage: null,
      });
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
    if (this.backend.loadCurrentOperation) {
      actions.checkRecovery = () => this.recoveryAction('check', generation, selectionGeneration);
    }
    if (this.backend.retryRecovery) {
      actions.retryRecovery = () => this.recoveryAction('retry', generation, selectionGeneration);
    }
    if (this.backend.previewRecovery) {
      actions.previewRecovery = () => this.recoveryAction('preview', generation, selectionGeneration);
    }
    if (this.backend.acceptRecovery) {
      actions.acceptRecovery = () => this.recoveryAction('accept', generation, selectionGeneration);
    }
    actions.dismissRecoveryPreview = () => {
      if (!this.isActiveLease(generation, selectionGeneration)) return;
      this.recoveryPreviewGeneration += 1;
      this.replace({ ...this.resource, deepSync: { ...this.resource.deepSync, preview: null } });
    };
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
      actions.restoreCharacter = async (characterId) => {
        try {
          await this.mutateRoster(characterId, this.backend.restoreCharacter!, generation);
        } finally {
          if (this.isActiveGeneration(generation)) await this.recoveryAction('check', generation, this.selectionGeneration);
        }
      };
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
      const acceptRoster = this
        .createObservationSink(this.accountKey)
        .beginRosterObservation();
      const roster = await this.backend.loadRoster?.();
      if (!this.isCurrentTarget(
        command.characterId,
        expectedGeneration,
        expectedSelectionGeneration,
      )) return undefined;
      if (roster) {
        acceptRoster(roster);
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
    return this.runPatternOperation(
      request.characterId,
      expectedGeneration,
      expectedSelectionGeneration,
      () => apply(request),
      request.slotAction === 'NONE' ? '현재 설정을 저장했습니다.' : '현재 설정과 저장 패턴을 저장했습니다.',
      true,
    );
  }

  private async savePattern(
    change: CharacterPatternChange,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
    force = false,
  ): Promise<CharacterPatternOperationResult | void> {
    const detail = this.resource.detail;
    const target = this.currentTarget(
      expectedGeneration,
      expectedSelectionGeneration,
    );
    if (!detail || !target || detail.id !== target.id || this.resource.patternOperation.pending) return;
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
    if (this.isCurrentTarget(target.id, expectedGeneration, expectedSelectionGeneration)
      && result.type === 'Completed') this.pendingPatternChange = null;
    return result;
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
    return this.runPatternOperation(selected.id, expectedGeneration, expectedSelectionGeneration,
      () => load(selected.id, slotCode), '저장 패턴을 불러왔습니다.', true);
  }

  private async deleteSavedPattern(
    slotCode: string,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<CharacterPatternOperationResult> {
    const remove = this.backend.deleteSavedPattern;
    const selected = this.currentTarget(expectedGeneration, expectedSelectionGeneration);
    if (!remove || !selected) return {};
    return this.runPatternOperation(selected.id, expectedGeneration, expectedSelectionGeneration,
      () => remove(selected.id, slotCode), '저장 패턴을 삭제했습니다.', false);
  }

  private async runPatternOperation(
    characterId: number,
    generation: number,
    selectionGeneration: number,
    operation: () => Promise<CharacterPatternOperationResult>,
    completedMessage: string,
    replacesDraft: boolean,
  ): Promise<CharacterPatternOperationResult> {
    const isCurrent = () => this.isCurrentTarget(characterId, generation, selectionGeneration);
    if (!isCurrent() || this.resource.patternOperation.pending) return {};
    this.replace({ ...this.resource, patternConflict: null,
      patternOperation: { ...this.resource.patternOperation, pending: true, result: null } });
    try {
      let result = normalizePatternResult(await operation(), completedMessage);
      if (!isCurrent()) return {};
      if (result.type !== 'Conflict' && result.type !== 'Rejected') {
        const reload = this.reloadStored(generation, selectionGeneration);
        const request = this.requestGeneration;
        await reload;
        if (!isCurrent()) return {};
        if (result.type === 'Completed') {
          if (request !== this.requestGeneration) {
            result = { type: 'RefreshRequired', message: '변경은 완료됐지만 최신 상세 확인이 아직 끝나지 않았습니다. 현재 상태를 다시 확인해 주세요.' };
          } else if (this.resource.warningMessage) {
            result = { type: 'RefreshRequired', message: `변경은 완료됐지만 상세를 다시 읽지 못했습니다. ${this.resource.warningMessage}` };
          }
        }
      }
      this.replace({ ...this.resource,
        patternConflict: result.type === 'Conflict' ? result : null,
        patternOperation: {
          pending: false, result,
          appliedVersion: this.resource.patternOperation.appliedVersion
            + (result.type === 'Completed' && replacesDraft ? 1 : 0),
        },
      });
      return result;
    } catch (error) {
      if (!isCurrent()) return {};
      const result: CharacterPatternOperationResult = { type: 'RefreshRequired', message: toUserFacingErrorMessage(error) };
      this.replace({ ...this.resource, patternOperation: { ...this.resource.patternOperation, pending: false, result } });
      return result;
    }
  }

  private async deepSync(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<CharacterDeepSyncResponse | void> {
    const synchronize = this.backend.deepSync;
    const selected = this.currentTarget(expectedGeneration, expectedSelectionGeneration);
    if (!synchronize || !selected || this.resource.deepSync.status === 'running'
      || this.resource.deepSync.recoveryBusy || operationNeedsAttention(this.resource.deepSync.job)) return;
    // 서버 작업은 계정에 속한다. 화면 선택 세대가 바뀌어도 진행과 복구 보호를 유지한다.
    const isCurrentAccount = () => this.accountKey != null && this.generation === expectedGeneration;
    this.replace({ ...this.resource, deepSync: {
      status: 'running', progress: { characterId: selected.id, progress: [] }, errorMessage: null,
    } });
    try {
      const result = await synchronize(selected.id, (progress) => {
        if (!isCurrentAccount()) return;
        this.replace({ ...this.resource, deepSync: { ...this.resource.deepSync, status: 'running', progress, errorMessage: null } });
      }, (job) => {
        if (!isCurrentAccount()) return;
        this.replace({ ...this.resource, deepSync: { ...this.resource.deepSync, job } });
      });
      if (!isCurrentAccount()) return;
      if (this.isCurrentTarget(selected.id, expectedGeneration, expectedSelectionGeneration)) {
        await this.reloadStored(expectedGeneration, expectedSelectionGeneration);
      }
      if (!isCurrentAccount()) return;
      this.replace({ ...this.resource, deepSync: { ...this.resource.deepSync, status: 'completed', progress: result, errorMessage: null } });
      return this.isCurrentTarget(selected.id, expectedGeneration, expectedSelectionGeneration) ? result : undefined;
    } catch (error: unknown) {
      if (!isCurrentAccount()) return;
      this.replace({ ...this.resource, deepSync: {
        ...this.resource.deepSync, status: 'error', errorMessage: toUserFacingErrorMessage(error),
      } });
    }
  }

  private async recoveryAction(
    action: 'check' | 'retry' | 'preview' | 'accept',
    generation: number,
    selectionGeneration: number,
  ): Promise<void> {
    const selected = this.currentTarget(generation, selectionGeneration);
    const state = this.resource.deepSync;
    if (!this.isActiveLease(generation, selectionGeneration) || state.status === 'running'
      || (state.recoveryBusy && (action !== 'check' || this.recoveryActionKind !== 'check'))) return;
    const job = state.job;
    if (action === 'check' && !this.backend.loadCurrentOperation) return;
    if (action !== 'check' && !job) return;
    if (action === 'retry' && (!this.backend.retryRecovery || job?.canRetryRecovery === false || !['REQUIRED', 'RESTORING'].includes(job?.recoveryStatus ?? ''))) return;
    if (action === 'preview' && !this.backend.previewRecovery) return;
    if (action === 'accept' && (!this.backend.acceptRecovery || !state.preview || state.preview.jobId !== job?.id)) return;
    if (action !== 'check' && (job?.status === 'RUNNING' || job?.status === 'PENDING')) return;
    const recoveryRequest = ++this.recoveryRequestGeneration;
    this.recoveryActionKind = action;
    const isCurrent = () => this.isActiveGeneration(generation) && recoveryRequest === this.recoveryRequestGeneration;
    const previewGeneration = this.recoveryPreviewGeneration;
    const observe = (observed: CharacterOperationJob) => {
      if (!isCurrent()) return;
      this.replace({ ...this.resource, deepSync: {
        ...this.resource.deepSync, job: observed, progress: observed.deepSync,
      } });
    };
    this.replace({ ...this.resource, deepSync: {
      ...state, recoveryBusy: true, preview: action === 'accept' ? state.preview : null, errorMessage: null,
    } });
    try {
      if (action === 'preview') {
        const preview = await this.backend.previewRecovery!(job!.id);
        if (isCurrent() && previewGeneration === this.recoveryPreviewGeneration
          && preview.jobId === job!.id && preview.characterId === job!.targetCharacterId) {
          this.replace({ ...this.resource, deepSync: { ...this.resource.deepSync, preview } });
        }
        return;
      }
      const observed = action === 'retry'
        ? await this.backend.retryRecovery!(job!.id, observe)
        : action === 'accept'
          ? await this.backend.acceptRecovery!(job!.id, state.preview!.confirmationToken)
          : job && operationNeedsAttention(job) && this.backend.loadOperation
            ? await this.backend.loadOperation(job.id)
            : await this.backend.loadCurrentOperation!(selected?.id);
      if (!isCurrent()) return;
      if (observed) observe(observed);
      const failed = observed?.status === 'FAILED' || (observed?.status === 'STOPPED' && observed.recoveryStatus !== 'ACCEPTED');
      this.replace({ ...this.resource, deepSync: {
        ...this.resource.deepSync,
        job: observed,
        progress: observed?.deepSync ?? null,
        preview: null,
        status: failed ? 'error' : observed?.status === 'COMPLETED' ? 'completed' : 'idle',
        errorMessage: failed ? observed.message : null,
      } });
      if (action !== 'check' && selected && observed?.targetCharacterId === selected.id
        && this.isCurrentTarget(selected.id, generation, selectionGeneration)) {
        if (action === 'accept') await this.refresh(generation, selectionGeneration);
        else await this.reloadStored(generation, selectionGeneration);
      }
    } catch (error) {
      if (!isCurrent()) return;
      this.replace({ ...this.resource, deepSync: {
        ...this.resource.deepSync, status: 'error', preview: null, errorMessage: toUserFacingErrorMessage(error),
      } });
    } finally {
      if (isCurrent()) {
        this.recoveryActionKind = null;
        this.replace({ ...this.resource, deepSync: { ...this.resource.deepSync, recoveryBusy: false } });
        if (selectionGeneration !== this.selectionGeneration && !operationNeedsAttention(this.resource.deepSync.job)) {
          void this.recoveryAction('check', generation, this.selectionGeneration);
        }
      }
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
    const confirmationToken = transfer.preview.confirmationToken;
    if (!confirmationToken) {
      this.replace({
        ...this.resource,
        transfer: { ...transfer, status: 'error', errorMessage: '미리보기 확인 정보가 없습니다. 미리보기를 다시 불러와 주세요.' },
      });
      return undefined;
    }
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
      result = await execute({ ...request, confirmationToken }, (progress) => {
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
    if (result.outcome === 'PREVIEW_CHANGED') {
      const preview = result.preview;
      if (!preview?.confirmationToken || preview.sourceCharacterId !== source.id || preview.targetCharacterId !== targetCharacterId) {
        this.replace({
          ...this.resource,
          transfer: { ...this.resource.transfer, status: 'error', errorMessage: '변경된 미리보기를 확인하지 못했습니다. 다시 불러와 주세요.' },
        });
        return undefined;
      }
      const nextGeneration = ++this.transferGeneration;
      this.replace({
        ...this.resource,
        transfer: {
          ...this.resource.transfer, status: 'ready', preview, progress: null, result: null,
          errorMessage: result.message ?? '변경된 미리보기를 다시 확인해 주세요.',
        },
        actions: this.actionsFor(expectedGeneration, expectedSelectionGeneration, nextGeneration),
      });
      return result;
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
    rosterProjectionBaseline: number,
  ): HofCharacterDetail {
    const observed = this.roster.get(detail.id);
    return observed
      && isActive(observed)
      && (
        (
          this.rosterProjectionGeneration !== rosterProjectionBaseline
          && isFresherCharacter(observed, detail)
        ) || isChronologicallyFresher(observed, detail)
      )
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
    patternOperation: { pending: false, result: null, appliedVersion: 0 },
    deepSync: idleDeepSync(),
    transfer: idleTransfer(),
    actions,
  };
}

function isActive(character: HofCharacter): boolean {
  return (character.lifecycle ?? 'ACTIVE') === 'ACTIVE';
}

function mergeFresherCharacterProjections(
  current: HofCharacter[],
  incoming: HofCharacter[],
  preserveCurrentIds: ReadonlySet<number>,
): HofCharacter[] {
  const currentById = new Map(current.map((character) => [character.id, character]));
  const incomingIds = new Set(incoming.map((character) => character.id));
  const merged = incoming.map((observed) => {
    const existing = currentById.get(observed.id);
    return existing && isFresherCharacter(existing, observed) ? existing : observed;
  });
  return [
    ...merged,
    ...current.filter((character) =>
      !incomingIds.has(character.id) && preserveCurrentIds.has(character.id)),
  ];
}

function upsertFresherCharacterProjection(
  current: HofCharacter[],
  observed: HofCharacter,
): HofCharacter[] {
  const existing = current.find((character) => character.id === observed.id);
  if (existing && isFresherCharacter(existing, observed)) return current;
  return existing
    ? current.map((character) => character.id === observed.id ? observed : character)
    : [...current, observed];
}

function isFresherCharacter(
  existing: HofCharacter,
  observed: HofCharacter,
): boolean {
  const revisionOrder = compareInstant(existing.revision, observed.revision);
  if (revisionOrder !== 0) return revisionOrder > 0;
  return compareInstant(existing.detailSyncedAt, observed.detailSyncedAt) > 0;
}

function isChronologicallyFresher(
  existing: HofCharacter,
  observed: HofCharacter,
): boolean {
  const existingRevision = parseIsoInstant(existing.revision);
  const observedRevision = parseIsoInstant(observed.revision);
  return Number.isFinite(existingRevision)
    && Number.isFinite(observedRevision)
    && existingRevision > observedRevision;
}

function compareInstant(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  if (left === right) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  const leftTime = parseIsoInstant(left);
  const rightTime = parseIsoInstant(right);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return leftTime - rightTime;
  }
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
    return left.localeCompare(right);
  }
  return 0;
}

function parseIsoInstant(value: string): number {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : Number.NaN;
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

function normalizePatternResult(result: CharacterPatternOperationResult, completedMessage: string): CharacterPatternOperationResult {
  const type = result.type ?? (result.currentRevision != null ? 'Conflict'
    : result.code != null ? 'Rejected'
    : result.completedSteps != null ? 'PartiallyApplied'
    : result.revision != null ? 'Completed' : 'RefreshRequired');
  return { ...result, type,
    message: result.message || result.messages?.join('\n')
      || (type === 'Completed' ? completedMessage : '저장 결과를 확인하지 못했습니다. 현재 상태를 다시 확인해 주세요.'),
  };
}

function idleDeepSync(): CharacterManagementDeepSyncState {
  return { status: 'idle', progress: null, errorMessage: null };
}

export function operationNeedsAttention(job: CharacterOperationJob | null | undefined): boolean {
  return job != null && (job.status === 'PENDING' || job.status === 'RUNNING'
    || ['REQUIRED', 'RESTORING', 'UNAVAILABLE'].includes(job.recoveryStatus ?? ''));
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
