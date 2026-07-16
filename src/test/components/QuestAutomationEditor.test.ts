import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type {
  BattleMapResponse,
  QuestMission,
  QuestSnapshot,
  TypedAutomationEntryResponse,
  UpdateQuestAutomationRequest,
} from '../../main/types/api';

let alertArguments: unknown[] | null = null;
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement(name, { ...props, ref }, props.children as React.ReactNode)
));
const flatList = (props: Record<string, unknown>) => {
  const data = props.data as QuestSnapshot[];
  const renderItem = props.renderItem as ({ item }: { item: QuestSnapshot }) => React.ReactNode;
  return React.createElement(
    'FlatList',
    props,
    props.ListHeaderComponent as React.ReactNode,
    data.length === 0 ? props.ListEmptyComponent as React.ReactNode : null,
    data.map((item) => React.createElement(React.Fragment, { key: item.questId }, renderItem({ item }))),
  );
};
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: (...args: unknown[]) => { alertArguments = args; } },
  FlatList: flatList,
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
const { QuestAutomationEditor } = require(
  '../../main/features/automation/components/QuestAutomationEditor',
) as typeof import('../../main/features/automation/components/QuestAutomationEditor');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('QuestAutomationEditor mounted behavior', () => {
  it('shows loading, error/retry, and empty states', async () => {
    const pending = deferred<QuestSnapshot[]>();
    const loading = await renderEditor({ fetchQuests: () => pending.promise });
    assert.equal(hasText(loading.root, '퀘스트 불러오는 중'), true);
    await act(async () => { pending.resolve([]); await pending.promise; });
    assert.equal(hasText(loading.root, '진행 중인 퀘스트가 없습니다.'), true);

    let attempts = 0;
    const failed = await renderEditor({ fetchQuests: async () => { attempts += 1; if (attempts === 1) throw new Error('offline'); return []; } });
    assert.equal(hasText(failed.root, '퀘스트를 불러오지 못했어요.'), true);
    await act(async () => { await failed.root.findByProps({ accessibilityLabel: '퀘스트 다시 불러오기' }).props.onPress(); });
    assert.equal(attempts, 2);
  });

  it('renders three counted tabs and keeps selection across tab/search filters', async () => {
    const renderer = await renderEditor({ quests: [
      snapshot('active', 'Active Quest', 'ACTIVE', [mission('item', 'ITEM_TURN_IN', 'Horn')]),
      snapshot('available', 'Available Quest', 'AVAILABLE', [mission('now', 'IMMEDIATE', null)]),
      snapshot('waiting', 'Waiting Quest', 'WAITING', [mission('other', 'OTHER', 'Talk')]),
    ] });
    assert.equal(hasText(renderer.root, '진행 중 1'), true);
    assert.equal(hasText(renderer.root, '수락 가능 1'), true);
    assert.equal(hasText(renderer.root, '대기 중 1'), true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Active Quest 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '수락 가능 탭' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '퀘스트 검색' }).props.onChangeText('available'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '진행 중 탭' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '퀘스트 검색' }).props.onChangeText(''); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Active Quest 선택' }).props.accessibilityState.checked, true);
  });

  it('shows mission labels/progress but map and preset controls only for combat missions', async () => {
    const renderer = await renderEditor({ quests: [snapshot('mixed', 'Mixed', 'ACTIVE', [
      { ...mission('kill', 'MONSTER_KILL', 'Killer Maid'), progress: { current: 2, required: 5 } },
      mission('item', 'ITEM_TURN_IN', 'Horn'),
    ])] });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Mixed 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '몬스터 처치 · Killer Maid'), true);
    assert.equal(hasText(renderer.root, '2 / 5'), true);
    assert.equal(hasText(renderer.root, '아이템 반납 · Horn'), true);
    assert.ok(renderer.root.findAllByProps({ accessibilityLabel: 'Mixed · kill 맵 추가' }).length > 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Mixed · item 맵 추가' }).length, 0);
    assert.equal(hasText(renderer.root, '맵 설정이 필요 없는 미션입니다.'), true);
  });

  it('disables invalid/busy saves and submits the complete typed request once valid', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill-key', 'MONSTER_KILL', 'Maid')]);
    const map = catalogMap('battle_map', 'maid', 'Maid Field');
    const renderer = await renderEditor({ quests: [quest], maps: [map], onSave: async (request) => { saves.push(request); return true; } });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill-key 맵 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill-key 맵 검색' }).props.onChangeText('Maid'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill-key · Maid Field 맵 선택' }).props.onPress(); });
    const save = renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' });
    assert.equal(save.props.disabled, false);
    await act(async () => { await save.props.onPress(); });
    assert.deepEqual(saves, [{ enabled: true, quests: [{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [{ missionKey: 'kill-key', categoryId: 'battle_map', mapCode: 'maid', executionOrder: 0, manuallyOverridden: true, presetMode: 'PRIMARY', partyPresetId: null }] }] }]);

    const busy = await renderEditor({ saving: true, quests: [] });
    assert.equal(busy.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, true);
  });

  it('confirms dirty back and returns after typed deletion', async () => {
    let backs = 0;
    let deletes = 0;
    alertArguments = null;
    const renderer = await renderEditor({ quests: [snapshot('q', 'Quest', 'ACTIVE', [mission('now', 'IMMEDIATE', null)])], onBack: () => { backs += 1; }, onDelete: async () => { deletes += 1; return true; } });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Quest 선택' }).props.onPress(); });
    renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 뒤로' }).props.onPress();
    assert.equal(backs, 0);
    assert.ok(alertArguments);
    const discard = (alertArguments![2] as { text: string; onPress?: () => void }[]).find(({ text }) => text === '나가기');
    discard?.onPress?.();
    assert.equal(backs, 1);

    renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 삭제' }).props.onPress();
    const remove = (alertArguments![2] as { text: string; onPress?: () => void }[]).find(({ text }) => text === '삭제');
    await act(async () => { await remove?.onPress?.(); });
    assert.equal(deletes, 1);
    assert.equal(backs, 2);
  });

  it('guards map and preset controls with accessible state during a deferred save', async () => {
    const saving = deferred<boolean>();
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const entry = questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [
      mapSetting('kill', 'a', 0),
      mapSetting('kill', 'b', 1),
    ] }]);
    const renderer = await renderEditor({
      entry,
      quests: [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
      presets: [preset(7, 'Explicit')],
      onSave: async () => saving.promise,
    });

    let savePromise!: Promise<void>;
    await act(async () => {
      savePromise = renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress();
      await Promise.resolve();
    });
    const presetChoice = renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 Explicit 프리셋' });
    const remove = renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 제거' });
    const reorder = renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 2번째 맵 위로' });
    const add = renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 맵 추가' });
    assert.equal(presetChoice.props.accessibilityRole, 'radio');
    assert.deepEqual(presetChoice.props.accessibilityState, { checked: false, disabled: true });
    assert.equal(remove.props.accessibilityRole, 'button');
    assert.equal(remove.props.accessibilityState.disabled, true);
    assert.equal(reorder.props.accessibilityRole, 'button');
    assert.equal(reorder.props.accessibilityState.disabled, true);
    assert.equal(add.props.accessibilityState.disabled, true);

    await act(async () => {
      presetChoice.props.onPress();
      remove.props.onPress();
      reorder.props.onPress();
      add.props.onPress();
    });
    assert.equal(hasText(renderer.root, 'Alpha'), true);
    assert.equal(hasText(renderer.root, 'Beta'), true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 대표 프리셋' }).props.accessibilityState.checked, true);

    await act(async () => { saving.resolve(true); await savePromise; });
  });

  it('disables and guards map options while saving', async () => {
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const entry = questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [{
      ...mapSetting('kill', '', 0), categoryId: '', manuallyOverridden: true,
    }] }]);
    const renderer = await renderEditor({
      entry,
      quests: [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha')],
      saving: true,
    });
    const option = renderer.root.findByProps({ accessibilityLabel: 'Combat · kill · Alpha 맵 선택' });
    assert.equal(option.props.accessibilityRole, 'button');
    assert.deepEqual(option.props.accessibilityState, { disabled: true });
    assert.equal(option.props.disabled, true);
    await act(async () => { option.props.onPress(); });
    assert.equal(hasText(renderer.root, '맵을 선택해 주세요'), true);
  });

  it('preserves dirty quest edits when deferred categories and catalogs arrive', async () => {
    const quest = snapshot('noncombat', 'Noncombat', 'ACTIVE', [mission('now', 'IMMEDIATE', null)]);
    const base = editorProps({ quests: [quest], battleCategories: [], areBattleCategoriesLoaded: true });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(QuestAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Noncombat 선택' }).props.onPress(); });

    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, {
        ...base,
        battleCategories: [{ id: 'battle_map', label: '전투맵', description: '', order: 0, enabled: true }],
        onLoadBattleMaps: async () => [catalogMap('battle_map', 'a', 'Alpha')],
      }));
    });

    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Noncombat 선택' }).props.accessibilityState.checked, true);
  });

  it('hydrates a later eligible category match without losing an unrelated user edit', async () => {
    const quest = snapshot('clear', 'Clear Quest', 'ACTIVE', [mission('clear-key', 'MAP_CLEAR', 'Target')]);
    const automatic = { ...mapSetting('clear-key', 'stale', 0), manuallyOverridden: false };
    const entry = questEntry([{ questCode: 'clear', enabled: true, sourceOrder: 0, maps: [automatic] }]);
    const base = editorProps({ entry, quests: [quest], maps: [] });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(QuestAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 사용' }).props.onValueChange(false); });

    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, {
        ...base,
        battleCategories: [
          { id: 'battle_map', label: '전투맵', description: '', order: 0, enabled: true },
          { id: 'adventure_map', label: '모험맵', description: '', order: 1, enabled: true },
        ],
        onLoadBattleMaps: async (categoryId: string) => categoryId === 'adventure_map'
          ? [catalogMap('adventure_map', 'target', 'Target')]
          : [],
      }));
    });

    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 사용' }).props.value, false);
    assert.equal(hasText(renderer.root, 'Target'), true);
    assert.equal(hasText(renderer.root, '자동 매칭됨'), true);
    assert.equal(hasText(renderer.root, '맵을 선택해 주세요'), false);
  });

  it('defers the first automatic draft until every initially eligible map request settles', async () => {
    const battle = deferred<BattleMapResponse[]>();
    const adventure = deferred<BattleMapResponse[]>();
    const quest = snapshot('clear', 'Clear Quest', 'ACTIVE', [mission('clear-key', 'MAP_CLEAR', 'Target')]);
    const automatic = { ...mapSetting('clear-key', 'stale', 0), manuallyOverridden: false };
    const rendererPromise = renderEditor({
      entry: questEntry([{ questCode: 'clear', enabled: true, sourceOrder: 0, maps: [automatic] }]),
      quests: [quest],
      battleCategories: [
        { id: 'battle_map', label: '전투맵', description: '', order: 0, enabled: true },
        { id: 'adventure_map', label: '모험맵', description: '', order: 1, enabled: true },
      ],
      onLoadBattleMaps: async (categoryId) => categoryId === 'battle_map' ? battle.promise : adventure.promise,
    });
    const renderer = await rendererPromise;
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '퀘스트 자동화 사용' }).length, 0);
    await act(async () => { battle.resolve([]); await battle.promise; });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '퀘스트 자동화 사용' }).length, 0);
    await act(async () => {
      adventure.resolve([catalogMap('adventure_map', 'target', 'Target')]);
      await adventure.promise;
    });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 사용' }));
    assert.equal(hasText(renderer.root, '자동 매칭됨'), true);
  });

  it('disables live quest editing while the initial map catalog is unsettled and enables it afterward', async () => {
    const maps = deferred<BattleMapResponse[]>();
    const quest = snapshot('live', 'Live Quest', 'ACTIVE', [mission('now', 'IMMEDIATE', null)]);
    const renderer = await renderEditor({
      quests: [quest],
      onLoadBattleMaps: async () => maps.promise,
    });
    const unsettled = renderer.root.findByProps({ accessibilityLabel: 'Live Quest 선택' });
    assert.equal(unsettled.props.disabled, true);
    assert.deepEqual(unsettled.props.accessibilityState, { checked: false, disabled: true });
    assert.equal(hasText(renderer.root, '맵 설정 준비 중'), true);
    await act(async () => { unsettled.props.onPress(); });

    await act(async () => { maps.resolve([]); await maps.promise; });
    const settled = renderer.root.findByProps({ accessibilityLabel: 'Live Quest 선택' });
    assert.equal(settled.props.disabled, false);
    assert.deepEqual(settled.props.accessibilityState, { checked: false, disabled: false });
    await act(async () => { settled.props.onPress(); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Live Quest 선택' }).props.accessibilityState.checked, true);
  });

  it('hydrates an automatic map after a targeted map retry while preserving edits', async () => {
    let attempts = 0;
    const quest = snapshot('clear', 'Clear Quest', 'ACTIVE', [mission('clear-key', 'MAP_CLEAR', 'Target')]);
    const automatic = { ...mapSetting('clear-key', 'stale', 0), manuallyOverridden: false };
    const renderer = await renderEditor({
      entry: questEntry([{ questCode: 'clear', enabled: true, sourceOrder: 0, maps: [automatic] }]),
      quests: [quest],
      onLoadBattleMaps: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('map down');
        return [catalogMap('battle_map', 'target', 'Target')];
      },
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 사용' }).props.onValueChange(false); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투맵 맵 다시 불러오기' }).props.onPress(); });

    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 사용' }).props.value, false);
    assert.equal(hasText(renderer.root, 'Target'), true);
    assert.equal(hasText(renderer.root, '자동 매칭됨'), true);
    assert.equal(hasText(renderer.root, '맵을 선택해 주세요'), false);
  });

  it('preserves explicit removal of an automatic map across catalog reload and clears intent on manual replacement', async () => {
    let attempts = 0;
    const quest = snapshot('clear', 'Clear Quest', 'ACTIVE', [mission('clear-key', 'MAP_CLEAR', 'Target')]);
    const automatic = { ...mapSetting('clear-key', 'target', 0), manuallyOverridden: false };
    const enabled = [{ id: 'battle_map', label: '전투맵', description: '', order: 0, enabled: true }];
    const base = editorProps({
      entry: questEntry([{ questCode: 'clear', enabled: true, sourceOrder: 0, maps: [automatic] }]),
      quests: [quest],
      battleCategories: enabled,
      onLoadBattleMaps: async () => {
        attempts += 1;
        return [catalogMap('battle_map', 'target', 'Target')];
      },
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(QuestAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Clear Quest · clear-key 1번째 맵 제거' }).props.onPress(); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, true);

    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, {
        ...base,
        battleCategories: [{ ...enabled[0]!, enabled: false }],
      }));
    });
    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, { ...base, battleCategories: enabled }));
    });
    assert.equal(attempts, 2);
    assert.equal(hasText(renderer.root, '자동 매칭됨'), false);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, true);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Clear Quest · clear-key 맵 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Clear Quest · clear-key · Target 맵 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '사용자 변경'), true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, false);
  });

  it('prunes disabled category picker state, fences stale responses, and reloads on re-enable', async () => {
    const first = deferred<BattleMapResponse[]>();
    const second = deferred<BattleMapResponse[]>();
    let attempts = 0;
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const stored = mapSetting('kill', 'stored', 0);
    const entry = questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [stored] }]);
    const enabled = [{ id: 'battle_map', label: '전투맵', description: '', order: 0, enabled: true }];
    const base = editorProps({
      entry,
      quests: [quest],
      battleCategories: enabled,
      onLoadBattleMaps: async () => (++attempts === 1 ? first.promise : second.promise),
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(QuestAutomationEditor, base)); });
    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, {
        ...base,
        battleCategories: [{ ...enabled[0]!, enabled: false }],
      }));
      first.resolve([catalogMap('battle_map', 'stale', 'Stale Map')]);
      await first.promise;
    });
    assert.equal(hasText(renderer.root, 'stored'), true);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Combat · kill · Stale Map 맵 선택' }).length, 0);

    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, { ...base, battleCategories: enabled }));
      second.resolve([catalogMap('battle_map', 'fresh', 'Fresh Map')]);
      await second.promise;
    });
    assert.equal(attempts, 2);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 맵 추가' }).props.onPress(); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Combat · kill · Fresh Map 맵 선택' }));
  });

  it('treats a successful empty category response as settled without polling', async () => {
    let categoryLoads = 0;
    const renderer = await renderEditor({
      battleCategories: [],
      areBattleCategoriesLoaded: true,
      onLoadBattleCategories: () => { categoryLoads += 1; },
    });
    assert.equal(categoryLoads, 0);
    assert.equal(hasText(renderer.root, '맵 카테고리 불러오는 중'), false);
  });

  it('renders missing saved selections and allows removal', async () => {
    const entry = questEntry([{ questCode: 'missing', enabled: true, sourceOrder: 7, maps: [mapSetting('stored-key', 'a', 0)] }]);
    const renderer = await renderEditor({ entry, quests: [], maps: [catalogMap('battle_map', 'a', 'Alpha')] });

    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'missing 저장된 선택' }));
    assert.equal(hasText(renderer.root, '저장된 반복 퀘스트 · 현재 목록에 없음'), true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'missing 저장된 선택 제거' }).props.onPress(); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'missing 저장된 선택' }).length, 0);
  });

  it('repairs a deleted preset on a missing saved selection', async () => {
    const broken = { ...mapSetting('stored-key', 'a', 0), presetMode: 'EXPLICIT' as const, partyPresetId: 99 };
    const entry = questEntry([{ questCode: 'missing', enabled: true, sourceOrder: 0, maps: [broken] }]);
    const saves: UpdateQuestAutomationRequest[] = [];
    const renderer = await renderEditor({
      entry,
      quests: [],
      maps: [catalogMap('battle_map', 'a', 'Alpha')],
      presets: [preset(7, 'Existing')],
      onSave: async (request) => { saves.push(request); return true; },
    });
    assert.equal(hasText(renderer.root, '저장된 전투 설정 · stored-key'), true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'missing · stored-key 1번째 맵 대표 프리셋' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.equal(saves[0]?.quests[0]?.maps[0]?.presetMode, 'PRIMARY');
  });

  it('keeps quests visible across independent preset/map failures and targeted retries', async () => {
    let presetAttempts = 0;
    let mapAttempts = 0;
    const quest = snapshot('noncombat', 'Noncombat', 'ACTIVE', [mission('now', 'IMMEDIATE', null)]);
    const renderer = await renderEditor({
      quests: [quest],
      onListPartyPresets: async () => { presetAttempts += 1; if (presetAttempts === 1) throw new Error('preset down'); return []; },
      onLoadBattleMaps: async () => { mapAttempts += 1; if (mapAttempts === 1) throw new Error('map down'); return []; },
    });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Noncombat 선택' }));
    assert.equal(hasText(renderer.root, '프리셋을 불러오지 못했어요.'), true);
    assert.equal(hasText(renderer.root, '전투맵 맵을 불러오지 못했어요.'), true);
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '프리셋 다시 불러오기' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투맵 맵 다시 불러오기' }).props.onPress(); });
    assert.equal(presetAttempts, 2);
    assert.equal(mapAttempts, 2);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Noncombat 선택' }).props.onPress(); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, false);
  });

  it('allows an already-valid manual combat config when catalog refresh fails', async () => {
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const entry = questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [mapSetting('kill', 'stored', 0)] }]);
    const renderer = await renderEditor({
      entry,
      quests: [quest],
      onLoadBattleMaps: async () => { throw new Error('map down'); },
    });

    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, false);
  });

  it('renders mutation failures as an accessible alert and clears them on retry', async () => {
    let clears = 0;
    const quest = snapshot('noncombat', 'Noncombat', 'ACTIVE', [mission('now', 'IMMEDIATE', null)]);
    const renderer = await renderEditor({
      quests: [quest],
      mutationMessage: '저장하지 못했어요.',
      onClearMutationMessage: () => { clears += 1; },
      onSave: async () => false,
    });
    const alert = renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 작업 오류' });
    assert.equal(alert.props.accessibilityRole, 'alert');
    assert.equal(alert.props.accessibilityLiveRegion, 'assertive');
    assert.equal(hasText(renderer.root, '저장하지 못했어요.'), true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Noncombat 선택' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.equal(clears, 1);
  });

  it('keeps map search queries independent for equal mission keys in different quests', async () => {
    const quests = [
      snapshot('one', 'One', 'ACTIVE', [mission('shared', 'MONSTER_KILL', 'A')]),
      snapshot('two', 'Two', 'ACTIVE', [mission('shared', 'MONSTER_KILL', 'B')]),
    ];
    const entry = questEntry(quests.map((quest) => ({ questCode: quest.questId, enabled: true, sourceOrder: 0, maps: [{ ...mapSetting('shared', '', 0), categoryId: '' }] })));
    const renderer = await renderEditor({ entry, quests, maps: [catalogMap('battle_map', 'a', 'Alpha')] });
    const searches = renderer.root.findAll((node) => (
      (node.type as unknown) === 'TextInput' && typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.endsWith('· shared 맵 검색')
    ));
    assert.equal(searches.length, 2);
    await act(async () => { searches[0]!.props.onChangeText('Alpha'); });
    const refreshed = renderer.root.findAll((node) => (
      (node.type as unknown) === 'TextInput' && typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.endsWith('· shared 맵 검색')
    ));
    assert.equal(refreshed[0]!.props.value, 'Alpha');
    assert.equal(refreshed[1]!.props.value, '');
  });

  it('includes quest context in every combat map control accessibility label', async () => {
    const quests = [
      snapshot('one', 'One Quest', 'ACTIVE', [mission('shared', 'MONSTER_KILL', 'A')]),
      snapshot('two', 'Two Quest', 'ACTIVE', [mission('shared', 'MONSTER_KILL', 'B')]),
    ];
    const entry = questEntry([
      { questCode: 'one', enabled: true, sourceOrder: 0, maps: [mapSetting('shared', 'a', 0), mapSetting('shared', 'b', 1)] },
      { questCode: 'two', enabled: true, sourceOrder: 1, maps: [{ ...mapSetting('shared', '', 0), categoryId: '' }] },
      { questCode: 'missing-code', enabled: true, sourceOrder: 2, maps: [mapSetting('shared', 'a', 0)] },
    ]);
    const renderer = await renderEditor({
      entry,
      quests,
      maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
      presets: [preset(7, 'Explicit')],
    });

    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'One Quest · shared 1번째 맵 제거' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'One Quest · shared 2번째 맵 위로' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'One Quest · shared 1번째 맵 대표 프리셋' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'One Quest · shared 1번째 맵 Explicit 프리셋' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Two Quest · shared 맵 검색' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Two Quest · shared · Alpha 맵 선택' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'missing-code · shared 맵 추가' }));
  });
});

