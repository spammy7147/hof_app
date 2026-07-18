import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type {
  BattleMapResponse,
  UpdateAdventureMapAutomationRequest,
  UpdateBattleMapAutomationRequest,
  QuestMapSettingRequest,
  QuestMission,
  QuestSnapshot,
  TypedAutomationEntryResponse,
  UpdateQuestAutomationRequest,
} from '../../main/types/api';

let alertArguments: unknown[] | null = null;
const accessibilityFocusCalls: unknown[] = [];
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  const nodeRef = React.useRef<Record<string, unknown>>({});
  Object.assign(nodeRef.current, props);
  React.useImperativeHandle(ref, () => nodeRef.current, []);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const flatList = (props: Record<string, unknown>) => {
  const data = props.data as unknown[];
  const renderItem = props.renderItem as ({ item }: { item: unknown }) => React.ReactNode;
  return React.createElement(
    'FlatList',
    props,
    props.ListHeaderComponent as React.ReactNode,
    data.length === 0 ? props.ListEmptyComponent as React.ReactNode : null,
    data.map((item, index) => React.createElement(React.Fragment, {
      key: typeof props.keyExtractor === 'function'
        ? (props.keyExtractor as (value: unknown, itemIndex: number) => string)(item, index)
        : index,
    }, renderItem({ item }))),
  );
};
const modal = (props: Record<string, unknown>) => React.createElement(
  'Modal',
  props,
  props.visible ? props.children as React.ReactNode : null,
);
const reactNativeMock = {
  AccessibilityInfo: { setAccessibilityFocus: (node: unknown) => { accessibilityFocusCalls.push(node); } },
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: (...args: unknown[]) => { alertArguments = args; } },
  Dimensions: { get: () => ({ height: 800, width: 390 }) },
  FlatList: flatList,
  findNodeHandle: (node: unknown) => node,
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Modal: modal,
  Platform: { OS: 'ios' },
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
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
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

  it('makes the quest summary the accessible checkbox without rendering a check glyph', async () => {
    const mixed = {
      ...snapshot('mixed', 'Mixed', 'ACTIVE', [
      { ...mission('kill', 'MONSTER_KILL', 'Killer Maid'), progress: { current: 2, required: 5 } },
      mission('item', 'ITEM_TURN_IN', 'Horn'),
      ]),
      rewards: ['Red Potion ×2', 'Blue Potion'],
    };
    const renderer = await renderEditor({ quests: [mixed] });
    const missionSummary = findText(renderer.root, '미션 · 몬스터 처치 · Killer Maid 2/5 · 아이템 반납 · Horn');
    const rewardSummary = findText(renderer.root, '보상 · Red Potion ×2 · Blue Potion');
    assert.match(renderedText(renderer.root), /Killer Maid 2\/5/);
    assert.match(renderedText(renderer.root), /Horn/);
    assert.match(renderedText(renderer.root), /Red Potion ×2/);
    assert.match(renderedText(renderer.root), /Blue Potion/);
    assert.doesNotMatch(renderedText(renderer.root), /외 \d+개/);
    assert.equal(missionSummary.props.numberOfLines, undefined);
    assert.equal(rewardSummary.props.numberOfLines, undefined);
    assert.equal(findText(renderer.root, 'Mixed').props.numberOfLines, 1);
    assert.equal(hasText(renderer.root, '원본 순서 1'), false);
    assert.equal(hasText(renderer.root, '맵 설정이 필요 없는 미션입니다.'), false);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Mixed · kill 전투맵 추가' }).length, 0);
    const summary = renderer.root.findByProps({ testID: 'quest-summary:Mixed' });
    assert.equal(summary.props.accessibilityLabel, 'Mixed 선택');
    assert.equal(summary.props.accessibilityRole, 'checkbox');
    assert.deepEqual(summary.props.accessibilityState, { checked: false, disabled: false });
    assert.doesNotMatch(renderedText(renderer.root), /✓/);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Mixed 선택' }).props.onPress(); });
    assert.deepEqual(renderer.root.findByProps({ testID: 'quest-summary:Mixed' }).props.accessibilityState, { checked: true, disabled: false });
    assert.doesNotMatch(renderedText(renderer.root), /✓/);
    assert.equal(hasText(renderer.root, '몬스터 처치 · Killer Maid'), true);
    assert.equal(hasText(renderer.root, '2 / 5'), true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Mixed · kill 전투맵 추가' }));
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Mixed · item 전투맵 추가' }).length, 0);
    assert.equal(hasText(renderer.root, '맵 설정이 필요 없는 미션입니다.'), false);
    assert.equal(renderer.root.findByProps({ testID: 'quest-summary:Mixed' }).findAllByProps({ accessibilityLabel: 'Mixed · kill 전투맵 추가' }).length, 0);

    const busy = await renderEditor({ quests: [mixed], saving: true });
    assert.deepEqual(busy.root.findByProps({ testID: 'quest-summary:Mixed' }).props.accessibilityState, { checked: false, disabled: true });
  });

  it('prioritizes selected quests after source-order filtering without changing their selection order', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    const renderer = await renderEditor({ quests: [
      snapshot('first', 'First', 'ACTIVE', [mission('first-now', 'IMMEDIATE', null)], 0),
      snapshot('second', 'Second', 'ACTIVE', [mission('second-now', 'IMMEDIATE', null)], 1),
      snapshot('third', 'Third', 'ACTIVE', [mission('third-now', 'IMMEDIATE', null)], 2),
    ], onSave: async (request) => { saves.push(request); return true; } });

    assert.deepEqual(summaryOrder(renderer.root), ['quest-summary:First', 'quest-summary:Second', 'quest-summary:Third']);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Second 선택' }).props.onPress(); });
    assert.deepEqual(summaryOrder(renderer.root), ['quest-summary:Second', 'quest-summary:First', 'quest-summary:Third']);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Third 선택' }).props.onPress(); });
    assert.deepEqual(summaryOrder(renderer.root), ['quest-summary:Second', 'quest-summary:Third', 'quest-summary:First']);
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.deepEqual(saves[0]?.quests.map(({ questCode, sourceOrder }) => ({ questCode, sourceOrder })), [
      { questCode: 'second', sourceOrder: 0 },
      { questCode: 'third', sourceOrder: 1 },
    ]);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Second 선택' }).props.onPress(); });
    assert.deepEqual(summaryOrder(renderer.root), ['quest-summary:Third', 'quest-summary:First', 'quest-summary:Second']);
    await act(async () => { renderer.unmount(); });
  });

  it('does not expand a selected noncombat quest', async () => {
    const renderer = await renderEditor({ quests: [snapshot('now', 'Immediate', 'ACTIVE', [mission('now', 'IMMEDIATE', null)])] });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Immediate 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '즉시 완료'), false);
    assert.equal(hasText(renderer.root, '맵 설정이 필요 없는 미션입니다.'), false);
    assert.equal(renderer.root.findAll((node) => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.includes('전투맵')).length, 0);
  });

  it('disables invalid/busy saves and submits the complete typed request once valid', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill-key', 'MONSTER_KILL', 'Maid')]);
    const map = catalogMap('battle_map', 'maid', 'Maid Field');
    const renderer = await renderEditor({ quests: [quest], maps: [map], onSave: async (request) => { saves.push(request); return true; } });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill-key 전투맵 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투맵 검색' }).props.onChangeText('Maid'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Maid Field 추가' }).props.onPress(); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '전투맵 검색' }).length, 0);
    assert.equal(hasText(renderer.root, 'Maid Field'), true);
    const save = renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' });
    assert.equal(save.props.disabled, false);
    await act(async () => { await save.props.onPress(); });
    assert.deepEqual(saves, [{ enabled: true, quests: [{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [{ missionKey: 'kill-key', categoryId: 'battle_map', mapCode: 'maid', executionOrder: 0, manuallyOverridden: true, presetMode: 'PRIMARY', partyPresetId: null }] }] }]);

    const busy = await renderEditor({ saving: true, quests: [] });
    assert.equal(busy.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, true);
  });

  it('restores deselected combat maps on direct reselection and saves their exact configuration', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const alpha = mapSetting('kill', 'a', 0);
    const beta = { ...mapSetting('kill', 'b', 1), presetMode: 'EXPLICIT' as const, partyPresetId: 7 };
    const renderer = await renderEditor({
      entry: questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [alpha, beta] }]),
      quests: [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
      presets: [preset(7, 'Explicit')],
      onSave: async (request) => { saves.push(request); return true; },
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Combat · kill 전투맵 추가' }).length, 0);
    assert.equal(hasText(renderer.root, '선택 해제됨'), true);
    assert.ok(renderer.root.findByProps({ accessibilityLiveRegion: 'polite' }));
    const undo = renderer.root.findByProps({ accessibilityLabel: '선택 해제 되돌리기' });
    assert.equal(undo.props.accessibilityRole, 'button');
    assert.equal(undo.props.style.some((style: { minHeight?: number } | false) => style && style.minHeight === 44), true);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, 'Alpha'), true);
    assert.equal(hasText(renderer.root, 'Beta'), true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 2번째 맵 Explicit 프리셋' }).props.accessibilityState.checked, true);
    assert.equal(hasText(renderer.root, '선택 해제됨'), false);

    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.deepEqual(saves, [{
      enabled: true,
      quests: [{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [alpha, beta] }],
    }]);
  });

  it('undoes the latest deselection with the cached combat maps', async () => {
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const renderer = await renderEditor({
      entry: questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [
        mapSetting('kill', 'a', 0), mapSetting('kill', 'b', 1),
      ] }]),
      quests: [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '선택 해제 되돌리기' }).props.onPress(); });

    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.accessibilityState.checked, true);
    assert.equal(hasText(renderer.root, 'Alpha'), true);
    assert.equal(hasText(renderer.root, 'Beta'), true);
    assert.equal(hasText(renderer.root, '선택 해제됨'), false);
  });

  it('reinstates a middle quest at its stable selection rank for direct reselect and undo', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    let backs = 0;
    alertArguments = null;
    const quests = [
      snapshot('a', 'A', 'ACTIVE', [mission('now-a', 'IMMEDIATE', null)]),
      snapshot('b', 'B', 'ACTIVE', [mission('now-b', 'IMMEDIATE', null)]),
      snapshot('c', 'C', 'ACTIVE', [mission('now-c', 'IMMEDIATE', null)]),
    ];
    const renderer = await renderEditor({
      entry: questEntry([
        { questCode: 'a', enabled: true, sourceOrder: 0, maps: [] },
        { questCode: 'b', enabled: true, sourceOrder: 1, maps: [] },
        { questCode: 'c', enabled: true, sourceOrder: 2, maps: [] },
      ]),
      quests,
      onBack: () => { backs += 1; },
      onSave: async (request) => { saves.push(request); return true; },
    });
    const expected = {
      enabled: true,
      quests: [
        { questCode: 'a', enabled: true, sourceOrder: 0, maps: [] },
        { questCode: 'b', enabled: true, sourceOrder: 1, maps: [] },
        { questCode: 'c', enabled: true, sourceOrder: 2, maps: [] },
      ],
    };

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'B 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'B 선택' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.deepEqual(saves[0], expected);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'B 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '선택 해제 되돌리기' }).props.onPress(); });
    renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 뒤로' }).props.onPress();
    assert.equal(backs, 1);
    assert.equal(alertArguments, null);
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.deepEqual(saves[1], expected);
  });

  it('uses stable selection order when multiple cached quests restore non-LIFO', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    let backs = 0;
    alertArguments = null;
    const quests = [
      snapshot('a', 'A', 'ACTIVE', [mission('now-a', 'IMMEDIATE', null)]),
      snapshot('b', 'B', 'ACTIVE', [mission('now-b', 'IMMEDIATE', null)]),
      snapshot('c', 'C', 'ACTIVE', [mission('now-c', 'IMMEDIATE', null)]),
    ];
    const renderer = await renderEditor({
      entry: questEntry([
        { questCode: 'a', enabled: true, sourceOrder: 0, maps: [] },
        { questCode: 'b', enabled: true, sourceOrder: 1, maps: [] },
        { questCode: 'c', enabled: true, sourceOrder: 2, maps: [] },
      ]),
      quests,
      onBack: () => { backs += 1; },
      onSave: async (request) => { saves.push(request); return true; },
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'B 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'A 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'B 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '선택 해제 되돌리기' }).props.onPress(); });

    renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 뒤로' }).props.onPress();
    assert.equal(backs, 1);
    assert.equal(alertArguments, null);
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.deepEqual(saves[0]?.quests.map(({ questCode }) => questCode), ['a', 'b', 'c']);
  });

  it('discards deselection cache after a successful save', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const renderer = await renderEditor({
      entry: questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [
        mapSetting('kill', 'a', 0), mapSetting('kill', 'b', 1),
      ] }]),
      quests: [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
      onSave: async (request) => { saves.push(request); return true; },
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.deepEqual(saves, [{ enabled: true, quests: [] }]);
    assert.equal(hasText(renderer.root, '선택 해제됨'), false);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '맵 설정 필요'), true);
    assert.equal(hasText(renderer.root, 'Alpha'), false);
    assert.equal(hasText(renderer.root, 'Beta'), false);
  });

  it('retains deselection cache and undo after a failed save', async () => {
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const renderer = await renderEditor({
      entry: questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [
        mapSetting('kill', 'a', 0), mapSetting('kill', 'b', 1),
      ] }]),
      quests: [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
      onSave: async () => false,
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '선택 해제됨'), true);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, 'Alpha'), true);
    assert.equal(hasText(renderer.root, 'Beta'), true);
  });

  it('offers undo only for the latest deselection while retaining earlier quest caches', async () => {
    const quests = [
      snapshot('one', 'One', 'ACTIVE', [mission('kill-one', 'MONSTER_KILL', 'A')]),
      snapshot('two', 'Two', 'ACTIVE', [mission('kill-two', 'MONSTER_KILL', 'B')]),
    ];
    const renderer = await renderEditor({
      entry: questEntry([
        { questCode: 'one', enabled: true, sourceOrder: 0, maps: [mapSetting('kill-one', 'a', 0)] },
        { questCode: 'two', enabled: true, sourceOrder: 1, maps: [mapSetting('kill-two', 'b', 0)] },
      ]),
      quests,
      maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'One 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Two 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '선택 해제 되돌리기' }).props.onPress(); });

    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'One 선택' }).props.accessibilityState.checked, false);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Two 선택' }).props.accessibilityState.checked, true);
    assert.equal(hasText(renderer.root, 'Beta'), true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'One 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, 'Alpha'), true);
  });

  it('merges cached maps into the latest matching mission snapshot only', async () => {
    const initial = snapshot('combat', 'Old Combat', 'ACTIVE', [
      mission('same', 'MONSTER_KILL', 'Maid'),
      mission('gone', 'MONSTER_KILL', 'Gone'),
    ]);
    const current = snapshot('combat', 'Current Combat', 'ACTIVE', [
      mission('same', 'MONSTER_KILL', 'Maid'),
      mission('new-item', 'ITEM_TURN_IN', 'Horn'),
    ]);
    const saves: UpdateQuestAutomationRequest[] = [];
    const base = editorProps({
      entry: questEntry([{ questCode: 'combat', enabled: false, sourceOrder: 0, maps: [
        mapSetting('same', 'a', 0), mapSetting('gone', 'b', 0),
      ] }]),
      fetchQuests: async () => [initial],
      maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
      onSave: async (request) => { saves.push(request); return true; },
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(QuestAutomationEditor, base)); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Old Combat 선택' }).props.onPress(); });
    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, { ...base, fetchQuests: async () => [current] }));
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Current Combat 선택' }).props.onPress(); });

    assert.equal(hasText(renderer.root, 'Alpha'), true);
    assert.equal(hasText(renderer.root, 'Beta'), false);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Current Combat · gone 전투맵 추가' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Current Combat · new-item 전투맵 추가' }).length, 0);
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.deepEqual(saves[0], {
      enabled: true,
      quests: [{ questCode: 'combat', enabled: false, sourceOrder: 0, maps: [mapSetting('same', 'a', 0)] }],
    });
  });

  it('clears deselection cache when a clean draft is automatically replaced by server settings', async () => {
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const base = editorProps({
      entry: questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [mapSetting('kill', 'a', 0)] }]),
      fetchQuests: async () => [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha')],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(QuestAutomationEditor, base)); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, 'Alpha'), true);

    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, { ...base, entry: questEntry() }));
    });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.accessibilityState.checked, false);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '서버 설정으로 다시 불러오기' }).length, 0);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '맵 설정 필요'), true);
    assert.equal(hasText(renderer.root, 'Alpha'), false);
  });

  it('clears deselection cache when server settings are reloaded', async () => {
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const base = editorProps({
      entry: questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [mapSetting('kill', 'a', 0)] }]),
      fetchQuests: async () => [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha')],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(QuestAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });

    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, { ...base, entry: questEntry() }));
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '서버 설정으로 다시 불러오기' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '선택 해제됨'), false);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '맵 설정 필요'), true);
    assert.equal(hasText(renderer.root, 'Alpha'), false);
  });

  it('ignores a canceled same-quest timer callback while a newer undo timer owns the snackbar', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const callbacks = new Map<number, () => void>();
    const clearedHandles = new Set<number>();
    let nextHandle = 100;
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 4000) {
        const handle = nextHandle++;
        callbacks.set(handle, () => { if (typeof handler === 'function') handler(...args); });
        return handle as unknown as ReturnType<typeof setTimeout>;
      }
      return originalSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      const handle = timer as unknown as number;
      if (callbacks.has(handle)) {
        clearedHandles.add(handle);
        return;
      }
      originalClearTimeout(timer);
    }) as typeof clearTimeout;

    try {
      const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
      const renderer = await renderEditor({
        entry: questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [mapSetting('kill', 'a', 0)] }]),
        quests: [quest],
        maps: [catalogMap('battle_map', 'a', 'Alpha')],
      });

      await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
      const oldHandle = 100;
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
      assert.equal(clearedHandles.has(oldHandle), true);
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
      const newHandle = 101;

      await act(async () => { callbacks.get(oldHandle)?.(); });
      assert.equal(hasText(renderer.root, '선택 해제됨'), true);
      assert.equal(clearedHandles.has(newHandle), false);
      await act(async () => { callbacks.get(newHandle)?.(); });
      assert.equal(hasText(renderer.root, '선택 해제됨'), false);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it('expires only the snackbar cache view and clears its timer on unmount', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let undoCallback: (() => void) | null = null;
    let undoTimerCleared = false;
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 4000) {
        undoCallback = () => { if (typeof handler === 'function') handler(...args); };
        return 4000 as unknown as ReturnType<typeof setTimeout>;
      }
      return originalSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      if (timer === (4000 as unknown as ReturnType<typeof setTimeout>)) {
        undoTimerCleared = true;
        return;
      }
      originalClearTimeout(timer);
    }) as typeof clearTimeout;

    try {
      const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
      const renderer = await renderEditor({
        entry: questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [mapSetting('kill', 'a', 0)] }]),
        quests: [quest],
        maps: [catalogMap('battle_map', 'a', 'Alpha')],
      });
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
      assert.ok(undoCallback);
      await act(async () => { undoCallback?.(); });
      assert.equal(hasText(renderer.root, '선택 해제됨'), false);
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
      assert.equal(hasText(renderer.root, 'Alpha'), true);

      await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
      await act(async () => { renderer.unmount(); });
      assert.equal(undoTimerCleared, true);
      const lateWarnings: unknown[][] = [];
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => { lateWarnings.push(args); };
      try {
        await act(async () => { undoCallback?.(); });
      } finally {
        console.error = originalConsoleError;
      }
      assert.deepEqual(lateWarnings, []);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
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
    assert.equal(hasText(renderer.root, '여러 맵을 실행 가능한 순서대로 확인하고 전투 횟수를 고르게 분배해요'), true);

    let savePromise!: Promise<void>;
    await act(async () => {
      savePromise = renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress();
      await Promise.resolve();
    });
    const presetChoice = renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 Explicit 프리셋' });
    const remove = renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 제거' });
    const reorder = renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 2번째 맵 위로' });
    const add = renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 전투맵 추가' });
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

  it('reorders selected monster maps and saves normalized execution order', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const entry = questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [
      mapSetting('kill', 'a', 0),
      mapSetting('kill', 'b', 1),
    ] }]);
    const renderer = await renderEditor({
      entry,
      quests: [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
      onSave: async (request) => { saves.push(request); return true; },
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 2번째 맵 위로' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.deepEqual(saves[0]?.quests[0]?.maps.map(({ mapCode, executionOrder }) => ({ mapCode, executionOrder })), [
      { mapCode: 'b', executionOrder: 0 },
      { mapCode: 'a', executionOrder: 1 },
    ]);
  });

  it('removes a selected monster map and normalizes the remaining order', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const entry = questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [
      mapSetting('kill', 'a', 0),
      mapSetting('kill', 'b', 1),
    ] }]);
    const renderer = await renderEditor({
      entry,
      quests: [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
      onSave: async (request) => { saves.push(request); return true; },
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 제거' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.deepEqual(saves[0]?.quests[0]?.maps.map(({ mapCode, executionOrder }) => ({ mapCode, executionOrder })), [
      { mapCode: 'b', executionOrder: 0 },
    ]);
  });

  it('saves explicit and primary preset changes from enabled radio controls', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const entry = questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [mapSetting('kill', 'a', 0)] }]);
    const renderer = await renderEditor({
      entry,
      quests: [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha')],
      presets: [preset(7, 'Explicit')],
      onSave: async (request) => { saves.push(request); return true; },
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 Explicit 프리셋' }).props.onPress(); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 Explicit 프리셋' }).props.accessibilityState.checked, true);
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.deepEqual(saves[0]?.quests[0]?.maps[0], {
      ...mapSetting('kill', 'a', 0),
      presetMode: 'EXPLICIT',
      partyPresetId: 7,
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 대표 프리셋' }).props.onPress(); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 대표 프리셋' }).props.accessibilityState.checked, true);
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.equal(saves[1]?.quests[0]?.maps[0]?.presetMode, 'PRIMARY');
    assert.equal(saves[1]?.quests[0]?.maps[0]?.partyPresetId, null);
  });

  it('groups preset radios and does not check an explicit preset for malformed PRIMARY data', async () => {
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const malformed = { ...mapSetting('kill', 'a', 0), partyPresetId: 7 } as unknown as QuestMapSettingRequest;
    const renderer = await renderEditor({
      entry: questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [malformed] }]),
      quests: [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha')],
      presets: [preset(7, 'Explicit')],
    });

    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 프리셋 선택' }).props.accessibilityRole, 'radiogroup');
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 Explicit 프리셋' }).props.accessibilityState.checked, false);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 대표 프리셋' }).props.accessibilityState.checked, true);
  });

  it('restores focus to the monster picker trigger after ordinary close and map selection', async () => {
    accessibilityFocusCalls.length = 0;
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const entry = questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [mapSetting('kill', 'a', 0)] }]);
    const renderer = await renderEditor({
      entry,
      quests: [quest],
      maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 전투맵 추가' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투맵 선택 닫기' }).props.onPress(); });
    await act(async () => { await delay(280); });
    assert.equal(focusedLabel(accessibilityFocusCalls.at(-1)), 'Combat · kill 전투맵 추가');

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 전투맵 추가' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 추가' }).props.onPress(); });
    await act(async () => { await delay(280); });
    assert.equal(focusedLabel(accessibilityFocusCalls.at(-1)), 'Combat · kill 전투맵 추가');
  });

  it('does not restore stale picker focus after busy closure, reopen, or unmount', async () => {
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const entry = questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [mapSetting('kill', 'a', 0)] }]);
    const base = editorProps({ entry, quests: [quest], maps: [catalogMap('battle_map', 'a', 'Alpha')] });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(QuestAutomationEditor, base)); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 전투맵 추가' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { renderer.update(React.createElement(QuestAutomationEditor, { ...base, saving: true })); });
    await act(async () => { await delay(280); });
    assert.equal(accessibilityFocusCalls.some((node) => focusedLabel(node) === 'Combat · kill 전투맵 추가'), false);

    await act(async () => { renderer.update(React.createElement(QuestAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 전투맵 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투맵 선택 닫기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 전투맵 추가' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { await delay(280); });
    assert.equal(accessibilityFocusCalls.some((node) => focusedLabel(node) === 'Combat · kill 전투맵 추가'), false);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투맵 선택 닫기' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { renderer.unmount(); });
    await act(async () => { await delay(280); });
    assert.equal(accessibilityFocusCalls.length, 0);
  });

  it('closes an open monster picker when the editor becomes busy', async () => {
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
    const entry = questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [mapSetting('kill', 'a', 0)] }]);
    const base = editorProps({ entry, quests: [quest], maps: [catalogMap('battle_map', 'a', 'Alpha')] });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(QuestAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 전투맵 추가' }).props.onPress(); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투맵 검색' }));

    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, { ...base, saving: true }));
    });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '전투맵 검색' }).length, 0);
  });

  it('disables and guards the picker trigger while saving', async () => {
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
    const trigger = renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 전투맵 추가' });
    assert.equal(trigger.props.accessibilityRole, 'button');
    assert.deepEqual(trigger.props.accessibilityState, { disabled: true });
    assert.equal(trigger.props.disabled, true);
    await act(async () => { trigger.props.onPress(); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '전투맵 검색' }).length, 0);
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

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Clear Quest · clear-key 전투맵 변경' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Target 변경' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '사용자 변경'), true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, false);
  });

  it('replaces an auto-matched MAP_CLEAR row and records a manual override', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    const quest = snapshot('clear', 'Clear Quest', 'ACTIVE', [mission('clear-key', 'MAP_CLEAR', 'Target')]);
    const automatic = { ...mapSetting('clear-key', 'target', 0), manuallyOverridden: false };
    const renderer = await renderEditor({
      entry: questEntry([{ questCode: 'clear', enabled: true, sourceOrder: 0, maps: [automatic] }]),
      quests: [quest],
      maps: [catalogMap('battle_map', 'target', 'Target'), catalogMap('battle_map', 'other', 'Other Field')],
      onSave: async (request) => { saves.push(request); return true; },
    });

    assert.equal(hasText(renderer.root, '자동 매칭됨'), true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Clear Quest · clear-key 전투맵 변경' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '전투맵 변경'), true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Other Field 변경' }).props.onPress(); });
    assert.equal(hasText(renderer.root, 'Target'), false);
    assert.equal(hasText(renderer.root, 'Other Field'), true);
    assert.equal(hasText(renderer.root, '사용자 변경'), true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Clear Quest · clear-key 1번째 맵 제거' }));
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });
    assert.equal(saves[0]?.quests[0]?.maps[0]?.manuallyOverridden, true);
    assert.equal(saves[0]?.quests[0]?.maps[0]?.mapCode, 'other');
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
    assert.equal(hasText(renderer.root, 'Stale Map'), false);

    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, { ...base, battleCategories: enabled }));
      second.resolve([catalogMap('battle_map', 'fresh', 'Fresh Map')]);
      await second.promise;
    });
    assert.equal(attempts, 2);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 전투맵 추가' }).props.onPress(); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Fresh Map 추가' }));
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

  it('forgets a removed missing quest rank before fresh reappearance and unrelated cache restore', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    const missing = snapshot('m', 'M', 'ACTIVE', [mission('now-m', 'IMMEDIATE', null)]);
    const alpha = snapshot('a', 'A', 'ACTIVE', [mission('now-a', 'IMMEDIATE', null)]);
    const beta = snapshot('b', 'B', 'ACTIVE', [mission('now-b', 'IMMEDIATE', null)]);
    const base = editorProps({
      entry: questEntry([
        { questCode: 'm', enabled: true, sourceOrder: 0, maps: [] },
        { questCode: 'a', enabled: true, sourceOrder: 1, maps: [] },
        { questCode: 'b', enabled: true, sourceOrder: 2, maps: [] },
      ]),
      fetchQuests: async () => [alpha, beta],
      onSave: async (request) => { saves.push(request); return true; },
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(QuestAutomationEditor, base)); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'm 저장된 선택 제거' }).props.onPress(); });
    await act(async () => {
      renderer.update(React.createElement(QuestAutomationEditor, {
        ...base,
        fetchQuests: async () => [alpha, beta, missing],
      }));
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'M 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'A 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'A 선택' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress(); });

    assert.deepEqual(saves[0]?.quests.map(({ questCode }) => questCode), ['a', 'b', 'm']);
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

  it('marks an already selected map as added and prevents duplicate insertion', async () => {
    const quest = snapshot('one', 'One', 'ACTIVE', [mission('shared', 'MONSTER_KILL', 'A')]);
    const entry = questEntry([{ questCode: 'one', enabled: true, sourceOrder: 0, maps: [mapSetting('shared', 'a', 0)] }]);
    const renderer = await renderEditor({ entry, quests: [quest], maps: [catalogMap('battle_map', 'a', 'Alpha')] });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'One · shared 전투맵 추가' }).props.onPress(); });
    const selected = renderer.root.findByProps({ accessibilityLabel: 'Alpha 추가됨' });
    assert.equal(selected.props.disabled, true);
    assert.equal(selected.props.accessibilityState.selected, true);
    assert.equal(hasText(selected, '추가됨'), true);
    await act(async () => { selected.props.onPress(); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'One · shared 1번째 맵 제거' }));
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
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Two Quest · shared 전투맵 추가' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'missing-code · shared 전투맵 추가' }));
  });
});

