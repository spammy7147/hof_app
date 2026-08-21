import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { BattlePartyMember } from '../../main/domain/battleParty';
import { buildPartyPresetFolderEditorRows } from '../../main/domain/partyPresetFolderEditor';
import type { PartyPresetCatalogActions } from '../../main/domain/partyPresetCatalogModule';
import type { PartyPresetCatalogResponse, PartyPresetResponse } from '../../main/types/api';
import { makePartyPresetCatalogResource } from '../fixtures/partyPresetCatalog';

type SwipeableMockMethods = { close: () => void; closeCalls: number };

const dragCalls: PartyPresetResponse[] = [];
const scrollToIndexCalls: Array<Record<string, unknown>> = [];
const scrollToOffsetCalls: Array<Record<string, unknown>> = [];
const accessibilityFocusCalls: number[] = [];
const hostRenderCounts = new Map<string, number>();
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  if (typeof props.testID === 'string') hostRenderCounts.set(props.testID, (hostRenderCounts.get(props.testID) ?? 0) + 1);
  const nodeRef = React.useRef<Record<string, unknown>>({});
  Object.assign(nodeRef.current, props);
  React.useImperativeHandle(ref, () => nodeRef.current, []);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const draggableFlatList = React.forwardRef<Record<string, unknown>, Record<string, unknown>>((props, ref) => {
  const methods = React.useMemo(() => ({
    scrollToIndex(options: Record<string, unknown>) { scrollToIndexCalls.push(options); },
    scrollToOffset(options: Record<string, unknown>) { scrollToOffsetCalls.push(options); },
  }), []);
  React.useImperativeHandle(ref, () => methods, [methods]);
  return React.createElement(
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
});
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
const partyPresetFolderEditor = (props: Record<string, unknown>) => React.createElement('PartyPresetFolderEditor', props);
const reactNativeMock = {
  AccessibilityInfo: { setAccessibilityFocus: (handle: number) => { accessibilityFocusCalls.push(handle); } },
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
  findNodeHandle: (node: Record<string, unknown> | null) => node?.accessibilityLabel === '프리셋 이름 입력' ? 77 : 1,
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
  if (request === './PartyPresetFolderEditor') return { PartyPresetFolderEditor: partyPresetFolderEditor };
  return originalLoad(request, parent, isMain);
};
const { PartyPresetList } = require(
  '../../main/components/PartyPresetList',
) as typeof import('../../main/components/PartyPresetList');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PartyPresetList', () => {
  it('renders and moves folders through one full-tree editor backed by the authoritative catalog', async () => {
    const moveCalls: unknown[] = [];
    const initialCatalog: PartyPresetCatalogResponse = {
      folders: [
        folder(1, 'New1', null, 0),
        folder(2, 'new2', 1, 0),
        folder(3, '다른 폴더', null, 1),
      ],
      presets: [],
    };
    const movedCatalog: PartyPresetCatalogResponse = {
      ...initialCatalog,
      folders: [
        folder(1, 'New1', null, 0),
        folder(2, 'new2', null, 1),
        folder(3, '다른 폴더', null, 2),
      ],
    };
    const renderer = await renderList({
      partyPresetCatalog: catalogResource(initialCatalog),
      onMovePartyPresetFolder: async (folderId, request) => {
        moveCalls.push({ folderId, request });
        return movedCatalog;
      },
    });

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    let editors = findHosts(renderer.root, 'PartyPresetFolderEditor');
    assert.equal(editors.length, 1);
    assert.equal(editors[0]!.props.index.foldersById.size, 3);
    assert.deepEqual(
      buildPartyPresetFolderEditorRows(editors[0]!.props.index, new Set([1])).map(({ folderId, depth }) => [folderId, depth]),
      [[1, 0], [2, 1], [3, 0]],
    );

    await act(async () => editors[0]!.props.onMove(2, { parentFolderId: null, displayOrder: 1 }));
    editors = findHosts(renderer.root, 'PartyPresetFolderEditor');
    assert.deepEqual(moveCalls, [{ folderId: 2, request: { parentFolderId: null, displayOrder: 1 } }]);
    assert.deepEqual(
      buildPartyPresetFolderEditorRows(editors[0]!.props.index, new Set([1])).map(({ folderId, depth }) => [folderId, depth]),
      [[1, 0], [2, 0], [3, 0]],
    );
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '폴더 위치 확인' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '상위 폴더로 이동' }).length, 0);
  });

  it('gives the draggable list container the remaining screen height', async () => {
    const renderer = await renderList();
    await openUnassignedPreset(renderer, '서관, 대표 프리셋');

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
    await openUnassignedPreset(renderer, '서관, 대표 프리셋');

    assert.equal(textCount(renderer.root, '+ 추가'), 0);
    assert.equal(textCount(renderer.root, '추가'), 1);
    const star = renderer.root.findByProps({ accessibilityLabel: '동관 대표로 지정' });
    await act(async () => { await star.props.onPress(); });

    assert.deepEqual(primaryCalls, [2]);
    assert.equal(findHosts(renderer.root, 'TextInput').length, 1);
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
    await openUnassignedPreset(renderer, '서관, 대표 프리셋');

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
    await openUnassignedPreset(renderer, '서관, 대표 프리셋');
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
      partyPresetCatalog: catalogResource(CATALOG),
      onCreatePartyPreset: async (request) => { createCalls.push(request); return PRESETS[0]!; },
      onDeletePartyPreset: async (presetId) => { deleteCalls.push(presetId); return null; },
      onUpdatePartyPreset: async (presetId, request) => {
        updateCalls.push({ presetId, request });
        return { ...PRESETS[0]!, ...request, folderId: request.folderId ?? null };
      },
    });

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '미지정 폴더, 프리셋 2개, 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '서관, 대표 프리셋' }).props.onPress());
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
      partyPresetCatalog: catalogResource(CATALOG),
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
      partyPresetCatalog: catalogResource(CATALOG),
      onUpdatePartyPreset: async (presetId, request) => {
        updateCalls.push({ presetId, request });
        throw new Error('assignment failed');
      },
    });

    await openUnassignedPreset(renderer, '서관, 대표 프리셋');
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
      partyPresetCatalog: catalogResource(CATALOG),
      onUpdatePartyPreset: async (presetId, request) => {
        updateCalls.push({ presetId, request });
        return pending.promise;
      },
    });
    await openUnassignedPreset(renderer, '서관, 대표 프리셋');
    const save = findButtonByText(renderer.root, '저장');
    await act(async () => {
      void save.props.onPress();
      void save.props.onPress();
      await Promise.resolve();
    });
    assert.equal(updateCalls.length, 1);
    await act(async () => pending.resolve(PRESETS[0]!));
  });

  it('uses explicit folder edit mode and deletes a folder without deleting presets', async () => {
    const deletedFolders: number[] = [];
    const deletedPresets: number[] = [];
    const renderer = await renderList({
      partyPresetCatalog: catalogResource(CATALOG),
      onDeletePartyPreset: async (presetId) => { deletedPresets.push(presetId); return null; },
      onDeletePartyPresetFolder: async (folderId) => {
        deletedFolders.push(folderId);
        return { folders: [], presets: PRESETS.map((preset) => ({ ...preset, folderId: null })) };
      },
    });

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => findHost(renderer.root, 'PartyPresetFolderEditor').props.onDelete(10));
    assert.deepEqual(deletedFolders, [10]);
    assert.deepEqual(deletedPresets, []);
  });

  it('does not render a folder-moving picker but retains the preset assignment picker', async () => {
    const renderer = await renderList({
      partyPresetCatalog: catalogResource(FOLDER_CATALOG),
    });

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '폴더 위치 확인' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '상위 폴더로 이동' }).length, 0);
    assert.equal(findAllText(renderer.root).includes('루트'), false);

    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 종료' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '미지정 폴더, 프리셋 2개, 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '서관, 대표 프리셋' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 위치 선택' }).props.onPress());
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '폴더 위치 확인' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '현재 폴더 위치 미지정' }));
  });

  it('creates and renames folders through the full-tree editor callbacks', async () => {
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
      partyPresetCatalog: catalogResource(FOLDER_CATALOG),
      onCreatePartyPresetFolder: async (request) => { createCalls.push(request); return createdCatalog; },
      onRenamePartyPresetFolder: async (folderId, request) => { renameCalls.push({ folderId, request }); return renamedCatalog; },
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    let editor = findHost(renderer.root, 'PartyPresetFolderEditor');
    await act(async () => editor.props.onCreate({ name: '파밍', parentFolderId: null }));
    assert.deepEqual(createCalls, [{ name: '파밍', parentFolderId: null }]);

    editor = findHost(renderer.root, 'PartyPresetFolderEditor');
    await act(async () => editor.props.onRename(10, { name: '보스전' }));
    assert.deepEqual(renameCalls, [{ folderId: 10, request: { name: '보스전' } }]);
    assert.equal(findHost(renderer.root, 'PartyPresetFolderEditor').props.index.foldersById.get(10).name, '보스전');
  });

  it('excludes duplicate folder mutations synchronously', async () => {
    const createCalls: unknown[] = [];
    const pending = deferred<PartyPresetCatalogResponse>();
    const renderer = await renderList({
      partyPresetCatalog: catalogResource(FOLDER_CATALOG),
      onCreatePartyPresetFolder: async (request) => { createCalls.push(request); return pending.promise; },
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    const editor = findHost(renderer.root, 'PartyPresetFolderEditor');
    await act(async () => {
      void editor.props.onCreate({ name: '파밍', parentFolderId: null });
      void editor.props.onCreate({ name: '파밍', parentFolderId: null });
      await Promise.resolve();
    });
    assert.deepEqual(createCalls, [{ name: '파밍', parentFolderId: null }]);
    await act(async () => pending.resolve(FOLDER_CATALOG));
  });

  it('moves a folder through the editor and preserves the catalog when the move fails', async () => {
    const moveCalls: unknown[] = [];
    const movedCatalog: PartyPresetCatalogResponse = {
      ...FOLDER_CATALOG,
      folders: FOLDER_CATALOG.folders.map((value) => value.id === 10
        ? { ...value, parentFolderId: 11, displayOrder: 0 }
        : value),
    };
    const renderer = await renderList({
      partyPresetCatalog: catalogResource(FOLDER_CATALOG),
      onMovePartyPresetFolder: async (folderId, request) => {
        moveCalls.push({ folderId, request });
        return movedCatalog;
      },
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => findHost(renderer.root, 'PartyPresetFolderEditor').props.onMove(10, { parentFolderId: 11, displayOrder: 0 }));
    assert.deepEqual(moveCalls, [{ folderId: 10, request: { parentFolderId: 11, displayOrder: 0 } }]);
    assert.equal(findHost(renderer.root, 'PartyPresetFolderEditor').props.index.foldersById.get(10).parentFolderId, 11);

    const failedMoveCalls: unknown[] = [];
    const failedRenderer = await renderList({
      partyPresetCatalog: catalogResource(FOLDER_CATALOG),
      onMovePartyPresetFolder: async (folderId, request) => {
        failedMoveCalls.push({ folderId, request });
        throw new Error('move failed');
      },
    });
    await act(async () => failedRenderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => findHost(failedRenderer.root, 'PartyPresetFolderEditor').props.onMove(10, { parentFolderId: 11, displayOrder: 0 }));
    assert.deepEqual(failedMoveCalls, [{ folderId: 10, request: { parentFolderId: 11, displayOrder: 0 } }]);
    assert.equal(textCount(failedRenderer.root, 'move failed'), 1);
    assert.equal(findHost(failedRenderer.root, 'PartyPresetFolderEditor').props.index.foldersById.get(10).parentFolderId, null);
  });

  it('leaves folder optimism and recovery to the catalog owner snapshot', async () => {
    const pending = deferred<PartyPresetCatalogResponse>();
    let retries = 0;
    const renderer = await renderList({
      partyPresetCatalog: { ...catalogResource(FOLDER_CATALOG), retry: () => { retries += 1; } },
      onMovePartyPresetFolder: async () => pending.promise,
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    const editor = findHost(renderer.root, 'PartyPresetFolderEditor');
    await act(async () => {
      void editor.props.onMove(10, { parentFolderId: 11, displayOrder: 0 });
      await Promise.resolve();
    });
    assert.equal(findHost(renderer.root, 'PartyPresetFolderEditor').props.index.foldersById.get(10).parentFolderId, null);

    await act(async () => pending.reject(new Error('move failed')));
    assert.equal(retries, 0);
    assert.equal(findHost(renderer.root, 'PartyPresetFolderEditor').props.index.foldersById.get(10).parentFolderId, null);
    assert.equal(textCount(renderer.root, 'move failed'), 1);
  });

  it('adopts the catalog owner projected folder order while a move is pending', async () => {
    const pending = deferred<PartyPresetCatalogResponse>();
    const initial: PartyPresetCatalogResponse = {
      folders: [folder(1, 'A', null, 0), folder(2, 'B', null, 1), folder(3, 'C', null, 2)],
      presets: [],
    };
    const projected: PartyPresetCatalogResponse = {
      folders: [folder(2, 'B', null, 0), folder(3, 'C', null, 1), folder(1, 'A', null, 2)],
      presets: [],
    };
    const props = listProps({
      partyPresetCatalog: catalogResource(initial),
      onMovePartyPresetFolder: async () => pending.promise,
    });
    const renderer = await renderListProps(props);
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => {
      void findHost(renderer.root, 'PartyPresetFolderEditor').props.onMove(1, { parentFolderId: null, displayOrder: 2 });
      await Promise.resolve();
    });
    await act(async () => {
      renderer.update(React.createElement(PartyPresetList, {
        ...props,
        partyPresetCatalog: catalogResource(projected),
      }));
      await Promise.resolve();
    });
    assert.deepEqual(
      findHost(renderer.root, 'PartyPresetFolderEditor').props.index.childFolderIdsByParent.get(null),
      [2, 3, 1],
    );
    await act(async () => pending.resolve(projected));
  });

  it('keeps multiple character-catalog folders open independently', async () => {
    const renderer = await renderList({ partyPresetCatalog: catalogResource(FOLDER_CATALOG) });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 0개, 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '퀘스트 폴더, 프리셋 0개, 열기' }).props.onPress());
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 0개, 닫기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '퀘스트 폴더, 프리셋 0개, 닫기' }));
  });

  it('submits a numeric folder id and the complete preset sibling set when reordering', async () => {
    const requests: unknown[] = [];
    const renderer = await renderList({
      partyPresetCatalog: catalogResource(FOLDER_PRESETS_CATALOG),
      onReorderPartyPresets: async (request) => { requests.push(request); return [...FOLDER_PRESETS_CATALOG.presets].reverse(); },
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 2개, 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '서관, 대표 프리셋' }).props.onPress());
    const draggable = findHost(renderer.root, 'DraggableFlatList');
    const rows = draggable.props.data as PartyPresetResponse[];
    await act(async () => draggable.props.onDragEnd({ data: [rows[1], rows[0]], from: 0, to: 1 }));
    assert.deepEqual(requests, [{ folderId: 10, presetIds: [2, 1] }]);
  });

  it('renders catalog preset order and adopts the owner snapshot after reorder', async () => {
    const pending = deferred<PartyPresetResponse[]>();
    const catalog: PartyPresetCatalogResponse = {
      ...FOLDER_PRESETS_CATALOG,
      presets: [
        { ...FOLDER_PRESETS_CATALOG.presets[1]!, displayOrder: 1 },
        { ...FOLDER_PRESETS_CATALOG.presets[0]!, displayOrder: 0 },
      ],
    };
    const renderer = await renderList({
      partyPresetCatalog: catalogResource(catalog),
      onReorderPartyPresets: async () => pending.promise,
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 2개, 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '서관, 대표 프리셋' }).props.onPress());
    let draggable = findHost(renderer.root, 'DraggableFlatList');
    assert.deepEqual((draggable.props.data as PartyPresetResponse[]).map(({ id }) => id), [1, 2]);
    const rows = draggable.props.data as PartyPresetResponse[];
    await act(async () => {
      void draggable.props.onDragEnd({ data: [rows[1], rows[0]], from: 0, to: 1 });
      await Promise.resolve();
    });
    draggable = findHost(renderer.root, 'DraggableFlatList');
    assert.deepEqual((draggable.props.data as PartyPresetResponse[]).map(({ id }) => id), [1, 2]);
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
    const props = listProps({ partyPresetCatalog: catalogResource(FOLDER_CATALOG) });
    const renderer = await renderListProps(props);
    await act(async () => renderer.update(React.createElement(PartyPresetList, { ...props, authenticated: false })));
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '전투 폴더, 프리셋 0개, 열기' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '전투 폴더, 프리셋 0개, 열기' }).length, 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '폴더 편집 시작' }).length, 0);
  });

  it('adopts the latest catalog resource supplied by its owner', async () => {
    const olderProps = listProps({ partyPresetCatalog: catalogResource({ folders: [folder(31, '오래됨', null, 0)], presets: [] }) });
    const renderer = await renderListProps(olderProps);
    const newerProps = { ...olderProps, partyPresetCatalog: catalogResource({ folders: [folder(30, '최신', null, 0)], presets: [] }) };
    await act(async () => renderer.update(React.createElement(PartyPresetList, newerProps)));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '최신 폴더, 프리셋 0개, 열기' }));
    assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '오래됨 폴더, 프리셋 0개, 열기' }).length, 0);
  });

  it('retries a failed shared catalog without replacing its user-facing error', async () => {
    let retries = 0;
    const renderer = await renderList({
      partyPresetCatalog: makePartyPresetCatalogResource(
        { folders: [], presets: [] },
        {
          error: '프리셋을 불러오지 못했습니다.',
          retry: () => { retries += 1; },
        },
      ),
    });

    assert.equal(textCount(renderer.root, '프리셋을 불러오지 못했습니다.'), 1);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '프리셋 다시 시도' }).props.onPress();
    });
    assert.equal(retries, 1);
  });

  it('clears a local mutation failure after the shared retry recovers', async () => {
    let retries = 0;
    const failedResource = makePartyPresetCatalogResource(CATALOG, {
      mutationError: '프리셋을 변경하지 못했습니다.',
      retry: () => { retries += 1; },
    });
    const props = listProps({
      partyPresetCatalog: failedResource,
      onUpdatePartyPreset: async () => {
        throw new Error('상세 저장 실패');
      },
    });
    const renderer = await renderListProps(props);
    await openUnassignedPreset(renderer, '서관, 대표 프리셋');
    await act(async () => {
      await findButtonByText(renderer.root, '저장').props.onPress();
    });
    assert.equal(textCount(renderer.root, '상세 저장 실패'), 1);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '프리셋 다시 시도' }).props.onPress();
      renderer.update(React.createElement(PartyPresetList, {
        ...props,
        partyPresetCatalog: {
          ...failedResource,
          error: null,
          mutationError: null,
        },
      }));
    });

    assert.equal(retries, 1);
    assert.equal(textCount(renderer.root, '상세 저장 실패'), 0);
    assert.equal(textCount(renderer.root, '프리셋을 변경하지 못했습니다.'), 0);
    assert.equal(renderer.root.findAllByProps({ accessibilityRole: 'alert' }).length, 0);
  });

  it('isolates a pending preset mutation across auth loss and reverse relogin completion', async () => {
    const oldUpdate = deferred<PartyPresetResponse>();
    const newCreate = deferred<PartyPresetResponse>();
    const latestCatalog: PartyPresetCatalogResponse = {
      folders: [folder(30, '최신', null, 0)],
      presets: [],
    };
    const oldProps = listProps({
      partyPresetCatalog: catalogResource(CATALOG),
      onUpdatePartyPreset: async () => oldUpdate.promise,
    });
    const renderer = await renderListProps(oldProps);
    await openUnassignedPreset(renderer, '서관, 대표 프리셋');
    await act(async () => {
      void findButtonByText(renderer.root, '저장').props.onPress();
      await Promise.resolve();
    });

    await act(async () => renderer.update(React.createElement(PartyPresetList, { ...oldProps, authenticated: false })));
    const newProps = listProps({
      authenticated: true,
      partyPresetCatalog: catalogResource(latestCatalog),
      onCreatePartyPreset: async () => newCreate.promise,
    });
    await act(async () => {
      renderer.update(React.createElement(PartyPresetList, newProps));
      await Promise.resolve();
    });
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '최신 폴더, 프리셋 0개, 열기' }));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 추가' }).props.onPress());
    await act(async () => {
      void findButtonByText(renderer.root, '저장').props.onPress();
      await Promise.resolve();
      renderer.update(React.createElement(PartyPresetList, {
        ...newProps,
        partyPresetCatalog: { ...newProps.partyPresetCatalog, mutating: true },
      }));
    });

    await act(async () => oldUpdate.resolve({ ...PRESETS[0]!, name: '이전 계정 완료' }));
    assert.equal(renderer.root.findByProps({ accessibilityLabel: '프리셋 이름 입력' }).props.value, '새 프리셋');
    assert.equal(findButtonByText(renderer.root, '저장 중').props.disabled, true);
    assert.equal(textCount(renderer.root, '이전 계정 완료'), 0);

    await act(async () => newCreate.resolve({ ...PRESETS[0]!, id: 40, accountId: 2, name: '새 계정 완료' }));
  });

  it('isolates a pending folder mutation across auth loss and reverse relogin completion', async () => {
    const oldCreate = deferred<PartyPresetCatalogResponse>();
    const newCreate = deferred<PartyPresetCatalogResponse>();
    const latestCatalog: PartyPresetCatalogResponse = {
      folders: [folder(30, '최신', null, 0)],
      presets: [],
    };
    const oldProps = listProps({
      partyPresetCatalog: catalogResource(FOLDER_CATALOG),
      onCreatePartyPresetFolder: async () => oldCreate.promise,
    });
    const renderer = await renderListProps(oldProps);
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => {
      void findHost(renderer.root, 'PartyPresetFolderEditor').props.onCreate({ name: '이전 폴더', parentFolderId: null });
      await Promise.resolve();
    });

    await act(async () => renderer.update(React.createElement(PartyPresetList, { ...oldProps, authenticated: false })));
    const newProps = listProps({
      authenticated: true,
      partyPresetCatalog: catalogResource(latestCatalog),
      onCreatePartyPresetFolder: async () => newCreate.promise,
    });
    await act(async () => {
      renderer.update(React.createElement(PartyPresetList, newProps));
      await Promise.resolve();
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '폴더 편집 시작' }).props.onPress());
    await act(async () => {
      void findHost(renderer.root, 'PartyPresetFolderEditor').props.onCreate({ name: '새 폴더', parentFolderId: null });
      await Promise.resolve();
      renderer.update(React.createElement(PartyPresetList, {
        ...newProps,
        partyPresetCatalog: { ...newProps.partyPresetCatalog, mutating: true },
      }));
    });

    await act(async () => oldCreate.reject(new Error('이전 계정 실패')));
    assert.equal(findHost(renderer.root, 'PartyPresetFolderEditor').props.disabled, true);
    assert.equal(textCount(renderer.root, '이전 계정 실패'), 0);

    await act(async () => newCreate.resolve({
      ...latestCatalog,
      folders: [...latestCatalog.folders, folder(31, '새 폴더', null, 1)],
    }));
  });

  it('scrolls a beyond-first-viewport tree selection into view and focuses its mounted editor', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    scrollToIndexCalls.length = 0;
    accessibilityFocusCalls.length = 0;
    const deepPresets = Array.from({ length: 12 }, (_, index) => ({
      ...preset(index + 1, `프리셋 ${index + 1}`, index, index === 0),
      folderId: 10,
    }));
    const renderer = await renderList({
      partyPresetCatalog: catalogResource({ folders: [folder(10, '전투', null, 0)], presets: deepPresets }),
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 12개, 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 12' }).props.onPress());
    await act(async () => { context.mock.timers.tick(120); });

    assert.ok(scrollToIndexCalls.some((call) => call.index === 11));
    assert.ok(accessibilityFocusCalls.includes(77));
  });

  it('does not rebuild unrelated memoized virtual rows while editing text', async () => {
    const renderer = await renderList({ partyPresetCatalog: catalogResource(FOLDER_PRESETS_CATALOG) });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더, 프리셋 2개, 열기' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '서관, 대표 프리셋' }).props.onPress());
    hostRenderCounts.clear();
    await act(async () => findHost(renderer.root, 'TextInput').props.onChangeText('편집 중'));
    assert.equal(hostRenderCounts.get('party-preset-managed-row-2') ?? 0, 0);
  });

});

