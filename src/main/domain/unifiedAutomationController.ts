import { UnifiedAutomationReorderQueue } from './unifiedAutomationReorder';
import { toUserFacingErrorMessage } from './userFacingErrors';
import type {
  AutomationType,
  CreateAutomationEntryRequest,
  CreateUnifiedAutomationModuleRequest,
  TypedAutomationAggregateResponse,
  TypedAutomationEntryResponse,
  UnifiedAutomationAction,
  UnifiedAutomationMap,
  UnifiedAutomationModuleResponse,
  UnifiedAutomationModuleType,
  UnifiedAutomationStatusResponse,
  UpdateAdventureMapAutomationRequest,
  UpdateBattleMapAutomationRequest,
  UpdateQuestAutomationRequest,
  UpdateUnifiedAutomationModuleRequest,
} from '../types/api';

export type UnifiedAutomationControllerApi = {
  fetch: () => Promise<TypedAutomationAggregateResponse>;
  create: (request: CreateAutomationEntryRequest) => Promise<TypedAutomationAggregateResponse>;
  delete: (entryId: number) => Promise<TypedAutomationAggregateResponse>;
  reorder: (entryIds: number[]) => Promise<TypedAutomationAggregateResponse>;
  updateQuest: (request: UpdateQuestAutomationRequest) => Promise<TypedAutomationAggregateResponse>;
  updateBattle: (request: UpdateBattleMapAutomationRequest) => Promise<TypedAutomationAggregateResponse>;
  updateAdventure: (request: UpdateAdventureMapAutomationRequest) => Promise<TypedAutomationAggregateResponse>;
  changeState: (action: UnifiedAutomationAction) => Promise<TypedAutomationAggregateResponse>;
};

export type UnifiedAutomationControllerSnapshot = {
  aggregate: TypedAutomationAggregateResponse | null;
  loading: boolean;
  actionSaving: boolean;
  savingEntryIds: number[];
  savingTypes: AutomationType[];
  reordering: boolean;
  error: string | null;
  message: string | null;
  /** @deprecated Transitional read-only projection for the pre-typed Task 12 UI. */
  automation: UnifiedAutomationStatusResponse | null;
  /** @deprecated Transitional alias for the pre-typed editor. */
  editorSaving: boolean;
  /** @deprecated Transitional alias for savingEntryIds. */
  savingModuleIds: number[];
};

type ReorderResult = { aggregate: TypedAutomationAggregateResponse; sequence: number };

function initialSnapshot(): UnifiedAutomationControllerSnapshot {
  return {
    aggregate: null,
    automation: null,
    loading: false,
    actionSaving: false,
    editorSaving: false,
    savingEntryIds: [],
    savingModuleIds: [],
    savingTypes: [],
    reordering: false,
    error: null,
    message: null,
  };
}

/** App-owned typed automation store. Async completions are fenced by account generation and revision. */
export class UnifiedAutomationController {
  private snapshot = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private loadSequence = 0;
  private loadingCount = 0;
  private operationSequence = 0;
  private entriesRevision = 0;
  private runtimeRevision = 0;
  private orderRevision = 0;
  private queuedReorderSequence = 0;
  private readonly typeRevisions = new Map<AutomationType, number>();
  private readonly mutationTails = new Map<string, Promise<void>>();
  private structuralTail: Promise<void> | null = null;
  private readonly savingEntryIds = new Set<number>();
  private readonly pendingTypeCounts = new Map<AutomationType, number>();
  private reorderQueue: UnifiedAutomationReorderQueue<ReorderResult>;
  private confirmedOrder: number[] = [];

  constructor(private readonly api: UnifiedAutomationControllerApi) {
    this.reorderQueue = this.createReorderQueue(this.generation);
  }

  getSnapshot = (): UnifiedAutomationControllerSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  reset(): void {
    this.reorderQueue.dispose();
    this.generation += 1;
    this.loadSequence = 0;
    this.loadingCount = 0;
    this.operationSequence = 0;
    this.entriesRevision = 0;
    this.runtimeRevision = 0;
    this.orderRevision = 0;
    this.queuedReorderSequence = 0;
    this.typeRevisions.clear();
    this.mutationTails.clear();
    this.structuralTail = null;
    this.savingEntryIds.clear();
    this.pendingTypeCounts.clear();
    this.confirmedOrder = [];
    this.reorderQueue = this.createReorderQueue(this.generation);
    this.replaceSnapshot(initialSnapshot());
  }

