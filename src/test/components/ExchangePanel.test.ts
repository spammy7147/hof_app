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

  it('분류를 불러오는 동안 이전 화면의 모든 선택과 비용 action을 잠근다', async () => {
    const pending = deferred<unknown>();
    const legacy = data('LEGACY', {
      categories: [{ id: 'all', label: '전부', current: true }, { id: 'weapon', label: '무기', current: false }],
      gradeActions: [{ id: 'junk', label: 'Junk 등급 교환', consumedItemsPerPress: 1, allowsTargetSelection: false }],
    });
    await render(React.createElement(ExchangePanel, { api: api(async (path) => path.includes('?') ? pending.promise : legacy), mode: 'legacy' }));
    await press('무기 분류');

    assert.equal(button('전부 분류').props.disabled, true);
    assert.equal(button('교환품 선택 불가').props.disabled, true);
    assert.equal(button('Junk 등급 교환').props.disabled, true);
    assert.equal(text().includes('선택한 교환 정보를 불러오는 중...'), true);
    await act(async () => pending.resolve({ ...legacy, currentCategoryId: 'weapon' }));
  });

  it('유물 등급 교환은 대상 선택 없이 action id를 바로 전송한다', async () => {
    const calls: Array<{ path: string; request: unknown }> = [];
    const legacy = data('LEGACY', { rows: [], warning: 'HOF가 +10 레거시 장비 중 1개를 자동 선택합니다. 앱에서는 대상을 지정할 수 없습니다.', gradeActions: [{ id: 'junk', label: 'Junk 등급 교환', consumedItemsPerPress: 1, allowsTargetSelection: false }] });
    await render(React.createElement(ExchangePanel, { api: api(async () => legacy, async (path, request) => { calls.push({ path, request }); return { ...legacy, result: result() }; }), mode: 'legacy' }));
    await press('Junk 등급 교환');
    assert.deepEqual(calls, [{ path: '/api/town/exchanges/legacy/grade', request: { gradeActionId: 'junk' } }]);
  });

  it('앤의 가게는 modify와 gift 후보를 각 그룹에서 선택해 실제 action만 보낸다', async () => {
    const calls: unknown[] = [];
    const ann = data('ANN', { rows: [], categories: [], currentCategoryId: null, annActions: [
      { type: 'MODIFY_ITEM', label: '앤에게 아이템을 맡긴다', rows: [row('modify', '+10 Legacy Arm')] },
      { type: 'GIVE_GIFT', label: '앤에게 선물', rows: [row('flower', 'Flower')] },
    ] });
    await render(React.createElement(ExchangePanel, { api: api(async () => ann, async (_path, request) => { calls.push(request); return { ...ann, result: result() }; }), mode: 'ann' }));
    await press('+10 Legacy Arm 선택'); await press('앤에게 아이템을 맡긴다');
    await press('Flower 선택'); await press('앤에게 선물');
    assert.equal(text().includes('Flower'), true);
    assert.deepEqual(calls, [
      { action: 'MODIFY_ITEM', candidateId: 'modify', quantity: 1 },
      { action: 'GIVE_GIFT', candidateId: 'flower', quantity: 1 },
    ]);
  });

  it('교환 버튼은 현재 선택값을 즉시 보내고 중복 POST를 막는다', async () => {
    const pending = deferred<unknown>();
    const calls: unknown[] = [];
    const value = data('EMBLEM', { rows: [{ ...row('trade', '빛나는 검'), detail: 'Order of Gladiator(Green) ×15', cost: 100_000 }] });
    await render(React.createElement(ExchangePanel, { api: api(async () => value, async (_path, request) => { calls.push(request); return pending.promise; }), mode: 'emblem' }));
    await press('빛나는 검 선택');
    await changeInput('교환 수량', '2');
    assert.equal(text().includes('$100,000'), true);
    assert.equal(text().includes('Order of Gladiator(Green) ×15'), true);

    const exchange = button('교환');
    await act(async () => { exchange.props.onPress(); exchange.props.onPress(); await Promise.resolve(); });
    assert.deepEqual(calls, [{ candidateId: 'trade', categoryCandidateId: 'all', quantity: 2 }]);
    await act(async () => pending.resolve({ ...value, result: result() }));
  });

  it('새 교환이 실패하면 직전 성공 결과를 현재 결과처럼 남기지 않는다', async () => {
    const value = data('EMBLEM');
    let submits = 0;
    const submit = async () => {
      submits += 1;
      if (submits === 1) return { ...value, result: { ...result(), messages: ['첫 교환 성공'] } };
      throw new Error('두 번째 교환 실패');
    };
    await render(React.createElement(ExchangePanel, { api: api(async () => value, submit), mode: 'emblem' }));
    await press('교환품 선택'); await press('교환');
    assert.equal(text().includes('첫 교환 성공'), true);
    await press('교환');
    assert.equal(text().includes('두 번째 교환 실패'), true);
    assert.equal(text().includes('첫 교환 성공'), false);
  });

  it('백엔드 Int 범위를 넘는 무제한 수량은 클라이언트에서 제출하지 않는다', async () => {
    const value = data('EMBLEM', { rows: [{ ...row('trade', '무제한 교환품'), maxQuantity: null }] });
    await render(React.createElement(ExchangePanel, { api: api(async () => value), mode: 'emblem' }));
    await press('무제한 교환품 선택');
    await changeInput('교환 수량', '2147483648');
    assert.equal(button('교환').props.disabled, true);
    assert.equal(text().includes('1~2,147,483,647 사이의 정수를 입력하세요.'), true);
  });

  it('API 계정이 바뀌면 이전 계정의 action 응답을 즉시 숨긴다', async () => {
    const oldValue = data('EMBLEM', { result: { ...result(), messages: ['이전 계정 결과'] } });
    const newLoad = deferred<unknown>();
    const oldApi = api(async () => oldValue);
    await render(React.createElement(ExchangePanel, { api: oldApi, mode: 'emblem' }));
    assert.equal(text().includes('이전 계정 결과'), true);

    await act(async () => mounted!.update(React.createElement(ExchangePanel, { api: api(async () => newLoad.promise), mode: 'emblem' })));
    assert.equal(text().includes('이전 계정 결과'), false);
    assert.equal(text().includes('교환 시설 정보를 불러오는 중...'), true);
    await act(async () => newLoad.resolve(data('EMBLEM')));
  });

  it('이전 API의 늦은 실패를 새 계정 화면에 표시하지 않는다', async () => {
    const oldSubmit = deferred<unknown>();
    const value = data('EMBLEM');
    await render(React.createElement(ExchangePanel, { api: api(async () => value, async () => oldSubmit.promise), mode: 'emblem' }));
    await press('교환품 선택'); await press('교환');

    const newApi = api(async () => value, async () => value);
    await act(async () => mounted!.update(React.createElement(ExchangePanel, { api: newApi, mode: 'emblem' })));
    await act(async () => { await Promise.resolve(); });
    await press('교환품 선택'); await press('교환');
    await act(async () => oldSubmit.reject(new Error('old account failure')));
    assert.equal(text().includes('old account failure'), false);
  });

  it('네트워크 원문 오류는 사용자용 연결 실패 문구로 바꾼다', async () => {
    await render(React.createElement(ExchangePanel, { api: api(async () => { throw new Error('fetch failed ECONNREFUSED 10.0.2.2:8080'); }), mode: 'event' }));
    assert.equal(text().includes('서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.'), true);
    assert.equal(text().includes('ECONNREFUSED'), false);
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
async function changeInput(label: string, value: string) { await act(async () => button(label).props.onChangeText(value)); }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