describe('HomeTabScreen mounted quest routing', () => {
  it('routes QUEST to typed saveQuestSettings while battle remains on the temporary editor', async () => {
    const settingsMock = (props: Record<string, unknown>) => React.createElement(
      'UnifiedAutomationSettings',
      props,
      (props.entries as TypedAutomationEntryResponse[]).map((entry) => React.createElement(
        'Pressable',
        { key: entry.id, accessibilityLabel: `${entry.type} 상세 열기`, onPress: () => (props.onDetail as (value: TypedAutomationEntryResponse) => void)(entry) },
      )),
    );
    const dashboardMock = (props: Record<string, unknown>) => React.createElement('Pressable', { accessibilityLabel: '설정 열기', onPress: props.onOpenSettings });
    const questEditorMock = (props: Record<string, unknown>) => React.createElement('QuestAutomationEditor', props);
    const legacyEditorMock = (props: Record<string, unknown>) => React.createElement('UnifiedAutomationModuleEditor', props);
    moduleWithLoader._load = (request, parent, isMain) => {
      if (request === 'react-native') return reactNativeMock;
      if (request === 'lucide-react-native') return iconsMock;
      if (request === 'react-native-draggable-flatlist') return { NestableScrollContainer: host('NestableScrollContainer') };
      if (request.endsWith('/UnifiedAutomationSettings')) return { UnifiedAutomationSettings: settingsMock };
      if (request.endsWith('/UnifiedAutomationDashboard')) return { UnifiedAutomationDashboard: dashboardMock };
      if (request.endsWith('/QuestAutomationEditor')) return { QuestAutomationEditor: questEditorMock };
      if (request.endsWith('/UnifiedAutomationModuleEditor')) return { UnifiedAutomationModuleEditor: legacyEditorMock };
      return originalLoad(request, parent, isMain);
    };
    const { HomeTabScreen } = require('../../main/screens/HomeTabScreen') as typeof import('../../main/screens/HomeTabScreen');
    moduleWithLoader._load = originalLoad;

    const quest = questEntry();
    const battle: TypedAutomationEntryResponse = { ...questEntry(), id: 2, type: 'BATTLE_MAP' };
    const snapshot = {
      aggregate: { entries: [quest, battle], runtime: { lifecycle: 'PAUSED', stopReason: null, nextAttemptAt: null, warnings: [], lastError: null } },
      automation: { profileId: 1, job: null, currentTitle: null, nextRunAt: null, modules: [legacyModule(1, 'OTHER_QUEST'), legacyModule(2, 'TIME_BURN')] },
      loading: false, actionSaving: false, editorSaving: false, savingEntryIds: [], savingModuleIds: [], savingTypes: [], reordering: false, error: 'mutation failed', message: 'mutation failed',
    };
    const saves: UpdateQuestAutomationRequest[] = [];
    const controller = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
      load: async () => undefined,
      reset: () => undefined,
      clearMessage: () => undefined,
      showMessage: () => undefined,
      isModuleBusy: () => false,
      fetchQuests: async () => [],
      saveQuestSettings: async (request: UpdateQuestAutomationRequest) => { saves.push(request); return true; },
      saveBattleMapSettings: async () => true,
      saveAdventureMapSettings: async () => true,
      deleteEntry: async () => true,
      createEntry: async () => true,
      reorderEntries: () => undefined,
      updateModule: async () => true,
      changeState: async () => undefined,
    };
    const props = {
      authenticated: true,
      automationController: controller as never,
      battleCategories: [],
      areBattleCategoriesLoaded: true,
      isBattleCategoriesLoading: false,
      battleCategoriesError: null,
      onLoadBattleCategories: () => undefined,
      onLoadBattleMaps: async () => [],
      onListPartyPresets: async () => [],
      onOpenCaptcha: () => undefined,
    };

    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(HomeTabScreen, props)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '설정 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'QUEST 상세 열기' }).props.onPress(); });
    const questEditor = renderer.root.find((node) => (node.type as unknown) === 'QuestAutomationEditor');
    assert.equal(questEditor.props.mutationMessage, 'mutation failed');
    const request: UpdateQuestAutomationRequest = { enabled: true, quests: [] };
    await act(async () => { await questEditor.props.onSave(request); });
    assert.deepEqual(saves, [request]);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'QuestAutomationEditor').length, 0);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'UnifiedAutomationSettings').length, 1);

    await act(async () => { renderer = create(React.createElement(HomeTabScreen, props)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '설정 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'BATTLE_MAP 상세 열기' }).props.onPress(); });
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'UnifiedAutomationModuleEditor').length, 1);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'QuestAutomationEditor').length, 0);
  });
});

