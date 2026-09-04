import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import type { AutomationHistoryPage } from '../../main/types/api';
import type { AutomationConvergenceStatus } from '../../main/types/api';

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
  it('shows skipped conditions and a completed check separately from the next check time', async () => {
    const load = async (): Promise<AutomationHistoryPage> => ({
      nextCursor: null,
      cycles: [{
        id: 56245,
        result: 'IDLE',
        selectedEntryId: null,
        startedAt: '2026-08-30T10:36:34Z',
        finishedAt: '2026-08-30T10:36:34Z',
        events: [{
          id: 9,
          sequence: 8,
          entryId: 3,
          type: 'BATTLE_MAP',
          entryDisplayName: '전투 맵 2',
          kind: 'SKIPPED',
          reasonCode: 'COOLDOWN',
          message: '쿨다운 중이므로 이번 판단에서 건너뜁니다.',
          targetKey: null,
          targetName: null,
          actionKind: null,
          presetId: null,
          presetName: null,
          nextRunAt: '2026-08-30T10:53:40Z',
          occurredAt: '2026-08-30T10:36:34Z',
        }],
      }],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(AutomationHistoryScreen, {
        onBack: () => undefined,
        load,
        nextAutomationDecisionAt: '2026-08-30T10:41:34Z',
      }));
    });

    const globalWait = renderer.root.findByProps({ accessibilityLabel: '전체 자동화 확인 결과' });
    const entryWait = renderer.root.findByProps({ accessibilityLabel: '최근 항목 판단' });
    assert.ok(treeText(globalWait).includes('실행 가능한 항목 없음'));
    assert.ok(treeText(globalWait).includes('다음 전체 확인'));
    assert.ok(treeText(globalWait).includes(new Date('2026-08-30T10:41:34Z').toLocaleString('ko-KR')));
    assert.ok(treeText(entryWait).includes('전투 맵 2'));
    assert.ok(treeText(entryWait).includes('최근 항목 스킵 사유'));
    assert.ok(treeText(renderer.root).includes('전투 맵 2 · 스킵'));
    assert.ok(!treeText(renderer.root).includes('재판단 대기'));
    assert.ok(!treeText(renderer.root).includes('쿨다운 종료 시각까지 기다림'));
    assert.ok(treeText(entryWait).includes('해당 항목 재확인'));
    assert.ok(treeText(entryWait).includes(new Date('2026-08-30T10:53:40Z').toLocaleString('ko-KR')));
  });

  it('shows fishing START CATCH and obstruction battle as two separate global decisions', async () => {
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
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(AutomationHistoryScreen, { onBack: () => undefined, load }));
    });

    const text = treeText(renderer.root);
    const scroller = renderer.root.find((node) => String(node.type) === 'NestableScrollContainer');
    assert.deepEqual(scroller.props.stickyHeaderIndices, [0]);
    assert.ok(text.includes('판단 과정 2단계'));
    assert.ok(text.includes('낚시 사이클 · 실행'));
    assert.ok(text.includes('동작 낚시 시작'));
    assert.ok(text.includes('동작 낚기'));
    assert.ok(text.includes('동작 전투'));
    assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '낚시 사이클 실행 단계' }).length >= 2);
    assert.ok(!text.includes('패턴 로드'));
  });

  it('summarizes the latest raid blockage without exposing backend identifiers', async () => {
    const load = async (): Promise<AutomationHistoryPage> => ({
      nextCursor: null,
      cycles: [{
        id: 1, result: 'ACTION_SELECTED', selectedEntryId: 9,
        startedAt: '2026-08-14T00:00:00Z', finishedAt: '2026-08-14T00:00:01Z',
        events: [{
          id: 2, sequence: 2, entryId: 9, type: 'RAID', entryDisplayName: '최우선 레이드', kind: 'ACTION_FAILED',
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
    assert.ok(text.includes('최우선 레이드 · 전투 시작'));
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

  it('renders typed raid cooldown and reward waits as scoped normal waits', async () => {
    const load = async (): Promise<AutomationHistoryPage> => ({
      nextCursor: null,
      cycles: [{
        id: 4, result: 'WAITING', selectedEntryId: null,
        startedAt: '2026-08-23T00:00:00Z', finishedAt: '2026-08-23T00:00:01Z',
        events: [{
          id: 41, sequence: 0, entryId: 9, type: 'RAID', kind: 'WAITING',
          reasonCode: 'RAID_BATTLE_SAFETY_GATE', message: '레이드 전용 안전 시간까지 기다립니다.',
          targetKey: null, targetName: '고블린 전투 마차', actionKind: 'WAIT',
          presetId: null, presetName: null, nextRunAt: '2026-08-23T00:02:00Z',
          occurredAt: '2026-08-23T00:00:00Z', diagnosticKind: 'RAID_LOCAL_SAFETY_GATE',
          cooldownSource: 'LOCAL_FALLBACK', impactScope: 'RAID_ONLY',
          releaseCondition: '마감 뒤 최신 레이드 상태에서 실행 가능 여부 확인',
        }, {
          id: 42, sequence: 1, entryId: 9, type: 'RAID', kind: 'WAITING',
          reasonCode: 'RAID_REWARD_CONFIRMATION_WAIT', message: '보상 가능 시각까지 기다립니다.',
          targetKey: null, targetName: '고블린 전투 마차', actionKind: 'WAIT',
          presetId: null, presetName: null, nextRunAt: '2026-08-23T00:30:00Z',
          occurredAt: '2026-08-23T00:00:01Z', diagnosticKind: 'RAID_REWARD_CONFIRMATION_WAIT',
          cooldownSource: null, impactScope: 'RAID_ONLY',
          releaseCondition: '마감 뒤 최신 보상 가능 상태 재확인',
        }],
      }],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(AutomationHistoryScreen, { onBack: () => undefined, load })); });

    const text = treeText(renderer.root);
    assert.ok(text.includes('로컬 안전 게이트'));
    assert.ok(text.includes('보상 확인 대기'));
    assert.ok(text.includes('영향  레이드 전투만'));
    assert.ok(text.includes('다른 자동화는 계속 진행됩니다.'));
    assert.ok(!text.includes('설정 경고'));
    assert.equal(renderer.root.findAllByProps({ accessibilityRole: 'alert' }).length, 0);
  });

  it('announces typed raid held and unknown diagnostics as accessibility alerts', async () => {
    const load = async (): Promise<AutomationHistoryPage> => ({
      nextCursor: null,
      cycles: [{
        id: 5, result: 'WAITING', selectedEntryId: null,
        startedAt: '2026-08-23T00:00:00Z', finishedAt: '2026-08-23T00:00:01Z',
        events: [{
          id: 51, sequence: 0, entryId: 9, type: 'RAID', kind: 'CONFIGURATION_WARNING',
          reasonCode: 'RAID_BATTLE_GATE_HELD_5', message: '레이드 전투 상태를 수동 확인해야 합니다.',
          targetKey: null, targetName: '고블린 전투 마차', actionKind: 'HOLD',
          presetId: null, presetName: null, nextRunAt: null,
          occurredAt: '2026-08-23T00:00:00Z', diagnosticKind: 'RAID_COOLDOWN_OBSERVATION_HELD',
          cooldownSource: null, impactScope: 'RAID_ONLY', releaseCondition: '수동 확인 뒤 새 판단',
        }, {
          id: 52, sequence: 1, entryId: 9, type: 'RAID', kind: 'CONFIGURATION_WARNING',
          reasonCode: 'RAID_BATTLE_UNKNOWN_RESULT', message: '레이드 전투 결과를 확정하지 못했습니다.',
          targetKey: null, targetName: '고블린 전투 마차', actionKind: 'BATTLE',
          presetId: null, presetName: null, nextRunAt: null,
          occurredAt: '2026-08-23T00:00:01Z', diagnosticKind: 'RAID_BATTLE_RESULT_UNKNOWN',
          cooldownSource: null, impactScope: 'RAID_ONLY', releaseCondition: '수동 확인 뒤 새 판단',
        }],
      }],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(AutomationHistoryScreen, { onBack: () => undefined, load })); });

    const alerts = renderer.root.findAllByProps({ accessibilityRole: 'alert' });
    assert.ok(alerts.length >= 2);
    assert.ok(alerts.every((alert) => alert.props.accessibilityLiveRegion === 'assertive'));
  });

  it('shows battle captcha and scoped convergence without blocking unrelated automation', async () => {
    const load = async (): Promise<AutomationHistoryPage> => ({ cycles: [], nextCursor: null });
    const convergence: AutomationConvergenceStatus = {
      battleGate: {
        challengeId: 91,
        reason: '전투 요청에 캡차가 필요합니다.',
        openedAt: '2026-08-22T00:00:00Z',
        impactScope: '모든 전투 자동화',
        releaseCondition: '캡차 완료 후 최신 상태에서 다시 판단',
      },
      items: [{
        attemptId: 77,
        entryId: 5,
        actionKind: 'UNION_BATTLE',
        scopeKind: 'UNION_ENTRY',
        scopeKey: '5',
        result: 'PENDING',
        successfulObservationCount: 2,
        nextProbeAt: '2026-08-22T00:00:10Z',
        reasonCode: 'OBSERVATION_INCOMPLETE',
        reasonMessage: '백엔드가 제공한 정확한 관측 사유입니다.',
        evidenceCaseId: null,
        impactScope: '유니온 자동화 5',
        releaseCondition: '최대 5회 또는 2분까지 읽기 전용으로 재확인',
        canAllowFreshDecision: false,
      }],
    };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(AutomationHistoryScreen, {
        onBack: () => undefined,
        load,
        loadConvergence: async () => convergence,
        allowFreshDecision: async () => convergence,
      }));
    });

    const text = treeText(renderer.root);
    assert.ok(text.includes('전투 캡차 대기'));
    assert.ok(text.includes('다른 비전투 자동화는 계속 진행됩니다.'));
    assert.ok(text.includes('유니온 전투'));
    assert.ok(text.includes('관측 2/5'));
    assert.ok(text.includes('백엔드가 제공한 정확한 관측 사유입니다.'));
    assert.ok(text.includes('읽기 전용으로 재확인'));
    assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '수렴 상태 새로고침' }).length >= 1);
  });

  it('allows a held scope to close without replaying its saved request', async () => {
    const load = async (): Promise<AutomationHistoryPage> => ({ cycles: [], nextCursor: null });
    const held: AutomationConvergenceStatus = {
      battleGate: null,
      items: [{
        attemptId: 88, entryId: 9, actionKind: 'RAID_START', scopeKind: 'RAID_ENTRY', scopeKey: 'Raid001',
        result: 'HELD', successfulObservationCount: 5, nextProbeAt: null, reasonCode: 'MAX_OBSERVATIONS',
        reasonMessage: '자동 관측 예산 안에 결과를 확정하지 못했습니다.',
        evidenceCaseId: 'evidence-1', impactScope: '레이드 사이클 Raid001',
        releaseCondition: '상태 변경 또는 사용자의 새 행동 판단 허용', canAllowFreshDecision: true,
      }],
    };
    const released: AutomationConvergenceStatus = { battleGate: null, items: [] };
    const calls: number[] = [];
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(AutomationHistoryScreen, {
        onBack: () => undefined,
        load,
        loadConvergence: async () => held,
        allowFreshDecision: async (attemptId: number) => { calls.push(attemptId); return released; },
      }));
    });

    const button = renderer.root.findByProps({ accessibilityLabel: '레이드 시작 새 행동 판단 허용' });
    await act(async () => { button.props.onPress(); });

    assert.deepEqual(calls, [88]);
    assert.ok(!treeText(renderer.root).includes('보류된 결과'));
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

function treeText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : treeText(child)).join('');
}
