import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { theme } from '../../main/styles/theme';
import type {
  AdventureMapSettingResponse,
  BattleMapResponse,
  PartyPresetResponse,
  TypedAutomationEntryResponse,
  UpdateAdventureMapAutomationRequest,
} from '../../main/types/api';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  const nodeRef = React.useRef<Record<string, unknown>>({});
  Object.assign(nodeRef.current, props);
  React.useImperativeHandle(ref, () => nodeRef.current, []);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const flatList = React.forwardRef<Record<string, unknown>, Record<string, unknown>>((props, ref) => {
  const nodeRef = React.useRef<Record<string, unknown>>({});
  Object.assign(nodeRef.current, props);
  React.useImperativeHandle(ref, () => nodeRef.current, []);
  return React.createElement(
    'FlatList',
    props,
    (props.data as unknown[]).map((item, index) => React.createElement(
      React.Fragment,
      { key: (props.keyExtractor as (value: unknown, index: number) => string)(item, index) },
      (props.renderItem as (value: { item: unknown; index: number }) => React.ReactNode)({ item, index }),
    )),
  );
});
const dragCalls: unknown[] = [];
const draggableFlatList = (props: Record<string, unknown>) => React.createElement(
  'DraggableFlatList',
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
const nestableDraggableFlatList = (props: Record<string, unknown>) => React.createElement(
  'NestableDraggableFlatList',
  props,
  draggableFlatList(props).props.children as React.ReactNode,
);
const nestableScrollContainer = (props: Record<string, unknown>) => React.createElement(
  'NestableScrollContainer',
  props,
  props.children as React.ReactNode,
);
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
let alertArguments: unknown[] | null = null;
const accessibilityFocusCalls: unknown[] = [];
const reactNativeMock = {
  AccessibilityInfo: {
    setAccessibilityFocus: (node: unknown) => { accessibilityFocusCalls.push(node); },
  },
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: (...args: unknown[]) => { alertArguments = args; } },
  findNodeHandle: (node: unknown) => node,
  FlatList: flatList,
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Modal: host('Modal'),
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
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }) };
  if (request === 'lucide-react-native') return iconsMock;
  if (request === 'react-native-draggable-flatlist') return {
    __esModule: true,
    default: draggableFlatList,
    NestableDraggableFlatList: nestableDraggableFlatList,
    NestableScrollContainer: nestableScrollContainer,
  };
  if (request === 'react-native-gesture-handler') return { FlatList: flatList };
  if (request === 'react-native-gesture-handler/ReanimatedSwipeable') {
    return { __esModule: true, default: reanimatedSwipeable };
  }
  return originalLoad(request, parent, isMain);
};
const { AdventureMapAutomationEditor } = require(
  '../../main/features/automation/components/AdventureMapAutomationEditor',
) as typeof import('../../main/features/automation/components/AdventureMapAutomationEditor');
const {
  AdventureMapCatalogGroupRow,
  AdventureMapCatalogMapRow,
} = require(
  '../../main/features/automation/components/AdventureMapCatalogRows',
) as typeof import('../../main/features/automation/components/AdventureMapCatalogRows');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AdventureMapAutomationEditor', () => {
  it('uses the library nested-scroll pair and preserves its parent-scroll activation threshold', async () => {
    const renderer = await renderEditor({
      entry: entry([setting('first', 0, 'PRIMARY', null)]),
      maps: [map('first', '첫 맵')],
    });

    assert.equal(renderer.root.findAll((node) => (node.type as unknown) === 'NestableScrollContainer').length, 1);
    const nestedList = renderer.root.find((node) => (node.type as unknown) === 'NestableDraggableFlatList');
    assert.equal(nestedList.props.activationDistance, 20);
  });

  it('separates selected maps from the grouped catalog and omits whole deletion', async () => {
    const renderer = await renderEditor({
      entry: entry([setting('a', 0, 'PRIMARY', null)]),
      maps: [map('a', 'Alpha'), map('b', 'Beta')],
    });

    assert.ok(findPressable(renderer.root, '선택 맵 1개 탭'));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Alpha 1번째 맵 순서 이동' }));
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '모험맵 검색' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '모험맵 자동화 삭제' }).length, 0);

    await act(async () => { findPressable(renderer.root, '맵 추가 탭').props.onPress(); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '모험맵 검색' }));
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Alpha 1번째 맵 순서 이동' }).length, 0);

    await openAdventureGroup(renderer, '기타');
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Beta 모험맵 선택' }).props.onPress(); });
    assert.ok(findPressable(renderer.root, '선택 맵 2개 탭'));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Beta 모험맵 선택 해제' }));
  });

  it('mounts compact full-card catalog rows with selected button semantics', async () => {
    const catalogMap = { ...map('compact', '긴 모험맵 이름', {
      groupName: '이벤트',
      recommendedLevel: '40-60',
      keyMode: 'LIMITED',
      keyCount: 3,
    }), mapCode: 'compact' };
    const group = { key: 'group:event', name: '이벤트', groupOrder: 0, recommendedLevel: '40-60', maps: [catalogMap] };
    let presses = 0;

    function CatalogRowsHarness() {
      const [selected, setSelected] = React.useState(false);
      return React.createElement(React.Fragment, null,
        React.createElement(AdventureMapCatalogGroupRow, { group, expanded: true, onPress: () => undefined }),
        React.createElement(AdventureMapCatalogMapRow, {
          map: catalogMap,
          selected,
          disabled: false,
          onPress: () => { presses += 1; setSelected(true); },
        }),
      );
    }

    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(CatalogRowsHarness)); });

    const groupButton = renderer.root.findByProps({ accessibilityLabel: '이벤트 그룹 닫기' });
    const groupStyle = flattenStyle(groupButton.props.style);
    assert.equal(groupStyle.minHeight, 52);
    assert.equal(groupStyle.paddingHorizontal, 12);
    assert.equal(groupStyle.paddingVertical, 6);

    const mapButton = renderer.root.findByProps({ accessibilityLabel: '긴 모험맵 이름 모험맵 선택' });
    assert.equal(mapButton.props.accessibilityRole, 'button');
    assert.deepEqual(mapButton.props.accessibilityState, { disabled: false, selected: false });
    const mapStyle = flattenStyle(mapButton.props.style);
    assert.equal(mapStyle.minHeight, 48);
    assert.equal(mapStyle.paddingHorizontal, 12);
    assert.equal(mapStyle.paddingVertical, 8);
    assert.equal(findTextNode(renderer.root, '긴 모험맵 이름').props.numberOfLines, 2);
    const mapHeading = mapButton.find((node) => flattenStyle(node.props.style).justifyContent === 'space-between');
    assert.equal(flattenStyle(mapHeading.props.style).gap, 4);
    assert.equal(hasText(renderer.root, '선택됨'), false);
    assert.equal(mapButton.findAll((node) => node.props.accessibilityRole === 'checkbox').length, 0);
    assert.equal(hasText(mapButton, '40-60 · 키 3개'), true);

    await act(async () => { mapButton.props.onPress(); });
    assert.equal(presses, 1);
    const selectedMapButton = renderer.root.findByProps({ accessibilityLabel: '긴 모험맵 이름 모험맵 선택 해제' });
    assert.equal(selectedMapButton.props.accessibilityRole, 'button');
    assert.deepEqual(selectedMapButton.props.accessibilityState, { disabled: false, selected: true });
    assert.equal(hasText(selectedMapButton, '선택한 맵'), true);
    const selectedStyle = flattenStyle(selectedMapButton.props.style);
    assert.notEqual(selectedStyle.backgroundColor, theme.colors.accentGreen);
    assert.equal(selectedStyle.borderColor, theme.colors.accentGreen);
    assert.equal(selectedStyle.borderLeftWidth, 3);
  });

  it('mounts one compact selected-card metadata and preset row without placeholders', async () => {
    const renderer = await renderEditor({
      entry: entry([setting('compact', 0, 'PRIMARY', null)]),
      maps: [map('compact', '압축 모험', {
        groupName: '수정 동굴',
        keyMode: 'LIMITED',
        keyCount: 114,
        availableCount: 3,
      })],
      partyPresetCatalog: presetCatalog([preset(7, '대표 프리셋', true)]),
    });

    const presetChoice = renderer.root.findByProps({ accessibilityLabel: '압축 모험 프리셋 선택 열기' });
    assert.equal(flattenStyle(presetChoice.props.style).minHeight, 32);
    assert.equal(hasText(renderer.root, '압축 모험'), true);
    const selectedCard = presetChoice.parent!;
    const summary = findTextNode(selectedCard, '수정 동굴 · 실행 가능 · 키 114개 · 가능 3회');
    assert.equal(summary.props.numberOfLines, 1);
    assert.equal(summary.props.ellipsizeMode, 'tail');
    assert.equal(hasText(renderer.root, '관측 잔여'), false);
    assert.equal(hasText(renderer.root, '제한 없음'), false);
    assert.equal(hasText(renderer.root, '쿨다운 없음'), false);
    assert.equal(hasText(renderer.root, '현재 프리셋'), false);
    assert.equal(hasText(renderer.root, '프리셋 변경'), false);
    assert.equal(hasText(presetChoice, '프리셋'), true);
    assert.equal(textCount(presetChoice, '대표 · 대표 프리셋'), 1);
    assert.equal(presetChoice.findAll((node) => (node.type as unknown) === 'ChevronRight').length, 1);

    const list = renderer.root.find((node) => (node.type as unknown) === 'NestableScrollContainer');
    assert.equal(flattenStyle(list.props.contentContainerStyle).gap, 6);
  });

  it('uses one-line B-layout metadata with a drag handle and swipe delete', async () => {
    const renderer = await renderEditor({
      entry: entry([
        setting('first', 0, 'PRIMARY', null),
        setting('second', 1, 'PRIMARY', null),
      ]),
      maps: [
        map('first', '첫 맵', { groupName: '수정 동굴', keyMode: 'LIMITED', keyCount: 2 }),
        map('second', '둘째 맵', { groupName: '수정 동굴', keyMode: 'NOT_REQUIRED' }),
      ],
    });

    const firstHandle = renderer.root.findByProps({ accessibilityLabel: '첫 맵 1번째 맵 순서 이동' });
    const secondHandle = renderer.root.findByProps({ accessibilityLabel: '둘째 맵 2번째 맵 순서 이동' });
    assert.equal(firstHandle.props.accessibilityRole, 'adjustable');
    assert.deepEqual(firstHandle.props.accessibilityActions.map(({ name }: { name: string }) => name), ['increment', 'delete']);
    assert.deepEqual(secondHandle.props.accessibilityActions.map(({ name }: { name: string }) => name), ['decrement', 'delete']);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '첫 맵 아래로' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '둘째 맵 위로' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '첫 맵 제거' }).length, 0);
    const summary = findTextNode(renderer.root, '수정 동굴 · 실행 가능 · 키 2개');
    assert.equal(summary.props.numberOfLines, 1);
    assert.equal(summary.props.ellipsizeMode, 'tail');
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '첫 맵 삭제' }));
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '모험맵 자동화 삭제' }).length, 0);
  });

  it('saves the identity order produced by a selected-map drag', async () => {
    dragCalls.length = 0;
    const saves: UpdateAdventureMapAutomationRequest[] = [];
    const renderer = await renderEditor({
      entry: entry([
        setting('first', 0, 'PRIMARY', null),
        setting('second', 1, 'PRIMARY', null),
      ]),
      maps: [map('first', '첫 맵'), map('second', '둘째 맵')],
      onSave: async (request) => { saves.push(request); return true; },
    });
    const draggable = renderer.root.find((node) => (node.type as unknown) === 'NestableDraggableFlatList');
    const rows = draggable.props.data as unknown[];

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '첫 맵 1번째 맵 순서 이동' }).props.onLongPress();
      draggable.props.onDragEnd({ data: [...rows].reverse(), from: 0, to: 1 });
    });
    await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 저장' }).props.onPress(); });

    assert.deepEqual(saves[0]?.maps.map(({ mapCode, executionOrder }) => [mapCode, executionOrder]), [
      ['second', 0],
      ['first', 1],
    ]);
  });

  it('keeps every execution constraint in the ellipsized one-line summary', async () => {
    const longGroup = '아주 길어서 한 줄에서 잘려야 하는 모험맵 그룹 이름';
    const renderer = await renderEditor({
      entry: entry([setting('dense', 0, 'PRIMARY', null)]),
      maps: [map('dense', '제약 모험', {
        groupName: longGroup,
        keyMode: 'LIMITED',
        keyCount: 114,
        availableCount: 4,
        attemptCount: 2,
        winCount: 1,
      })],
    });

    const selectedCard = renderer.root.findByProps({ accessibilityLabel: '제약 모험 프리셋 선택 열기' }).parent!;
    const summary = findTextNode(selectedCard, `${longGroup} · 실행 가능 · 키 114개 · 가능 4회 · 도전 2회 · 승리 1회`);
    assert.equal(summary.props.numberOfLines, 1);
    assert.equal(summary.props.ellipsizeMode, 'tail');
  });

  it('does not claim no extra conditions for an unobserved stored map', async () => {
    const renderer = await renderEditor({
      entry: entry([
        setting('missing', 0, 'PRIMARY', null),
        setting('open', 1, 'PRIMARY', null),
      ]),
      maps: [map('open', '관측된 맵', { keyMode: 'NOT_REQUIRED' })],
    });

    const missingCard = renderer.root.findByProps({ accessibilityLabel: 'missing 프리셋 선택 열기' }).parent!;
    assert.equal(hasText(missingCard, '현재 상태 확인 불가'), true);
    assert.equal(hasText(missingCard, '추가 조건 없음'), false);
    const observedCard = renderer.root.findByProps({ accessibilityLabel: '관측된 맵 프리셋 선택 열기' }).parent!;
    assert.equal(hasText(observedCard, '반복 실행 · 추가 조건 없음'), true);
  });

  it('shows observed unavailable state without disabling selection and saves ordered typed settings', async () => {
    const saves: UpdateAdventureMapAutomationRequest[] = [];
    const renderer = await renderEditor({
      maps: [
        map('cooldown', '쿨다운 맵', { cooldownRemainingSeconds: 60, cooldownRemainingText: '1분', enabled: false }),
        map('free', '무제한 맵', { keyMode: 'UNLIMITED' }),
      ],
      onSave: async (request) => { saves.push(request); return true; },
    });

    const lists = renderer.root.findAll((node) => (node.type as unknown) === 'NestableScrollContainer');
    assert.equal(lists.length, 1);
    assert.equal(flattenStyle(lists[0]!.props.contentContainerStyle).gap, 6);
    assert.equal(hasText(renderer.root, '오늘 초기화 완료 · 오전 12:03'), true);
    await openAdventureGroup(renderer, '기타');
    const cooldown = renderer.root.findByProps({ accessibilityLabel: '쿨다운 맵 모험맵 선택' });
    assert.equal(cooldown.props.disabled, false);
    await act(async () => { cooldown.props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '무제한 맵 모험맵 선택' }).props.onPress(); });
    await openSelectedTab(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '무제한 맵 2번째 맵 순서 이동' })
        .props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    });
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
      partyPresetCatalog: presetCatalog(before),
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });

    assert.equal(hasText(renderer.root, '대표 · 기존 대표'), true);
    assert.equal(hasText(renderer.root, '고정 파티'), true);

    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        partyPresetCatalog: presetCatalog(after),
      }));
    });

    assert.equal(hasText(renderer.root, '대표 · 새 대표'), true);
    assert.equal(hasText(renderer.root, '고정 파티'), true);
    assert.equal(hasText(renderer.root, '대표 · 기존 대표'), false);
  });

  it('fences older map and preset responses when loaders change', async () => {
    const oldMaps = deferred<BattleMapResponse[]>();
    const newMaps = deferred<BattleMapResponse[]>();
    const base = editorProps({
      onLoadBattleMaps: () => oldMaps.promise,
      partyPresetCatalog: presetCatalog([preset(7, '이전 대표', true)]),
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });
    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        onLoadBattleMaps: () => newMaps.promise,
        partyPresetCatalog: presetCatalog([preset(8, '최신 대표', true)]),
      }));
    });
    await act(async () => {
      newMaps.resolve([map('new', '최신 맵')]);
      await newMaps.promise;
    });
    await act(async () => {
      oldMaps.resolve([map('old', '이전 맵')]);
      await oldMaps.promise;
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

    await openCatalogTab(renderer);
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
    assert.equal(late.props.accessibilityRole, 'button');
    assert.deepEqual(late.props.accessibilityState, { disabled: false, selected: false });
    assert.equal(late.findAll((node) => ['Checkbox', 'Square', 'CheckSquare', 'Image'].includes(String(node.type))).length, 0);
    assert.equal(hasText(late, '횟수 제한 없음 · 반복 실행'), true);
    assert.equal(hasText(late, '40-60'), true);
    assert.equal(hasText(late, '앞 순서에 있으면 계속 반복될 수 있습니다.'), false);

    await act(async () => { late.props.onPress(); });
    late = renderer.root.findByProps({ accessibilityLabel: '후순위 맵 모험맵 선택 해제' });
    assert.equal(late.props.accessibilityState.selected, true);
    assert.equal(hasText(late, '선택됨'), false);
    await act(async () => { early.props.onPress(); });
    early = renderer.root.findByProps({ accessibilityLabel: '선순위 맵 모험맵 선택 해제' });
    assert.equal(early.props.accessibilityState.selected, true);
    assert.equal(hasText(early, '선택됨'), false);

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
    assert.equal(renderer.root.findAll((node) => (
      (node.type as unknown) === 'TextInput'
      && node.props.accessibilityLabel === '모험맵 검색'
    )).length, 1);
    const scrollContent = renderer.root.find((node) => (node.type as unknown) === 'NestableScrollContainer');
    assert.equal(scrollContent.findAll((node) => (
      (node.type as unknown) === 'TextInput'
      && node.props.accessibilityLabel === '모험맵 검색'
    )).length, 0);

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
      partyPresetCatalog: presetCatalog([preset(9, '고정 파티', false)]),
      onSave: async (request) => { saves.push(request); return pending.promise; },
      onBack: () => { backs += 1; },
    });
    const retainedFirstAction = renderer.root.findByProps({ accessibilityLabel: '첫 맵 1번째 맵 순서 이동' })
      .props.onAccessibilityAction as (event: { nativeEvent: { actionName: string } }) => void;
    const retainedSecondAction = renderer.root.findByProps({ accessibilityLabel: '둘째 맵 2번째 맵 순서 이동' })
      .props.onAccessibilityAction as (event: { nativeEvent: { actionName: string } }) => void;
    const retainedRemove = renderer.root.findByProps({ accessibilityLabel: '첫 맵 삭제' }).props.onPress as () => void;
    const retainedEnabled = renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 사용' }).props.onValueChange as (value: boolean) => void;
    await openAdventureGroup(renderer, '그룹');
    const retainedCatalog = renderer.root.findByProps({ accessibilityLabel: '셋째 맵 모험맵 선택' }).props.onPress as () => void;
    await openSelectedTab(renderer);
    const retainedOpen = renderer.root.findByProps({ accessibilityLabel: '첫 맵 프리셋 선택 열기' }).props.onPress as () => void;
    await act(async () => { retainedOpen(); });
    const retainedPreset = renderer.root.findByProps({ accessibilityLabel: '고정 파티 프리셋 선택' }).props.onPress as () => void;
    let saving!: Promise<void>;
    const selectedOrder = () => renderer.root.findAll((node) => (
      (node.type as unknown) === 'Pressable'
      && (node.props.accessibilityLabel === '첫 맵 삭제'
        || node.props.accessibilityLabel === '둘째 맵 삭제')
    )).map((node) => node.props.accessibilityLabel);

    await act(async () => { saving = renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 저장' }).props.onPress(); });
    await act(async () => { retainedFirstAction({ nativeEvent: { actionName: 'increment' } }); });
    assert.deepEqual(selectedOrder(), ['첫 맵 삭제', '둘째 맵 삭제']);
    await act(async () => { retainedSecondAction({ nativeEvent: { actionName: 'decrement' } }); });
    assert.deepEqual(selectedOrder(), ['첫 맵 삭제', '둘째 맵 삭제']);
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
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '첫 맵 삭제' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '둘째 맵 삭제' }));
    await openCatalogTab(renderer);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '셋째 맵 모험맵 선택' }).props.accessibilityState.selected, false);

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
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '서버 맵 삭제' }));

    await act(async () => { pending.resolve(true); await saving; });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 뒤로' }).props.onPress(); });
    assert.equal(alertArguments?.[0], '변경 사항을 버릴까요?');
  });

  it('reconciles the latest pending server entry after local edits return to the old baseline', async () => {
    alertArguments = null;
    let backs = 0;
    const base = editorProps({
      entry: entry([setting('first', 0, 'PRIMARY', null)]),
      onBack: () => { backs += 1; },
      onLoadBattleMaps: async () => [map('first', '첫 맵'), map('server', '서버 맵')],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 사용' }).props.onValueChange(false); });
    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        entry: entry([setting('server', 0, 'PRIMARY', null)]),
      }));
    });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 사용' }).props.value, false);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '첫 맵 삭제' }));

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 사용' }).props.onValueChange(true); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '서버 맵 삭제' }));
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '첫 맵 삭제' }).length, 0);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 뒤로' }).props.onPress(); });
    assert.equal(backs, 1);
    assert.equal(alertArguments, null);
  });

  it('ignores a retained move callback after selected map reconciliation', async () => {
    const base = editorProps({
      entry: entry([
        setting('first', 0, 'PRIMARY', null),
        setting('second', 1, 'PRIMARY', null),
      ]),
      onLoadBattleMaps: async () => [
        map('first', '첫 맵'),
        map('second', '둘째 맵'),
        map('server', '서버 맵'),
      ],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });
    const retainedMoveDown = renderer.root.findByProps({ accessibilityLabel: '첫 맵 1번째 맵 순서 이동' })
      .props.onAccessibilityAction as (event: { nativeEvent: { actionName: string } }) => void;

    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        entry: entry([
          setting('server', 0, 'PRIMARY', null),
          setting('first', 1, 'PRIMARY', null),
        ]),
      }));
    });
    assert.deepEqual(selectedMapRemovalOrder(renderer), ['서버 맵 삭제', '첫 맵 삭제']);

    await act(async () => { retainedMoveDown({ nativeEvent: { actionName: 'increment' } }); });
    assert.deepEqual(selectedMapRemovalOrder(renderer), ['서버 맵 삭제', '첫 맵 삭제']);
  });

  it('ignores a retained remove callback after its selected map is reconciled away', async () => {
    const base = editorProps({
      entry: entry([
        setting('first', 0, 'PRIMARY', null),
        setting('second', 1, 'PRIMARY', null),
      ]),
      onLoadBattleMaps: async () => [
        map('first', '첫 맵'),
        map('second', '둘째 맵'),
        map('server', '서버 맵'),
      ],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });
    const retainedRemove = renderer.root.findByProps({ accessibilityLabel: '첫 맵 삭제' }).props.onPress as () => void;

    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        entry: entry([setting('server', 0, 'PRIMARY', null)]),
      }));
    });
    assert.deepEqual(selectedMapRemovalOrder(renderer), ['서버 맵 삭제']);

    await act(async () => { retainedRemove(); });
    assert.deepEqual(selectedMapRemovalOrder(renderer), ['서버 맵 삭제']);
  });

  it('fences select and close callbacks retained from an older preset picker session', async () => {
    const renderer = await renderEditor({
      entry: entry([
        setting('first', 0, 'PRIMARY', null),
        setting('second', 1, 'PRIMARY', null),
      ]),
      maps: [map('first', '첫 맵'), map('second', '둘째 맵')],
      partyPresetCatalog: presetCatalog([preset(9, '고정 파티', false)]),
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '첫 맵 프리셋 선택 열기' }).props.onPress(); });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '공유 폴더 폴더, 프리셋 0개, 열기' }));
    const retainedSelectA = renderer.root.findByProps({ accessibilityLabel: '고정 파티 프리셋 선택' }).props.onPress as () => void;
    const retainedCloseA = renderer.root.findByProps({ accessibilityLabel: '프리셋 선택기 닫기' }).props.onPress as () => void;
    await act(async () => { retainedCloseA(); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '둘째 맵 프리셋 선택 열기' }).props.onPress(); });
    const currentSelectB = renderer.root.findByProps({ accessibilityLabel: '고정 파티 프리셋 선택' }).props.onPress as () => void;
    await act(async () => {
      retainedSelectA();
      retainedCloseA();
    });

    assert.equal(hasText(renderer.root.findByProps({ accessibilityLabel: '파티 프리셋 선택기' }), '둘째 맵'), true);
    assert.equal(hasText(renderer.root.findByProps({ accessibilityLabel: '파티 프리셋 선택기' }), '둘째 맵 프리셋 선택'), false);
    assert.deepEqual(renderer.root.findByProps({ accessibilityLabel: '첫 맵 프리셋 선택 열기' }).props.accessibilityValue, { text: '대표 프리셋 없음' });
    await act(async () => { currentSelectB(); });
    assert.deepEqual(renderer.root.findByProps({ accessibilityLabel: '둘째 맵 프리셋 선택 열기' }).props.accessibilityValue, { text: '고정 파티' });
    assert.equal(renderer.root.findByType('Modal' as unknown as React.ElementType).props.visible, false);
  });

  it('does not let a retained preset-open callback replace the active picker session', async () => {
    const renderer = await renderEditor({
      entry: entry([
        setting('first', 0, 'PRIMARY', null),
        setting('second', 1, 'PRIMARY', null),
      ]),
      maps: [map('first', '첫 맵'), map('second', '둘째 맵')],
      partyPresetCatalog: presetCatalog([preset(9, '고정 파티', false)]),
    });
    const retainedOpenA = renderer.root.findByProps({ accessibilityLabel: '첫 맵 프리셋 선택 열기' }).props.onPress as () => void;
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '둘째 맵 프리셋 선택 열기' }).props.onPress(); });
    const currentSelectB = renderer.root.findByProps({ accessibilityLabel: '고정 파티 프리셋 선택' }).props.onPress as () => void;

    await act(async () => { retainedOpenA(); });
    assert.equal(hasText(renderer.root.findByProps({ accessibilityLabel: '파티 프리셋 선택기' }), '둘째 맵'), true);
    await act(async () => { currentSelectB(); });
    assert.deepEqual(renderer.root.findByProps({ accessibilityLabel: '둘째 맵 프리셋 선택 열기' }).props.accessibilityValue, { text: '고정 파티' });
    assert.deepEqual(renderer.root.findByProps({ accessibilityLabel: '첫 맵 프리셋 선택 열기' }).props.accessibilityValue, { text: '대표 프리셋 없음' });

    await act(async () => { retainedOpenA(); });
    assert.equal(hasText(renderer.root.findByProps({ accessibilityLabel: '파티 프리셋 선택기' }), '첫 맵'), true);
  });

  it('restores accessibility focus to each live preset trigger after every ordinary close path', async () => {
    accessibilityFocusCalls.length = 0;
    const renderer = await renderEditor({
      entry: entry([
        setting('first', 0, 'PRIMARY', null),
        setting('second', 1, 'PRIMARY', null),
      ]),
      maps: [map('first', '첫 맵'), map('second', '둘째 맵')],
      partyPresetCatalog: presetCatalog([preset(9, '고정 파티', false)]),
    });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '첫 맵 프리셋 선택 열기' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { renderer.root.findByType('Modal' as unknown as React.ElementType).props.onRequestClose(); });
    await act(async () => { await delay(280); });
    assert.equal(focusedLabel(accessibilityFocusCalls.at(-1)), '첫 맵 프리셋 선택 열기');

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '둘째 맵 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '프리셋 선택기 배경 닫기' }).props.onPress(); });
    await act(async () => { await delay(280); });
    assert.equal(focusedLabel(accessibilityFocusCalls.at(-1)), '둘째 맵 프리셋 선택 열기');

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '첫 맵 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '프리셋 선택기 닫기' }).props.onPress(); });
    await act(async () => { await delay(280); });
    assert.equal(focusedLabel(accessibilityFocusCalls.at(-1)), '첫 맵 프리셋 선택 열기');

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '둘째 맵 프리셋 선택 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '고정 파티 프리셋 선택' }).props.onPress(); });
    await act(async () => { await delay(280); });
    assert.equal(focusedLabel(accessibilityFocusCalls.at(-1)), '둘째 맵 프리셋 선택 열기');
  });

  it('does not restore stale adventure preset focus after row removal, busy state, or unmount', async () => {
    accessibilityFocusCalls.length = 0;
    const base = editorProps({
      entry: entry([
        setting('first', 0, 'PRIMARY', null),
        setting('second', 1, 'PRIMARY', null),
      ]),
      onLoadBattleMaps: async () => [map('first', '첫 맵'), map('second', '둘째 맵')],
      partyPresetCatalog: presetCatalog([preset(9, '고정 파티', false)]),
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(AdventureMapAutomationEditor, base)); });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '첫 맵 프리셋 선택 열기' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '첫 맵 삭제' }).props.onPress(); });
    await act(async () => { await delay(280); });
    assert.equal(accessibilityFocusCalls.some((node) => focusedLabel(node) === '첫 맵 프리셋 선택 열기'), false);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '둘째 맵 프리셋 선택 열기' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { renderer.update(React.createElement(AdventureMapAutomationEditor, { ...base, saving: true })); });
    await act(async () => { await delay(280); });
    assert.equal(accessibilityFocusCalls.some((node) => focusedLabel(node) === '둘째 맵 프리셋 선택 열기'), false);

    await act(async () => { renderer.update(React.createElement(AdventureMapAutomationEditor, base)); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '둘째 맵 프리셋 선택 열기' }).props.onPress(); });
    accessibilityFocusCalls.length = 0;
    await act(async () => { renderer.unmount(); });
    await act(async () => { await delay(280); });
    assert.equal(accessibilityFocusCalls.length, 0);
  });

  it('uses live dirty state when a Back callback retained from a clean render is invoked', async () => {
    alertArguments = null;
    let backs = 0;
    const renderer = await renderEditor({ onBack: () => { backs += 1; } });
    const retainedBack = renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 뒤로' }).props.onPress as () => void;

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 사용' }).props.onValueChange(false); });
    await act(async () => { retainedBack(); });

    assert.equal(backs, 0);
    assert.equal(alertArguments?.[0], '변경 사항을 버릴까요?');
  });

  it('fences retained back callbacks and an open dirty-back action while saving', async () => {
    alertArguments = null;
    const pending = deferred<boolean>();
    let backs = 0;
    const renderer = await renderEditor({
      onBack: () => { backs += 1; },
      onSave: async () => pending.promise,
    });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 사용' }).props.onValueChange(false); });
    const retainedBack = renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 뒤로' }).props.onPress as () => void;
    await act(async () => { retainedBack(); });
    const openAlert = alertArguments;
    const buttons = openAlert?.[2] as unknown as Array<{ text: string; onPress?: () => void }>;
    const discard = buttons.find(({ text }) => text === '나가기')?.onPress;
    assert.ok(discard);
    let saving!: Promise<void>;

    await act(async () => { saving = renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 저장' }).props.onPress(); });
    await act(async () => {
      retainedBack();
      discard!();
    });
    assert.equal(backs, 0);
    assert.equal(alertArguments, openAlert);

    await act(async () => { pending.resolve(false); await saving; });
  });

  it('fences duplicate save callbacks synchronously', async () => {
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

  });

  it('shows the search-only empty message after a settled query has no matches', async () => {
    const renderer = await renderEditor({ maps: [map('forest', '숲 모험', { groupName: '숲' })] });

    await openCatalogTab(renderer);
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
        keyMode: 'LIMITED',
        keyCount: 2,
        attemptCount: 3,
      })]);
      await first.promise;
    });
    assert.equal(hasText(renderer.root, '쿨다운 1분 · 키 2개 · 도전 3회'), true);

    await act(async () => {
      renderer.update(React.createElement(AdventureMapAutomationEditor, {
        ...base,
        onLoadBattleMaps: () => second.promise,
      }));
    });
    assert.equal(hasText(renderer.root, '쿨다운 1분 · 키 2개 · 도전 3회'), true);
    await act(async () => {
      second.resolve([]);
      await second.promise;
    });

    assert.equal(hasText(renderer.root, '현재 상태 확인 불가'), true);
    assert.equal(hasText(renderer.root, '상태 미확인'), false);
    assert.equal(hasText(renderer.root, '쿨다운 1분 · 키 2개 · 도전 3회'), false);
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
    assert.equal(hasText(renderer.root, '쿨다운 1분 · 가능 2회'), true);

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

    assert.equal(hasText(renderer.root, '쿨다운 1분 · 가능 2회'), true);
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

    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'stored 삭제' }).props.disabled, true);
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
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'stored 삭제' }).props.disabled, true);
    await act(async () => {
      maps.resolve([map('stored', '저장된 맵')]);
      await maps.promise;
    });
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '저장된 맵 삭제' }).props.disabled, false);
  });

  it('renders cooldown, key, and each daily constraint separately for the same map', async () => {
    const renderer = await renderEditor({
      maps: [map('combined', '복합 제한 맵', {
        cooldownRemainingSeconds: 90,
        cooldownRemainingText: '1분 30초',
        keyMode: 'LIMITED',
        keyCount: 0,
        availableCount: 4,
        attemptCount: 2,
        winCount: 1,
      })],
    });
    await openAdventureGroup(renderer, '기타');
    assert.equal(hasText(renderer.root, '쿨다운 1분 30초'), true);
    assert.equal(hasText(renderer.root, '키 0개 · 가능 4회 · 도전 2회 · 승리 1회'), true);
    assert.equal(hasText(renderer.root, '쿨다운이 끝난 뒤 자동으로 다시 확인합니다.'), false);
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
  if (renderer.root.findAllByProps({ accessibilityLabel: `${name} 그룹 열기` }).length === 0) {
    await openCatalogTab(renderer);
  }
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: `${name} 그룹 열기` }).props.onPress();
  });
}

