import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => React.createElement(name, { ...props, ref }, props.children as React.ReactNode));
const flatList = (props: Record<string, unknown>) => React.createElement(
  'FlatList', props,
  (props.data as unknown[]).map((item, index) => React.createElement(
    React.Fragment,
    { key: (props.keyExtractor as (value: unknown, index: number) => string)(item, index) },
    (props.renderItem as (value: { item: unknown; index: number }) => React.ReactNode)({ item, index }),
  )),
);
const reactNativeMock = {
  AccessibilityInfo: { setAccessibilityFocus: () => undefined }, ActivityIndicator: host('ActivityIndicator'),
  findNodeHandle: () => 1, FlatList: flatList, KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Modal: host('Modal'), Platform: { OS: 'ios' }, Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(value: T) => value }, Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
};
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
const moduleWithLoader = Module as unknown as { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }) };
  if (request === 'lucide-react-native') return iconsMock;
  if (request.endsWith('/BattlePartySelector')) return { BattlePartySelector: host('BattlePartySelector') };
  if (request.endsWith('/PrimaryButton')) return { PrimaryButton: host('PrimaryButton') };
  return originalLoad(request, parent, isMain);
};
const { BattleRunPanel } = require('../../main/features/battle/components/BattleRunPanel') as typeof import('../../main/features/battle/components/BattleRunPanel');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BattleRunPanel party preset catalog', () => {
  it('opens the actual shared folder tree/search modal with direct-selection semantics', async () => {
    const catalog = {
      folders: [{ id: 1, name: '전투', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' }],
      presets: [{ id: 7, accountId: 1, name: '레이드', folderId: 1, displayOrder: 0, isPrimary: false, members: [], createdAt: '', updatedAt: '' }],
    };
    const resource = { catalog, loading: false, error: null, retry: () => undefined };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(BattleRunPanel, {
        characters: [], partyPresetCatalog: resource, isRunning: false, result: null, errorMessage: null,
        onRunBattle: () => undefined,
      }));
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 파티 프리셋 선택' }).props.onPress());
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투 폴더 열기' }));
    const direct = renderer.root.findByProps({ accessibilityLabel: '캐릭터 직접 선택 선택' });
    assert.deepEqual(direct.props.accessibilityState, { checked: false, disabled: false });
  });

  it('labels a selected preset deleted without discarding the retained battle selection', async () => {
    const selected = { id: 7, accountId: 1, name: '레이드', folderId: null, displayOrder: 0, isPrimary: false, members: [], createdAt: '', updatedAt: '' };
    const baseProps = {
      characters: [],
      partyPresetCatalog: { catalog: { folders: [], presets: [selected] }, loading: false, error: null, retry: () => undefined },
      isRunning: false,
      result: null,
      errorMessage: null,
      onRunBattle: () => undefined,
    };
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(BattleRunPanel, baseProps)); });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 파티 프리셋 선택' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '레이드 프리셋 선택' }).props.onPress());

    await act(async () => renderer.update(React.createElement(BattleRunPanel, {
      ...baseProps,
      partyPresetCatalog: { ...baseProps.partyPresetCatalog, catalog: { folders: [], presets: [] } },
    })));

    const trigger = renderer.root.findByProps({ accessibilityLabel: '전투 파티 프리셋 선택' });
    assert.equal(trigger.findAll((node) => String(node.type) === 'Text' && node.children.join('') === '삭제된 프리셋 #7').length, 1);
    await act(async () => trigger.props.onPress());
    assert.deepEqual(
      renderer.root.findByProps({ accessibilityLabel: '캐릭터 직접 선택 선택' }).props.accessibilityState,
      { checked: false, disabled: false },
    );
  });
});
