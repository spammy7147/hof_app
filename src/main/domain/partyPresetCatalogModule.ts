import type {
  CreatePartyPresetRequest,
  PartyPresetCatalogResponse,
  PartyPresetResponse,
  ReorderPartyPresetsRequest,
  UpdatePartyPresetRequest,
} from '../types/api';

const LOAD_ERROR_MESSAGE = '파티 프리셋을 불러오지 못했습니다.';
const MUTATION_ERROR_MESSAGE = '파티 프리셋을 변경하지 못했습니다.';

export type PartyPresetCatalogResource = {
  catalog: PartyPresetCatalogResponse;
  loading: boolean;
  error: string | null;
  mutationError?: string | null;
  retry: () => void;
};

type CatalogLoadOutcome = 'success' | 'failure' | 'stale' | 'skipped' | 'inactive';

export type PartyPresetCatalogBackend = {
  loadCatalog: () => Promise<PartyPresetCatalogResponse>;
  createPreset: (request: CreatePartyPresetRequest) => Promise<PartyPresetResponse>;
  updatePreset: (
    presetId: number,
    request: UpdatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  makePresetPrimary: (presetId: number) => Promise<PartyPresetResponse>;
  reorderPresets: (
    request: ReorderPartyPresetsRequest,
  ) => Promise<PartyPresetResponse[]>;
  deletePreset: (presetId: number) => Promise<null>;
};

type CatalogProjector<T> = (
  catalog: PartyPresetCatalogResponse,
  result: T,
) => PartyPresetCatalogResponse;

type OptimisticMutation = {
  id: number;
  project: (catalog: PartyPresetCatalogResponse) => PartyPresetCatalogResponse;
};

class CatalogMutationBlockedError extends Error {
  constructor() {
    super('Party preset catalog refresh required');
  }
}

/**
 * 파티 프리셋 카탈로그의 계정별 조회 상태와 변경 순서를 소유한다.
 *
 * 화면은 immutable snapshot만 구독하며, 늦은 응답과 backend 재조회 수렴은
 * 이 module 경계 밖에서 별도로 조립하지 않는다.
 */
export class PartyPresetCatalogModule {
  private readonly listeners = new Set<() => void>();
  private accountKey: unknown = null;
  private accountGeneration = 0;
  private requestGeneration = 0;
  private activeRequestGeneration: number | null = null;
  private loaded = false;
  private active = false;
  private mutationTail: Promise<void> = Promise.resolve();
  private nextMutationId = 0;
  private optimisticMutations: OptimisticMutation[] = [];
  private authoritativeCatalog = emptyCatalog();
  private loadError: string | null = null;
  private mutationError: string | null = null;
  private mutationBlocked = true;
  private snapshot: PartyPresetCatalogResource;

  constructor(private readonly backend: PartyPresetCatalogBackend) {
    this.snapshot = this.emptySnapshot();
  }

  getSnapshot = (): PartyPresetCatalogResource => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  retry = (): void => {
    this.mutationError = null;
    void this.reload();
  };

  activate(accountKey: unknown): Promise<CatalogLoadOutcome> {
    if (this.active && Object.is(this.accountKey, accountKey)) {
      return this.load(false);
    }

    this.accountKey = accountKey;
    this.accountGeneration += 1;
    this.requestGeneration += 1;
    this.activeRequestGeneration = null;
    this.loaded = false;
    this.active = true;
    this.mutationTail = Promise.resolve();
    this.optimisticMutations = [];
    this.authoritativeCatalog = emptyCatalog();
    this.loadError = null;
    this.mutationError = null;
    this.mutationBlocked = true;
    this.snapshot = this.emptySnapshot();
    return this.load(false);
  }

  deactivate(): void {
    if (!this.active && isEmptySnapshot(this.snapshot)) return;
    this.accountKey = null;
    this.accountGeneration += 1;
    this.requestGeneration += 1;
    this.activeRequestGeneration = null;
    this.loaded = false;
    this.active = false;
    this.mutationTail = Promise.resolve();
    this.optimisticMutations = [];
    this.authoritativeCatalog = emptyCatalog();
    this.loadError = null;
    this.mutationError = null;
    this.mutationBlocked = true;
    this.publish(this.emptySnapshot());
  }

  reload(): Promise<CatalogLoadOutcome> {
    return this.load(true);
  }

  createPreset(request: CreatePartyPresetRequest): Promise<PartyPresetResponse> {
    return this.enqueueMutation(
      () => this.backend.createPreset(request),
      projectPresetUpsert,
    );
  }

  updatePreset(
    presetId: number,
    request: UpdatePartyPresetRequest,
  ): Promise<PartyPresetResponse> {
    return this.enqueueMutation(
      () => this.backend.updatePreset(presetId, request),
      projectPresetUpsert,
    );
  }

  makePresetPrimary(presetId: number): Promise<PartyPresetResponse> {
    return this.enqueueMutation(
      () => this.backend.makePresetPrimary(presetId),
      projectPrimaryPreset,
      true,
      (catalog) => projectPrimaryPresetId(catalog, presetId),
    );
  }

  reorderPresets(
    request: ReorderPartyPresetsRequest,
  ): Promise<PartyPresetResponse[]> {
    return this.enqueueMutation(
      () => this.backend.reorderPresets(request),
      mergePresetMutationResponse,
      true,
      (catalog) => projectPresetReorder(catalog, request),
    );
  }

  deletePreset(presetId: number): Promise<null> {
    return this.enqueueMutation(
      () => this.backend.deletePreset(presetId),
      (catalog) => projectPresetDelete(catalog, presetId),
      true,
      (catalog) => projectPresetDelete(catalog, presetId),
    );
  }

  /** expand 단계 동안 아직 이전되지 않은 동작도 같은 queue를 사용한다. */
  runCompatibilityMutation<T>(
    operation: () => Promise<T>,
    project: CatalogProjector<T>,
    reload = true,
  ): Promise<T> {
    return this.enqueueMutation(operation, project, reload);
  }

  private async load(force: boolean): Promise<CatalogLoadOutcome> {
    if (!this.active) return 'inactive';
    if (!force && (this.activeRequestGeneration != null || this.loaded)) return 'skipped';

    const accountGeneration = this.accountGeneration;
    const requestGeneration = ++this.requestGeneration;
    this.activeRequestGeneration = requestGeneration;
    this.loadError = null;
    this.publishProjection(true);

    try {
      const catalog = await this.backend.loadCatalog();
      if (!this.isCurrent(accountGeneration, requestGeneration)) return 'stale';
      this.loaded = true;
      this.activeRequestGeneration = null;
      this.authoritativeCatalog = catalog;
      this.loadError = null;
      this.mutationBlocked = false;
      this.publishProjection(false);
      return 'success';
    } catch {
      if (!this.isCurrent(accountGeneration, requestGeneration)) return 'stale';
      this.activeRequestGeneration = null;
      this.loadError = LOAD_ERROR_MESSAGE;
      this.publishProjection(false);
      return 'failure';
    }
  }

  private enqueueMutation<T>(
    operation: () => Promise<T>,
    project: CatalogProjector<T>,
    reload = true,
    optimisticProject?: (
      catalog: PartyPresetCatalogResponse,
    ) => PartyPresetCatalogResponse,
  ): Promise<T> {
    if (!this.active) return Promise.reject(new Error('Party preset mutation cancelled'));
    if (this.mutationBlocked) return Promise.reject(new CatalogMutationBlockedError());
    const accountGeneration = this.accountGeneration;
    const optimisticMutation = optimisticProject == null
      ? null
      : { id: ++this.nextMutationId, project: optimisticProject };
    if (optimisticMutation != null) this.optimisticMutations.push(optimisticMutation);
    this.mutationError = null;
    this.publishProjection(this.snapshot.loading);
    const queued = this.mutationTail.then(async () => {
      try {
        this.requireCurrentAccount(accountGeneration);
        if (this.mutationBlocked) throw new CatalogMutationBlockedError();
        this.mutationError = null;
        this.publishProjection(this.snapshot.loading);
        const result = await operation();
        if (!this.isCurrentAccount(accountGeneration)) return result;

        this.removeOptimisticMutation(optimisticMutation?.id);
        this.replace(project(this.authoritativeCatalog, result));
        if (reload) await this.load(true);
        return result;
      } catch (error) {
        if (this.isCurrentAccount(accountGeneration)) {
          this.removeOptimisticMutation(optimisticMutation?.id);
          if (error instanceof CatalogMutationBlockedError) {
            this.publishProjection(this.snapshot.loading);
          } else {
            this.mutationError = MUTATION_ERROR_MESSAGE;
            this.mutationBlocked = true;
            this.publishProjection(this.snapshot.loading);
            await this.load(true);
          }
        }
        throw error;
      }
    });
    this.mutationTail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private replace(catalog: PartyPresetCatalogResponse): void {
    this.requestGeneration += 1;
    this.activeRequestGeneration = null;
    this.loaded = true;
    this.authoritativeCatalog = catalog;
    this.publishProjection(false);
  }

  private removeOptimisticMutation(id: number | undefined): void {
    if (id == null) return;
    this.optimisticMutations = this.optimisticMutations.filter(
      (mutation) => mutation.id !== id,
    );
  }

  private publishProjection(loading: boolean): void {
    const catalog = this.optimisticMutations.reduce(
      (current, mutation) => mutation.project(current),
      this.authoritativeCatalog,
    );
    this.publish({
      catalog,
      loading,
      error: this.loadError,
      mutationError: this.mutationError,
      retry: this.retry,
    });
  }

  private requireCurrentAccount(accountGeneration: number): void {
    if (!this.isCurrentAccount(accountGeneration)) {
      throw new Error('Party preset mutation cancelled');
    }
  }

  private isCurrentAccount(accountGeneration: number): boolean {
    return this.active && accountGeneration === this.accountGeneration;
  }

  private isCurrent(accountGeneration: number, requestGeneration: number): boolean {
    return this.isCurrentAccount(accountGeneration)
      && requestGeneration === this.activeRequestGeneration;
  }

  private emptySnapshot(): PartyPresetCatalogResource {
    return {
      catalog: emptyCatalog(),
      loading: false,
      error: null,
      mutationError: null,
      retry: this.retry,
    };
  }

  private publish(snapshot: PartyPresetCatalogResource): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

function projectPresetUpsert(
  catalog: PartyPresetCatalogResponse,
  updated: PartyPresetResponse,
): PartyPresetCatalogResponse {
  const existing = catalog.presets.find(({ id }) => id === updated.id) ?? null;
  const sourceFolderId = existing?.folderId;
  const targetFolderId = updated.folderId;
  const withoutUpdated = catalog.presets.filter(({ id }) => id !== updated.id);
  const affectedFolderIds = new Set<number | null>([targetFolderId]);
  if (sourceFolderId !== undefined) affectedFolderIds.add(sourceFolderId);
  const normalizedById = new Map<number, PartyPresetResponse>();

  for (const folderId of affectedFolderIds) {
    const siblings = withoutUpdated
      .filter((preset) => preset.folderId === folderId)
      .sort(comparePresetOrder);
    if (folderId === targetFolderId) {
      const staysInFolder = existing?.folderId === targetFolderId;
      const insertionIndex = staysInFolder
        ? Math.max(0, Math.min(updated.displayOrder, siblings.length))
        : 0;
      siblings.splice(insertionIndex, 0, updated);
    }
    siblings.forEach((preset, displayOrder) => {
      normalizedById.set(preset.id, { ...preset, displayOrder });
    });
  }

  const presets = catalog.presets.map(
    (preset) => normalizedById.get(preset.id) ?? preset,
  );
  if (existing == null) {
    presets.push(normalizedById.get(updated.id) ?? { ...updated, displayOrder: 0 });
  }
  return { ...catalog, presets };
}

function projectPrimaryPreset(
  catalog: PartyPresetCatalogResponse,
  updated: PartyPresetResponse,
): PartyPresetCatalogResponse {
  if (!catalog.presets.some(({ id }) => id === updated.id)) return catalog;
  return {
    ...catalog,
    presets: catalog.presets.map((preset) =>
      preset.id === updated.id
        ? { ...updated, isPrimary: true }
        : { ...preset, isPrimary: false },
    ),
  };
}

function projectPrimaryPresetId(
  catalog: PartyPresetCatalogResponse,
  presetId: number,
): PartyPresetCatalogResponse {
  if (!catalog.presets.some(({ id }) => id === presetId)) return catalog;
  return {
    ...catalog,
    presets: catalog.presets.map((preset) => ({
      ...preset,
      isPrimary: preset.id === presetId,
    })),
  };
}

function projectPresetReorder(
  catalog: PartyPresetCatalogResponse,
  request: ReorderPartyPresetsRequest,
): PartyPresetCatalogResponse {
  const folderId = request.folderId ?? null;
  const displayOrderById = new Map(
    request.presetIds.map((presetId, displayOrder) => [presetId, displayOrder]),
  );
  return {
    ...catalog,
    presets: catalog.presets.map((preset) => {
      if (preset.folderId !== folderId) return preset;
      const displayOrder = displayOrderById.get(preset.id);
      return displayOrder == null ? preset : { ...preset, displayOrder };
    }),
  };
}

function mergePresetMutationResponse(
  catalog: PartyPresetCatalogResponse,
  returned: PartyPresetResponse[],
): PartyPresetCatalogResponse {
  const returnedById = new Map(returned.map((preset) => [preset.id, preset]));
  const existingIds = new Set(catalog.presets.map(({ id }) => id));
  return {
    ...catalog,
    presets: [
      ...catalog.presets.map((preset) => returnedById.get(preset.id) ?? preset),
      ...returned.filter(({ id }) => !existingIds.has(id)),
    ],
  };
}

function projectPresetDelete(
  catalog: PartyPresetCatalogResponse,
  presetId: number,
): PartyPresetCatalogResponse {
  return {
    ...catalog,
    presets: catalog.presets.filter((preset) => preset.id !== presetId),
  };
}

function comparePresetOrder(
  left: PartyPresetResponse,
  right: PartyPresetResponse,
): number {
  return left.displayOrder - right.displayOrder || left.id - right.id;
}

function emptyCatalog(): PartyPresetCatalogResponse {
  return { folders: [], presets: [] };
}

function isEmptySnapshot(snapshot: PartyPresetCatalogResource): boolean {
  return !snapshot.loading
    && snapshot.error == null
    && snapshot.catalog.folders.length === 0
    && snapshot.catalog.presets.length === 0;
}
