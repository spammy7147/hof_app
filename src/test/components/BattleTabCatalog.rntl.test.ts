import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, it } from 'node:test';
import React from 'react';
import type { BattleMapResponse } from '../../main/types/api';
import { makeBattleResource } from '../fixtures/battleResource';
import { makePartyPresetCatalogResource } from '../fixtures/partyPresetCatalog';

const host = (name: string) => (props: Record<string, any>) => React.createElement(name, {
  ...props, accessible: props.accessible ?? (name === 'Pressable' ? true : undefined),
}, props.children);
const View = host('View');
const rn = {
  Platform: { OS: 'ios' }, View, Text: host('Text'), Pressable: host('Pressable'), ActivityIndicator: host('ActivityIndicator'),
  FlatList: ({ data, renderItem, ListHeaderComponent, ...props }: Record<string, any>) => React.createElement('View', props,
    ListHeaderComponent, data.map((item: any, index: number) => React.createElement(React.Fragment, { key: item.key }, renderItem({ item, index })))),
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (styles: any) => Array.isArray(styles) ? Object.assign({}, ...styles.filter(Boolean)) : styles },
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const original = loader._load;
loader._load = (request, parent, isMain) => {
  if (request === 'react-native') return rn;
  if (request === 'lucide-react-native') return new Proxy({}, { get: () => View });
  if (request.endsWith('/BattleRunPanel')) return { BattleRunPanel: () => React.createElement(rn.Text, null, '전투 설정') };
  return original(request, parent, isMain);
};
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { BattleTabScreen } = require('../../main/screens/BattleTabScreen') as typeof import('../../main/screens/BattleTabScreen');
const { BackendApiClient } = require('../../main/services/backendApi') as typeof import('../../main/services/backendApi');
const { useBattleResource } = require('../../main/features/battle/useBattleResource') as typeof import('../../main/features/battle/useBattleResource');
const { authenticatedHttp, jsonResponse } = require('../fixtures/authenticatedHttp') as typeof import('../fixtures/authenticatedHttp');
loader._load = original;
const originalFetch = globalThis.fetch;
afterEach(async () => { await rntl.cleanup(); globalThis.fetch = originalFetch; });

const first: BattleMapResponse = {
  categoryId: 'battle_map', mapCode: 'first', name: '첫 맵', groupName: '원본 지역', groupOrder: 1, mapOrder: 0,
  recommendedLevel: null, availableCount: null, attemptCount: null, winCount: null,
  cooldownRemainingText: null, cooldownRemainingSeconds: null, keyMode: 'NOT_REQUIRED', keyCount: null,
  requiredTime: 10, supportsThreeBattles: false, enabled: true, resolved: true, iconUrl: null, rawHref: '?common=first',
};
const second = { ...first, mapCode: 'second', name: '둘째 맵', mapOrder: 1 };
function props(loadMaps: (id: string) => Promise<BattleMapResponse[]>, loadMapCatalog = async () => [first, second]) {
  return {
    authenticated: true,
    battle: makeBattleResource({ categories: [{ id: 'battle_map', label: '전투맵', description: '', order: 1, enabled: true }], loadMaps, loadMapCatalog }),
    characters: [], partyPresetCatalog: makePartyPresetCatalogResource({ folders: [], presets: [] }),
  };
}
const mapButton = (name: string, disabled: boolean) => rntl.screen.getByRole('button', { name: new RegExp(name), disabled });
async function openMaps() {
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /전투맵/ }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /원본 지역/ }));
}

it('조회 중에도 저장된 맵을 보여주고 사라진 맵의 위치를 유지하며 선택을 막는다', async () => {
  let complete!: (maps: BattleMapResponse[]) => void;
  const pending = new Promise<BattleMapResponse[]>((resolve) => { complete = resolve; });
  await rntl.render(React.createElement(BattleTabScreen, props(() => pending)));
  await openMaps();
  assert.ok(mapButton('첫 맵', true));
  assert.ok(mapButton('둘째 맵', true));
  await rntl.fireEvent.press(mapButton('둘째 맵', true));
  assert.equal(rntl.screen.queryByText('전투 설정'), null);

  await rntl.act(() => complete([second]));
  assert.ok(mapButton('첫 맵', true));
  assert.ok(mapButton('둘째 맵', false));
  const names = rntl.screen.getAllByRole('button').map((button) => rntl.within(button).queryByText(/^(첫 맵|둘째 맵)$/)?.props.children).filter(Boolean);
  assert.deepEqual(names, ['첫 맵', '둘째 맵']);
  await rntl.fireEvent.press(mapButton('둘째 맵', false));
  assert.ok(rntl.screen.getByText('전투 설정'));
});

it('최신 조회에 실패해도 기존 맵을 유지하고 다시 확인하기 전에는 선택할 수 없다', async () => {
  let calls = 0;
  await rntl.render(React.createElement(BattleTabScreen, props(async () => {
    calls += 1;
    if (calls === 2) throw new Error('원본 조회 실패');
    return [first, second];
  })));
  await openMaps();
  await rntl.fireEvent.press(mapButton('첫 맵', false));
  assert.ok(rntl.screen.getByText('전투 설정'));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /전투맵/ }));
  await openMaps();
  assert.ok(rntl.screen.getByText('원본 조회 실패'));
  assert.ok(mapButton('첫 맵', true));
  assert.ok(mapButton('둘째 맵', true));
  assert.equal(rntl.screen.queryByText('전투 설정'), null);
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '다시 시도' }));
  assert.ok(mapButton('첫 맵', false));
  assert.equal(calls, 3);
});

it('늦게 도착한 카탈로그는 먼저 확인된 최신 상태를 덮어쓰지 않는다', async () => {
  let completeCatalog!: (maps: BattleMapResponse[]) => void;
  const pending = new Promise<BattleMapResponse[]>((resolve) => { completeCatalog = resolve; });
  await rntl.render(React.createElement(BattleTabScreen, props(async () => [second], () => pending)));
  await openMaps();
  assert.ok(mapButton('둘째 맵', false));
  await rntl.act(() => completeCatalog([first, { ...second, enabled: false }]));
  assert.ok(mapButton('첫 맵', true));
  assert.ok(mapButton('둘째 맵', false));
});

it('이전 상태 조회가 늦게 끝나도 최신 조회에서 사라진 맵을 다시 선택 가능하게 만들지 않는다', async () => {
  const completions: Array<(maps: BattleMapResponse[]) => void> = [];
  await rntl.render(React.createElement(BattleTabScreen, props(() => new Promise((resolve) => completions.push(resolve)))));
  await openMaps();
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /전투맵/ }));
  await openMaps();
  await rntl.act(() => completions[1]([]));
  assert.ok(mapButton('둘째 맵', true));
  await rntl.act(() => completions[0]([second]));
  assert.ok(mapButton('둘째 맵', true));
});

const categories = [{ id: 'battle_map', label: '전투맵', description: '', order: 1, enabled: true }];
const catalogPath = '/api/battle/categories/battle_map/maps/catalog';
const availabilityPath = '/api/battle/categories/battle_map/maps/availability';
function realResourceHarness(client: import('../../main/services/backendApi').BackendApiClient, assertActiveGeneration = () => undefined) {
  let resource!: ReturnType<typeof useBattleResource>;
  const options = { api: client, assertActiveGeneration, describeError: (error: unknown) => String(error), waitForCaptchaResolution: async () => undefined };
  function Harness({ show = true }: { show?: boolean }) {
    resource = useBattleResource(options);
    return show ? React.createElement(BattleTabScreen, { ...props(async () => []), battle: resource }) : null;
  }
  return { Harness, resource: () => resource };
}

it('실제 HTTP 재진입은 카탈로그를 보존하고 공유 중인 확인이 끝나야 맵을 선택한다', async () => {
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { complete = resolve; });
  const { client, requests } = await authenticatedHttp(async ({ path }) => {
    if (path === catalogPath) return jsonResponse([first]);
    if (path === availabilityPath) return pending;
    assert.equal(path, '/api/battle/categories'); return jsonResponse(categories);
  });
  const { Harness, resource } = realResourceHarness(client);
  try {
    await rntl.render(React.createElement(Harness));
    await openMaps();
    assert.ok(mapButton('첫 맵', true));
    await rntl.fireEvent.press(mapButton('첫 맵', true));
    assert.equal(rntl.screen.queryByText('전투 설정'), null);
    await rntl.screen.rerender(React.createElement(Harness, { show: false }));
    await rntl.screen.rerender(React.createElement(Harness));
    await openMaps();
    assert.ok(mapButton('첫 맵', true));
    const a = resource().loadMaps('battle_map'); const b = resource().loadMaps('battle_map');
    assert.equal(requests.filter(({ path }) => path === catalogPath).length, 1);
    assert.equal(requests.filter(({ path }) => path === availabilityPath).length, 1);
    await rntl.act(async () => { complete(jsonResponse([first])); await Promise.all([a, b]); });
    assert.ok(mapButton('첫 맵', false));
    await rntl.fireEvent.press(mapButton('첫 맵', false));
    assert.ok(rntl.screen.getByText('전투 설정'));
  } finally { client.dispose(); }
});

it('실제 HTTP availability 뒤 도착한 카탈로그도 최신 가능 상태를 덮어쓰지 않는다', async () => {
  let completeCatalog!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { completeCatalog = resolve; });
  const { client, requests } = await authenticatedHttp(async ({ path }) => {
    if (path === catalogPath) return pending;
    if (path === availabilityPath) return jsonResponse([second]);
    assert.equal(path, '/api/battle/categories'); return jsonResponse(categories);
  });
  const { Harness } = realResourceHarness(client);
  try {
    await rntl.render(React.createElement(Harness));
    await openMaps();
    assert.ok(mapButton('둘째 맵', false));
    await rntl.act(() => completeCatalog(jsonResponse([first, { ...second, enabled: false }])));
    assert.ok(mapButton('첫 맵', true)); assert.ok(mapButton('둘째 맵', false));
    assert.equal(requests.filter(({ path }) => path === catalogPath).length, 1);
    assert.equal(requests.filter(({ path }) => path === availabilityPath).length, 1);
  } finally { client.dispose(); }
});

it('실제 HTTP 빈 카탈로그에서 발견한 맵은 재진입 때 표시하고 최신 부재에는 선택을 막는다', async () => {
  const completions: Array<(response: Response) => void> = [];
  const { client, requests } = await authenticatedHttp(async ({ path }) => {
    if (path === catalogPath) return jsonResponse([]);
    if (path === availabilityPath) return new Promise((resolve) => completions.push(resolve));
    assert.equal(path, '/api/battle/categories'); return jsonResponse(categories);
  });
  const { Harness } = realResourceHarness(client);
  try {
    await rntl.render(React.createElement(Harness));
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /전투맵/ }));
    assert.equal(rntl.screen.queryByRole('button', { name: /첫 맵/ }), null);
    await rntl.act(() => completions[0](jsonResponse([first])));
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /원본 지역/ }));
    assert.ok(mapButton('첫 맵', false));
    await rntl.screen.rerender(React.createElement(Harness, { show: false }));
    await rntl.screen.rerender(React.createElement(Harness));
    await openMaps();
    assert.ok(mapButton('첫 맵', true));
    await rntl.act(() => completions[1](jsonResponse([])));
    assert.ok(mapButton('첫 맵', true));
    await rntl.fireEvent.press(mapButton('첫 맵', true));
    assert.equal(rntl.screen.queryByText('전투 설정'), null);
    assert.equal(requests.filter(({ path }) => path === catalogPath).length, 1);
    assert.equal(requests.filter(({ path }) => path === availabilityPath).length, 2);
  } finally { client.dispose(); }
});

it('실제 HTTP 이전 계정의 늦은 맵 응답은 새 계정의 표시·선택 상태에 섞이지 않는다', async () => {
  let activeA = true;
  let completeA!: (response: Response) => void;
  let completeB!: (response: Response) => void;
  const pendingA = new Promise<Response>((resolve) => { completeA = resolve; });
  const pendingB = new Promise<Response>((resolve) => { completeB = resolve; });
  const a = await authenticatedHttp(async ({ path }) => {
    if (path === catalogPath) return jsonResponse([first]);
    if (path === availabilityPath) return pendingA;
    assert.equal(path, '/api/battle/categories'); return jsonResponse(categories);
  }, 'account-a');
  const A = realResourceHarness(a.client, () => { if (!activeA) throw new Error('종료한 로그인'); });
  let b: Awaited<ReturnType<typeof authenticatedHttp>> | undefined;
  try {
    await rntl.render(React.createElement(A.Harness, { key: 'a' }));
    await openMaps(); assert.ok(mapButton('첫 맵', true));
    activeA = false; a.client.dispose();
    b = await authenticatedHttp(async ({ path }) => {
      if (path === catalogPath) return jsonResponse([second]);
      if (path === availabilityPath) return pendingB;
      assert.equal(path, '/api/battle/categories'); return jsonResponse(categories);
    }, 'account-b');
    const B = realResourceHarness(b.client);
    await rntl.screen.rerender(React.createElement(B.Harness, { key: 'b' }));
    await openMaps();
    await rntl.act(() => completeA(jsonResponse([first])));
    assert.equal(rntl.screen.queryByRole('button', { name: /첫 맵/ }), null);
    assert.ok(mapButton('둘째 맵', true));
    await rntl.act(() => completeB(jsonResponse([second])));
    assert.ok(mapButton('둘째 맵', false));
    await rntl.fireEvent.press(mapButton('둘째 맵', false));
    assert.ok(rntl.screen.getByText('전투 설정'));
    assert.deepEqual(b.requests.map(({ path }) => path), ['/api/battle/categories', catalogPath, availabilityPath]);
  } finally { a.client.dispose(); b?.client.dispose(); }
});

it('맵 Retry-After 기한 전에는 재시도해도 transport를 다시 호출하지 않는다', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 0 });
  let calls = 0;
  const backend = new BackendApiClient('http://backend.test');
  globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ message: '원본 제한' }), { status: 503, headers: { 'Retry-After': '30' } }); };
  let resource!: ReturnType<typeof useBattleResource>;
  const assertActiveGeneration = () => undefined;
  const describeError = (error: unknown) => String(error);
  const waitForCaptchaResolution = async () => undefined;
  function Harness() { resource = useBattleResource({ api: backend, assertActiveGeneration, describeError, waitForCaptchaResolution }); return null; }
  await rntl.render(React.createElement(Harness));
  await assert.rejects(resource.loadMaps('battle_map'));
  await assert.rejects(resource.loadMaps('battle_map'));
  assert.equal(calls, 1);
  context.mock.timers.setTime(30_001);
  await assert.rejects(resource.loadMaps('battle_map'));
  assert.equal(calls, 2);
});

it('통계와 로그의 표시 자료는 조건별로 구분하고 전투 변경에 무효화한다', async () => {
  const http = await authenticatedHttp(async (request) => {
    if (request.path.startsWith('/api/battle/stats')) return jsonResponse({ dailyFunds: 123, adventureMapOutcomes: [] });
    if (request.path.startsWith('/api/battle/logs')) return jsonResponse([{ id: 7 }]);
    return jsonResponse({ message: '원본 변경 실패' }, 500);
  });
  const api = http.client;
  let resource!: ReturnType<typeof useBattleResource>;
  function Harness() {
    resource = useBattleResource({ api, assertActiveGeneration: () => undefined,
      describeError: String, waitForCaptchaResolution: async () => undefined });
    return null;
  }
  await rntl.render(React.createElement(Harness));
  await resource.loadStats('DAY', '2026-11-05');
  await resource.loadLogs({ outcome: 'VICTORY', offset: 0, limit: 40 });
  assert.equal(resource.peekStats('DAY', '2026-11-05')?.dailyFunds, 123);
  assert.equal(resource.peekStats('DAY', '2026-11-04'), null);
  assert.equal(resource.peekLogs({ outcome: 'DEFEAT', offset: 0, limit: 40 }), null);
  assert.equal(resource.peekLogs({ limit: 40, offset: 0, outcome: 'VICTORY' })?.length, 1);
  await resource.run({ categoryId: 'battle_map', mapCode: 'first' } as Parameters<typeof resource.run>[0]).catch(() => undefined);
  assert.equal(resource.peekStats('DAY', '2026-11-05'), null);
  assert.equal(resource.peekLogs({ outcome: 'VICTORY', offset: 0, limit: 40 }), null);
});

it('같은 통계의 진행 중 읽기를 공유하고 무효화 뒤 늦은 응답은 새 표시 자료를 덮지 않는다', async () => {
  const pending: Array<(response: Response) => void> = [];
  const { client, requests } = await authenticatedHttp(async () => new Promise<Response>((resolve) => pending.push(resolve)));
  const { Harness, resource } = realResourceHarness(client);
  await rntl.render(React.createElement(Harness, { show: false }));
  const firstRead = resource().loadStats();
  const secondRead = resource().loadStats();
  assert.equal(requests.length, 1);
  pending.shift()!(jsonResponse({ dailyFunds: 10 }));
  await Promise.all([firstRead, secondRead]);
  resource().invalidateDisplays();
  const old = resource().loadStats();
  const discard = assert.rejects(old, /이전 조회/);
  resource().invalidateDisplays();
  const latest = resource().loadStats();
  pending[1](jsonResponse({ dailyFunds: 30 })); await latest;
  pending[0](jsonResponse({ dailyFunds: 20 })); await discard;
  assert.equal(resource().peekStats()?.dailyFunds, 30);
  client.dispose();
});

it('통계 표시 읽기도 서버 Retry-After 동안 같은 조건의 원본 호출을 반복하지 않는다', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 0 });
  const { client, requests } = await authenticatedHttp(async () => new Response('{}', {
    status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
  }));
  const { Harness, resource } = realResourceHarness(client);
  await rntl.render(React.createElement(Harness, { show: false }));
  await assert.rejects(resource().loadStats());
  await assert.rejects(resource().loadStats());
  assert.equal(requests.length, 1);
  await assert.rejects(resource().loadStats('DAY', '2026-11-04'));
  assert.equal(requests.length, 2, '다른 조건은 독립된 읽기');
  context.mock.timers.setTime(30_001);
  await assert.rejects(resource().loadStats());
  assert.equal(requests.length, 3);
  client.dispose();
});
