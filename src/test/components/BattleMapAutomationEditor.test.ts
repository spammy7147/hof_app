import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { theme } from '../../main/styles/theme';
import type {
  BattleMapResponse,
  TypedAutomationEntryResponse,
  UpdateBattleMapAutomationRequest,
} from '../../main/types/api';

let alertArguments: unknown[] | null = null;
const accessibilityFocusCalls: unknown[] = [];
const keyboardFocusCalls: unknown[] = [];
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  const nodeRef = React.useRef<Record<string, unknown>>({});
  Object.assign(nodeRef.current, props);
  React.useImperativeHandle(ref, () => nodeRef.current, []);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const textInput = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  const nodeRef = React.useRef<Record<string, unknown>>({});
  Object.assign(nodeRef.current, props, {
    focus: () => { keyboardFocusCalls.push(nodeRef.current.accessibilityLabel); },
  });
  React.useImperativeHandle(ref, () => nodeRef.current, []);
  return React.createElement('TextInput', props, props.children as React.ReactNode);
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
const dragCalls: unknown[] = [];
const draggableFlatList = (hostName: string) => (props: Record<string, unknown>) => React.createElement(
  hostName,
  props,
  (props.data as unknown[]).map((item, index) => React.createElement(
    React.Fragment,
    { key: (props.keyExtractor as (value: unknown) => string)(item) },
    (props.renderItem as (value: {
      item: unknown;
      drag: () => void;
      getIndex: () => number;
      isActive: boolean;
    }) => React.ReactNode)({
      item,
      drag: () => { dragCalls.push(item); },
      getIndex: () => index,
      isActive: false,
    }),
  )),
);
const nestableScrollContainer = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement('NestableScrollContainer', { ...props, ref }, props.children as React.ReactNode)
));
type SwipeableMockMethods = { close: () => void; closeCalls: number };
const reanimatedSwipeable = React.forwardRef<SwipeableMockMethods, Record<string, unknown>>((props, ref) => {
  const methods = React.useMemo<SwipeableMockMethods>(() => ({
    closeCalls: 0,
    close() { methods.closeCalls += 1; },
  }), []);
  React.useImperativeHandle(ref, () => methods, [methods]);
  const renderRightActions = props.renderRightActions as ((...args: unknown[]) => React.ReactNode) | undefined;
  return React.createElement(
    'ReanimatedSwipeable',
    { ...props, mockMethods: methods },
    props.children as React.ReactNode,
    renderRightActions?.(null, null, methods),
  );
});
const modal = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  props.visible ? React.createElement('Modal', { ...props, ref }, props.children as React.ReactNode) : null
));
const reactNativeMock = {
  AccessibilityInfo: {
    setAccessibilityFocus: (node: unknown) => { accessibilityFocusCalls.push(node); },
  },
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: (...args: unknown[]) => { alertArguments = args; } },
  findNodeHandle: (node: unknown) => node,
  FlatList: flatList, Modal: modal, Pressable: host('Pressable'), ScrollView: host('ScrollView'), StyleSheet: { create: <T,>(styles: T) => styles },
  Switch: host('Switch'), Text: host('Text'), TextInput: textInput, View: host('View'),
};
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') return iconsMock;
  if (request === 'react-native-draggable-flatlist') return {
    __esModule: true,
    default: draggableFlatList('DraggableFlatList'),
    NestableDraggableFlatList: draggableFlatList('NestableDraggableFlatList'),
    NestableScrollContainer: nestableScrollContainer,
  };
  if (request === 'react-native-gesture-handler/ReanimatedSwipeable') {
    return { __esModule: true, default: reanimatedSwipeable };
  }
  return originalLoad(request, parent, isMain);
};
const { BattleMapAutomationEditor } = require(
  '../../main/features/automation/components/BattleMapAutomationEditor',
) as typeof import('../../main/features/automation/components/BattleMapAutomationEditor');
const {
  BattleMapCatalogCategoryRow,
  BattleMapCatalogGroupRow,
  BattleMapCatalogMapRow,
  BattleMapCatalogStateRow,
} = require(
  '../../main/features/automation/components/BattleMapCatalogRows',
) as typeof import('../../main/features/automation/components/BattleMapCatalogRows');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BattleMapAutomationEditor mounted behavior', () => {
  it('renders accessible catalog rows and changes map selection through the row callback', async () => {
    const catalogCategory = { id: 'battle', label: '전투맵', description: '전투할 맵을 고르세요.', order: 0, enabled: true };
    const catalogMapRow = catalogMap('mansion', "Noble's Mansion- 저택 서관(놀이방)", { keyMode: 'LIMITED', keyCount: 8, requiredTime: 10 });
    const catalogGroup = { key: 'battle:0:저택 서관', name: '저택 서관', groupOrder: 0, recommendedLevel: '50-60', maps: [catalogMapRow] };
    let mapPresses = 0;
    let disabledPresses = 0;
    let retries = 0;

    function CatalogRowsHarness() {
      const [selected, setSelected] = React.useState(false);
      return React.createElement(React.Fragment, null,
        React.createElement(BattleMapCatalogCategoryRow, { category: catalogCategory, expanded: false, mapCount: null, onPress: () => undefined }),
        React.createElement(BattleMapCatalogCategoryRow, { category: catalogCategory, expanded: true, mapCount: 1, onPress: () => undefined }),
        React.createElement(BattleMapCatalogGroupRow, { group: catalogGroup, expanded: true, onPress: () => undefined }),
        React.createElement(BattleMapCatalogGroupRow, { group: catalogGroup, expanded: false, onPress: () => undefined }),
        React.createElement(BattleMapCatalogMapRow, { map: catalogMapRow, selected, disabled: false, onPress: () => { mapPresses += 1; setSelected(true); } }),
        React.createElement(BattleMapCatalogMapRow, { map: catalogMap('disabled', '잠긴 맵'), selected: false, disabled: true, onPress: () => { disabledPresses += 1; } }),
        React.createElement(BattleMapCatalogStateRow, { category: catalogCategory, state: 'loading', error: null, onRetry: () => undefined }),
        React.createElement(BattleMapCatalogStateRow, { category: catalogCategory, state: 'error', error: '연결이 끊겼어요.', onRetry: () => { retries += 1; } }),
        React.createElement(BattleMapCatalogStateRow, { category: catalogCategory, state: 'empty', error: null, onRetry: () => undefined }),
      );
    }

    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(CatalogRowsHarness)); });

    const categoryButton = renderer.root.findByProps({ accessibilityLabel: '전투맵 카테고리 열기' });
    assert.equal(categoryButton.props.accessibilityRole, 'button');
    assert.equal(categoryButton.props.accessibilityState.expanded, false);
    const categoryStyle = flattenStyle(categoryButton.props.style);
    assert.equal(categoryStyle.minHeight, 60);
    assert.equal(categoryStyle.paddingHorizontal, 12);
    assert.equal(categoryStyle.paddingVertical, 8);
    assert.notEqual(categoryStyle.backgroundColor, theme.colors.accentGreen);
    assert.notEqual(categoryStyle.borderColor, theme.colors.accentGreen);
    const expandedCategoryStyle = flattenStyle(renderer.root.findByProps({ accessibilityLabel: '전투맵 카테고리 닫기' }).props.style);
    assert.notEqual(expandedCategoryStyle.backgroundColor, theme.colors.accentGreen);
    assert.notEqual(expandedCategoryStyle.borderColor, theme.colors.accentGreen);
    const groupButton = renderer.root.findByProps({ accessibilityLabel: '저택 서관 그룹 닫기' });
    assert.equal(groupButton.props.accessibilityRole, 'button');
    assert.equal(groupButton.props.accessibilityState.expanded, true);
    const groupStyle = flattenStyle(groupButton.props.style);
    assert.equal(groupStyle.minHeight, 52);
    assert.equal(groupStyle.paddingHorizontal, 12);
    assert.equal(groupStyle.paddingVertical, 6);
    assert.notEqual(groupStyle.backgroundColor, theme.colors.accentGreen);
    assert.notEqual(groupStyle.borderColor, theme.colors.accentGreen);
    const collapsedGroupStyle = flattenStyle(renderer.root.findByProps({ accessibilityLabel: '저택 서관 그룹 열기' }).props.style);
    assert.notEqual(collapsedGroupStyle.backgroundColor, theme.colors.accentGreen);
    assert.notEqual(collapsedGroupStyle.borderColor, theme.colors.accentGreen);
    const mapButton = () => renderer.root.findByProps({ accessibilityLabel: '저택 서관(놀이방) 맵 선택' });
    assert.equal(mapButton().props.accessibilityRole, 'button');
    assert.deepEqual(mapButton().props.accessibilityState, { disabled: false, selected: false });
    const mapStyle = flattenStyle(mapButton().props.style);
    assert.equal(mapStyle.minHeight, 48);
    assert.equal(mapStyle.paddingHorizontal, 12);
    assert.equal(mapStyle.paddingVertical, 8);
    assert.equal(findTextNode(renderer.root, '저택 서관(놀이방)').props.numberOfLines, 2);
    assert.equal(flattenStyle(mapButton().props.style).backgroundColor, theme.colors.surfaceAlt);
    assert.equal(hasText(renderer.root, '저택 서관(놀이방)'), true);
    assert.equal(hasText(renderer.root, 'key 8 · Time 10'), true);
    assert.equal(hasText(renderer.root, '선택됨'), false);
    assert.equal(hasText(renderer.root, '확인 중'), true);
    assert.equal(hasText(renderer.root, 'Lv 50-60 · 1개'), true);
    assert.equal(renderer.root.findAll((node) => ['Folder', 'Swords', 'Check'].includes(node.type as string)).length, 0);
    assert.equal(hasText(renderer.root, '전투맵 맵 불러오는 중'), true);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'ActivityIndicator').length, 1);
    assert.equal(hasText(renderer.root, '전투맵 맵이 없습니다.'), true);
    assert.equal(hasText(renderer.root, '다시 시도'), true);

    await act(async () => { mapButton().props.onPress(); });
    assert.equal(mapPresses, 1);
    const selectedMapButton = renderer.root.findByProps({ accessibilityLabel: '저택 서관(놀이방) 맵 선택 해제' });
    assert.equal(selectedMapButton.props.accessibilityRole, 'button');
    assert.deepEqual(selectedMapButton.props.accessibilityState, { disabled: false, selected: true });
    assert.equal(hasText(renderer.root, '선택됨'), false);
    assert.equal(selectedMapButton.findAll((node) => node.props.accessibilityRole === 'checkbox').length, 0);
    const selectedMapStyle = flattenStyle(selectedMapButton.props.style);
    assert.notEqual(selectedMapStyle.backgroundColor, theme.colors.accentGreen);
    assert.equal(selectedMapStyle.backgroundColor, theme.colors.surface);
    assert.equal(selectedMapStyle.borderColor, theme.colors.accentGreen);
    assert.equal(flattenStyle(findTextNode(renderer.root, '저택 서관(놀이방)').props.style).color, theme.colors.text);
    assert.equal(flattenStyle(findTextNode(renderer.root, 'key 8 · Time 10').props.style).color, theme.colors.textMuted);
    const disabledMapButton = renderer.root.findByProps({ accessibilityLabel: '잠긴 맵 맵 선택' });
    assert.deepEqual(disabledMapButton.props.accessibilityState, { disabled: true, selected: false });
    await act(async () => { disabledMapButton.props.onPress(); });
    assert.equal(disabledPresses, 0);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투맵 맵 다시 불러오기' }).props.onPress(); });
    assert.equal(retries, 1);
    assert.equal(hasText(renderer.root, '연결이 끊겼어요.'), true);
  });

  it('mounts the three-line B layout with drag, swipe delete, target, and preset controls', async () => {
    const renderer = await renderEditor({
      entry: battleEntry(
        [setting('compact', 10, 0)],
        [{ categoryId: 'battle', mapCode: 'compact', successfulRuns: 2 }],
      ),
      maps: [catalogMap('compact', '압축 전투', { supportsThreeBattles: true })],
      presets: [{ ...preset(7, '대표 프리셋'), isPrimary: true }],
    });

    const presetChoice = renderer.root.findByProps({ accessibilityLabel: '압축 전투 프리셋 선택 열기' });
    assert.equal(flattenStyle(presetChoice.props.style).minHeight, 32);
    assert.equal(hasText(presetChoice, '프리셋'), true);
    assert.equal(textCount(renderer.root, '대표 · 대표 프리셋'), 1);
    assert.equal(presetChoice.findAll((node) => (node.type as unknown) === 'ChevronRight').length, 1);

    assert.equal(hasText(renderer.root, '현재 프리셋'), false);
    assert.equal(hasText(renderer.root, '프리셋 변경'), false);
    const progressSummary = renderer.root.findByProps({ accessibilityLabel: '압축 전투 오늘 진행 요약' });
    assert.equal(hasText(progressSummary, '오늘 2/10 · 8회 남음 · 다음 3회 전투'), true);
    const targetInput = renderer.root.findByProps({ accessibilityLabel: '압축 전투 일일 목표' });
    assert.equal(targetInput.props.value, '10');
    assert.equal(flattenStyle(targetInput.props.style).minHeight, 32);
    assert.equal(flattenStyle(targetInput.props.style).width, 44);
    assert.equal(hasText(renderer.root, '20%'), false);
    assert.equal(hasText(renderer.root, '3회 전투 지원'), false);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '압축 전투 오늘 진행률' }).length, 0);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '압축 전투 1번째 맵 순서 이동' }).props.accessibilityRole, 'adjustable');
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '압축 전투 삭제' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 삭제' }));

    const scroller = renderer.root.find((node) => (node.type as unknown) === 'NestableScrollContainer');
    assert.equal(flattenStyle(scroller.props.contentContainerStyle).gap, 6);
    const nestedList = renderer.root.find((node) => (node.type as unknown) === 'NestableDraggableFlatList');
    assert.equal(nestedList.props.activationDistance, 20);
  });

  it('saves the identity order produced by a selected-map drag', async () => {
    dragCalls.length = 0;
    const saves: UpdateBattleMapAutomationRequest[] = [];
    const renderer = await renderEditor({
      entry: battleEntry([setting('a', 3, 0), setting('b', 4, 1)]),
      maps: [catalogMap('a', 'Alpha'), catalogMap('b', 'Beta', { mapOrder: 1 })],
      onSave: async (request) => { saves.push(request); return true; },
    });
    const draggable = renderer.root.find((node) => (node.type as unknown) === 'NestableDraggableFlatList');
    const rows = draggable.props.data as unknown[];

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Alpha 1번째 맵 순서 이동' }).props.onLongPress();
      draggable.props.onDragEnd({ data: [...rows].reverse(), from: 0, to: 1 });
    });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.onPress(); });

    assert.deepEqual(saves[0]?.maps.map(({ mapCode, executionOrder }) => [mapCode, executionOrder]), [
      ['b', 0],
      ['a', 1],
    ]);
  });

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

    assert.equal(hasText(renderer.root, '오늘 3/5 · 2회 남음 · 다음 3회 전투'), true);
    assert.equal(hasText(renderer.root, 'missing'), true);
    assert.equal(renderer.root.findAll((node) => (
      (node.type as unknown) === 'TextInput'
      && node.props.accessibilityLabel === '전투 맵 검색'
    )).length, 1);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투 맵 검색' }).props.onChangeText('forest'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 맵 선택' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 일일 목표' }).props.onChangeText('4'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.onChangeText('raid'); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Raid Team 프리셋 선택' }).props.onPress(); });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Beta 3번째 맵 순서 이동' })
        .props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'missing 삭제' }).props.onPress(); });
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
    await openCatalogGroup(renderer);
    assert.equal(hasText(renderer.root, 'map down'), true);
    assert.equal(hasText(renderer.root, '프리셋을 불러오지 못했어요.'), true);

    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투맵 맵 다시 불러오기' }).props.onPress(); });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '프리셋 다시 불러오기' }).props.onPress(); });
    assert.equal(mapAttempts, 2);
    assert.equal(presetAttempts, 2);
    assert.equal(hasText(renderer.root, 'saved'), true);
    await openCatalogGroup(renderer);
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
    for (const label of ['전투 맵 자동화 뒤로', '전투 맵 자동화 삭제', 'Alpha 삭제', 'Alpha 일일 목표']) {
      const control = busy.root.findByProps({ accessibilityLabel: label });
      assert.equal(control.props.disabled ?? !control.props.editable, true, label);
    }
    assert.equal(busy.root.findByProps({ accessibilityLabel: '전투 맵 자동화 사용' }).props.disabled, true);
    assert.equal(busy.root.findByProps({ accessibilityLabel: '전투 맵 검색' }).props.editable, true);
    assert.equal(busy.root.findByProps({ accessibilityLabel: 'Alpha 프리셋 선택 열기' }).props.disabled, true);
    await openCatalogGroup(busy);
    assert.equal(busy.root.findByProps({ accessibilityLabel: 'Alpha 맵 선택 해제' }).props.disabled, true);
  });

  it('fences retained catalog callbacks while an internal save is pending', async () => {
    alertArguments = null;
    let backs = 0;
    const saveResult = deferred<boolean>();
    const saves: UpdateBattleMapAutomationRequest[] = [];
    const renderer = await renderEditor({
      maps: [catalogMap('a', 'Alpha'), catalogMap('b', 'Beta', { mapOrder: 1 })],
      onSave: async (request) => { saves.push(request); return saveResult.promise; },
      onBack: () => { backs += 1; },
    });
    await openCatalogGroup(renderer);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 맵 선택' }).props.onPress(); });
    const retainedBetaPress = renderer.root.findByProps({ accessibilityLabel: 'Beta 맵 선택' }).props.onPress as () => void;
    let pendingSave!: Promise<void>;

    await act(async () => {
      pendingSave = renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.onPress();
    });
    await act(async () => { retainedBetaPress(); });
    assert.deepEqual(saves, [{ enabled: true, maps: [setting('a', 1, 0)] }]);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Beta 일일 목표' }).length, 0);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Beta 맵 선택' }).props.accessibilityState.selected, false);

    await act(async () => {
      saveResult.resolve(true);
      await pendingSave;
    });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Beta 일일 목표' }).length, 0);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Beta 맵 선택' }).props.accessibilityState.selected, false);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 뒤로' }).props.onPress(); });
    assert.equal(backs, 1);
    assert.equal(alertArguments, null);
  });

  it('fences every retained editor mutation during save and baselines the submitted draft', async () => {
    alertArguments = null;
    let backs = 0;
    const saveResult = deferred<boolean>();
    const saves: UpdateBattleMapAutomationRequest[] = [];
    const renderer = await renderEditor({
      entry: battleEntry([setting('a', 3, 0), setting('b', 4, 1)]),
      maps: [catalogMap('a', 'Alpha'), catalogMap('b', 'Beta', { mapOrder: 1 })],
      presets: [preset(9, 'Raid Team')],
      onSave: async (request) => { saves.push(request); return saveResult.promise; },
      onBack: () => { backs += 1; },
    });
    const alphaHandle = renderer.root.findByProps({ accessibilityLabel: 'Alpha 1번째 맵 순서 이동' });
    const betaHandle = renderer.root.findByProps({ accessibilityLabel: 'Beta 2번째 맵 순서 이동' });
    const retainedMoveDown = () => alphaHandle.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    const retainedMoveUp = () => betaHandle.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    const retainedRemove = renderer.root.findByProps({ accessibilityLabel: 'Alpha 삭제' }).props.onPress as () => void;
    const retainedTargetChange = renderer.root.findByProps({ accessibilityLabel: 'Alpha 일일 목표' }).props.onChangeText as (value: string) => void;
    const retainedEnabledChange = renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 사용' }).props.onValueChange as (enabled: boolean) => void;
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 프리셋 선택 열기' }).props.onPress(); });
    const retainedPresetPress = renderer.root.findByProps({ accessibilityLabel: 'Raid Team 프리셋 선택' }).props.onPress as () => void;
    let pendingSave!: Promise<void>;

    await act(async () => {
      pendingSave = renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.onPress();
    });
    await act(async () => {
      retainedTargetChange('9');
      retainedEnabledChange(false);
      retainedPresetPress();
      retainedMoveDown();
      retainedMoveUp();
      retainedRemove();
    });

    assert.deepEqual(saves, [{ enabled: true, maps: [setting('a', 3, 0), setting('b', 4, 1)] }]);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Alpha 일일 목표' }).props.value, '3');
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 사용' }).props.value, true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Alpha 삭제' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Beta 삭제' }));

    await act(async () => {
      saveResult.resolve(true);
      await pendingSave;
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 뒤로' }).props.onPress(); });
    assert.equal(backs, 1);
    assert.equal(alertArguments, null);
  });

  it('fences a retained enabled catalog callback after external saving begins', async () => {
    const base = editorProps({ maps: [catalogMap('a', 'Alpha')] });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(BattleMapAutomationEditor, base)); });
    await openCatalogGroup(renderer);
    const retainedMapPress = renderer.root.findByProps({ accessibilityLabel: 'Alpha 맵 선택' }).props.onPress as () => void;

    await act(async () => { renderer.update(React.createElement(BattleMapAutomationEditor, { ...base, saving: true })); });
    await act(async () => { retainedMapPress(); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Alpha 일일 목표' }).length, 0);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Alpha 맵 선택' }).props.accessibilityState.selected, false);
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

  it('rejects pasted non-decimal target formats and saves trimmed leading-zero decimal input as an integer', async () => {
    const saves: UpdateBattleMapAutomationRequest[] = [];
    const renderer = await renderEditor({
      entry: battleEntry([setting('a', 3, 0)]), maps: [catalogMap('a', 'Alpha')],
      onSave: async (request) => { saves.push(request); return true; },
    });
    const input = () => renderer.root.findByProps({ accessibilityLabel: 'Alpha 일일 목표' });
    const save = () => renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' });

    for (const invalid of ['0x10', '1e3', '+2', '-2', '1.5', '', '9007199254740992', '2147483648']) {
      await act(async () => { input().props.onChangeText(invalid); });
      assert.equal(save().props.disabled, true, invalid);
    }
    await act(async () => { input().props.onChangeText(' 00042 '); });
    assert.equal(save().props.disabled, false);
    await act(async () => { await save().props.onPress(); });

    assert.equal(saves[0]?.maps[0]?.dailyTargetCount, 42);
  });

  it('shows neutral progress for empty, zero, and pasted invalid targets with existing successes', async () => {
    const renderer = await renderEditor({
      entry: battleEntry(
        [setting('a', 10, 0)],
        [{ categoryId: 'battle', mapCode: 'a', successfulRuns: 5 }],
      ),
      maps: [catalogMap('a', 'Alpha', { supportsThreeBattles: true })],
    });
    const input = renderer.root.findByProps({ accessibilityLabel: 'Alpha 일일 목표' });

    for (const invalid of ['', '0', '0x10', '2147483648']) {
      await act(async () => { input.props.onChangeText(invalid); });
      assert.equal(hasText(renderer.root, '오늘 5회 성공 · 목표 확인 필요 · 목표 확인 후 실행'), true, invalid);
      assert.equal(hasText(renderer.root, '오늘 목표 완료'), false, invalid);
      assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Alpha 오늘 진행률' }).length, 0, invalid);
      const card = renderer.root.findByProps({ accessibilityLabel: 'Alpha 프리셋 선택 열기' }).parent;
      assert.notEqual(flattenStyle(card?.props.style).borderColor, theme.colors.accentGreen, invalid);
    }
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
    assert.equal(hasText(renderer.root, '오늘 2/3 · 1회 남음 · 다음 1회 전투'), true);
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
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'a 삭제' }).props.disabled, true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 검색' }).props.editable, true);
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
    await openCatalogGroup(renderer);
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
    assert.equal(hasText(renderer.root, '오늘 2/4 · 2회 남음 · 다음 1회 전투'), true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Alpha Refreshed 일일 목표' }).props.value, '4');
  });

  it('repairs a deleted explicit preset and keeps a missing stored map labeled and removable', async () => {
    const broken = { ...setting('missing', 3, 0), presetMode: 'EXPLICIT' as const, partyPresetId: 99 };
    const renderer = await renderEditor({ entry: battleEntry([broken]), presets: [preset(7, 'Existing')] });
    assert.equal(hasText(renderer.root, 'missing'), true);
    assert.equal(hasText(renderer.root, '현재 맵 목록에 없음 · 오늘 0/3 · 3회 남음 · 다음 1회 전투'), true);
    assert.equal(hasText(renderer.root, '선택한 프리셋이 삭제되었습니다. 다른 프리셋을 선택해 주세요.'), true);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.disabled, true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'missing 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Existing 프리셋 선택' }).props.onPress(); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.disabled, false);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'missing 삭제' }).props.onPress(); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'missing 삭제' }).length, 0);
  });

  it('claims explicit preset deletion only after a successful empty verification', async () => {
    const presets = deferred<ReturnType<typeof preset>[]>();
    const explicit = { ...setting('a', 3, 0), presetMode: 'EXPLICIT' as const, partyPresetId: 99 };
    const renderer = await renderEditor({
      entry: battleEntry([explicit]),
      maps: [catalogMap('a', 'Alpha')],
      onListPartyPresets: () => presets.promise,
    });

    await act(async () => {
      presets.resolve([]);
      await presets.promise;
    });

    assert.equal(hasText(renderer.root, '삭제된 프리셋 #99'), true);
    assert.equal(hasText(renderer.root, '선택한 프리셋이 삭제되었습니다. 다른 프리셋을 선택해 주세요.'), true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 입력 오류' }));
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.disabled, true);
  });

  it('uses the library nested-scroll pair so selected-card gestures scroll the editor vertically', async () => {
    const renderer = await renderEditor({
      entry: battleEntry([setting('a', 3, 0)]),
      maps: [catalogMap('a', 'Alpha')],
    });

    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'NestableScrollContainer').length, 1);
    const nestedList = renderer.root.find((node) => (node.type as unknown) === 'NestableDraggableFlatList');
    assert.equal(nestedList.props.activationDistance, 20);
  });

  it('retries only an expanded failed category and leaves expansion operable while saving', async () => {
    const attempts: Record<string, number> = {};
    const renderer = await renderEditor({
      saving: true,
      battleCategories: [
        { id: 'battle', label: '전투맵', description: '', order: 0, enabled: true },
        { id: 'raid', label: '레이드', description: '', order: 1, enabled: true },
      ],
      onLoadBattleMaps: async (categoryId) => {
        attempts[categoryId] = (attempts[categoryId] ?? 0) + 1;
        if (categoryId === 'battle' && attempts[categoryId] === 1) throw new Error('전투맵 연결 실패');
        return [catalogMap(`${categoryId}-map`, categoryId === 'battle' ? '재시도 맵' : '레이드 맵', { categoryId })];
      },
    });

    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '전투맵 맵 다시 불러오기' }).length, 0);
    await openCatalogGroup(renderer);
    assert.equal(hasText(renderer.root, '전투맵 연결 실패'), true);
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투맵 맵 다시 불러오기' }).props.onPress(); });
    assert.deepEqual(attempts, { battle: 2, raid: 1 });
    await openCatalogGroup(renderer);
    const map = renderer.root.findByProps({ accessibilityLabel: '재시도 맵 맵 선택' });
    assert.equal(map.props.accessibilityState.disabled, true);
    await act(async () => { map.props.onPress(); });
    assert.equal(map.props.accessibilityState.selected, false);
    assert.equal(hasText(renderer.root, '선택됨'), false);
  });

  it('keeps saved execution order independent from catalog category and group display order', async () => {
    const saves: UpdateBattleMapAutomationRequest[] = [];
    const renderer = await renderEditor({
      entry: battleEntry([setting('later-group', 4, 0), setting('first-group', 5, 1)]),
      maps: [
        catalogMap('first-group', '가 맵', { groupName: '가 그룹', groupOrder: 0, mapOrder: 0 }),
        catalogMap('later-group', '나 맵', { groupName: '나 그룹', groupOrder: 1, mapOrder: 0 }),
      ],
      onSave: async (request) => { saves.push(request); return true; },
    });
    await openCatalogGroup(renderer, '전투맵', '가 그룹');
    await openCatalogGroup(renderer, '전투맵', '나 그룹');
    const mapLabels = renderer.root.findAll((node) => (
      (node.type as unknown) === 'Pressable'
      && node.props.accessibilityRole === 'button'
      && typeof node.props.accessibilityLabel === 'string'
      && node.props.accessibilityLabel.endsWith(' 맵 선택 해제')
    ))
      .map(({ props }) => props.accessibilityLabel);
    assert.deepEqual(mapLabels, ['가 맵 맵 선택 해제', '나 맵 맵 선택 해제']);

    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.onPress(); });
    assert.deepEqual(saves, [{ enabled: true, maps: [setting('later-group', 4, 0), setting('first-group', 5, 1)] }]);
  });

  it('shows authoritative search empty only after every eligible category settles successfully', async () => {
    const failed = await renderEditor({
      onLoadBattleMaps: async () => { throw new Error('맵 연결 실패'); },
    });
    await act(async () => { failed.root.findByProps({ accessibilityLabel: '전투 맵 검색' }).props.onChangeText('없는 맵'); });
    assert.equal(hasText(failed.root, '검색 가능한 맵이 없습니다.'), false);

    const settled = await renderEditor({ maps: [catalogMap('a', 'Alpha')] });
    await act(async () => { settled.root.findByProps({ accessibilityLabel: '전투 맵 검색' }).props.onChangeText('없는 맵'); });
    assert.equal(hasText(settled.root, '검색 가능한 맵이 없습니다.'), true);
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
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'stored 프리셋 선택 열기' }));
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '맵 카테고리 다시 불러오기' }).props.onPress(); });
    assert.equal(categoryRetries, 1);
  });

  it('does not load or offer adventure/union maps but keeps legacy rows and a dynamically unavailable supported map selectable', async () => {
    const loadedCategories: string[] = [];
    const legacyAdventure = { ...setting('legacy-adventure', 3, 0), categoryId: 'adventure_map' };
    const legacyUnion = { ...setting('legacy-union', 3, 1), categoryId: 'union' };
    const renderer = await renderEditor({
      entry: battleEntry([legacyAdventure, legacyUnion]),
      battleCategories: [
        { id: 'battle', label: '전투맵', description: '', order: 0, enabled: true },
        { id: 'adventure_map', label: '모험맵', description: '', order: 1, enabled: true },
        { id: 'union', label: '유니온', description: '', order: 2, enabled: true },
      ],
      onLoadBattleMaps: async (categoryId) => {
        loadedCategories.push(categoryId);
        if (categoryId === 'adventure_map') return [catalogMap('adventure-new', 'Adventure New', { categoryId })];
        if (categoryId === 'union') return [catalogMap('union-new', 'Union New', { categoryId })];
        return [catalogMap('limited', 'Limited Supported', {
          categoryId,
          availableCount: 0,
          attemptCount: 0,
          winCount: 0,
          cooldownRemainingSeconds: 3_600,
          keyMode: 'LIMITED',
          keyCount: 0,
        })];
      },
    });

    assert.deepEqual(loadedCategories, ['battle']);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Adventure New 맵 선택' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Union New 맵 선택' }).length, 0);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'legacy-adventure 삭제' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'legacy-union 삭제' }));
    await openCatalogGroup(renderer);
    const supported = renderer.root.findByProps({ accessibilityLabel: 'Limited Supported 맵 선택' });
    assert.equal(supported.props.disabled, false);
    await act(async () => { supported.props.onPress(); });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Limited Supported 맵 선택 해제' }).props.accessibilityState.selected, true);
  });

  it('keeps preset options out of every row and renders one shared searchable picker only after opening', async () => {
    const renderer = await renderEditor({
      entry: battleEntry([setting('a', 3, 0), setting('b', 3, 1)]),
      maps: [catalogMap('a', 'Alpha'), catalogMap('b', 'Beta')],
      presets: Array.from({ length: 100 }, (_, index) => preset(index + 1, `Preset ${index + 1}`)),
    });

    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Preset 100 프리셋 선택' }).length, 0);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'Modal').length, 0);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 프리셋 선택 열기' }).props.onPress(); });
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'Modal').length, 1);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '대표 프리셋 선택' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Preset 100 프리셋 선택' }));
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.onChangeText('100'); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Preset 1 프리셋 선택' }).length, 0);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Preset 100 프리셋 선택' }));

    await act(async () => {
      renderer.root.find((node) => (node.type as unknown) === 'Modal').props.onRequestClose();
    });
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'Modal').length, 0);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '프리셋 선택기 배경 닫기' }).props.onPress(); });
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'Modal').length, 0);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '프리셋 선택기 닫기' }).props.onPress(); });
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'Modal').length, 0);
  });

  it('moves focus into the preset modal and restores each live invoking row on every ordinary close path', async () => {
    accessibilityFocusCalls.length = 0;
    keyboardFocusCalls.length = 0;
    const renderer = await renderEditor({
      entry: battleEntry([setting('a', 3, 0), setting('b', 3, 1)]),
      maps: [catalogMap('a', 'Alpha'), catalogMap('b', 'Beta')],
      presets: [preset(7, 'Existing')],
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.find((node) => (node.type as unknown) === 'Modal').props.onShow(); });
    assert.equal(focusedRole(accessibilityFocusCalls.at(-1)), 'header');
    assert.equal(keyboardFocusCalls.at(-1), '프리셋 검색');
    await act(async () => { renderer.root.find((node) => (node.type as unknown) === 'Modal').props.onRequestClose(); });
    await act(async () => { await delay(280); });
    assert.equal(focusedLabel(accessibilityFocusCalls.at(-1)), 'Alpha 프리셋 선택 열기');

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '프리셋 선택기 배경 닫기' }).props.onPress(); });
    await act(async () => { await delay(280); });
    assert.equal(focusedLabel(accessibilityFocusCalls.at(-1)), 'Beta 프리셋 선택 열기');

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '프리셋 선택기 닫기' }).props.onPress(); });
    await act(async () => { await delay(280); });
    assert.equal(focusedLabel(accessibilityFocusCalls.at(-1)), 'Alpha 프리셋 선택 열기');

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Existing 프리셋 선택' }).props.onPress(); });
    await act(async () => { await delay(280); });
    assert.equal(focusedLabel(accessibilityFocusCalls.at(-1)), 'Beta 프리셋 선택 열기');
  });

  it('does not restore a stale preset trigger after its row is removed, the editor becomes busy, or it unmounts', async () => {
    accessibilityFocusCalls.length = 0;
    const base = editorProps({
      entry: battleEntry([setting('a', 3, 0), setting('b', 3, 1)]),
      maps: [catalogMap('a', 'Alpha'), catalogMap('b', 'Beta')],
      presets: [preset(7, 'Existing')],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(BattleMapAutomationEditor, base)); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 프리셋 선택 열기' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 삭제' }).props.onPress(); });
    await act(async () => { await delay(280); });
    assert.equal(accessibilityFocusCalls.some((node) => focusedLabel(node) === 'Alpha 프리셋 선택 열기'), false);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 프리셋 선택 열기' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { renderer.update(React.createElement(BattleMapAutomationEditor, { ...base, saving: true })); });
    await act(async () => { await delay(280); });
    assert.equal(accessibilityFocusCalls.some((node) => focusedLabel(node) === 'Beta 프리셋 선택 열기'), false);

    await act(async () => { renderer.update(React.createElement(BattleMapAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 프리셋 선택 열기' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { renderer.unmount(); });
    await act(async () => { await delay(280); });
    assert.equal(accessibilityFocusCalls.length, 0);
  });

  it('repairs a deleted preset through the shared picker and supports explicit and primary selections', async () => {
    const broken = { ...setting('a', 3, 0), presetMode: 'EXPLICIT' as const, partyPresetId: 99 };
    const renderer = await renderEditor({
      entry: battleEntry([broken]), maps: [catalogMap('a', 'Alpha')],
      presets: [preset(7, 'Raid Team'), preset(8, 'Support Team')],
    });

    assert.equal(hasText(renderer.root, '삭제된 프리셋 #99'), true);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.onChangeText('support'); });
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Raid Team 프리셋 선택' }).length, 0);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Support Team 프리셋 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, 'Support Team'), true);
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'Modal').length, 0);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '대표 프리셋 선택' }).props.onPress(); });
    assert.equal(hasText(renderer.root, '대표 프리셋 없음'), true);
  });

  it('closes the shared picker when its row is removed or the editor becomes busy', async () => {
    const base = editorProps({
      entry: battleEntry([setting('a', 3, 0), setting('b', 3, 1)]),
      maps: [catalogMap('a', 'Alpha'), catalogMap('b', 'Beta')], presets: [preset(7, 'Existing')],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(BattleMapAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 삭제' }).props.onPress(); });
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'Modal').length, 0);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.update(React.createElement(BattleMapAutomationEditor, { ...base, saving: true })); });
    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'Modal').length, 0);
    await act(async () => { renderer.unmount(); });
  });

  it('announces validation errors assertively and server-refresh warnings politely as alerts', async () => {
    const base = editorProps({ entry: battleEntry([setting('a', 3, 0)]), maps: [catalogMap('a', 'Alpha')] });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(BattleMapAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Alpha 일일 목표' }).props.onChangeText('0x10'); });
    const validation = renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 입력 오류' });
    assert.equal(validation.props.accessibilityRole, 'alert');
    assert.equal(validation.props.accessibilityLiveRegion, 'assertive');

    await act(async () => {
      renderer.update(React.createElement(BattleMapAutomationEditor, {
        ...base,
        entry: battleEntry([setting('a', 9, 0)]),
      }));
    });
    const refresh = renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 서버 갱신 알림' });
    assert.equal(refresh.props.accessibilityRole, 'alert');
    assert.equal(refresh.props.accessibilityLiveRegion, 'polite');
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
function textCount(root: ReactTestInstance, text: string): number {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length;
}
function findTextNode(root: ReactTestInstance, text: string): ReactTestInstance {
  return root.find((node) => (node.type as unknown) === 'Text' && node.children.join('') === text);
}
function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (flattened, entry) => ({ ...flattened, ...flattenStyle(entry) }),
      {},
    );
  }
  return style != null && typeof style === 'object' ? style as Record<string, unknown> : {};
}
function focusedLabel(node: unknown): unknown {
  return node && typeof node === 'object'
    ? (node as { accessibilityLabel?: unknown }).accessibilityLabel
    : undefined;
}
function focusedRole(node: unknown): unknown {
  return node && typeof node === 'object'
    ? (node as { accessibilityRole?: unknown }).accessibilityRole
    : undefined;
}
function battleEntry(battleMaps = [] as TypedAutomationEntryResponse['battleMaps'], battleMapProgress: NonNullable<TypedAutomationEntryResponse['battleMapProgress']> = []): TypedAutomationEntryResponse {
  return { id: 14, type: 'BATTLE_MAP', enabled: true, priority: 0, ready: true, warnings: [], quests: [], battleMaps, battleMapProgress, adventureMaps: [] };
}
function setting(mapCode: string, dailyTargetCount: number, executionOrder: number) {
  return { categoryId: 'battle', mapCode, dailyTargetCount, executionOrder, presetMode: 'PRIMARY' as const, partyPresetId: null };
}
function catalogMap(mapCode: string, name: string, overrides: Partial<BattleMapResponse> = {}): BattleMapResponse {
  return { categoryId: 'battle', mapCode, name, groupName: '기타', groupOrder: 0, mapOrder: 0, recommendedLevel: null, availableCount: null, attemptCount: null, winCount: null, cooldownRemainingText: null, cooldownRemainingSeconds: null, keyMode: 'NOT_REQUIRED', keyCount: null, requiredTime: null, enabled: true, resolved: true, iconUrl: null, rawHref: '', ...overrides, supportsThreeBattles: overrides.supportsThreeBattles ?? false };
}
async function openCatalogGroup(renderer: ReactTestRenderer, categoryLabel = '전투맵', groupName = '기타'): Promise<void> {
  const category = renderer.root.findAllByProps({ accessibilityLabel: `${categoryLabel} 카테고리 열기` })[0];
  if (category) await act(async () => { category.props.onPress(); });
  const group = renderer.root.findAllByProps({ accessibilityLabel: `${groupName} 그룹 열기` })[0];
  if (group) await act(async () => { group.props.onPress(); });
}
function preset(id: number, name: string) { return { id, accountId: 1, name, displayOrder: id, isPrimary: false, members: [], createdAt: '', updatedAt: '' }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, reject, resolve };
}
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
