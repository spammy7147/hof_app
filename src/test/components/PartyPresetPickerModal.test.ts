import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { PartyPresetCatalogResponse, PartyPresetResponse } from '../../main/types/api';

const focusCalls: number[] = [];
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({ focus: () => undefined }), []);
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
const reactNativeMock = {
  AccessibilityInfo: { setAccessibilityFocus: (handle: number) => focusCalls.push(handle) },
  FlatList: flatList,
  Modal: host('Modal'),
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  TextInput: host('TextInput'),
  View: host('View'),
  findNodeHandle: () => 7,
};
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') return iconsMock;
  return originalLoad(request, parent, isMain);
};
const { PartyPresetPickerModal } = require(
  '../../main/components/PartyPresetPickerModal',
) as typeof import('../../main/components/PartyPresetPickerModal');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PartyPresetPickerModal', () => {
  it('browses the tree and switches one global name search to zero-indent full-width results', async () => {
    const renderer = await renderPicker();

    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투 폴더 열기' }));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 열기' }).props.onPress());
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '레이드 폴더 열기' }));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '레이드 폴더 열기' }).props.onPress());
    assert.equal(findAllHostByTestId(renderer.root, 'party-preset-row').length, 1);

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
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '특수 선택' }));
    await act(async () => synthetic.props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '레이드 폴더 열기' }).props.onPress());
    await act(async () => findAllHostByTestId(renderer.root, 'party-preset-row')[0]?.props.onPress());

    assert.deepEqual(selected, ['primary', 10]);
  });

  it('focuses the title, resets search on close, and disables every action during mutation', async () => {
    focusCalls.length = 0;
    let closed = 0;
    const renderer = await renderPicker({ disabled: true, onClose: () => { closed += 1; } });
    const modal = findHosts(renderer.root, 'Modal')[0]!;

    await act(async () => modal.props.onShow());
    assert.deepEqual(focusCalls, [7]);
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

const CATALOG: PartyPresetCatalogResponse = {
  folders: [folder(1, '전투', null), folder(2, '레이드', 1)],
  presets: [preset(10, '화속 레이드', 2), preset(11, '화속 미지정', null)],
};
function folder(id: number, name: string, parentFolderId: number | null) {
  return { id, name, parentFolderId, displayOrder: 0, createdAt: '', updatedAt: '' };
}
function preset(id: number, name: string, folderId: number | null): PartyPresetResponse {
  return { id, accountId: 1, name, folderId, isPrimary: id === 10, displayOrder: id, members: [], createdAt: '', updatedAt: '' };
}
