import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => React.createElement('FlatList', props, props.ListHeaderComponent as React.ReactNode, (props.data as Array<{ id: string }>).map((item) => React.createElement(React.Fragment, { key: item.id }, (props.renderItem as Function)({ item }))), props.ListFooterComponent as React.ReactNode),
  Modal: host('Modal'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), StyleSheet: { absoluteFill: {}, create: <T,>(styles: T) => styles }, Text: host('Text'), View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader }; const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => { if (request === 'react-native') return reactNativeMock; if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }; if (request === 'expo-image') return { Image: host('Image') }; return originalLoad(request, parent, isMain); };
const { PantheonPanel } = require('../../main/features/town/panels/PantheonPanel') as typeof import('../../main/features/town/panels/PantheonPanel');
const { BackendApiError } = require('../../main/services/backendApi') as typeof import('../../main/services/backendApi'); moduleWithLoader._load = originalLoad;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null; afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; });

describe('PantheonPanel', () => {
  it('각 신을 카드로 표시하고 관측된 동작을 카드 아래에 바로 표시한다', async () => {
    await render(React.createElement(PantheonPanel, { api: api() }));
    assert.equal(text().includes('군신 마르두크'), true);
    assert.ok(button('군신 마르두크 비율 기부 · 보유 Funds의 1%').length >= 1);
    await press('군신 마르두크 아이템 기부 · Avatar Ticket ×1');
    assert.equal(text().includes('기부 아이템 Avatar Ticket ×1'), true);
    await pressLast('취소');
    assert.equal(button('알 수 없는 기부').length, 0);
  });

  it('서로 다른 신전의 action과 비용을 해당 카드에만 표시한다', async () => {
    const distinct = {
      shrines: [
        street().shrines[0],
        { id: 'shrine-2', name: '재주꾼 카즘', alias: 'Kazm', color: null, imageUrl: null, actions: [{ id: 'buy-id', type: 'BUY_PRIEST_ITEM' as const, label: '사제 아이템을 구입한다', costFunds: 12_000, fundsPercent: null, itemName: null, itemQuantity: null }] },
      ],
    };
    await render(React.createElement(PantheonPanel, { api: api(async () => distinct) }));

    assert.ok(button('군신 마르두크 정액 기부 · 50,000 Funds').length >= 1);
    assert.ok(button('재주꾼 카즘 사제 아이템 구입 · 12,000 Funds').length >= 1);
    assert.equal(button('재주꾼 카즘 정액 기부 · 50,000 Funds').length, 0);
  });

  it('카드에서 비용과 비율을 확인한 후 opaque action id만 한 번 제출한다', async () => {
    const calls: unknown[] = [];
    await render(React.createElement(PantheonPanel, { api: api(undefined, async (path, request) => { calls.push([path, request]); return { ...detail(), result: result() }; }) }));
    await press('군신 마르두크 비율 기부 · 보유 Funds의 1%');
    assert.equal(text().includes('보유 Funds의 1%'), true);
    await pressLast('비율 기부');
    assert.deepEqual(calls, [['/api/town/pantheon/shrine-1/actions', { actionId: 'percent-id' }]]);
    assert.equal(text().includes('기부 완료'), true);
  });

  it('빠른 중복 확인은 POST를 한 번만 보낸다', async () => {
    const pending = deferred<unknown>(); let calls = 0;
    await render(React.createElement(PantheonPanel, { api: api(undefined, async () => { calls += 1; return pending.promise; }) }));
    await press('군신 마르두크 정액 기부 · 50,000 Funds');
    const confirm = pressableWithText('정액 기부');
    await act(async () => { confirm.props.onPress(); confirm.props.onPress(); await Promise.resolve(); });
    assert.equal(calls, 1);
    pending.resolve({ ...detail(), result: result() });
    await act(async () => { await pending.promise; });
  });

  it('계정 API 변경 뒤 이전 카드의 확인창을 폐기한다', async () => {
    const newPaths: string[] = [];
    const oldApi = api(async () => street('이전 신전'));
    const newApi = api(async (path) => { newPaths.push(path); return path === '/api/town/pantheon' ? street('새 신전') : detail('새 신전'); });
    await render(React.createElement(PantheonPanel, { api: oldApi }));
    await press('이전 신전 정액 기부 · 50,000 Funds');
    assert.equal(text().includes('이전 신전 · 정액 기부'), true);
    await act(async () => mounted!.update(React.createElement(PantheonPanel, { api: newApi })));
    await act(async () => { await Promise.resolve(); });
    assert.equal(text().includes('새 신전'), true);
    assert.deepEqual(newPaths, ['/api/town/pantheon']);
    assert.equal(text().includes('이전 신전'), false);
  });

  it('CAPTCHA 뒤 같은 opaque action을 한 번만 재시도하고 일반 오류는 상세에 표시한다', async () => {
    const requests: unknown[] = []; let resolves = 0;
    const captchaApi = api(undefined, async (_path, request) => {
      requests.push(request);
      if (requests.length === 1) throw new BackendApiError(409, 'CAPTCHA_REQUIRED', '인증 필요');
      return { ...detail(), result: { ...result(), messages: ['<html>HOF 원문</html>'] } };
    });
    await render(React.createElement(PantheonPanel, { api: captchaApi, resolveCaptcha: async () => { resolves += 1; } }));
    await press('군신 마르두크 정액 기부 · 50,000 Funds');
    await pressLast('정액 기부');
    assert.equal(resolves, 1);
    assert.deepEqual(requests, [{ actionId: 'fixed-id' }, { actionId: 'fixed-id' }]);
    assert.equal(text().includes('<html>'), false);
    assert.equal(text().includes('HOF 원문'), false);

    const failingApi = api(undefined, async () => { throw new Error('신전 요청 실패'); });
    await act(async () => mounted!.update(React.createElement(PantheonPanel, { api: failingApi })));
    await act(async () => { await Promise.resolve(); });
    await press('군신 마르두크 정액 기부 · 50,000 Funds');
    await pressLast('정액 기부');
    assert.equal(text().includes('신전 요청 실패'), true);
  });
});

