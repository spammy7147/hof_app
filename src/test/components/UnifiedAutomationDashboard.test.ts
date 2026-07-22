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
  it('separates a fatal network stop and exposes only a manual resume action', async () => {
    const actions: UnifiedAutomationAction[] = [];
    const renderer = await renderDashboard(networkStopped(), (action) => { actions.push(action); });

    assert.equal(hasText(renderer.root, '네트워크 오류로 자동화가 중지되었습니다.'), true);
    assert.equal(hasText(renderer.root, 'connection refused'), true);
    assert.equal(hasText(renderer.root, '전투맵 실행'), true);
    assert.equal(hasText(renderer.root, 'Castle In The Sky- 천공성(제 2탑)'), true);
    assert.equal(hasText(renderer.root, '3회 전투 진행 중'), true);
    assert.equal(hasText(renderer.root, '오늘 모험맵 초기화 완료 · 오전 12:03'), true);
    assert.equal(hasText(renderer.root, '설정 경고 2개'), true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '중지된 자동화 재개' }).props.onPress(); });
    assert.deepEqual(actions, ['resume']);
  });

  it('keeps captcha waiting separate from network stop', async () => {
    let opened = 0;
    const aggregate = networkStopped();
    aggregate.runtime.stopReason = 'CAPTCHA';
    aggregate.runtime.lastError = null;
    const renderer = await renderDashboard(aggregate, () => undefined, () => { opened += 1; });
    assert.equal(hasText(renderer.root, '캡차 인증이 필요합니다.'), true);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '중지된 자동화 재개' }).length, 0);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '캡차 인증 열기' }).props.onPress(); });
    assert.equal(opened, 1);
  });

  it('keeps authentication waiting separate from a manual network resume', async () => {
    const aggregate = networkStopped();
    aggregate.runtime.stopReason = 'AUTHENTICATION';
    aggregate.runtime.lastError = null;
    const renderer = await renderDashboard(aggregate, () => undefined);

    assert.equal(hasText(renderer.root, 'HOF 로그인이 필요합니다. 저장된 로그인 정보로 재로그인을 확인하고 있어요.'), true);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '중지된 자동화 재개' }).length, 0);
  });

  it('shows a friendly automatic retry state while a running runtime is cooling down', async () => {
    const aggregate = networkStopped();
    aggregate.runtime.lifecycle = 'RUNNING';
    aggregate.runtime.stopReason = null;
    aggregate.runtime.nextAttemptAt = '2026-07-23T00:03:00Z';
    aggregate.runtime.lastError = 'HOF automation requests are deferred until 2026-07-23T00:03:00Z';

    const renderer = await renderDashboard(aggregate, () => undefined);

    assert.equal(hasText(renderer.root, 'HOF 서버 연결 대기 중'), true);
    assert.equal(hasText(renderer.root, '잠시 후 자동으로 다시 시도합니다.'), true);
    assert.equal(treeText(renderer.root).includes('deferred until'), false);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '중지된 자동화 재개' }).length, 0);
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
