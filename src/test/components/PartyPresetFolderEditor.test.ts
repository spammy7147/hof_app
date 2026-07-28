import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import {
  indexPartyPresetCatalog,
  type PartyPresetCatalogIndex,
} from '../../main/domain/partyPresetCatalog';
import type { PartyPresetCatalogResponse, PartyPresetFolderResponse } from '../../main/types/api';

let nextAnimationFrameId = 1;
const animationFrames = new Map<number, FrameRequestCallback>();
(globalThis as typeof globalThis & {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
}).requestAnimationFrame = (callback) => {
  const id = nextAnimationFrameId++;
  animationFrames.set(id, callback);
  return id;
};
(globalThis as typeof globalThis).cancelAnimationFrame = (id?: number | null) => {
  if (id != null) animationFrames.delete(id);
};

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({}), []);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const listScrollCalls: number[] = [];
const flatList = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({
    scrollToOffset: ({ offset }: { offset: number }) => { listScrollCalls.push(offset); },
  }), []);
  return React.createElement(
    'FlatList',
    props,
    props.ListHeaderComponent as React.ReactNode,
    (props.data as unknown[]).map((item, index) => {
      const key = (props.keyExtractor as (value: unknown) => string)(item);
      const child = (props.renderItem as (value: { item: unknown; index: number }) => React.ReactNode)({ item, index });
      const Cell = props.CellRendererComponent as React.ComponentType<Record<string, unknown>> | undefined;
      return Cell == null
        ? React.createElement(React.Fragment, { key }, child)
        : React.createElement(Cell, { cellKey: key, index, item, key, onLayout: () => undefined, style: {} }, child);
    }),
  );
});

type GestureMock = {
  config: Record<string, unknown>;
  activateAfterLongPress(value: number): GestureMock;
  enabled(value: boolean): GestureMock;
  onStart(callback: (event: Record<string, number>) => void): GestureMock;
  onUpdate(callback: (event: Record<string, number>) => void): GestureMock;
  onEnd(callback: () => void): GestureMock;
  onFinalize(callback: () => void): GestureMock;
  runOnJS(value: boolean): GestureMock;
};
const gestures: GestureMock[] = [];
function panGesture(): GestureMock {
  const gesture: GestureMock = {
    config: {},
    activateAfterLongPress(value) { gesture.config.activateAfterLongPress = value; return gesture; },
    enabled(value) { gesture.config.enabled = value; return gesture; },
    onStart(callback) { gesture.config.onStart = callback; return gesture; },
    onUpdate(callback) { gesture.config.onUpdate = callback; return gesture; },
    onEnd(callback) { gesture.config.onEnd = callback; return gesture; },
    onFinalize(callback) { gesture.config.onFinalize = callback; return gesture; },
    runOnJS(value) { gesture.config.runOnJS = value; return gesture; },
  };
  gestures.push(gesture);
  return gesture;
}

