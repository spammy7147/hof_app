import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => {
    const data = props.data as Array<{ id: string }>;
    const renderItem = props.renderItem as (info: { item: { id: string } }) => React.ReactNode;
    return React.createElement('FlatList', props, data.map((item) => React.createElement(React.Fragment, { key: item.id }, renderItem({ item }))));
  },
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
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
  if (request === 'expo-image') return { Image: host('Image') };
  return originalLoad(request, parent, isMain);
};
const { FishingPanel } = require('../../main/features/town/panels/FishingPanel') as typeof import('../../main/features/town/panels/FishingPanel');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null;
afterEach(async () => {
  if (mounted) await act(async () => mounted?.unmount());
  mounted = null;
});

describe('FishingPanel', () => {
  it('START에서 CATCH로 한 번씩만 수동 전환하고 보조 action은 자동 실행하지 않는다', async () => {
    const calls: string[] = [];
    const api = fakeApi({
      load: async () => fishing('START', ['START']),
      submit: async (path: string) => {
        calls.push(path);
        return fishing('CATCH', ['CATCH', 'STATUS', 'FILTER']);
      },
    });
    await render(React.createElement(FishingPanel, { api }));

    assert.equal(button('낚시를 시작한다').props.disabled, false);
    assert.deepEqual(calls, []);
    await press('낚시를 시작한다');

    assert.deepEqual(calls, ['/api/town/fishing/actions/START']);
    assert.ok(button('낚는다'));
    assert.ok(button('상태를 본다'));
    assert.ok(button('거른다'));
    assert.equal(calls.length, 1, 'polling이나 보조 action 자동 실행이 없어야 한다');
  });

  it('물고기 도망을 실패 화면이 아닌 다음 START 가능한 정상 상태로 표시한다', async () => {
    const escaped = { ...fishing('START', ['START']), lastOutcome: 'ESCAPED' as const };
    await render(React.createElement(FishingPanel, { api: fakeApi({ load: async () => escaped }) }));

    assert.ok(button('낚시를 시작한다'));
    assert.equal(allText().includes('물고기가 도망쳤습니다.'), true);
  });

  it('획득 물고기의 이름 수량 사용횟수 효과를 결과에 표시한다', async () => {
    const caught = {
      ...fishing('START', ['START']),
      catches: [{ name: 'Rank Fish', quantity: 2, remainingUses: 100, effect: 'HP+3000, HP Regen+2%' }],
    };
    await render(React.createElement(FishingPanel, { api: fakeApi({ load: async () => caught }) }));

    const text = allText();
    assert.equal(text.includes('Rank Fish × 2'), true);
    assert.equal(text.includes('남은 사용 횟수 100회'), true);
    assert.equal(text.includes('효과 HP+3000, HP Regen+2%'), true);
  });

  it('전투 중에는 낚시 버튼을 숨기고 전투 CTA만 연결한다', async () => {
    const opened: Array<{ categoryId: string; mapCode: string }> = [];
    const battle = { ...fishing('NONE', []), blockedByBattle: true, battleTarget: { categoryId: 'battle_map', mapCode: 'fishing_12' } };
    await render(React.createElement(FishingPanel, { api: fakeApi({ load: async () => battle }), onOpenBattle: (target) => { opened.push(target); } }));

    assert.equal(findButton('낚시를 시작한다'), null);
    assert.equal(findButton('낚는다'), null);
    await press('낚시 전투로 이동');
    assert.deepEqual(opened, [battle.battleTarget]);
  });

  it('교환소에서 radio 없는 행을 보이되 선택할 수 없게 한다', async () => {
    const api = fakeApi({
      load: async () => ({
        items: [
          { id: 'rank', label: 'Rank Fish', selectable: true, detail: null, imageUrl: null, price: null, quantity: null, materials: [] },
          { id: 'display', label: '교환 불가', selectable: false, detail: null, imageUrl: null, price: null, quantity: null, materials: [] },
        ],
        result: null,
      }),
    });
    await render(React.createElement(FishingPanel, { api, mode: 'exchange' }));

    const unavailable = button('교환 불가 선택 불가');
    assert.equal(unavailable.props.disabled, true);
    assert.equal(allText().includes('교환 불가'), true);
  });

  it('교환 수량과 비용을 확인한 뒤에만 정확한 수량을 제출한다', async () => {
    const calls: unknown[] = [];
    const response = {
      items: [{ id: 'rank', label: 'Rank Fish', selectable: true, detail: '재료', imageUrl: null, price: 100, quantity: 4, materials: ['Fish Token x2'] }],
      result: null,
    };
    await render(React.createElement(FishingPanel, { api: fakeApi({
      load: async () => response,
      submit: async (_path, request) => { calls.push(request); return response; },
    }), mode: 'exchange' }));

    await press('Rank Fish 선택');
    await act(async () => button('교환 수량').props.onChangeText('3'));
    await press('선택한 낚시 품목 교환');
    assert.deepEqual(calls, []);
    assert.equal(allText().includes('$300'), true);
    await act(async () => pressableWithText('교환').props.onPress());
    await act(async () => { await Promise.resolve(); });
    assert.deepEqual(calls, [{ candidateId: 'rank', quantity: 3 }]);
  });

  for (const invalid of ['', '0', '-1', '1.5', 'abc']) {
    it(`잘못된 교환 수량 ${JSON.stringify(invalid)}은 확인과 제출을 차단한다`, async () => {
      const calls: unknown[] = [];
      const response = { items: [{ id: 'rank', label: 'Rank Fish', selectable: true, detail: null, imageUrl: null, price: 100, quantity: 4, materials: [] }], result: null };
      await render(React.createElement(FishingPanel, { api: fakeApi({ load: async () => response, submit: async (_path, request) => { calls.push(request); return response; } }), mode: 'exchange' }));
      await press('Rank Fish 선택');
      await act(async () => button('교환 수량').props.onChangeText(invalid));

      assert.equal(button('선택한 낚시 품목 교환').props.disabled, true);
      assert.equal(allText().includes('수량은 1 이상의 10진 정수로 입력하세요.'), true);
      assert.equal(mounted!.root.find((node) => String(node.type) === 'Modal').props.visible, false);
      assert.deepEqual(calls, []);
    });
  }
});

function fishing(primaryAction: 'START' | 'CATCH' | 'NONE', availableActions: string[]) {
  return {
    notice: null, remainingCasts: 17, waterStatus: '수면이 빛난다.', baitCount: 0, shiningBaitCount: 0,
    escapeSeconds: primaryAction === 'CATCH' ? 30 : null, combo: null, locationName: '일반 낚시터', primaryAction,
    availableActions, lastOutcome: null, blockedByBattle: false, battleTarget: null, catches: [], result: null,
  };
}

function fakeApi(handlers: { load: (path: string) => Promise<unknown>; submit?: (path: string, request: unknown) => Promise<unknown> }) {
  return {
    load: handlers.load,
    submit: handlers.submit ?? (async () => { throw new Error('unexpected submit'); }),
  } as never;
}

async function render(element: React.ReactElement) {
  await act(async () => { mounted = create(element); });
  await act(async () => { await Promise.resolve(); });
  return mounted;
}
async function press(label: string) { await act(async () => button(label).props.onPress()); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance { return mounted!.root.find((node) => node.props.accessibilityLabel === label); }
function findButton(label: string): ReactTestInstance | null { return mounted!.root.findAll((node) => node.props.accessibilityLabel === label)[0] ?? null; }
function allText(): string { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
function pressableWithText(label: string): ReactTestInstance {
  return mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0).at(-1)!;
}
