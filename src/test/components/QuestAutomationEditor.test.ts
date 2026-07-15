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
    data.length === 0
      ? props.ListEmptyComponent as React.ReactNode
      : data.map((item) => React.createElement(React.Fragment, { key: item.questId }, renderItem({ item }))),
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
    assert.ok(renderer.root.findAllByProps({ accessibilityLabel: 'kill 맵 추가' }).length > 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'item 맵 추가' }).length, 0);
    assert.equal(hasText(renderer.root, '맵 설정이 필요 없는 미션입니다.'), true);
  });

  it('disables invalid/busy saves and submits the complete typed request once valid', async () => {
    const saves: UpdateQuestAutomationRequest[] = [];
    const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill-key', 'MONSTER_KILL', 'Maid')]);
    const map = catalogMap('battle_map', 'maid', 'Maid Field');
    const renderer = await renderEditor({ quests: [quest], maps: [map], onSave: async (request) => { saves.push(request); return true; } });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress(); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.disabled, true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'kill-key 맵 추가' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'kill-key 맵 검색' }).props.onChangeText('Maid'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Maid Field 맵 선택' }).props.onPress(); });
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
      loading: false, actionSaving: false, editorSaving: false, savingEntryIds: [], savingModuleIds: [], savingTypes: [], reordering: false, error: null, message: null,
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
    const request: UpdateQuestAutomationRequest = { enabled: true, quests: [] };
    await act(async () => { await questEditor.props.onSave(request); });
    assert.deepEqual(saves, [request]);

    await act(async () => { renderer = create(React.createElement(HomeTabScreen, props)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '설정 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'BATTLE_MAP 상세 열기' }).props.onPress(); });
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'UnifiedAutomationModuleEditor').length, 1);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'QuestAutomationEditor').length, 0);
  });
});

async function renderEditor(overrides: {
  quests?: QuestSnapshot[];
  maps?: BattleMapResponse[];
  saving?: boolean;
  fetchQuests?: () => Promise<QuestSnapshot[]>;
  onSave?: (request: UpdateQuestAutomationRequest) => Promise<boolean>;
  onBack?: () => void;
  onDelete?: () => Promise<boolean>;
} = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(QuestAutomationEditor, {
      entry: questEntry(),
      battleCategories: [{ id: 'battle_map', label: '전투맵', description: '', order: 0, enabled: true }],
      saving: overrides.saving ?? false,
      fetchQuests: overrides.fetchQuests ?? (async () => overrides.quests ?? []),
      onBack: overrides.onBack ?? (() => undefined),
      onDelete: overrides.onDelete ?? (async () => true),
      onLoadBattleCategories: () => undefined,
      onLoadBattleMaps: async () => overrides.maps ?? [],
      onListPartyPresets: async () => [],
      onSave: overrides.onSave ?? (async () => true),
    }));
  });
  return renderer;
}

function hasText(root: ReactTestInstance, text: string): boolean {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length > 0;
}
function mission(key: string, type: QuestMission['type'], target: string | null): QuestMission { return { key, type, target, progress: null, completable: false }; }
function snapshot(questId: string, name: string, section: QuestSnapshot['section'], missions: QuestMission[]): QuestSnapshot { return { questId, name, section, state: section === 'ACTIVE' ? 'ACTIVE' : section === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE', sourceOrder: 0, missions, actionNo: null }; }
function questEntry(): TypedAutomationEntryResponse { return { id: 1, type: 'QUEST', enabled: true, priority: 0, ready: true, warnings: [], quests: [], battleMaps: [], adventureMaps: [] }; }
function catalogMap(categoryId: string, mapCode: string, name: string): BattleMapResponse { return { categoryId, mapCode, name, groupName: null, groupOrder: 0, mapOrder: 0, recommendedLevel: null, availableCount: null, attemptCount: null, winCount: null, cooldownRemainingText: null, cooldownRemainingSeconds: null, keyCount: null, requiredTime: null, enabled: true, resolved: true, iconUrl: null, rawHref: '' }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function legacyModule(id: number, moduleType: 'OTHER_QUEST' | 'TIME_BURN') { return { id, displayName: 'Module', moduleType, enabled: true, priority: id - 1, thresholdPercent: moduleType === 'TIME_BURN' ? 90 : null, maps: [], quests: [], ready: true, summary: '' }; }
