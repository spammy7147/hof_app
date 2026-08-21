import { toUserFacingErrorMessage } from './userFacingErrors';
import type { HofCharacter, HofCharacterDetail } from '../types/api';

const DEFAULT_FRESHNESS_MS = 30 * 60 * 1000;

export type CharacterManagementHubBackend = {
  loadStoredDetail: (characterId: number) => Promise<HofCharacterDetail>;
  refreshAuthoritativeDetail: (characterId: number) => Promise<HofCharacterDetail>;
};

export type CharacterManagementHubActions = {
  select: (character: HofCharacter) => Promise<void>;
  close: () => void;
  reloadStored: () => Promise<void>;
  refresh: () => Promise<void>;
};

export type CharacterManagementHubResource = {
  selectedCharacter: HofCharacter | null;
  detail: HofCharacterDetail | null;
  isLoading: boolean;
  errorMessage: string | null;
  warningMessage: string | null;
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
  private requestGeneration = 0;
  private roster = new Map<number, HofCharacter>();
  private resource: CharacterManagementHubResource;

  constructor(
    private readonly backend: CharacterManagementHubBackend,
    options: CharacterManagementHubOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.freshnessMs = options.freshnessMs ?? DEFAULT_FRESHNESS_MS;
    this.resource = emptyResource(this.actionsFor(this.generation));
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
    this.requestGeneration += 1;
    this.roster = new Map();
    this.replace(emptyResource(this.actionsFor(this.generation)));
  }

  deactivate(): void {
    this.accountKey = null;
    this.generation += 1;
    this.requestGeneration += 1;
    this.roster = new Map();
    this.replace(emptyResource(this.actionsFor(this.generation)));
  }

  observeRoster(characters: HofCharacter[]): void {
    this.roster = new Map(characters.map((character) => [character.id, character]));
    const selected = this.resource.selectedCharacter;
    if (!selected) return;
    const observed = this.roster.get(selected.id);
    if (!observed || !isActive(observed)) {
      this.close(this.generation);
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
  ): Promise<void> {
    if (!this.isActiveGeneration(expectedGeneration)) return;
    const selected = this.roster.get(candidate.id);
    if (!selected || !isActive(selected)) return;
    const request = ++this.requestGeneration;
    const generation = this.generation;
    this.replace({
      ...this.resource,
      selectedCharacter: selected,
      detail: null,
      isLoading: true,
      errorMessage: null,
      warningMessage: null,
    });
    await this.loadStored(selected.id, generation, request, true, selected);
  }

  private close(expectedGeneration: number): void {
    if (!this.isActiveGeneration(expectedGeneration)) return;
    this.requestGeneration += 1;
    this.replace(emptyResource(this.resource.actions));
  }

  private async reloadStored(expectedGeneration: number): Promise<void> {
    if (!this.isActiveGeneration(expectedGeneration)) return;
    const selected = this.resource.selectedCharacter;
    if (!selected) return;
    const request = ++this.requestGeneration;
    await this.loadStored(
      selected.id,
      this.generation,
      request,
      false,
      selected,
    );
  }

  private async loadStored(
    characterId: number,
    generation: number,
    request: number,
    initial: boolean,
    rosterBaseline: HofCharacter,
  ): Promise<void> {
    try {
      const detail = await this.backend.loadStoredDetail(characterId);
      if (!this.isCurrent(characterId, generation, request)) return;
      const mergedDetail = this.mergeRosterObservedAfter(detail, rosterBaseline);
      this.replace({
        ...this.resource,
        detail: mergedDetail,
        isLoading: false,
        errorMessage: null,
        warningMessage: null,
      });
      if (this.isStale(mergedDetail)) {
        const refreshBaseline = this.resource.selectedCharacter ?? rosterBaseline;
        void this.refreshAuthority(
          characterId,
          generation,
          request,
          false,
          refreshBaseline,
        );
      }
    } catch (error: unknown) {
      if (!this.isCurrent(characterId, generation, request)) return;
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

  private async refresh(expectedGeneration: number): Promise<void> {
    if (!this.isActiveGeneration(expectedGeneration)) return;
    const selected = this.resource.selectedCharacter;
    if (!selected) return;
    const request = ++this.requestGeneration;
    await this.refreshAuthority(
      selected.id,
      this.generation,
      request,
      true,
      selected,
    );
  }

  private async refreshAuthority(
    characterId: number,
    generation: number,
    request: number,
    reportError: boolean,
    rosterBaseline: HofCharacter,
  ): Promise<void> {
    try {
      const detail = await this.backend.refreshAuthoritativeDetail(characterId);
      if (!this.isCurrent(characterId, generation, request)) return;
      this.replace({
        ...this.resource,
        detail: this.mergeRosterObservedAfter(detail, rosterBaseline),
        errorMessage: null,
        warningMessage: null,
      });
    } catch (error: unknown) {
      if (!reportError || !this.isCurrent(characterId, generation, request)) return;
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
    request: number,
  ): boolean {
    return this.accountKey != null
      && this.generation === generation
      && this.requestGeneration === request
      && this.resource.selectedCharacter?.id === characterId;
  }

  private isActiveGeneration(expectedGeneration: number): boolean {
    return this.accountKey != null && this.generation === expectedGeneration;
  }

  private actionsFor(generation: number): CharacterManagementHubActions {
    return {
      select: (character) => this.select(character, generation),
      close: () => this.close(generation),
      reloadStored: () => this.reloadStored(generation),
      refresh: () => this.refresh(generation),
    };
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
    actions,
  };
}

function isActive(character: HofCharacter): boolean {
  return (character.lifecycle ?? 'ACTIVE') === 'ACTIVE';
}