  clearMessage(): void {
    if (this.snapshot.message || this.snapshot.error) this.patchSnapshot({ message: null, error: null });
  }

  showMessage(message: string): void {
    this.patchSnapshot({ message, error: message });
  }

  isEntryBusy(entryId: number): boolean {
    return this.savingEntryIds.has(entryId);
  }

  /** @deprecated Transitional alias until Task 12 replaces the generic module screen. */
  isModuleBusy(moduleId: number): boolean {
    return this.isEntryBusy(moduleId);
  }

  whenReorderIdle(): Promise<void> {
    return this.reorderQueue.whenIdle();
  }

  async load(): Promise<void> {
    const generation = this.generation;
    const sequence = ++this.loadSequence;
    const entriesAtStart = this.entriesRevision;
    const runtimeAtStart = this.runtimeRevision;
    this.loadingCount += 1;
    this.patchSnapshot({ loading: true, error: null, message: null });
    try {
      const loaded = await this.api.fetch();
      if (!this.isLatestLoad(generation, sequence)) return;
      const current = this.snapshot.aggregate;
      const next: TypedAutomationAggregateResponse = {
        entries: this.entriesRevision === entriesAtStart || !current ? loaded.entries : current.entries,
        runtime: this.runtimeRevision === runtimeAtStart || !current ? loaded.runtime : current.runtime,
      };
      if (this.entriesRevision === entriesAtStart) this.confirmedOrder = loaded.entries.map(({ id }) => id);
      this.applyAggregate(next);
    } catch (error) {
      if (this.isLatestLoad(generation, sequence)) this.setError(error);
    } finally {
      if (this.generation === generation) {
        this.loadingCount = Math.max(0, this.loadingCount - 1);
        this.patchSnapshot({ loading: this.loadingCount > 0 });
      }
    }
  }

  createEntry(type: AutomationType): Promise<boolean> {
    return this.runStructuralMutation(type, null, async (sequence, generation) => {
      const response = await this.api.create({ type });
      if (this.generation === generation) this.mergeStructuralResponse(response, sequence, type);
    });
  }

  deleteEntry(entryId: number): Promise<boolean> {
    const type = this.snapshot.aggregate?.entries.find(({ id }) => id === entryId)?.type;
    return this.runStructuralMutation(
      type ?? null,
      entryId,
      async (sequence, generation) => {
        const response = await this.api.delete(entryId);
        if (this.generation === generation) {
          this.mergeStructuralResponse(response, sequence, type ?? null);
        }
      },
    );
  }

  saveQuestSettings(request: UpdateQuestAutomationRequest): Promise<boolean> {
    return this.saveSettings('QUEST', request, (body) => this.api.updateQuest(body));
  }

  saveBattleMapSettings(request: UpdateBattleMapAutomationRequest): Promise<boolean> {
    return this.saveSettings('BATTLE_MAP', request, (body) => this.api.updateBattle(body));
  }

  saveAdventureMapSettings(request: UpdateAdventureMapAutomationRequest): Promise<boolean> {
    return this.saveSettings('ADVENTURE_MAP', request, (body) => this.api.updateAdventure(body));
  }

  reorderEntries(entries: readonly TypedAutomationEntryResponse[]): void {
    const normalized = entries.map((entry, priority) => ({ ...entry, priority }));
    const current = this.snapshot.aggregate;
    if (!current) return;
    const sequence = ++this.operationSequence;
    this.queuedReorderSequence = sequence;
    this.orderRevision = sequence;
    this.entriesRevision = Math.max(this.entriesRevision, sequence);
    this.applyAggregate({ ...current, entries: normalized });
    this.patchSnapshot({ reordering: true, error: null, message: null });
    this.reorderQueue.enqueue(normalized.map(({ id }) => id));
  }

