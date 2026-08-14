import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type {
  TypedAutomationAggregateResponse,
  TypedAutomationCurrentActionResponse,
  UnifiedAutomationAction,
} from '../../main/types/api';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = { Pressable: host('Pressable'), StyleSheet: { create: <T,>(styles: T) => styles }, Text: host('Text'), View: host('View') };
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') return iconsMock;
  return originalLoad(request, parent, isMain);
};
const { UnifiedAutomationDashboard } = require(
  '../../main/features/automation/components/UnifiedAutomationDashboard',
) as typeof import('../../main/features/automation/components/UnifiedAutomationDashboard');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('UnifiedAutomationDashboard', () => {
  it('uses the same execution label to resume stopped and paused automation', async () => {
    for (const lifecycle of ['STOPPED', 'PAUSED'] as const) {
      const actions: UnifiedAutomationAction[] = [];
      const aggregate = networkStopped();
      aggregate.runtime.lifecycle = lifecycle;
      aggregate.runtime.stopReason = lifecycle === 'STOPPED' ? 'MANUAL_STOP' : null;
      const renderer = await renderDashboard(aggregate, (action) => { actions.push(action); });

      const execute = renderer.root.findByProps({ accessibilityLabel: '실행' });
      await act(async () => { execute.props.onPress(); });

      assert.deepEqual(actions, [lifecycle === 'STOPPED' ? 'start' : 'resume']);
      assert.equal(treeText(renderer.root).includes('계속'), false);
      assert.equal(treeText(renderer.root).includes('재개'), false);
    }
  });

  it('describes immediate stop and action-completing pause precisely', async () => {
    const aggregate = networkStopped();
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = null;
    const renderer = await renderDashboard(aggregate, () => undefined);

    assert.equal(hasText(
      renderer.root,
      '일시정지는 현재 실행 중인 행동을 마친 뒤 멈추고, 정지는 대기·실행 작업을 즉시 비웁니다.',
    ), true);
  });

  it('keeps all four running automation controls on one responsive row', async () => {
    const aggregate = networkStopped();
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = null;
    aggregate.runtime.nextAttemptAt = null;
    const renderer = await renderDashboard(aggregate, () => undefined);

    const row = renderer.root.findByProps({ testID: 'automation-action-row' });
    assert.equal(styleOf(row).flexWrap, 'nowrap');
    assert.equal(styleOf(row).width, '100%');
    const controls = ['일시정지', '정지', '설정', '기록'].map((label) =>
      renderer.root.findAllByProps({ accessibilityLabel: label })
        .find((node) => (node.type as unknown) === 'Pressable'));
    for (const control of controls) {
      assert.ok(control);
      assert.equal(styleOf(control).flex, 1);
      assert.equal(styleOf(control).minWidth, 0);
    }
  });

  it('shows network failures as automatic retry without a manual resume action', async () => {
    const actions: UnifiedAutomationAction[] = [];
    const aggregate = networkStopped();
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.nextAttemptAt = '2026-07-23T00:01:00Z';
    aggregate.runtime.waitReason = 'HOF_CONNECTION';
    aggregate.runtime.currentAction = null;
    const renderer = await renderDashboard(
      aggregate,
      (action) => { actions.push(action); },
      undefined,
      Date.parse('2026-07-23T00:00:00Z'),
    );

    assert.equal(hasText(renderer.root, '오류 재시도 대기'), true);
    assert.equal(hasText(renderer.root, '네트워크 오류가 발생했습니다. 1분 후 자동으로 다시 시도합니다.'), true);
    assert.equal(hasText(renderer.root, 'connection refused'), true);
    assert.equal(hasText(renderer.root, '오늘 모험맵 초기화 완료 · 오전 12:03'), true);
    assert.equal(hasText(renderer.root, '설정 경고 2개'), true);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '중지된 자동화 재개' }).length, 0);
    assert.deepEqual(actions, []);
  });

  it('keeps captcha waiting separate from network stop', async () => {
    let opened = 0;
    const aggregate = networkStopped();
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = 'CAPTCHA';
    aggregate.runtime.nextAttemptAt = '2026-07-23T00:01:00Z';
    aggregate.runtime.currentAction = null;
    aggregate.runtime.lastError = null;
    const renderer = await renderDashboard(aggregate, () => undefined, () => { opened += 1; });
    assert.equal(hasText(renderer.root, '캡차 인증이 필요합니다. 해결될 때까지 자동으로 다시 확인합니다.'), true);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '중지된 자동화 재개' }).length, 0);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '캡차 인증 열기' }).props.onPress(); });
    assert.equal(opened, 1);
  });

  it('keeps authentication waiting separate from a manual network resume', async () => {
    const aggregate = networkStopped();
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = 'AUTHENTICATION';
    aggregate.runtime.nextAttemptAt = '2026-07-23T00:01:00Z';
    aggregate.runtime.currentAction = null;
    aggregate.runtime.lastError = null;
    const renderer = await renderDashboard(
      aggregate,
      () => undefined,
      undefined,
      Date.parse('2026-07-23T00:00:00Z'),
    );

    assert.equal(hasText(renderer.root, '로그인 재시도 대기'), true);
    assert.equal(hasText(renderer.root, 'HOF 로그인이 필요합니다. 저장된 로그인 정보로 1분 후 다시 시도합니다.'), true);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '중지된 자동화 재개' }).length, 0);
  });

  it('shows normal waiting without claiming HOF is unavailable', async () => {
    const aggregate = networkStopped();
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = null;
    aggregate.runtime.nextAttemptAt = '2026-07-23T00:30:00Z';
    aggregate.runtime.waitReason = 'SCHEDULED';
    aggregate.runtime.lastError = null;
    aggregate.runtime.currentAction = null;

    const renderer = await renderDashboard(aggregate, () => undefined);

    assert.equal(hasText(renderer.root, '자동화 대기 중'), true);
    assert.equal(hasText(renderer.root, '현재 진행할 작업이 없습니다. 실행 가능한 작업이 생기면 자동으로 계속합니다.'), true);
    assert.equal(treeText(renderer.root).includes('HOF 서버 연결'), false);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '중지된 자동화 재개' }).length, 0);
  });

  it('shows a friendly timed retry only for HOF connection waits', async () => {
    const aggregate = networkStopped();
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = null;
    aggregate.runtime.nextAttemptAt = '2026-07-23T00:01:00Z';
    aggregate.runtime.waitReason = 'HOF_CONNECTION';
    aggregate.runtime.lastError = 'raw 503';
    aggregate.runtime.currentAction = null;

    const renderer = await renderDashboard(
      aggregate,
      () => undefined,
      undefined,
      Date.parse('2026-07-23T00:00:00Z'),
    );

    assert.equal(hasText(renderer.root, 'HOF 서버 연결 대기 중'), true);
    assert.equal(hasText(renderer.root, 'HOF 서버 연결이 원활하지 않습니다. 1분 후 자동으로 다시 시도합니다.'), true);
    assert.equal(treeText(renderer.root).includes('raw 503'), false);
  });

  it('uses a soon fallback for elapsed or invalid HOF retry timestamps', async () => {
    for (const nextAttemptAt of ['2026-07-22T23:59:59Z', 'not-a-timestamp']) {
      const aggregate = networkStopped();
      aggregate.runtime.lifecycle = 'RUNNING';
      aggregate.runtime.stopReason = null;
      aggregate.runtime.nextAttemptAt = nextAttemptAt;
      aggregate.runtime.waitReason = 'HOF_CONNECTION';
      aggregate.runtime.currentAction = null;

      const renderer = await renderDashboard(
        aggregate,
        () => undefined,
        undefined,
        Date.parse('2026-07-23T00:00:00Z'),
      );

      assert.equal(hasText(renderer.root, 'HOF 서버 연결이 원활하지 않습니다. 곧 자동으로 다시 시도합니다.'), true);
    }
  });

  it('shows a current action instead of stale wait metadata', async () => {
    const aggregate = networkStopped();
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = null;
    aggregate.runtime.nextAttemptAt = '2026-07-23T00:01:00Z';
    aggregate.runtime.waitReason = 'HOF_CONNECTION';

    const renderer = await renderDashboard(aggregate, () => undefined);

    assert.equal(hasText(renderer.root, '실행 중'), true);
    assert.equal(hasText(renderer.root, '전투맵 실행'), true);
    assert.equal(treeText(renderer.root).includes('서버 연결 대기'), false);
  });

  it('shows an active raid action as retrying when the runtime scheduled an error retry', async () => {
    const aggregate = networkStopped();
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = 'FATAL';
    aggregate.runtime.lastError = '현재 해당 레이드에서 실행할 수 없는 동작입니다.';
    aggregate.runtime.nextAttemptAt = '2026-07-23T00:01:00Z';
    aggregate.runtime.waitReason = 'HOF_CONNECTION';
    aggregate.runtime.currentAction = {
      source: 'RAID', kind: 'RAID_TOWN', actionLabel: '레이드', questName: null,
      missionLabel: null, missionCurrent: null, missionRequired: null, mapName: null, battleCount: null,
    };

    const renderer = await renderDashboard(
      aggregate,
      () => undefined,
      undefined,
      Date.parse('2026-07-23T00:00:00Z'),
    );

    assert.equal(hasText(renderer.root, '오류 재시도 대기'), true);
    assert.equal(hasText(renderer.root, '자동화 오류가 발생했습니다. 1분 후 자동으로 다시 시도합니다.'), true);
    assert.equal(hasText(renderer.root, '현재 해당 레이드에서 실행할 수 없는 동작입니다.'), true);
    assert.equal(hasText(renderer.root, '레이드'), true);
  });

  it('treats an omitted wait reason as normal scheduled waiting', async () => {
    const aggregate = networkStopped();
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = null;
    aggregate.runtime.nextAttemptAt = '2026-07-23T00:30:00Z';
    aggregate.runtime.currentAction = null;
    delete aggregate.runtime.waitReason;

    const renderer = await renderDashboard(aggregate, () => undefined);

    assert.equal(hasText(renderer.root, '자동화 대기 중'), true);
    assert.equal(treeText(renderer.root).includes('HOF 서버 연결'), false);
  });

  it('shows structured quest battle context without raw code or fake fraction', async () => {
    const aggregate = runtimeWithCurrentAction({
      source: 'QUEST',
      kind: 'QUEST_BATTLE',
      actionLabel: '퀘스트 전투',
      questName: '저택 동관 조사(반복)',
      missionLabel: '맵 클리어',
      missionCurrent: 21,
      missionRequired: 25,
      mapName: 'Culvert- 마을 지하 수로(입구)',
      battleCount: 1,
    });
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = null;
    aggregate.runtime.lastError = null;

    const renderer = await renderDashboard(aggregate, () => undefined);

    assert.equal(hasText(renderer.root, '퀘스트 전투'), true);
    assert.equal(hasText(renderer.root, '저택 동관 조사(반복)'), true);
    assert.equal(hasText(renderer.root, '맵 클리어 · 21/25'), true);
    assert.equal(hasText(renderer.root, 'Culvert- 마을 지하 수로(입구)'), true);
    assert.equal(hasText(renderer.root, '1회 전투 진행 중'), true);
    assert.equal(treeText(renderer.root).includes('1/1'), false);
    assert.equal(treeText(renderer.root).includes('tnfh1'), false);
  });

  it('uses a neutral battle fallback when legacy action names are missing', async () => {
    const aggregate = runtimeWithCurrentAction({
      source: 'QUEST',
      kind: 'QUEST_BATTLE',
      actionLabel: 'tnfh1',
      questName: null,
      missionLabel: null,
      missionCurrent: null,
      missionRequired: null,
      mapName: null,
      battleCount: null,
    });

    const renderer = await renderDashboard(aggregate, () => undefined);
    const text = treeText(renderer.root);

    assert.equal(hasText(renderer.root, '전투 진행 중'), true);
    assert.equal(text.includes('tnfh1'), false);
  });

  it('labels a union-owned battle as union instead of a generic battle map', async () => {
    const aggregate = runtimeWithCurrentAction({
      source: 'UNION',
      kind: 'BATTLE_MAP',
      actionLabel: '전투맵',
      questName: null,
      missionLabel: null,
      missionCurrent: null,
      missionRequired: null,
      mapName: '도적소탕',
      battleCount: 1,
    });
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = null;

    const renderer = await renderDashboard(aggregate, () => undefined);
    const currentAction = renderer.root.findByProps({ testID: 'current-automation-action' });

    assert.equal(hasText(currentAction, '유니온'), true);
    assert.equal(hasText(currentAction, '전투맵'), false);
    assert.equal(hasText(currentAction, '도적소탕'), true);
  });

  it('uses the next-work fallback when an action label is blank', async () => {
    const aggregate = runtimeWithCurrentAction({
      source: 'QUEST',
      kind: 'QUEST_ACCEPT',
      actionLabel: '   ',
      questName: null,
      missionLabel: null,
      missionCurrent: null,
      missionRequired: null,
      mapName: null,
      battleCount: null,
    });

    const renderer = await renderDashboard(aggregate, () => undefined);

    assert.equal(hasText(renderer.root, '다음 실행 작업을 확인하고 있어요'), true);
  });
});

