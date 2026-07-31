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
  Modal: host('Modal'),
  Pressable: host('Pressable'),
  ScrollView: host('ScrollView'),
  StyleSheet: {
    absoluteFill: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    create: <T,>(styles: T) => styles,
  },
  Text: host('Text'),
  View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 20 }) };
  if (request.endsWith('/components/PrimaryButton')) return {
    PrimaryButton: (props: Record<string, unknown>) => React.createElement('PrimaryButton', props),
  };
  return originalLoad(request, parent, isMain);
};
const { TownConfirmSheet } = require(
  '../../main/features/town/components/TownConfirmSheet',
) as typeof import('../../main/features/town/components/TownConfirmSheet');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TownConfirmSheet', () => {
  it('bounds the sheet, scrolls long details, and keeps actions outside the scroller', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(TownConfirmSheet, {
        visible: true,
        title: '교환 확인',
        details: Array.from({ length: 40 }, (_, index) => ({ label: `재료 ${index}`, value: '1000개' })),
        onCancel: () => undefined,
        onConfirm: () => undefined,
      }));
    });

    const sheet = renderer.root.find((node) => node.props.testID === 'town-confirm-sheet');
    const scroll = renderer.root.find((node) => node.props.testID === 'town-confirm-scroll');
    const actions = renderer.root.find((node) => node.props.testID === 'town-confirm-actions');
    const flattenedStyle = Object.assign({}, ...sheet.props.style);

    assert.equal(flattenedStyle.maxHeight, '85%');
    assert.ok(scroll.find((node) => String(node.type) === 'ScrollView'));
    assert.equal(scroll.findAllByProps({ testID: 'town-confirm-actions' }).length, 0);
    assert.ok(sheet.findAllByProps({ testID: 'town-confirm-actions' }).length >= 1);
    assert.ok(actions);
    act(() => { renderer.unmount(); });
  });
});
