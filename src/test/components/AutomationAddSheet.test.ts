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

import type {
  AutomationType,
  TypedAutomationEntryResponse,
} from '../../main/types/api';

let windowHeight = 800;
let safeAreaBottom = 0;
let alertArguments: unknown[] | null = null;
const focusCalls: unknown[] = [];
const AUTOMATION_LABELS: Record<AutomationType, string> = {
  QUEST: '퀘스트',
  BATTLE_MAP: '전투 맵',
  ADVENTURE_MAP: '모험 맵',
};

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement(name, { ...props, ref }, props.children as React.ReactNode)
));
const modal = (props: Record<string, unknown>) => React.createElement(
  'Modal',
  props,
  props.visible ? props.children as React.ReactNode : null,
);
const draggableList = (props: Record<string, unknown>) => {
  const data = props.data as TypedAutomationEntryResponse[];
  const renderItem = props.renderItem as (params: {
    item: TypedAutomationEntryResponse;
    drag: () => void;
    getIndex: () => number | undefined;
    isActive: boolean;
  }) => React.ReactNode;
  return React.createElement(
    'DraggableFlatList',
    props,
    data.map((item, index) => React.createElement(
      React.Fragment,
      { key: item.id },
      renderItem({ item, drag: () => undefined, getIndex: () => index, isActive: false }),
    )),
  );
};
type SwipeableMockMethods = {
  close: () => void;
  openLeft: () => void;
  openRight: () => void;
  reset: () => void;
  closeCalls: number;
};
const reanimatedSwipeable = React.forwardRef<SwipeableMockMethods, Record<string, unknown>>((props, ref) => {
  const methods = React.useMemo<SwipeableMockMethods>(() => ({
    closeCalls: 0,
    close() { methods.closeCalls += 1; },
    openLeft: () => undefined,
    openRight: () => undefined,
    reset: () => undefined,
  }), []);
  React.useImperativeHandle(ref, () => methods, [methods]);
  const renderRightActions = props.renderRightActions as
    | ((progress: unknown, translation: unknown, swipeable: SwipeableMockMethods) => React.ReactNode)
    | undefined;

  return React.createElement(
    'ReanimatedSwipeable',
    { ...props, mockMethods: methods },
    props.children as React.ReactNode,
    renderRightActions?.({}, {}, methods),
  );
});

const reactNativeMock = {
  AccessibilityInfo: {
    announceForAccessibility: () => undefined,
    setAccessibilityFocus: (node: unknown) => { focusCalls.push(node); },
  },
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: (...args: unknown[]) => { alertArguments = args; } },
  Dimensions: { get: () => ({ height: windowHeight, width: 390 }) },
  findNodeHandle: (node: unknown) => node,
  Modal: modal,
  Pressable: host('Pressable'),
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Switch: host('Switch'),
  Text: host('Text'),
  useWindowDimensions: () => ({ height: windowHeight, width: 390 }),
  View: host('View'),
};
const iconsMock = new Proxy({}, {
  get: (_target, property) => host(String(property)),
});
let safeAreaMock: typeof import('react-native-safe-area-context');

type ModuleLoader = (
  request: string,
  parent: NodeModule | undefined,
  isMain: boolean,
) => unknown;
const moduleWithLoader = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') return iconsMock;
  if (request === 'react-native-gesture-handler') {
    return { GestureHandlerRootView: host('GestureHandlerRootView') };
  }
  if (request === 'react-native-gesture-handler/ReanimatedSwipeable') {
    return { __esModule: true, default: reanimatedSwipeable };
  }
  if (request === './NativeSafeAreaProvider' && parent?.filename.includes('react-native-safe-area-context')) {
    return { NativeSafeAreaProvider: host('NativeSafeAreaProvider') };
  }
  if (request === 'react-native-draggable-flatlist') {
    return {
      NestableDraggableFlatList: draggableList,
    };
  }
  return originalLoad(request, parent, isMain);
};

safeAreaMock = require(
  'react-native-safe-area-context/lib/commonjs/SafeAreaContext',
) as typeof import('react-native-safe-area-context');
const originalMockedLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native-safe-area-context') return safeAreaMock;
  return originalMockedLoad(request, parent, isMain);
};

