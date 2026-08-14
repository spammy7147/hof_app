import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => React.createElement('FlatList', props, props.ListHeaderComponent as React.ReactNode, (props.data as Array<{ id: string }>).map((item) => React.createElement(React.Fragment, { key: item.id }, (props.renderItem as Function)({ item }))), props.ListFooterComponent as React.ReactNode),
  Modal: host('Modal'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), StyleSheet: { create: <T,>(styles: T) => styles }, Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader }; const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => { if (request === 'react-native') return reactNativeMock; if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }; if (request === 'expo-image') return { Image: host('Image') }; return originalLoad(request, parent, isMain); };
const { CraftingPanel } = require('../../main/features/town/panels/CraftingPanel') as typeof import('../../main/features/town/panels/CraftingPanel'); moduleWithLoader._load = originalLoad;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null; afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; });

describe('CraftingPanel', () => {
  it('제작공방 카드에서 아이템명과 옵션·필요 재료를 분리한다', async () => {
    const create = data('CREATE', {
      rows: [{
        id: 'short-sword',
        label: 'Short Sword (Sword) / Atk:10 / h:1 / M:Metal / Steel Ingot x 4(12054) x4',
        selectable: true,
        detail: null,
        cost: 10,
        owned: null,
        workSeconds: null,
      }],
    });
    await render(React.createElement(CraftingPanel, { api: api(async () => create), mode: 'create' }));

    const row = (mounted!.root.find((node) => String(node.type) === 'FlatList').props.data as Array<Record<string, unknown>>)[0];
    assert.equal(row.label, 'Short Sword');
    assert.equal(row.detail, '(Sword) · Atk:10 · h:1 · M:Metal · Steel Ingot x 4(12054) x4');
  });

  it('강화수치·아이템명·수량만 제목에 두고 타입과 능력치는 상세로 분리한다', async () => {
    const raw = '+9 Shattered Elementium Destroyer (TwoHandSword) x1 / Atk:137 / Matk:59 / Def:15+120';
    const refine = data('REFINE', {
      rows: [{ id: 'item', label: raw, selectable: true, detail: `$ 113,500 ${raw}`, cost: 113_500, owned: 1, workSeconds: null }],
      allowedRefineCounts: [1],
    });
    await render(React.createElement(CraftingPanel, { api: api(async () => refine), mode: 'refine' }));

    const row = (mounted!.root.find((node) => String(node.type) === 'FlatList').props.data as Array<Record<string, unknown>>)[0];
    assert.equal(row.label, '+9 Shattered Elementium Destroyer x1');
    assert.equal(row.detail, '(TwoHandSword) · Atk:137 · Matk:59 · Def:15+120');
    assert.equal(row.quantity, null);
    assert.equal(text().includes('$ 113,500 +9 Shattered'), false);
  });

  it('제련공방은 검색과 횟수 드롭다운을 제공하고 활성 품목만 고정 영역에서 제출한다', async () => {
    const calls: unknown[] = [];
    const refine = data('REFINE', {
      rows: [
        { id: 'header', label: '제련가능 Item', selectable: false, detail: null, cost: null, owned: null, workSeconds: null },
        { id: 'soul', label: 'Soul Sword x5', selectable: true, detail: 'Atk:10', cost: 50, owned: 5, workSeconds: null },
        { id: 'moon', label: 'Moon Axe x1', selectable: true, detail: 'Atk:20', cost: 100, owned: 1, workSeconds: null },
      ],
      allowedRefineCounts: [1, 2, 100],
    });
    await render(React.createElement(CraftingPanel, { api: api(async () => refine, async (_path, request) => { calls.push(request); return { ...refine, result: result() }; }), mode: 'refine' }));

    assert.equal(button('제련가능 Item 선택 불가').props.disabled, true);
    await change('제련 아이템 검색', 'soul');
    const list = mounted!.root.find((node) => String(node.type) === 'FlatList');
    assert.deepEqual((list.props.data as Array<{ id: string }>).map((row) => row.id), ['recipe:soul']);
    const fixedArea = button('제련 설정 고정 영역');
    assert.equal(fixedArea.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '제련').length, 1);
    assert.equal(list.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '제련').length, 0);

    await press('Soul Sword x5 선택');
    await press('제련 횟수 선택');
    await press('제련 100회');
    assert.equal(text().includes('100회'), true);
    await press('제련');
    assert.deepEqual(calls, [{ candidateId: 'soul', categoryCandidateId: 'category', refineCount: 100 }]);
  });

  it('radio 없는 품목은 표시하되 선택할 수 없고 작업장은 수량 10을 제한한다', async () => {
    await render(React.createElement(CraftingPanel, { api: api(async () => data('WORKBASE', { maxQuantity: 10 })), mode: 'workbase' }));

    assert.equal(button('재료 부족 선택 불가').props.disabled, true);
    assert.equal(text().includes('개당 제작 시간 600초'), true);
    await change('제작 수량', '11');
    assert.equal(button('작업 시작').props.disabled, true);
    assert.equal(text().includes('1~10 사이의 정수'), true);
  });

  it('클라리스의 재봉실은 교환 가능한 품목을 먼저 보여주고 상태를 구분한다', async () => {
    const claris = data('CLARIS', { rows: [
      { id: 'display', label: '재료 부족', selectable: false, detail: null, cost: 0, owned: null, workSeconds: null },
      { id: 'item', label: '교환 가능 의상', selectable: true, detail: '천 x1', cost: 100, owned: 1, workSeconds: null },
    ] });
    await render(React.createElement(CraftingPanel, { api: api(async () => claris), mode: 'claris' }));

    const list = mounted!.root.find((node) => String(node.type) === 'FlatList');
    const statuses = mounted!.root.findAll((node) => String(node.type) === 'Text' && ['선택 가능', '선택 불가'].includes(node.children.join('')));
    assert.deepEqual(list.props.data.map((item: { id: string }) => item.id), ['recipe:item', 'recipe:display']);
    assert.deepEqual(statuses.map((node) => node.children.join('')), ['선택 가능', '선택 불가']);
  });

  it('제작 중에는 완료로 표현하지 않고 읽기 쉬운 남은 시간을 표시한다', async () => {
    const calls: Array<{ path: string; request: unknown }> = [];
    const work = data('WORKBASE', { activeJob: { label: '현재 장비를 제작 중입니다.', remainingSeconds: 60_925, completionAvailable: true } });
    await render(React.createElement(CraftingPanel, { api: api(async () => work, async (path, request) => { calls.push({ path, request }); return { ...work, activeJob: null, result: result() }; }), mode: 'workbase' }));

    assert.deepEqual(calls, []);
    assert.equal(text().includes('약 16시간 56분 후 제작 결과 확인 가능'), true);
    assert.equal(text().includes('60,925초'), false);
    assert.equal(text().includes('작업 완료'), false);
    await press('제작 상태 확인');
    assert.deepEqual(calls, [{ path: '/api/town/crafting/workbase/complete', request: {} }]);
    assert.ok(mounted!.root.find((node) => node.props.accessibilityLabel === '제작 진행 상태 알림'));
  });

  it('작업 중에는 빈 종류 선택기와 새 작업 목록을 숨기고 현재 작업만 표시한다', async () => {
    const work = data('WORKBASE', {
      categories: [],
      currentCategoryId: null,
      activeJob: { label: '제작 결과 확인 가능', remainingSeconds: null, completionAvailable: true },
    });
    await render(React.createElement(CraftingPanel, { api: api(async () => work), mode: 'workbase' }));

    assert.equal(mounted!.root.findAll((node) => node.props.accessibilityLabel === '제작 종류 선택').length, 0);
    assert.equal(mounted!.root.findAll((node) => node.props.accessibilityLabel === '제작품 선택').length, 0);
    assert.equal(mounted!.root.findAll((node) => node.props.accessibilityLabel === '작업 시작').length, 0);
    assert.equal(button('제작 결과 확인').props.disabled, false);
    assert.equal(text().includes('현재 작업이 끝난 뒤 새 작업을 선택할 수 있습니다.'), true);
  });

  it('제작공방은 추가 소재가 없어도 막지 않고 null로 제출한다', async () => {
    const calls: unknown[] = [];
    const createData = data('CREATE', { maxQuantity: 100, additionalMaterials: [] });
    await render(React.createElement(CraftingPanel, { api: api(async () => createData, async (_path, request) => { calls.push(request); return { ...createData, warningCode: 'NO_ADDITIONAL_MATERIAL', result: result() }; }), mode: 'create' }));

    await press('제작품 선택');
    await press('제작');
    assert.deepEqual(calls, [{ recipeCandidateId: 'item', categoryCandidateId: 'category', quantity: 1, additionalMaterialCandidateId: null }]);
    assert.equal(text().includes('추가 소재 없이 제작했습니다.'), true);
  });

  it('장로대장간은 횟수 선택 없이 항상 1회로 제련한다', async () => {
    const calls: unknown[] = [];
    const veteran = data('VETERAN', { allowedRefineCounts: [1, 2, 3] });
    await render(React.createElement(CraftingPanel, { api: api(async () => veteran, async (_path, request) => { calls.push(request); return { ...veteran, result: result() }; }), mode: 'veteran' }));

    assert.equal(mounted!.root.findAll((node) => node.props.accessibilityLabel === '제련 2회 선택').length, 0);
    assert.equal(text().includes('1회 고정'), true);
    await press('제작품 선택'); await press('제련');
    assert.deepEqual(calls, [{ candidateId: 'item', categoryCandidateId: 'category', refineCount: 1 }]);
  });

  it('분류 GET을 URL encoding하고 늦게 끝난 이전 분류 응답은 표시하지 않는다', async () => {
    const calls: string[] = [];
    const second = deferred<unknown>();
    const third = deferred<unknown>();
    const first = data('CREATE', { categories: [
      { id: 'category', label: '무기', current: true },
      { id: 'type:armor & rare', label: '방어구', current: false },
      { id: 'type:cloak', label: '외투', current: false },
    ] });
    await render(React.createElement(CraftingPanel, { api: api(async (path) => {
      calls.push(path);
      if (path.includes('armor')) return second.promise;
      if (path.includes('cloak')) return third.promise;
      return first;
    }), mode: 'create' }));

    assert.equal(text().includes('무기'), true);
    await press('제작품 선택');
    assert.equal(button('제작 수량').props.value, '1');
    await press('제작 종류 선택');
    const armor = button('방어구 분류');
    const cloak = button('외투 분류');
    await act(async () => armor.props.onPress());
    assert.equal(mounted!.root.findAll((node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === '제작 수량').length, 0, '종류를 바꾸면 이전 카드 선택을 해제한다');
    assert.equal((mounted!.root.find((node) => String(node.type) === 'FlatList').props.data as unknown[]).length, 0, '새 종류를 불러오는 동안 이전 목록을 숨긴다');
    await press('제작 종류 선택');
    await act(async () => cloak.props.onPress());
    assert.equal(button('제작').props.disabled, true);
    assert.equal(calls.includes('/api/town/crafting/create?categoryCandidateId=type%3Aarmor%20%26%20rare'), true);
    assert.equal(calls.includes('/api/town/crafting/create?categoryCandidateId=type%3Acloak'), true);

    await act(async () => second.resolve(data('CREATE', { rows: [{ ...first.rows[0], label: '늦은 방어구' }], currentCategoryId: 'type:armor & rare' })));
    assert.equal(text().includes('늦은 방어구'), false);
    await act(async () => third.resolve(data('CREATE', { rows: [{ ...first.rows[0], label: '외투 제작품' }], currentCategoryId: 'type:cloak' })));
    assert.equal(text().includes('외투 제작품'), true);
  });

  it('Hall of Pain 버튼은 제작 목록을 펼치지 않고 별도 기록 화면을 연다', async () => {
    const createData = data('CREATE', {
      additionalMaterials: [{ id: 'material', label: 'Power Sphere', selectable: true, owned: 3, detail: '성공률 증가' }],
      history: Array.from({ length: 200 }, (_, index) => `제작 기록 ${index + 1}`),
    });
    await render(React.createElement(CraftingPanel, { api: api(async () => createData), mode: 'create' }));

    assert.equal(mounted!.root.findAll((node) => String(node.type) === 'FlatList').length, 1);
    assert.equal(button('제작 설정 고정 영역').props.accessibilityLabel, '제작 설정 고정 영역');
    assert.equal((mounted!.root.find((node) => String(node.type) === 'FlatList').props.data as unknown[]).length, 2);
    await press('Hall of Pain 기록 보기');
    assert.equal(text().includes('Hall of Pain 기록'), true);
    const list = mounted!.root.find((node) => String(node.type) === 'FlatList');
    assert.equal(list.props.data.length, 200);
    assert.equal((list.props.data as Array<{ id: string }>).some((row) => row.id.startsWith('additional:')), false);
    assert.equal(mounted!.root.findAll((node) => String(node.type) === 'FlatList').length, 1);
    assert.equal(button('제작 기록 200').props.accessibilityRole, 'text');
    await press('제작 화면으로 돌아가기');
    assert.equal((mounted!.root.find((node) => String(node.type) === 'FlatList').props.data as unknown[]).length, 2);
  });

  it('제작물품을 검색하고 추가 소재 드롭다운에서는 하나만 선택해 제출한다', async () => {
    const calls: unknown[] = [];
    const createData = data('CREATE', {
      rows: [
        { id: 'sword', label: 'Soul Sword', selectable: true, detail: '검 재료', cost: 100, owned: 1, workSeconds: 600 },
        { id: 'cloak', label: 'Moon Cloak', selectable: true, detail: '달빛 천', cost: 200, owned: 1, workSeconds: 600 },
      ],
      additionalMaterials: [
        { id: 'power', label: 'Power Sphere', selectable: true, owned: 3, detail: '성공률 증가' },
        { id: 'luck', label: 'Luck Sphere', selectable: true, owned: 1, detail: '행운 증가' },
      ],
    });
    await render(React.createElement(CraftingPanel, { api: api(async () => createData, async (_path, request) => { calls.push(request); return { ...createData, result: result() }; }), mode: 'create' }));

    await change('제작물품 검색', '달빛');
    const list = mounted!.root.find((node) => String(node.type) === 'FlatList');
    assert.deepEqual((list.props.data as Array<{ id: string }>).map((row) => row.id), ['recipe:cloak']);
    await press('Moon Cloak 선택');
    await press('추가 소재 선택');
    await press('Power Sphere 추가 소재 선택');
    await press('추가 소재 선택');
    await press('Luck Sphere 추가 소재 선택');
    await press('제작');

    assert.deepEqual(calls, [{ recipeCandidateId: 'cloak', categoryCandidateId: 'category', quantity: 1, additionalMaterialCandidateId: 'luck' }]);
  });

  it('제작공방 수량은 선택 카드 아래에 표시하고 새 카드를 선택하면 이전 카드를 해제한다', async () => {
    const createData = data('CREATE', {
      maxQuantity: 100,
      rows: [
        { id: 'sword', label: 'Soul Sword', selectable: true, detail: '검 재료', cost: 100, owned: 1, workSeconds: 600 },
        { id: 'cloak', label: 'Moon Cloak', selectable: true, detail: '달빛 천', cost: 200, owned: 1, workSeconds: 600 },
      ],
    });
    await render(React.createElement(CraftingPanel, { api: api(async () => createData), mode: 'create' }));

    const quantityInputs = (root: ReactTestInstance) => root.findAll((node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === '제작 수량');
    assert.equal(quantityInputs(mounted!.root).length, 0);
    await press('Soul Sword 선택');
    const sword = button('Soul Sword 선택');
    const swordCard = sword.parent!;
    assert.equal(sword.props.accessibilityState.checked, true);
    assert.equal(quantityInputs(swordCard).length, 1);

    await press('Moon Cloak 선택');
    assert.equal(button('Soul Sword 선택').props.accessibilityState.checked, false);
    assert.equal(button('Moon Cloak 선택').props.accessibilityState.checked, true);
    assert.equal(quantityInputs(mounted!.root).length, 1);
  });

  it('계정 API가 바뀌면 이전 계정의 늦은 응답과 선택 상태를 폐기한다', async () => {
    const oldLoad = deferred<unknown>();
    const oldApi = api(async () => oldLoad.promise);
    const newApi = api(async () => data('WORKBASE', { rows: [{ ...data('WORKBASE').rows[0], label: '새 계정 품목' }] }));
    await render(React.createElement(CraftingPanel, { api: oldApi, mode: 'workbase' }));
    await act(async () => mounted!.update(React.createElement(CraftingPanel, { api: newApi, mode: 'workbase' })));
    await act(async () => { await Promise.resolve(); });
    assert.equal(text().includes('새 계정 품목'), true);
    await act(async () => oldLoad.resolve(data('WORKBASE', { rows: [{ ...data('WORKBASE').rows[0], label: '이전 계정 품목' }] })));
    assert.equal(text().includes('이전 계정 품목'), false);
  });

  it('카운트다운 종료 시 자동 요청하지 않고 사용자의 상태 확인만 GET한다', async () => {
    const paths: string[] = [];
    const work = data('WORKBASE', { activeJob: { label: '현재 장비를 제작 중입니다.', remainingSeconds: 0, completionAvailable: false } });
    await render(React.createElement(CraftingPanel, { api: api(async (path) => { paths.push(path); return work; }), mode: 'workbase' }));
    assert.deepEqual(paths, ['/api/town/crafting/workbase']);
    await press('제작 상태 확인');
    assert.deepEqual(paths, ['/api/town/crafting/workbase', '/api/town/crafting/workbase']);
  });

  it('실패하면 선택과 입력을 보존하고 확인 연타도 POST 한 번만 보낸다', async () => {
    const calls: unknown[] = [];
    const pending = deferred<unknown>();
    const work = data('WORKBASE', { maxQuantity: 10 });
    await render(React.createElement(CraftingPanel, { api: api(async () => work, async (_path, request) => { calls.push(request); return pending.promise; }), mode: 'workbase' }));
    await press('제작품 선택');
    await change('제작 수량', '7');
    await press('작업 시작');
    const confirm = mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '작업 시작').length > 0).at(-1)!;
    await act(async () => { const first = confirm.props.onPress(); const second = confirm.props.onPress(); await Promise.resolve(); assert.equal(second, undefined); void first; });
    assert.equal(calls.length, 1);
    await act(async () => pending.resolve(Promise.reject(new Error('제작 요청 실패'))));
    assert.equal(button('제작 수량').props.value, '7');
    assert.equal(button('제작품 선택').props.accessibilityState.checked, true);
    assert.equal(text().includes('제작 요청 실패'), true);
  });
});

