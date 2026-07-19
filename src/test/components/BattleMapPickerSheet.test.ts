import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';

import type { BattleMapResponse } from '../../main/types/api';
import type { QuestMapCatalogRow } from '../../main/domain/questMapCatalog';

const focusCalls: unknown[] = [];
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement(name, { ...props, ref }, props.children as React.ReactNode)
));
const modal = (props: Record<string, unknown>) => React.createElement(
  'Modal',
  props,
  props.visible ? props.children as React.ReactNode : null,
);
const flatList = (props: Record<string, unknown>) => {
  const data = props.data as QuestMapCatalogRow[];
  const renderItem = props.renderItem as (info: { item: QuestMapCatalogRow }) => React.ReactNode;
  return React.createElement(
    'FlatList',
    props,
    data.length > 0
      ? data.map((item) => React.createElement(React.Fragment, { key: item.key }, renderItem({ item })))
      : props.ListEmptyComponent as React.ReactNode,
  );
};

const reactNativeMock = {
  AccessibilityInfo: { setAccessibilityFocus: (node: unknown) => { focusCalls.push(node); } },
  ActivityIndicator: host('ActivityIndicator'),
  Dimensions: { get: () => ({ height: 800, width: 390 }) },
  FlatList: flatList,
  findNodeHandle: (node: unknown) => node,
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Modal: modal,
  Platform: { OS: 'ios' },
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  TextInput: host('TextInput'),
  View: host('View'),
};

type ModuleLoader = (
  request: string,
  parent: NodeModule | undefined,
  isMain: boolean,
) => unknown;
const moduleWithLoader = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') {
    return { ChevronDown: host('ChevronDown'), ChevronRight: host('ChevronRight') };
  }
  if (request === './NativeSafeAreaProvider' && parent?.filename.includes('react-native-safe-area-context')) {
    return { NativeSafeAreaProvider: host('NativeSafeAreaProvider') };
  }
  return originalLoad(request, parent, isMain);
};

const safeAreaMock = require(
  'react-native-safe-area-context/lib/commonjs/SafeAreaContext',
) as typeof import('react-native-safe-area-context');
const originalMockedLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native-safe-area-context') return safeAreaMock;
  return originalMockedLoad(request, parent, isMain);
};