type EditorOverrides = {
  quests?: QuestSnapshot[];
  maps?: BattleMapResponse[];
  saving?: boolean;
  fetchQuests?: () => Promise<QuestSnapshot[]>;
  onSave?: (request: UpdateQuestAutomationRequest) => Promise<boolean>;
  onBack?: () => void;
  onDelete?: () => Promise<boolean>;
  entry?: TypedAutomationEntryResponse;
  presets?: ReturnType<typeof preset>[];
  isBattleCategoriesLoading?: boolean;
  battleCategoriesError?: string | null;
  onListPartyPresets?: () => Promise<ReturnType<typeof preset>[]>;
  onLoadBattleMaps?: (categoryId: string) => Promise<BattleMapResponse[]>;
  mutationMessage?: string | null;
  onClearMutationMessage?: () => void;
  areBattleCategoriesLoaded?: boolean;
  onLoadBattleCategories?: () => void;
  battleCategories?: Array<{ id: string; label: string; description: string; order: number; enabled: boolean }>;
};

function editorProps(overrides: EditorOverrides = {}) {
  return {
    entry: overrides.entry ?? questEntry(),
    battleCategories: overrides.battleCategories ?? (overrides.isBattleCategoriesLoading
      ? []
      : [{ id: 'battle_map', label: '전투맵', description: '', order: 0, enabled: true }]),
    isBattleCategoriesLoading: overrides.isBattleCategoriesLoading ?? false,
    areBattleCategoriesLoaded: overrides.areBattleCategoriesLoaded ?? false,
    battleCategoriesError: overrides.battleCategoriesError ?? null,
    saving: overrides.saving ?? false,
    fetchQuests: overrides.fetchQuests ?? (async () => overrides.quests ?? []),
    onBack: overrides.onBack ?? (() => undefined),
    onDelete: overrides.onDelete ?? (async () => true),
    onLoadBattleCategories: overrides.onLoadBattleCategories ?? (() => undefined),
    onLoadBattleMaps: overrides.onLoadBattleMaps ?? (async () => overrides.maps ?? []),
    onListPartyPresets: overrides.onListPartyPresets ?? (async () => overrides.presets ?? []),
    onSave: overrides.onSave ?? (async () => true),
    mutationMessage: overrides.mutationMessage ?? null,
    onClearMutationMessage: overrides.onClearMutationMessage ?? (() => undefined),
  };
}

