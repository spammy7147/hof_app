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
const { TownActionResult } = require(
  '../../main/features/town/components/TownActionResult',
) as typeof import('../../main/features/town/components/TownActionResult');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TownActionResult', () => {
  it('renders only structured messages and items', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(TownActionResult, {
        result: {
          status: 'SUCCESS',
          messages: ['교환했습니다.'],
          items: [{ name: 'Potion', quantity: 2, imageUrl: null, detail: '회복 아이템' }],
          refreshRequired: true,
        },
      }));
    });
    const text = renderer.root
      .findAll((node) => String(node.type) === 'Text')
      .flatMap((node) => flatten(node.props.children));

    assert.equal(text.includes('교환했습니다.'), true);
    assert.equal(text.includes('Potion ×2'), true);
    assert.equal(text.some((value) => value.includes('<html')), false);
    await act(async () => { renderer.unmount(); });
  });

  it('shows a conservative refresh action for an unknown empty result', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(TownActionResult, {
        result: { status: 'UNKNOWN', messages: [], items: [], refreshRequired: true },
        onRefresh: () => undefined,
      }));
    });

    assert.ok(renderer.root.find((node) => node.props.accessibilityLabel === '마을 정보 새로고침'));
    await act(async () => { renderer.unmount(); });
  });
});

function flatten(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flatten);
  return [];
}
