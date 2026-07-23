import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

type Row = { id: string; label: string };
type SwipeableMockMethods = { close: () => void; closeCalls: number };

const dragCalls: Row[] = [];
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  const nodeRef = React.useRef<Record<string, unknown>>({});
  Object.assign(nodeRef.current, props);
  React.useImperativeHandle(ref, () => nodeRef.current, []);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const draggableFlatList = (props: Record<string, unknown>) => React.createElement(
  'DraggableFlatList',
  props,
  (props.data as Row[]).map((item, index) => React.createElement(
    React.Fragment,
    { key: (props.keyExtractor as (value: Row) => string)(item) },
    (props.renderItem as (value: {
      item: Row;
      drag: () => void;
      getIndex: () => number;
      isActive: boolean;
    }) => React.ReactNode)({
      item,
      drag: () => { dragCalls.push(item); },
      getIndex: () => index,
      isActive: false,
    }),
  )),
);
const reanimatedSwipeable = React.forwardRef<SwipeableMockMethods, Record<string, unknown>>((props, ref) => {
  const methods = React.useMemo<SwipeableMockMethods>(() => ({
    closeCalls: 0,
    close() { methods.closeCalls += 1; },
  }), []);
  React.useImperativeHandle(ref, () => methods, [methods]);
  const renderRightActions = props.renderRightActions as ((...args: unknown[]) => React.ReactNode) | undefined;
  return React.createElement(
    'ReanimatedSwipeable',
    { ...props, mockMethods: methods },
    props.children as React.ReactNode,
    renderRightActions?.(null, null, methods),
  );
});
const reactNativeMock = {
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  View: host('View'),
};
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') return iconsMock;
  if (request === 'react-native-draggable-flatlist') return { __esModule: true, default: draggableFlatList };
  if (request === 'react-native-gesture-handler/ReanimatedSwipeable') {
    return { __esModule: true, default: reanimatedSwipeable };
  }
  return originalLoad(request, parent, isMain);
};
const { AutomationMapOrderList } = require(
  '../../main/features/automation/components/AutomationMapOrderList',
) as typeof import('../../main/features/automation/components/AutomationMapOrderList');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AutomationMapOrderList', () => {
  it('starts drag from the handle and reports the finished identity order', async () => {
    dragCalls.length = 0;
    const reorders: string[][] = [];
    const renderer = await renderList({ onReorder: (orderedIds) => { reorders.push(orderedIds); } });

    const firstHandle = renderer.root.findByProps({ accessibilityLabel: 'Alpha 1번째 맵 순서 이동' });
    await act(async () => { firstHandle.props.onLongPress(); });
    assert.deepEqual(dragCalls.map(({ id }) => id), ['a']);

    const draggable = findHost(renderer.root, 'DraggableFlatList');
    await act(async () => {
      draggable.props.onDragEnd({ data: [row('b', 'Beta'), row('a', 'Alpha')], from: 0, to: 1 });
    });
    assert.deepEqual(reorders, [['b', 'a']]);
  });

  it('keeps visible breathing room between adjacent cards', async () => {
    const renderer = await renderList();
    const draggable = findHost(renderer.root, 'DraggableFlatList');
    const Separator = draggable.props.ItemSeparatorComponent as () => React.ReactElement;

    assert.ok(Separator);
    const separator = Separator() as React.ReactElement<{ style: { height?: number } }>;
    assert.equal(separator.props.style.height, 8);
  });

  it('offers bounded accessible movement and deletion from the drag handle', async () => {
    const moves: Array<[string, -1 | 1]> = [];
    const deletes: string[] = [];
    const renderer = await renderList({
      onDelete: (id) => { deletes.push(id); },
      onMove: (id, offset) => { moves.push([id, offset]); },
    });
    const first = renderer.root.findByProps({ accessibilityLabel: 'Alpha 1번째 맵 순서 이동' });
    const second = renderer.root.findByProps({ accessibilityLabel: 'Beta 2번째 맵 순서 이동' });
    assert.deepEqual(first.props.accessibilityActions.map(({ name }: { name: string }) => name), ['increment', 'delete']);
    assert.deepEqual(second.props.accessibilityActions.map(({ name }: { name: string }) => name), ['decrement', 'delete']);
    assert.deepEqual(first.props.accessibilityValue, { min: 1, max: 2, now: 1 });

    await act(async () => {
      first.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
      second.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
      second.props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
    });
    assert.deepEqual(moves, [['a', 1], ['b', -1]]);
    assert.deepEqual(deletes, ['b']);
  });

  it('closes the previous swipe row and deletes only from the revealed right action', async () => {
    const deletes: string[] = [];
    const renderer = await renderList({ onDelete: (id) => { deletes.push(id); } });
    const swipeables = findHosts(renderer.root, 'ReanimatedSwipeable');
    const firstMethods = swipeables[0]!.props.mockMethods as SwipeableMockMethods;

    await act(async () => {
      swipeables[0]!.props.onSwipeableWillOpen();
      swipeables[1]!.props.onSwipeableWillOpen();
    });
    assert.equal(firstMethods.closeCalls, 1);

    const deleteButton = renderer.root.findByProps({ accessibilityLabel: 'Beta 삭제' });
    await act(async () => { deleteButton.props.onPress(); });
    assert.deepEqual(deletes, ['b']);
  });

  it('disables every interaction while busy', async () => {
    const deletes: string[] = [];
    const moves: Array<[string, -1 | 1]> = [];
    const renderer = await renderList({
      disabled: true,
      onDelete: (id) => { deletes.push(id); },
      onMove: (id, offset) => { moves.push([id, offset]); },
    });
    assert.equal(findHosts(renderer.root, 'ReanimatedSwipeable').every(({ props }) => props.enabled === false), true);
    const handle = renderer.root.findByProps({ accessibilityLabel: 'Alpha 1번째 맵 순서 이동' });
    const deleteButton = renderer.root.findByProps({ accessibilityLabel: 'Alpha 삭제' });
    assert.equal(handle.props.disabled, true);
    assert.equal(deleteButton.props.disabled, true);

    await act(async () => {
      handle.props.onLongPress();
      handle.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
      deleteButton.props.onPress();
    });
    assert.deepEqual(moves, []);
    assert.deepEqual(deletes, []);
  });

  it('closes open rows and fences retained callbacks after its data changes', async () => {
    const deletes: string[] = [];
    const reorders: string[][] = [];
    let renderer = await renderList({
      onDelete: (id) => { deletes.push(id); },
      onReorder: (orderedIds) => { reorders.push(orderedIds); },
    });
    const swipeable = findHosts(renderer.root, 'ReanimatedSwipeable')[0]!;
    const methods = swipeable.props.mockMethods as SwipeableMockMethods;
    const retainedDelete = renderer.root.findByProps({ accessibilityLabel: 'Alpha 삭제' }).props.onPress as () => void;
    const retainedDragEnd = findHost(renderer.root, 'DraggableFlatList').props.onDragEnd as (value: unknown) => void;
    await act(async () => { swipeable.props.onSwipeableWillOpen(); });

    await act(async () => {
      renderer.update(element({
        data: [row('b', 'Beta')],
        onDelete: (id) => { deletes.push(id); },
        onReorder: (orderedIds) => { reorders.push(orderedIds); },
      }));
    });
    assert.ok(methods.closeCalls >= 1);
    await act(async () => {
      retainedDelete();
      retainedDragEnd({ data: [row('b', 'Beta'), row('a', 'Alpha')], from: 0, to: 1 });
    });
    assert.deepEqual(deletes, []);
    assert.deepEqual(reorders, []);

    await act(async () => { renderer.unmount(); });
  });
});

type Overrides = Partial<React.ComponentProps<typeof AutomationMapOrderList<Row>>>;

async function renderList(overrides: Overrides = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(element(overrides)); });
  return renderer;
}

function element(overrides: Overrides = {}) {
  return React.createElement(AutomationMapOrderList<Row>, {
    data: [row('a', 'Alpha'), row('b', 'Beta')],
    disabled: false,
    getId: ({ id }) => id,
    getLabel: ({ label }) => label,
    onDelete: () => undefined,
    onMove: () => undefined,
    onReorder: () => undefined,
    renderContent: ({ label }, { disabled, index }) => React.createElement(
      'Content',
      { disabled, index, label },
      label,
    ),
    ...overrides,
  });
}

function row(id: string, label = id): Row {
  return { id, label };
}

function findHost(root: ReactTestInstance, name: string): ReactTestInstance {
  return root.find((node) => (node.type as unknown) === name);
}

function findHosts(root: ReactTestInstance, name: string): ReactTestInstance[] {
  return root.findAll((node) => (node.type as unknown) === name);
}
