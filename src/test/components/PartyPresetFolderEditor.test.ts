import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { indexPartyPresetCatalog } from '../../main/domain/partyPresetCatalog';
import type { PartyPresetCatalogResponse, PartyPresetFolderResponse } from '../../main/types/api';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({}), []);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const flatList = (props: Record<string, unknown>) => React.createElement(
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
    assert.equal(childStyle.borderLeftWidth, 2);
    assert.ok(renderer.root.findByType('FlatList' as never).props.CellRendererComponent);
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

  it('keeps survivor expansion when replacing the index and shows newly created children expanded', async () => {
    const renderer = await renderEditor();
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 접기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'New1 폴더 펼치기' }).props.onPress(); });

    const replacement = indexPartyPresetCatalog({
      folders: [
        folder(1, 'New1', null, 0),
        folder(2, 'new2', 1, 0),
        folder(4, 'new3', 1, 1),
        folder(5, 'new4', 4, 0),
      ],
      presets: [],
    });
    await act(async () => {
      renderer.update(element({ index: replacement }));
    });
    assert.equal(textCount(renderer.root, 'new2'), 1);
    assert.equal(textCount(renderer.root, 'new3'), 1);
    assert.equal(textCount(renderer.root, 'new4'), 1);
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

  it('offers accessible same-position moves and a one-level out action through the planner', async () => {
    const moves: Array<[number, { parentFolderId: number | null; displayOrder: number }]> = [];
    const renderer = await renderEditor({ onMove: async (id, request) => { moves.push([id, request]); } });
    const grip = renderer.root.findByProps({ accessibilityLabel: 'new2 폴더 위치 이동' });
    assert.deepEqual(grip.props.accessibilityActions, [
      { name: 'decrement', label: '같은 위치에서 위로 이동' },
      { name: 'increment', label: '같은 위치에서 아래로 이동' },
      { name: 'escape', label: '한 단계 위로 이동' },
    ]);
    await act(async () => {
      grip.props.onAccessibilityAction({ nativeEvent: { actionName: 'escape' } });
    });
    assert.deepEqual(moves, [[2, { parentFolderId: null, displayOrder: 1 }]]);
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

function layoutRows(root: ReactTestInstance): void {
  root.findAll((node) => (
    (node.type as unknown) === 'View' && node.props.testID === 'party-preset-folder-drop-target'
  )).forEach((row, index) => {
    row.props.onLayout({ nativeEvent: { layout: { y: index * 44, height: 44 } } });
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
