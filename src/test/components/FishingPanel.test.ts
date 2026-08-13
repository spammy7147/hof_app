import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => {
    const data = props.data as Array<{ id: string }>;
    const renderItem = props.renderItem as (info: { item: { id: string } }) => React.ReactNode;
    return React.createElement('FlatList', props, data.map((item) => React.createElement(React.Fragment, { key: item.id }, renderItem({ item }))));
  },
  Modal: host('Modal'),
  Pressable: host('Pressable'),
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  TextInput: host('TextInput'),
  View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
  if (request === 'expo-image') return { Image: host('Image') };
  if (request.endsWith('/BattleRunPanel')) return { BattleRunPanel: host('BattleRunPanel') };
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
  it('낚시 요약에는 남은 횟수와 현재 상태 및 미끼 수량을 표시한다', async () => {
    await render(React.createElement(FishingPanel, { api: fakeApi({ load: async () => fishing('START', ['START']) }) }));

    const text = allText();
    assert.equal(text.includes('남은 낚시 횟수'), true);
    assert.equal(text.includes('17회'), true);
    assert.equal(text.includes('현재 물고기 상태'), true);
    assert.equal(text.includes('수면이 빛난다.'), true);
    assert.equal(text.includes('일반 낚시터'), false);
    assert.equal(text.includes('미끼 경단 0개'), true);
    assert.equal(text.includes('빛나는 미끼 0개'), true);
  });

  it('물고기 상태에서 중복되는 남은 낚시 횟수 문구를 제거한다', async () => {
    const response = {
      ...fishing('START', ['START']),
      waterStatus: '(오늘의 남은 낚시 횟수 : 17회) 수면이 빛난다.',
    };
    await render(React.createElement(FishingPanel, { api: fakeApi({ load: async () => response }) }));

    const text = allText();
    assert.equal(text.includes('(오늘의 남은 낚시 횟수'), false);
    assert.equal(text.includes('수면이 빛난다.'), true);
  });

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

  it('낚시 결과를 현재 물고기 상태에 표시하고 별도 완료 카드는 만들지 않는다', async () => {
    const caught = {
      ...fishing('START', ['START']),
      waterStatus: '낚는다!\nRank Fish (100회 사용가능) / 사용 효과: HP+3000 x2 을(를) 획득했다!',
      catches: [{ name: 'Rank Fish', quantity: 2, remainingUses: 100, effect: 'HP+3000, HP Regen+2%' }],
      result: { status: 'SUCCESS' as const, messages: ['낚는다!'], items: [{ name: 'Rank Fish', quantity: null, imageUrl: null, detail: null }], refreshRequired: true },
    };
    await render(React.createElement(FishingPanel, { api: fakeApi({ load: async () => caught }) }));

    const text = allText();
    assert.equal(text.includes('낚는다!'), true);
    assert.equal(text.includes('Rank Fish (100회 사용가능)'), true);
    assert.equal(text.includes('완료'), false);
    assert.equal(findButton('마을 정보 새로고침'), null);
  });

  it('전투 중에는 이동 버튼 대신 현재 낚시 맵의 프리셋 전투 패널을 표시한다', async () => {
    const battle = { ...fishing('NONE', []), blockedByBattle: true, battleTarget: { categoryId: 'battle_map', mapCode: 'fishing_12', name: 'Fishing- 전기 뱀장어' } };
    await render(React.createElement(FishingPanel, {
      api: fakeApi({ load: async () => battle }),
      characters: [],
      partyPresetCatalog: { catalog: { folders: [], presets: [] }, loading: false, error: null, retry: () => undefined },
      onRunBattle: async () => { throw new Error('unexpected'); },
    }));

    assert.equal(findButton('낚시를 시작한다'), null);
    assert.equal(findButton('낚는다'), null);
    assert.equal(findButton('낚시 전투로 이동'), null);
    assert.equal(allText().includes('Fishing- 전기 뱀장어'), true);
    const runPanel = mounted?.root.findAll((node) => String(node.type) === 'BattleRunPanel')[0];
    assert.ok(runPanel);
    assert.deepEqual(runPanel.props.allowedBattleCounts, [1]);
  });

  it('교환소에서 radio 없는 행을 보이되 선택할 수 없게 한다', async () => {
    const api = fakeApi({
      load: async () => ({
        categories: [{ id: 'type:all', label: '전부', current: true }],
        currentCategoryId: 'type:all',
        items: [
          { id: 'rank', label: 'Rank Fish', selectable: true, detail: null, imageUrl: null, price: null, quantity: null, materials: [] },
          { id: 'display', label: '교환 불가', selectable: false, detail: null, imageUrl: null, price: null, quantity: null, materials: [] },
        ],
        result: null,
      }),
    });
    await render(React.createElement(FishingPanel, { api, mode: 'exchange' }));

    const unavailable = button('교환 불가 선택 불가');
    assert.equal(unavailable.props.disabled, true);
    assert.equal(allText().includes('교환 불가'), true);
  });

  it('교환소 응답 배열이 누락돼도 화면 예외 대신 오류 상태를 표시한다', async () => {
    await render(React.createElement(FishingPanel, {
      api: fakeApi({ load: async () => ({ message: 'unexpected response' }) }),
      mode: 'exchange',
    }));

    assert.equal(allText().includes('낚시 교환소 응답 형식을 확인할 수 없습니다.'), true);
    assert.ok(button('낚시 정보 다시 불러오기'));
  });

  it('빈 분류 목록을 정상 교환소 상태로 표시하지 않는다', async () => {
    await render(React.createElement(FishingPanel, {
      api: fakeApi({ load: async () => ({ categories: [], currentCategoryId: null, items: [], result: null }) }),
      mode: 'exchange',
    }));

    assert.equal(allText().includes('낚시 교환소 응답 형식을 확인할 수 없습니다.'), true);
    assert.ok(button('낚시 정보 다시 불러오기'));
  });

  it('교환 품목의 materials가 누락돼도 안전하게 목록을 표시한다', async () => {
    await render(React.createElement(FishingPanel, {
      api: fakeApi({ load: async () => ({
        categories: [{ id: 'type:all', label: '전부', current: true }],
        currentCategoryId: 'type:all',
        items: [{ id: 'rank', label: 'Rank Fish', selectable: true, detail: null, imageUrl: null, price: null, quantity: null }],
        result: null,
      }) }),
      mode: 'exchange',
    }));

    assert.equal(allText().includes('Rank Fish'), true);
  });

  it('교환 품목 분류는 아이템 행이 아니라 상단 선택지로 전환한다', async () => {
    const paths: string[] = [];
    const api = fakeApi({
      load: async (path: string) => {
        paths.push(path);
        const armor = path.includes('categoryCandidateId=type%3Aarmor');
        return {
          categories: [
            { id: 'type:weapon', label: '무기(weapon)', current: !armor },
            { id: 'type:armor', label: '방어구(armor)', current: armor },
          ],
          currentCategoryId: armor ? 'type:armor' : 'type:weapon',
          items: [{ id: armor ? 'armor-item' : 'weapon-item', label: armor ? '갑옷 물고기' : '무기 물고기', selectable: true, detail: null, imageUrl: null, price: 10, quantity: null, materials: [] }],
          result: null,
        };
      },
    });
    await render(React.createElement(FishingPanel, { api, mode: 'exchange' }));

    assert.equal(findButton('무기(weapon) 선택'), null);
    assert.equal(allText().includes('무기(weapon)'), true);
    await press('교환 품목 분류 선택');
    assert.ok(button('방어구(armor) 분류'));
    await press('방어구(armor) 분류');
    assert.equal(paths.at(-1), '/api/town/fishing-exchange?categoryCandidateId=type%3Aarmor');
    assert.equal(allText().includes('갑옷 물고기'), true);
  });

  it('긴 교환 품목 분류는 높이가 제한된 모달 스크롤 목록으로 연다', async () => {
    const categories = Array.from({ length: 17 }, (_, index) => ({
      id: `type:${index}`,
      label: `분류 ${index + 1}`,
      current: index === 0,
    }));
    await render(React.createElement(FishingPanel, {
      api: fakeApi({ load: async () => ({ categories, currentCategoryId: 'type:0', items: [], result: null }) }),
      mode: 'exchange',
    }));

    await press('교환 품목 분류 선택');

    const modal = mounted?.root.findAll((node) => String(node.type) === 'Modal')[0];
    const scrollView = mounted?.root.findAll((node) => String(node.type) === 'ScrollView')[0];
    assert.equal(modal?.props.visible, true);
    assert.equal(scrollView?.props.keyboardShouldPersistTaps, 'handled');
    assert.equal(scrollView?.props.accessibilityRole, 'menu');
  });

  it('빈 기본 분류에서도 드롭다운으로 다른 분류의 품목을 불러온다', async () => {
    const paths: string[] = [];
    const api = fakeApi({
      load: async (path: string) => {
        paths.push(path);
        const armor = path.includes('categoryCandidateId=type%3Aarmor');
        return {
          categories: [
            { id: 'type:weapon', label: '무기(weapon)', current: !armor },
            { id: 'type:armor', label: '방어구(armor)', current: armor },
          ],
          currentCategoryId: armor ? 'type:armor' : 'type:weapon',
          items: armor ? [{ id: 'armor-item', label: '갑옷 물고기', selectable: true, detail: null, imageUrl: null, price: 10, quantity: null, materials: [] }] : [],
          result: null,
        };
      },
    });
    await render(React.createElement(FishingPanel, { api, mode: 'exchange' }));

    assert.equal(allText().includes('갑옷 물고기'), false);
    assert.equal(button('선택한 낚시 품목 교환').props.disabled, true);
    await press('교환 품목 분류 선택');
    await press('방어구(armor) 분류');

    assert.equal(paths.at(-1), '/api/town/fishing-exchange?categoryCandidateId=type%3Aarmor');
    assert.equal(allText().includes('갑옷 물고기'), true);
  });

  it('교환 버튼을 한 번 누르면 정확한 수량을 제출한다', async () => {
    const calls: unknown[] = [];
    const response = {
      categories: [{ id: 'type:weapon', label: '무기', current: true }],
      currentCategoryId: 'type:weapon',
      items: [{ id: 'rank', label: 'Rank Fish', selectable: true, detail: '재료', imageUrl: null, price: 100, quantity: 4, materials: ['Fish Token x2'] }],
      result: null,
    };
    await render(React.createElement(FishingPanel, { api: fakeApi({
      load: async () => response,
      submit: async (_path, request) => { calls.push(request); return response; },
    }), mode: 'exchange' }));

    await press('Rank Fish 선택');
    await act(async () => button('교환 수량').props.onChangeText('3'));
    await press('선택한 낚시 품목 교환');
    assert.deepEqual(calls, [{ candidateId: 'rank', categoryCandidateId: 'type:weapon', quantity: 3 }]);
  });

  for (const invalid of ['', '0', '-1', '1.5', 'abc']) {
    it(`잘못된 교환 수량 ${JSON.stringify(invalid)}은 확인과 제출을 차단한다`, async () => {
      const calls: unknown[] = [];
      const response = { categories: [{ id: 'type:weapon', label: '무기', current: true }], currentCategoryId: 'type:weapon', items: [{ id: 'rank', label: 'Rank Fish', selectable: true, detail: null, imageUrl: null, price: 100, quantity: 4, materials: [] }], result: null };
      await render(React.createElement(FishingPanel, { api: fakeApi({ load: async () => response, submit: async (_path, request) => { calls.push(request); return response; } }), mode: 'exchange' }));
      await press('Rank Fish 선택');
      await act(async () => button('교환 수량').props.onChangeText(invalid));

      assert.equal(button('선택한 낚시 품목 교환').props.disabled, true);
      assert.equal(allText().includes('수량은 1 이상의 10진 정수로 입력하세요.'), true);
      assert.equal(mounted!.root.findAll((node) => String(node.type) === 'Modal' && node.props.visible === true).length, 0);
      assert.deepEqual(calls, []);
    });
  }
});

function fishing(primaryAction: 'START' | 'CATCH' | 'NONE', availableActions: string[]) {
  return {
    notice: null, remainingCasts: 17, waterStatus: '수면이 빛난다.', baitCount: 0, shiningBaitCount: 0,
    escapeSeconds: primaryAction === 'CATCH' ? 30 : null, combo: null, locationName: '일반 낚시터', primaryAction,
    availableActions, lastOutcome: null, blockedByBattle: false, battleTarget: null, catches: [], result: null,
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
