import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type {
  AdventureMapSettingResponse,
  BattleMapResponse,
  PartyPresetResponse,
  TypedAutomationEntryResponse,
  UpdateAdventureMapAutomationRequest,
} from '../../main/types/api';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => props, [props]);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const flatList = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => React.createElement(
  'FlatList',
  { ...props, ref },
  (props.data as unknown[]).map((item, index) => React.createElement(
    React.Fragment,
    { key: (props.keyExtractor as (value: unknown, index: number) => string)(item, index) },
    (props.renderItem as (value: { item: unknown; index: number }) => React.ReactNode)({ item, index }),
  )),
));
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: () => undefined },
  FlatList: flatList,
  Modal: host('Modal'),
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Switch: host('Switch'),
  Text: host('Text'),
  TextInput: host('TextInput'),
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
const { AdventureMapAutomationEditor } = require(
  '../../main/features/automation/components/AdventureMapAutomationEditor',
) as typeof import('../../main/features/automation/components/AdventureMapAutomationEditor');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AdventureMapAutomationEditor', () => {
  it('shows observed unavailable state without disabling selection and saves ordered typed settings', async () => {
    const saves: UpdateAdventureMapAutomationRequest[] = [];
    const renderer = await renderEditor({
      maps: [
        map('cooldown', '쿨다운 맵', { cooldownRemainingSeconds: 60, cooldownRemainingText: '1분', enabled: false }),
        map('free', '무제한 맵'),
      ],
      onSave: async (request) => { saves.push(request); return true; },
    });

    assert.equal(hasText(renderer.root, '오늘 초기화 완료 · 오전 12:03'), true);
    const cooldown = renderer.root.findByProps({ accessibilityLabel: '쿨다운 맵 모험맵 선택' });
    assert.equal(cooldown.props.disabled, false);
    await act(async () => { cooldown.props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '무제한 맵 모험맵 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '무제한 맵 위로' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 저장' }).props.onPress(); });

    assert.deepEqual(saves, [{
      enabled: true,
      maps: [
        { categoryId: 'adventure_map', mapCode: 'free', presetMode: 'PRIMARY', partyPresetId: null, executionOrder: 0 },
        { categoryId: 'adventure_map', mapCode: 'cooldown', presetMode: 'PRIMARY', partyPresetId: null, executionOrder: 1 },
      ],
    }]);
  });

  it('updates PRIMARY labels from the latest preset list while keeping explicit labels fixed', async () => {
    const maps = [map('primary', '대표 맵'), map('explicit', '고정 맵')];
    const loadMaps = async () => maps;
    const before = [
      preset(7, '기존 대표', true),
      preset(9, '고정 파티', false),
    ];
    const after = [
      preset(7, '기존 대표', false),
      preset(8, '새 대표', true),
      preset(9, '고정 파티', false),
    ];
    const base = editorProps({
      entry: entry([
        setting('primary', 0, 'PRIMARY', null),
        setting('explicit', 1, 'EXPLICIT', 9),
      ]),
      onLoadBattleMaps: loadMaps,
      onListPartyPresets: async () => before,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });

    assert.equal(hasText(renderer.root, '대표 · 기존 대표'), true);
    assert.equal(hasText(renderer.root, '고정 파티'), true);

    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        onListPartyPresets: async () => after,
      }));
    });

    assert.equal(hasText(renderer.root, '대표 · 새 대표'), true);
    assert.equal(hasText(renderer.root, '고정 파티'), true);
    assert.equal(hasText(renderer.root, '대표 · 기존 대표'), false);
  });

  it('fences older map and preset responses when loaders change', async () => {
    const oldMaps = deferred<BattleMapResponse[]>();
    const newMaps = deferred<BattleMapResponse[]>();
    const oldPresets = deferred<PartyPresetResponse[]>();
    const newPresets = deferred<PartyPresetResponse[]>();
    const base = editorProps({
      onLoadBattleMaps: () => oldMaps.promise,
      onListPartyPresets: () => oldPresets.promise,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });
    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        onLoadBattleMaps: () => newMaps.promise,
        onListPartyPresets: () => newPresets.promise,
      }));
    });
    await act(async () => {
      newMaps.resolve([map('new', '최신 맵')]);
      newPresets.resolve([preset(8, '최신 대표', true)]);
      await Promise.all([newMaps.promise, newPresets.promise]);
    });
    await act(async () => {
      oldMaps.resolve([map('old', '이전 맵')]);
      oldPresets.resolve([preset(7, '이전 대표', true)]);
      await Promise.all([oldMaps.promise, oldPresets.promise]);
    });

    assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '최신 맵 모험맵 선택' }).length > 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '이전 맵 모험맵 선택' }).length, 0);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '최신 맵 모험맵 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '대표 · 최신 대표'), true);
    assert.equal(hasText(renderer.root, '대표 · 이전 대표'), false);
  });
});

async function renderEditor(overrides: { maps?: BattleMapResponse[]; onSave?: (request: UpdateAdventureMapAutomationRequest) => Promise<boolean> } = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(AdventureMapAutomationEditor, editorProps({
      onLoadBattleMaps: async () => overrides.maps ?? [],
      onSave: overrides.onSave ?? (async () => true),
    })));
  });
  return renderer;
}

function editorProps(overrides: Partial<React.ComponentProps<typeof AdventureMapAutomationEditor>> = {}) {
  return {
    entry: entry(),
    dailyRefresh: { status: 'COMPLETE' as const, refreshDate: '2026-07-16', refreshedAt: '2026-07-15T15:03:00Z' },
    battleCategories: [{ id: 'adventure_map', label: '모험맵', description: '', order: 0, enabled: true }],
    areBattleCategoriesLoaded: true,
    isBattleCategoriesLoading: false,
    battleCategoriesError: null,
    mutationMessage: null,
    saving: false,
    onBack: () => undefined,
    onDelete: async () => true,
    onLoadBattleCategories: () => undefined,
    onLoadBattleMaps: async () => [],
    onListPartyPresets: async () => [],
    onClearMutationMessage: () => undefined,
    onSave: async () => true,
    ...overrides,
  };
}
function hasText(root: ReactTestInstance, text: string): boolean {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length > 0;
}
function entry(adventureMaps: TypedAutomationEntryResponse['adventureMaps'] = []): TypedAutomationEntryResponse {
  return { id: 15, type: 'ADVENTURE_MAP', enabled: true, priority: 2, ready: true, warnings: [], quests: [], battleMaps: [], battleMapProgress: [], adventureMaps };
}
function map(mapCode: string, name: string, overrides: Partial<BattleMapResponse> = {}): BattleMapResponse {
  return { categoryId: 'adventure_map', mapCode, name, groupName: null, groupOrder: 0, mapOrder: 0, recommendedLevel: null, availableCount: null, attemptCount: null, winCount: null, cooldownRemainingText: null, cooldownRemainingSeconds: null, keyCount: null, requiredTime: null, supportsThreeBattles: false, enabled: true, resolved: true, iconUrl: null, rawHref: '', ...overrides };
}
function setting(
  mapCode: string,
  executionOrder: number,
  presetMode: 'PRIMARY' | 'EXPLICIT',
  partyPresetId: number | null,
): AdventureMapSettingResponse {
  if (presetMode === 'PRIMARY') {
    return { categoryId: 'adventure_map', mapCode, executionOrder, presetMode, partyPresetId: null };
  }
  if (partyPresetId == null) throw new Error('EXPLICIT test setting requires a preset id.');
  return { categoryId: 'adventure_map', mapCode, executionOrder, presetMode, partyPresetId };
}
function preset(id: number, name: string, isPrimary: boolean): PartyPresetResponse {
  return { id, accountId: 1, name, isPrimary, members: [], createdAt: '', updatedAt: '' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}
