import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import type { AutomationHistoryPage, AutomationConvergenceStatus } from '../../main/types/api';

const host = (name: string) => (props: Record<string, unknown>) =>
  React.createElement(name, { ...props, accessible: props.accessible ?? (name === 'Pressable' ? true : undefined) }, props.children as React.ReactNode);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return {
    ActivityIndicator: host('ActivityIndicator'),
    Pressable: host('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style,
      hairlineWidth: 1,
    },
    Text: host('Text'),
    View: host('View'),
  };
  if (request === 'lucide-react-native') return { ArrowLeft: host('ArrowLeft') };
  if (request === 'react-native-draggable-flatlist') {
    return { NestableScrollContainer: host('NestableScrollContainer') };
  }
  return originalLoad(request, parent, isMain);
};
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { AutomationHistoryScreen } = require(
  '../../main/features/automation/components/AutomationHistoryScreen',
) as typeof import('../../main/features/automation/components/AutomationHistoryScreen');
moduleWithLoader._load = originalLoad;

afterEach(async () => rntl.cleanup());

describe('AutomationHistoryScreen with RNTL', () => {
  it('shows fishing cast and obstruction battle in separate numbered decisions', async () => {
    const homeEvent = historyEvent(1, 0, 10, 'HOME_QUEST', 'SKIPPED', 'HOME_IDLE', null);
    const fishingEvent = historyEvent(2, 1, 11, 'FISHING', 'SELECTED', 'RUNNABLE', 'FISHING_TOWN');
    const startEvent = historyEvent(3, 2, 11, 'FISHING', 'ACTION_SUCCEEDED', 'FISHING_START_APPLIED', 'START');
    const catchEvent = historyEvent(4, 3, 11, 'FISHING', 'ACTION_SUCCEEDED', 'FISHING_CATCH_APPLIED', 'CATCH');
    const nextHomeEvent = historyEvent(5, 0, 10, 'HOME_QUEST', 'SKIPPED', 'HOME_IDLE', null);
    const battleSelection = historyEvent(6, 1, 11, 'FISHING', 'SELECTED', 'RUNNABLE', 'BATTLE');
    const battleEvent = historyEvent(7, 2, 11, 'FISHING', 'ACTION_SUCCEEDED', 'FISHING_OBSTRUCTION_BATTLE_APPLIED', 'BATTLE');
    const load = async (): Promise<AutomationHistoryPage> => ({
      nextCursor: null,
      cycles: [{
        id: 10,
        result: 'ACTION_SELECTED',
        selectedEntryId: 11,
        startedAt: '2026-08-24T00:00:02Z',
        finishedAt: '2026-08-24T00:00:03Z',
        events: [nextHomeEvent, battleSelection, battleEvent],
        topLevelStepCount: 2,
        steps: [
          { sequence: 1, event: nextHomeEvent, executionEvents: [] },
          { sequence: 2, event: battleSelection, executionEvents: [battleEvent] },
        ],
      }, {
        id: 9,
        result: 'ACTION_SELECTED',
        selectedEntryId: 11,
        startedAt: '2026-08-24T00:00:00Z',
        finishedAt: '2026-08-24T00:00:01Z',
        events: [homeEvent, fishingEvent, startEvent, catchEvent],
        topLevelStepCount: 2,
        steps: [
          { sequence: 1, event: homeEvent, executionEvents: [] },
          { sequence: 2, event: fishingEvent, executionEvents: [startEvent, catchEvent] },
        ],
      }],
    });

    await rntl.render(React.createElement(AutomationHistoryScreen, { onBack: () => undefined, load }));

    await rntl.screen.findAllByText('판단 과정 2단계');
    assert.equal(rntl.screen.getAllByLabelText('낚시 사이클 실행 단계').length, 2);
    assert.equal(rntl.screen.getAllByText('낚시 사이클 · 실행').length, 2);
    assert.equal(rntl.screen.getAllByText('동작 낚시 시작').length, 1);
    assert.equal(rntl.screen.getAllByText('동작 낚기').length, 1);
    assert.equal(rntl.screen.getAllByText('동작 전투').length, 2);
    assert.equal(rntl.screen.queryByText('패턴 로드'), null);
  });
});

