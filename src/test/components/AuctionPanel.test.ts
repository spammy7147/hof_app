import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => React.createElement('FlatList', props, props.ListHeaderComponent as React.ReactNode, (props.data as Array<{ id: string }>).map((item) => React.createElement(React.Fragment, { key: item.id }, (props.renderItem as Function)({ item }))), props.ListFooterComponent as React.ReactNode),
  Modal: host('Modal'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} }, Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader }; const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
  if (request === 'expo-image') return { Image: host('Image') };
  return originalLoad(request, parent, isMain);
};
const { AuctionPanel } = require('../../main/features/town/panels/AuctionPanel') as typeof import('../../main/features/town/panels/AuctionPanel');
moduleWithLoader._load = originalLoad;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null;
afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; });

describe('AuctionPanel', () => {
  it('옥션과 낙찰 시세가 독립 endpoint를 사용한다', async () => {
    const paths: string[] = [];
    await render(React.createElement(AuctionPanel, { api: api(async (path) => { paths.push(path); return auction(); }), mode: 'auction' }));
    assert.deepEqual(paths, ['/api/town/auction']);
    await act(async () => mounted?.unmount()); mounted = null;
    await render(React.createElement(AuctionPanel, { api: api(async (path) => { paths.push(path); return market(); }), mode: 'market' }));
    assert.deepEqual(paths, ['/api/town/auction', '/api/town/auction-market']);
    assert.equal(text().includes('판매자·입찰자 정보 없이'), true);
  });

  it('입찰 대상·수량·총액·단가 확인 뒤 typed action만 제출한다', async () => {
    const submissions: Array<{ path: string; request: unknown }> = [];
    await render(React.createElement(AuctionPanel, { api: api(async () => auction(), async (path, request) => { submissions.push({ path, request }); return { ...auction(), result: result() }; }), mode: 'auction' }));
    await press('Potion 선택'); await press('입찰');
    for (const expected of ['Potion', '2개', '$2,000', '$1,000']) assert.equal(text().includes(expected), true);
    await pressLast('입찰');
    assert.deepEqual(submissions, [{ path: '/api/town/auction/bid', request: { actionId: 'action-a', candidateId: 'candidate-a', quantity: 2 } }]);
  });

  it('검색은 URL encoding하고 시세 가격 차트와 통계를 표시한다', async () => {
    const paths: string[] = [];
    await render(React.createElement(AuctionPanel, { api: api(async (path) => { paths.push(path); return path.includes('auction-market') ? market() : auction(); }), mode: 'market' }));
    await change('낙찰 시세 검색어', 'Magic Sword'); await press('낙찰 시세 검색');
    assert.equal(paths.at(-1), '/api/town/auction-market?query=Magic%20Sword');
    assert.ok(button('Potion 가격 차트'));
    assert.equal(text().includes('평균 $900'), true);
  });
});

function auction() { return { actions: ['BID'], result: null, listings: [{ candidateId: 'candidate-a', actionId: 'action-a', listingId: '10', name: 'Potion', type: 'item', quantity: 2, totalPrice: 2000, unitPrice: 1000, action: 'BID', kind: 'CURRENT' }] }; }
function market() { return { generatedAt: '2026-07-31T00:00:00Z', items: [{ itemKey: 'potion', name: 'Potion', type: 'item', latestUnitPrice: 1000, averageUnitPrice: 900, minimumUnitPrice: 800, maximumUnitPrice: 1000, tradeCount: 2, volume: 3, points: [{ totalPrice: 1600, unitPrice: 800, quantity: 2, observedAt: '2026-07-30T23:00:00Z', kind: 'SOLD' }, { totalPrice: 1000, unitPrice: 1000, quantity: 1, observedAt: '2026-07-31T00:00:00Z', kind: 'SOLD' }] }] }; }
function result() { return { status: 'SUCCESS', messages: ['입찰 완료'], items: [], refreshRequired: true }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(node: React.ReactElement) { await act(async () => { mounted = create(node); }); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance { return mounted!.root.find((node) => node.props.accessibilityLabel === label); }
async function press(label: string) { await act(async () => button(label).props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function pressLast(label: string) { const nodes = mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0); await act(async () => nodes.at(-1)!.props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function change(label: string, value: string) { await act(async () => button(label).props.onChangeText(value)); }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
