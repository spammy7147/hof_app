import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import { resolve } from 'node:path';
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

const host = (name: string) => (props: Record<string, unknown>) => (
  React.createElement(name, props, props.children as React.ReactNode)
);
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

const reactNativeMock = {
  AccessibilityInfo: {
    announceForAccessibility: () => undefined,
    setAccessibilityFocus: () => undefined,
  },
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: (...args: unknown[]) => { alertArguments = args; } },
  findNodeHandle: () => 1,
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
const safeAreaMock = {
  SafeAreaProvider: host('SafeAreaProvider'),
  useSafeAreaInsets: () => ({ bottom: safeAreaBottom, left: 0, right: 0, top: 0 }),
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
  if (request === 'lucide-react-native') return iconsMock;
  if (request === 'react-native-safe-area-context') return safeAreaMock;
  if (request === 'react-native-draggable-flatlist') {
    return {
      NestableDraggableFlatList: draggableList,
    };
  }
  return originalLoad(request, parent, isMain);
};

const { AutomationAddSheet } = require(
  '../../main/features/automation/components/AutomationAddSheet',
) as typeof import('../../main/features/automation/components/AutomationAddSheet');
const { UnifiedAutomationSettings } = require(
  '../../main/features/automation/components/UnifiedAutomationSettings',
) as typeof import('../../main/features/automation/components/UnifiedAutomationSettings');
const { theme } = require('../../main/styles/theme') as typeof import('../../main/styles/theme');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('AutomationAddSheet mounted interactions', () => {
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

  it('opens overflow detail and delete actions, confirms delete, and disables them while busy', async () => {
    const quest = entry(1, 'QUEST');
    let detailed: TypedAutomationEntryResponse | null = null;
    const deleted: number[] = [];
    const props = settingsProps({
      entries: [quest],
      onDelete: async (id) => { deleted.push(id); return true; },
      onDetail: (candidate) => { detailed = candidate; },
    });
    const renderer = await renderElement(React.createElement(UnifiedAutomationSettings, props));

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '퀘스트 더 보기' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '퀘스트 상세 설정' }).props.onPress();
    });
    assert.equal(detailed, quest);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '퀘스트 더 보기' }).props.onPress();
    });
    await act(async () => {
      renderer.update(React.createElement(UnifiedAutomationSettings, {
        ...props,
        savingEntryIds: [1],
      }));
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
      renderer.update(React.createElement(UnifiedAutomationSettings, props));
    });

    renderer.root.findByProps({ accessibilityLabel: '퀘스트 삭제' }).props.onPress();
    assert.ok(alertArguments);
    const actions = alertArguments[2] as Array<{ text: string; onPress?: () => void }>;
    assert.deepEqual(actions.map(({ text }) => text), ['취소', '삭제']);
    await act(async () => { actions[1]?.onPress?.(); });
    assert.deepEqual(deleted, [1]);
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

  it('uses the same semantic overlay for the overflow menu', async () => {
    const renderer = await renderSettings({ entries: [entry(1, 'QUEST')] });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '퀘스트 더 보기' }).props.onPress();
    });
    const backdrop = renderer.root.findByProps({ accessibilityLabel: '자동화 메뉴 닫기' });

    assert.equal(flattenStyle(backdrop.props.style).backgroundColor, theme.colors.overlay);
  });
});

describe('safe-area application integration', () => {
  it('provides native safe-area insets at the app root', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/main/App.tsx'), 'utf8');
    assert.match(appSource, /SafeAreaProvider/);
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
  let renderer: ReactTestRenderer | undefined;
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (String(args[0]).includes('react-test-renderer is deprecated')) return;
    originalError(...args);
  };
  try {
    await act(async () => { renderer = create(element); });
  } finally {
    console.error = originalError;
  }
  return renderer!;
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
  };
}

function questSelection() {
  return { questCode: 'daily', enabled: true, sourceOrder: 0, maps: [] };
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}
