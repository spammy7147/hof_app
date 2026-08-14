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
const { CardPanel } = require('../../main/features/town/panels/CardPanel') as typeof import('../../main/features/town/panels/CardPanel'); moduleWithLoader._load = originalLoad;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null; afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; });

describe('CardPanel', () => {
  it('감정은 라디오가 있는 카드 한 장만 확인 후 제출한다', async () => {
    const calls: unknown[] = []; const data = { selectionSlots: 1, cards: [card('a', 'Bat Card'), { ...card('display', 'Joker Card'), selectable: false }], result: null };
    await render(React.createElement(CardPanel, { api: api(async () => data, async (_path, request) => { calls.push(request); return { ...data, result: result('SUCCESS') }; }), mode: 'identify' }));
    assert.equal(button('Joker Card 선택 불가').props.disabled, true); await press('Bat Card 선택'); await press('선택 카드 감정'); assert.deepEqual(calls, [{ candidateId: 'a' }]);
  });

  it('강화는 목록 밖 하단에 수량 추가 카드 버튼 순서로 고정하고 한 번만 제출한다', async () => {
    const calls: Array<{ path: string; request: unknown }> = []; const materials = [card('same', 'Same'), card('material', 'Material')]; const data = { selectionSlots: [{ id: 'base', label: '베이스 카드' }, { id: 'material', label: '추가 카드' }], baseCards: [card('same', 'Base')], materialCards: [], selectedBaseCandidateId: null, minQuantity: 1, maxQuantity: 20, history: ['성공'], result: null };
    await render(React.createElement(CardPanel, { api: api(async () => data, async (path, request) => { if (path.endsWith('/options')) return { ...data, baseCards: [], materialCards: materials, selectedBaseCandidateId: 'same' }; calls.push({ path, request }); return { ...data, result: result('SUCCESS') }; }), mode: 'upgrade' }));
    await press('베이스 카드 Base 선택');
    assert.equal(mounted!.root.findAll((node) => node.props.accessibilityLabel === '추가 카드 Same 선택').length, 0, '추가 카드는 베이스 목록에 섞지 않는다');
    const listArea = mounted!.root.findByProps({ testID: 'card-upgrade-list' });
    const controls = mounted!.root.findByProps({ testID: 'card-upgrade-controls' });
    assert.equal(listArea.parent, controls.parent, '목록과 하단 고정 영역을 분리한다');
    assert.equal(listArea.findAll((node) => node.props.accessibilityLabel === '카드 강화').length, 0);
    const orderedControls = controls.findAll((node) => ['카드 강화 수량', '추가 카드 선택', '카드 강화'].includes(node.props.accessibilityLabel)).map((node) => node.props.accessibilityLabel);
    assert.ok(orderedControls.indexOf('카드 강화 수량') < orderedControls.indexOf('추가 카드 선택'));
    assert.ok(orderedControls.indexOf('추가 카드 선택') < orderedControls.indexOf('카드 강화'));

    await press('추가 카드 선택'); await press('추가 카드 Same 선택');
    assert.equal(button('카드 강화').props.disabled, true, '같은 서버 card id는 차단');
    await press('추가 카드 선택'); await change('추가 카드 검색', 'material');
    const filteredChoices = mounted!.root.findByProps({ accessibilityRole: 'radiogroup' });
    assert.equal(filteredChoices.findAll((node) => node.props.accessibilityLabel === '추가 카드 Same 선택').length, 0);
    assert.ok(filteredChoices.findAll((node) => node.props.accessibilityLabel === '추가 카드 Material 선택').length > 0);
    await press('추가 카드 Material 선택'); await change('카드 강화 수량', '2'); await press('카드 강화');
    assert.deepEqual(calls, [{ path: '/api/town/cards/upgrade', request: { baseCandidateId: 'same', materialCandidateId: 'material', quantity: 2 } }]);
  });

  it('카드 합성은 검색 가능한 합성 재료와 버튼을 목록 밖 하단에 고정한다', async () => {
    const calls: Array<{ path: string; request: unknown }> = []; const materials = [card('same', 'Same'), card('material', 'Material')]; const data = { selectionSlots: [{ id: 'base', label: '베이스 카드' }, { id: 'material', label: '추가 카드' }], baseCards: [card('same', 'Base')], materialCards: [], selectedBaseCandidateId: null, minQuantity: 1, maxQuantity: 10, history: ['성공'], result: null };
    await render(React.createElement(CardPanel, { api: api(async () => data, async (path, request) => { if (path.endsWith('/options')) return { ...data, baseCards: [], materialCards: materials, selectedBaseCandidateId: 'same' }; calls.push({ path, request }); return { ...data, result: result('SUCCESS') }; }), mode: 'change' }));
    await press('베이스 카드 Base 선택');
    assert.equal(mounted!.root.findAll((node) => node.props.accessibilityLabel === '합성 재료 Same 선택').length, 0, '합성 재료는 베이스 목록에 섞지 않는다');
    const listArea = mounted!.root.findByProps({ testID: 'card-change-list' });
    const controls = mounted!.root.findByProps({ testID: 'card-change-controls' });
    assert.equal(listArea.parent, controls.parent, '목록과 하단 고정 영역을 분리한다');
    assert.equal(listArea.findAll((node) => node.props.accessibilityLabel === '카드 변화').length, 0);
    const orderedControls = controls.findAll((node) => ['카드 변화 수량', '합성 재료 선택', '카드 변화'].includes(node.props.accessibilityLabel)).map((node) => node.props.accessibilityLabel);
    assert.ok(orderedControls.indexOf('카드 변화 수량') < orderedControls.indexOf('합성 재료 선택'), '수량이 합성 재료보다 위에 있다');
    assert.ok(orderedControls.indexOf('합성 재료 선택') < orderedControls.indexOf('카드 변화'), '합성 재료 드롭다운이 합성 버튼보다 위에 있다');

    await press('합성 재료 선택'); await press('합성 재료 Same 선택'); assert.equal(button('카드 변화').props.disabled, true, '같은 서버 card id는 차단');
    await press('합성 재료 선택'); await change('합성 재료 검색', 'material');
    const filteredChoices = mounted!.root.findByProps({ accessibilityRole: 'radiogroup' });
    assert.equal(filteredChoices.findAll((node) => node.props.accessibilityLabel === '합성 재료 Same 선택').length, 0);
    assert.ok(filteredChoices.findAll((node) => node.props.accessibilityLabel === '합성 재료 Material 선택').length > 0);
    await press('합성 재료 Material 선택'); await change('카드 변화 수량', '2'); await press('카드 변화');
    assert.deepEqual(calls, [{ path: '/api/town/cards/change', request: { baseCandidateId: 'same', materialCandidateId: 'material', quantity: 2 } }]);
  });

  it('카드 판매는 여러 수량과 Blank Card 예상량을 한 요청으로 보낸다', async () => {
    const calls: unknown[] = []; const data = { cards: [{ ...card('a', 'A'), owned: 3, maxQuantity: 3, blankCardValue: 1 }, { ...card('b', 'B'), owned: 2, maxQuantity: 2, blankCardValue: 4 }], multiSelect: true, rewardKind: 'BLANK_CARD', blankCardsOwned: 660, result: null };
    await render(React.createElement(CardPanel, { api: api(async () => data, async (_path, request) => { calls.push(request); return { ...data, result: result('FAILURE') }; }), mode: 'sell' }));
    await press('A 선택'); await press('B 선택'); await change('A 판매 수량', '2'); assert.equal(text().includes('예상 Blank Card +6장'), true); await press('선택 카드 판매'); assert.deepEqual(calls, [{ cards: [{ candidateId: 'a', quantity: 2 }, { candidateId: 'b', quantity: 1 }] }]); assert.equal(button('A 판매 수량').props.value, '2', '실패 시 선택과 수량 보존');
  });

  it('카드 판매는 검색하고 선택한 카드 안에서 수량을 편집하며 판매 버튼을 목록 밖에 고정한다', async () => {
    const data = { cards: [{ ...card('bat', "Bat's Card"), owned: 3, maxQuantity: 3, blankCardValue: 1 }, { ...card('soul', "Soul Taker's Card"), owned: 4, maxQuantity: 4, blankCardValue: 4 }], multiSelect: true, rewardKind: 'BLANK_CARD', blankCardsOwned: 660, result: null };
    await render(React.createElement(CardPanel, { api: api(async () => data), mode: 'sell' }));

    await change('판매 카드 검색', 'soul taker');
    assert.equal(text().includes("Bat's Card"), false);
    assert.equal(text().includes("Soul Taker's Card"), true);
    await press("Soul Taker's Card 선택");

    const selectedCard = button("Soul Taker's Card 선택").parent;
    assert.ok((selectedCard?.findAll((node) => node.props.accessibilityLabel === "Soul Taker's Card 판매 수량").length ?? 0) > 0);
    const listArea = mounted!.root.findByProps({ testID: 'card-sell-list' });
    const actionBar = mounted!.root.findByProps({ testID: 'card-sell-action-bar' });
    assert.equal(listArea.findAll((node) => node.props.accessibilityLabel === '선택 카드 판매').length, 0);
    assert.ok(actionBar.findAll((node) => node.props.accessibilityLabel === '선택 카드 판매').length > 0);
    assert.equal(listArea.parent, actionBar.parent);
  });

  it('소울 에코는 분류와 품목을 선택하고 보유량 검색·이력을 별도로 표시한다', async () => {
    const calls: unknown[] = []; const data = { categories: [{ id: 'type:weapon', label: '무기' }, { id: 'type:armor', label: '방어구' }], currentCategoryId: 'type:weapon', recipes: [{ id: 'recipe', label: '???', selectable: true, category: 'type:weapon', requiredEchoes: ['Bat x96'], cost: 5_000_000, successBonus: 40 }], ownedEchoes: [{ name: 'Bat Chief', region: 'Arena Boss', quantity: 875 }, { name: 'Lord', region: 'Dungeon Boss', quantity: 2 }], history: [{ text: 'Shadow Horse', success: true }], result: null };
    await render(React.createElement(CardPanel, { api: api(async () => data, async (_path, request) => { calls.push(request); return { ...data, result: result('SUCCESS') }; }), mode: 'soul-echo' }));
    await change('보유 소울 에코 검색', 'arena'); assert.equal(text().includes('Bat Chief'), true); assert.equal(text().includes('Lord'), false); assert.equal(button('현재 품목 분류 무기 선택 불가').props.disabled, true); assert.equal(button('분류 전환 미지원 방어구 선택 불가').props.disabled, true); await press('무기 · Bat x96 · 성공 보정 +40% ??? 선택'); await press('소울 에코 융합'); assert.deepEqual(calls, [{ categoryCandidateId: 'type:weapon', recipeCandidateId: 'recipe' }]);
  });

  it('베이스를 빠르게 바꾸면 늦게 도착한 이전 추가 카드 후보를 버린다', async () => {
    const first = deferred<unknown>(); const second = deferred<unknown>();
    const data = { selectionSlots: [{ id: 'base', label: '베이스 카드' }, { id: 'material', label: '추가 카드' }], baseCards: [card('a', 'A'), card('b', 'B')], materialCards: [], selectedBaseCandidateId: null, minQuantity: 1, maxQuantity: 10, history: [], result: null };
    let optionCall = 0;
    await render(React.createElement(CardPanel, { api: api(async () => data, async (path) => path.endsWith('/options') ? (++optionCall === 1 ? first.promise : second.promise) : Promise.reject(new Error('unexpected'))), mode: 'upgrade' }));
    await press('베이스 카드 A 선택'); await press('베이스 카드 B 선택');
    await act(async () => second.resolve({ ...data, baseCards: [], materialCards: [card('b-material', 'B 재료')], selectedBaseCandidateId: 'b' }));
    await press('추가 카드 선택'); assert.equal(text().includes('B 재료'), true); await press('추가 카드 선택 닫기');
    await act(async () => first.resolve({ ...data, baseCards: [], materialCards: [card('a-material', 'A 재료')], selectedBaseCandidateId: 'a' }));
    await press('추가 카드 선택'); assert.equal(text().includes('B 재료'), true); assert.equal(text().includes('A 재료'), false);
  });

  it('추가 카드 후보 조회 실패 시 베이스를 보존하고 명시적으로 재시도한다', async () => {
    const data = { selectionSlots: [{ id: 'base', label: '베이스 카드' }, { id: 'material', label: '추가 카드' }], baseCards: [card('a', 'A')], materialCards: [], selectedBaseCandidateId: null, minQuantity: 1, maxQuantity: 10, history: [], result: null };
    let attempts = 0;
    await render(React.createElement(CardPanel, { api: api(async () => data, async (path) => { if (!path.endsWith('/options')) throw new Error('unexpected'); attempts += 1; if (attempts === 1) throw new Error('Network request failed'); return { ...data, baseCards: [], materialCards: [card('material', '재료')], selectedBaseCandidateId: 'a' }; }), mode: 'upgrade' }));
    await press('베이스 카드 A 선택'); assert.equal(text().includes('서비스에 연결할 수 없습니다.'), true); assert.equal(button('베이스 카드 A 선택').props.accessibilityState.checked, true);
    await press('추가 카드 다시 불러오기'); await press('추가 카드 선택'); assert.equal(text().includes('재료'), true); assert.equal(attempts, 2);
  });
});

function card(id: string, label: string) { return { id, label, selectable: true, owned: 2, rarity: '★', restrictions: [], detail: null, cost: 5_000, blankCardValue: null, maxQuantity: 2 }; }
function result(status: 'SUCCESS' | 'FAILURE') { return { status, messages: [status], items: [], refreshRequired: true }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(node: React.ReactElement) { await act(async () => { mounted = create(node); }); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance { return mounted!.root.find((node) => node.props.accessibilityLabel === label); }
async function press(label: string) { await act(async () => button(label).props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function change(label: string, value: string) { await act(async () => button(label).props.onChangeText(value)); }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
