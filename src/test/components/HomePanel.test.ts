import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const mock = {
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => React.createElement(
    'FlatList',
    props,
    props.ListHeaderComponent as React.ReactNode,
    (props.data as Array<{ id: string }>).map((item) => React.createElement(React.Fragment, { key: item.id }, (props.renderItem as Function)({ item }))),
    props.ListFooterComponent as React.ReactNode,
  ),
  Modal: host('Modal'),
  Pressable: host('Pressable'),
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  TextInput: host('TextInput'),
  View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => request === 'react-native'
  ? mock
  : request === 'react-native-safe-area-context'
    ? { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }
    : request === 'expo-image'
      ? { Image: host('Image') }
      : originalLoad(request, parent, isMain);
const { HomePanel } = require('../../main/features/town/panels/HomePanel') as typeof import('../../main/features/town/panels/HomePanel');
moduleWithLoader._load = originalLoad;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null;
afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; });

describe('HomePanel', () => {
  it('자택 lifecycle과 휴식처 수동 복구 action만 표시한다', async () => {
    const home = {
      mode: 'HOME',
      quests: [
        { id: '1', name: '방 정리', state: 'ACTIVE', mission: '조건 0/1', reward: null, details: ['제한 하루 1회'], actionId: null },
        { id: '2', name: '손님 맞이', state: 'CLAIMABLE', mission: '조건 1/1', reward: 'Funds', details: ['진행도 1/1', '보상 Funds'], actionId: 'claim' },
      ],
      actions: [],
      restStatus: null,
      result: null,
    };
    const calls: unknown[] = [];
    await render(React.createElement(HomePanel, {
      api: { load: async () => home, submit: async (path: string, body: unknown) => { calls.push({ path, body }); return home; } } as never,
      mode: 'home',
    }));

    assert.match(text(), /조건 달성 중/);
    assert.match(text(), /제한 하루 1회/);
    assert.doesNotMatch(text(), /진행도 1\/1/);
    assert.match(text(), /진행 중 1/);
    assert.match(text(), /완료 가능 1/);
    await press('완료 가능 1');
    assert.doesNotMatch(text(), /제한 하루 1회/);
    assert.match(text(), /진행도 1\/1/);
    await press('손님 맞이 완료 가능');
    await press('완료');
    assert.deepEqual(calls, [{ path: '/api/town/home/quests', body: { actionId: 'claim' } }]);
  });

  it('자택 퀘스트를 상태별 카테고리와 개수로 분리한다', async () => {
    const home = {
      mode: 'HOME',
      quests: [
        { id: 'active', name: '진행 퀘스트', state: 'ACTIVE', mission: null, reward: null, details: [], actionId: null },
        { id: 'claimable', name: '완료 가능 퀘스트', state: 'CLAIMABLE', mission: null, reward: null, details: [], actionId: 'claim' },
        { id: 'available', name: '수락 가능 퀘스트', state: 'AVAILABLE', mission: null, reward: null, details: [], actionId: 'accept' },
        { id: 'waiting', name: '대기 퀘스트', state: 'WAITING', mission: null, reward: null, details: [], actionId: null },
        { id: 'completed', name: '완료 퀘스트', state: 'COMPLETED', mission: null, reward: null, details: [], actionId: null },
      ],
      actions: [],
      restStatus: null,
      result: null,
    };
    await render(React.createElement(HomePanel, {
      api: { load: async () => home, submit: async () => home } as never,
      mode: 'home',
    }));

    assert.match(text(), /진행 중 1/);
    assert.match(text(), /완료 가능 1/);
    assert.match(text(), /수락 가능 1/);
    assert.match(text(), /대기 중 1/);
    assert.match(text(), /완료 1/);
    assert.match(text(), /진행 퀘스트/);
    assert.doesNotMatch(text(), /대기 퀘스트/);

    await press('대기 중 1');
    assert.match(text(), /대기 퀘스트/);
    assert.doesNotMatch(text(), /진행 퀘스트/);
  });

  it('휴식 성공을 상태 카드에 반영하고 이미 완료한 action을 다시 노출하지 않는다', async () => {
    const rest = {
      mode: 'REST',
      quests: [],
      actions: [{ id: 'restore', type: 'RESTORE', label: '휴식실에서 회복한다' }],
      restStatus: { currentTime: 5700, maxTime: 6000, baseRecovery: 3000, facilityRecovery: 200, usedToday: false, facilities: ['Sleep Wear (Housing) 편안한 숙면에 도움을 줍니다. 효과: 휴식 시 Time 회복량을 250 증가시킵니다. 사용 가능 개수: 10개'] },
      result: null,
    };
    const completed = {
      ...rest,
      actions: rest.actions,
      restStatus: { ...rest.restStatus, currentTime: 6000, usedToday: true },
      result: { status: 'SUCCESS', messages: ['파티원들은 충분한 휴식을 취했다.', 'Time이 300 회복되었습니다.'], items: [], refreshRequired: true },
    };
    const calls: unknown[] = [];
    await render(React.createElement(HomePanel, {
      api: { load: async () => rest, submit: async (path: string, body: unknown) => { calls.push({ path, body }); return completed; } } as never,
      mode: 'rest',
    }));

    assert.match(text(), /Time 5,700 \/ 6,000/);
    assert.match(text(), /현재 예상 회복 300 Time · 초과 2,900 Time/);
    assert.doesNotMatch(text(), /수동 복구 action/);
    assert.doesNotMatch(text(), /자동 반복 없이/);
    assert.match(text(), /보유 시설 1개/);
    assert.match(text(), /Sleep Wear \(Housing\)/);
    assert.match(text(), /편안한 숙면에 도움을 줍니다/);
    assert.match(text(), /10개/);
    assert.equal(mounted!.root.findAllByProps({ accessibilityLabel: '보유 시설 펼치기' }).length, 0);
    const initialText = mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
    assert.ok(initialText.indexOf('휴식을 취한다') < initialText.indexOf('Sleep Wear (Housing)'));
    await press('휴식을 취한다');
    assert.deepEqual(calls, [{ path: '/api/town/rest/restore', body: { actionId: 'restore' } }]);
    assert.match(text(), /Time 6,000 \/ 6,000/);
    assert.match(text(), /오늘의 휴식 완료/);
    assert.match(text(), /\+300 Time 회복/);
    assert.doesNotMatch(text(), /파티원들은 충분한 휴식을 취했다/);
    assert.doesNotMatch(text(), /Time이 300 회복되었습니다/);
    assert.equal(mounted!.root.findAllByProps({ accessibilityLabel: '휴식을 취한다' }).length, 0);
    assert.equal(mounted!.root.findAllByProps({ testID: 'town-confirm-sheet' }).length, 0);
    assert.equal(mounted!.root.findAllByProps({ accessibilityLabel: '마을 정보 새로고침' }).length, 0);
  });

  it('휴식 실패 메시지를 별도 결과 카드 대신 상태 카드 하단에 표시한다', async () => {
    const rest = {
      mode: 'REST',
      quests: [],
      actions: [{ id: 'restore', type: 'RESTORE', label: '휴식실에서 회복한다' }],
      restStatus: { currentTime: 5700, maxTime: 6000, baseRecovery: 300, facilityRecovery: 0, usedToday: false, facilities: [] },
      result: null,
    };
    const failed = {
      ...rest,
      result: { status: 'FAILURE', messages: ['오늘은 더 이상 휴식할 수 없습니다.'], items: [], refreshRequired: false },
    };
    await render(React.createElement(HomePanel, {
      api: { load: async () => rest, submit: async () => failed } as never,
      mode: 'rest',
    }));

    await press('휴식을 취한다');

    const statusCard = mounted!.root.findByProps({ accessibilityLabel: '현재 휴식 상태' });
    const problem = statusCard.find((node) => String(node.type) === 'Text' && node.children.join('') === '오늘은 더 이상 휴식할 수 없습니다.');
    assert.equal(problem.props.accessibilityRole, 'alert');
    assert.equal(problem.props.style.color, '#ff7b7b');
    assert.equal(mounted!.root.findAll((node) => String(node.type) === 'Text' && node.children.join('') === '오늘은 더 이상 휴식할 수 없습니다.').length, 1);
  });
});

async function render(node: React.ReactElement) {
  await act(async () => { mounted = create(node); });
  await act(async () => { await Promise.resolve(); });
}

function text() {
  return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' ');
}

async function press(label: string) {
  const node = mounted!.root.find((candidate) => candidate.props.accessibilityLabel === label);
  await act(async () => node.props.onPress());
  await act(async () => { await Promise.resolve(); });
}
