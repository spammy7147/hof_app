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

  it('입찰 번호와 사용자가 입력한 입찰가만 typed endpoint로 제출한다', async () => {
    const submissions: Array<{ path: string; request: unknown }> = [];
    await render(React.createElement(AuctionPanel, { api: api(async () => auction(), async (path, request) => { submissions.push({ path, request }); return { ...auction(), result: result() }; }), mode: 'auction' }));
    await press('Potion 선택'); await change('입찰가', '2500'); await press('입찰 확인');
    for (const expected of ['Potion', '$2,500']) assert.equal(text().includes(expected), true);
    await pressLast('입찰');
    assert.deepEqual(submissions, [{ path: '/api/town/auction/bid', request: { actionId: 'action-a', listingId: '10', bidPrice: 2500 } }]);
  });

  it('출품 준비와 출품, 아이템과 Funds 수령을 서로 다른 계약으로 보낸다', async () => {
    const submissions: Array<{ path: string; request: unknown }> = [];
    const exhibit = { entryActionId: 'exhibit-entry', actionId: 'put-a', durations: [{ value: '24', label: '24시간' }], result: null, items: [{ ...auction().listings[0], rowKey: 'item:item-7', action: 'EXHIBIT', listingId: null, actionId: 'put-a', candidateId: 'item-7', name: 'Elixir' }] };
    await render(React.createElement(AuctionPanel, { api: api(async () => auction(), async (path, request) => { submissions.push({ path, request }); return path.includes('/exhibit') ? { ...exhibit, result: result() } : { ...auction(), result: result() }; }), mode: 'auction' }));
    await press('출품 준비'); await press('Elixir 선택'); await change('출품 수량', '2'); await change('개시가', '9000'); await press('출품 확인'); await pressLast('출품');
    assert.deepEqual(submissions.slice(0, 2), [
      { path: '/api/town/auction/exhibit/open', request: { actionId: 'exhibit-entry' } },
      { path: '/api/town/auction/exhibit', request: { entryActionId: 'exhibit-entry', actionId: 'put-a', candidateId: 'item-7', amount: 2, exhibitTime: '24', startPrice: 9000, comment: '' } },
    ]);
  });

  it('아이템 수령과 Funds 수령은 서로 다른 typed endpoint를 사용한다', async () => {
    const submissions: Array<{ path: string; request: unknown }> = [];
    await render(React.createElement(AuctionPanel, { api: api(async () => auction(), async (path, request) => { submissions.push({ path, request }); return { ...auction(), result: result() }; }), mode: 'auction' }));
    await press('낙찰 아이템 수령'); await pressLast('아이템 수령');
    await press('Funds 수령'); await pressLast('Funds 수령');
    assert.deepEqual(submissions, [
      { path: '/api/town/auction/claim-item', request: { actionId: 'claim-item' } },
      { path: '/api/town/auction/claim-funds', request: { actionId: 'claim-funds' } },
    ]);
  });

  it('잘못된 입찰가는 제출을 막고 실패해도 선택과 입력을 보존한다', async () => {
    let calls = 0;
    await render(React.createElement(AuctionPanel, { api: api(async () => auction(), async () => { calls += 1; throw new Error('입찰 실패'); }), mode: 'auction' }));
    await press('Potion 선택'); await change('입찰가', '-1');
    assert.equal(button('입찰 확인').props.accessibilityState.disabled, true);
    await change('입찰가', '2500'); await press('입찰 확인'); await pressLast('입찰');
    assert.equal(calls, 1); assert.equal(text().includes('입찰 실패'), true); assert.equal(button('입찰가').props.value, '2500');
    assert.equal(button('Potion 선택').props.accessibilityState.checked, true);
  });

  it('확인을 연속으로 눌러도 POST는 한 번만 보내고 HTML 원문은 표시하지 않는다', async () => {
    let calls = 0; let release!: () => void;
    const pending = new Promise<unknown>((resolve) => { release = () => resolve({ ...auction(), result: { ...result(), messages: ['<html><body>raw</body></html>'] } }); });
    await render(React.createElement(AuctionPanel, { api: api(async () => auction(), async () => { calls += 1; return pending; }), mode: 'auction' }));
    await press('Potion 선택'); await change('입찰가', '2500'); await press('입찰 확인');
    const confirmButton = mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '입찰').length > 0).at(-1)!;
    await act(async () => { confirmButton.props.onPress(); confirmButton.props.onPress(); });
    assert.equal(calls, 1);
    await act(async () => release()); await act(async () => { await Promise.resolve(); });
    assert.equal(text().includes('<html>'), false);
  });

  it('검색은 URL encoding하고 시세 가격 차트와 통계를 표시한다', async () => {
    const paths: string[] = [];
    await render(React.createElement(AuctionPanel, { api: api(async (path) => { paths.push(path); return path.includes('auction-market') ? market() : auction(); }), mode: 'market' }));
    await change('낙찰 시세 검색어', 'Magic Sword'); await press('낙찰 시세 검색');
    assert.equal(paths.at(-1), '/api/town/auction-market?query=Magic%20Sword');
    await press('Potion 시세 이력 열기. 최근 총액 $1,000 · 최근 단가 $1,000 · 평균 $900 · 최저 $800 · 최고 $1,000 · 총 거래량 3개 · 2건');
    assert.ok(mounted!.root.find((node) => String(node.props.accessibilityLabel ?? '').startsWith('Potion 가격 차트')));
    assert.equal(text().includes('평균 $900'), true);
    assert.equal(text().includes('보유 3'), false);
  });

  it('출품은 서버 기간만 선택하고 수량, 개시가, 설명의 경계를 검증한다', async () => {
    const exhibit = { entryActionId: 'exhibit-entry', actionId: 'put-a', durations: [{ value: '24', label: '24시간' }, { value: '72', label: '3일' }], result: null, items: [{ ...auction().listings[0], rowKey: 'item:item-7', action: 'EXHIBIT', listingId: null, actionId: 'put-a', candidateId: 'item-7', name: 'Elixir' }] };
    await render(React.createElement(AuctionPanel, { api: api(async () => auction(), async () => exhibit), mode: 'auction' }));
    await press('출품 준비'); await press('Elixir 선택');
    assert.equal(button('출품 기간 24시간').props.accessibilityState.checked, true);
    assert.equal(button('옥션 검색').props.accessibilityState.disabled, true);
    await change('개시가', '0'); await change('출품 수량', '100001');
    assert.equal(button('출품 확인').props.accessibilityState.disabled, true);
    await change('개시가', '1'); await change('출품 수량', '100000'); await change('출품 설명', 'x'.repeat(301));
    assert.equal(button('출품 확인').props.accessibilityState.disabled, true);
    await change('출품 설명', '설명'); await press('출품 기간 3일');
    assert.equal(button('출품 확인').props.accessibilityState.disabled, false);
  });

  it('긴 시세 목록의 마지막 품목도 선택해 이력을 열 수 있다', async () => {
    const many = market();
    many.items = Array.from({ length: 12 }, (_, index) => ({ ...many.items[0], itemKey: `item-${index}`, name: `Item ${index}` }));
    await render(React.createElement(AuctionPanel, { api: api(async () => many), mode: 'market' }));
    const label = 'Item 11 시세 이력 열기. 최근 총액 $1,000 · 최근 단가 $1,000 · 평균 $900 · 최저 $800 · 최고 $1,000 · 총 거래량 3개 · 2건';
    await press(label);
    assert.ok(mounted!.root.find((node) => String(node.props.accessibilityLabel ?? '').startsWith('Item 11 가격 차트')));
    const list = mounted!.root.find((node) => String(node.type) === 'FlatList');
    assert.equal(list.props.initialNumToRender, 12);
  });
});

