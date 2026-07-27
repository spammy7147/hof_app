import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { BattlePartyMember } from '../../main/domain/battleParty';
import type { PartyPresetCatalogResponse, PartyPresetResponse } from '../../main/types/api';

type SwipeableMockMethods = { close: () => void; closeCalls: number };

const dragCalls: PartyPresetResponse[] = [];
const hostRenderCounts = new Map<string, number>();
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  if (typeof props.testID === 'string') hostRenderCounts.set(props.testID, (hostRenderCounts.get(props.testID) ?? 0) + 1);
  const nodeRef = React.useRef<Record<string, unknown>>({});
  Object.assign(nodeRef.current, props);
  React.useImperativeHandle(ref, () => nodeRef.current, []);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const draggableFlatList = (props: Record<string, unknown>) => React.createElement(
  'DraggableFlatListContainer',
  { style: props.containerStyle },
  React.createElement(
    'DraggableFlatList',
    props,
    props.ListHeaderComponent as React.ReactNode,
    (props.data as PartyPresetResponse[]).map((item, index) => React.createElement(
      React.Fragment,
      { key: (props.keyExtractor as (value: PartyPresetResponse) => string)(item) },
      (props.renderItem as (value: {
        item: PartyPresetResponse;
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
  ),
);
const reanimatedSwipeable = React.forwardRef<SwipeableMockMethods, Record<string, unknown>>((props, ref) => {
  if (typeof props.testID === 'string') hostRenderCounts.set(props.testID, (hostRenderCounts.get(props.testID) ?? 0) + 1);
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
const battlePartySelector = (props: Record<string, unknown>) => React.createElement('BattlePartySelector', props);
const reactNativeMock = {
  AccessibilityInfo: { setAccessibilityFocus: () => undefined },
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => React.createElement(
    'FlatList',
    props,
    (props.data as unknown[]).map((item, index) => React.createElement(
      React.Fragment,
      { key: (props.keyExtractor as (value: unknown) => string)(item) },
      (props.renderItem as (value: { item: unknown; index: number }) => React.ReactNode)({ item, index }),
    )),
  ),
  Modal: host('Modal'),
  Pressable: host('Pressable'),
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  TextInput: host('TextInput'),
  View: host('View'),
  findNodeHandle: () => 1,
};
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') return iconsMock;
  if (request === 'react-native-draggable-flatlist') return { __esModule: true, default: draggableFlatList };
  if (request === 'react-native-gesture-handler/ReanimatedSwipeable') {
    return { __esModule: true, default: reanimatedSwipeable };
  }
  if (request === './BattlePartySelector') return { BattlePartySelector: battlePartySelector };
  return originalLoad(request, parent, isMain);
};
const { PartyPresetList } = require(
  '../../main/components/PartyPresetList',
) as typeof import('../../main/components/PartyPresetList');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PartyPresetList', () => {
  it('gives the draggable list container the remaining screen height', async () => {
    const renderer = await renderList();

    const container = findHost(renderer.root, 'DraggableFlatListContainer');
    assert.deepEqual(container.props.style, { flex: 1 });
  });

  it('shows one plus and selects a primary preset from the star without expanding the card', async () => {
    const primaryCalls: number[] = [];
    const renderer = await renderList({
      onMakePartyPresetPrimary: async (presetId) => {
        primaryCalls.push(presetId);
        return { ...PRESETS[1]!, isPrimary: true };
      },
    });

    assert.equal(textCount(renderer.root, '+ 추가'), 0);
    assert.equal(textCount(renderer.root, '추가'), 1);
    const star = renderer.root.findByProps({ accessibilityLabel: '동관 대표로 지정' });
    await act(async () => { await star.props.onPress(); });

    assert.deepEqual(primaryCalls, [2]);
    assert.equal(findHosts(renderer.root, 'TextInput').length, 0);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '동관 대표 프리셋' }));
  });

  it('drags from the handle, submits every id, and rolls back a failed reorder', async () => {
    dragCalls.length = 0;
    const reorderRequests: unknown[] = [];
    const renderer = await renderList({
      onReorderPartyPresets: async (request) => {
        reorderRequests.push(request);
        throw new Error('reorder failed');
      },
    });

    const firstHandle = renderer.root.findByProps({ accessibilityLabel: '서관 1번째 프리셋 순서 이동' });
    await act(async () => { firstHandle.props.onLongPress(); });
    assert.deepEqual(dragCalls.map(({ id }) => id), [1]);

    const draggable = findHost(renderer.root, 'DraggableFlatList');
    await act(async () => {
      await draggable.props.onDragEnd({ data: [PRESETS[1], PRESETS[0]], from: 0, to: 1 });
    });

    assert.deepEqual(reorderRequests, [{ folderId: null, presetIds: [2, 1] }]);
    assert.deepEqual(
      (findHost(renderer.root, 'DraggableFlatList').props.data as PartyPresetResponse[]).map(({ id }) => id),
      [1, 2],
    );
  });

  it('reveals right-side deletion after a left swipe and deletes only from that action', async () => {
    const deleteCalls: number[] = [];
    const renderer = await renderList({
      onDeletePartyPreset: async (presetId) => {
        deleteCalls.push(presetId);
        return null;
      },
    });
    const swipeables = findHosts(renderer.root, 'ReanimatedSwipeable');
    assert.equal(swipeables.length, 2);

    await act(async () => { swipeables[0]!.props.onSwipeableWillOpen(); });
    assert.deepEqual(deleteCalls, []);
    const deleteButton = renderer.root.findByProps({ accessibilityLabel: '서관 삭제' });
    await act(async () => { await deleteButton.props.onPress(); });
    assert.deepEqual(deleteCalls, [1]);
  });

  it('preserves a new preset draft when its header and add button are pressed again', async () => {
    const renderer = await renderList();
    const addButton = renderer.root.findByProps({ accessibilityLabel: '프리셋 추가' });
    await act(async () => { addButton.props.onPress(); });
    let input = findHost(renderer.root, 'TextInput');
    await act(async () => { input.props.onChangeText('작성 중'); });

    const draftHeader = renderer.root.findByProps({ accessibilityLabel: '작성 중 프리셋 접기' });
    await act(async () => { draftHeader.props.onPress(); });
    await act(async () => { addButton.props.onPress(); });

    input = findHost(renderer.root, 'TextInput');
    assert.equal(input.props.value, '작성 중');
    const selector = findHost(renderer.root, 'BattlePartySelector');
    assert.deepEqual(
      (selector.props.party as BattlePartyMember[]).map(({ characterId }) => characterId),
      [null, null, null, null, null],
    );
  });

  it('assigns an existing unassigned preset by updating the same id', async () => {
    const updateCalls: Array<{ presetId: number; request: unknown }> = [];
    const createCalls: unknown[] = [];
    const deleteCalls: number[] = [];
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => CATALOG,
      onCreatePartyPreset: async (request) => { createCalls.push(request); return PRESETS[0]!; },
      onDeletePartyPreset: async (presetId) => { deleteCalls.push(presetId); return null; },
      onUpdatePartyPreset: async (presetId, request) => {
        updateCalls.push({ presetId, request });
        return { ...PRESETS[0]!, ...request, folderId: request.folderId ?? null };
      },
    });

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '미지정 폴더 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '서관, 구성원 0명, 대표 프리셋' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 선택' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 전투' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 확인' }).props.onPress());
    const save = renderer.root.findAllByProps({ accessibilityRole: 'button' })
      .find((node) => node.findAll((child) => String(child.type) === 'Text' && child.children.includes('저장')).length > 0);
    await act(async () => save?.props.onPress());

    assert.deepEqual(updateCalls, [{
      presetId: 1,
      request: { name: '서관', members: PRESETS[0]!.members, folderId: 10 },
    }]);
    assert.deepEqual(createCalls, []);
    assert.deepEqual(deleteCalls, []);
  });

  it('creates a new preset with its confirmed folder id', async () => {
    const createCalls: unknown[] = [];
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => CATALOG,
      onCreatePartyPreset: async (request) => {
        createCalls.push(request);
        return { ...PRESETS[0]!, id: 20, name: request.name, members: request.members, folderId: request.folderId ?? null };
      },
    });

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 추가' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 선택' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 전투' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 확인' }).props.onPress());
    await act(async () => findButtonByText(renderer.root, '저장').props.onPress());

    assert.deepEqual(createCalls, [{ name: '새 프리셋', members: PRESETS[0]!.members, folderId: 10 }]);
  });

  it('preserves the complete edit draft after a failed folder assignment', async () => {
    const updateCalls: unknown[] = [];
    const editedParty: BattlePartyMember[] = [
      { slotIndex: 0, characterId: 'hero-alpha', patternSlot: 3 },
      { slotIndex: 1, characterId: null, patternSlot: null },
      { slotIndex: 2, characterId: 'hero-bravo', patternSlot: 1 },
      { slotIndex: 3, characterId: 'hero-charlie', patternSlot: null },
      { slotIndex: 4, characterId: null, patternSlot: null },
    ];
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => CATALOG,
      onUpdatePartyPreset: async (presetId, request) => {
        updateCalls.push({ presetId, request });
        throw new Error('assignment failed');
      },
    });

    await openUnassignedPreset(renderer, '서관, 구성원 0명, 대표 프리셋');
    const nameInput = findHost(renderer.root, 'TextInput');
    await act(async () => nameInput.props.onChangeText('대회랑'));
    await act(async () => findHost(renderer.root, 'BattlePartySelector').props.onPartyChange(editedParty));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 선택' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 전투' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 확인' }).props.onPress());
    await act(async () => findButtonByText(renderer.root, '저장').props.onPress());

    assert.equal(findHost(renderer.root, 'TextInput').props.value, '대회랑');
    assert.equal(textCount(renderer.root, '전투'), 1);
    assert.deepEqual(updateCalls, [{
      presetId: 1,
      request: { name: '대회랑', members: editedParty, folderId: 10 },
    }]);
    assert.deepEqual(
      (findHost(renderer.root, 'BattlePartySelector').props.party as BattlePartyMember[]),
      editedParty,
    );
  });

  it('excludes a duplicate save mutation while the first assignment is pending', async () => {
    const updateCalls: unknown[] = [];
    const pending = deferred<PartyPresetResponse>();
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => CATALOG,
      onUpdatePartyPreset: async (presetId, request) => {
        updateCalls.push({ presetId, request });
        return pending.promise;
      },
    });
    await openUnassignedPreset(renderer, '서관, 구성원 0명, 대표 프리셋');
    const save = findButtonByText(renderer.root, '저장');
    await act(async () => {
      void save.props.onPress();
      void save.props.onPress();
      await Promise.resolve();
    });
    assert.equal(updateCalls.length, 1);
    await act(async () => pending.resolve(PRESETS[0]!));
  });

  it('uses explicit folder edit mode and confirms folder deletion without deleting presets', async () => {
    const deletedFolders: number[] = [];
    const deletedPresets: number[] = [];
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => CATALOG,
      onDeletePartyPreset: async (presetId) => { deletedPresets.push(presetId); return null; },
      onDeletePartyPresetFolder: async (folderId) => {
        deletedFolders.push(folderId);
        return { folders: [], presets: PRESETS.map((preset) => ({ ...preset, folderId: null })) };
      },
    });

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 삭제' }).props.onPress());
    assert.deepEqual(deletedFolders, []);
    assert.equal(textCount(renderer.root, '전투 폴더를 삭제할까요?'), 1);
    assert.equal(textCount(renderer.root, '직접 프리셋은 미지정으로 이동하고, 바로 아래 폴더는 상위로 승격되며 그 프리셋은 그대로 유지됩니다.'), 1);
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 삭제 취소' }).props.onPress());
    assert.deepEqual(deletedFolders, []);
    assert.equal(textCount(renderer.root, '전투 폴더를 삭제할까요?'), 0);

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 삭제' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 삭제 확인' }).props.onPress());
    assert.deepEqual(deletedFolders, [10]);
    assert.deepEqual(deletedPresets, []);
  });

  it('closes a same-parent folder destination as a no-op without sending an out-of-range order', async () => {
    const moveCalls: unknown[] = [];
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => FOLDER_CATALOG,
      onMovePartyPresetFolder: async (folderId, request) => {
        moveCalls.push({ folderId, request });
        return FOLDER_CATALOG;
      },
    });

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 이동' }).props.onPress());
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '현재 폴더 위치 루트' }));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 확인' }).props.onPress());

    assert.deepEqual(moveCalls, []);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '폴더 위치 확인' }).length, 0);
  });

  it('creates and renames folders from explicit manager controls', async () => {
    const createCalls: unknown[] = [];
    const renameCalls: unknown[] = [];
    const createdCatalog: PartyPresetCatalogResponse = {
      ...FOLDER_CATALOG,
      folders: [...FOLDER_CATALOG.folders, folder(13, '파밍', null, 2)],
    };
    const renamedCatalog: PartyPresetCatalogResponse = {
      ...createdCatalog,
      folders: createdCatalog.folders.map((value) => value.id === 10 ? { ...value, name: '보스전' } : value),
    };
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => FOLDER_CATALOG,
      onCreatePartyPresetFolder: async (request) => { createCalls.push(request); return createdCatalog; },
      onRenamePartyPresetFolder: async (folderId, request) => { renameCalls.push({ folderId, request }); return renamedCatalog; },
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '새 폴더 이름' }).props.onChangeText('  파밍  '));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '현재 위치에 폴더 추가' }).props.onPress());
    assert.deepEqual(createCalls, [{ name: '파밍', parentFolderId: null }]);

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 이름 변경' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 이름' }).props.onChangeText('  보스전  '));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 이름 저장' }).props.onPress());
    assert.deepEqual(renameCalls, [{ folderId: 10, request: { name: '보스전' } }]);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '보스전 하위 폴더 열기' }));
  });

  it('excludes duplicate folder mutations synchronously', async () => {
    const createCalls: unknown[] = [];
    const pending = deferred<PartyPresetCatalogResponse>();
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => FOLDER_CATALOG,
      onCreatePartyPresetFolder: async (request) => { createCalls.push(request); return pending.promise; },
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '새 폴더 이름' }).props.onChangeText('파밍'));
    const add = renderer.root.findByProps({ accessibilityLabel: '현재 위치에 폴더 추가' });
    await act(async () => {
      void add.props.onPress();
      void add.props.onPress();
      await Promise.resolve();
    });
    assert.deepEqual(createCalls, [{ name: '파밍', parentFolderId: null }]);
    await act(async () => pending.resolve(FOLDER_CATALOG));
  });

  it('moves a folder to a different destination and keeps a failed destination draft open', async () => {
    const moveCalls: unknown[] = [];
    const movedCatalog: PartyPresetCatalogResponse = {
      ...FOLDER_CATALOG,
      folders: FOLDER_CATALOG.folders.map((value) => value.id === 10
        ? { ...value, parentFolderId: 11, displayOrder: 0 }
        : value),
    };
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => FOLDER_CATALOG,
      onMovePartyPresetFolder: async (folderId, request) => {
        moveCalls.push({ folderId, request });
        return movedCatalog;
      },
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 이동' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 퀘스트' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 확인' }).props.onPress());
    assert.deepEqual(moveCalls, [{ folderId: 10, request: { parentFolderId: 11, displayOrder: 0 } }]);

    const failedMoveCalls: unknown[] = [];
    const failedRenderer = await renderList({
      onGetPartyPresetCatalog: async () => FOLDER_CATALOG,
      onMovePartyPresetFolder: async (folderId, request) => {
        failedMoveCalls.push({ folderId, request });
        throw new Error('move failed');
      },
    });
    await act(async () => failedRenderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => failedRenderer.root.findByProps({ accessibilityLabel: '전투 폴더 이동' }).props.onPress());
    await act(async () => failedRenderer.root.findByProps({ accessibilityLabel: '폴더 위치 퀘스트' }).props.onPress());
    await act(async () => failedRenderer.root.findByProps({ accessibilityLabel: '폴더 위치 확인' }).props.onPress());
    assert.ok(failedRenderer.root.findByProps({ accessibilityLabel: '현재 폴더 위치 퀘스트' }));
    assert.deepEqual(failedMoveCalls, [{ folderId: 10, request: { parentFolderId: 11, displayOrder: 0 } }]);
    assert.equal(textCount(failedRenderer.root, 'move failed'), 1);
    assert.deepEqual(
      (findHost(failedRenderer.root, 'DraggableFlatList').props.data as Array<{ id: number }>).map(({ id }) => id),
      [10, 11],
    );
  });

  it('reorders sibling folders by drag and accessible action using authoritative responses', async () => {
    dragCalls.length = 0;
    const requests: unknown[] = [];
    const authoritative = {
      ...reorderRootFolders(FOLDER_CATALOG, [11, 10]),
      folders: reorderRootFolders(FOLDER_CATALOG, [11, 10]).folders.map((value) => value.id === 11
        ? { ...value, name: '서버 퀘스트' }
        : value),
    };
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => FOLDER_CATALOG,
      onReorderPartyPresetFolders: async (request) => { requests.push(request); return authoritative; },
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 1번째 폴더 순서 이동' }).props.onLongPress());
    assert.deepEqual(dragCalls.map(({ id }) => id), [10]);
    const draggable = findHost(renderer.root, 'DraggableFlatList');
    const folderRows = draggable.props.data as PartyPresetResponse[];
    await act(async () => draggable.props.onDragEnd({ data: [folderRows[1], folderRows[0]], from: 0, to: 1 }));
    assert.deepEqual(requests, [{ parentFolderId: null, folderIds: [11, 10] }]);
    assert.deepEqual((findHost(renderer.root, 'DraggableFlatList').props.data as Array<{ id: number }>).map(({ id }) => id), [11, 10]);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '서버 퀘스트 하위 폴더 열기' }));

    const accessibleRequests: unknown[] = [];
    const accessibleRenderer = await renderList({
      onGetPartyPresetCatalog: async () => FOLDER_CATALOG,
      onReorderPartyPresetFolders: async (request) => { accessibleRequests.push(request); return authoritative; },
    });
    await act(async () => accessibleRenderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => accessibleRenderer.root.findByProps({ accessibilityLabel: '전투 1번째 폴더 순서 이동' }).props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    assert.deepEqual(accessibleRequests, [{ parentFolderId: null, folderIds: [11, 10] }]);
  });

  it('shows optimistic folder order, then rolls back and adopts the authoritative recovery', async () => {
    const pending = deferred<PartyPresetCatalogResponse>();
    let loads = 0;
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => { loads += 1; return FOLDER_CATALOG; },
      onReorderPartyPresetFolders: async () => pending.promise,
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    const draggable = findHost(renderer.root, 'DraggableFlatList');
    const rows = draggable.props.data as Array<{ id: number }>;
    await act(async () => {
      void draggable.props.onDragEnd({ data: [rows[1], rows[0]], from: 0, to: 1 });
      await Promise.resolve();
    });
    assert.deepEqual((findHost(renderer.root, 'DraggableFlatList').props.data as Array<{ id: number }>).map(({ id }) => id), [11, 10]);
    await act(async () => pending.reject(new Error('reorder failed')));
    assert.equal(loads, 2);
    assert.deepEqual((findHost(renderer.root, 'DraggableFlatList').props.data as Array<{ id: number }>).map(({ id }) => id), [10, 11]);
  });

  it('submits a numeric folder id and the complete preset sibling set when reordering', async () => {
    const requests: unknown[] = [];
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => FOLDER_PRESETS_CATALOG,
      onReorderPartyPresets: async (request) => { requests.push(request); return [...FOLDER_PRESETS_CATALOG.presets].reverse(); },
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '서관, 구성원 0명, 대표 프리셋' }).props.onPress());
    const draggable = findHost(renderer.root, 'DraggableFlatList');
    const rows = draggable.props.data as PartyPresetResponse[];
    await act(async () => draggable.props.onDragEnd({ data: [rows[1], rows[0]], from: 0, to: 1 }));
    assert.deepEqual(requests, [{ folderId: 10, presetIds: [2, 1] }]);
  });

  it('renders catalog preset order, updates optimistically, and adopts successful server order', async () => {
    const pending = deferred<PartyPresetResponse[]>();
    const catalog: PartyPresetCatalogResponse = {
      ...FOLDER_PRESETS_CATALOG,
      presets: [
        { ...FOLDER_PRESETS_CATALOG.presets[1]!, displayOrder: 1 },
        { ...FOLDER_PRESETS_CATALOG.presets[0]!, displayOrder: 0 },
      ],
    };
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => catalog,
      onReorderPartyPresets: async () => pending.promise,
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '서관, 구성원 0명, 대표 프리셋' }).props.onPress());
    let draggable = findHost(renderer.root, 'DraggableFlatList');
    assert.deepEqual((draggable.props.data as PartyPresetResponse[]).map(({ id }) => id), [1, 2]);
    const rows = draggable.props.data as PartyPresetResponse[];
    await act(async () => {
      void draggable.props.onDragEnd({ data: [rows[1], rows[0]], from: 0, to: 1 });
      await Promise.resolve();
    });
    draggable = findHost(renderer.root, 'DraggableFlatList');
    assert.deepEqual((draggable.props.data as PartyPresetResponse[]).map(({ id }) => id), [2, 1]);
    await act(async () => pending.resolve([
      { ...catalog.presets[0]!, displayOrder: 1 },
      { ...catalog.presets[1]!, displayOrder: 0 },
    ]));
    assert.deepEqual(
      (findHost(renderer.root, 'DraggableFlatList').props.data as PartyPresetResponse[]).map(({ id }) => id),
      [1, 2],
    );
  });

  it('clears the full catalog on auth loss and ignores the late old-account load', async () => {
    const pending = deferred<PartyPresetCatalogResponse>();
    const props = listProps({ onGetPartyPresetCatalog: async () => pending.promise });
    const renderer = await renderListProps(props);
    await act(async () => renderer.update(React.createElement(PartyPresetList, { ...props, authenticated: false })));
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '전투 폴더 열기' }).length, 0);
    await act(async () => pending.resolve(FOLDER_CATALOG));
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '전투 폴더 열기' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '폴더 편집 시작' }).length, 0);
  });

  it('lets only the latest catalog request replace state when loads resolve in reverse order', async () => {
    const older = deferred<PartyPresetCatalogResponse>();
    const newer = deferred<PartyPresetCatalogResponse>();
    const olderProps = listProps({ onGetPartyPresetCatalog: async () => older.promise });
    const renderer = await renderListProps(olderProps);
    const newerProps = { ...olderProps, onGetPartyPresetCatalog: async () => newer.promise };
    await act(async () => renderer.update(React.createElement(PartyPresetList, newerProps)));
    await act(async () => newer.resolve({ folders: [folder(30, '최신', null, 0)], presets: [] }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '최신 폴더 열기' }));
    await act(async () => older.resolve({ folders: [folder(31, '오래됨', null, 0)], presets: [] }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '최신 폴더 열기' }));
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '오래됨 폴더 열기' }).length, 0);
  });

  it('does not rebuild unrelated memoized virtual rows while editing text', async () => {
    const renderer = await renderList({ onGetPartyPresetCatalog: async () => FOLDER_PRESETS_CATALOG });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '서관, 구성원 0명, 대표 프리셋' }).props.onPress());
    hostRenderCounts.clear();
    await act(async () => findHost(renderer.root, 'TextInput').props.onChangeText('편집 중'));
    assert.equal(hostRenderCounts.get('party-preset-managed-row-2') ?? 0, 0);

    const folderRenderer = await renderList({ onGetPartyPresetCatalog: async () => FOLDER_CATALOG });
    await act(async () => folderRenderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => folderRenderer.root.findByProps({ accessibilityLabel: '전투 폴더 이름 변경' }).props.onPress());
    hostRenderCounts.clear();
    await act(async () => folderRenderer.root.findByProps({ accessibilityLabel: '전투 폴더 이름' }).props.onChangeText('보스전'));
    assert.equal(hostRenderCounts.get('party-preset-folder-manager-row-11') ?? 0, 0);
  });

});

