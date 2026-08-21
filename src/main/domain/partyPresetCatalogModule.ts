import type {
  CreatePartyPresetFolderRequest,
  CreatePartyPresetRequest,
  MovePartyPresetFolderRequest,
  PartyPresetCatalogResponse,
  PartyPresetFolderResponse,
  PartyPresetResponse,
  RenamePartyPresetFolderRequest,
  ReorderPartyPresetFoldersRequest,
  ReorderPartyPresetsRequest,
  UpdatePartyPresetRequest,
} from '../types/api';
import {
  canMovePartyPresetFolder,
  indexPartyPresetCatalog,
} from './partyPresetCatalog';

const LOAD_ERROR_MESSAGE = '파티 프리셋을 불러오지 못했습니다.';
const MUTATION_ERROR_MESSAGE = '파티 프리셋을 변경하지 못했습니다.';

export type PartyPresetCatalogActions = {
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
  createFolder: (
    request: CreatePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  renameFolder: (
    folderId: number,
    request: RenamePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  reorderFolders: (
    request: ReorderPartyPresetFoldersRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  moveFolder: (
    folderId: number,
    request: MovePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  deleteFolder: (folderId: number) => Promise<PartyPresetCatalogResponse>;
};

export type PartyPresetCatalogResource = {
  catalog: PartyPresetCatalogResponse;
  loading: boolean;
  error: string | null;
  mutationError: string | null;
  mutating: boolean;
  retry: () => void;
  actions: PartyPresetCatalogActions;
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
  createFolder: (
    request: CreatePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  renameFolder: (
    folderId: number,
    request: RenamePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  reorderFolders: (
    request: ReorderPartyPresetFoldersRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  moveFolder: (
    folderId: number,
    request: MovePartyPresetFolderRequest,
  ) => Promise<PartyPresetCatalogResponse>;
  deleteFolder: (folderId: number) => Promise<PartyPresetCatalogResponse>;
};

type CatalogProjector<T> = (
  catalog: PartyPresetCatalogResponse,
  result: T,
) => PartyPresetCatalogResponse;

type OptimisticMutation = {
  id: number;
  project: (catalog: PartyPresetCatalogResponse) => PartyPresetCatalogResponse;
};

type CatalogMutationPrecondition = (
  catalog: PartyPresetCatalogResponse,
) => boolean;

class CatalogMutationBlockedError extends Error {
  constructor() {
    super('Party preset catalog refresh required');
  }
}

class CatalogMutationStaleError extends Error {
  constructor() {
    super('Party preset catalog changed before queued mutation');
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
  private pendingMutationCount = 0;
  private actions: PartyPresetCatalogActions;
  private snapshot: PartyPresetCatalogResource;

  constructor(private readonly backend: PartyPresetCatalogBackend) {
    this.actions = this.createActions(this.accountGeneration);
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
    this.actions = this.createActions(this.accountGeneration);
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
    this.pendingMutationCount = 0;
    this.snapshot = this.emptySnapshot();
    return this.load(false);
  }

  deactivate(): void {
    if (!this.active && isEmptySnapshot(this.snapshot)) return;
    this.accountKey = null;
    this.accountGeneration += 1;
    this.actions = this.createActions(this.accountGeneration);
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
    this.pendingMutationCount = 0;
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

  createFolder(
    request: CreatePartyPresetFolderRequest,
  ): Promise<PartyPresetCatalogResponse> {
    return this.enqueueMutation(
      () => this.backend.createFolder(request),
      replaceWithReturnedCatalog,
      false,
      undefined,
      (catalog) => request.parentFolderId == null
        || catalog.folders.some(({ id }) => id === request.parentFolderId),
    );
  }

  renameFolder(
    folderId: number,
    request: RenamePartyPresetFolderRequest,
  ): Promise<PartyPresetCatalogResponse> {
    return this.enqueueMutation(
      () => this.backend.renameFolder(folderId, request),
      replaceWithReturnedCatalog,
      false,
      (catalog) => projectFolderRename(catalog, folderId, request.name),
      (catalog) => catalog.folders.some(({ id }) => id === folderId),
    );
  }

  reorderFolders(
    request: ReorderPartyPresetFoldersRequest,
  ): Promise<PartyPresetCatalogResponse> {
    return this.enqueueMutation(
      () => this.backend.reorderFolders(request),
      replaceWithReturnedCatalog,
      false,
      (catalog) => projectFolderReorder(catalog, request),
      (catalog) => isFolderReorderApplicable(catalog, request),
    );
  }

  moveFolder(
    folderId: number,
    request: MovePartyPresetFolderRequest,
  ): Promise<PartyPresetCatalogResponse> {
    const expectedContext = folderMoveContext(
      this.snapshot.catalog,
      folderId,
      request,
    );
    return this.enqueueMutation(
      () => this.backend.moveFolder(folderId, request),
      replaceWithReturnedCatalog,
      false,
      (catalog) => projectFolderMove(catalog, folderId, request),
      (catalog) => expectedContext != null
        && folderMoveContext(catalog, folderId, request) === expectedContext,
    );
  }

  deleteFolder(folderId: number): Promise<PartyPresetCatalogResponse> {
    return this.enqueueMutation(
      () => this.backend.deleteFolder(folderId),
      replaceWithReturnedCatalog,
      false,
      (catalog) => projectFolderDelete(catalog, folderId),
      (catalog) => catalog.folders.some(({ id }) => id === folderId),
    );
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
    precondition?: CatalogMutationPrecondition,
  ): Promise<T> {
    if (!this.active) return Promise.reject(new Error('Party preset mutation cancelled'));
    if (this.mutationBlocked) return Promise.reject(new CatalogMutationBlockedError());
    const accountGeneration = this.accountGeneration;
    const optimisticMutation = optimisticProject == null
      ? null
      : { id: ++this.nextMutationId, project: optimisticProject };
    if (optimisticMutation != null) this.optimisticMutations.push(optimisticMutation);
    this.pendingMutationCount += 1;
    this.mutationError = null;
    this.publishProjection(this.snapshot.loading);
    const queued = this.mutationTail.then(async () => {
      try {
        this.requireCurrentAccount(accountGeneration);
        if (this.mutationBlocked) throw new CatalogMutationBlockedError();
        if (precondition != null && !precondition(this.authoritativeCatalog)) {
          throw new CatalogMutationStaleError();
        }
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
          } else if (error instanceof CatalogMutationStaleError) {
            this.mutationError = MUTATION_ERROR_MESSAGE;
            this.publishProjection(this.snapshot.loading);
          } else {
            this.mutationError = MUTATION_ERROR_MESSAGE;
            this.mutationBlocked = true;
            this.publishProjection(this.snapshot.loading);
            await this.load(true);
          }
        }
        throw error;
      } finally {
        if (this.isCurrentAccount(accountGeneration)) {
          this.pendingMutationCount = Math.max(0, this.pendingMutationCount - 1);
          this.publishProjection(this.snapshot.loading);
        }
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
      mutating: this.pendingMutationCount > 0,
      retry: this.retry,
      actions: this.actions,
    });
  }

  private requireCurrentAccount(accountGeneration: number): void {
    if (!this.isCurrentAccount(accountGeneration)) {
      throw new Error('Party preset mutation cancelled');
    }
  }

  private createActions(accountGeneration: number): PartyPresetCatalogActions {
    const current = <T,>(operation: () => Promise<T>): Promise<T> => {
      if (!this.isCurrentAccount(accountGeneration)) {
        return Promise.reject(new Error('Party preset mutation cancelled'));
      }
      return operation();
    };
    return {
      createPreset: (request) => current(() => this.createPreset(request)),
      updatePreset: (presetId, request) => current(
        () => this.updatePreset(presetId, request),
      ),
      makePresetPrimary: (presetId) => current(
        () => this.makePresetPrimary(presetId),
      ),
      reorderPresets: (request) => current(() => this.reorderPresets(request)),
      deletePreset: (presetId) => current(() => this.deletePreset(presetId)),
      createFolder: (request) => current(() => this.createFolder(request)),
      renameFolder: (folderId, request) => current(
        () => this.renameFolder(folderId, request),
      ),
      reorderFolders: (request) => current(() => this.reorderFolders(request)),
      moveFolder: (folderId, request) => current(
        () => this.moveFolder(folderId, request),
      ),
      deleteFolder: (folderId) => current(() => this.deleteFolder(folderId)),
    };
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
      mutating: false,
      retry: this.retry,
      actions: this.actions,
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

function replaceWithReturnedCatalog(
  _catalog: PartyPresetCatalogResponse,
  returned: PartyPresetCatalogResponse,
): PartyPresetCatalogResponse {
  return returned;
}

function projectFolderRename(
  catalog: PartyPresetCatalogResponse,
  folderId: number,
  name: string,
): PartyPresetCatalogResponse {
  if (!catalog.folders.some(({ id }) => id === folderId)) return catalog;
  return {
    ...catalog,
    folders: catalog.folders.map((folder) =>
      folder.id === folderId ? { ...folder, name } : folder,
    ),
  };
}

function projectFolderReorder(
  catalog: PartyPresetCatalogResponse,
  request: ReorderPartyPresetFoldersRequest,
): PartyPresetCatalogResponse {
  const displayOrderById = new Map(
    request.folderIds.map((folderId, displayOrder) => [folderId, displayOrder]),
  );
  return {
    ...catalog,
    folders: catalog.folders.map((folder) => {
      if (folder.parentFolderId !== request.parentFolderId) return folder;
      const displayOrder = displayOrderById.get(folder.id);
      return displayOrder == null ? folder : { ...folder, displayOrder };
    }),
  };
}

function isFolderReorderApplicable(
  catalog: PartyPresetCatalogResponse,
  request: ReorderPartyPresetFoldersRequest,
): boolean {
  if (
    request.parentFolderId != null
    && !catalog.folders.some(({ id }) => id === request.parentFolderId)
  ) return false;
  if (new Set(request.folderIds).size !== request.folderIds.length) return false;
  const currentIds = catalog.folders
    .filter((folder) => folder.parentFolderId === request.parentFolderId)
    .map(({ id }) => id);
  return currentIds.length === request.folderIds.length
    && currentIds.every((id) => request.folderIds.includes(id));
}

function projectFolderMove(
  catalog: PartyPresetCatalogResponse,
  folderId: number,
  request: MovePartyPresetFolderRequest,
): PartyPresetCatalogResponse {
  const moving = catalog.folders.find((folder) => folder.id === folderId);
  if (moving == null) return catalog;

  const nextPositions = new Map<
    number,
    Pick<PartyPresetFolderResponse, 'parentFolderId' | 'displayOrder'>
  >();
  const sourceSiblings = catalog.folders
    .filter((folder) => folder.parentFolderId === moving.parentFolderId && folder.id !== folderId)
    .sort(compareFolderOrder);
  sourceSiblings.forEach((folder, displayOrder) => {
    nextPositions.set(folder.id, {
      parentFolderId: folder.parentFolderId,
      displayOrder,
    });
  });
  const targetSiblings = request.parentFolderId === moving.parentFolderId
    ? sourceSiblings
    : catalog.folders
        .filter((folder) => folder.parentFolderId === request.parentFolderId && folder.id !== folderId)
        .sort(compareFolderOrder);
  const insertionIndex = Math.max(
    0,
    Math.min(request.displayOrder, targetSiblings.length),
  );
  const nextTargetSiblings = [...targetSiblings];
  nextTargetSiblings.splice(insertionIndex, 0, moving);
  nextTargetSiblings.forEach((folder, displayOrder) => {
    nextPositions.set(folder.id, {
      parentFolderId: request.parentFolderId,
      displayOrder,
    });
  });
  return {
    ...catalog,
    folders: catalog.folders.map((folder) => {
      const position = nextPositions.get(folder.id);
      return position == null ? folder : { ...folder, ...position };
    }),
  };
}

function isFolderMoveApplicable(
  catalog: PartyPresetCatalogResponse,
  folderId: number,
  request: MovePartyPresetFolderRequest,
): boolean {
  const moving = catalog.folders.find((folder) => folder.id === folderId);
  if (moving == null) return false;
  const index = indexPartyPresetCatalog(catalog);
  if (!canMovePartyPresetFolder(index, folderId, request.parentFolderId)) return false;
  const targetSiblingCount = catalog.folders.filter(
    (folder) => folder.parentFolderId === request.parentFolderId && folder.id !== folderId,
  ).length;
  const normalizedMovingName = moving.name.trim().toLocaleLowerCase();
  const hasNameCollision = catalog.folders.some((folder) =>
    folder.id !== folderId
    && folder.parentFolderId === request.parentFolderId
    && folder.name.trim().toLocaleLowerCase() === normalizedMovingName,
  );
  return !hasNameCollision
    && Number.isInteger(request.displayOrder)
    && request.displayOrder >= 0
    && request.displayOrder <= targetSiblingCount;
}

function folderMoveContext(
  catalog: PartyPresetCatalogResponse,
  folderId: number,
  request: MovePartyPresetFolderRequest,
): string | null {
  if (!isFolderMoveApplicable(catalog, folderId, request)) return null;
  const moving = catalog.folders.find((folder) => folder.id === folderId)!;
  const sourceSiblings = catalog.folders
    .filter((folder) => folder.parentFolderId === moving.parentFolderId && folder.id !== folderId)
    .sort(compareFolderOrder)
    .map(folderMoveContextRow);
  const targetSiblings = catalog.folders
    .filter((folder) => folder.parentFolderId === request.parentFolderId && folder.id !== folderId)
    .sort(compareFolderOrder)
    .map(folderMoveContextRow);
  const ancestorIds: number[] = [];
  const byId = new Map(catalog.folders.map((folder) => [folder.id, folder]));
  let ancestorId = request.parentFolderId;
  while (ancestorId != null) {
    ancestorIds.push(ancestorId);
    ancestorId = byId.get(ancestorId)?.parentFolderId ?? null;
  }
  const subtreeRows: Array<[number, number | null]> = [];
  const pending = [folderId];
  const visited = new Set<number>();
  while (pending.length > 0) {
    const currentId = pending.shift();
    if (currentId == null || visited.has(currentId)) continue;
    visited.add(currentId);
    const current = byId.get(currentId);
    if (current == null) continue;
    subtreeRows.push([current.id, current.parentFolderId]);
    pending.push(
      ...catalog.folders
        .filter((folder) => folder.parentFolderId === currentId)
        .sort(compareFolderOrder)
        .map(({ id }) => id),
    );
  }
  return JSON.stringify({
    moving: folderMoveContextRow(moving),
    sourceSiblings,
    targetSiblings,
    ancestorIds,
    subtreeRows,
  });
}

function folderMoveContextRow(
  folder: PartyPresetFolderResponse,
): [number, number | null, number, string] {
  return [
    folder.id,
    folder.parentFolderId,
    folder.displayOrder,
    folder.name.trim().toLocaleLowerCase(),
  ];
}

function projectFolderDelete(
  catalog: PartyPresetCatalogResponse,
  folderId: number,
): PartyPresetCatalogResponse {
  const deleting = catalog.folders.find((folder) => folder.id === folderId);
  if (deleting == null) return catalog;

  const unassignedPresets = catalog.presets
    .filter((preset) => preset.folderId == null)
    .sort(comparePresetOrder);
  const directPresets = catalog.presets
    .filter((preset) => preset.folderId === folderId)
    .sort(comparePresetOrder);
  const nextPresetsById = new Map<number, PartyPresetResponse>();
  [...unassignedPresets, ...directPresets].forEach((preset, displayOrder) => {
    nextPresetsById.set(preset.id, { ...preset, folderId: null, displayOrder });
  });

  const destinationSiblings = catalog.folders
    .filter((folder) => folder.parentFolderId === deleting.parentFolderId && folder.id !== folderId)
    .sort(compareFolderOrder);
  const immediateChildren = catalog.folders
    .filter((folder) => folder.parentFolderId === folderId)
    .sort(compareFolderOrder);
  const nextFoldersById = new Map<number, PartyPresetFolderResponse>();
  [...destinationSiblings, ...immediateChildren].forEach((folder, displayOrder) => {
    nextFoldersById.set(folder.id, {
      ...folder,
      parentFolderId: deleting.parentFolderId,
      displayOrder,
    });
  });

  return {
    folders: catalog.folders
      .filter((folder) => folder.id !== folderId)
      .map((folder) => nextFoldersById.get(folder.id) ?? folder),
    presets: catalog.presets.map((preset) => nextPresetsById.get(preset.id) ?? preset),
  };
}

function comparePresetOrder(
  left: PartyPresetResponse,
  right: PartyPresetResponse,
): number {
  return left.displayOrder - right.displayOrder || left.id - right.id;
}

function compareFolderOrder(
  left: PartyPresetFolderResponse,
  right: PartyPresetFolderResponse,
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