function auction() { return { actions: ['BID', 'EXHIBIT', 'CLAIM'], capabilities: { bidActionId: 'action-a', exhibitEntryActionId: 'exhibit-entry', claimItemActionId: 'claim-item', claimFundsActionId: 'claim-funds' }, result: null, listings: [{ rowKey: 'lot:10', candidateId: null, actionId: 'action-a', listingId: '10', name: 'Potion', type: 'item', quantity: 2, totalPrice: 2000, unitPrice: 1000, action: 'BID', kind: 'CURRENT' }] }; }
function market() { return { generatedAt: '2026-07-31T00:00:00Z', items: [{ itemKey: 'potion', name: 'Potion', type: 'item', latestUnitPrice: 1000, averageUnitPrice: 900, minimumUnitPrice: 800, maximumUnitPrice: 1000, tradeCount: 2, volume: 3, points: [{ totalPrice: 1600, unitPrice: 800, quantity: 2, observedAt: '2026-07-30T23:00:00Z', kind: 'SOLD' }, { totalPrice: 1000, unitPrice: 1000, quantity: 1, observedAt: '2026-07-31T00:00:00Z', kind: 'SOLD' }] }] }; }
function result() { return { status: 'SUCCESS', messages: ['입찰 완료'], items: [], refreshRequired: true }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(node: React.ReactElement) { await act(async () => { mounted = create(node); }); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance { return mounted!.root.find((node) => node.props.accessibilityLabel === label); }
async function press(label: string) { await act(async () => button(label).props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function pressLast(label: string) { const nodes = mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0); await act(async () => nodes.at(-1)!.props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function change(label: string, value: string) { await act(async () => button(label).props.onChangeText(value)); }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
