import type {
  UnifiedAutomationModuleResponse,
  UnifiedAutomationStatusResponse,
} from '../types/api';

/** 모듈 배열의 현재 위치를 서버와 같은 0 기반 우선순위로 정규화한다. */
export function normalizeUnifiedAutomationPriorities(
  modules: UnifiedAutomationModuleResponse[],
): UnifiedAutomationModuleResponse[] {
  return modules.map((module, priority) => ({ ...module, priority }));
}

/** 생성 응답을 목록 마지막에 추가한다. */
export function appendUnifiedAutomationModule(
  current: UnifiedAutomationStatusResponse | null,
  created: UnifiedAutomationModuleResponse,
): UnifiedAutomationStatusResponse | null {
  return current ? {
    ...current,
    modules: normalizeUnifiedAutomationPriorities([...current.modules, created]),
  } : current;
}

/** 수정 또는 토글 응답을 같은 ID의 행에만 반영한다. */
export function replaceUnifiedAutomationModule(
  current: UnifiedAutomationStatusResponse | null,
  updated: UnifiedAutomationModuleResponse,
): UnifiedAutomationStatusResponse | null {
  return current ? {
    ...current,
    modules: normalizeUnifiedAutomationPriorities(
      current.modules.map((module) => module.id === updated.id ? updated : module),
    ),
  } : current;
}

/** 삭제된 모듈을 제거하고 남은 행의 우선순위를 다시 매긴다. */
export function removeUnifiedAutomationModule(
  current: UnifiedAutomationStatusResponse | null,
  moduleId: number,
): UnifiedAutomationStatusResponse | null {
  return current ? {
    ...current,
    modules: normalizeUnifiedAutomationPriorities(
      current.modules.filter((module) => module.id !== moduleId),
    ),
  } : current;
}

/**
 * 서버가 확정한 ID 순서는 따르되 순서 요청과 동시에 저장된 이름·토글은 로컬 최신 값을 보존한다.
 * 순서 endpoint 응답이 조금 먼저 만들어졌다는 이유로 별도 PUT 결과가 화면에서 되돌아가는 일을 막는다.
 */
export function mergeConfirmedUnifiedAutomationOrder(
  current: UnifiedAutomationStatusResponse | null,
  serverState: UnifiedAutomationStatusResponse,
): UnifiedAutomationStatusResponse {
  if (!current) return serverState;
  const localById = new Map(current.modules.map((module) => [module.id, module]));
  const serverIds = new Set(serverState.modules.map((module) => module.id));
  const orderedCurrentModules = serverState.modules.flatMap((serverModule) => {
    const localModule = localById.get(serverModule.id);
    return localModule ? [{ ...serverModule, ...localModule }] : [];
  });
  const locallyAddedModules = current.modules.filter((module) => !serverIds.has(module.id));
  return {
    ...serverState,
    modules: normalizeUnifiedAutomationPriorities([
      ...orderedCurrentModules,
      ...locallyAddedModules,
    ]),
  };
}

/**
 * 시작·일시정지 같은 실행 제어 응답에서 실행 상태만 현재 목록에 반영한다.
 *
 * 제어 요청을 보낸 뒤 모듈 생성이나 편집이 끝날 수 있으므로 응답의 `modules`는 요청 시점의
 * 오래된 스냅샷일 수 있다. 현재 멤버십과 설정을 유지하면 늦은 제어 응답이 사용자 변경을
 * 되돌리지 않으면서도 작업 상태와 다음 실행 시각은 정상적으로 갱신할 수 있다.
 */
export function mergeUnifiedAutomationExecutionState(
  current: UnifiedAutomationStatusResponse | null,
  serverState: UnifiedAutomationStatusResponse,
): UnifiedAutomationStatusResponse {
  return current ? { ...serverState, modules: current.modules } : serverState;
}

/**
 * 모듈 조회·재정렬 응답을 적용하면서 현재 실행 제어 상태를 보존한다.
 * 모듈 endpoint가 반환한 전체 객체의 작업 상태는 요청 시작 시점 값일 수 있으므로 모듈 필드와
 * 실행 필드의 소유권을 분리해 서로의 최신 결과를 되돌리지 않게 한다.
 */
export function mergeUnifiedAutomationModuleState(
  current: UnifiedAutomationStatusResponse | null,
  serverState: UnifiedAutomationStatusResponse,
): UnifiedAutomationStatusResponse {
  return current ? {
    ...serverState,
    job: current.job,
    currentTitle: current.currentTitle,
    nextRunAt: current.nextRunAt,
  } : serverState;
}