const reactNativeMock = {
  FlatList: flatList,
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  TextInput: host('TextInput'),
  View: host('View'),
};
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
const closedSwipeableIds: number[] = [];
const reanimatedSwipeable = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  const folderId = Number(String(props.testID).replace('party-preset-folder-swipeable-', ''));
  React.useImperativeHandle(ref, () => ({
    close: () => { closedSwipeableIds.push(folderId); },
  }), [folderId]);
  const rightActions = (props.renderRightActions as (() => React.ReactNode) | undefined)?.();
  return React.createElement('ReanimatedSwipeable', props, props.children as React.ReactNode, rightActions);
});
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') return iconsMock;
  if (request === 'react-native-gesture-handler') {
    return { Gesture: { Pan: panGesture }, GestureDetector: host('GestureDetector') };
  }
  if (request === 'react-native-gesture-handler/ReanimatedSwipeable') return reanimatedSwipeable;
  return originalLoad(request, parent, isMain);
};
const { PartyPresetFolderEditor } = require(
  '../../main/components/PartyPresetFolderEditor',
) as typeof import('../../main/components/PartyPresetFolderEditor');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PartyPresetFolderEditor', () => {
  it('wraps each visible folder row in the common configured swipeable delete action', async () => {
    closedSwipeableIds.length = 0;
    const renderer = await renderEditor();
    const swipeables = renderer.root.findAllByType('ReanimatedSwipeable' as never);
    assert.equal(swipeables.length, 3);
    for (const row of [
      { id: 1, name: 'New1' }, { id: 2, name: 'new2' }, { id: 3, name: 'Other' },
    ]) {
      const swipeable = renderer.root.findByProps({ testID: `party-preset-folder-swipeable-${row.id}` });
      assert.equal(swipeable.props.enabled, true);
      assert.equal(swipeable.props.friction, 2);
      assert.equal(swipeable.props.overshootRight, false);
      assert.equal(swipeable.props.rightThreshold, 40);
      assert.equal(flattenStyle(swipeable.props.containerStyle).overflow, 'hidden');
      const action = renderer.root.findByProps({ accessibilityLabel: `${row.name} 폴더 삭제` });
      assert.equal(flattenStyle(action.props.style({ pressed: false })).width, 72);
      assert.equal(flattenStyle(action.props.style({ pressed: false })).backgroundColor, '#ff7b7b');
      assert.equal(textCount(action, '삭제'), 1);
      assert.equal(action.findAllByType('Trash2' as never).length, 1);
    }
  });

  it('deletes once and closes the active swipe from its right action or move-handle accessibility action', async () => {
    closedSwipeableIds.length = 0;
    const deleted: number[] = [];
    const renderer = await renderEditor({ onDelete: async (folderId) => { deleted.push(folderId); } });
    const swipeable = renderer.root.findByProps({ testID: 'party-preset-folder-swipeable-1' });
    await act(async () => { swipeable.props.onSwipeableWillOpen(); });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 삭제' }).props.onPress();
      renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 위치 이동' }).props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
    });
    assert.deepEqual(deleted, [1]);
    assert.deepEqual(closedSwipeableIds, [1]);
  });

  it('closes the previously active row when another row starts opening', async () => {
    closedSwipeableIds.length = 0;
    const renderer = await renderEditor();
    await act(async () => {
      renderer.root.findByProps({ testID: 'party-preset-folder-swipeable-1' }).props.onSwipeableWillOpen();
      renderer.root.findByProps({ testID: 'party-preset-folder-swipeable-3' }).props.onSwipeableWillOpen();
    });
    assert.deepEqual(closedSwipeableIds, [1]);
  });

  it('closes an active swipe before rename, child creation, dragging, disabled rerender, catalog replacement, and unmount', async () => {
    closedSwipeableIds.length = 0;
    const renderer = await renderEditor();
    const open = async () => {
      await act(async () => { renderer.root.findByProps({ testID: 'party-preset-folder-swipeable-1' }).props.onSwipeableWillOpen(); });
    };
    await open();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름' }).props.onBlur(); });
    await open();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가 취소' }).props.onPress(); });
    await open();
    const startDrag = gestureFor(renderer.root, 'New1 폴더 위치 이동').config.onStart as
      | ((event: Record<string, number>) => void)
      | undefined;
    await act(async () => { startDrag?.({ y: 10 }); });
    await open();
    await act(async () => { renderer.update(element({ disabled: true })); });
    await act(async () => { renderer.update(element()); });
    await open();
    await act(async () => { renderer.update(element({ index: indexPartyPresetCatalog({ folders: [folder(9, 'Replacement', null, 0)], presets: [] }) })); });
    await act(async () => { renderer.root.findByProps({ testID: 'party-preset-folder-swipeable-9' }).props.onSwipeableWillOpen(); });
    await act(async () => { renderer.unmount(); });
    assert.deepEqual(closedSwipeableIds, [1, 1, 1, 1, 1, 9]);
  });

  it('keeps the child-create editor outside the swipeable and disables swipe while renaming or disabled', async () => {
    closedSwipeableIds.length = 0;
    const deleted: number[] = [];
    const renderer = await renderEditor({ onDelete: async (folderId) => { deleted.push(folderId); } });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가' }).props.onPress(); });
    const swipeable = renderer.root.findByProps({ testID: 'party-preset-folder-swipeable-1' });
    assert.ok(swipeable.findByProps({ testID: 'party-preset-folder-row-1' }));
    assert.equal(swipeable.findAllByProps({ accessibilityLabel: 'New1 새 하위 폴더 이름' }).length, 0);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가 취소' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' }).props.onPress(); });
    assert.equal(renderer.root.findByProps({ testID: 'party-preset-folder-swipeable-1' }).props.enabled, false);
    const handle = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 위치 이동' });
    assert.ok(handle.props.accessibilityActions.some((action: { name: string; label: string }) => action.name === 'delete' && action.label === '삭제'));
    await act(async () => { renderer.update(element({ disabled: true })); });
    assert.equal(renderer.root.findByProps({ testID: 'party-preset-folder-swipeable-1' }).props.enabled, false);
    await act(async () => { handle.props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } }); });
    assert.deepEqual(deleted, []);
  });

  it('renders the full expanded tree once with compact hierarchy and exact controls', async () => {
    const renderer = await renderEditor();
    assert.equal(textCount(renderer.root, 'New1'), 1);
    assert.equal(textCount(renderer.root, 'new2'), 1);
    assert.equal(findAllText(renderer.root).some((text) => text.includes('루트')), false);
    assert.equal(renderer.root.findAllByType('Folder' as never).length, 0);
    assert.equal(findAllText(renderer.root).some((text) => /\d+개/.test(text)), false);

    const edit = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' });
    const add = renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가' });
    const grip = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 위치 이동' });
    assertBorderless(edit);
    assertBorderless(add);
    assertBorderless(grip);
    const rowStyle = flattenStyle(renderer.root.findByProps({ testID: 'party-preset-folder-row-1' }).props.style);
    assert.equal(rowStyle.minHeight, 44);
    assert.equal(rowStyle.paddingVertical, 1);
    const childStyle = flattenStyle(renderer.root.findByProps({ testID: 'party-preset-folder-row-2' }).props.style);
    assert.ok((childStyle.paddingLeft as number) > (rowStyle.paddingLeft as number));
    assert.equal(childStyle.borderLeftWidth ?? 0, 0);
    assert.deepEqual(connectorLefts(renderer.root, 2), [8]);
    assert.ok(renderer.root.findByType('FlatList' as never).props.CellRendererComponent);

    const row = renderer.root.findByProps({ testID: 'party-preset-folder-row-1' });
    assert.deepEqual(hostAccessibilityLabels(row), [
      'New1 폴더 접기',
      'New1 폴더 이름 수정',
      'New1 하위 폴더 추가',
      'New1 폴더 위치 이동',
    ]);
  });

  it('caps malformed six-level input at the fifth supported visual level', async () => {
    const renderer = await renderEditor({
      index: malformedSixLevelIndex(),
    });
    assert.deepEqual(connectorLefts(renderer.root, 1), []);
    assert.deepEqual(connectorLefts(renderer.root, 3), [8, 24]);
    assert.deepEqual(connectorLefts(renderer.root, 5), [8, 24, 40, 56]);
    assert.deepEqual(connectorLefts(renderer.root, 6), [8, 24, 40, 56]);
    assert.equal(rowPaddingLeft(renderer.root, 5), 72);
    assert.equal(rowPaddingLeft(renderer.root, 6), 72);
  });

  it('adds top-level and inline child folders without naming their location root', async () => {
    const requests: Array<{ name: string; parentFolderId: number | null }> = [];
    const renderer = await renderEditor({ onCreate: async (request) => { requests.push(request); } });

    const topInput = renderer.root.findByProps({ accessibilityLabel: '새 최상위 폴더 이름' });
    await act(async () => { topInput.props.onChangeText('top'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '최상위 폴더 추가' }).props.onPress(); });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가' }).props.onPress();
    });
    const childInput = renderer.root.findByProps({ accessibilityLabel: 'New1 새 하위 폴더 이름' });
    await act(async () => { childInput.props.onChangeText('new3'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 저장' }).props.onPress(); });

    assert.deepEqual(requests, [
      { name: 'top', parentFolderId: null },
      { name: 'new3', parentFolderId: 1 },
    ]);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가 취소' }).props.onPress(); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'New1 새 하위 폴더 이름' }).length, 0);
    assert.equal(requests.length, 2);
  });

  it('blocks sixth-level child creation while allowing a fifth-level child', async () => {
    const requests: Array<{ name: string; parentFolderId: number | null }> = [];
    const renderer = await renderEditor({
      index: indexPartyPresetCatalog({
        folders: [
          folder(1, 'L1', null, 0), folder(2, 'L2', 1, 0),
          folder(3, 'L3', 2, 0), folder(4, 'L4', 3, 0), folder(5, 'L5', 4, 0),
        ],
        presets: [],
      }),
      onCreate: async (request) => { requests.push(request); },
    });
    const depthFourAdd = renderer.root.findByProps({ accessibilityLabel: 'L5 하위 폴더 추가' });
    assert.equal(depthFourAdd.props.disabled, true);
    assert.deepEqual(depthFourAdd.props.accessibilityState, { disabled: true });
    await act(async () => { depthFourAdd.props.onPress(); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'L5 새 하위 폴더 이름' }).length, 0);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'L4 하위 폴더 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'L4 새 하위 폴더 이름' }).props.onChangeText('allowed'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'L4 하위 폴더 저장' }).props.onPress(); });
    assert.deepEqual(requests, [{ name: 'allowed', parentFolderId: 4 }]);
  });

  it('revalidates depth before a stale child-create panel can submit', async () => {
    const requests: unknown[] = [];
    const initial = indexPartyPresetCatalog({
      folders: [folder(1, 'Target', null, 0)],
      presets: [],
    });
    const renderer = await renderEditor({ index: initial, onCreate: async (...args) => { requests.push(args); } });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Target 하위 폴더 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Target 새 하위 폴더 이름' }).props.onChangeText('stale'); });
    const staleSubmit = renderer.root.findByProps({ accessibilityLabel: 'Target 하위 폴더 저장' }).props.onPress as () => void;
    const deepIndex = indexPartyPresetCatalog({
      folders: [
        folder(10, 'L1', null, 0), folder(11, 'L2', 10, 0),
        folder(12, 'L3', 11, 0), folder(13, 'L4', 12, 0), folder(1, 'Target', 13, 0),
      ],
      presets: [],
    });
    await act(async () => { renderer.update(element({ index: deepIndex, onCreate: async (...args) => { requests.push(args); } })); });
    await act(async () => { staleSubmit(); });
    assert.deepEqual(requests, []);
  });

  it('edits a folder name in its existing row without rename action controls', async () => {
    const renames: Array<[number, { name: string }]> = [];
    const completion = deferred<boolean | void>();
    const renderer = await renderEditor({
      onRename: (id, request) => {
        renames.push([id, request]);
        return completion.promise;
      },
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' }).props.onPress(); });
    const row = renderer.root.findByProps({ testID: 'party-preset-folder-row-1' });
    const input = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름' });
    assert.ok(row.findByProps({ accessibilityLabel: 'New1 폴더 이름' }));
    assert.equal(input.props.autoFocus, true);
    assert.equal(input.props.selectTextOnFocus, true);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'New1 폴더 이름 저장' }).length, 0);
    assert.equal(row.findAllByProps({ accessibilityLabel: 'New1 폴더 삭제' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'New1 폴더 수정 취소' }).length, 0);
    await act(async () => { input.props.onChangeText(' Renamed '); });
    await act(async () => { input.props.onBlur(); });
    assert.deepEqual(renames, [[1, { name: 'Renamed' }]]);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름' }));

    await act(async () => {
      completion.resolve();
      await completion.promise;
    });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'New1 폴더 이름' }).length, 0);
    assert.equal(textCount(renderer.root, 'New1'), 1);

    await act(async () => {
      renderer.update(element({
        index: indexPartyPresetCatalog({
          folders: [folder(1, 'Renamed', null, 0), folder(2, 'new2', 1, 0), folder(3, 'Other', null, 1)],
          presets: [],
        }),
        onRename: () => completion.promise,
      }));
    });
    assert.equal(textCount(renderer.root, 'Renamed'), 1);
  });

  it('deduplicates keyboard submit and blur while renaming', async () => {
    const renames: Array<[number, { name: string }]> = [];
    const completion = deferred<boolean | void>();
    const renderer = await renderEditor({
      onRename: (id, request) => {
        renames.push([id, request]);
        return completion.promise;
      },
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' }).props.onPress(); });
    const input = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름' });
    await act(async () => { input.props.onChangeText('Renamed'); });
    await act(async () => {
      input.props.onSubmitEditing();
      input.props.onBlur();
    });
    assert.deepEqual(renames, [[1, { name: 'Renamed' }]]);
    await act(async () => {
      completion.resolve();
      await completion.promise;
    });
  });

  it('abandons empty and unchanged folder rename values without mutating', async () => {
    const renames: Array<[number, { name: string }]> = [];
    const renderer = await renderEditor({
      onRename: async (id, request) => { renames.push([id, request]); },
    });

    for (const value of ['   ', ' New1 ']) {
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' }).props.onPress(); });
      const input = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름' });
      await act(async () => { input.props.onChangeText(value); });
      await act(async () => { input.props.onBlur(); });
      assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'New1 폴더 이름' }).length, 0);
      assert.equal(textCount(renderer.root, 'New1'), 1);
    }
    assert.deepEqual(renames, []);
  });

  it('restores the catalog name after a failed folder rename', async () => {
    const renderer = await renderEditor({ onRename: async () => false });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' }).props.onPress(); });
    const input = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름' });
    await act(async () => { input.props.onChangeText('Renamed'); });
    await act(async () => { input.props.onBlur(); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'New1 폴더 이름' }).length, 0);
    assert.equal(textCount(renderer.root, 'New1'), 1);
  });

  it('restores the catalog name after a rejected folder rename', async () => {
    const completion = deferred<boolean | void>();
    const renderer = await renderEditor({ onRename: () => completion.promise });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' }).props.onPress(); });
    const input = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름' });
    await act(async () => { input.props.onChangeText('Renamed'); });
    await act(async () => { input.props.onBlur(); });
    await act(async () => {
      completion.reject(new Error('rename failed'));
      await Promise.resolve();
    });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'New1 폴더 이름' }).length, 0);
    assert.equal(textCount(renderer.root, 'New1'), 1);
  });

  it('does not update state after unmounting with a pending folder rename', async () => {
    const resolved = deferred<boolean | void>();
    const resolvedRenderer = await renderEditor({ onRename: () => resolved.promise });
    await act(async () => { resolvedRenderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' }).props.onPress(); });
    const resolvedInput = resolvedRenderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름' });
    await act(async () => { resolvedInput.props.onChangeText('Renamed'); });
    await act(async () => { resolvedInput.props.onBlur(); });
    await act(async () => {
      resolvedRenderer.unmount();
      resolved.resolve();
      await resolved.promise;
    });

    const rejected = deferred<boolean | void>();
    const rejectedRenderer = await renderEditor({ onRename: () => rejected.promise });
    await act(async () => { rejectedRenderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' }).props.onPress(); });
    const rejectedInput = rejectedRenderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름' });
    await act(async () => { rejectedInput.props.onChangeText('Renamed'); });
    await act(async () => { rejectedInput.props.onBlur(); });
    await act(async () => {
      rejectedRenderer.unmount();
      rejected.reject(new Error('rename failed'));
      await Promise.resolve();
    });
  });

  it('preserves collapsed survivors and prunes deleted IDs without auto-expanding new or reintroduced folders', async () => {
    const renderer = await renderEditor({
      index: indexPartyPresetCatalog({
        folders: [
          folder(1, 'New1', null, 0), folder(2, 'new2', 1, 0),
          folder(3, 'Other', null, 1), folder(6, 'Other child', 3, 0),
        ],
        presets: [],
      }),
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 접기' }).props.onPress(); });
    await act(async () => {
      renderer.update(element({ index: indexPartyPresetCatalog({
        folders: [
          folder(1, 'New1', null, 0), folder(2, 'new2', 1, 0),
          folder(4, 'New folder', null, 1), folder(5, 'New child', 4, 0),
        ],
        presets: [],
      }) }));
    });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 펼치기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'New folder 폴더 펼치기' }));
    assert.equal(textCount(renderer.root, 'New child'), 0);

    await act(async () => {
      renderer.update(element({ index: indexPartyPresetCatalog({
        folders: [
          folder(1, 'New1', null, 0), folder(2, 'new2', 1, 0),
          folder(3, 'Other', null, 1), folder(6, 'Other child', 3, 0),
        ],
        presets: [],
      }) }));
    });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Other 폴더 펼치기' }));
    assert.equal(textCount(renderer.root, 'Other child'), 0);
  });

  it('toggles multiple parent disclosures independently', async () => {
    const renderer = await renderEditor({
      index: indexPartyPresetCatalog({
        folders: [
          folder(1, 'New1', null, 0), folder(2, 'new2', 1, 0),
          folder(3, 'Other', null, 1), folder(4, 'Other child', 3, 0),
        ],
        presets: [],
      }),
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 접기' }).props.onPress(); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 펼치기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Other 폴더 접기' }));
    assert.equal(textCount(renderer.root, 'Other child'), 1);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Other 폴더 접기' }).props.onPress(); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 펼치기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Other 폴더 펼치기' }));
  });

  it('uses measured quarter zones and moves new2 before a top-level target', async () => {
    const moves: Array<[number, { parentFolderId: number | null; displayOrder: number }]> = [];
    const renderer = await renderEditor({ onMove: async (id, request) => { moves.push([id, request]); } });
    layoutRows(renderer.root);

    const gesture = gestureFor(renderer.root, 'new2 폴더 위치 이동');
    assert.equal(gesture.config.activateAfterLongPress, 220);
    assert.equal(gesture.config.runOnJS, true);
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 24 });
    });
    assert.equal(hostTestIdCount(renderer.root, 'party-preset-folder-drop-line-before-3'), 1);
    await act(async () => { (gesture.config.onEnd as () => void)(); });

    assert.deepEqual(moves, [[2, { parentFolderId: null, displayOrder: 1 }]]);
    assert.equal(hostTestIdCount(renderer.root, 'party-preset-folder-top-level-drop-zone'), 0);
  });

  it('treats exact quarter boundaries as inside and renders each feedback kind', async () => {
    const renderer = await renderEditor();
    layoutRows(renderer.root);
    const gesture = gestureFor(renderer.root, 'new2 폴더 위치 이동');
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      // Other starts at 88, height 44: 99 is exactly .25 and therefore inside.
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 33 });
    });
    assert.equal(hostTestIdCount(renderer.root, 'party-preset-folder-drop-inside-3'), 1);
    await act(async () => {
      // 122 is > .75 of Other and therefore after.
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 56 });
    });
    assert.equal(hostTestIdCount(renderer.root, 'party-preset-folder-drop-line-after-3'), 1);
    assert.equal(hostTestIdCount(renderer.root, 'party-preset-folder-drag-preview'), 1);
  });

  it('clears a previous valid target when the pointer leaves measured rows', async () => {
    const moves: unknown[] = [];
    const renderer = await renderEditor({ onMove: async (...args) => { moves.push(args); } });
    layoutRows(renderer.root);
    const gesture = gestureFor(renderer.root, 'new2 폴더 위치 이동');
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 24 });
    });
    assert.equal(hostTestIdCount(renderer.root, 'party-preset-folder-drop-line-before-3'), 1);
    await act(async () => {
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 500 });
      (gesture.config.onEnd as () => void)();
    });
    assert.equal(hostTestIdCount(renderer.root, 'party-preset-folder-drop-line-before-3'), 0);
    assert.deepEqual(moves, []);
  });

  it('moves a nested folder after a top-level target', async () => {
    const moves: unknown[] = [];
    const renderer = await renderEditor({ onMove: async (...args) => { moves.push(args); } });
    layoutRows(renderer.root);
    const gesture = gestureFor(renderer.root, 'new2 폴더 위치 이동');
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 56 });
      (gesture.config.onEnd as () => void)();
    });
    assert.deepEqual(moves, [[2, { parentFolderId: null, displayOrder: 2 }]]);
  });

  it('moves accessibly only among siblings while escape outdents', async () => {
    const moves: Array<[number, { parentFolderId: number | null; displayOrder: number }]> = [];
    const renderer = await renderEditor({ onMove: async (id, request) => { moves.push([id, request]); } });
    const childGrip = renderer.root.findByProps({ accessibilityLabel: 'new2 폴더 위치 이동' });
    assert.deepEqual(childGrip.props.accessibilityActions, [
      { name: 'escape', label: '한 단계 위 폴더로 이동' },
      { name: 'delete', label: '삭제' },
    ]);
    const rootGrip = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 위치 이동' });
    assert.deepEqual(rootGrip.props.accessibilityActions, [
      { name: 'increment', label: '같은 위치에서 아래로 이동' },
      { name: 'delete', label: '삭제' },
    ]);
    await act(async () => {
      childGrip.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
      childGrip.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
      rootGrip.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
      childGrip.props.onAccessibilityAction({ nativeEvent: { actionName: 'escape' } });
    });
    assert.deepEqual(moves, [
      [1, { parentFolderId: null, displayOrder: 1 }],
      [2, { parentFolderId: null, displayOrder: 1 }],
    ]);
  });

  it('auto-scrolls at a list edge and drops against the newly reached measured target', async () => {
    listScrollCalls.length = 0;
    const moves: unknown[] = [];
    const roots = Array.from({ length: 8 }, (_, index) => folder(index + 1, `Root ${index + 1}`, null, index));
    const renderer = await renderEditor({
      index: indexPartyPresetCatalog({ folders: roots, presets: [] }),
      onMove: async (...args) => { moves.push(args); },
    });
    layoutRows(renderer.root);
    const list = renderer.root.findByType('FlatList' as never);
    list.props.onLayout({ nativeEvent: { layout: { height: 132 } } });
    list.props.onContentSizeChange(320, 352);
    const gesture = gestureFor(renderer.root, 'Root 1 폴더 위치 이동');
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 100 });
    });
    assert.deepEqual(listScrollCalls, [44]);
    await act(async () => { (gesture.config.onEnd as () => void)(); });
    assert.deepEqual(moves, [[1, { parentFolderId: null, displayOrder: 3 }]]);
  });

  it('continues edge scrolling across frames after only one gesture update', async () => {
    resetAnimationFrames();
    listScrollCalls.length = 0;
    const renderer = await renderLongRootList();
    const gesture = gestureFor(renderer.root, 'Root 1 폴더 위치 이동');
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 100 });
    });
    assert.deepEqual(listScrollCalls, [44]);
    assert.equal(animationFrames.size, 1);
    await act(async () => { flushAnimationFrames(2); });
    assert.deepEqual(listScrollCalls, [44, 88, 132]);
    assert.equal(animationFrames.size, 1);
    await act(async () => { (gesture.config.onFinalize as () => void)(); });
  });

  it('stops continuous scrolling when the pointer leaves the edge', async () => {
    resetAnimationFrames();
    listScrollCalls.length = 0;
    const renderer = await renderLongRootList();
    const gesture = gestureFor(renderer.root, 'Root 1 폴더 위치 이동');
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 100 });
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 44 });
    });
    assert.deepEqual(listScrollCalls, [44]);
    assert.equal(animationFrames.size, 0);
    await act(async () => { flushAnimationFrames(5); });
    assert.deepEqual(listScrollCalls, [44]);
  });

  it('cancels scheduled edge frames on finalize, unmount, and disabled transition', async () => {
    resetAnimationFrames();
    listScrollCalls.length = 0;
    const finalized = await renderLongRootList();
    const finalizedGesture = gestureFor(finalized.root, 'Root 1 폴더 위치 이동');
    await act(async () => {
      (finalizedGesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      (finalizedGesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 100 });
      (finalizedGesture.config.onFinalize as () => void)();
    });
    assert.equal(animationFrames.size, 0);
    await act(async () => { flushAnimationFrames(3); });
    assert.deepEqual(listScrollCalls, [44]);

    resetAnimationFrames();
    listScrollCalls.length = 0;
    const unmounted = await renderLongRootList();
    const unmountedGesture = gestureFor(unmounted.root, 'Root 1 폴더 위치 이동');
    await act(async () => {
      (unmountedGesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      (unmountedGesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 100 });
      unmounted.unmount();
    });
    assert.equal(animationFrames.size, 0);
    await act(async () => { flushAnimationFrames(3); });
    assert.deepEqual(listScrollCalls, [44]);

    resetAnimationFrames();
    listScrollCalls.length = 0;
    const disabled = await renderLongRootList();
    const disabledGesture = gestureFor(disabled.root, 'Root 1 폴더 위치 이동');
    await act(async () => {
      (disabledGesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      (disabledGesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 100 });
      disabled.update(element({
        disabled: true,
        index: indexPartyPresetCatalog({
          folders: Array.from({ length: 8 }, (_, index) => folder(index + 1, `Root ${index + 1}`, null, index)),
          presets: [],
        }),
      }));
    });
    assert.equal(animationFrames.size, 0);
    await act(async () => { flushAnimationFrames(3); });
    assert.deepEqual(listScrollCalls, [44]);
  });

  it('bounds repeated edge scrolling to the measured content size', async () => {
    listScrollCalls.length = 0;
    const roots = Array.from({ length: 8 }, (_, index) => folder(index + 1, `Root ${index + 1}`, null, index));
    const renderer = await renderEditor({ index: indexPartyPresetCatalog({ folders: roots, presets: [] }) });
    layoutRows(renderer.root);
    const list = renderer.root.findByType('FlatList' as never);
    list.props.onLayout({ nativeEvent: { layout: { height: 132 } } });
    list.props.onContentSizeChange(320, 352);
    const gesture = gestureFor(renderer.root, 'Root 1 폴더 위치 이동');
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      for (let index = 0; index < 8; index += 1) {
        (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 100 });
      }
      (gesture.config.onFinalize as () => void)();
    });
    assert.deepEqual(listScrollCalls, [44, 88, 132, 176, 220]);
  });

  it('keeps an inline rename within the compact row while resolving drag targets', async () => {
    const moves: unknown[] = [];
    const renderer = await renderEditor({ onMove: async (...args) => { moves.push(args); } });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' }).props.onPress(); });
    layoutRows(renderer.root, [0, 44, 88]);
    const gesture = gestureFor(renderer.root, 'new2 폴더 위치 이동');
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      // Content y=16 lies within New1's unchanged 44px folder row.
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: -50 });
    });
    assert.equal(hostTestIdCount(renderer.root, 'party-preset-folder-drop-inside-1'), 1);
    await act(async () => {
      renderer.root.findByType('FlatList' as never).props.onScroll({ nativeEvent: { contentOffset: { y: 44 } } });
      // The +44 scroll delta moves this content coordinate outside the last measured row.
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 24 });
      (gesture.config.onEnd as () => void)();
    });
    assert.deepEqual(moves, []);
  });

  it('expands a collapsed destination after a successful inside drop', async () => {
    const renderer = await renderEditor({
      index: indexPartyPresetCatalog({
        folders: [
          folder(1, 'New1', null, 0),
          folder(2, 'new2', 1, 0),
          folder(3, 'Other', null, 1),
          folder(4, 'Other child', 3, 0),
        ],
        presets: [],
      }),
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Other 폴더 접기' }).props.onPress(); });
    layoutRows(renderer.root);
    const gesture = gestureFor(renderer.root, 'new2 폴더 위치 이동');
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 44 });
      (gesture.config.onEnd as () => void)();
    });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Other 폴더 접기' }));
  });

  it('keeps editor state and does not expand a parent when an integrated mutation reports failure', async () => {
    const index = indexPartyPresetCatalog({
      folders: [
        folder(1, 'New1', null, 0), folder(2, 'new2', 1, 0),
        folder(3, 'Other', null, 1), folder(4, 'Other child', 3, 0),
      ],
      presets: [],
    });
    const renderer = await renderEditor({
      index,
      onCreate: async () => false,
      onMove: async () => false,
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 접기' }).props.onPress();
      renderer.root.findByProps({ accessibilityLabel: 'Other 폴더 접기' }).props.onPress();
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 새 하위 폴더 이름' }).props.onChangeText('fail'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 저장' }).props.onPress(); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 펼치기' }));
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'New1 새 하위 폴더 이름' }).props.value, 'fail');

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 펼치기' }).props.onPress(); });
    layoutRows(renderer.root);
    const gesture = gestureFor(renderer.root, 'new2 폴더 위치 이동');
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: 44 });
      (gesture.config.onEnd as () => void)();
      await Promise.resolve();
    });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Other 폴더 펼치기' }));
  });

  it('expands a genuinely collapsed parent after child creation succeeds', async () => {
    const creates: Array<{ name: string; parentFolderId: number | null }> = [];
    const renderer = await renderEditor({
      onCreate: async (request) => { creates.push(request); },
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 접기' }).props.onPress(); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 펼치기' }));
    assert.equal(textCount(renderer.root, 'new2'), 0);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 새 하위 폴더 이름' }).props.onChangeText('new3'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 저장' }).props.onPress(); });

    assert.deepEqual(creates, [{ name: 'new3', parentFolderId: 1 }]);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 접기' }));
    assert.equal(textCount(renderer.root, 'new2'), 1);
  });

  it('does not mutate frozen inputs and blocks mutations while disabled', async () => {
    const source = Object.freeze({
      folders: Object.freeze([
        Object.freeze(folder(1, 'New1', null, 0)),
        Object.freeze(folder(2, 'new2', 1, 0)),
      ]),
      presets: Object.freeze([]),
    }) as unknown as PartyPresetCatalogResponse;
    const calls: string[] = [];
    const renderer = await renderEditor({
      disabled: true,
      index: indexPartyPresetCatalog(source),
      onCreate: async () => { calls.push('create'); },
      onDelete: async () => { calls.push('delete'); },
      onMove: async () => { calls.push('move'); },
      onRename: async () => { calls.push('rename'); },
    });
    const edit = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 수정' });
    const add = renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가' });
    const grip = renderer.root.findByProps({ accessibilityLabel: 'new2 폴더 위치 이동' });
    assert.equal(edit.props.disabled, true);
    assert.equal(add.props.disabled, true);
    assert.equal(grip.props.disabled, true);
    assert.equal(gestureFor(renderer.root, 'new2 폴더 위치 이동').config.enabled, false);
    await act(async () => {
      edit.props.onPress();
      add.props.onPress();
      grip.props.onAccessibilityAction({ nativeEvent: { actionName: 'escape' } });
      renderer.root.findByProps({ accessibilityLabel: '최상위 폴더 추가' }).props.onPress();
    });
    assert.deepEqual(calls, []);
  });
});

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function renderEditor(overrides: Partial<React.ComponentProps<typeof PartyPresetFolderEditor>> = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(PartyPresetFolderEditor, {
      disabled: false,
      index: indexPartyPresetCatalog(catalog()),
      onCreate: async () => undefined,
      onDelete: async () => undefined,
      onMove: async () => undefined,
      onRename: async () => undefined,
      ...overrides,
    }));
  });
  return renderer;
}