function data(mode: 'WORKBASE' | 'CLARIS' | 'REFINE' | 'CREATE' | 'VETERAN', patch: Record<string, unknown> = {}) { return { mode, categories: [{ id: 'category', label: '무기', current: true }], currentCategoryId: 'category', rows: [{ id: 'item', label: '제작품', selectable: true, detail: '재료', cost: 100, owned: 1, workSeconds: 600 }, { id: 'display', label: '재료 부족', selectable: false, detail: null, cost: 0, owned: null, workSeconds: null }], minQuantity: 1, maxQuantity: 1, activeJob: null, allowedRefineCounts: [] as number[], additionalMaterials: [] as Array<{ id: string; label: string; selectable: boolean; owned: number | null; detail: string | null }>, additionalMaterialsOptional: mode === 'CREATE', warningCode: null as null | 'NO_ADDITIONAL_MATERIAL', history: [] as string[], result: null as null | ReturnType<typeof result>, ...patch }; }
function result() { return { status: 'SUCCESS' as const, messages: ['완료'], items: [], refreshRequired: true }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(node: React.ReactElement) { await act(async () => { mounted = create(node); }); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance { return mounted!.root.find((node) => node.props.accessibilityLabel === label); }
async function press(label: string) { await act(async () => button(label).props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function change(label: string, value: string) { await act(async () => button(label).props.onChangeText(value)); }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
