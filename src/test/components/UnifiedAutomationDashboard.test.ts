import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { TypedAutomationAggregateResponse, UnifiedAutomationAction } from '../../main/types/api';

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
    assert.equal(hasText(renderer.root, '전투맵 · Castle202'), true);
    assert.equal(hasText(renderer.root, '전투 1/3'), true);
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
      currentAction: { source: 'BATTLE_MAP', kind: 'BATTLE_MAP', title: 'Castle202', battleCurrent: 1, battleTotal: 3 },
      dailyRefresh: { status: 'COMPLETE', refreshDate: '2026-07-16', refreshedAt: '2026-07-15T15:03:00Z' },
    },
  };
}