  async changeState(action: UnifiedAutomationAction): Promise<void> {
    if (this.snapshot.actionSaving) return;
    const generation = this.generation;
    const sequence = ++this.operationSequence;
    this.patchSnapshot({ actionSaving: true, error: null, message: null });
    try {
      const response = await this.api.changeState(action);
      if (this.generation !== generation) return;
      const current = this.snapshot.aggregate;
      this.runtimeRevision = Math.max(this.runtimeRevision, sequence);
      this.applyAggregate(current ? { entries: current.entries, runtime: response.runtime } : response);
    } catch (error) {
      if (this.generation === generation) this.setError(error);
    } finally {
      if (this.generation === generation) this.patchSnapshot({ actionSaving: false });
    }
  }

  private saveSettings<T>(
    type: AutomationType,
    request: T,
    persist: (request: T) => Promise<TypedAutomationAggregateResponse>,
  ): Promise<boolean> {
    const entryId = this.snapshot.aggregate?.entries.find((entry) => entry.type === type)?.id ?? null;
    return this.runTypedMutation(`type:${type}`, type, entryId, async (sequence, generation) => {
      const response = await persist(request);
      if (this.generation === generation) this.mergeSettingsResponse(response, sequence, type);
    });
  }

  private runTypedMutation(
    key: string,
    type: AutomationType | null,
    entryId: number | null,
    operation: (sequence: number, generation: number) => Promise<void>,
    trackPendingType = true,
  ): Promise<boolean> {
    const generation = this.generation;
    const sequence = ++this.operationSequence;
    if (trackPendingType && type) this.incrementTypePending(type);
    const previous = this.mutationTails.get(key);
    const execute = async () => {
      if (this.generation !== generation) return false;
      this.beginSaving(entryId);
      try {
        await operation(sequence, generation);
        return this.generation === generation;
      } catch (error) {
        if (this.generation === generation) this.setError(error);
        return false;
      } finally {
        if (this.generation === generation) this.endSaving(entryId);
      }
    };
    const result = previous ? previous.catch(() => undefined).then(execute) : execute();
    const completed = result.then((value) => {
      if (trackPendingType && type && this.generation === generation) {
        this.decrementTypePending(type);
      }
      return value;
    });
    const tail = completed.then(() => undefined);
    this.mutationTails.set(key, tail);
    void tail.finally(() => {
      if (this.mutationTails.get(key) === tail) this.mutationTails.delete(key);
    });
    return completed;
  }

  private runStructuralMutation(
    type: AutomationType | null,
    entryId: number | null,
    operation: (sequence: number, generation: number) => Promise<void>,
  ): Promise<boolean> {
    const generation = this.generation;
    if (type) this.incrementTypePending(type);
    const previous = this.structuralTail;
    const execute = (): Promise<boolean> => {
      if (this.generation !== generation) return Promise.resolve(false);
      const typeKey = type ? `type:${type}` : `entry:${entryId ?? 'unknown'}`;
      return this.runTypedMutation(typeKey, type, entryId, operation, false);
    };
    const result = previous ? previous.catch(() => undefined).then(execute) : execute();
    const completed = result.then((value) => {
      if (type && this.generation === generation) this.decrementTypePending(type);
      return value;
    });
    const tail = completed.then(() => undefined);
    this.structuralTail = tail;
    void tail.finally(() => {
      if (this.structuralTail === tail) this.structuralTail = null;
    });
    return completed;
  }

  private mergeSettingsResponse(
    response: TypedAutomationAggregateResponse,
    sequence: number,
    targetType: AutomationType,
  ): void {
    const current = this.snapshot.aggregate;
    if (!current || (this.typeRevisions.get(targetType) ?? 0) > sequence) return;
    const serverEntry = response.entries.find((entry) => entry.type === targetType);
    const currentIndex = current.entries.findIndex((entry) => entry.type === targetType);
    if (!serverEntry || currentIndex < 0) return;
    const entries = [...current.entries];
    const currentEntry = entries[currentIndex];
    if (!currentEntry) return;
    entries[currentIndex] = {
      ...serverEntry,
      id: currentEntry.id,
      type: currentEntry.type,
      priority: currentEntry.priority,
    };
    this.entriesRevision = Math.max(this.entriesRevision, sequence);
    this.typeRevisions.set(targetType, sequence);
    this.applyAggregate({ entries, runtime: current.runtime });
  }

