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
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') return iconsMock;
  if (request === 'react-native-gesture-handler') {
    return { Gesture: { Pan: panGesture }, GestureDetector: host('GestureDetector') };
  }
  return originalLoad(request, parent, isMain);
};
const { PartyPresetFolderEditor } = require(
  '../../main/components/PartyPresetFolderEditor',
) as typeof import('../../main/components/PartyPresetFolderEditor');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PartyPresetFolderEditor', () => {
  it('renders the full expanded tree once with compact hierarchy and exact controls', async () => {
    const renderer = await renderEditor();
    assert.equal(textCount(renderer.root, 'New1'), 1);
    assert.equal(textCount(renderer.root, 'new2'), 1);
    assert.equal(findAllText(renderer.root).some((text) => text.includes('루트')), false);
    assert.equal(renderer.root.findAllByType('Folder' as never).length, 0);
    assert.equal(findAllText(renderer.root).some((text) => /\d+개/.test(text)), false);

    const edit = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 및 삭제 수정' });
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
      'New1 폴더 이름 및 삭제 수정',
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

  it('opens a pencil panel for rename, delete, and cancel callbacks', async () => {
    const renames: Array<[number, { name: string }]> = [];
    const deletes: number[] = [];
    const renderer = await renderEditor({
      onRename: async (id, request) => { renames.push([id, request]); },
      onDelete: async (id) => { deletes.push(id); },
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 및 삭제 수정' }).props.onPress(); });
    const input = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름' });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 수정 취소' }));
    await act(async () => { input.props.onChangeText('Renamed'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 저장' }).props.onPress(); });
    assert.deepEqual(renames, [[1, { name: 'Renamed' }]]);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 및 삭제 수정' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 삭제' }).props.onPress(); });
    assert.deepEqual(deletes, [1]);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 및 삭제 수정' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 수정 취소' }).props.onPress(); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'New1 폴더 이름' }).length, 0);
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
    ]);
    const rootGrip = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 위치 이동' });
    assert.deepEqual(rootGrip.props.accessibilityActions, [
      { name: 'increment', label: '같은 위치에서 아래로 이동' },
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

  it('measures only the compact row and applies scroll offset while resolving targets', async () => {
    const moves: unknown[] = [];
    const renderer = await renderEditor({ onMove: async (...args) => { moves.push(args); } });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 및 삭제 수정' }).props.onPress(); });
    layoutRows(renderer.root, [0, 88, 132], [88, 44, 44]);
    const gesture = gestureFor(renderer.root, 'new2 폴더 위치 이동');
    await act(async () => {
      (gesture.config.onStart as (event: Record<string, number>) => void)({ y: 22 });
      // Content y=60 lies in New1's inline editor, not its 44px folder row.
      (gesture.config.onUpdate as (event: Record<string, number>) => void)({ y: 22, translationY: -50 });
    });
    assert.equal(hostTestIdCount(renderer.root, 'party-preset-folder-drop-inside-1'), 0);
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

  it('does not expand a parent when child creation or an inside move fails', async () => {
    const failure = new Error('expected failure');
    const index = indexPartyPresetCatalog({
      folders: [
        folder(1, 'New1', null, 0), folder(2, 'new2', 1, 0),
        folder(3, 'Other', null, 1), folder(4, 'Other child', 3, 0),
      ],
      presets: [],
    });
    const renderer = await renderEditor({
      index,
      onCreate: async () => { throw failure; },
      onMove: async () => { throw failure; },
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 접기' }).props.onPress();
      renderer.root.findByProps({ accessibilityLabel: 'Other 폴더 접기' }).props.onPress();
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 새 하위 폴더 이름' }).props.onChangeText('fail'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 하위 폴더 저장' }).props.onPress(); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 펼치기' }));

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
    const edit = renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 이름 및 삭제 수정' });
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