type ActionOverrides = {
  onCreatePartyPreset?: PartyPresetCatalogActions['createPreset'];
  onUpdatePartyPreset?: PartyPresetCatalogActions['updatePreset'];
  onMakePartyPresetPrimary?: PartyPresetCatalogActions['makePresetPrimary'];
  onReorderPartyPresets?: PartyPresetCatalogActions['reorderPresets'];
  onDeletePartyPreset?: PartyPresetCatalogActions['deletePreset'];
  onCreatePartyPresetFolder?: PartyPresetCatalogActions['createFolder'];
  onRenamePartyPresetFolder?: PartyPresetCatalogActions['renameFolder'];
  onReorderPartyPresetFolders?: PartyPresetCatalogActions['reorderFolders'];
  onMovePartyPresetFolder?: PartyPresetCatalogActions['moveFolder'];
  onDeletePartyPresetFolder?: PartyPresetCatalogActions['deleteFolder'];
};
type Overrides = Partial<React.ComponentProps<typeof PartyPresetList>> & ActionOverrides;

async function renderList(overrides: Overrides = {}): Promise<ReactTestRenderer> {
  const props = listProps(overrides);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(ControlledPartyPresetList, props));
    await Promise.resolve();
  });
  return renderer;
}

function ControlledPartyPresetList(props: React.ComponentProps<typeof PartyPresetList>) {
  const [catalog, setCatalog] = React.useState(props.partyPresetCatalog.catalog);
  const [mutating, setMutating] = React.useState(false);
  const pendingCountRef = React.useRef(0);
  const sourceActions = props.partyPresetCatalog.actions;
  const runMutation = React.useCallback(async <T,>(
    operation: () => Promise<T>,
    project: (result: T) => void,
  ): Promise<T> => {
    pendingCountRef.current += 1;
    setMutating(true);
    try {
      const result = await operation();
      project(result);
      return result;
    } finally {
      pendingCountRef.current -= 1;
      setMutating(pendingCountRef.current > 0);
    }
  }, []);
  const actions = React.useMemo<PartyPresetCatalogActions>(() => ({
    createPreset: (request) => runMutation(
      () => sourceActions.createPreset(request),
      (created) => setCatalog((current) => ({
        ...current,
        presets: [...current.presets.filter(({ id }) => id !== created.id), created],
      })),
    ),
    updatePreset: (presetId, request) => runMutation(
      () => sourceActions.updatePreset(presetId, request),
      (updated) => setCatalog((current) => ({
        ...current,
        presets: current.presets.map((preset) => preset.id === updated.id ? updated : preset),
      })),
    ),
    makePresetPrimary: (presetId) => runMutation(
      () => sourceActions.makePresetPrimary(presetId),
      (updated) => setCatalog((current) => ({
        ...current,
        presets: current.presets.map((preset) => preset.id === updated.id
          ? { ...updated, isPrimary: true }
          : { ...preset, isPrimary: false }),
      })),
    ),
    reorderPresets: (request) => runMutation(
      () => sourceActions.reorderPresets(request),
      (presets) => setCatalog((current) => ({ ...current, presets })),
    ),
    deletePreset: (presetId) => runMutation(
      () => sourceActions.deletePreset(presetId),
      () => setCatalog((current) => ({
        ...current,
        presets: current.presets.filter(({ id }) => id !== presetId),
      })),
    ),
    createFolder: (request) => runMutation(
      () => sourceActions.createFolder(request),
      setCatalog,
    ),
    renameFolder: (folderId, request) => runMutation(
      () => sourceActions.renameFolder(folderId, request),
      setCatalog,
    ),
    reorderFolders: (request) => runMutation(
      () => sourceActions.reorderFolders(request),
      setCatalog,
    ),
    moveFolder: (folderId, request) => runMutation(
      () => sourceActions.moveFolder(folderId, request),
      setCatalog,
    ),
    deleteFolder: (folderId) => runMutation(
      () => sourceActions.deleteFolder(folderId),
      setCatalog,
    ),
  }), [runMutation, sourceActions]);
  const resource = React.useMemo(
    () => ({ ...props.partyPresetCatalog, catalog, mutating, actions }),
    [actions, catalog, mutating, props.partyPresetCatalog],
  );
  return React.createElement(PartyPresetList, {
    ...props,
    partyPresetCatalog: resource,
  });
}

function listProps(overrides: Overrides = {}): React.ComponentProps<typeof PartyPresetList> {
  const {
    onCreatePartyPreset,
    onUpdatePartyPreset,
    onMakePartyPresetPrimary,
    onReorderPartyPresets,
    onDeletePartyPreset,
    onCreatePartyPresetFolder,
    onRenamePartyPresetFolder,
    onReorderPartyPresetFolders,
    onMovePartyPresetFolder,
    onDeletePartyPresetFolder,
    partyPresetCatalog = catalogResource({ folders: [], presets: PRESETS }),
    ...componentOverrides
  } = overrides;
  return {
    authenticated: true,
    characters: [],
    ...componentOverrides,
    partyPresetCatalog: {
      ...partyPresetCatalog,
      actions: {
        ...partyPresetCatalog.actions,
        createPreset: onCreatePartyPreset ?? (async () => PRESETS[0]!),
        updatePreset: onUpdatePartyPreset ?? (async () => PRESETS[0]!),
        makePresetPrimary: onMakePartyPresetPrimary ?? (async () => PRESETS[0]!),
        reorderPresets: onReorderPartyPresets ?? (async () => PRESETS),
        deletePreset: onDeletePartyPreset ?? (async () => null),
        createFolder: onCreatePartyPresetFolder ?? partyPresetCatalog.actions.createFolder,
        renameFolder: onRenamePartyPresetFolder ?? partyPresetCatalog.actions.renameFolder,
        reorderFolders: onReorderPartyPresetFolders ?? partyPresetCatalog.actions.reorderFolders,
        moveFolder: onMovePartyPresetFolder ?? partyPresetCatalog.actions.moveFolder,
        deleteFolder: onDeletePartyPresetFolder ?? partyPresetCatalog.actions.deleteFolder,
      },
    },
  };
}

function catalogResource(catalog: PartyPresetCatalogResponse) {
  return makePartyPresetCatalogResource(catalog);
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

function textCount(root: ReactTestInstance, text: string): number {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length;
}

function findAllText(root: ReactTestInstance): string[] {
  return root.findAll((node) => (node.type as unknown) === 'Text').map((node) => node.children.join(''));
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
  await act(async () => renderer.root.findByProps({ accessibilityLabel: '미지정 폴더, 프리셋 2개, 열기' }).props.onPress());
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