  private mergeStructuralResponse(
    response: TypedAutomationAggregateResponse,
    sequence: number,
    targetType: AutomationType | null,
  ): void {
    const current = this.snapshot.aggregate;
    if (!current) {
      this.entriesRevision = Math.max(this.entriesRevision, sequence);
      if (targetType) this.typeRevisions.set(targetType, sequence);
      this.confirmedOrder = response.entries.map(({ id }) => id);
      this.applyAggregate(response);
      return;
    }
    if (targetType && (this.typeRevisions.get(targetType) ?? 0) > sequence) return;

    const serverTarget = targetType
      ? response.entries.find((entry) => entry.type === targetType)
      : undefined;
    const currentTargetIndex = targetType
      ? current.entries.findIndex((entry) => entry.type === targetType)
      : -1;
    let entries = targetType
      ? current.entries.filter((entry) => entry.type !== targetType)
      : [...current.entries];
    if (serverTarget) {
      const insertionIndex = currentTargetIndex < 0
        ? entries.length
        : Math.min(currentTargetIndex, entries.length);
      entries.splice(insertionIndex, 0, serverTarget);
    }

    entries = entries.map((entry, priority) => ({ ...entry, priority }));

    this.entriesRevision = Math.max(this.entriesRevision, sequence);
    if (targetType) this.typeRevisions.set(targetType, sequence);
    this.recordConfirmedMembership(entries);
    this.applyAggregate({ entries, runtime: current.runtime });
  }

  private createReorderQueue(generation: number): UnifiedAutomationReorderQueue<ReorderResult> {
    return new UnifiedAutomationReorderQueue(
      async (entryIds) => {
        const sequence = this.queuedReorderSequence || ++this.operationSequence;
        this.queuedReorderSequence = 0;
        return { aggregate: await this.api.reorder(entryIds), sequence };
      },
      ({ aggregate, sequence }) => {
        if (this.generation !== generation) return;
        this.applyReorderResponse(aggregate, sequence);
        this.patchSnapshot({ reordering: false });
      },
      async (error) => {
        if (this.generation !== generation) return;
        this.rollbackOrder();
        this.patchSnapshot({
          reordering: false,
          error: toUserFacingErrorMessage(error),
          message: '순서를 저장하지 못해 저장된 순서로 되돌렸어요.',
        });
        await this.reloadAfterReorderFailure(generation);
      },
      ({ sequence }, entryIds) => {
        if (this.generation !== generation) return;
        this.confirmedOrder = [...entryIds];
        this.entriesRevision = Math.max(this.entriesRevision, sequence);
        this.orderRevision = Math.max(this.orderRevision, sequence);
      },
    );
  }

  private applyReorderResponse(response: TypedAutomationAggregateResponse, sequence: number): void {
    const current = this.snapshot.aggregate;
    if (!current) return this.applyAggregate(response);
    if (sequence < this.orderRevision) return;
    const currentById = new Map(current.entries.map((entry) => [entry.id, entry]));
    const serverIds = new Set(response.entries.map(({ id }) => id));
    const result = [
      ...response.entries.flatMap(({ id }) => {
        const currentEntry = currentById.get(id);
        return currentEntry ? [currentEntry] : [];
      }),
      ...current.entries.filter(({ id }) => !serverIds.has(id)),
    ];
    this.applyAggregate({
      entries: result.map((entry, priority) => ({ ...entry, priority })),
      runtime: current.runtime,
    });
  }

  private recordConfirmedMembership(
    entries: readonly TypedAutomationEntryResponse[],
  ): void {
    const ids = entries.map(({ id }) => id);
    const liveIds = new Set(ids);
    const next = this.confirmedOrder.filter((id) => liveIds.has(id));
    for (const id of ids) if (!next.includes(id)) next.push(id);
    this.confirmedOrder = next;
  }

  private rollbackOrder(): void {
    const current = this.snapshot.aggregate;
    if (!current) return;
    const rank = new Map(this.confirmedOrder.map((id, index) => [id, index]));
    const entries = [...current.entries].sort((a, b) => (
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    )).map((entry, priority) => ({ ...entry, priority }));
    this.applyAggregate({ ...current, entries });
  }

  private async reloadAfterReorderFailure(generation: number): Promise<void> {
    const entriesAtStart = this.entriesRevision;
    const runtimeAtStart = this.runtimeRevision;
    try {
      const loaded = await this.api.fetch();
      if (this.generation !== generation) return;
      const current = this.snapshot.aggregate;
      this.applyAggregate({
        entries: this.entriesRevision === entriesAtStart || !current ? loaded.entries : current.entries,
        runtime: this.runtimeRevision === runtimeAtStart || !current ? loaded.runtime : current.runtime,
      });
      if (this.entriesRevision === entriesAtStart) this.confirmedOrder = loaded.entries.map(({ id }) => id);
    } catch {
      // The confirmed local rollback remains visible; the next normal load can retry.
    }
  }

  private beginSaving(entryId: number | null): void {
    if (entryId != null) this.savingEntryIds.add(entryId);
    this.publishSavingState();
    this.patchSnapshot({ error: null, message: null });
  }

  private endSaving(entryId: number | null): void {
    if (entryId != null) this.savingEntryIds.delete(entryId);
    this.publishSavingState();
  }

  private incrementTypePending(type: AutomationType): void {
    this.pendingTypeCounts.set(type, (this.pendingTypeCounts.get(type) ?? 0) + 1);
    this.publishSavingState();
  }

  private decrementTypePending(type: AutomationType): void {
    const next = (this.pendingTypeCounts.get(type) ?? 0) - 1;
    if (next > 0) this.pendingTypeCounts.set(type, next);
    else this.pendingTypeCounts.delete(type);
    this.publishSavingState();
  }

  private publishSavingState(): void {
    const savingEntryIds = [...this.savingEntryIds];
    const savingTypes = [...this.pendingTypeCounts.keys()];
    this.patchSnapshot({
      savingEntryIds,
      savingModuleIds: savingEntryIds,
      savingTypes,
      editorSaving: savingTypes.length > 0,
    });
  }

  private setError(error: unknown): void {
    const message = toUserFacingErrorMessage(error);
    this.patchSnapshot({ error: message, message });
  }

  private isLatestLoad(generation: number, sequence: number): boolean {
    return this.generation === generation && this.loadSequence === sequence;
  }

  private applyAggregate(aggregate: TypedAutomationAggregateResponse): void {
    this.patchSnapshot({ aggregate, automation: toLegacyAutomation(aggregate) });
  }

  private patchSnapshot(patch: Partial<UnifiedAutomationControllerSnapshot>): void {
    this.replaceSnapshot({ ...this.snapshot, ...patch });
  }

  private replaceSnapshot(snapshot: UnifiedAutomationControllerSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  // Transitional generic-screen operations. They route only through typed endpoints.
  async createModule(request: CreateUnifiedAutomationModuleRequest): Promise<boolean> {
    const type = legacyTypeToTyped(request.moduleType);
    if (!await this.createEntry(type)) return false;
    const created = this.snapshot.aggregate?.entries.find((entry) => entry.type === type);
    return created ? this.updateLegacyEntry(created, request) : false;
  }

  updateModule(entryId: number, request: UpdateUnifiedAutomationModuleRequest): Promise<boolean> {
    const entry = this.snapshot.aggregate?.entries.find(({ id }) => id === entryId);
    return entry ? this.updateLegacyEntry(entry, request) : Promise.resolve(false);
  }

  deleteModule(entryId: number): Promise<boolean> {
    return this.deleteEntry(entryId);
  }

  toggleModule(module: UnifiedAutomationModuleResponse): Promise<boolean> {
    const entry = this.snapshot.aggregate?.entries.find(({ id }) => id === module.id);
    return entry ? this.saveExistingEntry(entry, !entry.enabled) : Promise.resolve(false);
  }

  reorderModules(modules: UnifiedAutomationModuleResponse[]): void {
    const byId = new Map(this.snapshot.aggregate?.entries.map((entry) => [entry.id, entry]));
    const entries = modules.flatMap(({ id }) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    });
    this.reorderEntries(entries);
  }