async function renderDashboard(
  aggregate: TypedAutomationAggregateResponse,
  onChangeState: (action: UnifiedAutomationAction) => void,
  onOpenCaptcha = () => undefined,
  nowMs?: number,
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(UnifiedAutomationDashboard, {
      aggregate,
      busy: false,
      onChangeState,
      onOpenCaptcha,
      onOpenModule: () => undefined,
      onOpenSettings: () => undefined,
      nowMs,
    }));
  });
  return renderer;
}
function hasText(root: ReactTestInstance, text: string): boolean {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length > 0;
}
function treeText(root: ReactTestInstance): string {
  return root.findAll((node) => (node.type as unknown) === 'Text').flatMap((node) => node.children).filter((child): child is string => typeof child === 'string').join(' ');
}
function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const rawStyle = typeof node.props.style === 'function'
    ? node.props.style({ pressed: false })
    : node.props.style;
  const values = Array.isArray(rawStyle) ? rawStyle : [rawStyle];
  return Object.assign({}, ...values.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object'));
}
function runtimeWithCurrentAction(currentAction: TypedAutomationCurrentActionResponse): TypedAutomationAggregateResponse {
  const aggregate = networkStopped();
  aggregate.runtime.currentAction = currentAction;
  return aggregate;
}
function networkStopped(): TypedAutomationAggregateResponse {
  return {
    entries: [{
      id: 2, type: 'BATTLE_MAP', enabled: true, priority: 0, ready: false, warnings: ['missing'], quests: [],
      battleMaps: [], battleMapProgress: [], adventureMaps: [],
    }],
    runtime: {
      lifecycle: 'STOPPED',
      stopReason: 'NETWORK',
      nextAttemptAt: null,
      waitReason: null,
      warnings: ['missing', 'another'],
      lastError: 'connection refused',
      currentAction: {
        source: 'BATTLE_MAP',
        kind: 'BATTLE_MAP',
        actionLabel: '전투맵 실행',
        questName: null,
        missionLabel: null,
        missionCurrent: null,
        missionRequired: null,
        mapName: 'Castle In The Sky- 천공성(제 2탑)',
        battleCount: 3,
      },
      dailyRefresh: { status: 'COMPLETE', refreshDate: '2026-07-16', refreshedAt: '2026-07-15T15:03:00Z' },
    },
  };
}
