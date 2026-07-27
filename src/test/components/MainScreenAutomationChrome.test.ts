import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import type { PartyPresetResponse } from '../../main/types/api';

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
  it('loads one account catalog and shares the same resource with home and battle', async () => {
    const catalog = { folders: [], presets: [{ id: 7, name: '공유', folderId: null, displayOrder: 0, isPrimary: true, members: [], createdAt: '', updatedAt: '' }] };
    let loads = 0;
    const props = mainProps({
      onGetPartyPresetCatalog: async () => { loads += 1; return catalog; },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(MainScreen, props)); });

    const home = renderer.root.find((node) => String(node.type) === 'HomeTabScreen');
    const homeCatalogResource = home.props.partyPresetCatalog;
    assert.equal(loads, 1);
    assert.equal(home.props.partyPresetCatalog.catalog, catalog);
    assert.equal(home.props.partyPresetCatalog.loading, false);

    await act(async () => renderer.root.find((node) => String(node.type) === 'BottomTabBar').props.onChangeTab('battle'));
    const battle = renderer.root.find((node) => String(node.type) === 'BattleTabScreen');
    assert.equal(battle.props.partyPresetCatalog, homeCatalogResource);
    assert.equal(loads, 1);
  });

  it('does not refresh or repopulate the catalog when a preset mutation finishes after auth loss', async () => {
    const mutation = deferred<PartyPresetResponse>();
    let loads = 0;
    const props = mainProps({
      onGetPartyPresetCatalog: async () => { loads += 1; return { folders: [], presets: [] }; },
      onCreatePartyPreset: () => mutation.promise,
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(MainScreen, props)); });
    const manager = await openPartyPresetManager(renderer);
    let resultPromise!: Promise<PartyPresetResponse>;
    await act(async () => { resultPromise = manager.props.onCreatePartyPreset({ name: 'late', members: [], folderId: null }); });
    await act(async () => renderer.update(React.createElement(MainScreen, { ...props, session: null })));
    await act(async () => mutation.resolve({ id: 99, accountId: 1, name: 'late', folderId: null, displayOrder: 0, isPrimary: false, members: [], createdAt: '', updatedAt: '' }));
    await resultPromise;

    assert.equal(loads, 1);
    await act(async () => renderer.update(React.createElement(MainScreen, props)));
    assert.equal(loads, 2);
  });

  it('adopts a folder mutation catalog once without issuing a duplicate refresh', async () => {
    const authoritative = {
      folders: [{ id: 10, name: '전투', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' }],
      presets: [],
    };
    let loads = 0;
    let mutations = 0;
    const props = mainProps({
      onGetPartyPresetCatalog: async () => { loads += 1; return { folders: [], presets: [] }; },
      onCreatePartyPresetFolder: async () => { mutations += 1; return authoritative; },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(MainScreen, props)); });
    const manager = await openPartyPresetManager(renderer);
    await act(async () => { await manager.props.onCreatePartyPresetFolder({ name: '전투', parentFolderId: null }); });

    const updatedManager = renderer.root.find((node) => String(node.type) === 'PartyPresetList');
    assert.equal(updatedManager.props.partyPresetCatalog.catalog, authoritative);
    assert.equal(mutations, 1);
    assert.equal(loads, 1);
  });

  it('protects system insets and hides global chrome only while an editor is active', async () => {
    const props = mainProps();
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

function mainProps(overrides: Record<string, unknown> = {}) {
  return {
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
      onGetPartyPresetCatalog: async () => ({ folders: [], presets: [] }),
      onCreatePartyPreset: async () => ({}) as never,
      onUpdatePartyPreset: async () => ({}) as never,
      onMakePartyPresetPrimary: async () => ({}) as never,
      onReorderPartyPresets: async () => [],
      onDeletePartyPreset: async () => null,
      onLoadCharacterDetail: async () => ({}) as never,
      onLoadPattern: async () => ({}) as never,
      onLogout: () => undefined,
      onOpenLogin: () => undefined,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function openPartyPresetManager(renderer: ReturnType<typeof create>) {
  await act(async () => renderer.root.find((node) => String(node.type) === 'BottomTabBar').props.onChangeTab('characters'));
  const presetTab = renderer.root.findAllByProps({ accessibilityRole: 'button' }).find((node) => (
    node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '프리셋').length > 0
  ));
  await act(async () => presetTab?.props.onPress());
  return renderer.root.find((node) => String(node.type) === 'PartyPresetList');
}
