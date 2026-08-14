import assert from 'node:assert/strict';
import Module from 'node:module';
import { it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = { Pressable: host('Pressable'), StyleSheet: { create: <T,>(styles: T) => styles }, Text: host('Text'), View: host('View') };
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') return iconsMock;
  return originalLoad(request, parent, isMain);
};
const { BottomTabBar } = require('../../main/components/BottomTabBar') as typeof import('../../main/components/BottomTabBar');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps the footer compact without shrinking tab touch targets below 44 points', async () => {
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(BottomTabBar, { activeTabId: 'home', onChangeTab: () => undefined }));
  });

  const tabs = renderer!.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'tab');
  assert.equal(tabs.length, 6);
  for (const tab of tabs) {
    assert.equal(styleOf(tab).minHeight, 46);
    assert.ok(Number(styleOf(tab).minHeight) >= 44);
  }
  const icons = renderer!.root.findAll((node) => {
    if (typeof node.type !== 'string') return false;
    return !['View', 'Text', 'Pressable'].includes(node.type as string) && node.props.size != null;
  });
  assert.equal(icons.length, 6);
  assert.ok(icons.every((icon) => icon.props.size === 21));
  assert.equal(renderer!.root.findAll((node) => String(node.type) === 'Text' && node.children.includes('채팅')).length, 0);
});

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const style = typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style;
  if (!Array.isArray(style)) return style ?? {};
  return Object.assign({}, ...style.filter(Boolean));
}