async function renderLongRootList(): Promise<ReactTestRenderer> {
  const roots = Array.from({ length: 8 }, (_, index) => folder(index + 1, `Root ${index + 1}`, null, index));
  const renderer = await renderEditor({ index: indexPartyPresetCatalog({ folders: roots, presets: [] }) });
  layoutRows(renderer.root);
  const list = renderer.root.findByType('FlatList' as never);
  list.props.onLayout({ nativeEvent: { layout: { height: 132 } } });
  list.props.onContentSizeChange(320, 352);
  return renderer;
}

function element(overrides: Partial<React.ComponentProps<typeof PartyPresetFolderEditor>> = {}): React.ReactElement {
  return React.createElement(PartyPresetFolderEditor, {
    disabled: false,
    index: indexPartyPresetCatalog(catalog()),
    onCreate: async () => undefined,
    onDelete: async () => undefined,
    onMove: async () => undefined,
    onRename: async () => undefined,
    ...overrides,
  });
}

function catalog(): PartyPresetCatalogResponse {
  return {
    folders: [folder(1, 'New1', null, 0), folder(2, 'new2', 1, 0), folder(3, 'Other', null, 1)],
    presets: [],
  };
}

function malformedSixLevelIndex(): PartyPresetCatalogIndex {
  const folders = [
    folder(1, 'L1', null, 0),
    folder(2, 'L2', 1, 0),
    folder(3, 'L3', 2, 0),
    folder(4, 'L4', 3, 0),
    folder(5, 'L5', 4, 0),
    folder(6, 'L6', 5, 0),
  ];
  return {
    foldersById: new Map(folders.map((value) => [value.id, value])),
    childFolderIdsByParent: new Map<number | null, readonly number[]>([
      [null, [1]], [1, [2]], [2, [3]], [3, [4]], [4, [5]], [5, [6]],
    ]),
    presetIdsByFolder: new Map(),
    presetsById: new Map(),
  };
}

