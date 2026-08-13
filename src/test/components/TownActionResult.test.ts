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

  it('shows actionable results in a blocking result notice until the user confirms it', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(TownActionResult, {
        result: {
          status: 'SUCCESS',
          messages: ['Blank Card와 교환한다.'],
          items: [],
          refreshRequired: false,
        },
      }));
    });

    assert.ok(renderer.root.find((node) => node.props.accessibilityLabel === '작업 완료 알림'));
    const confirm = renderer.root.find((node) => node.props.accessibilityLabel === '결과 확인');
    await act(async () => { confirm.props.onPress(); });
    assert.equal(renderer.root.find((node) => String(node.type) === 'Modal').props.visible, false);
    await act(async () => { renderer.unmount(); });
  });

  it('keeps informational results inline without opening a blocking notice', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(TownActionResult, {
        result: {
          status: 'INFORMATIONAL',
          messages: ['목록을 갱신했습니다.'],
          items: [],
          refreshRequired: true,
        },
      }));
    });

    assert.equal(renderer.root.findAll((node) => node.props.accessibilityLabel === '작업 안내 알림').length, 0);
    assert.ok(renderer.root.findAll((node) => node.props.accessibilityLabel === '인라인 작업 결과').length >= 1);
    await act(async () => { renderer.unmount(); });
  });
});

function flatten(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flatten);
  return [];
}