const { AutomationAddSheet } = require(
  '../../main/features/automation/components/AutomationAddSheet',
) as typeof import('../../main/features/automation/components/AutomationAddSheet');
const { UnifiedAutomationSettings } = require(
  '../../main/features/automation/components/UnifiedAutomationSettings',
) as typeof import('../../main/features/automation/components/UnifiedAutomationSettings');
const { AppProviders } = require(
  '../../main/components/AppProviders',
) as typeof import('../../main/components/AppProviders');
const { theme } = require('../../main/styles/theme') as typeof import('../../main/styles/theme');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('AutomationAddSheet mounted interactions', () => {
  it('receives bottom insets through the exact production provider shell', async () => {
    windowHeight = 320;
    safeAreaBottom = 37;
    const renderer = await renderRaw(React.createElement(
      AppProviders,
      { initialMetrics: safeAreaMetrics() },
      React.createElement(AutomationAddSheet, sheetProps({ visible: true })),
    ));

    assert.ok(findHost(renderer.root, 'GestureHandlerRootView'));
    const scroller = findHost(renderer.root, 'ScrollView');
    assert.equal(flattenStyle(scroller.props.contentContainerStyle).paddingBottom, 61);
  });

  it('clamps the panel to a short viewport and applies one explicit bottom safe-area inset', async () => {
    windowHeight = 320;
    safeAreaBottom = 37;
    const renderer = await renderSheet({ visible: true });

    const panel = renderer.root.findByProps({ accessibilityLabel: '자동화 추가' });
    assert.ok(Number(flattenStyle(panel.props.style).maxHeight) <= windowHeight);
    const scroller = findHost(renderer.root, 'ScrollView');
    assert.equal(scroller.props.contentInsetAdjustmentBehavior, 'never');
    assert.equal(flattenStyle(scroller.props.contentContainerStyle).paddingBottom, 61);
  });

  it('uses the shared semantic overlay for the sheet backdrop', async () => {
    const renderer = await renderSheet({ visible: true });
    const backdrop = renderer.root.findByProps({ accessibilityLabel: '자동화 추가 배경 닫기' });

    assert.equal(flattenStyle(backdrop.props.style).backgroundColor, theme.colors.overlay);
  });

  it('closes from Android request and backdrop presses', async () => {
    let closes = 0;
    const renderer = await renderSheet({ visible: true, onClose: () => { closes += 1; } });
    const nativeModal = findHost(renderer.root, 'Modal');

    nativeModal.props.onRequestClose();
    renderer.root.findByProps({ accessibilityLabel: '자동화 추가 배경 닫기' }).props.onPress();
    assert.equal(closes, 2);
  });

  it('renders exactly three choices and disables an existing type as 추가됨', async () => {
    const renderer = await renderSheet({
      entries: [entry(1, 'QUEST')],
      visible: true,
    });
    const choices = findAutomationChoices(renderer.root);

    assert.equal(choices.length, 3);
    assert.deepEqual(choices.map(({ props }) => props.accessibilityLabel), [
      '퀘스트 자동화 추가됨',
      '전투 맵 자동화 추가',
      '모험 맵 자동화 추가',
    ]);
    assert.equal(choices[0]?.props.disabled, true);
    assert.equal(choices[0]?.props.accessibilityState.disabled, true);
    assert.equal(hasText(choices[0]!, '추가됨'), true);
  });

  it('guards a deferred add from double taps and closes only after success', async () => {
    const deferredAdd = deferred<boolean>();
    let adds = 0;
    let closes = 0;
    const renderer = await renderSheet({
      visible: true,
      onAdd: async () => { adds += 1; return deferredAdd.promise; },
      onClose: () => { closes += 1; },
    });
    const battle = renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 추가' });

    await act(async () => {
      battle.props.onPress();
      battle.props.onPress();
    });
    assert.equal(adds, 1);
    assert.equal(closes, 0);

    await act(async () => { deferredAdd.resolve(true); await deferredAdd.promise; });
    assert.equal(closes, 1);
  });

  it('keeps the sheet open when add fails', async () => {
    let closes = 0;
    const renderer = await renderSheet({
      visible: true,
      onAdd: async () => false,
      onClose: () => { closes += 1; },
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 추가' }).props.onPress();
    });
    assert.equal(closes, 0);
    assert.equal(findHost(renderer.root, 'Modal').props.visible, true);
  });

  it('ignores a deferred add completion after the sheet unmounts', async () => {
    const pending = deferred<boolean>();
    let closes = 0;
    const renderer = await renderSheet({
      visible: true,
      onAdd: async () => pending.promise,
      onClose: () => { closes += 1; },
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 추가' }).props.onPress();
    });
    await act(async () => { renderer.unmount(); });

    await act(async () => { pending.resolve(true); await pending.promise; });
    assert.equal(closes, 0);
  });
});

