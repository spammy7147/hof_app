import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { PartyPresetCatalogResponse, PartyPresetResponse } from '../../main/types/api';

const focusCalls: number[] = [];
const searchFocusCalls: string[] = [];
const webFocusEvents: string[] = [];
const webFindNodeHandle: (node: unknown) => never = require('react-native-web/dist/cjs/exports/findNodeHandle');
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({
    nodeName: 'DIV', getAttribute: () => null,
    setAttribute: (key: string, value: string) => webFocusEvents.push(`${key}:${value}`),
    focus: () => webFocusEvents.push(`focus:${name}`),
  }), [name]);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const flatList = (props: Record<string, unknown>) => React.createElement(
  'FlatList',
  props,
  (props.data as unknown[]).map((item, index) => React.createElement(
    React.Fragment,
    { key: (props.keyExtractor as (value: unknown, index: number) => string)(item, index) },
    (props.renderItem as (value: { item: unknown; index: number }) => React.ReactNode)({ item, index }),
  )),
  (props.data as unknown[]).length === 0 ? props.ListEmptyComponent as React.ReactNode : null,
);
const textInput = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({
    focus: () => searchFocusCalls.push(String(props.accessibilityLabel)),
  }), [props.accessibilityLabel]);
  return React.createElement('TextInput', props, props.children as React.ReactNode);
});
const reactNativeMock = {
  AccessibilityInfo: { setAccessibilityFocus: (handle: number) => focusCalls.push(handle) },
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: flatList,
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Modal: host('Modal'),
  Platform: { OS: 'ios' },
  UIManager: require('react-native-web/dist/cjs/exports/UIManager'),
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  TextInput: textInput,
  View: host('View'),
  findNodeHandle: (node: unknown) => reactNativeMock.Platform.OS === 'web' ? webFindNodeHandle(node) : 7,
};
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 31, left: 0, right: 0, top: 0 }) };
  if (request === 'lucide-react-native') return iconsMock;
  return originalLoad(request, parent, isMain);
};
const { PartyPresetPickerModal } = require(
  '../../main/components/PartyPresetPickerModal',
) as typeof import('../../main/components/PartyPresetPickerModal');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PartyPresetPickerModal', () => {
  it('focuses the web modal heading without a native handle or a new keyboard tab stop', async () => {
    reactNativeMock.Platform.OS = 'web';
    webFocusEvents.length = 0;
    const renderer = await renderPicker();
    try {
      await act(async () => findHosts(renderer.root, 'Modal')[0]!.props.onShow());
      assert.deepEqual(webFocusEvents, ['tabIndex:-1', 'focus:Text']);
    } finally {
      await act(async () => renderer.unmount());
      reactNativeMock.Platform.OS = 'ios';
    }
  });

  it('browses the tree and switches one global name search to zero-indent full-width results', async () => {
    const renderer = await renderPicker();

    assert.equal(renderer.root.findByProps({ accessibilityLabel: '미지정 폴더, 프리셋 1개, 닫기' }).props.accessibilityState.expanded, true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 1개, 열기' }));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 1개, 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '지원 폴더, 프리셋 1개, 열기' }).props.onPress());
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 1개, 닫기' }).props.accessibilityState.expanded, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '지원 폴더, 프리셋 1개, 닫기' }).props.accessibilityState.expanded, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '미지정 폴더, 프리셋 1개, 닫기' }).props.accessibilityState.expanded, true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '레이드 폴더, 프리셋 1개, 열기' }));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '레이드 폴더, 프리셋 1개, 열기' }).props.onPress());
    assert.equal(findAllHostByTestId(renderer.root, 'party-preset-row').length, 3);
    assert.equal(textCount(renderer.root, '구성원 0명'), 0);

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.onChangeText('화속'));

    assert.equal(findAllHostByTestId(renderer.root, 'party-preset-folder-row').length, 0);
    const results = findAllHostByTestId(renderer.root, 'party-preset-search-result');
    assert.equal(results.length, 2);
    results.forEach((result) => {
      const style = result.props.style({ pressed: false }) as Array<Record<string, unknown>>;
      assert.equal(Object.assign({}, ...style).marginLeft, 0);
      assert.equal(Object.assign({}, ...style).width, '100%');
    });
    assert.equal(textCount(renderer.root, '전투 › 레이드'), 1);
    assert.equal(textCount(renderer.root, '미지정'), 1);
    assert.equal(textCount(renderer.root, '구성원 0명'), 0);

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.onChangeText(''));
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 1개, 닫기' }).props.accessibilityState.expanded, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '지원 폴더, 프리셋 1개, 닫기' }).props.accessibilityState.expanded, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '미지정 폴더, 프리셋 1개, 닫기' }).props.accessibilityState.expanded, true);
  });

  it('prefers independent initial folder ids without mutating a frozen caller array', async () => {
    const initialExpandedFolderIds = Object.freeze([1, 3, null] as const);
    const renderer = await renderPicker({
      initialExpandedFolderIds,
    });

    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 1개, 닫기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '지원 폴더, 프리셋 1개, 닫기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '미지정 폴더, 프리셋 1개, 닫기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '레이드 폴더, 프리셋 1개, 열기' }));
    assert.deepEqual(initialExpandedFolderIds, [1, 3, null]);
  });

  it('selects only explicit rows and keeps synthetic choices in a separate top section', async () => {
    const selected: Array<string | number> = [];
    const renderer = await renderPicker({
      selectedPresetId: 10,
      syntheticOptions: [{
        key: 'primary',
        label: '대표 · 화속 레이드',
        selected: true,
        onSelect: () => selected.push('primary'),
      }],
      onSelectPreset: (preset: PartyPresetResponse) => selected.push(preset.id),
    });

    const synthetic = renderer.root.findByProps({ accessibilityLabel: '대표 · 화속 레이드 선택' });
    assert.equal(synthetic.props.accessibilityRole, 'radio');
    assert.deepEqual(synthetic.props.accessibilityState, { checked: true, disabled: false });
    const syntheticStyle = Object.assign({}, ...(synthetic.props.style({ pressed: false }) as Array<Record<string, unknown>>));
    assert.equal(syntheticStyle.minHeight, 44);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '특수 선택' }));
    await act(async () => synthetic.props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 1개, 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '레이드 폴더, 프리셋 1개, 열기' }).props.onPress());
    await act(async () => findAllHostByTestId(renderer.root, 'party-preset-row')[0]?.props.onPress());

    assert.deepEqual(selected, ['primary', 10]);
  });

  it('lets both browse and search lists fill the catalog area', async () => {
    const renderer = await renderPicker();
    let listStyle = flattenStyle(findHosts(renderer.root, 'FlatList')[0]?.props.style);
    assert.equal(listStyle.flex, 1);

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.onChangeText('화속'));
    listStyle = flattenStyle(findHosts(renderer.root, 'FlatList')[0]?.props.style);
    assert.equal(listStyle.flex, 1);
  });

  it('focuses the title, resets search on close, and disables every action during mutation', async () => {
    focusCalls.length = 0;
    searchFocusCalls.length = 0;
    let closed = 0;
    const renderer = await renderPicker({ disabled: true, onClose: () => { closed += 1; } });
    const modal = findHosts(renderer.root, 'Modal')[0]!;

    await act(async () => modal.props.onShow());
    assert.deepEqual(focusCalls, [7]);
    assert.deepEqual(searchFocusCalls, []);
    const input = renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' });
    assert.equal(input.props.editable, false);
    await act(async () => input.props.onChangeText('화속'));
    const disabledResult = findAllHostByTestId(renderer.root, 'party-preset-search-result')[0]!;
    assert.equal(disabledResult.props.disabled, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '프리셋 선택기 닫기' }).props.disabled, true);
    await act(async () => modal.props.onRequestClose());
    assert.equal(closed, 0);

    await act(async () => renderer.update(React.createElement(PartyPresetPickerModal, baseProps({ onClose: () => { closed += 1; } }))));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.onChangeText('화속'));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 선택기 닫기' }).props.onPress());
    assert.equal(closed, 1);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.value, '');
  });

  it('bounds a native form sheet above the keyboard and iOS home indicator on a short viewport', async () => {
    reactNativeMock.Platform.OS = 'ios';
    const renderer = await renderPicker();
    const modal = findHosts(renderer.root, 'Modal')[0]!;
    const keyboardAvoiding = findHosts(renderer.root, 'KeyboardAvoidingView')[0]!;
    const panel = renderer.root.findByProps({ accessibilityLabel: '파티 프리셋 선택기' });

    assert.equal(modal.props.presentationStyle, 'formSheet');
    assert.equal(modal.props.transparent, undefined);
    assert.equal(keyboardAvoiding.props.behavior, 'padding');
    assert.equal(keyboardAvoiding.props.keyboardVerticalOffset, 0);
    assert.equal(keyboardAvoiding.props.pointerEvents, 'box-none');
    const panelStyle = Object.assign({}, ...(panel.props.style as Array<Record<string, unknown>>));
    assert.equal(panelStyle.height, '84%');
    assert.equal(panelStyle.maxHeight, undefined);
    assert.equal(panelStyle.gap, 8);
    assert.equal(panelStyle.paddingBottom, 31);
    assert.equal(panelStyle.minHeight, undefined);
    const catalogArea = renderer.root.findByProps({ testID: 'party-preset-catalog-area' });
    const catalogAreaStyle = flattenStyle(catalogArea.props.style);
    assert.equal(catalogAreaStyle.flex, 1);
    assert.equal(catalogAreaStyle.minHeight, 120);

    reactNativeMock.Platform.OS = 'android';
    await act(async () => renderer.update(React.createElement(PartyPresetPickerModal, baseProps())));
    assert.equal(findHosts(renderer.root, 'KeyboardAvoidingView')[0]?.props.behavior, 'height');
    reactNativeMock.Platform.OS = 'ios';
  });

  it('clears a query when visibility is removed externally and reopens in tree browsing mode', async () => {
    const renderer = await renderPicker();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.onChangeText('화속'));
    assert.equal(findAllHostByTestId(renderer.root, 'party-preset-search-result').length, 2);

    await act(async () => renderer.update(React.createElement(PartyPresetPickerModal, baseProps({ visible: false }))));
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.value, '');
    await act(async () => renderer.update(React.createElement(PartyPresetPickerModal, baseProps())));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 1개, 열기' }));
    assert.equal(findAllHostByTestId(renderer.root, 'party-preset-search-result').length, 0);
  });
});

