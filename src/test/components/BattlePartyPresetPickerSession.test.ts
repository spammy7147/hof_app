import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';

import type { PartyPresetCatalogResponse, PartyPresetResponse } from '../../main/types/api';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({ name }), [name]);
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
  AccessibilityInfo: { setAccessibilityFocus: () => undefined },
  ActivityIndicator: host('ActivityIndicator'),
  findNodeHandle: (node: unknown) => node,
  FlatList: flatList,
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Modal: host('Modal'),
  Platform: { OS: 'ios' },
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
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }) };
  if (request === 'lucide-react-native') return iconsMock;
  return originalLoad(request, parent, isMain);
};
const { BattlePartyPresetPicker } = require(
  '../../main/features/battle/components/BattlePartyPresetPicker',
) as typeof import('../../main/features/battle/components/BattlePartyPresetPicker');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BattlePartyPresetPicker refresh session', () => {
  it('keeps the open query and expanded path while an equivalent catalog refresh disables actions', async () => {
    const selected: number[] = [];
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(BattlePartyPresetPicker, props({
        onSelectPreset: (preset: PartyPresetResponse) => selected.push(preset.id),
      })));
    });

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 파티 프리셋 선택' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '레이드 폴더 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.onChangeText('화속'));
    assert.equal(findModal(renderer.root).props.visible, true);
    assert.equal(findPresetRows(renderer.root, 'party-preset-search-result').length, 1);

    await act(async () => renderer.update(React.createElement(BattlePartyPresetPicker, props({
      catalog: equivalentCatalog(),
      loading: true,
      onSelectPreset: (preset: PartyPresetResponse) => selected.push(preset.id),
    }))));

    assert.equal(findModal(renderer.root).props.visible, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.value, '화속');
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.editable, false);
    assert.equal(findPresetRows(renderer.root, 'party-preset-search-result')[0]?.props.disabled, true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '프리셋을 새로 고치는 중' }));

    await act(async () => renderer.update(React.createElement(BattlePartyPresetPicker, props({
      catalog: equivalentCatalog(),
      loading: false,
      onSelectPreset: (preset: PartyPresetResponse) => selected.push(preset.id),
    }))));

    assert.equal(findModal(renderer.root).props.visible, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.value, '화속');
    assert.equal(findPresetRows(renderer.root, 'party-preset-search-result')[0]?.props.disabled, false);
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.onChangeText(''));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투 폴더 닫기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '레이드 폴더 닫기' }));
    await act(async () => findPresetRows(renderer.root, 'party-preset-row')[0]?.props.onPress());
    assert.deepEqual(selected, [10]);
    assert.equal(findModal(renderer.root).props.visible, false);
  });
});

function props(overrides: Record<string, unknown> = {}) {
  return {
    characters: [], catalog: CATALOG, loading: false, errorMessage: null,
    selectedMode: null, selectedPresetId: null, onRetry: () => undefined,
    onSelectDirect: () => undefined, onSelectPreset: () => undefined, ...overrides,
  };
}
function findModal(root: ReactTestInstance) {
  return root.find((node) => (node.type as unknown) === 'Modal');
}
function findPresetRows(root: ReactTestInstance, testID: string) {
  return root.findAll((node) => (node.type as unknown) === 'Pressable' && node.props.testID === testID);
}
function equivalentCatalog(): PartyPresetCatalogResponse {
  return {
    folders: CATALOG.folders.map((folder) => ({ ...folder })),
    presets: CATALOG.presets.map((preset) => ({ ...preset, members: [...preset.members] })),
  };
}

const CATALOG: PartyPresetCatalogResponse = {
  folders: [
    { id: 1, name: '전투', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' },
    { id: 2, name: '레이드', parentFolderId: 1, displayOrder: 0, createdAt: '', updatedAt: '' },
  ],
  presets: [{ id: 10, accountId: 1, name: '화속 레이드', folderId: 2, isPrimary: false, displayOrder: 0, members: [], createdAt: '', updatedAt: '' }],
};
