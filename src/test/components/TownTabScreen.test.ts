import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const focusCalls: Array<Record<string, unknown>> = [];
const scrollToCalls: Array<{ animated?: boolean; y?: number }> = [];
let hardwareBackHandler: (() => boolean) | null = null;
const host = (name: string) => React.forwardRef<Record<string, unknown>, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({
    accessibilityLabel: props.accessibilityLabel,
    host: name,
    testID: props.testID,
  }));
  return React.createElement(name, props, props.children as React.ReactNode);
});
const flatList = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  const data = props.data as Array<{ id: string }>;
  const renderItem = props.renderItem as (info: { item: { id: string }; index: number }) => React.ReactNode;
  const content = data.length === 0
    ? props.ListEmptyComponent as React.ReactNode
    : data.map((item, index) => React.createElement(
      React.Fragment,
      { key: (props.keyExtractor as (value: { id: string }) => string)(item) },
      renderItem({ item, index }),
    ));
  return React.createElement(
    'FlatList',
    { ...props, ref },
    content,
  );
});
const scrollView = React.forwardRef<Record<string, unknown>, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({
    scrollTo: (options: { animated?: boolean; y?: number }) => scrollToCalls.push(options),
  }));
  return React.createElement('ScrollView', props, props.children as React.ReactNode);
});
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  AccessibilityInfo: {
    setAccessibilityFocus: (handle: Record<string, unknown>) => focusCalls.push(handle),
  },
  BackHandler: {
    addEventListener: (_event: string, handler: () => boolean) => {
      hardwareBackHandler = handler;
      return { remove: () => { if (hardwareBackHandler === handler) hardwareBackHandler = null; } };
    },
  },
  FlatList: flatList,
  Modal: host('Modal'),
  Pressable: host('Pressable'),
  ScrollView: scrollView,
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  TextInput: host('TextInput'),
  View: host('View'),
  findNodeHandle: (node: Record<string, unknown> | null) => node,
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
  if (request === 'expo-image') return { Image: host('Image') };
  if (request.endsWith('/townAssets')) {
    return {
      TOWN_ICON_SOURCES: {
        fish: 'fish', coin: 'coin', potion: 'potion', box: 'box',
        card: 'card', sewing: 'sewing', book: 'book', smith: 'smith',
      },
    };
  }
  return originalLoad(request, parent, isMain);
};
const { TownTabScreen } = require(
  '../../main/screens/TownTabScreen',
) as typeof import('../../main/screens/TownTabScreen');
const { TownTabScrollContainer } = require(
  '../../main/screens/TownTabScrollContainer',
) as typeof import('../../main/screens/TownTabScrollContainer');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRenderer: ReactTestRenderer | null = null;

afterEach(async () => {
  focusCalls.length = 0;
  scrollToCalls.length = 0;
  hardwareBackHandler = null;
  if (!mountedRenderer) return;
  const renderer = mountedRenderer;
  mountedRenderer = null;
  await act(async () => { renderer.unmount(); });
});