type Overrides = Partial<React.ComponentProps<typeof PartyPresetList>>;

async function renderList(overrides: Overrides = {}): Promise<ReactTestRenderer> {
  return renderListProps(listProps(overrides));
}

function listProps(overrides: Overrides = {}): React.ComponentProps<typeof PartyPresetList> {
  return {
    authenticated: true,
    characters: [],
    onListPartyPresets: async () => PRESETS,
    onCreatePartyPreset: async () => PRESETS[0]!,
    onUpdatePartyPreset: async () => PRESETS[0]!,
    onMakePartyPresetPrimary: async () => PRESETS[0]!,
    onReorderPartyPresets: async () => PRESETS,
    onDeletePartyPreset: async () => null,
    ...overrides,
  };
}

async function renderListProps(props: React.ComponentProps<typeof PartyPresetList>): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(PartyPresetList, props));
    await Promise.resolve();
  });
  return renderer;
}

const PRESETS: PartyPresetResponse[] = [
  preset(1, '서관', 0, true),
  preset(2, '동관', 1, false),
];

const CATALOG: PartyPresetCatalogResponse = {
  folders: [{ id: 10, name: '전투', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' }],
  presets: PRESETS,
};

const FOLDER_CATALOG: PartyPresetCatalogResponse = {
  folders: [
    { id: 10, name: '전투', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' },
    { id: 11, name: '퀘스트', parentFolderId: null, displayOrder: 1, createdAt: '', updatedAt: '' },
    { id: 12, name: '레이드', parentFolderId: 10, displayOrder: 0, createdAt: '', updatedAt: '' },
  ],
  presets: PRESETS,
};

const FOLDER_PRESETS_CATALOG: PartyPresetCatalogResponse = {
  folders: [folder(10, '전투', null, 0)],
  presets: PRESETS.map((value) => ({ ...value, folderId: 10 })),
};

function preset(id: number, name: string, displayOrder: number, isPrimary: boolean): PartyPresetResponse {
  return {
    id,
    accountId: 1,
    name,
    displayOrder,
    isPrimary,
    members: Array.from({ length: 5 }, (_, slotIndex) => ({
      slotIndex,
      characterId: null,
      patternSlot: null,
    })),
    createdAt: '2026-07-23T00:00:00Z',
    updatedAt: '2026-07-23T00:00:00Z',
    folderId: null,
  };
}

function folder(id: number, name: string, parentFolderId: number | null, displayOrder: number) {
  return { id, name, parentFolderId, displayOrder, createdAt: '', updatedAt: '' };
}

function reorderRootFolders(catalog: PartyPresetCatalogResponse, ids: number[]): PartyPresetCatalogResponse {
  return {
    ...catalog,
    folders: catalog.folders.map((value) => value.parentFolderId == null
      ? { ...value, displayOrder: ids.indexOf(value.id) }
      : value),
  };
}

function textCount(root: ReactTestInstance, text: string): number {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length;
}

function findHost(root: ReactTestInstance, name: string): ReactTestInstance {
  return root.find((node) => (node.type as unknown) === name);
}

function findHosts(root: ReactTestInstance, name: string): ReactTestInstance[] {
  return root.findAll((node) => (node.type as unknown) === name);
}

function findButtonByText(root: ReactTestInstance, text: string): ReactTestInstance {
  return root.findAllByProps({ accessibilityRole: 'button' })
    .find((node) => node.findAll((child) => (child.type as unknown) === 'Text' && child.children.includes(text)).length > 0)!;
}

async function openUnassignedPreset(renderer: ReactTestRenderer, accessibilityLabel: string): Promise<void> {
  await act(async () => renderer.root.findByProps({ accessibilityLabel: '미지정 폴더 열기' }).props.onPress());
  await act(async () => renderer.root.findByProps({ accessibilityLabel }).props.onPress());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