function historyEvent(
  id: number,
  sequence: number,
  entryId: number,
  type: NonNullable<AutomationHistoryPage['cycles'][number]['events'][number]['type']>,
  kind: AutomationHistoryPage['cycles'][number]['events'][number]['kind'],
  reasonCode: string,
  actionKind: string | null,
): AutomationHistoryPage['cycles'][number]['events'][number] {
  return {
    id,
    sequence,
    entryId,
    type,
    kind,
    reasonCode,
    message: reasonCode,
    targetKey: null,
    targetName: null,
    actionKind,
    presetId: null,
    presetName: null,
    nextRunAt: null,
    occurredAt: '2026-08-24T00:00:00Z',
  };
}


it('부모 재렌더가 새 loader 함수를 전달해도 누적한 두 페이지를 유지한다', async () => {
  const calls: (number | undefined)[] = [];
  const view = () => React.createElement(AutomationHistoryScreen, {
    onBack: () => undefined,
    load: async (cursor?: number) => {
      calls.push(cursor);
      return historyPage(cursor == null ? 2 : 1, cursor == null ? 1 : null);
    },
  });
  await rntl.render(view());
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '자동화 기록 더 보기' }));
  assert.ok(rntl.screen.getByText(/이력 페이지 1/));
  await rntl.screen.rerender(view());
  assert.deepEqual(calls, [undefined, 1]);
  assert.ok(rntl.screen.getByText(/이력 페이지 1/));
  assert.equal(rntl.screen.queryByRole('button', { name: '자동화 기록 더 보기' }), null);
});

it('보류 해제보다 먼저 시작한 GET이 늦게 완료해도 보류를 되살리지 않는다', { timeout: 5000 }, async () => {
  const delayed = deferred<AutomationConvergenceStatus>();
  let gets = 0;
  const releases: number[] = [];
  await rntl.render(React.createElement(AutomationHistoryScreen, {
    onBack: () => undefined,
    load: async () => ({ cycles: [], nextCursor: null }),
    loadConvergence: () => ++gets === 1 ? Promise.resolve(heldConvergence) : delayed.promise,
    allowFreshDecision: async (id: number) => { releases.push(id); return { battleGate: null, items: [] }; },
  }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '수렴 상태 새로고침' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '레이드 시작 새 행동 판단 허용' }));
  assert.equal(rntl.screen.queryByText('보류된 결과') === null, true);
  await rntl.act(async () => { delayed.resolve(heldConvergence); });
  assert.equal(rntl.screen.queryByText('보류된 결과') === null, true);
  assert.deepEqual(releases, [88]);
});

const heldConvergence: AutomationConvergenceStatus = {
  battleGate: null,
  items: [{
    attemptId: 88, entryId: 9, actionKind: 'RAID_START', scopeKind: 'RAID_ENTRY', scopeKey: 'Raid001',
    result: 'HELD', successfulObservationCount: 5, nextProbeAt: null, reasonCode: 'MAX_OBSERVATIONS',
    reasonMessage: '자동 관측 예산 안에 결과를 확정하지 못했습니다.',
    evidenceCaseId: 'evidence-1', impactScope: '레이드 사이클 Raid001',
    releaseCondition: '상태 변경 또는 사용자의 새 행동 판단 허용', canAllowFreshDecision: true,
  }],
};
function historyPage(id: number, nextCursor: number | null): AutomationHistoryPage {
  return { nextCursor, cycles: [{ id, result: 'IDLE', selectedEntryId: null,
    startedAt: '2026-09-09T00:00:00Z', finishedAt: '2026-09-09T00:00:01Z',
    events: [{ ...historyEvent(id, 1, 1, 'RAID', 'SKIPPED', 'WAITING_TO_START', null), message: `이력 페이지 ${id}` }],
  }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}


it('해제 중 중복 클릭·새로고침을 막고 이전 GET 오류도 폐기한다', async () => {
  const oldGet = deferred<AutomationConvergenceStatus>();
  const release = deferred<AutomationConvergenceStatus>();
  let gets = 0;
  let posts = 0;
  await rntl.render(React.createElement(AutomationHistoryScreen, {
    onBack: () => undefined,
    load: async () => ({ cycles: [], nextCursor: null }),
    loadConvergence: () => ++gets === 1 ? Promise.resolve(heldConvergence) : oldGet.promise,
    allowFreshDecision: () => { posts += 1; return release.promise; },
  }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '수렴 상태 새로고침' }));
  const releaseButton = rntl.screen.getByRole('button', { name: '레이드 시작 새 행동 판단 허용' });
  await rntl.act(async () => {
    await rntl.fireEvent.press(releaseButton);
    await rntl.fireEvent.press(releaseButton);
  });
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '수렴 상태 새로고침' }));
  assert.equal(posts, 1);
  assert.equal(gets, 2);
  await rntl.act(async () => { oldGet.reject(new Error('오래된 조회 실패')); });
  assert.equal(rntl.screen.queryByText('오래된 조회 실패') === null, true);
  await rntl.act(async () => { release.resolve({ battleGate: null, items: [] }); });
  assert.equal(rntl.screen.queryByText('보류된 결과') === null, true);
});