describe('UnifiedAutomationSettings mounted interactions', () => {
  it('opens from the single trigger, closes after success, and stays open after failure', async () => {
    let addSucceeds = true;
    const renderer = await renderSettings({
      onAdd: async () => addSucceeds,
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '자동화 추가' }).props.onPress();
    });
    assert.equal(visibleModals(renderer.root).length, 1);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 추가' }).props.onPress();
    });
    assert.equal(visibleModals(renderer.root).length, 0);

    addSucceeds = false;
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '자동화 추가' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 추가' }).props.onPress();
    });
    assert.equal(visibleModals(renderer.root).length, 1);

    await act(async () => { visibleModals(renderer.root)[0]?.props.onRequestClose(); });
    assert.equal(visibleModals(renderer.root).length, 0);
  });

  it('disables the single add trigger when all types exist', async () => {
    const renderer = await renderSettings({
      entries: [entry(1, 'QUEST'), entry(2, 'BATTLE_MAP'), entry(3, 'ADVENTURE_MAP')],
    });
    const trigger = renderer.root.findByProps({ accessibilityLabel: '모든 자동화가 추가되었습니다' });

    assert.equal(trigger.props.disabled, true);
    assert.equal(trigger.props.accessibilityState.disabled, true);
  });

  it('opens details from the row, confirms swipe delete, and disables both while busy', async () => {
    const quest = entry(1, 'QUEST');
    let detailed: TypedAutomationEntryResponse | null = null;
    const deleted: number[] = [];
    const props = settingsProps({
      entries: [quest],
      onDelete: async (id) => { deleted.push(id); return true; },
      onDetail: (candidate) => { detailed = candidate; },
    });
    const renderer = await renderElement(React.createElement(UnifiedAutomationSettings, props));
    const swipeable = findHost(renderer.root, 'ReanimatedSwipeable');
    const swipeableMethods = swipeable.props.mockMethods as SwipeableMockMethods;

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '퀘스트 상세 설정' }).props.onPress();
    });
    assert.equal(detailed, quest);
    assert.equal(swipeableMethods.closeCalls, 1);
    assert.equal(
      renderer.root.findAllByProps({ accessibilityLabel: '퀘스트 더 보기' }).length,
      0,
    );

    await act(async () => {
      renderer.update(withSafeArea(React.createElement(UnifiedAutomationSettings, {
        ...props,
        savingEntryIds: [1],
      })));
    });
    assert.equal(
      renderer.root.findByProps({ accessibilityLabel: '퀘스트 삭제' }).props.disabled,
      true,
    );
    assert.equal(
      renderer.root.findByProps({ accessibilityLabel: '퀘스트 상세 설정' }).props.disabled,
      true,
    );
    await act(async () => {
      renderer.update(withSafeArea(React.createElement(UnifiedAutomationSettings, props)));
    });

    alertArguments = null;
    renderer.root.findByProps({ accessibilityLabel: '퀘스트 삭제' }).props.onPress();
    assert.ok(alertArguments);
    const actions = alertArguments[2] as Array<{ text: string; onPress?: () => void }>;
    assert.deepEqual(actions.map(({ text }) => text), ['취소', '삭제']);
    await act(async () => { actions[1]?.onPress?.(); });
    assert.deepEqual(deleted, [1]);
  });

  it('offers delete as an accessibility action on the detail target', async () => {
    const renderer = await renderSettings({ entries: [entry(1, 'QUEST')] });
    const detail = renderer.root.findByProps({ accessibilityLabel: '퀘스트 상세 설정' });

    assert.deepEqual(detail.props.accessibilityActions, [{ name: 'delete', label: '삭제' }]);
    alertArguments = null;
    detail.props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
    assert.ok(alertArguments);
  });

  it('closes the previously open swipe row when another row opens', async () => {
    const renderer = await renderSettings({
      entries: [entry(1, 'QUEST'), entry(2, 'BATTLE_MAP')],
    });
    const swipeables = renderer.root.findAll(({ type }) => String(type) === 'ReanimatedSwipeable');
    const firstMethods = swipeables[0]?.props.mockMethods as SwipeableMockMethods;

    swipeables[0]?.props.onSwipeableWillOpen();
    swipeables[1]?.props.onSwipeableWillOpen();

    assert.equal(firstMethods.closeCalls, 1);
  });

  it('closes an open swipe row when the settings list unmounts', async () => {
    const renderer = await renderSettings({ entries: [entry(1, 'QUEST')] });
    const swipeable = findHost(renderer.root, 'ReanimatedSwipeable');
    const methods = swipeable.props.mockMethods as SwipeableMockMethods;
    swipeable.props.onSwipeableWillOpen();

    await act(async () => { renderer.unmount(); });

    assert.equal(methods.closeCalls, 1);
  });

  it('renders summary independently from warnings', async () => {
    const renderer = await renderSettings({
      entries: [entry(1, 'QUEST', { quests: [questSelection()], warnings: ['파티를 확인해 주세요'] })],
    });

    assert.equal(hasText(renderer.root, '선택 1개'), true);
    assert.equal(hasText(renderer.root, '파티를 확인해 주세요'), true);
  });

  it('forwards toggle and reordered data callbacks', async () => {
    const first = entry(1, 'QUEST');
    const second = entry(2, 'BATTLE_MAP');
    let toggled: TypedAutomationEntryResponse | null = null;
    let reordered: TypedAutomationEntryResponse[] = [];
    const renderer = await renderSettings({
      entries: [first, second],
      onReorder: (entries) => { reordered = entries; },
      onToggle: (candidate) => { toggled = candidate; },
    });

    renderer.root.findByProps({ accessibilityLabel: '퀘스트 끄기' }).props.onValueChange(false);
    findHost(renderer.root, 'DraggableFlatList').props.onDragEnd({
      data: [second, first],
      from: 0,
      to: 1,
    });
    assert.equal(toggled, first);
    assert.deepEqual(reordered, [second, first]);
  });

  it('offers bounded accessible reorder actions through the same reorder callback', async () => {
    const first = entry(1, 'QUEST');
    const second = entry(2, 'BATTLE_MAP');
    const third = entry(3, 'ADVENTURE_MAP');
    const reordered: TypedAutomationEntryResponse[][] = [];
    const props = settingsProps({
      entries: [first, second, third],
      onReorder: (items) => { reordered.push(items); },
    });
    const renderer = await renderElement(React.createElement(UnifiedAutomationSettings, props));
    const handles = () => [first, second, third].map((item) => renderer.root.findByProps({
      accessibilityLabel: `${AUTOMATION_LABELS[item.type]} 우선순위 이동`,
    }));

    assert.deepEqual(handles().map(({ props: handleProps }) => (
      handleProps.accessibilityActions.map(({ name }: { name: string }) => name)
    )), [['increment'], ['decrement', 'increment'], ['decrement']]);
    handles()[0].props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    assert.deepEqual(reordered, [[second, first, third]]);
    handles()[0].props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    assert.equal(reordered.length, 1);

    await act(async () => {
      renderer.update(withSafeArea(React.createElement(UnifiedAutomationSettings, {
        ...props,
        savingEntryIds: [1],
      })));
    });
    assert.equal(handles()[0].props.accessibilityState.disabled, true);
    handles()[0].props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    assert.equal(reordered.length, 1);
  });

  it('does not let an old add completion close a newly reopened sheet', async () => {
    const pending = deferred<boolean>();
    const renderer = await renderSettings({ onAdd: async () => pending.promise });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '자동화 추가' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 추가' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '자동화 추가 배경 닫기' }).props.onPress();
      renderer.root.findByProps({ accessibilityHint: '자동화 유형 선택 창을 엽니다' }).props.onPress();
    });

    await act(async () => { pending.resolve(true); await pending.promise; });
    assert.equal(visibleModals(renderer.root).length, 1);
  });

  it('moves focus into the add overlay and restores its invoking control on close', async () => {
    focusCalls.length = 0;
    const renderer = await renderSettings({ entries: [entry(1, 'QUEST')] });
    await act(async () => {
      renderer.root.findByProps({ accessibilityHint: '자동화 유형 선택 창을 엽니다' }).props.onPress();
    });
    await act(async () => { await delay(280); });
    await act(async () => {
      visibleModals(renderer.root)[0]?.props.onRequestClose();
    });
    await act(async () => { await delay(280); });
    assert.equal(focusLabel(focusCalls.at(-1)), '자동화 추가');
  });
});

