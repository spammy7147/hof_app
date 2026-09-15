import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import type { StashResponse } from '../../main/types/api';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => React.createElement('FlatList', props, props.ListHeaderComponent as React.ReactNode, (props.data as Array<{ id: string }>).map((item) => React.createElement(React.Fragment, { key: item.id }, (props.renderItem as Function)({ item }))), props.ListFooterComponent as React.ReactNode),
  Modal: host('Modal'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), StyleSheet: { create: <T,>(styles: T) => styles }, Text: host('Text'), View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader }; const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => { if (request === 'react-native') return reactNativeMock; if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }; if (request === 'expo-image') return { Image: host('Image') }; return originalLoad(request, parent, isMain); };
const { RewardPanel } = require('../../main/features/town/panels/RewardPanel') as typeof import('../../main/features/town/panels/RewardPanel'); moduleWithLoader._load = originalLoad;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null; afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; });

describe('RewardPanel', () => {
  for (const finish of ['결과 확인', '마을 정보 새로고침']) {
    it(`상자 보상과 최신 보유량을 표시하고 ${finish}으로 닫아도 추가 개봉하지 않는다`, async () => {
      let loads = 0;
      const calls: unknown[] = [];
      const before: StashResponse = {
        boxes: [{ id: 'fish', label: 'Plumpy Fish (Stash)', selectable: true, owned: 53, cost: 10, detail: 'h:1 / Bind' }],
        actions: [{ action: 'ONE', label: '1개 열기' }], result: null,
      };
      const after: StashResponse = {
        ...before,
        boxes: [{ ...before.boxes[0], owned: 52 }],
        result: {
          status: 'SUCCESS', messages: [], refreshRequired: true,
          items: [{ name: 'Weapon Box (Dagger&MainGauche) (Stash)', quantity: 1, detail: '단검 종류의 장비가 들어 있습니다.', imageUrl: null }],
        },
      };
      await render(React.createElement(RewardPanel, {
        api: api(async () => { loads += 1; return loads === 1 ? before : { ...after, result: null }; },
          async (_path, request) => { calls.push(request); return after; }), mode: 'stash',
      }));
      await press('Plumpy Fish (Stash) 선택');
      await press('1개 열기');

      assert.equal(text().includes('Weapon Box (Dagger&MainGauche) (Stash) ×1'), true);
      assert.equal(text().includes('보유 52'), true);
      assert.equal(text().includes('결과 확인 필요'), false);
      assert.equal(button('작업 완료 알림').props.accessibilityRole, 'alert');
      await press(finish);
      assert.equal(mounted!.root.findAll((node) => String(node.type) === 'Modal' && node.props.visible).length, 0);
      assert.equal(loads, finish === '마을 정보 새로고침' ? 2 : 1);
      assert.deepEqual(calls, [{ boxCandidateId: 'fish', action: 'ONE' }]);
    });
  }

  it('마지막 상자 개봉 뒤 사라진 후보의 선택을 해제한다', async () => {
    const data = stashData();
    await render(React.createElement(RewardPanel, {
      api: api(async () => data, async () => ({ ...data, boxes: [], result: result() })), mode: 'stash',
    }));
    await press('Treasure Box 선택');
    await press('1개 열기');
    assert.equal(button('1개 열기').props.disabled, true);
    assert.equal(text().includes('Treasure Box'), false);
  });

  it('상자 1개와 서버가 제공한 고정 action을 한 번 눌러 제출한다', async () => {
    const calls: unknown[] = [];
    const data = { boxes: [{ id: 'box', label: 'Treasure Box', selectable: true, owned: 76, cost: 0, detail: 'Treasure Box x76' }, { id: 'display', label: '선택 불가', selectable: false, owned: null, cost: 0, detail: null }], actions: [{ action: 'ONE', label: '1개 열기' }, { action: 'THOUSAND', label: '1000개 열기' }], result: null } as const;
    await render(React.createElement(RewardPanel, { api: api(async () => data, async (_path, request) => { calls.push(request); return { ...data, result: result() }; }), mode: 'stash' }));

    assert.equal(button('선택 불가 선택 불가').props.disabled, true);
    const actionBar = button('상자 열기 작업');
    assert.equal(actionBar.parent?.type, 'View');
    assert.equal(actionBar.find((node) => node.props.accessibilityLabel === '1000개 열기').props.disabled, true);
    await press('Treasure Box 선택');
    assert.equal(button('1000개 열기').props.disabled, false);
    await press('1000개 열기');
    assert.deepEqual(calls, [{ boxCandidateId: 'box', action: 'THOUSAND' }]);
  });

  it('오브가 부족해 보여도 버튼을 비활성화하지 않고 색상별 1000개 비용을 확인한다', async () => {
    const calls: unknown[] = [];
    const data = orbData({ red: 10, blue: 20, green: 30 }, false);
    await render(React.createElement(RewardPanel, { api: api(async () => data, async (_path, request) => { calls.push(request); return { ...data, displayedOrbs: { red: 0, blue: 0, green: 0 }, orbCountsEstimated: true, outcomes: [{ text: 'Funds Bag($ 1,000)', quantity: 1, success: true, inferred: true }], result: result() }; }), mode: 'orbs' }));

    assert.equal(button('오브를 기부한다').props.disabled, false);
    await press('오브를 기부한다');
    assert.equal(text().includes('색상별 1,000개'), true);
    assert.deepEqual(calls, [{ action: 'ONE' }]);
    assert.equal(text().includes('계산값입니다'), true);
    assert.equal(text().includes('수량 변화로 추론'), true);
  });

  it('계산 오브는 사용자 새로고침의 다음 GET 실제값으로 교체한다', async () => {
    let loads = 0;
    const actual = orbData({ red: 9_000, blue: 8_000, green: 7_000 }, false);
    const calculated = { ...actual, displayedOrbs: { red: 8_000, blue: 7_000, green: 6_000 }, orbCountsEstimated: true, result: result() };
    await render(React.createElement(RewardPanel, { api: api(async () => { loads += 1; return actual; }, async () => calculated), mode: 'orbs' }));
    await press('오브를 기부한다');
    assert.equal(text().includes('계산값입니다'), true);
    await press('마을 정보 새로고침');
    assert.equal(loads, 2);
    assert.equal(text().includes('계산값입니다'), false);
    assert.equal(text().includes('9,000개'), true);
  });

  it('빠른 중복 클릭은 POST를 한 번만 보낸다', async () => {
    const pending = deferred<unknown>();
    let calls = 0;
    const data = stashData();
    await render(React.createElement(RewardPanel, {
      api: api(async () => data, async () => { calls += 1; return pending.promise; }),
      mode: 'stash',
    }));
    await press('Treasure Box 선택');
    const action = button('1개 열기');
    await act(async () => { action.props.onPress(); action.props.onPress(); await Promise.resolve(); });

    assert.equal(calls, 1);
    await act(async () => { pending.resolve({ ...data, result: result() }); await pending.promise; });
    await act(async () => { await Promise.resolve(); });
  });

  it('오브 보상은 선택·보유 항목이 아닌 남은 수량 정보로만 표시한다', async () => {
    await render(React.createElement(RewardPanel, { api: api(async () => orbData({ red: 1, blue: 1, green: 1 }, false)), mode: 'orbs' }));

    assert.equal(button('Event Box').props.accessibilityRole, 'text');
    assert.equal(text().includes('선택 불가'), false);
    assert.equal(text().includes('보유 2'), false);
    assert.equal(text().includes('현재 남은 수량: 2개'), true);
    assert.equal(text().includes('현재 남은 수량: 무제한'), true);
  });

  it('오브 상품명의 대시 장식을 제거하고 교환 버튼을 목록 밖 하단 한 줄에 표시한다', async () => {
    const data = {
      ...orbData({ red: 1, blue: 1, green: 1 }, false),
      rewards: [{ key: 'funds', label: '──────── Funds Bag($ 1,000) ───', remaining: null, unlimited: true }],
    };
    await render(React.createElement(RewardPanel, { api: api(async () => data), mode: 'orbs' }));

    assert.equal(text().includes('────────'), false);
    assert.equal(text().includes('Funds Bag($ 1,000)'), true);
    assert.equal(text().includes('보유 오브가 부족해 보여도'), false);
    const actionBar = button('오브 교환 작업');
    assert.equal(actionBar.parent?.type, 'View');
    assert.equal(actionBar.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '오브를 기부한다').length, 1);
    assert.equal(actionBar.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '오브를 5회 기부한다').length, 1);
  });
});

function orbData(counts: { red: number; blue: number; green: number }, estimated: boolean) { return { displayedOrbs: counts, orbCountsEstimated: estimated, remainingRewards: 2, rewardMonth: '2026년 7월', rewards: [{ key: 'event', label: 'Event Box', remaining: 2, unlimited: false }, { key: 'funds', label: 'Funds Bag($ 1,000)', remaining: null, unlimited: true }], actions: [{ action: 'ONE', label: '오브를 기부한다', repetitions: 1 }, { action: 'FIVE', label: '오브를 5회 기부한다', repetitions: 5 }], outcomes: [], lastAction: null, result: null } as const; }
function stashData() { return { boxes: [{ id: 'box', label: 'Treasure Box', selectable: true, owned: 76, cost: 0, detail: null }], actions: [{ action: 'ONE' as const, label: '1개 열기' }], result: null }; }
function result() { return { status: 'SUCCESS' as const, messages: ['완료'], items: [], refreshRequired: true }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(node: React.ReactElement) { await act(async () => { mounted = create(node); }); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance { return mounted!.root.find((node) => node.props.accessibilityLabel === label); }
async function press(label: string) { await act(async () => button(label).props.onPress()); await act(async () => { await Promise.resolve(); }); }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }
