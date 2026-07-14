import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appendUnifiedAutomationModule,
  mergeConfirmedUnifiedAutomationOrder,
  removeUnifiedAutomationModule,
  replaceUnifiedAutomationModule,
} from '../../main/domain/unifiedAutomationCollection';
import type { UnifiedAutomationModuleResponse, UnifiedAutomationStatusResponse } from '../../main/types/api';

describe('통합 자동화 모듈 목록 변경', () => {
  it('생성, 수정, 삭제 뒤 우선순위를 0부터 다시 매긴다', () => {
    const first = module(1, '첫 번째', 8);
    const second = module(2, '두 번째', 4);
    const base = status([first]);

    const appended = appendUnifiedAutomationModule(base, second);
    assert.deepEqual(appended?.modules.map(({ id, priority }) => ({ id, priority })), [
      { id: 1, priority: 0 },
      { id: 2, priority: 1 },
    ]);

    const replaced = replaceUnifiedAutomationModule(appended, { ...second, displayName: '수정됨' });
    assert.equal(replaced?.modules[1]?.displayName, '수정됨');

    const removed = removeUnifiedAutomationModule(replaced, 1);
    assert.deepEqual(removed?.modules.map(({ id, priority }) => ({ id, priority })), [
      { id: 2, priority: 0 },
    ]);
  });

  it('서버 확정 순서를 따르면서 동시에 저장된 로컬 토글 값은 보존한다', () => {
    const current = status([module(1, '첫 번째', 0), { ...module(2, '두 번째', 1), enabled: false }]);
    const server = status([module(2, '두 번째', 0), module(1, '첫 번째', 1)]);

    const merged = mergeConfirmedUnifiedAutomationOrder(current, server);

    assert.deepEqual(merged.modules.map(({ id, enabled, priority }) => ({ id, enabled, priority })), [
      { id: 2, enabled: false, priority: 0 },
      { id: 1, enabled: true, priority: 1 },
    ]);
  });
});

function module(id: number, displayName: string, priority: number): UnifiedAutomationModuleResponse {
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
