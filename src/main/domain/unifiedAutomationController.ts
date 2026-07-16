import { UnifiedAutomationReorderQueue } from './unifiedAutomationReorder';
import { toUserFacingErrorMessage } from './userFacingErrors';
import type {
  AutomationType,
  CreateAutomationEntryRequest,
  CreateUnifiedAutomationModuleRequest,
  QuestSnapshot,
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
  fetchQuests: () => Promise<QuestSnapshot[]>;
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
  private battleProgressRevision = 0;
  private battleProgressSnapshot: {
    entryId: number;
    progress: TypedAutomationEntryResponse['battleMapProgress'];
  } | null = null;
  private queuedReorderSequence = 0;
  private readonly typeRevisions = new Map<AutomationType, number>();
  private readonly typeTails = new Map<AutomationType, Promise<void>>();
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
    this.battleProgressRevision = 0;
    this.battleProgressSnapshot = null;
    this.queuedReorderSequence = 0;
    this.typeRevisions.clear();
    this.typeTails.clear();
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
    if (this.savingEntryIds.has(entryId)) return true;
    const type = this.snapshot.aggregate?.entries.find((entry) => entry.id === entryId)?.type;
    return type != null && (this.pendingTypeCounts.get(type) ?? 0) > 0;
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
    const aggregateSequence = ++this.operationSequence;
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
      this.applyAggregate({
        ...next,
        entries: this.mergeBattleProgress(loaded, aggregateSequence, next.entries),
      });
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

  fetchQuests(): Promise<QuestSnapshot[]> {
    return this.api.fetchQuests();
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
      const entries = this.mergeBattleProgress(
        response,
        sequence,
        current?.entries ?? response.entries,
      );
      this.applyAggregate({ entries, runtime: response.runtime });
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
    return this.runTypedMutation(type, entryId, async (sequence, generation) => {
      const response = await persist(request);
      if (this.generation === generation) this.mergeSettingsResponse(response, sequence, type);
    });
  }

  private runTypedMutation(
    type: AutomationType,
    entryId: number | null,
    operation: (sequence: number, generation: number) => Promise<void>,
  ): Promise<boolean> {
    const generation = this.generation;
    const sequence = ++this.operationSequence;
    this.incrementTypePending(type);
    const previous = this.typeTails.get(type);
    const execute = () => this.executeMutation(generation, sequence, entryId, operation);
    const result = previous ? previous.catch(() => undefined).then(execute) : execute();
    const completed = result.then((value) => {
      if (this.generation === generation) this.decrementTypePending(type);
      return value;
    });
    const tail = completed.then(() => undefined);
    this.typeTails.set(type, tail);
    void tail.finally(() => {
      if (this.typeTails.get(type) === tail) this.typeTails.delete(type);
    });
    return completed;
  }

  private runStructuralMutation(
    type: AutomationType | null,
    entryId: number | null,
    operation: (sequence: number, generation: number) => Promise<void>,
  ): Promise<boolean> {
    const generation = this.generation;
    const sequence = ++this.operationSequence;
    if (type) this.incrementTypePending(type);
    const predecessors = new Set<Promise<void>>();
    if (this.structuralTail) predecessors.add(this.structuralTail);
    const previousType = type ? this.typeTails.get(type) : null;
    if (previousType) predecessors.add(previousType);
    const execute = () => this.executeMutation(generation, sequence, entryId, operation);
    const result = predecessors.size === 0
      ? execute()
      : Promise.all([...predecessors].map((tail) => tail.catch(() => undefined))).then(execute);
    const completed = result.then((value) => {
      if (type && this.generation === generation) this.decrementTypePending(type);
      return value;
    });
    const tail = completed.then(() => undefined);
    this.structuralTail = tail;
    if (type) this.typeTails.set(type, tail);
    void tail.finally(() => {
      if (this.structuralTail === tail) this.structuralTail = null;
      if (type && this.typeTails.get(type) === tail) this.typeTails.delete(type);
    });
    return completed;
  }

  private async executeMutation(
    generation: number,
    sequence: number,
    entryId: number | null,
    operation: (sequence: number, generation: number) => Promise<void>,
  ): Promise<boolean> {
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
  }

  private mergeSettingsResponse(
    response: TypedAutomationAggregateResponse,
    sequence: number,
    targetType: AutomationType,
  ): void {
    const current = this.snapshot.aggregate;
    if (!current) return;
    let entries = current.entries;
    let settingsMerged = false;
    if ((this.typeRevisions.get(targetType) ?? 0) <= sequence) {
      const serverEntry = response.entries.find((entry) => entry.type === targetType);
      const currentIndex = current.entries.findIndex((entry) => entry.type === targetType);
      const currentEntry = current.entries[currentIndex];
      if (serverEntry && currentIndex >= 0 && currentEntry) {
        entries = [...current.entries];
        entries[currentIndex] = {
          ...serverEntry,
          id: currentEntry.id,
          type: currentEntry.type,
          priority: currentEntry.priority,
        };
        this.entriesRevision = Math.max(this.entriesRevision, sequence);
        this.typeRevisions.set(targetType, sequence);
        settingsMerged = true;
      }
    }
    const withProgress = this.mergeBattleProgress(response, sequence, entries);
    if (settingsMerged || withProgress !== entries) {
      this.applyAggregate({ entries: withProgress, runtime: current.runtime });
    }
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
      this.applyAggregate({
        ...response,
        entries: this.mergeBattleProgress(response, sequence, response.entries),
      });
      return;
    }
    let entries = current.entries;
    let structureMerged = false;
    if (!targetType || (this.typeRevisions.get(targetType) ?? 0) <= sequence) {
      const serverTarget = targetType
        ? response.entries.find((entry) => entry.type === targetType)
        : undefined;
      const currentTargetIndex = targetType
        ? current.entries.findIndex((entry) => entry.type === targetType)
        : -1;
      entries = targetType
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
      structureMerged = true;
    }
    const withProgress = this.mergeBattleProgress(response, sequence, entries);
    if (structureMerged || withProgress !== entries) {
      this.applyAggregate({ entries: withProgress, runtime: current.runtime });
    }
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
    if (!current) {
      return this.applyAggregate({
        ...response,
        entries: this.mergeBattleProgress(response, sequence, response.entries),
      });
    }
    const withProgress = this.mergeBattleProgress(response, sequence, current.entries);
    if (sequence < this.orderRevision) {
      if (withProgress !== current.entries) this.applyAggregate({ ...current, entries: withProgress });
      return;
    }
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
      entries: this.mergeBattleProgress(
        response,
        sequence,
        result.map((entry, priority) => ({ ...entry, priority })),
      ),
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
    const sequence = ++this.operationSequence;
    const entriesAtStart = this.entriesRevision;
    const runtimeAtStart = this.runtimeRevision;
    try {
      const loaded = await this.api.fetch();
      if (this.generation !== generation) return;
      const current = this.snapshot.aggregate;
      const entries = this.entriesRevision === entriesAtStart || !current ? loaded.entries : current.entries;
      this.applyAggregate({
        entries: this.mergeBattleProgress(loaded, sequence, entries),
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
    this.patchSnapshot(this.buildSavingState(this.snapshot.aggregate));
  }

  private buildSavingState(
    aggregate: TypedAutomationAggregateResponse | null,
  ): Pick<UnifiedAutomationControllerSnapshot, 'savingEntryIds' | 'savingModuleIds' | 'savingTypes' | 'editorSaving'> {
    const busyEntryIds = new Set(this.savingEntryIds);
    for (const entry of aggregate?.entries ?? []) {
      if ((this.pendingTypeCounts.get(entry.type) ?? 0) > 0) busyEntryIds.add(entry.id);
    }
    const savingEntryIds = [...busyEntryIds];
    const savingTypes = [...this.pendingTypeCounts.keys()];
    return {
      savingEntryIds,
      savingModuleIds: savingEntryIds,
      savingTypes,
      editorSaving: savingTypes.length > 0,
    };
  }

  private setError(error: unknown): void {
    const message = toUserFacingErrorMessage(error);
    this.patchSnapshot({ error: message, message });
  }

  private isLatestLoad(generation: number, sequence: number): boolean {
    return this.generation === generation && this.loadSequence === sequence;
  }

  private mergeBattleProgress(
    response: TypedAutomationAggregateResponse,
    sequence: number,
    entries: TypedAutomationEntryResponse[],
  ): TypedAutomationEntryResponse[] {
    const serverBattle = response.entries.find(({ type }) => type === 'BATTLE_MAP');
    if (serverBattle && sequence >= this.battleProgressRevision) {
      this.battleProgressRevision = sequence;
      this.battleProgressSnapshot = {
        entryId: serverBattle.id,
        progress: serverBattle.battleMapProgress,
      };
    }

    const currentIndex = entries.findIndex(({ type }) => type === 'BATTLE_MAP');
    const currentBattle = entries[currentIndex];
    const progressSnapshot = this.battleProgressSnapshot;
    if (
      currentIndex < 0
      || !currentBattle
      || !progressSnapshot
      || progressSnapshot.entryId !== currentBattle.id
    ) {
      return entries;
    }

    const next = [...entries];
    next[currentIndex] = {
      ...currentBattle,
      battleMapProgress: progressSnapshot.progress,
    };
    return next;
  }

  private applyAggregate(aggregate: TypedAutomationAggregateResponse): void {
    this.patchSnapshot({
      aggregate,
      automation: toLegacyAutomation(aggregate),
      ...this.buildSavingState(aggregate),
    });
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
    const generation = this.generation;
    const type = legacyTypeToTyped(request.moduleType);
    let entry = this.snapshot.aggregate?.entries.find((candidate) => candidate.type === type);
    if (!entry) {
      const created = await this.createEntry(type);
      if (this.generation !== generation || !created) return false;
      entry = this.snapshot.aggregate?.entries.find((candidate) => candidate.type === type);
    }
    return entry ? this.updateLegacyEntry(entry, request) : false;
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
      return this.runTypedMutation('QUEST', entry.id, async (sequence, generation) => {
        const quests = await this.api.fetchQuests();
        if (this.generation !== generation) return;
        const body = buildLegacyQuestRequest(entry, request, quests);
        const response = await this.api.updateQuest(body);
        if (this.generation === generation) {
          this.mergeSettingsResponse(response, sequence, 'QUEST');
        }
      });
    }
    if (entry.type === 'BATTLE_MAP') {
      try {
        return this.saveBattleMapSettings(buildLegacyBattleRequest(entry, request));
      } catch (error) {
        this.setError(error);
        return Promise.resolve(false);
      }
    }
    try {
      return this.saveAdventureMapSettings(buildLegacyAdventureRequest(entry, request));
    } catch (error) {
      this.setError(error);
      return Promise.resolve(false);
    }
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

function buildLegacyQuestRequest(
  entry: TypedAutomationEntryResponse,
  request: UpdateUnifiedAutomationModuleRequest | CreateUnifiedAutomationModuleRequest,
  snapshots: readonly QuestSnapshot[],
): UpdateQuestAutomationRequest {
  const currentQuests = indexUnique(
    entry.quests,
    ({ questCode }) => questCode,
    '저장된 퀘스트에 중복된 항목이 있어 안전하게 저장할 수 없어요.',
  );
  assertUnique(
    request.quests,
    ({ questCode }) => questCode,
    '선택한 퀘스트에 중복된 항목이 있어 안전하게 저장할 수 없어요.',
  );

  return {
    enabled: request.enabled,
    quests: request.quests.map((quest, sourceOrder) => {
      const snapshot = snapshots.find(({ questId }) => questId === quest.questCode);
      if (!snapshot) {
        throw new Error(`선택한 퀘스트 '${quest.questCode}'를 찾을 수 없어요.`);
      }

      const currentQuest = currentQuests.get(quest.questCode);
      const currentMaps = indexUnique(
        currentQuest?.maps ?? [],
        mapIdentity,
        `퀘스트 '${quest.questCode}'에 중복된 맵이 있어 안전하게 저장할 수 없어요.`,
      );
      assertUnique(
        quest.maps,
        mapIdentity,
        `퀘스트 '${quest.questCode}'에 중복된 맵이 있어 안전하게 저장할 수 없어요.`,
      );

      return {
        ...currentQuest,
        questCode: quest.questCode,
        enabled: currentQuest?.enabled ?? true,
        sourceOrder,
        maps: quest.maps.map((map, executionOrder) => {
          const currentMap = currentMaps.get(mapIdentity(map));
          if (currentMap) {
            return {
              ...currentMap,
              categoryId: map.categoryId,
              mapCode: map.mapCode,
              executionOrder,
              ...legacyPreset(map),
            };
          }

          const combatMissions = snapshot.missions.filter(
            ({ type }) => type === 'MONSTER_KILL' || type === 'MAP_CLEAR',
          );
          if (combatMissions.length === 0) {
            throw new Error(`퀘스트 '${quest.questCode}'의 맵 자동화에 사용할 전투 미션을 찾을 수 없어요.`);
          }
          if (combatMissions.length > 1) {
            throw new Error(`퀘스트 '${quest.questCode}'에 여러 전투 미션이 있어 맵을 안전하게 연결할 수 없어요.`);
          }
          return {
            missionKey: combatMissions[0].key,
            categoryId: map.categoryId,
            mapCode: map.mapCode,
            executionOrder,
            manuallyOverridden: true,
            ...legacyPreset(map),
          };
        }),
      };
    }),
  };
}

function buildLegacyBattleRequest(
  entry: TypedAutomationEntryResponse,
  request: UpdateUnifiedAutomationModuleRequest | CreateUnifiedAutomationModuleRequest,
): UpdateBattleMapAutomationRequest {
  const currentMaps = indexUnique(
    entry.battleMaps,
    mapIdentity,
    '저장된 전투 맵에 중복된 맵이 있어 안전하게 저장할 수 없어요.',
  );
  assertUnique(request.maps, mapIdentity, '선택한 전투 맵에 중복된 맵이 있어 안전하게 저장할 수 없어요.');
  return {
    enabled: request.enabled,
    maps: request.maps.map((map, executionOrder) => ({
      ...currentMaps.get(mapIdentity(map)),
      categoryId: map.categoryId,
      mapCode: map.mapCode,
      dailyTargetCount: currentMaps.get(mapIdentity(map))?.dailyTargetCount ?? 1,
      executionOrder,
      ...legacyPreset(map),
    })),
  };
}

function buildLegacyAdventureRequest(
  entry: TypedAutomationEntryResponse,
  request: UpdateUnifiedAutomationModuleRequest | CreateUnifiedAutomationModuleRequest,
): UpdateAdventureMapAutomationRequest {
  const currentMaps = indexUnique(
    entry.adventureMaps,
    mapIdentity,
    '저장된 모험 맵에 중복된 맵이 있어 안전하게 저장할 수 없어요.',
  );
  assertUnique(request.maps, mapIdentity, '선택한 모험 맵에 중복된 맵이 있어 안전하게 저장할 수 없어요.');
  return {
    enabled: request.enabled,
    maps: request.maps.map((map, executionOrder) => ({
      ...currentMaps.get(mapIdentity(map)),
      categoryId: map.categoryId,
      mapCode: map.mapCode,
      executionOrder,
      ...legacyPreset(map),
    })),
  };
}

function mapIdentity(map: { categoryId: string; mapCode: string }): string {
  return `${map.categoryId}\u0000${map.mapCode}`;
}

function assertUnique<T>(items: readonly T[], keyOf: (item: T) => string, message: string): void {
  indexUnique(items, keyOf, message);
}

function indexUnique<T>(items: readonly T[], keyOf: (item: T) => string, message: string): Map<string, T> {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (byKey.has(key)) throw new Error(message);
    byKey.set(key, item);
  }
  return byKey;
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