function folder(id: number, name: string, parentFolderId: number | null, displayOrder: number): PartyPresetFolderResponse {
  return { id, name, parentFolderId, displayOrder, createdAt: '', updatedAt: '' };
}

function textCount(root: ReactTestInstance, text: string): number {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length;
}

function findAllText(root: ReactTestInstance): string[] {
  return root.findAll((node) => (node.type as unknown) === 'Text').map((node) => node.children.join(''));
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!Array.isArray(style)) return (style ?? {}) as Record<string, unknown>;
  return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
}

function assertBorderless(node: ReactTestInstance): void {
  const style = typeof node.props.style === 'function'
    ? node.props.style({ pressed: false })
    : node.props.style;
  const flat = flattenStyle(style);
  assert.equal(flat.borderWidth ?? 0, 0);
  assert.equal(flat.minHeight, 44);
  assert.equal(flat.width, 34);
}

function layoutRows(root: ReactTestInstance, yPositions?: number[], cellHeights?: number[]): void {
  root.findAll((node) => (
    (node.type as unknown) === 'View' && node.props.testID === 'party-preset-folder-drop-target'
  )).forEach((row, index) => {
    row.props.onLayout({ nativeEvent: { layout: { y: yPositions?.[index] ?? index * 44, height: cellHeights?.[index] ?? 44 } } });
  });
  root.findAll((node) => (
    (node.type as unknown) === 'View' && /^party-preset-folder-row-\d+$/.test(node.props.testID ?? '')
  )).forEach((row) => {
    row.props.onLayout({ nativeEvent: { layout: { y: 0, height: 44 } } });
  });
  root.findByType('FlatList' as never).props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } });
}