describe('TownTabScreen', () => {
  it('renders one town shell with search, category chips, and a two-column menu grid', async () => {
    const renderer = await renderTown();
    const text = allText(renderer.root);

    assert.equal(text.includes('퀘·교환'), false);
    assert.equal(text.includes('전체'), true);
    assert.equal(text.includes('생활'), true);
    assert.equal(text.includes('특수 시설'), true);
    assert.equal(findHost(renderer.root, 'TextInput').props.accessibilityLabel, '마을 메뉴 검색');
    assert.equal(findHost(renderer.root, 'FlatList').props.numColumns, 2);
  });

  it('filters by category and query, opens detail, then restores the list state', async () => {
    const scrollEvents: string[] = [];
    const renderer = await renderTown({
      onCaptureListScroll: () => scrollEvents.push('capture'),
      onRestoreListScroll: () => scrollEvents.push('restore'),
    });
    await press(renderer.root, '카드 가게 분류');
    const input = findHost(renderer.root, 'TextInput');
    await act(async () => input.props.onChangeText('강화'));

    assert.deepEqual(menuButtonLabels(renderer.root), ['카드 강화']);
    await press(renderer.root, '카드 강화 열기');
    assert.deepEqual(scrollEvents, ['capture']);
    assert.equal(allText(renderer.root).includes('카드 강화'), true);
    assert.equal(findHosts(renderer.root, 'TextInput').length, 0);
    assert.equal(focusCalls.at(-1)?.testID, 'town-detail-title');

    await press(renderer.root, '마을 메뉴 목록으로');
    assert.deepEqual(scrollEvents, ['capture', 'restore']);
    assert.equal(findHost(renderer.root, 'TextInput').props.value, '강화');
    assert.equal(selectedCategoryLabel(renderer.root), '카드 가게');
    assert.deepEqual(menuButtonLabels(renderer.root), ['카드 강화']);
    assert.equal(menuButton(renderer.root, '카드 강화').props.accessibilityState.selected, true);
    assert.equal(focusCalls.at(-1)?.accessibilityLabel, '카드 강화 열기');
  });

  it('uses Android hardware back to close detail and restore the list contract', async () => {
    const scrollEvents: string[] = [];
    const renderer = await renderTown({
      onCaptureListScroll: () => scrollEvents.push('capture'),
      onRestoreListScroll: () => scrollEvents.push('restore'),
    });
    await press(renderer.root, '낚시터 열기');

    assert.ok(hardwareBackHandler);
    let handled = false;
    await act(async () => { handled = hardwareBackHandler?.() ?? false; });

    assert.equal(handled, true);
    assert.deepEqual(scrollEvents, ['capture', 'restore']);
    assert.equal(findHost(renderer.root, 'TextInput').props.accessibilityLabel, '마을 메뉴 검색');
    assert.equal(focusCalls.at(-1)?.accessibilityLabel, '낚시터 열기');
  });

  it('낚시터와 교환소 내부 이동 때 상세 제목과 접근성 포커스를 갱신한다', async () => {
    const townApi = {
      load: async (path: string) => path.endsWith('fishing-exchange')
        ? { items: [], result: null }
        : { ...fishingSnapshot(), catches: [] },
      submit: async () => { throw new Error('unexpected submit'); },
    } as never;
    const renderer = await renderTown({ townApi });
    await press(renderer.root, '낚시터 열기');
    const focusCount = focusCalls.length;
    assert.equal(allText(renderer.root).includes('낚시터'), true);

    await press(renderer.root, '낚시 교환소로 이동');
    await act(async () => { await Promise.resolve(); });
    assert.equal(allText(renderer.root).includes('낚시 교환소'), true);
    assert.equal(focusCalls.length, focusCount + 1);
    assert.equal(focusCalls.at(-1)?.testID, 'town-detail-title');
  });

  it('captures the external town ScrollView offset and restores it after detail', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(TownTabScrollContainer)); });
    mountedRenderer = renderer;
    const scroller = renderer.root.find((node) => node.props.accessibilityLabel === '마을 화면 스크롤');
    await act(async () => scroller.props.onScroll({ nativeEvent: { contentOffset: { y: 384 } } }));

    await press(renderer.root, '낚시터 열기');
    await act(async () => scroller.props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }));
    await press(renderer.root, '마을 메뉴 목록으로');

    assert.deepEqual(scrollToCalls, [{ animated: false, y: 384 }]);
  });

  it('상점 상세의 긴 가상 목록은 같은 방향의 외부 ScrollView와 분리한다', async () => {
    const townApi = {
      load: async () => ({ shopId: 'general', stale: false, lastVerifiedAt: null, result: null, items: [] }),
      submit: async () => { throw new Error('unexpected submit'); },
    } as never;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(TownTabScrollContainer, { townApi } as never)); });
    mountedRenderer = renderer;

    await press(renderer.root, '일반상점 열기');
    await act(async () => { await Promise.resolve(); });

    assert.equal(renderer.root.findAll((node) => node.props.accessibilityLabel === '마을 화면 스크롤').length, 0);
    assert.equal(findHosts(renderer.root, 'View').filter((node) => node.props.accessibilityLabel === '마을 가상 목록 화면').length, 1);
    assert.equal(findHosts(renderer.root, 'FlatList').filter((node) => node.props.nestedScrollEnabled === true).length, 1);
  });

  it('상점 왕복에도 TownTabScreen 인스턴스와 검색 분류 스크롤 포커스를 보존한다', async () => {
    const townApi = {
      load: async () => ({ shopId: 'general', stale: false, lastVerifiedAt: null, result: null, items: [] }),
      submit: async () => { throw new Error('unexpected submit'); },
    } as never;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(TownTabScrollContainer, { townApi } as never)); });
    mountedRenderer = renderer;
    const screenBefore = renderer.root.findByType(TownTabScreen);

    await press(renderer.root, '시장 분류');
    await act(async () => findHost(renderer.root, 'TextInput').props.onChangeText('일반'));
    const scroller = renderer.root.find((node) => node.props.accessibilityLabel === '마을 화면 스크롤');
    await act(async () => scroller.props.onScroll({ nativeEvent: { contentOffset: { y: 384 } } }));
    await press(renderer.root, '일반상점 열기');
    await act(async () => { await Promise.resolve(); });

    assert.strictEqual(renderer.root.findByType(TownTabScreen), screenBefore);
    assert.equal(renderer.root.findAll((node) => node.props.accessibilityLabel === '마을 화면 스크롤').length, 0);
    await press(renderer.root, '마을 메뉴 목록으로');

    assert.strictEqual(renderer.root.findByType(TownTabScreen), screenBefore);
    assert.equal(findHost(renderer.root, 'TextInput').props.value, '일반');
    assert.equal(selectedCategoryLabel(renderer.root), '시장');
    assert.deepEqual(scrollToCalls, [{ animated: false, y: 384 }]);
    assert.equal(focusCalls.at(-1)?.accessibilityLabel, '일반상점 열기');
  });

  it('모험 알선소와 자택·휴식처를 독립 조회 계약과 가상 목록으로 연결한다', async () => {
    const paths: string[] = [];
    let questLoads = 0;
    const townApi = {
      loadQuests: async () => { questLoads += 1; return []; },
      acceptQuest: async () => [],
      claimQuest: async () => [],
      load: async (path: string) => {
        paths.push(path);
        return path === '/api/town/home'
          ? { mode: 'HOME', quests: [], actions: [], restStatus: null, result: null }
          : { mode: 'REST', quests: [], actions: [], restStatus: null, result: null };
      },
      submit: async () => { throw new Error('unexpected submit'); },
    } as never;
    let renderer = await renderTown({ townApi, controlledMenuId: 'adventureAgency', controlledDetailOpen: true });
    await act(async () => { await Promise.resolve(); });
    await act(async () => renderer.update(React.createElement(TownTabScreen, { townApi, controlledMenuId: 'homeManagement', controlledDetailOpen: true })));
    await act(async () => { await Promise.resolve(); });
    await act(async () => renderer.update(React.createElement(TownTabScreen, { townApi, controlledMenuId: 'restRoom', controlledDetailOpen: true })));
    await act(async () => { await Promise.resolve(); });

    assert.equal(questLoads, 1);
    assert.deepEqual(paths, ['/api/town/home', '/api/town/rest']);
    assert.equal(allText(renderer.root).includes('기능 연결을 준비하고 있습니다.'), false);
    assert.equal(findHosts(renderer.root, 'FlatList').length, 1);
  });

  it('제작 시설 다섯 메뉴를 각각의 typed mode와 가상 목록으로 연결한다', async () => {
    const paths: string[] = [];
    const townApi = {
      load: async (path: string) => { paths.push(path); return craftingSnapshot(); },
      submit: async () => { throw new Error('unexpected submit'); },
    } as never;
    const menuIds = ['workbase', 'sewingShop', 'refineWorkshop', 'createWorkshop', 'veteranSmithy'] as const;
    let renderer = await renderTown({ townApi, controlledMenuId: menuIds[0], controlledDetailOpen: true });
    await act(async () => { await Promise.resolve(); });
    for (const menuId of menuIds.slice(1)) {
      await act(async () => renderer.update(React.createElement(TownTabScreen, { townApi, controlledMenuId: menuId, controlledDetailOpen: true })));
      await act(async () => { await Promise.resolve(); });
    }

    assert.deepEqual(paths, [
      '/api/town/crafting/workbase', '/api/town/crafting/claris', '/api/town/crafting/refine',
      '/api/town/crafting/create', '/api/town/crafting/veteran',
    ]);
    assert.equal(allText(renderer.root).includes('기능 연결을 준비하고 있습니다.'), false);
    assert.equal(findHosts(renderer.root, 'FlatList').length, 1);
  });

  it('shows a friendly empty state and allows clearing the search', async () => {
    const renderer = await renderTown();
    const input = findHost(renderer.root, 'TextInput');
    await act(async () => input.props.onChangeText('없는 메뉴'));

    assert.equal(allText(renderer.root).includes('검색 결과가 없습니다.'), true);
    await press(renderer.root, '검색어 지우기');
    assert.equal(findHost(renderer.root, 'TextInput').props.value, '');
    assert.equal(menuButtonLabels(renderer.root).length, 33);
  });

  it('keeps long menu labels on two lines', async () => {
    const renderer = await renderTown();
    const labels = renderer.root.findAll((node) => (
      String(node.type) === 'Text'
      && node.props.testID === 'town-menu-label'
    ));

    assert.equal(labels.length, 33);
    assert.equal(labels.every((node) => node.props.numberOfLines === 2), true);
  });
});

