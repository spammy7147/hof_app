import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  FlatList: (props: Record<string, unknown>) => {
    const data = props.data as Array<{ id: string }>;
    const renderItem = props.renderItem as (info: { item: { id: string } }) => React.ReactNode;
    return React.createElement('FlatList', props, data.map((item) => React.createElement(React.Fragment, { key: item.id }, renderItem({ item }))));
  },
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'expo-image') return { Image: host('Image') };
  return originalLoad(request, parent, isMain);
};
const { FishingPanel } = require('../../main/features/town/panels/FishingPanel') as typeof import('../../main/features/town/panels/FishingPanel');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null;
afterEach(async () => {
  if (mounted) await act(async () => mounted?.unmount());
  mounted = null;
});

describe('FishingPanel', () => {
  it('START에서 CATCH로 한 번씩만 수동 전환하고 보조 action은 자동 실행하지 않는다', async () => {
    const calls: string[] = [];
    const api = fakeApi({
      load: async () => fishing('START', ['START']),
      submit: async (path: string) => {
        calls.push(path);
        return fishing('CATCH', ['CATCH', 'STATUS', 'FILTER']);
      },
    });
    await render(React.createElement(FishingPanel, { api }));

    assert.equal(button('낚시를 시작한다').props.disabled, false);
    assert.deepEqual(calls, []);
    await press('낚시를 시작한다');

    assert.deepEqual(calls, ['/api/town/fishing/actions/START']);
    assert.ok(button('낚는다'));
    assert.ok(button('상태를 본다'));
    assert.ok(button('거른다'));
    assert.equal(calls.length, 1, 'polling이나 보조 action 자동 실행이 없어야 한다');
  });

  it('물고기 도망을 실패 화면이 아닌 다음 START 가능한 정상 상태로 표시한다', async () => {
    const escaped = { ...fishing('START', ['START']), lastOutcome: 'ESCAPED' as const };
    await render(React.createElement(FishingPanel, { api: fakeApi({ load: async () => escaped }) }));

    assert.ok(button('낚시를 시작한다'));
    assert.equal(allText().includes('물고기가 도망쳤습니다.'), true);
  });

  it('전투 중에는 낚시 버튼을 숨기고 전투 CTA만 연결한다', async () => {
    const opened: string[] = [];
    const battle = { ...fishing('NONE', []), blockedByBattle: true, battleLink: 'FISHING_BATTLE' };
    await render(React.createElement(FishingPanel, { api: fakeApi({ load: async () => battle }), onOpenBattle: (link: string) => opened.push(link) }));

    assert.equal(findButton('낚시를 시작한다'), null);
    assert.equal(findButton('낚는다'), null);
    await press('낚시 전투로 이동');
    assert.deepEqual(opened, [battle.battleLink]);
  });

  it('교환소에서 radio 없는 행을 보이되 선택할 수 없게 한다', async () => {
    const api = fakeApi({
      load: async () => ({
        items: [
          { id: 'rank', label: 'Rank Fish', selectable: true, detail: null, imageUrl: null, price: null, quantity: null },
          { id: 'display', label: '교환 불가', selectable: false, detail: null, imageUrl: null, price: null, quantity: null },
        ],
        result: null,
      }),
    });
    await render(React.createElement(FishingPanel, { api, mode: 'exchange' }));

    const unavailable = button('교환 불가 선택 불가');
    assert.equal(unavailable.props.disabled, true);
    assert.equal(allText().includes('교환 불가'), true);
  });
});

function fishing(primaryAction: 'START' | 'CATCH' | 'NONE', availableActions: string[]) {
  return {
    notice: null, remainingCasts: 17, waterStatus: '수면이 빛난다.', baitCount: 0, shiningBaitCount: 0,
    escapeSeconds: primaryAction === 'CATCH' ? 30 : null, combo: null, locationName: '일반 낚시터', primaryAction,
    availableActions, lastOutcome: null, blockedByBattle: false, battleLink: null, result: null,
  };
}

function fakeApi(handlers: { load: (path: string) => Promise<unknown>; submit?: (path: string, request: unknown) => Promise<unknown> }) {
  return {
    load: handlers.load,
    submit: handlers.submit ?? (async () => { throw new Error('unexpected submit'); }),
  } as never;
}

async function render(element: React.ReactElement) {
  await act(async () => { mounted = create(element); });
  await act(async () => { await Promise.resolve(); });
  return mounted;
}
async function press(label: string) { await act(async () => button(label).props.onPress()); await act(async () => { await Promise.resolve(); }); }
function button(label: string): ReactTestInstance { return mounted!.root.find((node) => node.props.accessibilityLabel === label); }
function findButton(label: string): ReactTestInstance | null { return mounted!.root.findAll((node) => node.props.accessibilityLabel === label)[0] ?? null; }
function allText(): string { return mounted!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' '); }
