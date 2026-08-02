import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'), FlatList: (props: Record<string, unknown>) => React.createElement('FlatList', props, props.ListHeaderComponent as React.ReactNode, (props.data as Array<{ id: string }>).map((item) => React.createElement(React.Fragment, { key: item.id }, (props.renderItem as Function)({ item }))), props.ListFooterComponent as React.ReactNode),
  Modal: host('Modal'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), StyleSheet: { create: <T,>(styles: T) => styles }, Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader }; const original = loader._load;
loader._load = (request, parent, isMain) => { if (request === 'react-native') return reactNativeMock; if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }; if (request === 'expo-image') return { Image: host('Image') }; if (request.endsWith('/BattlePartyPresetPicker')) return { BattlePartyPresetPicker: host('BattlePartyPresetPicker') }; return original(request, parent, isMain); };
const { ColosseumPanel } = require('../../main/features/town/panels/ColosseumPanel') as typeof import('../../main/features/town/panels/ColosseumPanel'); loader._load = original;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null; afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; });

describe('ColosseumPanel', () => {
  it('저장된 팀을 5개 검색형 슬롯으로 표시하고 Set Team 요청을 보낸다', async () => {
    const calls: unknown[] = []; const value = battle();
    await render(React.createElement(ColosseumPanel, { api: api(async () => value, async (path, request) => { calls.push({ path, request }); return value; }), mode: 'battle' }));
    assert.equal(mounted!.root.findAll((node) => String(node.type) === 'BattlePartyPresetPicker').length, 0);
    await press('라이벌 선택');
    await act(async () => presetPicker().props.onSelectDirect());
    assert.equal(buttons('1번 팀원 선택').length, 1); assert.equal(buttons('5번 팀원 선택').length, 1);
    await press('1번 팀원 선택'); await press('공민이 팀원 선택'); await press('2번 팀원 선택');
    const search = mounted!.root.find((n) => n.props.accessibilityLabel === '2번 팀원 검색');
    await act(async () => search.props.onChangeText('카즈'));
    assert.equal(button('카즈 팀원 선택').props.accessibilityState.selected, false);
    await press('카즈 팀원 선택'); await press('팀 저장'); await pressLast('팀 저장');
    assert.deepEqual(calls, [{ path: '/api/town/pvp/colosseum/team', request: { fighterCandidateIds: ['f1', 'f2'] } }]);
  });

  it('상대를 선택한 뒤 프리셋 멤버를 콜로세움 팀 후보에 맞춰 채운다', async () => {
    const calls: unknown[] = []; const value = battle();
    const preset = { id: 7, accountId: 1, name: '콜로세움', folderId: null, displayOrder: 0, isPrimary: false, members: [{ slotIndex: 0, characterId: 'f2', patternSlot: 1 }, { slotIndex: 1, characterId: 'missing', patternSlot: 1 }, { slotIndex: 2, characterId: 'f1', patternSlot: 1 }], createdAt: '', updatedAt: '' };
    const partyPresetCatalog = { catalog: { folders: [], presets: [preset] }, loading: false, error: null, retry: () => undefined };
    await render(React.createElement(ColosseumPanel, { api: api(async () => value, async (path, request) => { calls.push({ path, request }); return value; }), mode: 'battle', partyPresetCatalog }));
    await press('라이벌 선택');
    await act(async () => presetPicker().props.onSelectPreset(preset));
    assert.equal(text().includes('카즈'), true);
    assert.equal(text().includes('팀원 2/5명'), true);
    await press('팀 저장'); await pressLast('팀 저장');
    assert.deepEqual(calls, [{ path: '/api/town/pvp/colosseum/team', request: { fighterCandidateIds: ['f2', 'f1'] } }]);
  });

  it('Challenge는 팀 payload 없이 상대 id만 보내고 결과를 같은 화면에 표시한다', async () => {
    const calls: unknown[] = []; const value = battle(); const next = { ...battle(), battleResult: result() };
    await render(React.createElement(ColosseumPanel, { api: api(async () => value, async (path, request) => { calls.push({ path, request }); return next; }), mode: 'battle' }));
    assert.equal(button('라이벌 선택').props.accessibilityRole, 'radio');
    await press('라이벌 선택');
    await act(async () => presetPicker().props.onSelectDirect());
    assert.ok(text().indexOf('Challenge') < text().indexOf('콜로세움 팀'));
    await press('Challenge'); await pressLast('Challenge');
    assert.deepEqual(calls, [{ path: '/api/town/pvp/colosseum/challenge', request: { opponentCandidateId: 'o1' } }]);
    assert.equal(text().includes('공민이는 승리했다'), true); assert.equal(text().includes('내 상태 5/5 · 상대 상태 0/5'), true); assert.equal(text().includes('전투 상세 펼치기'), true);
  });

  it('교환소 radio 없는 행은 표시하되 선택할 수 없다', async () => {
    await render(React.createElement(ColosseumPanel, { api: api(async () => shop()), mode: 'shop' }));
    assert.equal(button('재료 부족 선택 불가').props.disabled, true); assert.equal(mounted!.root.findAll((n) => String(n.type) === 'FlatList').length, 1);
  });

  it('교환은 확인 후 현재 category와 수량을 보낸다', async () => {
    const calls: unknown[] = []; const value = shop();
    await render(React.createElement(ColosseumPanel, { api: api(async () => value, async (path, request) => { calls.push({ path, request }); return value; }), mode: 'shop' }));
    await press('검투사의 검 선택'); const input = mounted!.root.find((n) => n.props.accessibilityLabel === '교환 수량'); await act(async () => input.props.onChangeText('2')); await press('교환'); await pressLast('교환');
    assert.deepEqual(calls, [{ path: '/api/town/pvp/colosseum-shop/trade', request: { candidateId: 's1', categoryCandidateId: 'all', quantity: 2 } }]);
  });
});