async function renderEditor(overrides: EditorOverrides = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(QuestAutomationEditor, editorProps(overrides)));
  });
  return renderer;
}

function hasText(root: ReactTestInstance, text: string): boolean {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length > 0;
}
function mission(key: string, type: QuestMission['type'], target: string | null): QuestMission { return { key, type, target, progress: null, completable: false }; }
function snapshot(questId: string, name: string, section: QuestSnapshot['section'], missions: QuestMission[]): QuestSnapshot { return { questId, name, section, state: section === 'ACTIVE' ? 'ACTIVE' : section === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE', sourceOrder: 0, missions, actionNo: null }; }
function questEntry(quests: TypedAutomationEntryResponse['quests'] = []): TypedAutomationEntryResponse { return { id: 1, type: 'QUEST', enabled: true, priority: 0, ready: true, warnings: [], quests, battleMaps: [], adventureMaps: [] }; }
function mapSetting(missionKey: string, mapCode: string, executionOrder: number) { return { missionKey, categoryId: 'battle_map', mapCode, executionOrder, manuallyOverridden: true, presetMode: 'PRIMARY' as const, partyPresetId: null }; }
function catalogMap(categoryId: string, mapCode: string, name: string): BattleMapResponse { return { categoryId, mapCode, name, groupName: null, groupOrder: 0, mapOrder: 0, recommendedLevel: null, availableCount: null, attemptCount: null, winCount: null, cooldownRemainingText: null, cooldownRemainingSeconds: null, keyCount: null, requiredTime: null, enabled: true, resolved: true, iconUrl: null, rawHref: '' }; }
function preset(id: number, name: string) { return { id, accountId: 1, name, members: [], createdAt: '', updatedAt: '' }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function legacyModule(id: number, moduleType: 'OTHER_QUEST' | 'TIME_BURN') { return { id, displayName: 'Module', moduleType, enabled: true, priority: id - 1, thresholdPercent: moduleType === 'TIME_BURN' ? 90 : null, maps: [], quests: [], ready: true, summary: '' }; }
