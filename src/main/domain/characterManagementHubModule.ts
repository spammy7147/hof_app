import { toUserFacingErrorMessage } from './userFacingErrors';
import type {
  CharacterCommand,
  CharacterCommandResult,
  CharacterDeepSyncResponse,
  CharacterPatternApplyRequest,
  CharacterPatternOperationResult,
  HofCharacter,
  HofCharacterDetail,
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
  loadRoster?: () => Promise<HofCharacter[]>;
  publishRoster?: (characters: HofCharacter[]) => void;
  publishDetail?: (detail: HofCharacterDetail) => void;
  beginPatternEdit?: () => Promise<void>;
};

export type CharacterManagementHubActions = {
  select: (character: HofCharacter) => Promise<void>;
  close: () => void;
  reloadStored: () => Promise<void>;
  refresh: () => Promise<void>;
  dismissPatternConflict: () => void;
  executeCommand?: (
    command: CharacterCommand,
  ) => Promise<CharacterCommandResult | void>;
  applyPattern?: (
    request: CharacterPatternApplyRequest,
  ) => Promise<CharacterPatternOperationResult>;
  loadSavedPattern?: (slotCode: string) => Promise<CharacterPatternOperationResult>;
  deleteSavedPattern?: (slotCode: string) => Promise<CharacterPatternOperationResult>;
  deepSync?: () => Promise<CharacterDeepSyncResponse | void>;
  linkCharacter?: (newHofCharacterId: string) => Promise<void>;
  linkRosterCharacter?: (
    characterId: number,
    newHofCharacterId: string,
  ) => Promise<void>;
  beginPatternEdit?: () => Promise<void>;
};

export type CharacterManagementDeepSyncState = {
  status: 'idle' | 'running' | 'completed' | 'error';
  progress: CharacterDeepSyncResponse | null;
  errorMessage: string | null;
};

export type CharacterManagementHubResource = {
  selectedCharacter: HofCharacter | null;
  detail: HofCharacterDetail | null;
  isLoading: boolean;
  errorMessage: string | null;
  warningMessage: string | null;
  patternConflict: CharacterPatternOperationResult | null;
  deepSync: CharacterManagementDeepSyncState;
  actions: CharacterManagementHubActions;
};

type CharacterManagementHubOptions = {
  now?: () => number;
  freshnessMs?: number;
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
  private requestGeneration = 0;
  private roster = new Map<number, HofCharacter>();
  private resource: CharacterManagementHubResource;

  constructor(
    private readonly backend: CharacterManagementHubBackend,
    options: CharacterManagementHubOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.freshnessMs = options.freshnessMs ?? DEFAULT_FRESHNESS_MS;
    this.resource = emptyResource(
      this.actionsFor(this.generation, this.selectionGeneration),
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
    this.requestGeneration += 1;
    this.roster = new Map();
    this.replace(emptyResource(
      this.actionsFor(this.generation, this.selectionGeneration),
    ));
  }

  deactivate(): void {
    this.accountKey = null;
    this.generation += 1;
    this.selectionGeneration += 1;
    this.requestGeneration += 1;
    this.roster = new Map();
    this.replace(emptyResource(
      this.actionsFor(this.generation, this.selectionGeneration),
    ));
  }

  observeRoster(characters: HofCharacter[]): void {
    this.roster = new Map(characters.map((character) => [character.id, character]));
    const selected = this.resource.selectedCharacter;
    if (!selected) return;
    const observed = this.roster.get(selected.id);
    if (!observed || !isActive(observed)) {
      this.close(this.generation, this.selectionGeneration);
      return;
    }
    if (observed === selected) return;
    const detail = this.resource.detail?.id === observed.id
      ? { ...this.resource.detail, ...observed }
      : this.resource.detail;
    this.replace({ ...this.resource, selectedCharacter: observed, detail });
  }

  private async select(
    candidate: HofCharacter,
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): Promise<void> {
    if (!this.isActiveLease(expectedGeneration, expectedSelectionGeneration)) return;
    const selected = this.roster.get(candidate.id);
    if (!selected || !isActive(selected)) return;
    this.selectionGeneration += 1;
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
      patternConflict: null,
      deepSync: idleDeepSync(),
      actions: this.actionsFor(generation, selectionGeneration),
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
    this.requestGeneration += 1;
    this.replace(emptyResource(
      this.actionsFor(this.generation, this.selectionGeneration),
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
  ): CharacterManagementHubActions {
    const actions: CharacterManagementHubActions = {
      select: (character) => this.select(character, generation, selectionGeneration),
      close: () => this.close(generation, selectionGeneration),
      reloadStored: () => this.reloadStored(generation, selectionGeneration),
      refresh: () => this.refresh(generation, selectionGeneration),
      dismissPatternConflict: () =>
        this.dismissPatternConflict(generation, selectionGeneration),
    };
    if (this.backend.executeCommand) {
      actions.executeCommand = (command) =>
        this.executeCommand(command, generation, selectionGeneration);
    }
    if (this.backend.applyPattern) {
      actions.applyPattern = (request) =>
        this.applyPattern(request, generation, selectionGeneration);
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
    if (this.backend.beginPatternEdit) {
      actions.beginPatternEdit = () =>
        this.beginPatternEdit(generation, selectionGeneration);
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
    if (result.type !== 'IdentityResolutionRequired') {
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

  private dismissPatternConflict(
    expectedGeneration: number,
    expectedSelectionGeneration: number,
  ): void {
    if (!this.isActiveLease(expectedGeneration, expectedSelectionGeneration)) return;
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
): CharacterManagementHubResource {
  return {
    selectedCharacter: null,
    detail: null,
    isLoading: false,
    errorMessage: null,
    warningMessage: null,
    patternConflict: null,
    deepSync: idleDeepSync(),
    actions,
  };
}

function isActive(character: HofCharacter): boolean {
  return (character.lifecycle ?? 'ACTIVE') === 'ACTIVE';
}

function isPatternConflict(result: CharacterPatternOperationResult): boolean {
  return result.currentRevision != null || (result.rowDiffs?.length ?? 0) > 0;
}

function idleDeepSync(): CharacterManagementDeepSyncState {
  return { status: 'idle', progress: null, errorMessage: null };
}