async function renderTown(props: React.ComponentProps<typeof TownTabScreen> = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(TownTabScreen, props)); });
  mountedRenderer = renderer;
  return renderer;
}

async function press(root: ReactTestInstance, accessibilityLabel: string): Promise<void> {
  const button = root.find((node) => node.props.accessibilityLabel === accessibilityLabel);
  await act(async () => button.props.onPress());
}

function menuButtonLabels(root: ReactTestInstance): string[] {
  return root
    .findAll((node) => (
      String(node.type) === 'Pressable'
      && typeof node.props.accessibilityLabel === 'string'
      && node.props.accessibilityLabel.endsWith(' 열기')
    ))
    .map((node) => node.props.accessibilityLabel.slice(0, -3));
}

function menuButton(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((node) => (
    String(node.type) === 'Pressable'
    && node.props.accessibilityLabel === `${label} 열기`
  ));
}

function selectedCategoryLabel(root: ReactTestInstance): string | null {
  const selected = root.findAll((node) => (
    typeof node.props.accessibilityLabel === 'string'
    && node.props.accessibilityLabel.endsWith(' 분류')
    && node.props.accessibilityState?.selected === true
  ));
  return selected[0]?.props.accessibilityLabel.replace(/ 분류$/, '') ?? null;
}

function findHost(root: ReactTestInstance, name: string): ReactTestInstance {
  return root.find((node) => String(node.type) === name);
}

function findHosts(root: ReactTestInstance, name: string): ReactTestInstance[] {
  return root.findAll((node) => String(node.type) === name);
}

function allText(root: ReactTestInstance): string[] {
  return root
    .findAll((node) => String(node.type) === 'Text')
    .flatMap((node) => flattenChildren(node.props.children));
}

function flattenChildren(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenChildren);
  return [];
}

function fishingSnapshot() {
  return {
    notice: null, remainingCasts: 17, waterStatus: '수면이 빛난다.', baitCount: 0, shiningBaitCount: 0,
    escapeSeconds: null, combo: null, locationName: '일반 낚시터', primaryAction: 'START', availableActions: ['START'],
    lastOutcome: null, blockedByBattle: false, battleTarget: null, result: null,
  };
}

function craftingSnapshot() {
  return {
    mode: 'WORKBASE', categories: [{ id: 'category', label: '무기', current: true }], currentCategoryId: 'category',
    rows: [], minQuantity: 1, maxQuantity: 10, activeJob: null, allowedRefineCounts: [], additionalMaterials: [],
    additionalMaterialsOptional: false, warningCode: null, history: [], result: null,
  };
}