it('해제 실패는 기존 보류를 유지하고 사용자가 재시도할 수 있다', async () => {
  let posts = 0;
  await rntl.render(React.createElement(AutomationHistoryScreen, {
    onBack: () => undefined,
    load: async () => ({ cycles: [], nextCursor: null }),
    loadConvergence: async () => heldConvergence,
    allowFreshDecision: async () => {
      if (++posts === 1) throw new Error('해제 요청 실패');
      return { battleGate: null, items: [] };
    },
  }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '레이드 시작 새 행동 판단 허용' }));
  assert.ok(rntl.screen.getByText('보류된 결과'));
  assert.ok(rntl.screen.getByText('해제 요청 실패'));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '레이드 시작 새 행동 판단 허용' }));
  assert.equal(rntl.screen.queryByText('보류된 결과') === null, true);
  assert.equal(posts, 2);
});

it('계정 화면 교체 뒤 과거 페이지와 해제 응답을 새 화면에 표시하지 않는다', async () => {
  const oldPage = deferred<AutomationHistoryPage>();
  const oldRelease = deferred<AutomationConvergenceStatus>();
  await rntl.render(React.createElement(AutomationHistoryScreen, {
    key: 'previous-account', onBack: () => undefined, load: () => oldPage.promise,
    loadConvergence: async () => heldConvergence, allowFreshDecision: () => oldRelease.promise,
  }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '레이드 시작 새 행동 판단 허용' }));
  await rntl.screen.rerender(React.createElement(AutomationHistoryScreen, {
    key: 'next-account', onBack: () => undefined, load: async () => historyPage(9, null),
    loadConvergence: async () => ({ battleGate: null, items: [] }),
  }));
  await rntl.act(async () => { oldPage.resolve(historyPage(1, null)); oldRelease.resolve(heldConvergence); });
  assert.equal(rntl.screen.queryByText(/이력 페이지 1/) === null, true);
  assert.equal(rntl.screen.queryByText('보류된 결과') === null, true);
  assert.ok(rntl.screen.getAllByText(/이력 페이지 9/).length > 0);
});

it('부모가 갱신한 loader는 다음 사용자 조회에 쓰고 누적 페이지는 보존한다', async () => {
  let oldGets = 0;
  let newGets = 0;
  const load = async (cursor?: number) => historyPage(cursor == null ? 2 : 1, cursor == null ? 1 : null);
  const oldProps = { onBack: () => undefined, load,
    loadConvergence: async () => { oldGets += 1; return heldConvergence; },
  };
  await rntl.render(React.createElement(AutomationHistoryScreen, oldProps));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '자동화 기록 더 보기' }));
  await rntl.screen.rerender(React.createElement(AutomationHistoryScreen, {
    ...oldProps, load: (cursor?: number) => load(cursor),
    loadConvergence: async () => { newGets += 1; return { battleGate: null, items: [] }; },
  }));
  assert.equal(newGets, 0);
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '수렴 상태 새로고침' }));
  assert.equal(newGets, 1);
  assert.equal(oldGets, 1);
  assert.ok(rntl.screen.getByText(/이력 페이지 1/));
  assert.equal(rntl.screen.queryByText('보류된 결과') === null, true);
});
