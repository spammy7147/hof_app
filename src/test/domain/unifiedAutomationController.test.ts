import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  UnifiedAutomationController,
  type UnifiedAutomationControllerApi,
  type UnifiedAutomationControllerSnapshot,
} from '../../main/domain/unifiedAutomationController';
import type {
  CreateUnifiedAutomationModuleRequest,
  UnifiedAutomationModuleResponse,
  UnifiedAutomationStatusResponse,
  UpdateUnifiedAutomationModuleRequest,
} from '../../main/types/api';

describe('앱 수명주기 통합 자동화 컨트롤러', () => {
  it('저장 중 홈을 나갔다 돌아와 GET이 먼저 끝나도 이전 저장 완료를 새 구독자에게 전달한다', async () => {
    const edit = deferred<UnifiedAutomationModuleResponse>();
    const remountGet = deferred<UnifiedAutomationStatusResponse>();
    let getCount = 0;
    const api = apiStub({
      fetch: async () => {
        getCount += 1;
        return getCount === 1 ? status([module(1, '기존 이름', 0)]) : remountGet.promise;
      },
      update: async () => edit.promise,
    });
    const controller = new UnifiedAutomationController(api);

    await controller.load();
    const firstMountSnapshots: UnifiedAutomationControllerSnapshot[] = [];
    const unsubscribeFirstMount = controller.subscribe(() => {
      firstMountSnapshots.push(controller.getSnapshot());
    });
    const saving = controller.updateModule(1, updateRequest('새 이름'));

    // Home 탭이 unmount된 뒤 새 화면 인스턴스가 같은 앱 컨트롤러를 다시 구독하는 상황이다.
    unsubscribeFirstMount();
    const secondMountSnapshots: UnifiedAutomationControllerSnapshot[] = [];
    const unsubscribeSecondMount = controller.subscribe(() => {
      secondMountSnapshots.push(controller.getSnapshot());
    });
    const reloading = controller.load();
    remountGet.resolve(status([module(1, '기존 이름', 0)]));
    await reloading;
    assert.equal(controller.getSnapshot().automation?.modules[0]?.displayName, '기존 이름');

    edit.resolve(module(1, '새 이름', 0));
    assert.equal(await saving, true);
    assert.equal(controller.getSnapshot().automation?.modules[0]?.displayName, '새 이름');
    assert.equal(
      secondMountSnapshots.at(-1)?.automation?.modules[0]?.displayName,
      '새 이름',
    );
    assert.equal(firstMountSnapshots.some((snapshot) => (
      snapshot.automation?.modules[0]?.displayName === '새 이름'
    )), false);
    unsubscribeSecondMount();
  });

  it('저장 완료 뒤 도착한 오래된 GET도 생성·삭제·편집·재정렬 결과를 되돌리지 않는다', async () => {
    const staleGet = deferred<UnifiedAutomationStatusResponse>();
    let currentServer = status([
      module(1, '첫 번째', 0),
      module(2, '두 번째', 1),
    ]);
    let getCount = 0;
    const api = apiStub({
      fetch: async () => {
        getCount += 1;
        return getCount === 1 ? currentServer : staleGet.promise;
      },
      create: async () => module(3, '세 번째', 2),
      update: async (moduleId, request) => ({
        ...currentServer.modules.find((candidate) => candidate.id === moduleId)!,
        ...request,
        displayName: request.displayName,
      }),
      delete: async () => undefined,
      reorder: async (ids) => status(ids.map((id, priority) => (
        currentServer.modules.find((candidate) => candidate.id === id)
        ?? module(id, `모듈 ${id}`, priority)
      )).map((candidate, priority) => ({ ...candidate, priority }))),
    });
    const controller = new UnifiedAutomationController(api);
    await controller.load();

    const loading = controller.load();
    assert.equal(await controller.createModule(createRequest('세 번째')), true);
    assert.equal(await controller.updateModule(2, updateRequest('두 번째 수정')), true);
    assert.equal(await controller.deleteModule(1), true);
    controller.reorderModules([
      controller.getSnapshot().automation!.modules[1]!,
      controller.getSnapshot().automation!.modules[0]!,
    ]);
    await controller.whenReorderIdle();

    staleGet.resolve(currentServer);
    await loading;
    assert.deepEqual(
      controller.getSnapshot().automation?.modules.map(({ id, displayName }) => ({ id, displayName })),
      [
        { id: 3, displayName: '세 번째' },
        { id: 2, displayName: '두 번째 수정' },
      ],
    );
  });

  it('늦은 실행 제어 응답이 병행 완료된 reorder와 CRUD·편집 결과를 덮지 않는다', async () => {
    const control = deferred<UnifiedAutomationStatusResponse>();
    let serverModules = [module(1, '첫 번째', 0), module(2, '두 번째', 1)];
    const api = apiStub({
      fetch: async () => status(serverModules),
      changeState: async () => control.promise,
      reorder: async (ids) => {
        serverModules = ids.map((id, priority) => ({
          ...serverModules.find((candidate) => candidate.id === id)!,
          priority,
        }));
        return status(serverModules);
      },
      create: async () => {
        const created = module(3, '세 번째', serverModules.length);
        serverModules = [...serverModules, created];
        return created;
      },
      update: async (moduleId, request) => {
        const updated = {
          ...serverModules.find((candidate) => candidate.id === moduleId)!,
          ...request,
        };
        serverModules = serverModules.map((candidate) => candidate.id === moduleId ? updated : candidate);
        return updated;
      },
      delete: async (moduleId) => {
        serverModules = serverModules.filter((candidate) => candidate.id !== moduleId);
      },
    });
    const controller = new UnifiedAutomationController(api);
    await controller.load();

    const controlling = controller.changeState('start');
    controller.reorderModules([serverModules[1]!, serverModules[0]!]);
    await controller.whenReorderIdle();
    assert.equal(await controller.createModule(createRequest('세 번째')), true);
    assert.equal(await controller.updateModule(2, updateRequest('두 번째 수정')), true);
    assert.equal(await controller.deleteModule(1), true);

    control.resolve({
      ...status([module(1, '오래된 첫 번째', 0), module(2, '오래된 두 번째', 1)]),
      currentTitle: '실행 중',
      nextRunAt: '2026-07-14T12:00:00Z',
    });
    await controlling;

    const snapshot = controller.getSnapshot();
    assert.equal(snapshot.automation?.currentTitle, '실행 중');
    assert.equal(snapshot.automation?.nextRunAt, '2026-07-14T12:00:00Z');
    assert.deepEqual(
      snapshot.automation?.modules.map(({ id, displayName }) => ({ id, displayName })),
      [
        { id: 2, displayName: '두 번째 수정' },
        { id: 3, displayName: '세 번째' },
      ],
    );
  });

  it('완료된 실행 제어 상태를 그보다 오래된 GET과 재정렬 응답이 되돌리지 않는다', async () => {
    const staleGet = deferred<UnifiedAutomationStatusResponse>();
    const staleReorder = deferred<UnifiedAutomationStatusResponse>();
    let getCount = 0;
    const api = apiStub({
      fetch: async () => {
        getCount += 1;
        return getCount === 1
          ? status([module(1, '첫 번째', 0), module(2, '두 번째', 1)])
          : staleGet.promise;
      },
      changeState: async () => ({
        ...status([module(1, '첫 번째', 0), module(2, '두 번째', 1)]),
        currentTitle: '실행 중',
      }),
      reorder: async () => staleReorder.promise,
    });
    const controller = new UnifiedAutomationController(api);
    await controller.load();

    const loading = controller.load();
    controller.reorderModules([
      controller.getSnapshot().automation!.modules[1]!,
      controller.getSnapshot().automation!.modules[0]!,
    ]);
    const reordering = controller.whenReorderIdle();
    await controller.changeState('start');

    staleGet.resolve(status([module(1, '첫 번째', 0), module(2, '두 번째', 1)]));
    await loading;
    staleReorder.resolve(status([module(2, '두 번째', 0), module(1, '첫 번째', 1)]));
    await reordering;

    assert.equal(controller.getSnapshot().automation?.currentTitle, '실행 중');
    assert.deepEqual(controller.getSnapshot().automation?.modules.map(({ id }) => id), [2, 1]);
  });
});

