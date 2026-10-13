import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { makePartyPresetCatalogResource } from '../fixtures/partyPresetCatalog';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const openedLogs: string[] = [];
const reactNativeMock = {
  Linking: { openURL: async (url: string) => { openedLogs.push(url); } },
  ActivityIndicator: host('ActivityIndicator'), FlatList: (props: Record<string, unknown>) => React.createElement('FlatList', props, props.ListHeaderComponent as React.ReactNode, (props.data as Array<{ id: string }>).map((item) => React.createElement(React.Fragment, { key: item.id }, (props.renderItem as Function)({ item }))), props.ListFooterComponent as React.ReactNode),
  Modal: host('Modal'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), StyleSheet: { create: <T,>(styles: T) => styles }, Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader }; const original = loader._load;
loader._load = (request, parent, isMain) => { if (request === 'react-native') return reactNativeMock; if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }; if (request === 'expo-image') return { Image: host('Image') }; if (request.endsWith('/BattlePartyPresetPicker')) return { BattlePartyPresetPicker: host('BattlePartyPresetPicker') }; return original(request, parent, isMain); };
const { ColosseumPanel } = require('../../main/features/town/panels/ColosseumPanel') as typeof import('../../main/features/town/panels/ColosseumPanel');
const { FixedBottomActionHost } = require('../../main/components/FixedBottomAction') as typeof import('../../main/components/FixedBottomAction');
loader._load = original;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null; afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; openedLogs.length = 0; });

describe('ColosseumPanel', () => {
  it('상대 선택 없이 저장된 5인 팀과 랭킹을 표시한다', async () => {
    await render(React.createElement(ColosseumPanel, { api: api(async () => battle()), mode: 'battle' }));
    assert.equal(mounted!.root.findAll((node) => String(node.type) === 'BattlePartyPresetPicker').length, 1);
    assert.equal(buttons('1번 팀원 선택').length, 1);
    assert.equal(buttons('5번 팀원 선택').length, 1);
    assert.equal(button('Challenge').props.disabled, false);
    assert.equal(text().includes('NEAR 5 · 171위'), true);
    assert.equal(text().includes('팀원 5/5명 · 저장된 팀 5/5명'), true);
  });

  it('검색형 슬롯에서 변경한 5명을 저장할 때까지 도전을 막는다', async () => {
    const calls: unknown[] = []; const value = battle();
    await render(React.createElement(ColosseumPanel, { api: api(async () => value, async (path, request) => {
      calls.push({ path, request }); return { ...value, selectedTeam: (request as { fighterCandidateIds: string[] }).fighterCandidateIds };
    }), mode: 'battle' }));
    await press('5번 팀원 선택');
    const search = mounted!.root.find((n) => n.props.accessibilityLabel === '5번 팀원 검색');
    await act(async () => search.props.onChangeText('카즈'));
    await press('카즈 팀원 선택');
    assert.equal(button('Challenge').props.disabled, true);
    await press('팀 저장');
    assert.deepEqual(calls, [{ path: '/api/town/pvp/colosseum/team', request: { fighterCandidateIds: ['f1', 'f2', 'f3', 'f4', 'f6'] } }]);
    assert.equal(button('Challenge').props.disabled, false);
  });

  it('5명이 아니면 팀 저장과 도전을 허용하지 않는다', async () => {
    await render(React.createElement(ColosseumPanel, { api: api(async () => battle()), mode: 'battle' }));
    await press('5번 팀원 선택'); await press('선택 없음');
    assert.equal(text().includes('팀원 4/5명'), true);
    assert.equal(button('팀 저장').props.disabled, true);
    assert.equal(button('Challenge').props.disabled, true);
  });

  it('프리셋 캐릭터 ID를 HOF의 체크박스 후보 ID에 매핑한다', async () => {
    const calls: unknown[] = []; const value = battle();
    const preset = { id: 7, accountId: 1, name: '콜로세움', folderId: null, displayOrder: 0, isPrimary: false,
      members: [2, 3, 4, 5, 6].map((n, slotIndex) => ({ slotIndex, characterId: `c${n}`, patternSlot: 1 })), createdAt: '', updatedAt: '' };
    const partyPresetCatalog = makePartyPresetCatalogResource({ folders: [], presets: [preset] });
    await render(React.createElement(ColosseumPanel, { api: api(async () => value, async (path, request) => { calls.push({ path, request }); return value; }), mode: 'battle', partyPresetCatalog }));
    await act(async () => presetPicker().props.onSelectPreset(preset));
    assert.equal(text().includes('팀원 5/5명'), true);
    await press('팀 저장');
    assert.deepEqual(calls, [{ path: '/api/town/pvp/colosseum/team', request: { fighterCandidateIds: ['f2', 'f3', 'f4', 'f5', 'f6'] } }]);
  });

  it('Challenge는 빈 요청으로 한 번 제출하고 최신 랭킹과 직접 전투 결과를 표시한다', async () => {
    const calls: unknown[] = []; let loads = 0; const value = battle();
    await render(React.createElement(ColosseumPanel, { api: api(async () => {
      loads += 1; return { ...value, challengeAvailable: loads === 1, challengeNotice: loads > 1 ? 'Time left to Next : 0:00:30' : null };
    }, async (path, request) => { calls.push({ path, request }); return { ...value, fighters: [], selectedTeam: [], battleResult: result() }; }), mode: 'battle' }));
    await press('Challenge');
    assert.deepEqual(calls, [{ path: '/api/town/pvp/colosseum/challenge', request: {} }]);
    assert.equal(loads, 2);
    assert.equal(text().includes('공민이는 승리했다'), true);
    assert.equal(text().includes('남은 HP 59606/59606 · 생존자 5/5'), true);
    assert.equal(text().includes('총 데미지 268,716'), true);
    assert.equal(text().includes('Time left to Next : 0:00:30'), true);
    assert.equal(button('Challenge').props.disabled, true);
    const link = mounted!.root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '세부 전투 로그 보기');
    await act(async () => link.props.onPress());
    assert.deepEqual(openedLogs, ['https://hof.zerosic.com/?rlog=1234567890123456']);
  });

  it('결과 뒤 새로고침 GET이 실패해도 전투를 재전송하지 않고 결과를 남긴다', async () => {
    let loads = 0; let posts = 0;
    await render(React.createElement(ColosseumPanel, { api: api(async () => {
      if (++loads > 1) throw new Error('network'); return battle();
    }, async () => { posts += 1; return { ...battle(), battleResult: result() }; }), mode: 'battle' }));
    await press('Challenge');
    assert.equal(posts, 1);
    assert.equal(text().includes('공민이는 승리했다'), true);
    assert.equal(button('Challenge').props.disabled, true);
  });
  it('교환소 radio 없는 행은 표시하되 선택할 수 없다', async () => {
    await render(React.createElement(ColosseumPanel, { api: api(async () => shop()), mode: 'shop' }));
    const list = mounted!.root.find((node) => String(node.type) === 'FlatList');
    const statuses = mounted!.root.findAll((node) => String(node.type) === 'Text' && ['선택 가능', '선택 불가'].includes(node.children.join('')));
    assert.deepEqual(list.props.data.map((item: { id: string }) => item.id), ['s1', 'x']);
    assert.equal(statuses.length, 0);
    assert.equal(button('재료 부족 선택 불가').props.disabled, true);
  });

  it('교환은 확인 후 현재 category와 수량을 보낸다', async () => {
    const calls: unknown[] = []; const value = shop();
    await render(React.createElement(ColosseumPanel, { api: api(async () => value, async (path, request) => { calls.push({ path, request }); return value; }), mode: 'shop' }));
    await press('검투사의 검 선택'); const input = mounted!.root.find((n) => n.props.accessibilityLabel === '교환 수량'); await act(async () => input.props.onChangeText('2')); await press('교환');
    assert.deepEqual(calls, [{ path: '/api/town/pvp/colosseum-shop/trade', request: { candidateId: 's1', categoryCandidateId: 'all', quantity: 2 } }]);
  });
});

