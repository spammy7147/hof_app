import type { UnifiedAutomationStatusResponse } from '../types/api';
import {
  mergeConfirmedUnifiedAutomationOrder,
  normalizeUnifiedAutomationPriorities,
} from './unifiedAutomationCollection';

/**
 * 재정렬 요청과 동시에 끝날 수 있는 생성·삭제를 포함해 목록의 마지막 확정 순서를 관리한다.
 *
 * 재정렬 API 응답은 요청 당시 멤버십을 담을 수 있으므로 현재 목록의 ID 집합을 절대 교체하지 않는다.
 * 확정 순서는 성공한 생성·삭제에도 즉시 반영해 이후 재정렬 실패 시 복구 기준으로 사용한다.
 */
export class UnifiedAutomationListCoordinator {
  private confirmedOrder: number[] = [];

  constructor(initialState: UnifiedAutomationStatusResponse | null = null) {
    if (initialState) this.recordAuthoritativeState(initialState);
  }

  /** 최초 조회나 명시적인 재조회 결과를 새로운 확정 기준으로 기록한다. */
  recordAuthoritativeState(state: UnifiedAutomationStatusResponse): void {
    this.confirmedOrder = state.modules.map((module) => module.id);
  }

  /** 서버에서 생성이 성공한 모듈은 현재 확정 순서의 마지막에 추가한다. */
  recordCreated(moduleId: number): void {
    if (!this.confirmedOrder.includes(moduleId)) this.confirmedOrder.push(moduleId);
  }

  /** 서버에서 삭제가 성공한 모듈은 실패 복구 스냅샷에서도 제거한다. */
  recordDeleted(moduleId: number): void {
    this.confirmedOrder = this.confirmedOrder.filter((id) => id !== moduleId);
  }

  /** 성공한 재정렬 요청의 ID 순서를 현재 확정 멤버십에 적용한다. */
  recordConfirmedOrder(moduleIds: number[]): void {
    const confirmedIds = new Set(this.confirmedOrder);
    const requestedIds = new Set(moduleIds);
    const orderedKnownIds = moduleIds.filter((id) => confirmedIds.has(id));
    const modulesAddedAfterRequest = this.confirmedOrder.filter((id) => !requestedIds.has(id));
    this.confirmedOrder = [...orderedKnownIds, ...modulesAddedAfterRequest];
  }

  /** 오래된 서버 멤버십은 무시하고 현재 멤버십에 서버가 확정한 순서만 적용한다. */
  mergeReorderSuccess(
    current: UnifiedAutomationStatusResponse | null,
    serverState: UnifiedAutomationStatusResponse,
  ): UnifiedAutomationStatusResponse {
    const merged = mergeConfirmedUnifiedAutomationOrder(current, serverState);
    this.recordAuthoritativeState(merged);
    return merged;
  }

  /** 현재 멤버십을 유지하면서 마지막 확정 ID 순서로 즉시 되돌린다. */
  rollbackToConfirmedOrder(
    current: UnifiedAutomationStatusResponse,
  ): UnifiedAutomationStatusResponse {
    const byId = new Map(current.modules.map((module) => [module.id, module]));
    const confirmedModules = this.confirmedOrder.flatMap((id) => {
      const module = byId.get(id);
      return module ? [module] : [];
    });
    const confirmedIds = new Set(this.confirmedOrder);
    const newlyConfirmedModules = current.modules.filter((module) => !confirmedIds.has(module.id));
    return {
      ...current,
      modules: normalizeUnifiedAutomationPriorities([
        ...confirmedModules,
        ...newlyConfirmedModules,
      ]),
    };
  }

  /**
   * 실패 직후 로컬 순서를 먼저 복구하고 그 다음 GET으로 서버 상태를 확인한다.
   * GET도 실패하면 첫 번째 복구 상태를 그대로 유지하고 false를 반환한다.
   */
  async rollbackAndReload(
    current: UnifiedAutomationStatusResponse,
    apply: (state: UnifiedAutomationStatusResponse) => void,
    reload: () => Promise<UnifiedAutomationStatusResponse>,
    getCurrent: () => UnifiedAutomationStatusResponse = () => current,
  ): Promise<boolean> {
    apply(this.rollbackToConfirmedOrder(current));
    try {
      const refreshed = await reload();
      const merged = mergeConfirmedUnifiedAutomationOrder(getCurrent(), refreshed);
      this.recordAuthoritativeState(merged);
      apply(merged);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 같은 모듈에 대한 토글 PUT과 전체 편집 PUT이 동시에 실행되지 않게 하는 단일 실행 조정기다.
 * 호출 시작과 동시에 ID를 잠그므로 React가 disabled 상태를 다시 그리기 전의 연속 탭도 막는다.
 */
export class UnifiedAutomationModuleMutationCoordinator {
  private readonly busyModuleIds = new Set<number>();

  isBusy(moduleId: number): boolean {
    return this.busyModuleIds.has(moduleId);
  }

  runExclusive<T>(moduleId: number, operation: () => Promise<T>): Promise<T> | null {
    if (this.isBusy(moduleId)) return null;
    this.busyModuleIds.add(moduleId);
    try {
      return operation().finally(() => this.busyModuleIds.delete(moduleId));
    } catch (error) {
      this.busyModuleIds.delete(moduleId);
      return Promise.reject(error);
    }
  }
}
