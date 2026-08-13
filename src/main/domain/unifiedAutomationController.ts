import { UnifiedAutomationReorderQueue } from './unifiedAutomationReorder';
import { toUserFacingErrorMessage } from './userFacingErrors';
import type {
  AutomationType,
  CreateAutomationEntryRequest,
  QuestSnapshot,
  TypedAutomationAggregateResponse,
  TypedAutomationEntryResponse,
  UnifiedAutomationAction,
  UpdateAdventureMapAutomationRequest,
  UpdateBattleMapAutomationRequest,
  UpdateQuestAutomationRequest,
  UpdateFishingAutomationRequest,
  UpdateRaidAutomationRequest,
  UpdateUnionAutomationRequest,
  UpdateHomeQuestAutomationRequest,
  AutomationHistoryPage,
} from '../types/api';

export type UnifiedAutomationControllerApi = {
  fetch: () => Promise<TypedAutomationAggregateResponse>;
  create: (request: CreateAutomationEntryRequest) => Promise<TypedAutomationAggregateResponse>;
  delete: (entryId: number) => Promise<TypedAutomationAggregateResponse>;
  reorder: (entryIds: number[]) => Promise<TypedAutomationAggregateResponse>;
  updateQuest: (request: UpdateQuestAutomationRequest) => Promise<TypedAutomationAggregateResponse>;
  updateHomeQuest?: (request: UpdateHomeQuestAutomationRequest) => Promise<TypedAutomationAggregateResponse>;
  updateBattle: (request: UpdateBattleMapAutomationRequest) => Promise<TypedAutomationAggregateResponse>;
  updateAdventure: (request: UpdateAdventureMapAutomationRequest) => Promise<TypedAutomationAggregateResponse>;
  updateFishing?: (request: UpdateFishingAutomationRequest) => Promise<TypedAutomationAggregateResponse>;
  updateUnion?: (request: UpdateUnionAutomationRequest) => Promise<TypedAutomationAggregateResponse>;
  updateRaid?: (request: UpdateRaidAutomationRequest) => Promise<TypedAutomationAggregateResponse>;
  fetchHistory?: (cursor?: number) => Promise<AutomationHistoryPage>;
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
};

type ReorderResult = { aggregate: TypedAutomationAggregateResponse; sequence: number };

function initialSnapshot(): UnifiedAutomationControllerSnapshot {
  return {
    aggregate: null,
    loading: false,
    actionSaving: false,
    savingEntryIds: [],
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
        hofStatus: loaded.hofStatus,
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

  saveHomeQuestSettings(request: UpdateHomeQuestAutomationRequest): Promise<boolean> {
    return this.saveSettings('HOME_QUEST', request, (body) => this.requireApi(this.api.updateHomeQuest, '자택 관리')(body));
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
  saveFishingSettings(request: UpdateFishingAutomationRequest): Promise<boolean> {
    return this.saveSettings('FISHING', request, (body) => this.requireApi(this.api.updateFishing, '낚시')(body));
  }
  saveUnionSettings(request: UpdateUnionAutomationRequest): Promise<boolean> {
    return this.saveSettings('UNION', request, (body) => this.requireApi(this.api.updateUnion, '유니온')(body));
  }
  saveRaidSettings(request: UpdateRaidAutomationRequest): Promise<boolean> {
    return this.saveSettings('RAID', request, (body) => this.requireApi(this.api.updateRaid, '레이드')(body));
  }
  fetchHistory(cursor?: number): Promise<AutomationHistoryPage> { return this.requireApi(this.api.fetchHistory, '자동화 기록')(cursor); }

  private requireApi<A extends unknown[], R>(api: ((...args: A) => R) | undefined, label: string): (...args: A) => R {
    if (!api) throw new Error(`${label} API가 연결되지 않았습니다.`);
    return api;
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
      this.applyAggregate({ entries, runtime: response.runtime, hofStatus: response.hofStatus });
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
    if (settingsMerged || withProgress !== entries || response.hofStatus != null) {
      this.applyAggregate({ entries: withProgress, runtime: current.runtime, hofStatus: response.hofStatus });
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
    if (structureMerged || withProgress !== entries || response.hofStatus != null) {
      this.applyAggregate({ entries: withProgress, runtime: current.runtime, hofStatus: response.hofStatus });
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
      if (withProgress !== current.entries || response.hofStatus != null) {
        this.applyAggregate({ ...current, entries: withProgress, hofStatus: response.hofStatus });
      }
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
      hofStatus: response.hofStatus,
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
        hofStatus: loaded.hofStatus,
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
  ): Pick<UnifiedAutomationControllerSnapshot, 'savingEntryIds' | 'savingTypes'> {
    const busyEntryIds = new Set(this.savingEntryIds);
    for (const entry of aggregate?.entries ?? []) {
      if ((this.pendingTypeCounts.get(entry.type) ?? 0) > 0) busyEntryIds.add(entry.id);
    }
    const savingEntryIds = [...busyEntryIds];
    const savingTypes = [...this.pendingTypeCounts.keys()];
    return {
      savingEntryIds,
      savingTypes,
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
    const currentStatus = this.snapshot.aggregate?.hofStatus;
    const incomingStatus = aggregate.hofStatus;
    const currentObservedAt = currentStatus ? Date.parse(currentStatus.observedAt) : Number.NaN;
    const incomingObservedAt = incomingStatus ? Date.parse(incomingStatus.observedAt) : Number.NaN;
    const hofStatus = incomingStatus != null
      && !Number.isNaN(incomingObservedAt)
      && (Number.isNaN(currentObservedAt) || incomingObservedAt > currentObservedAt)
      ? incomingStatus
      : currentStatus;
    const nextAggregate = { ...aggregate, hofStatus };
    this.patchSnapshot({
      aggregate: nextAggregate,
      ...this.buildSavingState(nextAggregate),
    });
  }

  private patchSnapshot(patch: Partial<UnifiedAutomationControllerSnapshot>): void {
    this.replaceSnapshot({ ...this.snapshot, ...patch });
  }

  private replaceSnapshot(snapshot: UnifiedAutomationControllerSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}