function battle() { return { fighters: [{ id: 'f1', label: '공민이', detail: 'Lv.60', imageUrl: null, selected: true }, { id: 'f2', label: '카즈', detail: 'Lv.60', imageUrl: null, selected: false }], selectedTeam: ['f1'], minTeamSize: 1, maxTeamSize: 5, opponents: [{ id: 'o1', label: '라이벌', detail: '1위' }], battleResult: null, result: null }; }
function result() { return { turns: 12, winner: '공민이', summary: '공민이는 승리했다', playerHp: '1/10', opponentHp: '0/10', playerStatus: '5/5', opponentStatus: '0/5', totalDamage: 1936, reward: '승리의 증표 1개', detail: [{ turn: 1, text: '공격했다' }] }; }
function shop() { return { categories: [{ id: 'all', label: '전부', current: true }], currentCategoryId: 'all', items: [{ id: 's1', label: '검투사의 검', selectable: true, detail: '초록 증표 15개', cost: 0, owned: 1 }, { id: 'x', label: '재료 부족', selectable: false, detail: null, cost: 0, owned: 0 }], currencies: [{ label: '초록 증표', quantity: 250 }], result: null }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(element: React.ReactElement) { await act(async () => { mounted = create(element); await Promise.resolve(); await Promise.resolve(); }); }
function buttons(label: string) { return mounted!.root.findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label); }
function button(label: string) { const found = buttons(label); assert.ok(found.length); return found[0]; }
function presetPicker() { return mounted!.root.find((node) => String(node.type) === 'BattlePartyPresetPicker'); }
async function press(label: string) { await act(async () => { button(label).props.onPress(); await Promise.resolve(); await Promise.resolve(); }); }
async function pressLast(label: string) { await act(async () => { const found = mounted!.root.findAll((n) => String(n.type) === 'Pressable' && (n.props.accessibilityLabel === label || nodeText(n) === label)); assert.ok(found.length); found[found.length - 1].props.onPress(); await Promise.resolve(); await Promise.resolve(); }); }
function text() { return mounted!.root.findAll((n) => String(n.type) === 'Text').map((n: ReactTestInstance) => n.children.join('')).join('\n'); }
function nodeText(node: ReactTestInstance): string { return node.children.map((child) => typeof child === 'string' ? child : nodeText(child)).join(''); }
