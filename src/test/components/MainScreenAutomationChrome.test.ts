import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement(name, { ...props, ref }, props.children as React.ReactNode)
));
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  Pressable: host('Pressable'),
  SafeAreaView: host('SafeAreaView'),
  ScrollView: host('ScrollView'),
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
  if (request === 'react-native-safe-area-context') return { SafeAreaView: host('SafeAreaView') };
  if (request === 'lucide-react-native') return iconsMock;
  if (request.endsWith('/BottomTabBar')) return { BottomTabBar: host('BottomTabBar') };
  if (request.endsWith('/CharacterDetail')) return { CharacterDetail: host('CharacterDetail') };
  if (request.endsWith('/CharacterList')) return { CharacterList: host('CharacterList') };
  if (request.endsWith('/GameStatusBar')) return { GameStatusBar: host('GameStatusBar') };
  if (request.endsWith('/PartyPresetList')) return { PartyPresetList: host('PartyPresetList') };
  if (request.endsWith('/PrimaryButton')) return { PrimaryButton: host('PrimaryButton') };
  if (request.endsWith('/BattleTabScreen')) return { BattleTabScreen: host('BattleTabScreen') };
  if (request.endsWith('/DataTabScreen')) return { DataTabScreen: host('DataTabScreen') };
  if (request.endsWith('/HomeTabScreen')) return { HomeTabScreen: host('HomeTabScreen') };
  if (request.endsWith('/SettingsTabScreen')) return { SettingsTabScreen: host('SettingsTabScreen') };
  if (request.endsWith('/TownTabScreen')) return { TownTabScreen: host('TownTabScreen') };
  return originalLoad(request, parent, isMain);
};
const { MainScreen } = require('../../main/screens/MainScreen') as typeof import('../../main/screens/MainScreen');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MainScreen automation editor chrome', () => {
  it('protects system insets and hides global chrome only while an editor is active', async () => {
    const props = {
      session: { loggedIn: true },
      status: null,
      battleCategories: [],
      areBattleCategoriesLoaded: true,
      isBattleCategoriesLoading: false,
      battleCategoriesError: null,
      characters: [],
      characterSyncLabel: null,
      notice: null,
      onLoadBattleCategories: () => undefined,
      onLoadBattleMaps: async () => [],
      onRunBattle: async () => ({}) as never,
      onLoadBattleLogs: async () => [],
      onLoadBattleStats: async () => ({}) as never,
      onOpenCaptcha: () => undefined,
      automationController: {} as never,
      onListPartyPresets: async () => [],
      onCreatePartyPreset: async () => ({}) as never,
      onUpdatePartyPreset: async () => ({}) as never,
      onMakePartyPresetPrimary: async () => ({}) as never,
      onReorderPartyPresets: async () => [],
      onDeletePartyPreset: async () => null,
      onLoadCharacterDetail: async () => ({}) as never,
      onLoadPattern: async () => ({}) as never,
      onLogout: () => undefined,
      onOpenLogin: () => undefined,
    };
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(MainScreen, props)); });

    assert.equal(renderer.root.findAll((node) => String(node.type) === 'GameStatusBar').length, 1);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'BottomTabBar').length, 1);
    assert.deepEqual(renderer.root.find((node) => String(node.type) === 'SafeAreaView').props.edges, ['top', 'bottom']);

    await act(async () => {
      renderer.root.find((node) => String(node.type) === 'HomeTabScreen').props.onDetailModeChange(true);
    });
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'GameStatusBar').length, 0);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'BottomTabBar').length, 0);

    await act(async () => {
      renderer.root.find((node) => String(node.type) === 'HomeTabScreen').props.onDetailModeChange(false);
    });
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'GameStatusBar').length, 1);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'BottomTabBar').length, 1);
  });
});
