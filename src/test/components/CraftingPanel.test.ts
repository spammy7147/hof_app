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
const { CraftingPanel } = require('../../main/features/town/panels/CraftingPanel') as typeof import('../../main/features/town/panels/CraftingPanel'); moduleWithLoader._load = originalLoad;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null; afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; });

describe('CraftingPanel', () => {
  it('radio 없는 품목은 표시하되 선택할 수 없고 작업장은 수량 10을 제한한다', async () => {
    await render(React.createElement(CraftingPanel, { api: api(async () => data('WORKBASE', { maxQuantity: 10 })), mode: 'workbase' }));

    assert.equal(button('재료 부족 선택 불가').props.disabled, true);
    assert.equal(text().includes('개당 제작 시간 600초'), true);
    await change('제작 수량', '11');
    assert.equal(button('작업 시작').props.disabled, true);
    assert.equal(text().includes('1~10 사이의 정수'), true);
  });

  it('작업 완료는 자동 요청하지 않고 사용자가 확인한 뒤 한 번만 제출한다', async () => {
    const calls: Array<{ path: string; request: unknown }> = [];
    const work = data('WORKBASE', { activeJob: { label: '현재 장비를 제작 중입니다.', remainingSeconds: 2974, completionAvailable: true } });
    await render(React.createElement(CraftingPanel, { api: api(async () => work, async (path, request) => { calls.push({ path, request }); return { ...work, activeJob: null, result: result() }; }), mode: 'workbase' }));

    assert.deepEqual(calls, []);
    assert.equal(text().includes('2,974초 후 확인 가능'), true);
    await press('제작 완료');
    assert.deepEqual(calls, []);
    await pressLast('제작 완료');
    assert.deepEqual(calls, [{ path: '/api/town/crafting/workbase/complete', request: {} }]);
  });

  it('제작공방은 추가 소재가 없어도 경고 확인 후 막지 않고 null로 제출한다', async () => {
    const calls: unknown[] = [];
    const createData = data('CREATE', { maxQuantity: 100, additionalMaterials: [] });
    await render(React.createElement(CraftingPanel, { api: api(async () => createData, async (_path, request) => { calls.push(request); return { ...createData, warningCode: 'NO_ADDITIONAL_MATERIAL', result: result() }; }), mode: 'create' }));

    await press('제작품 선택');
    await press('제작');
    assert.equal(text().includes('추가 소재 없이 제작합니다. 계속할까요?'), true);
    await pressLast('제작');
    assert.deepEqual(calls, [{ recipeCandidateId: 'item', categoryCandidateId: 'category', quantity: 1, additionalMaterialCandidateId: null }]);
    assert.equal(text().includes('추가 소재 없이 제작했습니다.'), true);
  });

  it('장로대장간은 서버가 허용한 제련 횟수만 선택해 보낸다', async () => {
    const calls: unknown[] = [];
    const veteran = data('VETERAN', { allowedRefineCounts: [1, 2, 3] });
    await render(React.createElement(CraftingPanel, { api: api(async () => veteran, async (_path, request) => { calls.push(request); return { ...veteran, result: result() }; }), mode: 'veteran' }));

    await press('제작품 선택'); await press('제련 3회 선택'); await press('제련'); await pressLast('제련');
    assert.deepEqual(calls, [{ candidateId: 'item', categoryCandidateId: 'category', refineCount: 3 }]);
  });
});

function data(mode: 'WORKBASE' | 'CLARIS' | 'REFINE' | 'CREATE' | 'VETERAN', patch: Record<string, unknown> = {}) { return { mode, categories: [{ id: 'category', label: '무기', current: true }], currentCategoryId: 'category', rows: [{ id: 'item', label: '제작품', selectable: true, detail: '재료', cost: 100, owned: 1, workSeconds: 600 }, { id: 'display', label: '재료 부족', selectable: false, detail: null, cost: 0, owned: null, workSeconds: null }], minQuantity: 1, maxQuantity: 1, activeJob: null, allowedRefineCounts: [] as number[], additionalMaterials: [] as Array<{ id: string; label: string; selectable: boolean; owned: number | null; detail: string | null }>, additionalMaterialsOptional: mode === 'CREATE', warningCode: null as null | 'NO_ADDITIONAL_MATERIAL', history: [] as string[], result: null as null | ReturnType<typeof result>, ...patch }; }
function result() { return { status: 'SUCCESS' as const, messages: ['완료'], items: [], refreshRequired: true }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(node: React.ReactElement) { await act(async () => { mounted = create(node); }); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance { return mounted!.root.find((node) => node.props.accessibilityLabel === label); }
async function press(label: string) { await act(async () => button(label).props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function pressLast(label: string) { const nodes = mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0); await act(async () => nodes.at(-1)!.props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function change(label: string, value: string) { await act(async () => button(label).props.onChangeText(value)); }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
