import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import type { AutomationHistoryPage, TypedAutomationAggregateResponse } from '../../main/types/api';

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
  if (request === 'lucide-react-native') return new Proxy({}, { get: (_target, property) => host(String(property)) });
  if (request === 'react-native-draggable-flatlist') {
    return { NestableScrollContainer: host('NestableScrollContainer') };
  }
  return originalLoad(request, parent, isMain);
};
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { AutomationHistoryScreen } = require(
  '../../main/features/automation/components/AutomationHistoryScreen',
) as typeof import('../../main/features/automation/components/AutomationHistoryScreen');
const { UnifiedAutomationDashboard } = require('../../main/features/automation/components/UnifiedAutomationDashboard') as typeof import('../../main/features/automation/components/UnifiedAutomationDashboard');
moduleWithLoader._load = originalLoad;

afterEach(async () => rntl.cleanup());

const failure = {
  entryId: 5, entryDisplayName: '퀘스트', targetKey: 'q:private-internal-key', targetName: '보존할 퀘스트',
  message: '행동 생성 중 오류가 발생해 HOF 요청을 전송하지 않았습니다. 해당 대상은 잠시 보류하고 다른 자동화를 계속 판단합니다.',
  retryAt: '2026-09-09T03:11:00Z',
};
const aggregate: TypedAutomationAggregateResponse = {
  entries: [],
  runtime: { lifecycle: 'RUNNING', stopReason: null, nextAttemptAt: null, warnings: [], lastError: null,
    currentAction: null, dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null },
    preparationFailures: [failure] },
};
const dashboardProps = { busy: false, onChangeState: () => undefined, onOpenCaptcha: () => undefined,
  onOpenModule: () => undefined, onOpenSettings: () => undefined, nowMs: Date.parse('2026-09-09T03:10:10Z') };

describe('자동화 준비 실패 표시', () => {
  it('shows the affected target, Korean stage and retry time, then removes the current failure on recovery', async () => {
    await rntl.render(React.createElement(UnifiedAutomationDashboard, { ...dashboardProps, aggregate }));
    assert.ok(rntl.screen.getByText('퀘스트 · 준비 실패'));
    assert.ok(rntl.screen.getByText('보존할 퀘스트'));
    assert.ok(rntl.screen.getByText(failure.message));
    assert.ok(rntl.screen.getByText(`재판단 예정 ${new Date(failure.retryAt).toLocaleString('ko-KR')}`));
    assert.equal(rntl.screen.queryByText(failure.targetKey), null);
    await rntl.screen.rerender(React.createElement(UnifiedAutomationDashboard, { ...dashboardProps,
      aggregate, nowMs: Date.parse(failure.retryAt) + 1000 }));
    assert.ok(rntl.screen.getByText('퀘스트 · 준비 실패'));
    assert.ok(rntl.screen.getByText('예정 시각이 되어 최신 상태를 다시 확인합니다.'));
    await rntl.screen.rerender(React.createElement(UnifiedAutomationDashboard, { ...dashboardProps,
      aggregate: { ...aggregate, runtime: { ...aggregate.runtime, preparationFailures: [] } } }));
    assert.equal(rntl.screen.queryByText('퀘스트 · 준비 실패'), null);
    assert.equal(rntl.screen.queryByText(failure.message), null);
  });

  it('reloads durable failure history on reentry and distinguishes an uncertain submitted result', async () => {
    const event: AutomationHistoryPage['cycles'][number]['events'][number] = {
      id: 9, sequence: 1, entryId: 5, type: 'QUEST', entryDisplayName: '퀘스트', kind: 'ACTION_FAILED',
      reasonCode: 'ACTION_PREPARATION_FAILED', message: failure.message, targetKey: failure.targetKey,
      targetName: failure.targetName, actionKind: 'QUEST_CLAIM', presetId: null, presetName: null,
      nextRunAt: failure.retryAt, occurredAt: '2026-09-09T03:10:00Z',
    };
    const uncertain = { ...event, id: 10, sequence: 2, kind: 'WAITING' as const, reasonCode: 'AMBIGUOUS_RESULT_VERIFY',
      message: '이전 요청의 처리 결과가 불확실해 HOF 최신 상태로 적용 여부를 재확인합니다.' };
    let reads = 0;
    const load = async (): Promise<AutomationHistoryPage> => {
      reads += 1;
      return { nextCursor: null, cycles: [{ id: 1, selectedEntryId: 5, result: 'ACTION_SELECTED',
        startedAt: event.occurredAt, finishedAt: uncertain.occurredAt, events: [event, uncertain] }] };
    };
    for (let entry = 0; entry < 2; entry += 1) {
      await rntl.render(React.createElement(AutomationHistoryScreen, { onBack: () => undefined, load }));
      await rntl.screen.findByText('퀘스트 · 준비 실패');
      assert.ok(rntl.screen.getAllByText(/HOF 요청을 전송하지 않았습니다/).length);
      assert.ok(rntl.screen.getAllByText(/요청 결과가 불확실해 중복 실행 없이 상태를 재확인함/).length);
      assert.ok(rntl.screen.getAllByText(/준비 단계에서 전송하지 않고 해당 대상을 잠시 보류함/).length);
      await rntl.screen.unmount();
    }
    assert.equal(reads, 2);
  });
});