function street(name = '군신 마르두크') { return { shrines: [{ id: 'shrine-1', name, alias: 'Marduk', color: '#aaa', imageUrl: null, actions: detail().actions }] }; }
function detail(name = '마르두크의 전당') { return { shrineId: 'shrine-1', name, alias: 'Hall of Marduk', description: '전쟁의 신전', imageUrl: null, deity: '군신 마르두크', alignment: 'Neutral', domains: ['전쟁', '무예'], relation: '공민', currentJob: null, actions: [{ id: 'fixed-id', type: 'DONATE_FIXED' as const, label: '교단에 기부한다', costFunds: 50_000, fundsPercent: null, itemName: null, itemQuantity: null }, { id: 'percent-id', type: 'DONATE_PERCENT' as const, label: '교단에 기부한다', costFunds: null, fundsPercent: 1, itemName: null, itemQuantity: null }, { id: 'item-id', type: 'DONATE_ITEM' as const, label: 'Avatar Ticket x1을 기부한다', costFunds: null, fundsPercent: null, itemName: 'Avatar Ticket', itemQuantity: 1 }], result: null }; }
function result() { return { status: 'SUCCESS' as const, messages: ['기부 완료'], items: [], refreshRequired: true }; }
function api(load: (path: string) => Promise<unknown> = async (path) => path === '/api/town/pantheon' ? street() : detail(), submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(node: React.ReactElement) { await act(async () => { mounted = create(node); }); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance[] { return mounted!.root.findAll((node) => node.props.accessibilityLabel === label); }
async function press(label: string) { const node = button(label).at(-1); assert.ok(node, `missing ${label}`); await act(async () => node.props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function pressLast(label: string) { const node = pressableWithText(label); await act(async () => node.props.onPress()); await act(async () => { await Promise.resolve(); }); }
function pressableWithText(label: string): ReactTestInstance { return mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0).at(-1)!; }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }
