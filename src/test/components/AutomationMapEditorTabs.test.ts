import assert from 'node:assert/strict';
import Module from 'node:module';
import { it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => (
  React.createElement(name, props, props.children as React.ReactNode)
);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return {
    Pressable: host('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: host('Text'),
    View: host('View'),
  };
  return originalLoad(request, parent, isMain);
};
const { AutomationMapEditorTabs } = require(
  '../../main/features/automation/components/AutomationMapEditorTabs',
) as typeof import('../../main/features/automation/components/AutomationMapEditorTabs');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('exposes selected and catalog tabs with count and changes the active tab', async () => {
  const changes: string[] = [];
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(AutomationMapEditorTabs, {
      activeTab: 'SELECTED',
      onChange: (tab) => changes.push(tab),
      selectedCount: 12,
    }));
  });

  const selected = renderer!.root.findAllByProps({ accessibilityLabel: '선택 맵 12개 탭' })
    .find((node) => (node.type as unknown) === 'Pressable')!;
  const catalog = renderer!.root.findAllByProps({ accessibilityLabel: '맵 추가 탭' })
    .find((node) => (node.type as unknown) === 'Pressable')!;
  assert.equal(selected.props.accessibilityRole, 'tab');
  assert.deepEqual(selected.props.accessibilityState, { selected: true });
  assert.deepEqual(catalog.props.accessibilityState, { selected: false });
  assert.ok(flattenStyle(selected.props.style).minHeight as number >= 44);

  await act(async () => { catalog.props.onPress(); });
  assert.deepEqual(changes, ['CATALOG']);
});

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (result, entry) => ({ ...result, ...flattenStyle(entry) }),
      {},
    );
  }
  return style != null && typeof style === 'object' ? style as Record<string, unknown> : {};
}
