import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import type { AlertButton } from 'react-native';
import type { AutomationHistoryPage, AutomationConvergenceStatus } from '../../main/types/api';

const alerts: { title: string; message?: string; buttons: AlertButton[] }[] = [];

const host = (name: string) => (props: Record<string, unknown>) =>
  React.createElement(name, { ...props, accessible: props.accessible ?? (name === 'Pressable' ? true : undefined) }, props.children as React.ReactNode);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return {
    ActivityIndicator: host('ActivityIndicator'),
    Alert: { alert: (title: string, message?: string, buttons: AlertButton[] = []) => { alerts.push({ title, message, buttons }); } },
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

afterEach(async () => { await rntl.cleanup(); alerts.length = 0; });

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
  await confirmRemoteRelease();
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
    confirmLastAlert();
    confirmLastAlert();
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
  await confirmRemoteRelease();
  assert.ok(rntl.screen.getByText('보류된 결과'));
  assert.ok(rntl.screen.getByText('해제 요청 실패'));
  await confirmRemoteRelease();
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
  await confirmRemoteRelease();
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


function confirmLastAlert() {
  const confirm = alerts.at(-1)?.buttons.find(choice => choice.text === '새 판단 허용');
  assert.ok(confirm?.onPress);
  confirm.onPress();
}
async function confirmRemoteRelease() {
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '레이드 시작 새 행동 판단 허용' }));
  await rntl.act(async () => { confirmLastAlert(); });
}

const localHeldConvergence: AutomationConvergenceStatus = {
  ...heldConvergence,
  localResults: [{
    actionId: 88, entryId: 12, entryDisplayName: '일일 퀘스트', actionKind: 'QUEST_ACCEPT',
    status: 'RESULT_HELD', remoteResult: 'APPLIED', retryAttempt: 2, nextAttemptAt: null,
    reasonCode: 'LOCAL_RESULT_INTEGRITY_FAILED', reasonMessage: '원래 응답을 안전하게 처리할 수 없어 보류했습니다.',
    evidenceCaseId: 'receipt-88', impactScope: '퀘스트 대상 일일 퀘스트',
    releaseCondition: '사용자가 새 행동 판단을 허용하면 최신 상태에서 다시 판단', canAllowFreshDecision: true,
  }],
};

it('확인한 로컬 보류만 해제하고 원격 보류와 늦은 조회를 구분한다', async () => {
  const oldGet = deferred<AutomationConvergenceStatus>();
  const response = deferred<AutomationConvergenceStatus>();
  const localPosts: number[] = [];
  const remotePosts: number[] = [];
  let gets = 0;
  await rntl.render(React.createElement(AutomationHistoryScreen, {
    onBack: () => undefined, load: async () => ({ cycles: [], nextCursor: null }),
    loadConvergence: () => ++gets === 1 ? Promise.resolve(localHeldConvergence) : oldGet.promise,
    allowFreshDecision: async (id: number) => { remotePosts.push(id); return heldConvergence; },
    allowLocalFreshDecision: (id: number) => { localPosts.push(id); return response.promise; },
  }));
  assert.ok(rntl.screen.getByText('후처리 보류'));
  assert.ok(rntl.screen.getByText('원격 적용 확인'));
  assert.ok(rntl.screen.getByText(/증거.*receipt-88/));
  assert.ok(rntl.screen.getByText(/이유 코드.*LOCAL_RESULT_INTEGRITY_FAILED/));
  const button = () => rntl.screen.getByRole('button', { name: '퀘스트 수락 후처리 보류 새 행동 판단 허용' });
  await rntl.fireEvent.press(button());
  assert.deepEqual(localPosts, []);
  const cancelled = alerts.at(-1);
  assert.ok(cancelled);
  assert.ok(cancelled.message?.includes('최신 상태'));
  const cancel = cancelled.buttons.find(choice => choice.style === 'cancel');
  assert.ok(cancel);
  await rntl.act(async () => { cancel.onPress?.(); });
  assert.deepEqual(localPosts, []);
  assert.ok(rntl.screen.getByText('후처리 보류'));

  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '수렴 상태 새로고침' }));
  await rntl.fireEvent.press(button());
  const confirm = alerts.at(-1)?.buttons.find(choice => choice.text === '새 판단 허용');
  assert.ok(confirm?.onPress);
  await rntl.act(async () => { confirm.onPress?.(); confirm.onPress?.(); });
  assert.deepEqual(localPosts, [88]);
  assert.deepEqual(remotePosts, []);
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '레이드 시작 새 행동 판단 허용' }));
  assert.deepEqual(remotePosts, []);
  await rntl.act(async () => { response.resolve({ ...heldConvergence, localResults: [] }); });
  assert.equal(rntl.screen.queryByText('후처리 보류'), null);
  assert.ok(rntl.screen.getByText('보류된 결과'));
  await rntl.act(async () => { oldGet.resolve(localHeldConvergence); });
  assert.equal(rntl.screen.queryByText('후처리 보류'), null);
  assert.ok(rntl.screen.getByText('보류된 결과'));
});