const { BattleMapPickerSheet } = require(
  '../../main/features/automation/components/BattleMapPickerSheet',
) as typeof import('../../main/features/automation/components/BattleMapPickerSheet');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('BattleMapPickerSheet', () => {
  it('does not render sheet content while closed', async () => {
    const renderer = await renderSheet({ visible: false });

    assert.equal(findByText(renderer.root, '전투맵 추가'), null);
    assert.equal(findHost(renderer.root, 'Modal').props.visible, false);
  });

  it('renders the target header and closes from request, scrim, and close button', async () => {
    let closes = 0;
    const renderer = await renderSheet({ target: '경비병', onClose: () => { closes += 1; } });
    const nativeModal = findHost(renderer.root, 'Modal');

    assert.equal(hasText(renderer.root, '전투맵 추가'), true);
    assert.equal(hasText(renderer.root, '경비병'), true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투맵 선택 닫기' }).props.accessibilityRole, 'button');
    nativeModal.props.onRequestClose();
    renderer.root.findByProps({ accessibilityLabel: '전투맵 선택 배경 닫기' }).props.onPress();
    renderer.root.findByProps({ accessibilityLabel: '전투맵 선택 닫기' }).props.onPress();
    assert.equal(closes, 3);
  });

  it('uses the replacement title while keeping full-card selection labels', async () => {
    const renderer = await renderSheet({
      mode: 'REPLACE',
      maps: [map('battle_map', 'maid-hall', 'Maid Hall')],
    });

    assert.equal(hasText(renderer.root, '전투맵 변경'), true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투맵 변경' }).props.accessibilityRole, 'header');
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Maid Hall 맵 선택' }).props.accessibilityRole, 'button');
    assert.equal(hasText(renderer.root, '변경'), false);
  });

  it('renders selected maps first without add or change buttons', async () => {
    const renderer = await renderSheet({
      mode: 'REPLACE',
      maps: [
        map('battle_map', 'maid-hall', 'Maid Hall'),
        map('battle_map', 'castle', 'Castle'),
        map('adventure_map', 'sky', 'Sky'),
      ],
      selectedMapIdentities: ['battle_map\u0000maid-hall'],
    });

    assert.equal(hasText(renderer.root, '선택한 맵'), true);
    assert.equal(hasText(renderer.root, '추가'), false);
    assert.equal(hasText(renderer.root, '변경'), false);
    assert.equal(hasText(renderer.root, '전투맵'), true);
    assert.equal(hasText(renderer.root, '모험맵'), true);
    const selectedCard = renderer.root.findByProps({ accessibilityLabel: 'Maid Hall 맵 선택 해제' });
    assert.deepEqual(selectedCard.props.accessibilityState, { disabled: false, selected: true });
  });

  it('moves focus to the title when the modal opens', async () => {
    focusCalls.length = 0;
    const renderer = await renderSheet();
    const nativeModal = findHost(renderer.root, 'Modal');

    await act(async () => { nativeModal.props.onShow(); });
    assert.equal(focusLabel(focusCalls.at(-1)), '전투맵 추가');
  });

  it('uses an iOS keyboard-avoiding wrapper and applies the bottom safe-area inset to the panel', async () => {
    const renderer = await renderSheet({ maps: [map('battle_map', 'maid-hall', 'Maid Hall')] });
    const keyboardAvoidingView = findHost(renderer.root, 'KeyboardAvoidingView');
    const panel = renderer.root.findByProps({ accessibilityLabel: '전투맵 선택' });

    assert.equal(keyboardAvoidingView.props.behavior, 'padding');
    assert.equal(keyboardAvoidingView.props.keyboardVerticalOffset, 0);
    assert.equal(keyboardAvoidingView.props.pointerEvents, 'box-none');
    assert.equal(flattenStyle(panel.props.style).paddingBottom, 31);
    assert.equal(renderer.root.findAll(({ type }) => String(type) === 'ScrollView').length, 0);
  });

  it('uses the fallback subtitle for a blank target', async () => {
    const renderer = await renderSheet({ target: '   ' });

    assert.equal(hasText(renderer.root, '실행할 맵을 선택해 주세요.'), true);
  });

  it('toggles a selected Maid Hall card and leaves the sheet open', async () => {
    const maid = map('battle_map', 'maid-hall', 'Maid Hall');
    const toggled: BattleMapResponse[] = [];
    const renderer = await renderSheet({
      maps: [maid],
      selectedMapIdentities: ['battle_map\u0000maid-hall'],
      onToggle: (item) => { toggled.push(item); },
    });
    const button = renderer.root.findByProps({ accessibilityLabel: 'Maid Hall 맵 선택 해제' });

    assert.equal(button.props.disabled, false);
    assert.equal(button.props.accessibilityRole, 'button');
    assert.deepEqual(button.props.accessibilityState, { disabled: false, selected: true });
    button.props.onPress();
    assert.deepEqual(toggled, [maid]);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투맵 선택' }));
  });

  it('expands and collapses category and group rows without filter chips', async () => {
    const renderer = await renderSheet({ maps: [
      map('battle_map', 'maid-hall', 'Maid Hall'),
      map('adventure_map', 'sky-tower', 'Sky Tower'),
    ] });

    assert.equal(renderer.root.findAllByProps({ accessibilityRole: 'radio' }).length, 0);
    const category = renderer.root.findByProps({ accessibilityLabel: '전투맵 카테고리 닫기' });
    assert.deepEqual(category.props.accessibilityState, { expanded: true });
    await act(async () => { category.props.onPress(); });
    assert.equal(hasText(renderer.root, 'Maid Hall'), false);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투맵 카테고리 열기' }).props.onPress(); });
    const group = renderer.root.findByProps({ accessibilityLabel: 'Castle 그룹 닫기' });
    await act(async () => { group.props.onPress(); });
    assert.equal(hasText(renderer.root, 'Maid Hall'), false);
  });

  it('searches Sky and calls onToggle exactly once while keeping the sheet open', async () => {
    const skyTower = map('adventure_map', 'sky-tower', 'Sky Tower');
    const selected: BattleMapResponse[] = [];
    const renderer = await renderSheet({
      maps: [map('battle_map', 'maid-hall', 'Maid Hall'), skyTower],
      onToggle: (item) => { selected.push(item); },
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '전투맵 검색' }).props.onChangeText('Sky');
    });
    assert.equal(hasText(renderer.root, 'Maid Hall'), false);
    assert.equal(hasText(renderer.root, '모험맵'), true);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Sky Tower 맵 선택' }).props.onPress();
    });
    assert.deepEqual(selected, [skyTower]);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투맵 선택' }));
  });

  it('resets the query and expansion state when reopened', async () => {
    const props = sheetProps({ maps: [
      map('battle_map', 'maid-hall', 'Maid Hall'),
      map('adventure_map', 'sky-tower', 'Sky Tower'),
    ] });
    const renderer = await renderElement(React.createElement(BattleMapPickerSheet, props));

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '전투맵 검색' }).props.onChangeText('Sky');
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 카테고리 검색 결과' }).props.onPress(); });
    await act(async () => { renderer.update(withSafeArea(React.createElement(BattleMapPickerSheet, { ...props, visible: false }))); });
    await act(async () => { renderer.update(withSafeArea(React.createElement(BattleMapPickerSheet, props))); });

    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투맵 검색' }).props.value, '');
    assert.equal(hasText(renderer.root, 'Maid Hall'), true);
    assert.deepEqual(renderer.root.findByProps({ accessibilityLabel: '전투맵 카테고리 닫기' }).props.accessibilityState, { expanded: true });
  });

  it('renders loading, error retry, and empty states without stale actions', async () => {
    const maps = [map('battle_map', 'maid-hall', 'Maid Hall')];
    let retries = 0;
    const loading = await renderSheet({ loading: true, maps });
    assert.ok(findHost(loading.root, 'ActivityIndicator'));
    assert.equal(hasText(loading.root, '전투맵을 불러오는 중입니다.'), true);
    assert.equal(loading.root.findAllByProps({ accessibilityLabel: 'Maid Hall 맵 선택' }).length, 0);

    const error = await renderSheet({ error: 'network', maps, onRetry: () => { retries += 1; } });
    assert.equal(hasText(error.root, '전투맵을 불러오지 못했어요.'), true);
    assert.equal(error.root.findAllByProps({ accessibilityLabel: 'Maid Hall 맵 선택' }).length, 0);
    error.root.findByProps({ accessibilityLabel: '전투맵 다시 불러오기' }).props.onPress();
    assert.equal(retries, 1);

    const empty = await renderSheet({ maps: [] });
    assert.equal(hasText(empty.root, '검색 결과가 없습니다.'), true);
  });

  it('keeps resolved null-code rows visible but disabled and omits unsupported rows', async () => {
    const renderer = await renderSheet({ maps: [
      map('battle_map', 'maid-hall', 'Maid Hall'),
      { ...map('battle_map', null, 'No Code Map'), resolved: true },
      map('other_category', 'union', 'Union Map'),
    ] });

    assert.equal(hasText(renderer.root, 'Maid Hall'), true);
    const noCode = renderer.root.findByProps({ accessibilityLabel: 'No Code Map 맵 선택' });
    assert.deepEqual(noCode.props.accessibilityState, { disabled: true, selected: false });
    assert.equal(noCode.props.disabled, true);
    assert.equal(hasText(renderer.root, 'Union Map'), false);
    const list = findHost(renderer.root, 'FlatList');
    assert.equal(list.props.keyboardShouldPersistTaps, 'handled');
    assert.equal(list.props.keyExtractor(list.props.data[0]), list.props.data[0].key);
  });
});

