import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(
  name,
  props,
  props.children as React.ReactNode,
);
const reactNativeMock = {
  FlatList: (props: Record<string, unknown>) => {
    const data = props.data as Array<{ id: string }>;
    const renderItem = props.renderItem as (info: { item: { id: string } }) => React.ReactNode;
    return React.createElement('FlatList', props, data.map((item) => React.createElement(
      React.Fragment,
      { key: item.id },
      renderItem({ item }),
    )));
  },
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'expo-image') return { Image: host('Image') };
  return originalLoad(request, parent, isMain);
};
const { TownItemList } = require(
  '../../main/features/town/components/TownItemList',
) as typeof import('../../main/features/town/components/TownItemList');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TownItemList', () => {
  it('uses FlatList and keeps rows without a HOF selector visible but disabled', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(TownItemList, {
        rows: [
          { id: 'selectable', label: '교환 가능', selectable: true, detail: null, imageUrl: 'https://sic.zerosic.com/item.png', price: null, quantity: null },
          { id: 'display-only', label: '교환 불가', selectable: false, detail: null, imageUrl: null, price: null, quantity: null },
        ],
        selectionMode: 'single',
        selectedIds: ['selectable'],
        onSelectionChange: () => undefined,
      }));
    });

    const list = renderer.root.find((node) => String(node.type) === 'FlatList');
    const disabledRow = renderer.root.find(
      (node) => node.props.accessibilityLabel === '교환 불가 선택 불가',
    );

    assert.equal(list.props.data.length, 2);
    assert.equal(list.props.keyboardShouldPersistTaps, 'handled');
    assert.equal(renderer.root.find((node) => String(node.type) === 'Image').props.accessible, false);
    assert.equal(disabledRow.props.disabled, true);
    assert.equal(disabledRow.props.accessibilityRole, 'radio');
    assert.deepEqual(disabledRow.props.accessibilityState, { disabled: true, checked: false });
    await act(async () => { renderer.unmount(); });
  });

  it('uses text semantics instead of checkbox semantics in display-only mode', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(TownItemList, {
        rows: [
          { id: 'info', label: '안내 행', selectable: false, detail: null, imageUrl: null, price: null, quantity: null },
        ],
      }));
    });

    const row = renderer.root.find((node) => node.props.accessibilityLabel === '안내 행');
    assert.equal(row.props.accessibilityRole, 'text');
    assert.equal(row.props.accessibilityState, undefined);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'Text' && node.children.join('') === '선택 불가').length, 0);
    await act(async () => { renderer.unmount(); });
  });

  it('supports virtualized informational rows beside selectable rows without announcing a false control', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(TownItemList, {
        rows: [
          { id: 'choice', label: '제작품', selectable: true, detail: null, imageUrl: null, price: null, quantity: null },
          { id: 'history:1', label: '제작 기록', selectable: false, detail: null, imageUrl: null, price: null, quantity: null },
        ],
        selectionMode: 'grouped-single',
        selectedIds: [],
        onSelectionChange: () => undefined,
        displayOnlyRow: (row: { id: string }) => row.id.startsWith('history:'),
      }));
    });

    const history = renderer.root.find((node) => node.props.accessibilityLabel === '제작 기록');
    assert.equal(history.props.accessibilityRole, 'text');
    assert.equal(history.props.accessibilityState, undefined);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'Text' && node.children.join('') === '선택 불가').length, 0);
    await act(async () => { renderer.unmount(); });
  });
});
