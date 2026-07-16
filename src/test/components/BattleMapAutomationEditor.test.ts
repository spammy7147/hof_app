import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type {
  BattleMapResponse,
  TypedAutomationEntryResponse,
  UpdateBattleMapAutomationRequest,
} from '../../main/types/api';

let alertArguments: unknown[] | null = null;
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement(name, { ...props, ref }, props.children as React.ReactNode)
));
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
  Alert: { alert: (...args: unknown[]) => { alertArguments = args; } },
  FlatList: flatList, Pressable: host('Pressable'), ScrollView: host('ScrollView'), StyleSheet: { create: <T,>(styles: T) => styles },
  Switch: host('Switch'), Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
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
const { BattleMapAutomationEditor } = require(
  '../../main/features/automation/components/BattleMapAutomationEditor',
) as typeof import('../../main/features/automation/components/BattleMapAutomationEditor');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BattleMapAutomationEditor mounted behavior', () => {
  it('searches/selects, edits target, shows progress/capability, chooses preset, reorders/removes, and saves exact typed settings', async () => {
    const saves: UpdateBattleMapAutomationRequest[] = [];
    const renderer = await renderEditor({
      entry: battleEntry([
        setting('a', 5, 0),
        setting('missing', 2, 1),
      ], [{ categoryId: 'battle', mapCode: 'a', successfulRuns: 3 }]),
      maps: [catalogMap('a', 'Alpha', { supportsThreeBattles: true }), catalogMap('b', 'Beta', { groupName: 'Forest', recommendedLevel: 'Lv 20' })],
      presets: [preset(9, 'Raid Team')],
      onSave: async (request) => { saves.push(request); return true; },
    });

    assert.equal(hasText(renderer.root, '오늘 성공 3회'), true);
    assert.equal(hasText(renderer.root, '남은 목표 2회'), true);
    assert.equal(hasText(renderer.root, '60%'), true);
    assert.equal(hasText(renderer.root, '3회 전투 지원'), true);
    assert.equal(hasText(renderer.root, '다음 3회 전투'), true);
    assert.equal(hasText(renderer.root, 'missing'), true);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투 맵 검색' }).props.onChangeText('forest'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 맵 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 일일 목표' }).props.onChangeText('4'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 프리셋 검색' }).props.onChangeText('raid'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta Raid Team 프리셋' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 맵 위로' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'missing 맵 제거' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.onPress(); });

    assert.deepEqual(saves, [{ enabled: true, maps: [
      setting('a', 5, 0),
      { ...setting('b', 4, 1), presetMode: 'EXPLICIT', partyPresetId: 9 },
    ] }]);
  });

  it('keeps selected rows through independent map/preset failures and retries only the failed resource', async () => {
    let mapAttempts = 0;
    let presetAttempts = 0;
    const renderer = await renderEditor({
      entry: battleEntry([setting('saved', 3, 0)]),
      mutationMessage: '저장 실패',
      onLoadBattleMaps: async () => { mapAttempts += 1; if (mapAttempts === 1) throw new Error('map down'); return [catalogMap('new', 'New Map')]; },
      onListPartyPresets: async () => { presetAttempts += 1; if (presetAttempts === 1) throw new Error('preset down'); return []; },
    });
    assert.equal(hasText(renderer.root, 'saved'), true);
    assert.equal(hasText(renderer.root, '저장 실패'), true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 작업 오류' }));
    assert.equal(hasText(renderer.root, '전투맵 맵을 불러오지 못했어요.'), true);
    assert.equal(hasText(renderer.root, '프리셋을 불러오지 못했어요.'), true);

    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투맵 맵 다시 불러오기' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '프리셋 다시 불러오기' }).props.onPress(); });
    assert.equal(mapAttempts, 2);
    assert.equal(presetAttempts, 2);
    assert.equal(hasText(renderer.root, 'saved'), true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'New Map 맵 선택' }));
  });

  it('confirms dirty back, disables all mutations while busy or invalid, and deletes before navigating', async () => {
    alertArguments = null;
    let backs = 0;
    let deletes = 0;
    const renderer = await renderEditor({
      entry: battleEntry([setting('a', 3, 0)]), maps: [catalogMap('a', 'Alpha')],
      onBack: () => { backs += 1; }, onDelete: async () => { deletes += 1; return true; },
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 일일 목표' }).props.onChangeText('0'); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.disabled, true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 뒤로' }).props.onPress(); });
    assert.equal((alertArguments?.[0]), '변경 사항을 버릴까요?');
    const backButtons = alertArguments?.[2] as unknown as Array<{ text: string; onPress?: () => void }>;
    backButtons.find(({ text }) => text === '나가기')?.onPress?.();
    assert.equal(backs, 1);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 삭제' }).props.onPress(); });
    const deleteButtons = alertArguments?.[2] as unknown as Array<{ text: string; onPress?: () => Promise<void> }>;
    await act(async () => { await deleteButtons.find(({ text }) => text === '삭제')?.onPress?.(); });
    assert.equal(deletes, 1);
    assert.equal(backs, 2);

    const busy = await renderEditor({ saving: true, entry: battleEntry([setting('a', 3, 0)]), maps: [catalogMap('a', 'Alpha')] });
    for (const label of ['전투 맵 자동화 뒤로', '전투 맵 자동화 삭제', 'Alpha 맵 제거', 'Alpha 일일 목표']) {
      const control = busy.root.findByProps({ accessibilityLabel: label });
      assert.equal(control.props.disabled ?? !control.props.editable, true, label);
    }
    assert.equal(busy.root.findByProps({ accessibilityLabel: '전투 맵 자동화 사용' }).props.disabled, true);
    assert.equal(busy.root.findByProps({ accessibilityLabel: '전투 맵 검색' }).props.editable, false);
    assert.equal(busy.root.findByProps({ accessibilityLabel: 'Alpha 대표 프리셋 사용' }).props.disabled, true);
    assert.equal(busy.root.findByProps({ accessibilityLabel: 'Alpha 맵 선택' }).props.disabled, true);
  });

  it('keeps intermediate target text, validates it without crashing, and saves the later valid integer', async () => {
    const saves: UpdateBattleMapAutomationRequest[] = [];
    const renderer = await renderEditor({
      entry: battleEntry([setting('a', 3, 0)]), maps: [catalogMap('a', 'Alpha')],
      onSave: async (request) => { saves.push(request); return true; },
    });
    const input = () => renderer.root.findByProps({ accessibilityLabel: 'Alpha 일일 목표' });

    await act(async () => { input().props.onChangeText(''); });
    assert.equal(input().props.value, '');
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.disabled, true);
    await act(async () => { input().props.onChangeText('not-a-number'); });
    assert.equal(input().props.value, 'not-a-number');
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.disabled, true);
    await act(async () => { input().props.onChangeText('4'); });
    assert.equal(input().props.value, '4');
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.onPress(); });

    assert.deepEqual(saves, [{ enabled: true, maps: [setting('a', 4, 0)] }]);
  });

  it('accepts fresh server progress during a dirty settings edit without overwriting the edit', async () => {
    const base = editorProps({
      entry: battleEntry([setting('a', 3, 0)], [{ categoryId: 'battle', mapCode: 'a', successfulRuns: 1 }]),
      maps: [catalogMap('a', 'Alpha')],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(BattleMapAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 사용' }).props.onValueChange(false); });

    await act(async () => {
      renderer.update(React.createElement(BattleMapAutomationEditor, {
        ...base,
        entry: battleEntry([setting('a', 9, 0)], [{ categoryId: 'battle', mapCode: 'a', successfulRuns: 2 }]),
      }));
    });

    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 사용' }).props.value, false);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Alpha 일일 목표' }).props.value, '3');
    assert.equal(hasText(renderer.root, '오늘 성공 2회'), true);
    assert.equal(hasText(renderer.root, '새 서버 설정이 있지만 편집 중인 변경은 유지했습니다.'), true);
  });

  it('loads categories that arrive asynchronously and disables draft mutations until the initial catalog settles', async () => {
    const maps = deferred<BattleMapResponse[]>();
    let categoryLoads = 0;
    const base = editorProps({
      entry: battleEntry([setting('a', 3, 0)]),
      battleCategories: [],
      areBattleCategoriesLoaded: false,
      onLoadBattleCategories: () => { categoryLoads += 1; },
      onLoadBattleMaps: async () => maps.promise,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(BattleMapAutomationEditor, base)); });
    assert.equal(categoryLoads, 1);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'a 일일 목표' }).props.editable, false);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 사용' }).props.disabled, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'a 맵 제거' }).props.disabled, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 검색' }).props.editable, false);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 삭제' }).props.disabled, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.disabled, true);

    await act(async () => {
      renderer.update(React.createElement(BattleMapAutomationEditor, {
        ...base,
        areBattleCategoriesLoaded: true,
        battleCategories: [{ id: 'battle', label: '전투맵', description: '', order: 0, enabled: true }],
      }));
    });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'a 일일 목표' }).props.editable, false);
    await act(async () => { maps.resolve([catalogMap('a', 'Alpha')]); await maps.promise; });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Alpha 일일 목표' }).props.editable, true);
  });

  it('fences a disabled category response, prunes it, and reloads it when re-enabled', async () => {
    const first = deferred<BattleMapResponse[]>();
    const second = deferred<BattleMapResponse[]>();
    let attempts = 0;
    const enabled = [{ id: 'battle', label: '전투맵', description: '', order: 0, enabled: true }];
    const base = editorProps({
      battleCategories: enabled,
      areBattleCategoriesLoaded: true,
      onLoadBattleMaps: async () => (++attempts === 1 ? first.promise : second.promise),
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(BattleMapAutomationEditor, base)); });
    await act(async () => {
      renderer.update(React.createElement(BattleMapAutomationEditor, {
        ...base,
        battleCategories: [{ ...enabled[0]!, enabled: false }],
      }));
      first.resolve([catalogMap('stale', 'Stale')]);
      await first.promise;
    });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Stale 맵 선택' }).length, 0);

    await act(async () => {
      renderer.update(React.createElement(BattleMapAutomationEditor, { ...base, battleCategories: enabled }));
      second.resolve([catalogMap('fresh', 'Fresh')]);
      await second.promise;
    });
    assert.equal(attempts, 2);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Fresh 맵 선택' }));
  });

  it('preserves selected-row progress identity and target edits across a catalog refresh', async () => {
    let attempts = 0;
    const enabled = [{ id: 'battle', label: '전투맵', description: '', order: 0, enabled: true }];
    const base = editorProps({
      entry: battleEntry([setting('a', 3, 0)], [{ categoryId: 'battle', mapCode: 'a', successfulRuns: 2 }]),
      battleCategories: enabled,
      onLoadBattleMaps: async () => [catalogMap('a', ++attempts === 1 ? 'Alpha' : 'Alpha Refreshed')],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(BattleMapAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 일일 목표' }).props.onChangeText('4'); });
    await act(async () => {
      renderer.update(React.createElement(BattleMapAutomationEditor, {
        ...base,
        battleCategories: [{ ...enabled[0]!, enabled: false }],
      }));
    });
    await act(async () => {
      renderer.update(React.createElement(BattleMapAutomationEditor, { ...base, battleCategories: enabled }));
    });
    assert.equal(attempts, 2);
    assert.equal(hasText(renderer.root, '오늘 성공 2회'), true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Alpha Refreshed 일일 목표' }).props.value, '4');
  });

  it('repairs a deleted explicit preset and keeps a missing stored map labeled and removable', async () => {
    const broken = { ...setting('missing', 3, 0), presetMode: 'EXPLICIT' as const, partyPresetId: 99 };
    const renderer = await renderEditor({ entry: battleEntry([broken]), presets: [preset(7, 'Existing')] });
    assert.equal(hasText(renderer.root, 'missing'), true);
    assert.equal(hasText(renderer.root, '현재 맵 목록에 없음 · 저장된 설정'), true);
    assert.equal(hasText(renderer.root, '선택한 프리셋이 삭제되었습니다. 다른 프리셋을 선택해 주세요.'), true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.disabled, true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'missing Existing 프리셋' }).props.onPress(); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.disabled, false);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'missing 맵 제거' }).props.onPress(); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'missing 맵 제거' }).length, 0);
  });

  it('uses one virtualized list without nesting a scroll view', async () => {
    const renderer = await renderEditor({ maps: [catalogMap('a', 'Alpha')] });
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'FlatList').length, 1);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'ScrollView').length, 0);
  });

  it('retries a category failure independently and keeps the stored draft available', async () => {
    let categoryRetries = 0;
    const renderer = await renderEditor({
      entry: battleEntry([setting('stored', 3, 0)]),
      battleCategories: [],
      areBattleCategoriesLoaded: false,
      battleCategoriesError: 'category down',
      onLoadBattleCategories: () => { categoryRetries += 1; },
      presets: [preset(7, 'Existing')],
    });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'stored 일일 목표' }).props.editable, true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'stored Existing 프리셋' }));
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '맵 카테고리 다시 불러오기' }).props.onPress(); });
    assert.equal(categoryRetries, 1);
  });

  it('stays mounted after failed save/delete and ignores late resource responses after unmount', async () => {
    let backs = 0;
    const renderer = await renderEditor({
      entry: battleEntry([setting('a', 3, 0)]),
      maps: [catalogMap('a', 'Alpha')],
      mutationMessage: '저장 실패',
      onBack: () => { backs += 1; },
      onSave: async () => false,
      onDelete: async () => false,
    });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.onPress(); });
    assert.equal(backs, 0);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 작업 오류' }));
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 삭제' }).props.onPress(); });
    const buttons = alertArguments?.[2] as unknown as Array<{ text: string; onPress?: () => Promise<void> }>;
    await act(async () => { await buttons.find(({ text }) => text === '삭제')?.onPress?.(); });
    assert.equal(backs, 0);

    const maps = deferred<BattleMapResponse[]>();
    const presets = deferred<ReturnType<typeof preset>[]>();
    const late = await renderEditor({ onLoadBattleMaps: async () => maps.promise, onListPartyPresets: async () => presets.promise });
    await act(async () => { late.unmount(); });
    await act(async () => {
      maps.resolve([catalogMap('late', 'Late')]);
      presets.resolve([preset(8, 'Late')]);
      await Promise.all([maps.promise, presets.promise]);
    });
  });
});

