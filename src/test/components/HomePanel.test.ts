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
    assert.match(text(), /진행도 1\/1/);
    await press('손님 맞이 완료 가능');
    await press('완료');
    await pressLast('완료');
    assert.deepEqual(calls, [{ path: '/api/town/home/quests', body: { actionId: 'claim' } }]);
  });

  it('휴식 action 카드를 만들지 않고 휴식을 취한다 버튼 하나로 확인을 연다', async () => {
    const rest = {
      mode: 'REST',
      quests: [],
      actions: [{ id: 'restore', type: 'RESTORE', label: '휴식실에서 회복한다' }],
      restStatus: { currentTime: 5700, maxTime: 6000, baseRecovery: 3000, facilityRecovery: 200, usedToday: false, facilities: ['안락한 침대'] },
      result: null,
    };
    const calls: unknown[] = [];
    await render(React.createElement(HomePanel, {
      api: { load: async () => rest, submit: async (path: string, body: unknown) => { calls.push({ path, body }); return rest; } } as never,
      mode: 'rest',
    }));

    assert.match(text(), /Time 5,700 \/ 6,000/);
    assert.match(text(), /현재 예상 회복 300 Time · 초과 2,900 Time/);
    assert.doesNotMatch(text(), /수동 복구 action/);
    assert.doesNotMatch(text(), /자동 반복 없이/);
    await press('보유 시설 펼치기');
    assert.match(text(), /안락한 침대/);
    await press('휴식을 취한다');
    assert.equal(calls.length, 0);
    const sheet = mounted!.root.findByProps({ testID: 'town-confirm-sheet' });
    const sheetText = sheet.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' ');
    assert.match(sheetText, /예상 회복 300 Time/);
    assert.match(sheetText, /최대치 초과분 2,900 Time/);
    await pressLast('휴식을 취한다');
    assert.deepEqual(calls, [{ path: '/api/town/rest/restore', body: { actionId: 'restore' } }]);
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

async function pressLast(label: string) {
  const nodes = mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0);
  await act(async () => nodes.at(-1)!.props.onPress());
  await act(async () => { await Promise.resolve(); });
}