it('원격 보류도 사용자가 확인하기 전에는 새 판단을 허용하지 않는다', async () => {
  const posts: number[] = [];
  await rntl.render(React.createElement(AutomationHistoryScreen, {
    onBack: () => undefined, load: async () => ({ cycles: [], nextCursor: null }),
    loadConvergence: async () => heldConvergence,
    allowFreshDecision: async id => { posts.push(id); return { battleGate: null, items: [] }; },
  }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '레이드 시작 새 행동 판단 허용' }));
  assert.deepEqual(posts, []);
  const confirm = alerts.at(-1)?.buttons.find(choice => choice.text === '새 판단 허용');
  assert.ok(confirm?.onPress);
  await rntl.act(async () => { confirm.onPress?.(); });
  assert.deepEqual(posts, [88]);
  assert.equal(rntl.screen.queryByText('보류된 결과'), null);
});


it('로컬 후처리 재시도를 빈 상태로 표시하지 않고 사용자의 조기 해제를 제공하지 않는다', async () => {
  const held = localHeldConvergence.localResults?.[0];
  assert.ok(held);
  await rntl.render(React.createElement(AutomationHistoryScreen, {
    onBack: () => undefined, load: async () => ({ cycles: [], nextCursor: null }),
    loadConvergence: async (): Promise<AutomationConvergenceStatus> => ({ battleGate: null, items: [], localResults: [{
      ...held, status: 'RESULT_PENDING', canAllowFreshDecision: false,
      nextAttemptAt: '2026-09-10T10:00:30Z', reasonCode: 'LOCAL_RESULT_RETRY',
    }] }),
    allowLocalFreshDecision: async () => { throw new Error('재시도 중에는 사용자 해제를 제공하지 않는다'); },
  }));
  assert.ok(rntl.screen.getByText('후처리 재시도'));
  assert.ok(rntl.screen.getByText(/다음 후처리/));
  assert.equal(rntl.screen.queryByText('현재 결과를 재확인 중인 행동이 없습니다.'), null);
  assert.equal(rntl.screen.queryByRole('button', { name: /후처리 보류 새 행동 판단 허용/ }), null);
});

it('로컬 해제 실패를 재시도하고 계정 교체 뒤 남은 확인창으로 요청하지 않는다', async () => {
  let posts = 0;
  await rntl.render(React.createElement(AutomationHistoryScreen, {
    key: 'previous-account', onBack: () => undefined, load: async () => ({ cycles: [], nextCursor: null }),
    loadConvergence: async () => ({ ...localHeldConvergence, items: [] }),
    allowLocalFreshDecision: async () => {
      if (++posts === 1) throw new Error('후처리 해제 요청 실패');
      return { battleGate: null, items: [], localResults: [] };
    },
  }));
  const press = () => rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '퀘스트 수락 후처리 보류 새 행동 판단 허용' }));
  await press();
  await rntl.act(async () => { confirmLastAlert(); });
  assert.ok(rntl.screen.getByText('후처리 해제 요청 실패'));
  assert.ok(rntl.screen.getByText('후처리 보류'));
  await press();
  await rntl.act(async () => { confirmLastAlert(); });
  assert.equal(posts, 2);
  assert.equal(rntl.screen.queryByText('후처리 보류'), null);
  assert.ok(rntl.screen.getByText('현재 결과를 재확인 중인 행동이 없습니다.'));

  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '수렴 상태 새로고침' }));
  await press();
  await rntl.screen.rerender(React.createElement(AutomationHistoryScreen, {
    key: 'next-account', onBack: () => undefined, load: async () => ({ cycles: [], nextCursor: null }),
    loadConvergence: async () => ({ battleGate: null, items: [] }),
  }));
  await rntl.act(async () => { confirmLastAlert(); });
  assert.equal(posts, 2);
  assert.equal(rntl.screen.queryByText('후처리 보류'), null);
});
