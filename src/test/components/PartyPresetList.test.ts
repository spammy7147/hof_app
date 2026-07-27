import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { BattlePartyMember } from '../../main/domain/battleParty';
import type { PartyPresetCatalogResponse, PartyPresetResponse } from '../../main/types/api';

type SwipeableMockMethods = { close: () => void; closeCalls: number };

const dragCalls: PartyPresetResponse[] = [];
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
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
  Pressable: host('Pressable'),
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
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
    const reorderRequests: number[][] = [];
    const renderer = await renderList({
      onReorderPartyPresets: async ({ presetIds }) => {
        reorderRequests.push(presetIds);
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

    assert.deepEqual(reorderRequests, [[2, 1]]);
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
    const renderer = await renderList({
      onGetPartyPresetCatalog: async () => CATALOG,
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

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.presetId, 1);
    assert.equal((updateCalls[0]?.request as { folderId: number | null }).folderId, 10);
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
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 폴더 삭제 확인' }).props.onPress());
    assert.deepEqual(deletedFolders, [10]);
    assert.deepEqual(deletedPresets, []);
  });
});

type Overrides = Partial<React.ComponentProps<typeof PartyPresetList>>;

async function renderList(overrides: Overrides = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(PartyPresetList, {
      authenticated: true,
      characters: [],
      onListPartyPresets: async () => PRESETS,
      onCreatePartyPreset: async () => PRESETS[0]!,
      onUpdatePartyPreset: async () => PRESETS[0]!,
      onMakePartyPresetPrimary: async () => PRESETS[0]!,
      onReorderPartyPresets: async () => PRESETS,
      onDeletePartyPreset: async () => null,
      ...overrides,
    }));
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

function textCount(root: ReactTestInstance, text: string): number {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length;
}

function findHost(root: ReactTestInstance, name: string): ReactTestInstance {
  return root.find((node) => (node.type as unknown) === name);
}

function findHosts(root: ReactTestInstance, name: string): ReactTestInstance[] {
  return root.findAll((node) => (node.type as unknown) === name);
}
