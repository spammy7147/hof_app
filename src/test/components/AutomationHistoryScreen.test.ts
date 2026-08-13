import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import type { AutomationHistoryPage } from '../../main/types/api';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return {
    ActivityIndicator: host('ActivityIndicator'), Pressable: host('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 }, Text: host('Text'), View: host('View'),
  };
  if (request === 'lucide-react-native') return { ArrowLeft: host('ArrowLeft') };
  if (request === 'react-native-draggable-flatlist') return { NestableScrollContainer: host('NestableScrollContainer') };
  return originalLoad(request, parent, isMain);
};
const { AutomationHistoryScreen } = require(
  '../../main/features/automation/components/AutomationHistoryScreen',
) as typeof import('../../main/features/automation/components/AutomationHistoryScreen');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AutomationHistoryScreen', () => {
  it('summarizes the latest raid blockage without exposing backend identifiers', async () => {
    const load = async (): Promise<AutomationHistoryPage> => ({
      nextCursor: null,
      cycles: [{
        id: 1, result: 'ACTION_SELECTED', selectedEntryId: 9,
        startedAt: '2026-08-14T00:00:00Z', finishedAt: '2026-08-14T00:00:01Z',
        events: [{
          id: 2, sequence: 2, entryId: 9, type: 'RAID', kind: 'ACTION_FAILED',
          reasonCode: 'ACTION_FAILED', message: "전투 시작 단계 · 현재 해당 레이드에서 실행할 수 없는 동작입니다. · 관측 상태: 파티 모집 중",
          targetKey: 'Raid001', targetName: '고블린 전투 마차', actionKind: 'START',
          presetId: null, presetName: null, nextRunAt: null, occurredAt: '2026-08-14T00:00:01Z',
        }],
      }],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(AutomationHistoryScreen, { onBack: () => undefined, load })); });

    const text = treeText(renderer.root);
    assert.ok(text.includes('최근 막힘 사유'));
    assert.ok(text.includes('레이드 · 전투 시작'));
    assert.ok(text.includes('고블린 전투 마차'));
    assert.ok(text.includes('기록 시각'));
    assert.ok(text.includes('관측 상태: 파티 모집 중'));
    assert.ok(text.includes('판단 내용'));
    assert.ok(text.includes('실행 중 오류가 발생해 자동 재시도 대상으로 전환됨'));
    assert.ok(!text.includes('대상 식별자'));
    assert.ok(!text.includes('Raid001'));
    assert.ok(!text.includes('ACTION_FAILED'));
  });

  it('translates legacy fishing action values and messages for users', async () => {
    const load = async (): Promise<AutomationHistoryPage> => ({
      nextCursor: null,
      cycles: [{
        id: 2, result: 'ACTION_SELECTED', selectedEntryId: 3,
        startedAt: '2026-08-14T00:00:00Z', finishedAt: '2026-08-14T00:00:01Z',
        events: [{
          id: 3, sequence: 0, entryId: 3, type: 'FISHING', kind: 'SELECTED',
          reasonCode: 'RUNNABLE', message: '낚시 화면의 다음 동작이 START입니다. · 남은 낚시 3회',
          targetKey: null, targetName: null, actionKind: 'FISHING_TOWN', presetId: null,
          presetName: null, nextRunAt: null, occurredAt: '2026-08-14T00:00:00Z',
        }],
      }],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(AutomationHistoryScreen, { onBack: () => undefined, load })); });

    const text = treeText(renderer.root);
    assert.ok(text.includes('동작 낚시 진행'));
    assert.ok(text.includes('낚시 화면에서 ‘낚시 시작’ 버튼을 확인했습니다.'));
    assert.ok(!text.includes('FISHING_TOWN'));
    assert.ok(!text.includes('START입니다'));
  });
});

function treeText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : treeText(child)).join('');
}
