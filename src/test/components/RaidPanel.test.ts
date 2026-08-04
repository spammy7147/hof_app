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
  it('서버가 관측한 raid action을 한 번 눌러 제출하고 같은 패널에서 결과를 갱신한다', async () => {
    const calls: unknown[] = [];
    const data = raidData();
    await render(React.createElement(RaidPanel, { api: api(async () => data, async (_path, request) => { calls.push(request); return { ...data, result: result() }; }) }));
    assert.equal(button('전투 시작').length, 1);
    assert.equal(button('전투 시작')[0]!.props.accessibilityState.disabled, true);
    await press('등록');
    assert.deepEqual(calls, [{ action: 'REGISTER', raidId: 'RaidGoblin' }]);
    assert.equal(text().includes('완료'), true);
  });

  it('공통 버튼 3개와 선택한 맵의 버튼 4개를 항상 표시하고 실행 가능 여부만 비활성화한다', async () => {
    await render(React.createElement(RaidPanel, { api: api(async () => raidData()) }));

    for (const label of ['갱신', '보상 확인', '대기 리셋']) assert.equal(button(label).length, 1);
    assert.equal(button('갱신')[0]!.props.accessibilityState.disabled, false);
    assert.equal(button('보상 확인')[0]!.props.accessibilityState.disabled, false);
    assert.equal(button('대기 리셋')[0]!.props.accessibilityState.disabled, true);

    for (const label of ['등록', '나오기', '전투 시작', '리셋']) assert.equal(button(label).length, 1);
    assert.equal(button('등록')[0]!.props.accessibilityState.disabled, false);
    assert.equal(button('나오기')[0]!.props.accessibilityState.disabled, false);
    assert.equal(button('전투 시작')[0]!.props.accessibilityState.disabled, true);
    assert.equal(button('리셋')[0]!.props.accessibilityState.disabled, true);
  });

  it('하단 버튼 한 세트가 현재 선택한 맵의 action과 raidId를 사용한다', async () => {
    const calls: unknown[] = [];
    const data = raidData();
    data.raids[1]!.playable = true;
    data.raids[1]!.actions = ['REGISTER'];
    await render(React.createElement(RaidPanel, { api: api(
      async () => data,
      async (_path, request) => { calls.push(request); return { ...data, result: result() }; },
    ) }));

    await press('시험 레이드 선택');
    assert.equal(button('등록')[0]!.props.accessibilityState.disabled, false);
    assert.equal(button('나오기')[0]!.props.accessibilityState.disabled, true);
    await press('등록');

    assert.deepEqual(calls, [{ action: 'REGISTER', raidId: 'RaidTest' }]);
  });

  it('raid_hunt에서 확인된 내가 참가한 raid만 기존 RAID 전투 화면으로 연결한다', async () => {
    const targets: unknown[] = [];
    await render(React.createElement(RaidPanel, { api: api(async () => raidData()), onOpenBattle: (target) => targets.push(target) }));
    await press('RAID 전투 화면 열기');
    assert.deepEqual(targets, [{ categoryId: 'raid', mapCode: 'RaidGoblin' }]);
  });

  it('참가하지 않았거나 RAID 카테고리가 아닌 battle target은 전투 CTA로 노출하지 않는다', async () => {
    const data = raidData();
    data.raids[0]!.joined = false;
    await render(React.createElement(RaidPanel, { api: api(async () => data), onOpenBattle: () => assert.fail('must not navigate') }));
    assert.equal(button('RAID 전투 화면 열기').length, 0);

    const invalidCategory = raidData();
    invalidCategory.raids[0]!.battleTarget = { categoryId: 'battle_map', mapCode: 'RaidGoblin' };
    await act(async () => mounted!.update(React.createElement(RaidPanel, { api: api(async () => invalidCategory), onOpenBattle: () => assert.fail('must not navigate') })));
    await act(async () => { await Promise.resolve(); });
    assert.equal(button('RAID 전투 화면 열기').length, 0);
  });

  it('countdown은 로컬에서 표시하고 0에 도달할 때 GET을 한 번만 갱신한다', async (context) => {
    context.mock.timers.enable({ apis: ['Date', 'setInterval'], now: new Date('2026-08-04T00:00:00Z') });
    let loads = 0;
    await render(React.createElement(RaidPanel, { api: api(async () => { loads += 1; return raidData(loads === 1 ? 1 : null); }) }));
    assert.equal(loads, 1);
    await act(async () => { context.mock.timers.tick(1_000); await Promise.resolve(); });
    assert.equal(loads, 2);
    await act(async () => { context.mock.timers.tick(1_000); await Promise.resolve(); });
    assert.equal(loads, 2);
  });

  it('남은 초를 파싱하지 못해도 applyWait 상태면 REGISTER를 안내하고 차단한다', async () => {
    let loads = 0; let submits = 0;
    await render(React.createElement(RaidPanel, { api: api(
      async () => ++loads === 1 ? raidData() : raidData(null, true),
      async () => { submits += 1; return raidData(); },
    ) }));
    await press('갱신');
    assert.equal(text().includes('남은 시간은 HOF에서 확인할 수 없습니다.'), true);
    assert.equal(button('등록')[0]!.props.accessibilityState.disabled, true);

    assert.equal(submits, 0);
    await press('등록');
  });

  it('빠른 중복 클릭은 POST를 한 번만 보낸다', async () => {
    const pending = deferred<unknown>(); let calls = 0;
    await render(React.createElement(RaidPanel, { api: api(async () => raidData(), async () => { calls += 1; return pending.promise; }) }));
    const action = button('등록').at(-1)!;
    await act(async () => { action.props.onPress(); action.props.onPress(); await Promise.resolve(); });
    assert.equal(calls, 1);
    pending.resolve({ ...raidData(), result: result() });
    await act(async () => { await pending.promise; });
  });

  it('action과 겹친 이전 갱신 응답이 같은 패널의 최신 결과를 덮어쓰지 않는다', async () => {
    const staleReload = deferred<unknown>(); let loads = 0;
    await render(React.createElement(RaidPanel, { api: api(
      async () => ++loads === 1 ? raidData() : staleReload.promise,
      async () => ({ ...raidData(), result: result() }),
    ) }));
    await press('등록');
    await press('갱신');
    assert.equal(text().includes('완료'), true);

    staleReload.resolve(raidData());
    await act(async () => { await staleReload.promise; await Promise.resolve(); });
    assert.equal(text().includes('완료'), true);
  });

  it('계정 API 변경 뒤 이전 계정의 확인과 늦은 action 완료를 폐기한다', async () => {
    const oldAction = deferred<unknown>(); let oldCalls = 0;
    const oldData = raidData(); oldData.raids[0]!.name = '이전 계정 레이드';
    const newData = raidData(); newData.raids[0]!.name = '새 계정 레이드';
    const oldApi = api(async () => oldData, async () => { oldCalls += 1; return oldAction.promise; });
    const newApi = api(async () => newData);
    await render(React.createElement(RaidPanel, { api: oldApi }));
    await press('등록');
    assert.equal(oldCalls, 1);

    await act(async () => mounted!.update(React.createElement(RaidPanel, { api: newApi })));
    await act(async () => { await Promise.resolve(); });
    assert.equal(text().includes('새 계정 레이드'), true);

    oldAction.resolve({ ...oldData, result: result('이전 계정 결과') });
    await act(async () => { await oldAction.promise; await Promise.resolve(); });
    assert.equal(text().includes('이전 계정 결과'), false);
    assert.equal(text().includes('새 계정 레이드'), true);
  });

  it('action 오류를 같은 패널에 표시한다', async () => {
    await render(React.createElement(RaidPanel, { api: api(async () => raidData(), async () => { throw new Error('레이드 요청 실패'); }) }));
    await press('등록');
    assert.equal(text().includes('레이드 요청 실패'), true);
  });
});

function raidData(applyWaitSeconds: number | null = null, applyWait = applyWaitSeconds != null) { return { raids: [{ id: 'RaidGoblin', name: '고블린 전투 마차', playable: true, difficulty: '평범 레벨 40', maxPartySize: 6, rewardDamage: '100000+', status: 'RECRUITING' as const, statusText: '모집 중', waitSeconds: null, applicants: ['공민이'], joined: true, actions: ['REGISTER' as const, 'LEAVE' as const], battleTarget: { categoryId: 'raid', mapCode: 'RaidGoblin' } }, { id: 'RaidTest', name: '시험 레이드', playable: false, difficulty: null, maxPartySize: null, rewardDamage: null, status: 'TESTING' as const, statusText: '신청 안됨', waitSeconds: null, applicants: [], joined: false, actions: [], battleTarget: null }], applied: true, applyWait, applyWaitSeconds, myStatus: '신청 완료', globalActions: ['REFRESH' as const, 'REWARD' as const], result: null }; }
function result(message = '완료') { return { status: 'SUCCESS' as const, messages: [message], items: [], refreshRequired: true }; }
function api(load: (path: string) => Promise<unknown>, submit: (path: string, request: unknown) => Promise<unknown> = async () => { throw new Error('unexpected'); }) { return { load, submit } as never; }
async function render(node: React.ReactElement) { await act(async () => { mounted = create(node); }); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance[] { return mounted!.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label); }
async function press(label: string) { const node = button(label).at(-1); assert.ok(node, `missing ${label}`); await act(async () => node.props.onPress()); await act(async () => { await Promise.resolve(); }); }
function text() { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }
