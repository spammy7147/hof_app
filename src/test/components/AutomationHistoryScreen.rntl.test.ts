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
