import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UnifiedAutomationReorderQueue } from '../../main/domain/unifiedAutomationReorder';

describe('통합 자동화 우선순위 저장 큐', () => {
  it('저장 요청을 한 번에 하나만 보내고 대기 중에는 마지막 순서만 보존한다', async () => {
    const requests: number[][] = [];
    const resolvers: Array<() => void> = [];
    const saved: number[][] = [];
    const persisted: number[][] = [];
    const queue = new UnifiedAutomationReorderQueue(
      async (ids) => {
        requests.push(ids);
        await new Promise<void>((resolve) => resolvers.push(resolve));
        return ids;
      },
      (ids) => saved.push(ids),
      async () => undefined,
      (_result, ids) => persisted.push(ids),
    );

    queue.enqueue([2, 1, 3]);
    queue.enqueue([2, 3, 1]);
    queue.enqueue([3, 2, 1]);
    await tick();
    assert.deepEqual(requests, [[2, 1, 3]]);

    resolvers.shift()?.();
    await tick();
    assert.deepEqual(requests, [[2, 1, 3], [3, 2, 1]]);
    assert.deepEqual(saved, []);
    assert.deepEqual(persisted, [[2, 1, 3]]);

    resolvers.shift()?.();
    await queue.whenIdle();
    assert.deepEqual(saved, [[3, 2, 1]]);
    assert.deepEqual(persisted, [[2, 1, 3], [3, 2, 1]]);
  });

  it('저장 실패 시 대기 순서를 버리고 서버 순서를 다시 불러온다', async () => {
    const failures: unknown[] = [];
    let attempts = 0;
    const queue = new UnifiedAutomationReorderQueue(
      async () => {
        attempts += 1;
        throw new Error('network address must not be shown');
      },
      () => assert.fail('실패한 순서를 확정하면 안 된다.'),
      async (error) => { failures.push(error); },
    );

    queue.enqueue([2, 1]);
    queue.enqueue([1, 2]);
    await queue.whenIdle();

    assert.equal(attempts, 1);
    assert.equal(failures.length, 1);
  });

  it('dispose 후에는 in-flight 결과와 pending·새 enqueue를 폐기하고 idle로 끝난다', async () => {
    const requests: number[][] = [];
    const saved: number[][] = [];
    const persisted: number[][] = [];
    let resolveFirst!: (value: number[]) => void;
    const firstRequest = new Promise<number[]>((resolve) => {
      resolveFirst = resolve;
    });
    const queue = new UnifiedAutomationReorderQueue(
      async (ids) => {
        requests.push(ids);
        return firstRequest;
      },
      (ids) => saved.push(ids),
      async () => assert.fail('폐기된 큐는 실패 callback도 실행하지 않는다.'),
      (_result, ids) => persisted.push(ids),
    );

    queue.enqueue([2, 1]);
    queue.enqueue([1, 2]);
    const idle = queue.whenIdle();
    queue.dispose();
    queue.enqueue([3, 2, 1]);
    resolveFirst([2, 1]);
    await idle;

    assert.deepEqual(requests, [[2, 1]]);
    assert.deepEqual(saved, []);
    assert.deepEqual(persisted, []);
    await queue.whenIdle();
  });
});

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
