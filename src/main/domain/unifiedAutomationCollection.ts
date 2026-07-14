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