type Overrides = {
  entry?: TypedAutomationEntryResponse; maps?: BattleMapResponse[]; presets?: ReturnType<typeof preset>[];
  saving?: boolean; mutationMessage?: string | null;
  onLoadBattleMaps?: (categoryId: string) => Promise<BattleMapResponse[]>;
  onListPartyPresets?: () => Promise<ReturnType<typeof preset>[]>;
  onSave?: (request: UpdateBattleMapAutomationRequest) => Promise<boolean>;
  onBack?: () => void; onDelete?: () => Promise<boolean>;
  battleCategories?: Array<{ id: string; label: string; description: string; order: number; enabled: boolean }>;
  areBattleCategoriesLoaded?: boolean; isBattleCategoriesLoading?: boolean; battleCategoriesError?: string | null;
  onLoadBattleCategories?: () => void;
};

async function renderEditor(overrides: Overrides = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(BattleMapAutomationEditor, editorProps(overrides)));
  });
  return renderer;
}

function editorProps(overrides: Overrides = {}) {
  return {
    entry: overrides.entry ?? battleEntry(), saving: overrides.saving ?? false,
    mutationMessage: overrides.mutationMessage ?? null,
    battleCategories: overrides.battleCategories ?? [{ id: 'battle', label: '전투맵', description: '', order: 0, enabled: true }],
    areBattleCategoriesLoaded: overrides.areBattleCategoriesLoaded ?? true,
    isBattleCategoriesLoading: overrides.isBattleCategoriesLoading ?? false,
    battleCategoriesError: overrides.battleCategoriesError ?? null,
    onLoadBattleCategories: overrides.onLoadBattleCategories ?? (() => undefined),
    onLoadBattleMaps: overrides.onLoadBattleMaps ?? (async () => overrides.maps ?? []),
    onListPartyPresets: overrides.onListPartyPresets ?? (async () => overrides.presets ?? []),
    onClearMutationMessage: () => undefined,
    onSave: overrides.onSave ?? (async () => true), onBack: overrides.onBack ?? (() => undefined),
    onDelete: overrides.onDelete ?? (async () => true),
  };
}

function hasText(root: ReactTestInstance, text: string): boolean {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length > 0;
}
function battleEntry(battleMaps = [] as TypedAutomationEntryResponse['battleMaps'], battleMapProgress: NonNullable<TypedAutomationEntryResponse['battleMapProgress']> = []): TypedAutomationEntryResponse {
  return { id: 14, type: 'BATTLE_MAP', enabled: true, priority: 0, ready: true, warnings: [], quests: [], battleMaps, battleMapProgress, adventureMaps: [] };
}
function setting(mapCode: string, dailyTargetCount: number, executionOrder: number) {
  return { categoryId: 'battle', mapCode, dailyTargetCount, executionOrder, presetMode: 'PRIMARY' as const, partyPresetId: null };
}
function catalogMap(mapCode: string, name: string, overrides: Partial<BattleMapResponse> = {}): BattleMapResponse {
  return { categoryId: 'battle', mapCode, name, groupName: null, groupOrder: 0, mapOrder: 0, recommendedLevel: null, availableCount: null, attemptCount: null, winCount: null, cooldownRemainingText: null, cooldownRemainingSeconds: null, keyCount: null, requiredTime: null, enabled: true, resolved: true, iconUrl: null, rawHref: '', ...overrides, supportsThreeBattles: overrides.supportsThreeBattles ?? false };
}
function preset(id: number, name: string) { return { id, accountId: 1, name, members: [], createdAt: '', updatedAt: '' }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