function sheetProps(overrides: Partial<React.ComponentProps<typeof BattleMapPickerSheet>> = {}) {
  return {
    visible: true,
    mode: 'ADD' as const,
    target: null,
    maps: [],
    selectedMapIdentities: [],
    loading: false,
    error: null,
    onClose: () => undefined,
    onRetry: () => undefined,
    onToggle: (_map: BattleMapResponse) => undefined,
    ...overrides,
  };
}

async function renderSheet(overrides: Partial<React.ComponentProps<typeof BattleMapPickerSheet>> = {}) {
  return renderElement(React.createElement(BattleMapPickerSheet, sheetProps(overrides)));
}

async function renderElement(element: React.ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (String(args[0]).includes('react-test-renderer is deprecated')) return;
    originalError(...args);
  };
  try {
    await act(async () => {
      renderer = create(withSafeArea(element), {
        createNodeMock: (candidate) => ({
          accessibilityLabel: (candidate.props as Record<string, unknown>).accessibilityLabel,
          type: candidate.type,
        }),
      });
    });
  } finally {
    console.error = originalError;
  }
  return renderer!;
}

function withSafeArea(element: React.ReactElement): React.ReactElement {
  return React.createElement(
    safeAreaMock.SafeAreaProvider,
    { initialMetrics: safeAreaMetrics() },
    element,
  );
}

function safeAreaMetrics() {
  return {
    frame: { x: 0, y: 0, width: 390, height: 800 },
    insets: { bottom: 31, left: 0, right: 0, top: 0 },
  };
}

function map(categoryId: string, mapCode: string | null, name: string): BattleMapResponse {
  return {
    categoryId,
    mapCode,
    name,
    groupName: categoryId === 'battle_map' ? 'Castle' : null,
    groupOrder: 0,
    mapOrder: 0,
    recommendedLevel: null,
    availableCount: null,
    attemptCount: null,
    winCount: null,
    cooldownRemainingText: null,
    cooldownRemainingSeconds: null,
    keyMode: mapCode == null ? 'UNKNOWN' : 'NOT_REQUIRED',
    keyCount: null,
    requiredTime: null,
    supportsThreeBattles: false,
    enabled: true,
    resolved: mapCode != null,
    iconUrl: null,
    rawHref: '',
  };
}

function findHost(root: ReactTestInstance, type: string): ReactTestInstance {
  return root.find(({ type: candidate }) => String(candidate) === type);
}

function hasText(root: ReactTestInstance, expected: string): boolean {
  return findByText(root, expected) != null;
}

function findByText(root: ReactTestInstance, expected: string): ReactTestInstance | null {
  return root.findAll(({ type, children }) => String(type) === 'Text' && children.includes(expected))[0] ?? null;
}

function flattenStyle(style: unknown): Record<string, unknown> {
  return (Array.isArray(style) ? style : [style]).reduce<Record<string, unknown>>(
    (result, candidate) => ({ ...result, ...(candidate as Record<string, unknown> | null) }),
    {},
  );
}

function focusLabel(node: unknown): unknown {
  return (node as { accessibilityLabel?: unknown } | null)?.accessibilityLabel;
}