function gestureFor(root: ReactTestInstance, label: string): GestureMock {
  const handle = root.findByProps({ accessibilityLabel: label });
  const detector = handle.parent;
  assert.equal(detector?.type as unknown, 'GestureDetector');
  return detector!.props.gesture as GestureMock;
}

function hostTestIdCount(root: ReactTestInstance, testID: string): number {
  return root.findAll((node) => (node.type as unknown) === 'View' && node.props.testID === testID).length;
}

function connectorLefts(root: ReactTestInstance, folderId: number): number[] {
  return root.findAll((node) => (
    (node.type as unknown) === 'View' && node.props.testID === `party-preset-folder-connector-${folderId}`
  )).map((node) => flattenStyle(node.props.style).left as number);
}

function rowPaddingLeft(root: ReactTestInstance, folderId: number): number {
  return flattenStyle(root.findByProps({ testID: `party-preset-folder-row-${folderId}` }).props.style).paddingLeft as number;
}

function hostAccessibilityLabels(root: ReactTestInstance): string[] {
  return root.findAll((node) => (
    (node.type as unknown) === 'Pressable' && typeof node.props.accessibilityLabel === 'string'
  )).map((node) => node.props.accessibilityLabel as string);
}

function resetAnimationFrames(): void {
  animationFrames.clear();
}

function flushAnimationFrames(count: number): void {
  for (let index = 0; index < count; index += 1) {
    const next = animationFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (next == null) return;
    animationFrames.delete(next[0]);
    next[1](index * 16);
  }
}
