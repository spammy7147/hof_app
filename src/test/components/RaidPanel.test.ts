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
const { RaidPanel } = require('../../main/features/town/panels/RaidPanel') as typeof import('../../main/features/town/panels/RaidPanel'); moduleWithLoader._load = originalLoad;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null; afterEach(async () => { if (mounted) await act(async () => mounted?.unmount()); mounted = null; });

describe('RaidPanel', () => {
  it('서버가 관측한 raid action만 확인 후 한 번 제출하고 같은 패널에서 결과를 갱신한다', async () => {
    const calls: unknown[] = [];
    const data = raidData();
    await render(React.createElement(RaidPanel, { api: api(async () => data, async (_path, request) => { calls.push(request); return { ...data, result: result() }; }) }));
    assert.equal(button('전투 시작').length, 0);
    await press('등록');
    assert.deepEqual(calls, []);
    await pressLast('등록');
    assert.deepEqual(calls, [{ action: 'REGISTER', raidId: 'RaidGoblin' }]);
    assert.equal(text().includes('완료'), true);
  });

  it('raid_hunt에서 확인된 내가 참가한 raid만 기존 RAID 전투 화면으로 연결한다', async () => {
    const targets: unknown[] = [];
    await render(React.createElement(RaidPanel, { api: api(async () => raidData()), onOpenBattle: (target) => targets.push(target) }));
    await press('RAID 전투 화면 열기');
    assert.deepEqual(targets, [{ categoryId: 'raid', mapCode: 'RaidGoblin' }]);
  });

  it('countdown은 로컬에서 표시하고 0에 도달할 때 GET을 한 번만 갱신한다', async () => {
    let loads = 0;
    await render(React.createElement(RaidPanel, { api: api(async () => { loads += 1; return raidData(loads === 1 ? 1 : null); }) }));
    assert.equal(loads, 1);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_150)); });
    await act(async () => { await Promise.resolve(); });
    assert.equal(loads, 2);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_050)); });
    assert.equal(loads, 2);
  });

  it('빠른 중복 확인은 POST를 한 번만 보낸다', async () => {
    const pending = deferred<unknown>(); let calls = 0;
    await render(React.createElement(RaidPanel, { api: api(async () => raidData(), async () => { calls += 1; return pending.promise; }) }));
    await press('등록');
    const confirm = pressableWithText('등록');
    await act(async () => { confirm.props.onPress(); confirm.props.onPress(); await Promise.resolve(); });
    assert.equal(calls, 1);
    pending.resolve({ ...raidData(), result: result() });
    await act(async () => { await pending.promise; });
  });
});

function raidData(applyWaitSeconds: number | null = null) { return { raids: [{ id: 'RaidGoblin', name: '고블린 전투 마차', playable: true, difficulty: '평범 레벨 40', maxPartySize: 6, rewardDamage: '100000+', status: 'RECRUITING' as const, statusText: '모집 중', waitSeconds: null, applicants: ['공민이'], joined: true, actions: ['REGISTER' as const, 'LEAVE' as const], battleTarget: { categoryId: 'raid', mapCode: 'RaidGoblin' } }, { id: 'RaidTest', name: '시험 레이드', playable: false, difficulty: null, maxPartySize: null, rewardDamage: null, status: 'TESTING' as const, statusText: '신청 안됨', waitSeconds: null, applicants: [], joined: false, actions: [], battleTarget: null }], applied: true, applyWaitSeconds, myStatus: '신청 완료', globalActions: ['REFRESH' as const, 'REWARD' as const], result: null }; }
function result() { return { status: 'SUCCESS' as const, messages: ['완료'], items: [], refreshRequired: true }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(node: React.ReactElement) { await act(async () => { mounted = create(node); }); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance[] { return mounted!.root.findAll((node) => node.props.accessibilityLabel === label); }
async function press(label: string) { const node = button(label).at(-1); assert.ok(node, `missing ${label}`); await act(async () => node.props.onPress()); await act(async () => { await Promise.resolve(); }); }
async function pressLast(label: string) { const node = pressableWithText(label); await act(async () => node.props.onPress()); await act(async () => { await Promise.resolve(); }); }
function pressableWithText(label: string): ReactTestInstance { return mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0).at(-1)!; }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }
