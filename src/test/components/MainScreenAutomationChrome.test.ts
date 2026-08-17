import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import type { PartyPresetResponse } from '../../main/types/api';
import { makeHofCharacter } from '../fixtures/api';

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
  if (request === 'react-native-draggable-flatlist') return {
    NestableScrollContainer: host('NestableScrollContainer'),
  };
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
  it('hides the status header and bottom tabs while a town detail uses the safe-area layout', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(MainScreen, mainProps({}))); });

    const tabs = renderer.root.find((node) => String(node.type) === 'BottomTabBar');
    await act(async () => tabs.props.onChangeTab('town'));
    const town = renderer.root.find((node) => String(node.type) === 'TownTabScreen');
    await act(async () => town.props.onDetailStateChange('fishing', true));

    assert.equal(renderer.root.findAll((node) => String(node.type) === 'GameStatusBar').length, 0);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'BottomTabBar').length, 0);
    assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '마을 상세 전체 화면' }).length > 0);

    await act(async () => renderer.root.find((node) => String(node.type) === 'TownTabScreen')
      .props.onDetailStateChange('fishing', false));
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'GameStatusBar').length, 1);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'BottomTabBar').length, 1);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '마을 상세 전체 화면' }).length, 0);
  });

  it('passes the exact fishing battle target from town into the battle screen', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(MainScreen, mainProps({}))); });
    const tabs = renderer.root.find((node) => String(node.type) === 'BottomTabBar');
    await act(async () => tabs.props.onChangeTab('town'));
    const town = renderer.root.find((node) => String(node.type) === 'TownTabScreen');
    const target = { categoryId: 'battle_map', mapCode: 'fishing_12' };
    await act(async () => town.props.onOpenFishingBattle(target));

    const battle = renderer.root.find((node) => String(node.type) === 'BattleTabScreen');
    assert.deepEqual(battle.props.initialTarget, target);
    await act(async () => battle.props.onInitialTargetConsumed());
    assert.equal(renderer.root.find((node) => String(node.type) === 'BattleTabScreen').props.initialTarget, null);

    await act(async () => tabs.props.onChangeTab('town'));
    await act(async () => tabs.props.onChangeTab('battle'));
    assert.equal(renderer.root.find((node) => String(node.type) === 'BattleTabScreen').props.initialTarget, null);
  });

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

  for (const scenario of simplePresetMutationScenarios()) {
    it(`propagates ${scenario.name} success to every consumer when the follow-up refresh fails`, async () => {
      const initial = scenario.initial ?? presetCatalog([
        preset(1, '첫째', { isPrimary: true, displayOrder: 0 }),
        preset(2, '둘째', { displayOrder: 1 }),
      ]);
      let loads = 0;
      const props = mainProps({
        onGetPartyPresetCatalog: async () => {
          loads += 1;
          if (loads > 1) throw new Error('refresh failed');
          return initial;
        },
        ...scenario.handlers,
      });
      let renderer!: ReturnType<typeof create>;
      await act(async () => { renderer = create(React.createElement(MainScreen, props)); });
      const manager = await openPartyPresetManager(renderer);

      await act(async () => { await scenario.mutate(manager.props); });
      const updatedManager = renderer.root.find((node) => String(node.type) === 'PartyPresetList');
      const sharedResource = updatedManager.props.partyPresetCatalog;
      assert.deepEqual(sharedResource.catalog, scenario.expected);
      assert.equal(sharedResource.error, '파티 프리셋을 불러오지 못했습니다.');

      await act(async () => renderer.root.find((node) => String(node.type) === 'BottomTabBar').props.onChangeTab('home'));
      const home = renderer.root.find((node) => String(node.type) === 'HomeTabScreen');
      assert.equal(home.props.partyPresetCatalog, sharedResource);
      await act(async () => renderer.root.find((node) => String(node.type) === 'BottomTabBar').props.onChangeTab('battle'));
      const battle = renderer.root.find((node) => String(node.type) === 'BattleTabScreen');
      assert.equal(battle.props.partyPresetCatalog, sharedResource);
      assert.equal(loads, 2);
    });
  }

  it('applies concurrent simple mutations in invocation order', async () => {
    const first = deferred<PartyPresetResponse>();
    const second = deferred<PartyPresetResponse>();
    const calls: string[] = [];
    let loads = 0;
    const props = mainProps({
      onGetPartyPresetCatalog: async () => {
        loads += 1;
        if (loads > 1) throw new Error('refresh failed');
        return presetCatalog([preset(1, '원본', { isPrimary: true, displayOrder: 0 })]);
      },
      onUpdatePartyPreset: async () => { calls.push('update'); return first.promise; },
      onCreatePartyPreset: async () => { calls.push('create'); return second.promise; },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(MainScreen, props)); });
    const manager = await openPartyPresetManager(renderer);
    let updatePromise!: Promise<PartyPresetResponse>;
    let createPromise!: Promise<PartyPresetResponse>;
    await act(async () => {
      updatePromise = manager.props.onUpdatePartyPreset(1, { name: '수정', members: [], folderId: null });
      createPromise = manager.props.onCreatePartyPreset({ name: '신규', members: [], folderId: null });
      await Promise.resolve();
    });
    assert.deepEqual(calls, ['update']);

    await act(async () => { first.resolve(preset(1, '수정', { isPrimary: true, displayOrder: 0 })); await updatePromise; });
    assert.deepEqual(calls, ['update', 'create']);
    await act(async () => { second.resolve(preset(2, '신규', { displayOrder: 1 })); await createPromise; });

    assert.deepEqual(
      renderer.root.find((node) => String(node.type) === 'PartyPresetList').props.partyPresetCatalog.catalog.presets,
      [preset(1, '수정', { isPrimary: true, displayOrder: 1 }), preset(2, '신규', { displayOrder: 0 })],
    );
  });

  it('does not start queued old-account mutations after logout', async () => {
    const first = deferred<PartyPresetResponse>();
    let creates = 0;
    const props = mainProps({
      onUpdatePartyPreset: async () => first.promise,
      onCreatePartyPreset: async () => { creates += 1; return preset(2, '신규'); },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(MainScreen, props)); });
    const manager = await openPartyPresetManager(renderer);
    let firstPromise!: Promise<PartyPresetResponse>;
    let queuedPromise!: Promise<PartyPresetResponse>;
    await act(async () => {
      firstPromise = manager.props.onUpdatePartyPreset(1, { name: '수정', members: [], folderId: null });
      queuedPromise = manager.props.onCreatePartyPreset({ name: '신규', members: [], folderId: null });
      await Promise.resolve();
      renderer.update(React.createElement(MainScreen, { ...props, session: null }));
    });
    await act(async () => { first.resolve(preset(1, '수정')); await firstPromise; });

    await assert.rejects(queuedPromise, /cancelled/i);
    assert.equal(creates, 0);
  });

  it('fences in-flight and queued preset work when MainScreen unmounts', async () => {
    const first = deferred<PartyPresetResponse>();
    let creates = 0;
    let loads = 0;
    const props = mainProps({
      onGetPartyPresetCatalog: async () => { loads += 1; return presetCatalog([]); },
      onUpdatePartyPreset: async () => first.promise,
      onCreatePartyPreset: async () => { creates += 1; return preset(2, '신규'); },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(MainScreen, props)); });
    const manager = await openPartyPresetManager(renderer);
    let firstPromise!: Promise<PartyPresetResponse>;
    let queuedPromise!: Promise<PartyPresetResponse>;
    await act(async () => {
      firstPromise = manager.props.onUpdatePartyPreset(1, { name: '수정', members: [], folderId: null });
      queuedPromise = manager.props.onCreatePartyPreset({ name: '신규', members: [], folderId: null });
      await Promise.resolve();
      renderer.unmount();
    });
    await act(async () => { first.resolve(preset(1, '수정')); await firstPromise; });

    await assert.rejects(queuedPromise, /cancelled/i);
    assert.equal(creates, 0);
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

  it('opens character details without the global header, tabs, or a sticky footer', async () => {
    const character = makeHofCharacter();
    const props = mainProps({ characters: [character] });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(MainScreen, props)); });

    await act(async () => renderer.root.find((node) => String(node.type) === 'BottomTabBar').props.onChangeTab('characters'));
    await act(async () => renderer.root.find((node) => String(node.type) === 'CharacterList').props.onSelectCharacter(character));

    assert.equal(renderer.root.findAll((node) => String(node.type) === 'GameStatusBar').length, 0);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'BottomTabBar').length, 0);
    assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '캐릭터 상세 전체 화면' }).length > 0);

    const detail = renderer.root.find((node) => String(node.type) === 'CharacterDetail');
    await act(async () => detail.props.onBack());
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

function preset(id: number, name: string, overrides: Partial<PartyPresetResponse> = {}): PartyPresetResponse {
  return { id, accountId: 1, name, folderId: null, displayOrder: id, isPrimary: false, members: [], createdAt: '', updatedAt: '', ...overrides };
}

function presetCatalog(presets: PartyPresetResponse[]) {
  return { folders: [], presets };
}

function simplePresetMutationScenarios() {
  const created = preset(3, '셋째', { displayOrder: 0 });
  const updated = preset(1, '첫째 수정', { isPrimary: true, displayOrder: 0 });
  const madePrimary = preset(2, '둘째', { isPrimary: true, displayOrder: 1 });
  const reordered = [preset(2, '둘째', { displayOrder: 0 }), preset(1, '첫째', { isPrimary: true, displayOrder: 1 })];
  return [
    {
      name: 'create', handlers: { onCreatePartyPreset: async () => created },
      mutate: (props: Record<string, (...args: never[]) => Promise<unknown>>) => props.onCreatePartyPreset({ name: '셋째', members: [], folderId: null } as never),
      expected: presetCatalog([preset(1, '첫째', { isPrimary: true, displayOrder: 1 }), preset(2, '둘째', { displayOrder: 2 }), created]),
    },
    {
      name: 'update', handlers: { onUpdatePartyPreset: async () => updated },
      mutate: (props: Record<string, (...args: never[]) => Promise<unknown>>) => props.onUpdatePartyPreset(1 as never, { name: '첫째 수정', members: [], folderId: null } as never),
      expected: presetCatalog([updated, preset(2, '둘째', { displayOrder: 1 })]),
    },
    {
      name: 'update upsert', handlers: { onUpdatePartyPreset: async () => created },
      mutate: (props: Record<string, (...args: never[]) => Promise<unknown>>) => props.onUpdatePartyPreset(3 as never, { name: '셋째', members: [], folderId: null } as never),
      expected: presetCatalog([preset(1, '첫째', { isPrimary: true, displayOrder: 1 }), preset(2, '둘째', { displayOrder: 2 }), created]),
    },
    {
      name: 'primary', handlers: { onMakePartyPresetPrimary: async () => madePrimary },
      mutate: (props: Record<string, (...args: never[]) => Promise<unknown>>) => props.onMakePartyPresetPrimary(2 as never),
      expected: presetCatalog([preset(1, '첫째', { displayOrder: 0 }), madePrimary]),
    },
    {
      name: 'reorder', handlers: { onReorderPartyPresets: async () => reordered },
      mutate: (props: Record<string, (...args: never[]) => Promise<unknown>>) => props.onReorderPartyPresets({ folderId: null, presetIds: [2, 1] } as never),
      initial: {
        folders: [{ id: 10, name: '별도', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' }],
        presets: [preset(1, '첫째', { isPrimary: true, displayOrder: 0 }), preset(2, '둘째', { displayOrder: 1 }), preset(9, '별도 프리셋', { folderId: 10, displayOrder: 0 })],
      },
      expected: {
        folders: [{ id: 10, name: '별도', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' }],
        presets: [reordered[1]!, reordered[0]!, preset(9, '별도 프리셋', { folderId: 10, displayOrder: 0 })],
      },
    },
    {
      name: 'folder move update',
      handlers: { onUpdatePartyPreset: async () => preset(1, '이동됨', { folderId: 20, displayOrder: 0, isPrimary: true }) },
      mutate: (props: Record<string, (...args: never[]) => Promise<unknown>>) => props.onUpdatePartyPreset(1 as never, { name: '이동됨', members: [], folderId: 20 } as never),
      initial: {
        folders: [
          { id: 10, name: 'A', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' },
          { id: 20, name: 'B', parentFolderId: null, displayOrder: 1, createdAt: '', updatedAt: '' },
        ],
        presets: [
          preset(1, '첫째', { folderId: 10, displayOrder: 0, isPrimary: true }),
          preset(2, '둘째', { folderId: 10, displayOrder: 1 }),
          preset(3, '셋째', { folderId: 20, displayOrder: 0 }),
        ],
      },
      expected: {
        folders: [
          { id: 10, name: 'A', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' },
          { id: 20, name: 'B', parentFolderId: null, displayOrder: 1, createdAt: '', updatedAt: '' },
        ],
        presets: [
          preset(1, '이동됨', { folderId: 20, displayOrder: 0, isPrimary: true }),
          preset(2, '둘째', { folderId: 10, displayOrder: 0 }),
          preset(3, '셋째', { folderId: 20, displayOrder: 1 }),
        ],
      },
    },
    {
      name: 'delete', handlers: { onDeletePartyPreset: async () => null },
      mutate: (props: Record<string, (...args: never[]) => Promise<unknown>>) => props.onDeletePartyPreset(1 as never),
      expected: presetCatalog([preset(2, '둘째', { displayOrder: 1 })]),
    },
  ];
}
