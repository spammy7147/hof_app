import assert from 'node:assert/strict';
import Module from 'node:module';
import { it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) =>
  React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  View: host('View'),
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
const { HomeStatusSummary } = require(
  '../../main/components/HomeStatusSummary',
) as typeof import('../../main/components/HomeStatusSummary');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows title before nickname, keeps the full fund balance, and opens settings', async () => {
  let settingsOpens = 0;
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(HomeStatusSummary, {
      status: {
        playerName: '《얼어붙은 손길》공민이',
        funds: 762_272_960,
        timeCurrent: 2297,
        timeMax: 6000,
        work: 'Nothing',
        auction: 'Nothing',
        observedAt: 'invalid',
      },
      onOpenSettings: () => { settingsOpens += 1; },
    }));
  });

  const text = renderer.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => node.children.join(''));
  assert.ok(text.includes('《얼어붙은 손길》 공민이'));
  assert.ok(text.includes('2297/6000'));
  assert.ok(text.includes('$762,272,960'));
  assert.equal(text.some((value) => value.includes('$762M')), false);

  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: '앱 설정 열기' }).props.onPress();
  });
  assert.equal(settingsOpens, 1);

  await act(async () => { renderer.unmount(); });
});