async function renderPicker(overrides: Record<string, unknown> = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(PartyPresetPickerModal, baseProps(overrides))); });
  return renderer;
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    catalog: CATALOG,
    disabled: false,
    onClose: () => undefined,
    onSelectPreset: (_preset: PartyPresetResponse) => undefined,
    selectedPresetId: null,
    syntheticOptions: [],
    title: '파티 프리셋 선택',
    visible: true,
    ...overrides,
  };
}

function findAllHostByTestId(root: ReactTestInstance, testID: string): ReactTestInstance[] {
  return root.findAll((node) => (node.type as unknown) === 'Pressable' && node.props.testID === testID);
}
function findHosts(root: ReactTestInstance, name: string): ReactTestInstance[] {
  return root.findAll((node) => (node.type as unknown) === name);
}
function textCount(root: ReactTestInstance, value: string): number {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === value).length;
}
function flattenStyle(style: Record<string, unknown> | readonly Record<string, unknown>[]): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style : [style]));
}

const CATALOG: PartyPresetCatalogResponse = {
  folders: [folder(1, '전투', null), folder(2, '레이드', 1), folder(3, '지원', null)],
  presets: [preset(10, '화속 레이드', 2), preset(11, '화속 미지정', null), preset(12, '지원 파티', 3)],
};
function folder(id: number, name: string, parentFolderId: number | null) {
  return { id, name, parentFolderId, displayOrder: 0, createdAt: '', updatedAt: '' };
}
function preset(id: number, name: string, folderId: number | null): PartyPresetResponse {
  return { id, accountId: 1, name, folderId, isPrimary: id === 10, displayOrder: id, members: [], createdAt: '', updatedAt: '' };
}
