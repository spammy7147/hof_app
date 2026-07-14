import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  UnifiedAutomationListCoordinator,
  UnifiedAutomationModuleMutationCoordinator,
} from '../../main/domain/unifiedAutomationOperations';
import { UnifiedAutomationReorderQueue } from '../../main/domain/unifiedAutomationReorder';
import type {
  UnifiedAutomationModuleResponse,
  UnifiedAutomationStatusResponse,
} from '../../main/types/api';

describe('통합 자동화 목록 작업 조정기', () => {
  it('재정렬 실패 즉시 마지막 확정 순서로 복구하고 GET 실패에도 복구 상태를 유지한다', async () => {
    const confirmed = status([module(1, 0), module(2, 1)]);
    const optimistic = status([module(2, 0), module(1, 1)]);
    const coordinator = new UnifiedAutomationListCoordinator(confirmed);
    const applied: UnifiedAutomationStatusResponse[] = [];
    const reload = deferred<UnifiedAutomationStatusResponse>();

    const recovery = coordinator.rollbackAndReload(
      optimistic,
      (next) => applied.push(next),
      () => reload.promise,
    );

    assert.deepEqual(applied[0]?.modules.map(({ id }) => id), [1, 2]);
    reload.reject(new Error('reload failed'));
    assert.equal(await recovery, false);
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0]?.modules.map(({ id }) => id), [1, 2]);
  });

  it('재정렬 중 생성과 삭제가 확정 순서 스냅샷에도 반영된다', () => {
    const coordinator = new UnifiedAutomationListCoordinator(
      status([module(1, 0), module(2, 1)]),
    );

    coordinator.recordCreated(3);
    coordinator.recordDeleted(1);
    const rolledBack = coordinator.rollbackToConfirmedOrder(
      status([module(3, 0), module(2, 1)]),
    );

    assert.deepEqual(rolledBack.modules.map(({ id, priority }) => ({ id, priority })), [
      { id: 2, priority: 0 },
      { id: 3, priority: 1 },
    ]);
  });

  it('앞선 재정렬 성공 후 최신 재정렬과 GET이 실패하면 앞선 성공 순서로 복구한다', async () => {
    const coordinator = new UnifiedAutomationListCoordinator(
      status([module(1, 0), module(2, 1), module(3, 2)]),
    );
    const firstRequest = deferred<UnifiedAutomationStatusResponse>();
    const applied: UnifiedAutomationStatusResponse[] = [];
    let requestCount = 0;
    const queue = new UnifiedAutomationReorderQueue(
      async () => {
        requestCount += 1;
        if (requestCount === 1) return firstRequest.promise;
        throw new Error('latest reorder failed');
      },
      () => assert.fail('대기 중인 최신 순서가 실패했으므로 화면 순서를 확정하면 안 된다.'),
      async () => {
        await coordinator.rollbackAndReload(
          status([module(3, 0), module(2, 1), module(1, 2)]),
          (next) => applied.push(next),
          async () => { throw new Error('reload failed'); },
        );
      },
      (_result, ids) => coordinator.recordConfirmedOrder(ids),
    );

    queue.enqueue([2, 1, 3]);
    queue.enqueue([3, 2, 1]);
    await tick();
    firstRequest.resolve(status([module(2, 0), module(1, 1), module(3, 2)]));
    await queue.whenIdle();

    assert.deepEqual(applied[0]?.modules.map(({ id }) => id), [2, 1, 3]);
  });

  it('실패 복구 GET 응답도 대기 중 완료된 생성과 삭제를 덮지 않는다', async () => {
    const coordinator = new UnifiedAutomationListCoordinator(
      status([module(1, 0), module(2, 1)]),
    );
    const reload = deferred<UnifiedAutomationStatusResponse>();
    let current = status([module(2, 0), module(1, 1)]);
    const recovery = coordinator.rollbackAndReload(
      current,
      (next) => { current = next; },
      () => reload.promise,
      () => current,
    );

    coordinator.recordCreated(3);
    coordinator.recordDeleted(1);
    current = status([module(2, 0), module(3, 1)]);
    reload.resolve(status([module(1, 0), module(2, 1)]));

    assert.equal(await recovery, true);
    assert.deepEqual(current.modules.map(({ id, priority }) => ({ id, priority })), [
      { id: 2, priority: 0 },
      { id: 3, priority: 1 },
    ]);
  });
});

describe('통합 자동화 모듈 저장 조정기', () => {
  it('같은 모듈의 중복 토글과 전체 편집 PUT을 첫 저장이 끝날 때까지 시작하지 않는다', async () => {
    const coordinator = new UnifiedAutomationModuleMutationCoordinator();
    const first = deferred<string>();
    let requestCount = 0;

    const toggle = coordinator.runExclusive(7, () => {
      requestCount += 1;
      return first.promise;
    });
    const repeatedToggle = coordinator.runExclusive(7, async () => {
      requestCount += 1;
      return 'stale toggle';
    });
    const editPut = coordinator.runExclusive(7, async () => {
      requestCount += 1;
      return 'stale edit';
    });

    assert.ok(toggle);
    assert.equal(coordinator.isBusy(7), true);
    assert.equal(repeatedToggle, null);
    assert.equal(editPut, null);
    assert.equal(requestCount, 1);

    first.resolve('saved');
    assert.equal(await toggle, 'saved');
    assert.equal(coordinator.isBusy(7), false);

    const nextEdit = coordinator.runExclusive(7, async () => {
      requestCount += 1;
      return 'edited';
    });
    assert.equal(await nextEdit, 'edited');
    assert.equal(requestCount, 2);
  });

  it('서로 다른 모듈 저장은 독립적으로 시작한다', async () => {
    const coordinator = new UnifiedAutomationModuleMutationCoordinator();
    const first = deferred<void>();
    const second = deferred<void>();

    const firstTask = coordinator.runExclusive(1, () => first.promise);
    const secondTask = coordinator.runExclusive(2, () => second.promise);

    assert.ok(firstTask);
    assert.ok(secondTask);
    assert.equal(coordinator.isBusy(1), true);
    assert.equal(coordinator.isBusy(2), true);
    first.resolve();
    second.resolve();
    await Promise.all([firstTask, secondTask]);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function module(id: number, priority: number): UnifiedAutomationModuleResponse {
  return {
    id,
    displayName: `모듈 ${id}`,
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