describe('HomeTabScreen mounted typed editor routing', () => {
  it('routes QUEST, BATTLE_MAP, and ADVENTURE_MAP to their typed saves', async () => {
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
    const battleEditorMock = (props: Record<string, unknown>) => React.createElement('BattleMapAutomationEditor', props);
    const adventureEditorMock = (props: Record<string, unknown>) => React.createElement('AdventureMapAutomationEditor', props);
    moduleWithLoader._load = (request, parent, isMain) => {
      if (request === 'react-native') return reactNativeMock;
      if (request === 'lucide-react-native') return iconsMock;
      if (request === 'react-native-draggable-flatlist') return { NestableScrollContainer: host('NestableScrollContainer') };
      if (request.endsWith('/UnifiedAutomationSettings')) return { UnifiedAutomationSettings: settingsMock };
      if (request.endsWith('/UnifiedAutomationDashboard')) return { UnifiedAutomationDashboard: dashboardMock };
      if (request.endsWith('/QuestAutomationEditor')) return { QuestAutomationEditor: questEditorMock };
      if (request.endsWith('/BattleMapAutomationEditor')) return { BattleMapAutomationEditor: battleEditorMock };
      if (request.endsWith('/AdventureMapAutomationEditor')) return { AdventureMapAutomationEditor: adventureEditorMock };
      return originalLoad(request, parent, isMain);
    };
    const { HomeTabScreen } = require('../../main/screens/HomeTabScreen') as typeof import('../../main/screens/HomeTabScreen');
    moduleWithLoader._load = originalLoad;

    const quest = questEntry();
    const battle: TypedAutomationEntryResponse = { ...questEntry(), id: 2, type: 'BATTLE_MAP' };
    const adventure: TypedAutomationEntryResponse = { ...questEntry(), id: 3, type: 'ADVENTURE_MAP' };
    const snapshot = {
      aggregate: {
        entries: [quest, battle, adventure],
        runtime: {
          lifecycle: 'PAUSED',
          stopReason: null,
          nextAttemptAt: null,
          warnings: [],
          lastError: null,
          currentAction: null,
          dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null },
        },
      },
      loading: false, actionSaving: false, savingEntryIds: [], savingTypes: [], reordering: false, error: 'mutation failed', message: 'mutation failed',
    };
    const saves: UpdateQuestAutomationRequest[] = [];
    const battleSaves: UpdateBattleMapAutomationRequest[] = [];
    const adventureSaves: UpdateAdventureMapAutomationRequest[] = [];
    let battleSaveResult = true;
    const controller = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
      load: async () => undefined,
      reset: () => undefined,
      clearMessage: () => undefined,
      showMessage: () => undefined,
      isEntryBusy: () => false,
      fetchQuests: async () => [],
      saveQuestSettings: async (request: UpdateQuestAutomationRequest) => { saves.push(request); return true; },
      saveBattleMapSettings: async (battleRequest: UpdateBattleMapAutomationRequest) => { battleSaves.push(battleRequest); return battleSaveResult; },
      saveAdventureMapSettings: async (adventureRequest: UpdateAdventureMapAutomationRequest) => {
        adventureSaves.push(adventureRequest);
        return true;
      },
      deleteEntry: async () => true,
      createEntry: async () => true,
      reorderEntries: () => undefined,
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
    const battleEditor = renderer.root.find((node) => (node.type as unknown) === 'BattleMapAutomationEditor');
    const battleRequest: UpdateBattleMapAutomationRequest = { enabled: true, maps: [] };
    await act(async () => { await battleEditor.props.onSave(battleRequest); });
    assert.deepEqual(battleSaves, [battleRequest]);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'BattleMapAutomationEditor').length, 0);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'UnifiedAutomationSettings').length, 1);

    battleSaveResult = false;
    await act(async () => { renderer = create(React.createElement(HomeTabScreen, props)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '설정 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'BATTLE_MAP 상세 열기' }).props.onPress(); });
    const failedBattleEditor = renderer.root.find((node) => (node.type as unknown) === 'BattleMapAutomationEditor');
    await act(async () => { await failedBattleEditor.props.onSave(battleRequest); });
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'BattleMapAutomationEditor').length, 1);
    assert.equal(failedBattleEditor.props.mutationMessage, 'mutation failed');
    battleSaveResult = true;

    await act(async () => { renderer = create(React.createElement(HomeTabScreen, props)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '설정 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'ADVENTURE_MAP 상세 열기' }).props.onPress(); });
    const adventureEditor = renderer.root.find((node) => (node.type as unknown) === 'AdventureMapAutomationEditor');
    const adventureRequest: UpdateAdventureMapAutomationRequest = { enabled: true, maps: [] };
    await act(async () => { await adventureEditor.props.onSave(adventureRequest); });
    assert.deepEqual(adventureSaves, [adventureRequest]);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'AdventureMapAutomationEditor').length, 0);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'UnifiedAutomationSettings').length, 1);
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
function findText(root: ReactTestInstance, text: string): ReactTestInstance {
  return root.find((node) => (node.type as unknown) === 'Text' && node.children.join('') === text);
}
function renderedText(root: ReactTestInstance): string {
  return root.findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''))
    .join('\n');
}
function focusedLabel(node: unknown): unknown {
  return node && typeof node === 'object'
    ? (node as { accessibilityLabel?: unknown }).accessibilityLabel
    : undefined;
}
function mission(key: string, type: QuestMission['type'], target: string | null): QuestMission { return { key, type, target, progress: null, completable: false }; }
function summaryOrder(root: ReactTestInstance): string[] {
  return root.findAll((node) => (node.type as unknown) === 'Pressable'
    && typeof node.props.testID === 'string' && node.props.testID.startsWith('quest-summary:'))
    .map((node) => node.props.testID as string);
}
function snapshot(questId: string, name: string, section: QuestSnapshot['section'], missions: QuestMission[], sourceOrder = 0): QuestSnapshot { return { questId, name, section, state: section === 'ACTIVE' ? 'ACTIVE' : section === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE', sourceOrder, missions, actionNo: null, rewards: [] }; }
function questEntry(quests: TypedAutomationEntryResponse['quests'] = []): TypedAutomationEntryResponse { return { id: 1, type: 'QUEST', enabled: true, priority: 0, ready: true, warnings: [], quests, battleMaps: [], battleMapProgress: [], adventureMaps: [] }; }
function mapSetting(missionKey: string, mapCode: string, executionOrder: number) { return { missionKey, categoryId: 'battle_map', mapCode, executionOrder, manuallyOverridden: true, presetMode: 'PRIMARY' as const, partyPresetId: null }; }
function catalogMap(categoryId: string, mapCode: string, name: string): BattleMapResponse { return { categoryId, mapCode, name, groupName: null, groupOrder: 0, mapOrder: 0, recommendedLevel: null, availableCount: null, attemptCount: null, winCount: null, cooldownRemainingText: null, cooldownRemainingSeconds: null, keyCount: null, requiredTime: null, supportsThreeBattles: false, enabled: true, resolved: true, iconUrl: null, rawHref: '' }; }
function preset(id: number, name: string) { return { id, accountId: 1, name, isPrimary: false, members: [], createdAt: '', updatedAt: '' }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
