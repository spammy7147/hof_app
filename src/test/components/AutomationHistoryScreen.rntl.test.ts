import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import type { AutomationHistoryPage } from '../../main/types/api';

const host = (name: string) => (props: Record<string, unknown>) =>
  React.createElement(name, props, props.children as React.ReactNode);
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
  it('shows one numbered fishing decision with nested START, CATCH, and obstruction battle evidence', async () => {
    const homeEvent = historyEvent(1, 0, 10, 'HOME_QUEST', 'SKIPPED', 'HOME_IDLE', null);
    const fishingEvent = historyEvent(2, 1, 11, 'FISHING', 'SELECTED', 'RUNNABLE', 'FISHING_TOWN');
    const startEvent = historyEvent(3, 2, 11, 'FISHING', 'ACTION_SUCCEEDED', 'FISHING_START_APPLIED', 'START');
    const catchEvent = historyEvent(4, 3, 11, 'FISHING', 'ACTION_SUCCEEDED', 'FISHING_CATCH_APPLIED', 'CATCH');
    const battleEvent = historyEvent(5, 4, 11, 'FISHING', 'ACTION_SUCCEEDED', 'FISHING_OBSTRUCTION_BATTLE_APPLIED', 'BATTLE');
    const load = async (): Promise<AutomationHistoryPage> => ({
      nextCursor: null,
      cycles: [{
        id: 9,
        result: 'ACTION_SELECTED',
        selectedEntryId: 11,
        startedAt: '2026-08-24T00:00:00Z',
        finishedAt: '2026-08-24T00:00:01Z',
        events: [homeEvent, fishingEvent, startEvent, catchEvent, battleEvent],
        topLevelStepCount: 2,
        steps: [
          { sequence: 1, event: homeEvent, executionEvents: [] },
          { sequence: 2, event: fishingEvent, executionEvents: [startEvent, catchEvent, battleEvent] },
        ],
      }],
    });

    await rntl.render(React.createElement(AutomationHistoryScreen, { onBack: () => undefined, load }));

    await rntl.screen.findByText('판단 과정 2단계');
    assert.ok(rntl.screen.getByLabelText('낚시 사이클 실행 단계'));
    assert.ok(rntl.screen.getByText('낚시 사이클 · 실행'));
    assert.equal(rntl.screen.getAllByText('동작 낚시 시작').length, 1);
    assert.equal(rntl.screen.getAllByText('동작 낚기').length, 1);
    assert.equal(rntl.screen.getAllByText('동작 전투').length, 1);
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
