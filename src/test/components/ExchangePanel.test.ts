import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => React.createElement('FlatList', props, props.ListHeaderComponent as React.ReactNode, (props.data as Array<{ id: string }>).map((item) => React.createElement(React.Fragment, { key: item.id }, (props.renderItem as Function)({ item }))), props.ListFooterComponent as React.ReactNode),
  Modal: host('Modal'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), StyleSheet: { create: <T,>(styles: T) => styles }, Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader }; const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => { if (request === 'react-native') return reactNativeMock; if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }; if (request === 'expo-image') return { Image: host('Image') }; return originalLoad(request, parent, isMain); };
const { ExchangePanel } = require('../../main/features/town/panels/ExchangePanel') as typeof import('../../main/features/town/panels/ExchangePanel'); moduleWithLoader._load = originalLoad;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null; afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; });

describe('ExchangePanel', () => {
  it('radio 없는 교환 행은 표시하지만 선택할 수 없다', async () => {
    await render(React.createElement(ExchangePanel, { api: api(async () => data('EMBLEM')), mode: 'emblem' }));
    assert.equal(button('재료 부족 선택 불가').props.disabled, true);
    assert.equal(mounted!.root.findAll((node) => String(node.type) === 'FlatList').length, 1);
  });

  it('동적 category를 URL encoding하고 전환 중 교환을 막는다', async () => {
    const paths: string[] = [];
    const pending = deferred<unknown>();
    const value = data('EVENT', { categories: [{ id: 'all', label: '전부', current: true }, { id: 'type:event & rare', label: '이벤트', current: false }] });
    await render(React.createElement(ExchangePanel, { api: api(async (path) => { paths.push(path); return path.includes('?') ? pending.promise : value; }), mode: 'event' }));
    await press('이벤트 분류');
    assert.equal(paths.includes('/api/town/exchanges/event?categoryCandidateId=type%3Aevent%20%26%20rare'), true);
    assert.equal(button('교환').props.disabled, true);
    await act(async () => pending.resolve({ ...value, currentCategoryId: 'type:event & rare' }));
  });

  it('유물 등급 교환은 대상 선택 없이 경고 후 action id만 전송한다', async () => {
    const calls: Array<{ path: string; request: unknown }> = [];
    const legacy = data('LEGACY', { rows: [], warning: 'HOF가 +10 레거시 장비 중 1개를 자동 선택합니다. 앱에서는 대상을 지정할 수 없습니다.', gradeActions: [{ id: 'junk', label: 'Junk 등급 교환', consumedItemsPerPress: 1, allowsTargetSelection: false }] });
    await render(React.createElement(ExchangePanel, { api: api(async () => legacy, async (path, request) => { calls.push({ path, request }); return { ...legacy, result: result() }; }), mode: 'legacy' }));
    await press('Junk 등급 교환');
    assert.equal(text().includes('HOF 자동 선택'), true);
    await pressLast('Junk 등급 교환');
    assert.deepEqual(calls, [{ path: '/api/town/exchanges/legacy/grade', request: { gradeActionId: 'junk' } }]);
  });

  it('앤의 가게는 modify와 gift 후보를 각 그룹에서 선택해 실제 action만 보낸다', async () => {
    const calls: unknown[] = [];
    const ann = data('ANN', { rows: [], categories: [], currentCategoryId: null, annActions: [
      { type: 'MODIFY_ITEM', label: '앤에게 아이템을 맡긴다', rows: [row('modify', '+10 Legacy Arm')] },
      { type: 'GIVE_GIFT', label: '앤에게 선물', rows: [row('flower', 'Flower')] },
    ] });
    await render(React.createElement(ExchangePanel, { api: api(async () => ann, async (_path, request) => { calls.push(request); return { ...ann, result: result() }; }), mode: 'ann' }));
    await press('+10 Legacy Arm 선택'); await press('앤에게 아이템을 맡긴다'); await pressLast('앤에게 아이템을 맡긴다');
    assert.deepEqual(calls, [{ action: 'MODIFY_ITEM', candidateId: 'modify', quantity: 1 }]);
  });

  it('보유재화와 긴 기록은 같은 가상 목록에서 표시한다', async () => {
    const value = data('LEGACY', { ownedCurrencies: [{ label: 'Ancient Gold Coin', quantity: 37 }], history: Array.from({ length: 200 }, (_, index) => `마제즈 결과 ${index + 1}`) });
    await render(React.createElement(ExchangePanel, { api: api(async () => value), mode: 'legacy' }));
    assert.equal(text().includes('Ancient Gold Coin: 37'), true);
    await press('교환 기록 펼치기');
    const list = mounted!.root.find((node) => String(node.type) === 'FlatList');
    assert.equal(list.props.data.length, 202);
  });
});

function row(id: string, label: string, selectable = true) { return { id, label, selectable, detail: label, cost: 100, owned: 1, minQuantity: 1, maxQuantity: 9 }; }
function data(mode: 'EMBLEM' | 'EVENT' | 'LEGACY' | 'ANN', patch: Record<string, unknown> = {}) { return { mode, categories: [{ id: 'all', label: '전부', current: true }], currentCategoryId: 'all', rows: [row('trade', '교환품'), row('display', '재료 부족', false)], ownedCurrencies: [], gradeActions: [], annActions: [], warning: null, history: [], result: null, ...patch }; }
function result() { return { status: 'SUCCESS' as const, messages: ['완료'], items: [], refreshRequired: true }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(node: React.ReactElement) { await act(async () => { mounted = create(node); }); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance { return mounted!.root.find((node) => node.props.accessibilityLabel === label); }
async function press(label: string) { await act(async () => button(label).props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function pressLast(label: string) { const nodes = mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0); await act(async () => nodes.at(-1)!.props.onPress()); await act(async () => { await Promise.resolve(); }); }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
