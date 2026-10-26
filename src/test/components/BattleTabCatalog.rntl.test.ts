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

it('로그인 resource가 panel 재생성 뒤 카탈로그를 보존하고 같은 availability를 공유한다', async () => {
  let catalogs = 0; let reads = 0;
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { complete = resolve; });
  let resource!: ReturnType<typeof useBattleResource>;
  const backend = new BackendApiClient('http://backend.test');
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/maps/catalog')) { catalogs += 1; return new Response(JSON.stringify([first])); }
    if (String(url).endsWith('/maps/availability')) { reads += 1; return pending; }
    return new Response(JSON.stringify([{ id: 'battle_map', label: '전투맵', description: '', order: 1, enabled: true }]));
  };
  const describeError = (error: unknown) => String(error);
  const assertActiveGeneration = () => undefined;
  const waitForCaptchaResolution = async () => undefined;
  function Harness({ show }: { show: boolean }) {
    resource = useBattleResource({ api: backend as never, describeError, assertActiveGeneration, waitForCaptchaResolution });
    return show ? React.createElement(BattleTabScreen, { ...props(async () => []), battle: resource }) : null;
  }
  await rntl.render(React.createElement(Harness, { show: true }));
  await rntl.screen.rerender(React.createElement(Harness, { show: false }));
  await rntl.screen.rerender(React.createElement(Harness, { show: true }));
  assert.equal(catalogs, 1);
  const a = resource.loadMaps('battle_map'); const b = resource.loadMaps('battle_map');
  assert.equal(reads, 1);
  complete(new Response(JSON.stringify([first])));
  await rntl.act(async () => { await Promise.all([a, b]); });
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
