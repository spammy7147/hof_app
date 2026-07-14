import { buildToggleUnifiedModuleRequest } from './unifiedAutomation';
import {
  appendUnifiedAutomationModule,
  mergeUnifiedAutomationExecutionState,
  mergeUnifiedAutomationModuleState,
  normalizeUnifiedAutomationPriorities,
  removeUnifiedAutomationModule,
  replaceUnifiedAutomationModule,
} from './unifiedAutomationCollection';
import {
  UnifiedAutomationListCoordinator,
  UnifiedAutomationModuleMutationCoordinator,
} from './unifiedAutomationOperations';
import { UnifiedAutomationReorderQueue } from './unifiedAutomationReorder';
import { toUserFacingErrorMessage } from './userFacingErrors';
import type {
  CreateUnifiedAutomationModuleRequest,
  UnifiedAutomationAction,
  UnifiedAutomationModuleResponse,
  UnifiedAutomationStatusResponse,
  UpdateUnifiedAutomationModuleRequest,
} from '../types/api';

/** 앱 수명주기 컨트롤러가 사용하는 백엔드 연산의 최소 계약이다. */
export type UnifiedAutomationControllerApi = {
  fetch: () => Promise<UnifiedAutomationStatusResponse>;
  create: (request: CreateUnifiedAutomationModuleRequest) => Promise<UnifiedAutomationModuleResponse>;
  update: (
    moduleId: number,
    request: UpdateUnifiedAutomationModuleRequest,
  ) => Promise<UnifiedAutomationModuleResponse>;
  delete: (moduleId: number) => Promise<void>;
  reorder: (moduleIds: number[]) => Promise<UnifiedAutomationStatusResponse>;
  changeState: (action: UnifiedAutomationAction) => Promise<UnifiedAutomationStatusResponse>;
};

/** Home 탭이 구독해 그리는 자동화 상태와 개별 저장 진행 상태다. */
export type UnifiedAutomationControllerSnapshot = {
  automation: UnifiedAutomationStatusResponse | null;
  loading: boolean;
  actionSaving: boolean;
  editorSaving: boolean;
  savingModuleIds: number[];
  reordering: boolean;
  message: string | null;
};

const NEW_MODULE_OPERATION_ID = -1;

function initialSnapshot(): UnifiedAutomationControllerSnapshot {
  return {
    automation: null,
    loading: false,
    actionSaving: false,
    editorSaving: false,
    savingModuleIds: [],
    reordering: false,
    message: null,
  };
}

/**
 * 자동화 상태와 진행 중인 요청을 앱 수명주기 동안 유지하는 외부 store다.
 *
 * Home 탭은 다른 탭으로 이동하면 unmount되므로 화면 내부 state가 요청 완료를 소유하면 안 된다.
 * 이 컨트롤러는 App에서 한 번 생성되고 모든 비동기 완료를 현재 snapshot에 반영한 뒤 구독자에게
 * 알린다. 따라서 저장 중 탭을 나갔다 돌아와도 새 Home 인스턴스가 동일한 최신 상태를 받는다.
 */
export class UnifiedAutomationController {
  private snapshot: UnifiedAutomationControllerSnapshot = initialSnapshot();
  private readonly listeners = new Set<() => void>();
  private listCoordinator = new UnifiedAutomationListCoordinator();
  private mutationCoordinator = new UnifiedAutomationModuleMutationCoordinator();
  private reorderQueue: UnifiedAutomationReorderQueue<UnifiedAutomationStatusResponse>;
  private generation = 0;
  private moduleRevision = 0;
  private executionRevision = 0;
  private loadSequence = 0;
  private loadingRequestCount = 0;
  private editorSavingCount = 0;
  private readonly savingModuleIds = new Set<number>();

  constructor(private readonly api: UnifiedAutomationControllerApi) {
    this.reorderQueue = this.createReorderQueue(this.generation);
  }

  /** React의 `useSyncExternalStore`가 사용할 안정적인 현재 snapshot getter다. */
  getSnapshot = (): UnifiedAutomationControllerSnapshot => this.snapshot;

  /** 화면 구독을 등록하며, 탭 unmount 시 반환 함수로 해당 구독만 해제한다. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** 로그아웃 시 이전 계정의 상태와 늦게 끝나는 요청을 새 세션에서 무시한다. */
  reset(): void {
    this.reorderQueue.dispose();
    this.generation += 1;
    this.moduleRevision = 0;
    this.executionRevision = 0;
    this.loadSequence = 0;
    this.loadingRequestCount = 0;
    this.editorSavingCount = 0;
    this.savingModuleIds.clear();
    this.listCoordinator = new UnifiedAutomationListCoordinator();
    this.mutationCoordinator = new UnifiedAutomationModuleMutationCoordinator();
    this.reorderQueue = this.createReorderQueue(this.generation);
    this.replaceSnapshot(initialSnapshot());
  }

  clearMessage(): void {
    if (this.snapshot.message) this.patchSnapshot({ message: null });
  }

  showMessage(message: string): void {
    this.patchSnapshot({ message });
  }