function sheetProps(overrides: Partial<React.ComponentProps<typeof AutomationAddSheet>> = {}) {
  return {
    entries: [],
    error: null,
    pendingTypes: [],
    visible: false,
    onAdd: async (_type: AutomationType) => true,
    onClose: () => undefined,
    ...overrides,
  };
}

function settingsProps(overrides: Partial<React.ComponentProps<typeof UnifiedAutomationSettings>> = {}) {
  return {
    entries: [],
    error: null,
    reordering: false,
    savingEntryIds: [],
    savingTypes: [],
    onAdd: async (_type: AutomationType) => true,
    onDelete: async (_entryId: number) => true,
    onDetail: (_entry: TypedAutomationEntryResponse) => undefined,
    onReorder: (_entries: TypedAutomationEntryResponse[]) => undefined,
    onToggle: (_entry: TypedAutomationEntryResponse) => undefined,
    ...overrides,
  };
}

async function renderSheet(overrides: Partial<React.ComponentProps<typeof AutomationAddSheet>>) {
  return renderElement(React.createElement(AutomationAddSheet, sheetProps(overrides)));
}

async function renderSettings(overrides: Partial<React.ComponentProps<typeof UnifiedAutomationSettings>>) {
  return renderElement(React.createElement(UnifiedAutomationSettings, settingsProps(overrides)));
}