  private updateLegacyEntry(
    entry: TypedAutomationEntryResponse,
    request: UpdateUnifiedAutomationModuleRequest | CreateUnifiedAutomationModuleRequest,
  ): Promise<boolean> {
    if (entry.type === 'QUEST') {
      return this.saveQuestSettings({
        enabled: request.enabled,
        quests: request.quests.map((quest, sourceOrder) => ({
          questCode: quest.questCode,
          enabled: true,
          sourceOrder,
          maps: quest.maps.map((map, executionOrder) => ({
            missionKey: `${quest.questCode}:${executionOrder}`,
            categoryId: map.categoryId,
            mapCode: map.mapCode,
            executionOrder,
            manuallyOverridden: true,
            ...legacyPreset(map),
          })),
        })),
      });
    }
    if (entry.type === 'BATTLE_MAP') {
      return this.saveBattleMapSettings({
        enabled: request.enabled,
        maps: request.maps.map((map, executionOrder) => ({
          categoryId: map.categoryId, mapCode: map.mapCode, dailyTargetCount: 1,
          executionOrder, ...legacyPreset(map),
        })),
      });
    }
    return this.saveAdventureMapSettings({
      enabled: request.enabled,
      maps: request.maps.map((map, executionOrder) => ({
        categoryId: map.categoryId, mapCode: map.mapCode, executionOrder, ...legacyPreset(map),
      })),
    });
  }

  private saveExistingEntry(entry: TypedAutomationEntryResponse, enabled: boolean): Promise<boolean> {
    if (entry.type === 'QUEST') return this.saveQuestSettings({ enabled, quests: entry.quests });
    if (entry.type === 'BATTLE_MAP') return this.saveBattleMapSettings({ enabled, maps: entry.battleMaps });
    return this.saveAdventureMapSettings({ enabled, maps: entry.adventureMaps });
  }
}

function legacyPreset(map: UnifiedAutomationMap) {
  return map.partyPresetId == null
    ? { presetMode: 'PRIMARY' as const, partyPresetId: null }
    : { presetMode: 'EXPLICIT' as const, partyPresetId: map.partyPresetId };
}

function legacyTypeToTyped(type: UnifiedAutomationModuleType): AutomationType {
  if (type === 'TIME_BURN') return 'BATTLE_MAP';
  if (type === 'COOLDOWN_ADVENTURE' || type === 'DAILY_ADVENTURE') return 'ADVENTURE_MAP';
  return 'QUEST';
}

/** Temporary read-only adapter removed when Tasks 12-15 switch screens to typed entries. */
function toLegacyAutomation(aggregate: TypedAutomationAggregateResponse): UnifiedAutomationStatusResponse {
  const active = aggregate.runtime.lifecycle !== 'STOPPED';
  return {
    profileId: -1,
    job: active ? {
      id: -1,
      accountId: -1,
      profileId: -1,
      status: aggregate.runtime.lifecycle,
      currentStepIndex: 0,
      message: aggregate.runtime.lastError,
      createdAt: '', startedAt: null, updatedAt: '', finishedAt: null,
    } : null,
    modules: aggregate.entries.map(toLegacyModule),
    currentTitle: aggregate.runtime.lastError,
    nextRunAt: aggregate.runtime.nextAttemptAt,
  };
}

function toLegacyModule(entry: TypedAutomationEntryResponse): UnifiedAutomationModuleResponse {
  const moduleType: UnifiedAutomationModuleType = entry.type === 'QUEST'
    ? 'OTHER_QUEST'
    : entry.type === 'BATTLE_MAP' ? 'TIME_BURN' : 'DAILY_ADVENTURE';
  const maps = entry.type === 'BATTLE_MAP'
    ? entry.battleMaps
    : entry.type === 'ADVENTURE_MAP' ? entry.adventureMaps : [];
  return {
    id: entry.id,
    displayName: entry.type === 'QUEST' ? '퀘스트' : entry.type === 'BATTLE_MAP' ? '전투 맵' : '모험 맵',
    moduleType,
    enabled: entry.enabled,
    priority: entry.priority,
    thresholdPercent: null,
    maps: maps.map(({ categoryId, mapCode, partyPresetId, executionOrder }) => ({
      categoryId, mapCode, partyPresetId, executionOrder,
    })),
    quests: entry.quests.map(({ questCode, sourceOrder, maps: questMaps }) => ({
      questCode,
      executionOrder: sourceOrder,
      maps: questMaps.map(({ categoryId, mapCode, partyPresetId, executionOrder }) => ({
        categoryId, mapCode, partyPresetId, executionOrder,
      })),
    })),
    ready: entry.ready,
    summary: entry.warnings[0] ?? (entry.ready ? '실행 준비됨' : '설정을 확인해 주세요'),
  };
}
