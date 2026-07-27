import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

import { indexPartyPresetCatalog } from '../../main/domain/partyPresetCatalog';
import type { PartyPresetCatalogResponse } from '../../main/types/api';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const focusCalls: number[] = [];
const flatList = (props: Record<string, unknown>) => React.createElement(
  'FlatList',
  props,
  (props.data as unknown[]).map((item, index) => React.createElement(
    React.Fragment,
    { key: (props.keyExtractor as (value: unknown) => string)(item) },
    (props.renderItem as (value: { item: unknown; index: number }) => React.ReactNode)({ item, index }),
  )),
);
const reactNativeMock = {
  AccessibilityInfo: { setAccessibilityFocus: (handle: number) => focusCalls.push(handle) },
  FlatList: flatList,
  Modal: host('Modal'),
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  View: host('View'),
  findNodeHandle: () => 1,
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
const { PartyPresetFolderPicker } = require(
  '../../main/components/PartyPresetFolderPicker',
) as typeof import('../../main/components/PartyPresetFolderPicker');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PartyPresetFolderPicker', () => {
  it('shows complete paths and returns a nullable choice only after confirmation', async () => {
    const selected: Array<number | null> = [];
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(PartyPresetFolderPicker, {
        index: indexPartyPresetCatalog(CATALOG),
        selectedFolderId: 2,
        onCancel: () => undefined,
        onConfirm: (folderId: number | null) => selected.push(folderId),
      }));
    });

    assert.ok(renderer.root.findByProps({ accessibilityLabel: '현재 폴더 위치 전투 › 레이드' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '폴더 위치 미지정' }));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 미지정' }).props.onPress());
    assert.deepEqual(selected, []);
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 확인' }).props.onPress());
    assert.deepEqual(selected, [null]);
  });

  it('disables self, descendants, and destinations that exceed five levels', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(PartyPresetFolderPicker, {
        index: indexPartyPresetCatalog(DEEP_CATALOG),
        selectedFolderId: null,
        movingFolderId: 1,
        allowUnassigned: false,
        onCancel: () => undefined,
        onConfirm: () => undefined,
      }));
    });

    assert.equal(renderer.root.findByProps({ accessibilityLabel: '폴더 위치 이동할 폴더' }).props.disabled, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '폴더 위치 이동할 폴더 › 자식' }).props.disabled, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '폴더 위치 깊이1 › 깊이2 › 깊이3 › 깊이4' }).props.disabled, true);
  });

  it('opens a form-sheet modal and keeps persisted depth-first folder order', async () => {
    focusCalls.length = 0;
    const renderer = await renderPicker(ORDERED_CATALOG);
    const modal = renderer.root.find((node) => (node.type as unknown) === 'Modal');
    assert.equal(modal.props.visible, true);
    assert.equal(modal.props.presentationStyle, 'formSheet');
    assert.ok(renderer.root.findByProps({ accessibilityRole: 'header' }));
    assert.deepEqual(
      (renderer.root.find((node) => (node.type as unknown) === 'FlatList').props.data as Array<{ path: string }>).map(({ path }) => path),
      ['미지정', 'Z 루트', 'Z 루트 › B 자식', 'Z 루트 › B 자식 › 깊은 항목', 'A 루트'],
    );
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '폴더 위치 Z 루트 › B 자식 › 깊은 항목' }));
    await act(async () => modal.props.onShow());
    assert.deepEqual(focusCalls, [1]);
  });
});

async function renderPicker(catalog: PartyPresetCatalogResponse) {
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(PartyPresetFolderPicker, {
      index: indexPartyPresetCatalog(catalog),
      selectedFolderId: null,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }));
  });
  return renderer;
}

const CATALOG: PartyPresetCatalogResponse = {
  folders: [folder(1, '전투', null, 0), folder(2, '레이드', 1, 0)],
  presets: [],
};
const DEEP_CATALOG: PartyPresetCatalogResponse = {
  folders: [
    folder(1, '이동할 폴더', null, 0), folder(2, '자식', 1, 0),
    folder(3, '깊이1', null, 1), folder(4, '깊이2', 3, 0), folder(5, '깊이3', 4, 0), folder(6, '깊이4', 5, 0),
  ],
  presets: [],
};
const ORDERED_CATALOG: PartyPresetCatalogResponse = {
  folders: [
    folder(10, 'A 루트', null, 1),
    folder(1, 'Z 루트', null, 0),
    folder(2, 'B 자식', 1, 0),
    folder(3, '깊은 항목', 2, 0),
  ],
  presets: [],
};

function folder(id: number, name: string, parentFolderId: number | null, displayOrder: number) {
  return { id, name, parentFolderId, displayOrder, createdAt: '', updatedAt: '' };
}
