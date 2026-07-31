import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => React.createElement('FlatList', props, (props.data as Array<{ id: string }>).map((item) => React.createElement(React.Fragment, { key: item.id }, (props.renderItem as Function)({ item })))),
  Modal: host('Modal'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), StyleSheet: { create: <T,>(styles: T) => styles }, Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
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
const { ShopPanel } = require('../../main/features/town/panels/ShopPanel') as typeof import('../../main/features/town/panels/ShopPanel');
moduleWithLoader._load = originalLoad;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null;
afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; });

describe('ShopPanel', () => {
  for (const mode of ['general', 'sundries', 'dark'] as const) {
    it(`${mode} 독립 endpoint를 공용 장바구니 panel로 연다`, async () => {
      const paths: string[] = [];
      await render(React.createElement(ShopPanel, { api: api(async (path) => { paths.push(path); return shop(mode); }), mode }));
      assert.deepEqual(paths, [`/api/town/shops/${mode}`]);
      assert.ok(button('Potion 선택'));
    });
  }

  it('다중 상품 수량과 예상 비용을 확인한 뒤 한 번만 구매한다', async () => {
    const submissions: unknown[] = [];
    await render(React.createElement(ShopPanel, { api: api(async () => shop('general'), async (_path, request) => { submissions.push(request); return { ...shop('general'), result: result('SUCCESS') }; }), mode: 'general' }));
    await press('Potion 선택'); await press('Bread 선택');
    await change('Potion 구매 수량', '2');
    assert.equal(text().includes('예상 총액 $400'), true);
    await press('장바구니 구매'); assert.deepEqual(submissions, []);
    await pressLast('구매');
    assert.deepEqual(submissions, [{ items: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }] }]);
    assert.equal(button('장바구니 구매').props.disabled, true, '성공 시 장바구니를 비운다');
  });

  it('$0 판매는 막지 않고 확인창에서 경고한다', async () => {
    const submissions: unknown[] = [];
    const sell = { items: [{ id: 'free', label: 'Funds Bag', selectable: true, detail: null, imageUrl: null, price: 0, quantity: 5, type: 'other' }], result: null };
    await render(React.createElement(ShopPanel, { api: api(async () => sell, async (_path, request) => { submissions.push(request); return { ...sell, result: result('SUCCESS') }; }), mode: 'sell' }));
    await press('Funds Bag 선택');
    assert.equal(text().includes('$0 판매 품목 1개'), true);
    await press('선택 품목 판매'); await pressLast('판매');
    assert.deepEqual(submissions, [{ items: [{ candidateId: 'free', quantity: 1 }] }]);
  });

  it('주재료 한 개와 부재료 세 슬롯을 선택해야 Combine을 제출한다', async () => {
    const submissions: unknown[] = [];
    const combine = { primary: [{ id: 'm', label: 'Milk', quantity: 3 }], secondarySlots: [[{ id: 'a', label: 'A', quantity: 1 }], [{ id: 'b', label: 'B', quantity: 1 }], [{ id: 'c', label: 'C', quantity: 1 }]], result: null };
    await render(React.createElement(ShopPanel, { api: api(async () => combine, async (_path, request) => { submissions.push(request); return { ...combine, result: result('SUCCESS') }; }), mode: 'combine' }));
    assert.equal(button('조합').props.disabled, true);
    for (const label of ['Milk 선택', 'A 선택', 'B 선택', 'C 선택']) await press(label);
    await change('조합 수량', '2'); await press('조합'); await pressLast('Combine');
    assert.deepEqual(submissions, [{ primaryCandidateId: 'm', secondaryCandidateIds: ['a', 'b', 'c'], quantity: 2 }]);
  });
});

function shop(shopId: 'general' | 'sundries' | 'dark') { return { shopId, stale: false, lastVerifiedAt: null, result: null, items: [row('a', 'Potion', 100), row('b', 'Bread', 200)] }; }
function row(id: string, label: string, price: number) { return { id, label, selectable: true, detail: null, imageUrl: null, price, quantity: null, type: 'item' }; }
function result(status: 'SUCCESS' | 'FAILURE') { return { status, messages: [status], items: [], refreshRequired: true }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(node: React.ReactElement) { await act(async () => { mounted = create(node); }); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance { return mounted!.root.find((node) => node.props.accessibilityLabel === label); }
async function press(label: string) { await act(async () => button(label).props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function pressLast(label: string) { const nodes = mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0); await act(async () => nodes.at(-1)!.props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function change(label: string, value: string) { await act(async () => button(label).props.onChangeText(value)); }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
