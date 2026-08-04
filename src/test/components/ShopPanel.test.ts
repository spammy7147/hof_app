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
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
  if (request === 'expo-image') return { Image: host('Image') };
  return originalLoad(request, parent, isMain);
};
const { ShopPanel } = require('../../main/features/town/panels/ShopPanel') as typeof import('../../main/features/town/panels/ShopPanel');
const { BackendApiError } = require('../../main/services/backendApi') as typeof import('../../main/services/backendApi');
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
      assert.equal(mounted!.root.findAllByProps({ testID: 'purchase-action-bar' }).length > 0, true);
      const list = mounted!.root.find((node) => String(node.type) === 'FlatList');
      assert.equal(list.findAllByProps({ testID: 'purchase-action-bar' }).length, 0);
      assert.deepEqual(list.props.stickyHeaderIndices, [0]);
    });
  }

  it('암흑상점 조회는 CAPTCHA 대기에 들어가지 않고 오류 상태로 종료한다', async () => {
    let captchaRequests = 0;
    await render(React.createElement(ShopPanel, {
      api: api(async () => { throw new BackendApiError(409, 'CAPTCHA_REQUIRED', 'HOF 인증이 필요합니다.'); }),
      mode: 'dark',
      resolveCaptcha: async () => { captchaRequests += 1; },
    }));

    assert.equal(captchaRequests, 0);
    assert.equal(text().includes('HOF 인증이 필요합니다.'), true);
    assert.equal(text().includes('목록을 불러오는 중...'), false);
  });

  it('가격 검색 안내와 실제 가격 문자열 필터를 제공한다', async () => {
    await render(React.createElement(ShopPanel, { api: api(async () => shop('general')), mode: 'general' }));
    assert.equal(button('상점 품목 검색').props.placeholder, '이름·유형·설명·가격 검색');
    await change('상점 품목 검색', '200');
    assert.equal(mounted!.root.findAll((node) => node.props.accessibilityLabel === 'Potion 선택').length, 0);
    assert.ok(button('Bread 선택'));
  });

  it('상점 원문의 이름 유형 상세 가격을 중복 없이 나누고 선택 수량을 해당 카드에 둔다', async () => {
    const woodShield = {
      ...shop('general'),
      items: [{
        id: 'shield', label: 'WoodShield', selectable: true,
        detail: '$ 1,000 WoodShield (Shield) / Def:7+9 / Mdef:3+5 / h:1 / M:Metal / S.Shield / 완전 방어(+6%)',
        imageUrl: null, price: 1_000, quantity: null, type: null,
      }],
    };
    await render(React.createElement(ShopPanel, { api: api(async () => woodShield), mode: 'general' }));

    const initialText = text();
    assert.equal(initialText.includes('WoodShield (Shield)'), true);
    assert.equal(initialText.includes('Def:7+9 / Mdef:3+5 / h:1 / M:Metal / S.Shield / 완전 방어(+6%)'), true);
    assert.equal(initialText.includes('$ 1,000 WoodShield'), false);
    assert.equal(initialText.includes('$1,000'), true);

    await press('WoodShield 선택');
    const selectedCard = button('WoodShield 선택').parent!;
    assert.equal(selectedCard.findAll((node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'WoodShield 구매 수량').length, 1);
    assert.equal(text().includes('수량'), true);
  });

  it('잡화점은 사용 가능 횟수를 상세에 남기고 useitem 유형만 제목으로 분리한다', async () => {
    const wheatFlour = {
      ...shop('sundries'),
      items: [{
        id: 'flour', label: 'Wheat flour', selectable: true,
        detail: '$ 100 Wheat flour( 1회 사용가능 ) (useitem) / h:0 / (재료1)밀가루. 이걸 그냥 먹으려고요? (사용 효과 : 입이 텁텁해집니다. TP-2%)',
        imageUrl: null, price: 100, quantity: null, type: 'useitem',
      }],
    };
    await render(React.createElement(ShopPanel, { api: api(async () => wheatFlour), mode: 'sundries' }));

    const rendered = text();
    assert.equal(rendered.includes('Wheat flour (useitem)'), true);
    assert.equal(rendered.includes('( 1회 사용가능 ) / h:0 / (재료1)밀가루.'), true);
    assert.equal(rendered.includes('$ 100 Wheat flour'), false);
    await press('Wheat flour 선택');
    assert.ok(button('Wheat flour 구매 수량'));
  });

  it('다중 상품 수량과 예상 비용을 확인한 뒤 한 번만 구매한다', async () => {
    const submissions: unknown[] = [];
    await render(React.createElement(ShopPanel, { api: api(async () => shop('general'), async (_path, request) => { submissions.push(request); return { ...shop('general'), result: result('SUCCESS') }; }), mode: 'general' }));
    await press('Potion 선택'); await press('Bread 선택');
    await change('Potion 구매 수량', '2');
    assert.equal(text().includes('예상 총액 $400'), true);
    await press('장바구니 구매'); assert.deepEqual(submissions, []);
    assert.equal(text().includes('Potion 2개 · $200'), true);
    assert.equal(text().includes('Bread 1개 · $200'), true);
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
    await press('선택 품목 판매');
    assert.equal(text().includes('Funds Bag 1개 · $0'), true);
    await pressLast('판매');
    assert.deepEqual(submissions, [{ items: [{ candidateId: 'free', quantity: 1 }] }]);
  });

  it('판매 품목의 중복 정보를 정리하고 카드 안에서 수량을 입력하며 작업 영역을 목록 밖에 둔다', async () => {
    const sell = { items: [{
      id: 'axe', label: "High Lord's Rule Over", selectable: true,
      detail: "$ 0 High Lord's Rule Over (Axe) x1 / Atk:299 / Summon+10% / h:10 / M:Elementium",
      imageUrl: null, price: 0, quantity: 1, type: null,
    }], result: null };
    await render(React.createElement(ShopPanel, { api: api(async () => sell), mode: 'sell' }));

    const rendered = text();
    assert.equal(rendered.includes("High Lord's Rule Over (Axe) x 1"), true);
    assert.equal(rendered.includes('Atk:299 / Summon+10% / h:10 / M:Elementium'), true);
    assert.equal(rendered.includes('$ 0 High Lord'), false);
    assert.equal(rendered.includes('보유 1'), false);

    await press("High Lord's Rule Over 선택");
    const selectedCard = button("High Lord's Rule Over 선택").parent!;
    assert.equal(selectedCard.findAll((node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === "High Lord's Rule Over 판매 수량").length, 1);
    const actionBar = mounted!.root.findByProps({ testID: 'sell-action-bar' });
    assert.notEqual(String(actionBar.parent?.type), 'FlatList');
    assert.ok(actionBar.findAll((node) => node.props.accessibilityLabel === '선택 품목 판매').length >= 1);
  });

  it('주재료 한 개와 부재료 세 슬롯을 선택해야 Combine을 제출한다', async () => {
    const submissions: unknown[] = [];
    const combine = { primary: [{ id: 'm', label: 'Milk', quantity: 3 }], secondarySlots: [[{ id: 'a', label: 'A', quantity: 3 }], [{ id: 'b', label: 'B', quantity: 3 }], [{ id: 'c', label: 'C', quantity: 3 }]], result: null };
    await render(React.createElement(ShopPanel, { api: api(async () => combine, async (_path, request) => { submissions.push(request); return { ...combine, result: result('SUCCESS') }; }), mode: 'combine' }));
    assert.equal(button('조합').props.disabled, true);
    for (const [slot, option] of [['주재료', 'Milk'], ['부재료(대)', 'A'], ['부재료(중)', 'B'], ['부재료(소)', 'C']]) { await press(`${slot} 선택`); await press(`${option} 선택`); }
    await change('조합 결과 수량', '2'); await press('조합');
    for (const expected of ['주재료', 'Milk · 2개 사용', '부재료(대)', 'A · 2개 사용', '부재료(중)', 'B · 2개 사용', '부재료(소)', 'C · 2개 사용', '조합 결과 수량', '2개']) assert.equal(text().includes(expected), true);
    await pressLast('Combine');
    assert.deepEqual(submissions, [{ primaryCandidateId: 'm', secondaryCandidateIds: ['a', 'b', 'c'], quantity: 2 }]);
  });

  it('조합 슬롯마다 검색 가능한 드롭다운을 열고 선택 해제로 슬롯을 비운다', async () => {
    const combine = { primary: [{ id: 'milk', label: 'Milk', quantity: 3 }, { id: 'dragon', label: 'Dragon Meat', quantity: 50 }], secondarySlots: [[], [], []], result: null };
    await render(React.createElement(ShopPanel, { api: api(async () => combine), mode: 'combine' }));

    for (const slot of ['주재료', '부재료(대)', '부재료(중)', '부재료(소)']) assert.ok(button(`${slot} 선택`));
    await press('주재료 선택');
    await change('주재료 소재 검색', 'dragon');
    assert.equal(mounted!.root.findAll((node) => node.props.accessibilityLabel === 'Milk 선택').length, 0);
    await press('Dragon Meat 선택');
    assert.equal(text().includes('Dragon Meat x 50'), true);

    await press('주재료 선택');
    await press('선택 해제 선택');
    assert.equal(text().includes('Dragon Meat x 50'), false);
    assert.equal(button('조합').props.disabled, true);
  });

  it('같은 소재가 여러 조합 슬롯에 있어도 슬롯별 radio 이름과 선택을 구분한다', async () => {
    const submissions: unknown[] = [];
    const shared = { id: 'same', label: 'Shared', quantity: 2 };
    const combine = { primary: [shared], secondarySlots: [[shared], [shared], [shared]], result: null };
    await render(React.createElement(ShopPanel, { api: api(async () => combine, async (_path, request) => { submissions.push(request); return { ...combine, result: result('SUCCESS') }; }), mode: 'combine' }));

    for (const slot of ['주재료', '부재료(대)', '부재료(중)', '부재료(소)']) { await press(`${slot} 선택`); await press('Shared 선택'); }
    await press('조합'); await pressLast('Combine');

    assert.deepEqual(submissions, [{ primaryCandidateId: 'same', secondaryCandidateIds: ['same', 'same', 'same'], quantity: 1 }]);
  });

  it('보유량과 safe integer를 넘는 수량은 제출을 차단한다', async () => {
    const sell = { items: [{ id: 'owned', label: 'Owned', selectable: true, detail: null, imageUrl: null, price: 10, quantity: 5, type: 'item' }], result: null };
    await render(React.createElement(ShopPanel, { api: api(async () => sell), mode: 'sell' }));
    await press('Owned 선택'); await change('Owned 판매 수량', '6');
    assert.equal(button('선택 품목 판매').props.disabled, true);
    assert.equal(text().includes('1~5 사이의 정수를 입력하세요.'), true);

    await act(async () => mounted?.unmount()); mounted = null;
    await render(React.createElement(ShopPanel, { api: api(async () => shop('general')), mode: 'general' }));
    await press('Potion 선택'); await change('Potion 구매 수량', '9007199254740992');
    assert.equal(button('장바구니 구매').props.disabled, true);
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