async function renderElement(element: React.ReactElement): Promise<ReactTestRenderer> {
  return renderRaw(withSafeArea(element));
}

async function renderRaw(element: React.ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (String(args[0]).includes('react-test-renderer is deprecated')) return;
    originalError(...args);
  };
  try {
    await act(async () => {
      renderer = create(
        element,
        {
          createNodeMock: (candidate) => {
            const props = candidate.props as Record<string, unknown>;
            return {
              accessibilityLabel: props.accessibilityLabel,
              nativeID: props.nativeID,
              type: candidate.type,
            };
          },
        },
      );
    });
  } finally {
    console.error = originalError;
  }
  return renderer!;
}

function withSafeArea(element: React.ReactElement): React.ReactElement {
  return React.createElement(
    safeAreaMock.SafeAreaProvider,
    {
      initialMetrics: safeAreaMetrics(),
    },
    element,
  );
}

function safeAreaMetrics() {
  return {
    frame: { x: 0, y: 0, width: 390, height: windowHeight },
    insets: { bottom: safeAreaBottom, left: 0, right: 0, top: 0 },
  };
}

function findAutomationChoices(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll(({ type, props }) => (
    String(type) === 'Pressable'
    &&
    props.accessibilityRole === 'button'
    && typeof props.accessibilityLabel === 'string'
    && /^(퀘스트|전투 맵|모험 맵) 자동화 (추가|추가됨)$/.test(props.accessibilityLabel)
  ));
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style && typeof style === 'object' ? style as Record<string, unknown> : {};
}

function findHost(root: ReactTestInstance, name: string): ReactTestInstance {
  return root.find(({ type }) => String(type) === name);
}

function visibleModals(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll(({ type, props }) => String(type) === 'Modal' && props.visible === true);
}

function hasText(root: ReactTestInstance, text: string): boolean {
  return root.findAll(({ type, children }) => (
    String(type) === 'Text' && children.includes(text)
  )).length > 0;
}

function entry(
  id: number,
  type: AutomationType,
  overrides: Partial<TypedAutomationEntryResponse> = {},
): TypedAutomationEntryResponse {
  return {
    id,
    type,
    enabled: true,
    priority: id - 1,
    ready: true,
    warnings: [],
    quests: [],
    battleMaps: [],
    adventureMaps: [],
    ...overrides,
    battleMapProgress: overrides.battleMapProgress ?? [],
  };
}

function questSelection() {
  return { questKey: 'daily', enabled: true, sourceOrder: 0, maps: [] };
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function focusLabel(node: unknown): unknown {
  return node && typeof node === 'object'
    ? (node as { accessibilityLabel?: unknown }).accessibilityLabel
    : undefined;
}