async function openCatalogTab(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => { findPressable(renderer.root, '맵 추가 탭').props.onPress(); });
}

async function openSelectedTab(renderer: ReactTestRenderer): Promise<void> {
  const selectedTab = renderer.root.findAll((node) => (
    (node.type as unknown) === 'Pressable'
    && typeof node.props.accessibilityLabel === 'string'
    && /^선택 맵 \d+개 탭$/.test(node.props.accessibilityLabel)
  ))[0];
  assert.ok(selectedTab);
  await act(async () => { selectedTab.props.onPress(); });
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
    onLoadBattleCategories: () => undefined,
    onLoadBattleMaps: async () => [],
    partyPresetCatalog: presetCatalog([]),
    onClearMutationMessage: () => undefined,
    onSave: async () => true,
    ...overrides,
  };
}
function presetCatalog(presets: PartyPresetResponse[]) {
  return { catalog: { folders: [{ id: 90, name: '공유 폴더', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' }], presets }, loading: false, error: null, retry: () => undefined };
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
function findPressable(root: ReactTestInstance, accessibilityLabel: string): ReactTestInstance {
  return root.find((node) => (
    (node.type as unknown) === 'Pressable'
    && node.props.accessibilityLabel === accessibilityLabel
  ));
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
function selectedMapRemovalOrder(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAll((node) => (
    (node.type as unknown) === 'Pressable'
    && typeof node.props.accessibilityLabel === 'string'
    && node.props.accessibilityLabel.endsWith(' 삭제')
    && !node.props.accessibilityLabel.includes('자동화')
  )).map((node) => node.props.accessibilityLabel as string);
}
function entry(adventureMaps: TypedAutomationEntryResponse['adventureMaps'] = []): TypedAutomationEntryResponse {
  return { id: 15, type: 'ADVENTURE_MAP', enabled: true, priority: 2, ready: true, warnings: [], quests: [], battleMaps: [], battleMapProgress: [], adventureMaps };
}
function map(mapCode: string, name: string, overrides: Partial<BattleMapResponse> = {}): BattleMapResponse {
  return { categoryId: 'adventure_map', mapCode, name, groupName: null, groupOrder: 0, mapOrder: 0, recommendedLevel: null, availableCount: null, attemptCount: null, winCount: null, cooldownRemainingText: null, cooldownRemainingSeconds: null, keyMode: 'NOT_REQUIRED', keyCount: null, requiredTime: null, supportsThreeBattles: false, enabled: true, resolved: true, iconUrl: null, rawHref: '', ...overrides };
}
function setting(
  mapCode: string,
  executionOrder: number,
  presetMode: 'PRIMARY' | 'EXPLICIT',
  partyPresetId: number | null,
): AdventureMapSettingResponse {
  if (presetMode === 'PRIMARY') {
    return { categoryId: 'adventure_map', mapCode, displayName: mapCode, executionOrder, presetMode, partyPresetId: null };
  }
  if (partyPresetId == null) throw new Error('EXPLICIT test setting requires a preset id.');
  return { categoryId: 'adventure_map', mapCode, displayName: mapCode, executionOrder, presetMode, partyPresetId };
}
function preset(id: number, name: string, isPrimary: boolean): PartyPresetResponse {
  return { id, accountId: 1, name, displayOrder: id, isPrimary, members: [], createdAt: '', updatedAt: '', folderId: null };
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
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
