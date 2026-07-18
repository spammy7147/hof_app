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
let alertArguments: unknown[] | null = null;
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: (...args: unknown[]) => { alertArguments = args; } },
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
    await openAdventureGroup(renderer, '기타');
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

    await openAdventureGroup(renderer, '기타');
    assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '최신 맵 모험맵 선택' }).length > 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '이전 맵 모험맵 선택' }).length, 0);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '최신 맵 모험맵 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '대표 · 최신 대표'), true);
    assert.equal(hasText(renderer.root, '대표 · 이전 대표'), false);
  });

  it('starts groups collapsed, keeps multiple open, and saves selection order independently from catalog order', async () => {
    const saves: UpdateAdventureMapAutomationRequest[] = [];
    const renderer = await renderEditor({
      maps: [
        map('early', '선순위 맵', { groupName: '앞 그룹', groupOrder: 0, recommendedLevel: '10-20' }),
        map('late', '후순위 맵', { groupName: '뒤 그룹', groupOrder: 1, recommendedLevel: '40-60' }),
      ],
      onSave: async (request) => { saves.push(request); return true; },
    });

    assert.ok(renderer.root.findByProps({ accessibilityLabel: '앞 그룹 그룹 열기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '뒤 그룹 그룹 열기' }));
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '선순위 맵 모험맵 선택' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '후순위 맵 모험맵 선택' }).length, 0);
    assert.equal(hasText(renderer.root, 'Lv 10-20 · 1개'), true);
    assert.equal(hasText(renderer.root, 'Lv 40-60 · 1개'), true);

    await openAdventureGroup(renderer, '뒤 그룹');
    await openAdventureGroup(renderer, '앞 그룹');
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '앞 그룹 그룹 닫기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '뒤 그룹 그룹 닫기' }));

    let late = renderer.root.findByProps({ accessibilityLabel: '후순위 맵 모험맵 선택' });
    let early = renderer.root.findByProps({ accessibilityLabel: '선순위 맵 모험맵 선택' });
    assert.equal(late.props.accessibilityRole, 'checkbox');
    assert.deepEqual(late.props.accessibilityState, { checked: false, disabled: false });
    assert.equal(late.findAll((node) => ['Checkbox', 'Square', 'CheckSquare', 'Image'].includes(String(node.type))).length, 0);
    assert.equal(hasText(late, '횟수 제한 없음 · 반복 실행'), true);
    assert.equal(hasText(late, '40-60 · 앞 순서에 있으면 계속 반복될 수 있습니다.'), true);

    await act(async () => { late.props.onPress(); });
    late = renderer.root.findByProps({ accessibilityLabel: '후순위 맵 모험맵 선택' });
    assert.equal(late.props.accessibilityState.checked, true);
    assert.equal(hasText(late, '선택됨'), true);
    await act(async () => { early.props.onPress(); });
    early = renderer.root.findByProps({ accessibilityLabel: '선순위 맵 모험맵 선택' });
    assert.equal(early.props.accessibilityState.checked, true);
    assert.equal(hasText(early, '선택됨'), true);

    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 저장' }).props.onPress(); });

    assert.deepEqual(saves, [{
      enabled: true,
      maps: [
        { categoryId: 'adventure_map', mapCode: 'late', presetMode: 'PRIMARY', partyPresetId: null, executionOrder: 0 },
        { categoryId: 'adventure_map', mapCode: 'early', presetMode: 'PRIMARY', partyPresetId: null, executionOrder: 1 },
      ],
    }]);
  });

  it('restores manual groups and fences callbacks retained before search', async () => {
    const renderer = await renderEditor({
      maps: [
        map('manual', '수동 맵', { groupName: '수동 그룹', groupOrder: 0 }),
        map('needle', '바늘 맵', { groupName: '검색 그룹', groupOrder: 1 }),
      ],
    });
    await openAdventureGroup(renderer, '수동 그룹');
    const retainedManualPress = renderer.root.findByProps({ accessibilityLabel: '수동 그룹 그룹 닫기' }).props.onPress as () => void;

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 검색' }).props.onChangeText('바늘'); });
    await act(async () => { retainedManualPress(); });

    const searchGroup = renderer.root.findByProps({ accessibilityLabel: '검색 그룹 그룹 검색 결과' });
    assert.equal(searchGroup.props.disabled, true);
    assert.deepEqual(searchGroup.props.accessibilityState, { disabled: true, expanded: true });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '바늘 맵 모험맵 선택' }));
    await act(async () => { searchGroup.props.onPress(); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 검색' }).props.onChangeText(''); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '수동 그룹 그룹 닫기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '수동 맵 모험맵 선택' }));
  });

  it('fences every retained edit callback while saving and leaves the submitted draft clean', async () => {
    alertArguments = null;
    const pending = deferred<boolean>();
    const saves: UpdateAdventureMapAutomationRequest[] = [];
    let backs = 0;
    const renderer = await renderEditor({
      entry: entry([
        setting('first', 0, 'PRIMARY', null),
        setting('second', 1, 'PRIMARY', null),
      ]),
      maps: [
        map('first', '첫 맵', { groupName: '그룹', mapOrder: 0 }),
        map('second', '둘째 맵', { groupName: '그룹', mapOrder: 1 }),
        map('third', '셋째 맵', { groupName: '그룹', mapOrder: 2 }),
      ],
      onListPartyPresets: async () => [preset(9, '고정 파티', false)],
      onSave: async (request) => { saves.push(request); return pending.promise; },
      onBack: () => { backs += 1; },
    });
    await openAdventureGroup(renderer, '그룹');
    const retainedMoveDown = renderer.root.findByProps({ accessibilityLabel: '첫 맵 아래로' }).props.onPress as () => void;
    const retainedMoveUp = renderer.root.findByProps({ accessibilityLabel: '둘째 맵 위로' }).props.onPress as () => void;
    const retainedRemove = renderer.root.findByProps({ accessibilityLabel: '첫 맵 제거' }).props.onPress as () => void;
    const retainedEnabled = renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 사용' }).props.onValueChange as (value: boolean) => void;
    const retainedCatalog = renderer.root.findByProps({ accessibilityLabel: '셋째 맵 모험맵 선택' }).props.onPress as () => void;
    const retainedOpen = renderer.root.findByProps({ accessibilityLabel: '첫 맵 프리셋 선택 열기' }).props.onPress as () => void;
    await act(async () => { retainedOpen(); });
    const retainedPreset = renderer.root.findByProps({ accessibilityLabel: '고정 파티 프리셋 선택' }).props.onPress as () => void;
    let saving!: Promise<void>;
    const selectedOrder = () => renderer.root.findAll((node) => (
      (node.type as unknown) === 'Pressable'
      && (node.props.accessibilityLabel === '첫 맵 제거'
        || node.props.accessibilityLabel === '둘째 맵 제거')
    )).map((node) => node.props.accessibilityLabel);

    await act(async () => { saving = renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 저장' }).props.onPress(); });
    await act(async () => { retainedMoveDown(); });
    assert.deepEqual(selectedOrder(), ['첫 맵 제거', '둘째 맵 제거']);
    await act(async () => { retainedMoveUp(); });
    assert.deepEqual(selectedOrder(), ['첫 맵 제거', '둘째 맵 제거']);
    await act(async () => {
      retainedRemove();
      retainedEnabled(false);
      retainedCatalog();
      retainedOpen();
      retainedPreset();
    });

    assert.deepEqual(saves, [{
      enabled: true,
      maps: [
        { categoryId: 'adventure_map', mapCode: 'first', presetMode: 'PRIMARY', partyPresetId: null, executionOrder: 0 },
        { categoryId: 'adventure_map', mapCode: 'second', presetMode: 'PRIMARY', partyPresetId: null, executionOrder: 1 },
      ],
    }]);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 사용' }).props.value, true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '첫 맵 제거' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '둘째 맵 제거' }));
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '셋째 맵 모험맵 선택' }).props.accessibilityState.checked, false);

    await act(async () => { pending.resolve(true); await saving; });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 뒤로' }).props.onPress(); });
    assert.equal(backs, 1);
    assert.equal(alertArguments, null);
  });

  it('baselines the submitted snapshot when a later server entry is reconciled during save', async () => {
    alertArguments = null;
    const pending = deferred<boolean>();
    const initialEntry = entry([setting('first', 0, 'PRIMARY', null)]);
    const base = editorProps({
      entry: initialEntry,
      onLoadBattleMaps: async () => [map('first', '첫 맵'), map('server', '서버 맵')],
      onSave: async () => pending.promise,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });
    let saving!: Promise<void>;
    await act(async () => { saving = renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 저장' }).props.onPress(); });

    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        entry: entry([setting('server', 0, 'PRIMARY', null)]),
      }));
    });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '서버 맵 제거' }));

    await act(async () => { pending.resolve(true); await saving; });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 뒤로' }).props.onPress(); });
    assert.equal(alertArguments?.[0], '변경 사항을 버릴까요?');
  });

  it('fences duplicate save and confirmed delete callbacks synchronously', async () => {
    alertArguments = null;
    const savePending = deferred<boolean>();
    let saves = 0;
    const saveRenderer = await renderEditor({
      onSave: async () => { saves += 1; return savePending.promise; },
    });
    const save = saveRenderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 저장' }).props.onPress as () => Promise<void>;
    let firstSave!: Promise<void>;
    await act(async () => { firstSave = save(); void save(); });
    assert.equal(saves, 1);
    await act(async () => { savePending.resolve(true); await firstSave; });

    const deletePending = deferred<boolean>();
    let deletes = 0;
    const deleteRenderer = await renderEditor({
      onDelete: async () => { deletes += 1; return deletePending.promise; },
    });
    await act(async () => { deleteRenderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 삭제' }).props.onPress(); });
    const buttons = alertArguments?.[2] as unknown as Array<{ text: string; onPress?: () => Promise<void> }>;
    const remove = buttons.find(({ text }) => text === '삭제')?.onPress;
    assert.ok(remove);
    let firstDelete!: Promise<void>;
    await act(async () => { firstDelete = remove!(); void remove!(); });
    assert.equal(deletes, 1);
    await act(async () => { deletePending.resolve(false); await firstDelete; });
  });

  it('shows the search-only empty message after a settled query has no matches', async () => {
    const renderer = await renderEditor({ maps: [map('forest', '숲 모험', { groupName: '숲' })] });

    assert.equal(hasText(renderer.root, '검색 가능한 모험맵이 없습니다.'), false);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 검색' }).props.onChangeText('없는 맵'); });
    assert.equal(hasText(renderer.root, '검색 가능한 모험맵이 없습니다.'), true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 검색' }).props.onChangeText('   '); });
    assert.equal(hasText(renderer.root, '검색 가능한 모험맵이 없습니다.'), false);
  });

  it('clears stale observations only after a newer successful map refresh omits the selected map', async () => {
    const first = deferred<BattleMapResponse[]>();
    const second = deferred<BattleMapResponse[]>();
    const base = editorProps({
      entry: entry([setting('stored', 0, 'PRIMARY', null)]),
      onLoadBattleMaps: () => first.promise,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });
    await act(async () => {
      first.resolve([map('stored', '저장된 맵', {
        cooldownRemainingSeconds: 60,
        cooldownRemainingText: '1분',
        keyCount: 2,
        attemptCount: 3,
      })]);
      await first.promise;
    });
    assert.equal(hasText(renderer.root, '쿨다운 1분'), true);
    assert.equal(hasText(renderer.root, '열쇠 · 2개'), true);

    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        onLoadBattleMaps: () => second.promise,
      }));
    });
    assert.equal(hasText(renderer.root, '쿨다운 1분'), true);
    await act(async () => {
      second.resolve([]);
      await second.promise;
    });

    assert.equal(hasText(renderer.root, '현재 상태 확인 불가'), true);
    assert.equal(hasText(renderer.root, '쿨다운 · 미확인'), true);
    assert.equal(hasText(renderer.root, '열쇠 · 미확인'), true);
    assert.equal(hasText(renderer.root, '쿨다운 1분'), false);
  });

  it('preserves the last successful observation when a refresh fails', async () => {
    const second = deferred<BattleMapResponse[]>();
    const base = editorProps({
      entry: entry([setting('stored', 0, 'PRIMARY', null)]),
      onLoadBattleMaps: async () => [map('stored', '저장된 맵', {
        cooldownRemainingSeconds: 60,
        cooldownRemainingText: '1분',
        availableCount: 2,
      })],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });
    assert.equal(hasText(renderer.root, '쿨다운 1분'), true);

    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        onLoadBattleMaps: () => second.promise,
      }));
    });
    await act(async () => {
      second.reject(new Error('offline'));
      try { await second.promise; } catch {}
    });

    assert.equal(hasText(renderer.root, '쿨다운 1분'), true);
    assert.equal(hasText(renderer.root, '가능 횟수 · 2회'), true);
  });

  it('keeps mutations disabled while categories are still loading and does not finalize a missing category', async () => {
    const maps = deferred<BattleMapResponse[]>();
    let requested = 0;
    const base = editorProps({
      entry: entry([setting('stored', 0, 'PRIMARY', null)]),
      battleCategories: [],
      areBattleCategoriesLoaded: false,
      isBattleCategoriesLoading: true,
      onLoadBattleCategories: () => { requested += 1; },
      onLoadBattleMaps: () => maps.promise,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });

    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'stored 제거' }).props.disabled, true);
    assert.equal(hasText(renderer.root, '모험맵을 불러오지 못했어요.'), false);
    assert.equal(requested, 0);

    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        battleCategories: [{ id: 'adventure_map', label: '모험맵', description: '', order: 0, enabled: true }],
        areBattleCategoriesLoaded: true,
        isBattleCategoriesLoading: false,
      }));
    });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'stored 제거' }).props.disabled, true);
    await act(async () => {
      maps.resolve([map('stored', '저장된 맵')]);
      await maps.promise;
    });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '저장된 맵 제거' }).props.disabled, false);
  });

  it('renders cooldown, key, and each daily constraint separately for the same map', async () => {
    const renderer = await renderEditor({
      maps: [map('combined', '복합 제한 맵', {
        cooldownRemainingSeconds: 90,
        cooldownRemainingText: '1분 30초',
        keyCount: 0,
        availableCount: 4,
        attemptCount: 2,
        winCount: 1,
      })],
    });
    await openAdventureGroup(renderer, '기타');
    assert.equal(hasText(renderer.root, '쿨다운 1분 30초'), true);
    assert.equal(hasText(renderer.root, '쿨다운이 끝난 뒤 자동으로 다시 확인합니다.'), true);

    for (const label of [
      '쿨다운 · 1분 30초',
      '열쇠 · 0개',
      '가능 횟수 · 4회',
      '도전 잔여 · 2회',
      '승리 잔여 · 1회',
    ]) {
      assert.equal(hasText(renderer.root, label), true);
    }
  });
});

type RenderEditorOptions = Partial<React.ComponentProps<typeof AdventureMapAutomationEditor>> & {
  maps?: BattleMapResponse[];
};

async function renderEditor({
  maps = [],
  onLoadBattleMaps = async () => maps,
  onSave = async () => true,
  ...overrides
}: RenderEditorOptions = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(AdventureMapAutomationEditor, editorProps({
      ...overrides,
      onLoadBattleMaps,
      onSave,
    })));
  });
  return renderer;
}

async function openAdventureGroup(renderer: ReactTestRenderer, name: string): Promise<void> {
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: `${name} 그룹 열기` }).props.onPress();
  });
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