  isModuleBusy(moduleId: number): boolean {
    return this.mutationCoordinator.isBusy(moduleId);
  }

  /** 테스트와 화면 전환 코드가 마지막 재정렬 저장 완료를 기다릴 때 사용한다. */
  whenReorderIdle(): Promise<void> {
    return this.reorderQueue.whenIdle();
  }

  /**
   * 서버 상태를 조회한다. 조회 중 모듈 mutation이 완료됐다면 늦은 GET에서는 실행 상태만 취한다.
   * 반대로 GET이 먼저 끝나면 이후 mutation 완료가 같은 store를 갱신하므로 새 화면도 결과를 받는다.
   */
  async load(): Promise<void> {
    const requestGeneration = this.generation;
    const requestSequence = ++this.loadSequence;
    const moduleRevisionAtStart = this.moduleRevision;
    const executionRevisionAtStart = this.executionRevision;
    this.loadingRequestCount += 1;
    this.patchSnapshot({ loading: true, message: null });
    try {
      const loaded = await this.api.fetch();
      if (!this.isLatestLoad(requestGeneration, requestSequence)) return;

      const current = this.snapshot.automation;
      const moduleChanged = this.moduleRevision !== moduleRevisionAtStart;
      const executionChanged = this.executionRevision !== executionRevisionAtStart;
      let next = loaded;
      if (moduleChanged) next = mergeUnifiedAutomationExecutionState(current, next);
      if (executionChanged) next = mergeUnifiedAutomationModuleState(current, next);

      if (!moduleChanged) {
        this.listCoordinator.recordAuthoritativeState(loaded);
      }
      this.applyAutomation(next);
    } catch (error) {
      if (this.isLatestLoad(requestGeneration, requestSequence)) {
        this.patchSnapshot({ message: toUserFacingErrorMessage(error) });
      }
    } finally {
      if (this.isCurrentGeneration(requestGeneration)) {
        this.loadingRequestCount = Math.max(0, this.loadingRequestCount - 1);
        this.patchSnapshot({ loading: this.loadingRequestCount > 0 });
      }
    }
  }

  /** 실행 제어는 모듈 목록과 독립적이며 동시에 한 요청만 보낸다. */
  async changeState(action: UnifiedAutomationAction): Promise<void> {
    if (this.snapshot.actionSaving) return;
    const requestGeneration = this.generation;
    this.patchSnapshot({ actionSaving: true, message: null });
    try {
      const updated = await this.api.changeState(action);
      if (!this.isCurrentGeneration(requestGeneration)) return;
      this.executionRevision += 1;
      this.applyAutomation(mergeUnifiedAutomationExecutionState(this.snapshot.automation, updated));
    } catch (error) {
      if (this.isCurrentGeneration(requestGeneration)) {
        this.patchSnapshot({ message: toUserFacingErrorMessage(error) });
      }
    } finally {
      if (this.isCurrentGeneration(requestGeneration)) {
        this.patchSnapshot({ actionSaving: false });
      }
    }
  }

  async toggleModule(module: UnifiedAutomationModuleResponse): Promise<boolean> {
    return this.runModuleMutation(module.id, false, async (requestGeneration) => {
      const updated = await this.api.update(module.id, buildToggleUnifiedModuleRequest(module));
      if (!this.isCurrentGeneration(requestGeneration)) return;
      this.recordModuleMutation();
      this.updateAutomation((current) => replaceUnifiedAutomationModule(current, updated));
    });
  }

  async createModule(request: CreateUnifiedAutomationModuleRequest): Promise<boolean> {
    return this.runModuleMutation(NEW_MODULE_OPERATION_ID, true, async (requestGeneration) => {
      const created = await this.api.create(request);
      if (!this.isCurrentGeneration(requestGeneration)) return;
      this.listCoordinator.recordCreated(created.id);
      this.recordModuleMutation();
      this.updateAutomation((current) => appendUnifiedAutomationModule(current, created));
    });
  }

  async updateModule(
    moduleId: number,
    request: UpdateUnifiedAutomationModuleRequest,
  ): Promise<boolean> {
    return this.runModuleMutation(moduleId, true, async (requestGeneration) => {
      const updated = await this.api.update(moduleId, request);
      if (!this.isCurrentGeneration(requestGeneration)) return;
      this.recordModuleMutation();
      this.updateAutomation((current) => replaceUnifiedAutomationModule(current, updated));
    });
  }

  async deleteModule(moduleId: number): Promise<boolean> {
    return this.runModuleMutation(moduleId, true, async (requestGeneration) => {
      await this.api.delete(moduleId);
      if (!this.isCurrentGeneration(requestGeneration)) return;
      this.listCoordinator.recordDeleted(moduleId);
      this.recordModuleMutation();
      this.updateAutomation((current) => removeUnifiedAutomationModule(current, moduleId));
    });
  }

  /** 드롭 결과를 즉시 publish하고 실제 저장은 하나씩, 마지막 대기 순서만 보존해 실행한다. */
  reorderModules(modules: UnifiedAutomationModuleResponse[]): void {
    const normalized = normalizeUnifiedAutomationPriorities(modules);
    this.updateAutomation((current) => current ? { ...current, modules: normalized } : current);
    this.patchSnapshot({ reordering: true, message: null });
    this.reorderQueue.enqueue(normalized.map((module) => module.id));
  }