function battle() { return {
  fighters: Array.from({ length: 6 }, (_, index) => ({ id: `f${index + 1}`, characterId: `c${index + 1}`, label: index === 5 ? '카즈' : `전사${index + 1}`, detail: 'Lv.60', imageUrl: null, selected: index < 5 })),
  selectedTeam: ['f1', 'f2', 'f3', 'f4', 'f5'], minTeamSize: 5, maxTeamSize: 5,
  topRankings: [{ rank: '1위', teams: ['상위팀'] }], nearRankings: [{ rank: '171위', teams: ['내팀'] }],
  teamSaveAvailable: true, challengeAvailable: true, challengeNotice: null, battleResult: null, result: null,
}; }
function result() { return { turns: 16, winner: '공민이', summary: '공민이는 승리했다',
  teams: [{ label: null, hp: '0/28480', survivors: '0/5', totalDamage: 0 }, { label: null, hp: '59606/59606', survivors: '5/5', totalDamage: 268716 }],
  reward: '승리의 증표 1개', detailUrl: 'https://hof.zerosic.com/?rlog=1234567890123456' }; }
function shop() { return { categories: [{ id: 'all', label: '전부', current: true }], currentCategoryId: 'all', items: [{ id: 'x', label: '재료 부족', selectable: false, detail: null, cost: 0, owned: 0 }, { id: 's1', label: '검투사의 검', selectable: true, detail: '초록 증표 15개', cost: 0, owned: 1 }], currencies: [{ label: '초록 증표', quantity: 250 }], result: null }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(element: React.ReactElement) { await act(async () => { mounted = create(React.createElement(FixedBottomActionHost, null, element)); await Promise.resolve(); await Promise.resolve(); }); }
function buttons(label: string) { return mounted!.root.findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label); }
function button(label: string) { const found = buttons(label); assert.ok(found.length); return found[0]; }
function presetPicker() { return mounted!.root.find((node) => String(node.type) === 'BattlePartyPresetPicker'); }
async function press(label: string) { await act(async () => { button(label).props.onPress(); await Promise.resolve(); await Promise.resolve(); }); }
function text() { return mounted!.root.findAll((n) => String(n.type) === 'Text').map((n: ReactTestInstance) => n.children.join('')).join('\n'); }
