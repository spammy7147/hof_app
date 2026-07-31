import assert from 'node:assert/strict';
import Module from 'node:module';
import { it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const FlatList = (props: Record<string, unknown>) => {
  const data = props.data as unknown[];
  const renderItem = props.renderItem as (value: { item: unknown }) => React.ReactNode;
  return React.createElement('FlatList', props, props.ListHeaderComponent as React.ReactNode, data.map((item, index) => React.createElement(React.Fragment, { key: index }, renderItem({ item }))));
};
const icons = new Proxy({}, { get: (_target, property) => host(String(property)) });
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return { ActivityIndicator: host('ActivityIndicator'), FlatList, Pressable: host('Pressable'), StyleSheet: { create: <T,>(value: T) => value }, Text: host('Text'), View: host('View') };
  if (request === 'lucide-react-native') return icons;
  if (request.endsWith('/BattleRunPanel')) return { BattleRunPanel: host('BattleRunPanel') };
  if (request.endsWith('/PrimaryButton')) return { PrimaryButton: host('PrimaryButton') };
  return originalLoad(request, parent, isMain);
};
const { BattleTabScreen } = require('../../main/screens/BattleTabScreen') as typeof import('../../main/screens/BattleTabScreen');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('낚시 target 맵을 펼친 뒤 일회성 target을 소비한다', async () => {
  let consumed = 0;
  const map = {
    categoryId: 'battle_map', mapCode: 'fishing_12', name: '낚시 전투', groupName: '낚시', groupOrder: 1, mapOrder: 1,
    recommendedLevel: null, availableCount: 1, attemptCount: 0, winCount: 0, cooldownRemainingText: null,
    cooldownRemainingSeconds: null, keyMode: 'NOT_REQUIRED', keyCount: null, requiredTime: 1, supportsThreeBattles: false,
    enabled: true, resolved: true, iconUrl: null, rawHref: '?common=fishing_12',
  } as const;
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(BattleTabScreen, {
      authenticated: true,
      categories: [{ id: 'battle_map', label: '전투맵', description: '', order: 1, enabled: true }],
      isLoading: false,
      errorMessage: null,
      characters: [],
      onLoadCategories: () => undefined,
      onLoadMaps: async () => [map],
      partyPresetCatalog: { catalog: { folders: [], presets: [] }, loading: false, error: null, reload: async () => undefined } as never,
      onRunBattle: async () => { throw new Error('unexpected'); },
      initialTarget: { categoryId: 'battle_map', mapCode: 'fishing_12' },
      onInitialTargetConsumed: () => { consumed += 1; },
    }));
    await Promise.resolve();
  });

  assert.equal(consumed, 1);
  assert.equal(renderer.root.findAll((node) => String(node.type) === 'BattleRunPanel').length, 1);
});