type ApiOverrides = Partial<UnifiedAutomationControllerApi>;

function apiStub(overrides: ApiOverrides): UnifiedAutomationControllerApi {
  return {
    fetch: overrides.fetch ?? (async () => status([])),
    create: overrides.create ?? (async () => module(99, '생성됨', 0)),
    update: overrides.update ?? (async (moduleId, request) => ({
      ...module(moduleId, request.displayName, 0),
      ...request,
    })),
    delete: overrides.delete ?? (async () => undefined),
    reorder: overrides.reorder ?? (async () => status([])),
    changeState: overrides.changeState ?? (async () => status([])),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createRequest(displayName: string): CreateUnifiedAutomationModuleRequest {
  return {
    displayName,
    moduleType: 'OTHER_QUEST',
    enabled: true,
    thresholdPercent: null,
    maps: [],
    quests: [{ questCode: displayName, executionOrder: 0, maps: [] }],
  };
}

function updateRequest(displayName: string): UpdateUnifiedAutomationModuleRequest {
  const { moduleType: _moduleType, ...request } = createRequest(displayName);
  return request;
}

function module(
  id: number,
  displayName: string,
  priority: number,
): UnifiedAutomationModuleResponse {
  return {
    id,
    displayName,
    moduleType: 'OTHER_QUEST',
    enabled: true,
    priority,
    thresholdPercent: null,
    maps: [],
    quests: [{ questCode: `quest-${id}`, executionOrder: 0, maps: [] }],
    ready: true,
    summary: '퀘스트 1개',
  };
}

function status(modules: UnifiedAutomationModuleResponse[]): UnifiedAutomationStatusResponse {
  return {
    profileId: 1,
    job: null,
    modules,
    currentTitle: null,
    nextRunAt: null,
  };
}