  /** 같은 모듈의 토글과 전체 PUT을 직렬화하고 진행 상태를 모든 Home 인스턴스에 공유한다. */
  private async runModuleMutation(
    moduleId: number,
    editorOperation: boolean,
    operation: (requestGeneration: number) => Promise<void>,
  ): Promise<boolean> {
    const requestGeneration = this.generation;
    const task = this.mutationCoordinator.runExclusive(moduleId, async () => {
      this.beginModuleSaving(moduleId, editorOperation);
      try {
        await operation(requestGeneration);
        return this.isCurrentGeneration(requestGeneration);
      } catch (error) {
        if (this.isCurrentGeneration(requestGeneration)) {
          this.patchSnapshot({ message: toUserFacingErrorMessage(error) });
        }
        return false;
      } finally {
        if (this.isCurrentGeneration(requestGeneration)) {
          this.endModuleSaving(moduleId, editorOperation);
        }
      }
    });

    if (!task) {
      this.patchSnapshot({ message: '이 자동화를 저장하고 있어요. 잠시만 기다려 주세요.' });
      return false;
    }
    return task;
  }

  private beginModuleSaving(moduleId: number, editorOperation: boolean): void {
    if (moduleId !== NEW_MODULE_OPERATION_ID) this.savingModuleIds.add(moduleId);
    if (editorOperation) this.editorSavingCount += 1;
    this.patchSnapshot({
      editorSaving: this.editorSavingCount > 0,
      savingModuleIds: [...this.savingModuleIds],
      message: null,
    });
  }

  private endModuleSaving(moduleId: number, editorOperation: boolean): void {
    if (moduleId !== NEW_MODULE_OPERATION_ID) this.savingModuleIds.delete(moduleId);
    if (editorOperation) this.editorSavingCount = Math.max(0, this.editorSavingCount - 1);
    this.patchSnapshot({
      editorSaving: this.editorSavingCount > 0,
      savingModuleIds: [...this.savingModuleIds],
    });
  }

  private createReorderQueue(
    queueGeneration: number,
  ): UnifiedAutomationReorderQueue<UnifiedAutomationStatusResponse> {
    return new UnifiedAutomationReorderQueue(
      (moduleIds) => this.api.reorder(moduleIds),
      (serverState) => {
        if (!this.isCurrentGeneration(queueGeneration)) return;
        const current = this.snapshot.automation;
        const merged = this.listCoordinator.mergeReorderSuccess(
          current,
          serverState,
        );
        this.applyAutomation(mergeUnifiedAutomationModuleState(current, merged));
        this.patchSnapshot({ reordering: false });
      },
      async () => {
        if (!this.isCurrentGeneration(queueGeneration)) return;
        this.patchSnapshot({
          reordering: false,
          message: '순서를 저장하지 못해 이전 순서로 되돌렸어요. 저장된 상태를 다시 확인하고 있어요.',
        });
        const current = this.snapshot.automation;
        if (!current) return;
        const executionRevisionAtReloadStart = this.executionRevision;
        const refreshed = await this.listCoordinator.rollbackAndReload(
          current,
          (next) => {
            if (!this.isCurrentGeneration(queueGeneration)) return;
            const safeNext = this.executionRevision === executionRevisionAtReloadStart
              ? next
              : mergeUnifiedAutomationModuleState(this.snapshot.automation, next);
            this.applyAutomation(safeNext);
          },
          () => this.api.fetch(),
          () => this.snapshot.automation ?? current,
        );
        if (!refreshed && this.isCurrentGeneration(queueGeneration)) {
          this.patchSnapshot({
            message: '순서를 저장하지 못해 이전 순서로 되돌렸어요. 잠시 후 다시 시도해 주세요.',
          });
        }
      },
      (_serverState, moduleIds) => {
        if (!this.isCurrentGeneration(queueGeneration)) return;
        this.listCoordinator.recordConfirmedOrder(moduleIds);
        this.recordModuleMutation();
      },
    );
  }

  private recordModuleMutation(): void {
    this.moduleRevision += 1;
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.generation === generation;
  }

  private isLatestLoad(generation: number, sequence: number): boolean {
    return this.isCurrentGeneration(generation) && this.loadSequence === sequence;
  }

  private applyAutomation(automation: UnifiedAutomationStatusResponse | null): void {
    this.patchSnapshot({ automation });
  }

  private updateAutomation(
    transform: (
      current: UnifiedAutomationStatusResponse | null,
    ) => UnifiedAutomationStatusResponse | null,
  ): void {
    this.applyAutomation(transform(this.snapshot.automation));
  }

  private patchSnapshot(patch: Partial<UnifiedAutomationControllerSnapshot>): void {
    this.replaceSnapshot({ ...this.snapshot, ...patch });
  }

  private replaceSnapshot(snapshot: UnifiedAutomationControllerSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}
