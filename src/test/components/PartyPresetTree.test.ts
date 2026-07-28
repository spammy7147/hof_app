import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React, { useMemo, useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { indexPartyPresetCatalog, searchPartyPresetCatalog } from '../../main/domain/partyPresetCatalog';
import type {
  PartyPresetCatalogResponse,
  PartyPresetFolderResponse,
  PartyPresetResponse,
} from '../../main/types/api';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({}), []);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const flatList = (props: Record<string, unknown>) => React.createElement(
  'FlatList',
  props,
  (props.data as unknown[]).map((item, index) => React.createElement(
    React.Fragment,
    { key: (props.keyExtractor as (value: unknown, index: number) => string)(item, index) },
    (props.renderItem as (value: { item: unknown; index: number }) => React.ReactNode)({ item, index }),
  )),
  (props.data as unknown[]).length === 0 ? props.ListEmptyComponent as React.ReactNode : null,
);
const reactNativeMock = {
  FlatList: flatList,
  Pressable: host('Pressable'),
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
  return originalLoad(request, parent, isMain);
};
const { PartyPresetTree } = require(
  '../../main/components/PartyPresetTree',
) as typeof import('../../main/components/PartyPresetTree');
const { PartyPresetSearchResults } = require(
  '../../main/components/PartyPresetSearchResults',
) as typeof import('../../main/components/PartyPresetSearchResults');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PartyPresetTree', () => {
  it('keeps A, B, and unassigned open together with all direct presets visible', async () => {
    const renderer = await renderHarness();

    assert.deepEqual(
      [['A', 2], ['B', 1]].map(([name, count]) => renderer.root.findByProps({ accessibilityLabel: `${name} 폴더, 프리셋 ${count}개, 닫기` }).props.accessibilityState),
      [{ expanded: true }, { expanded: true }],
    );
    assert.deepEqual(
      renderer.root.findByProps({ accessibilityLabel: '미지정 폴더, 프리셋 1개, 닫기' }).props.accessibilityState,
      { expanded: true },
    );
    assert.equal(textCount(renderer.root, 'A direct'), 1);
    assert.equal(textCount(renderer.root, 'B direct'), 1);
    assert.equal(textCount(renderer.root, 'unassigned direct'), 1);
    assert.equal(findHosts(renderer.root, 'FlatList').length, 1);
    const list = findHosts(renderer.root, 'FlatList')[0]!;
    assert.equal(list.props.scrollEnabled, undefined);
    assert.equal(list.props.style.flexShrink, 1);
    assert.ok(flattenPressableStyle(findAllByTestId(renderer.root, 'party-preset-folder-row')[0]!).minHeight as number >= 44);
  });

  it('opens B and unassigned sequentially without closing A or either other group', async () => {
    const renderer = await renderTree({ expandedFolderIds: new Set([1]) });

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'B 폴더, 프리셋 1개, 열기' }).props.onPress(); });
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '미지정 폴더, 프리셋 1개, 열기' }).props.onPress(); });

    for (const [name, count] of [['A', 2], ['B', 1], ['미지정', 1]] as const) {
      assert.deepEqual(
        renderer.root.findByProps({ accessibilityLabel: `${name} 폴더, 프리셋 ${count}개, 닫기` }).props.accessibilityState,
        { expanded: true },
      );
    }
    assert.equal(textCount(renderer.root, 'A direct'), 1);
    assert.equal(textCount(renderer.root, 'B direct'), 1);
    assert.equal(textCount(renderer.root, 'unassigned direct'), 1);
  });

  it('shows recursive folder counts and counts unassigned presets directly only', async () => {
    const renderer = await renderTree({ expandedFolderIds: new Set([1]) });

    assert.equal(folderCount(renderer.root, 'A'), '2');
    assert.equal(folderCount(renderer.root, 'A child'), '1');
    assert.equal(folderCount(renderer.root, 'B'), '1');
    assert.equal(folderCount(renderer.root, '미지정'), '1');
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'A 폴더, 프리셋 2개, 닫기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: 'B 폴더, 프리셋 1개, 열기' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '미지정 폴더, 프리셋 1개, 열기' }));
  });

  it('shows direct presets when an expanded folder also has child folders', async () => {
    const renderer = await renderTree({ expandedFolderIds: new Set([1]) });

    assert.equal(textCount(renderer.root, 'A child'), 1);
    assert.equal(textCount(renderer.root, 'A direct'), 1);
    assert.equal(textCount(renderer.root, 'A child direct'), 0);
  });

  it('does not show a direct-preset empty state when an expanded folder has child folders', async () => {
    const catalog = makeCatalog(
      [folder(1, 'Parent', null), folder(2, 'Child', 1)],
      [preset(20, 'Child preset', 2, false, 1)],
    );
    const renderer = await renderTree({ catalog, expandedFolderIds: new Set([1]) });

    assert.equal(textCount(renderer.root, 'Child'), 1);
    assert.equal(textCount(renderer.root, '이 폴더에 프리셋이 없습니다.'), 0);
  });

  it('indents browsing preset rows and draws a connector at their folder depth', async () => {
    const renderer = await renderTree({ expandedFolderIds: new Set([1, 2]) });
    const listRows = findHosts(renderer.root, 'FlatList')[0]!.props.data as Array<{
      kind: string;
      depth?: number;
      preset?: PartyPresetResponse;
    }>;
    const childPreset = listRows.find((row) => row.preset?.name === 'A child direct');
    assert.equal(childPreset?.depth, 1);
    const childPresetRow = findAllByTestId(renderer.root, 'party-preset-row')
      .find((row) => textCount(row, 'A child direct') === 1)!;
    const style = flattenPressableStyle(childPresetRow);

    assert.ok((style.marginLeft as number) > 0);
    assert.equal(style.borderLeftWidth, 2);
  });

  it('uses compact single-line browsing preset rows without member counts by default', async () => {
    const renderer = await renderTree({
      expandedFolderIds: new Set([1]),
    });

    assert.equal(textCount(renderer.root, 'A direct'), 1);
    assert.equal(renderer.root.findAll((node) => (
      (node.type as unknown) === 'Text' && /^구성원 \d+명$/.test(node.children.join(''))
    )).length, 0);
    const rowStyle = flattenPressableStyle(findAllByTestId(renderer.root, 'party-preset-row')[0]!);
    assert.equal(rowStyle.minHeight, 44);
  });

  it('hides the tree during global search and restores every expanded folder when cleared', async () => {
    const renderer = await renderHarness();
    const input = renderer.root.findByProps({ accessibilityLabel: '테스트 프리셋 검색' });

    await act(async () => { input.props.onChangeText('direct'); });

    assert.equal(findAllByTestId(renderer.root, 'party-preset-folder-row').length, 0);
    const results = findAllByTestId(renderer.root, 'party-preset-search-result');
    assert.equal(results.length, 4);
    assert.equal(findHosts(renderer.root, 'FlatList')[0]?.props.style.flexShrink, 1);
    results.forEach(assertFullWidth);
    assert.equal(textCount(renderer.root, 'A'), 1);
    assert.equal(textCount(renderer.root, 'A › A child'), 1);
    assert.equal(textCount(renderer.root, 'B'), 1);
    assert.equal(textCount(renderer.root, '미지정'), 1);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '테스트 프리셋 검색' }).props.onChangeText(''); });

    for (const [name, count] of [['A', 2], ['B', 1], ['미지정', 1]] as const) {
      assert.deepEqual(
        renderer.root.findByProps({ accessibilityLabel: `${name} 폴더, 프리셋 ${count}개, 닫기` }).props.accessibilityState,
        { expanded: true },
      );
    }
  });

  it('selects the pressed preset and exposes selected state only on its matching row', async () => {
    const selectedPresetIds: number[] = [];
    const renderer = await renderTree({
      selectedPresetId: 11,
      onSelectPreset: (preset) => { selectedPresetIds.push(preset.id); },
    });
    const rows = findAllByTestId(renderer.root, 'party-preset-row');

    assert.deepEqual(
      rows.map(({ props }) => props.accessibilityState),
      [{ selected: true }, { selected: false }, { selected: false }, { selected: false }],
    );

    await act(async () => { rows[1]?.props.onPress(); });

    assert.deepEqual(selectedPresetIds, [10]);
  });

  it('prunes stale expanded IDs while preserving valid expanded IDs', async () => {
    const normalizedSets: Array<ReadonlySet<number | null>> = [];
    await renderTree({
      expandedFolderIds: new Set([1, 999, null]),
      onExpandedFolderIdsChange: (folderIds) => { normalizedSets.push(folderIds); },
    });

    assert.equal(normalizedSets.length, 1);
    assert.deepEqual([...normalizedSets[0]!], [1, null]);
  });

  it('announces empty normal and unassigned folders politely', async () => {
    const normal = await renderTree({
      catalog: makeCatalog([folder(1, '빈 폴더', null)]),
      expandedFolderIds: new Set([1]),
    });
    const unassigned = await renderTree({
      catalog: makeCatalog([folder(1, '빈 폴더', null)]),
      expandedFolderIds: new Set([null]),
    });

    assert.equal(textCount(normal.root.findByProps({ accessibilityLiveRegion: 'polite' }), '이 폴더에 프리셋이 없습니다.'), 1);
    assert.equal(textCount(unassigned.root.findByProps({ accessibilityLiveRegion: 'polite' }), '미지정 프리셋이 없습니다.'), 1);
  });

  it('selects an unassigned preset from the virtual group', async () => {
    const selectedPresetIds: number[] = [];
    const renderer = await renderTree({
      expandedFolderIds: new Set([null]),
      onSelectPreset: (preset) => { selectedPresetIds.push(preset.id); },
    });

    await act(async () => { findAllByTestId(renderer.root, 'party-preset-row')[0]?.props.onPress(); });

    assert.deepEqual(selectedPresetIds, [13]);
  });

  it('renders independently expanded folders depth-first', async () => {
    const renderer = await renderTree({ expandedFolderIds: new Set([1, 2, 4, null]) });
    const rows = findHosts(renderer.root, 'FlatList')[0]!.props.data as Array<{
      kind: string;
      name?: string;
      preset?: PartyPresetResponse;
    }>;

    assert.deepEqual(rows.map((row) => {
      if (row.kind === 'folder') return `folder:${row.name}`;
      if (row.kind === 'preset') return `preset:${row.preset?.name}`;
      return row.kind;
    }), [
      'folder:A',
      'folder:A child',
      'preset:A child direct',
      'preset:A direct',
      'folder:B',
      'preset:B direct',
      'unassigned',
      'preset:unassigned direct',
    ]);
  });

  it('uses compact green folder styling with accessible touch height', async () => {
    const renderer = await renderTree({ expandedFolderIds: new Set([1]) });
    const openStyle = flattenPressableStyle(renderer.root.findByProps({ accessibilityLabel: 'A 폴더, 프리셋 2개, 닫기' }));
    const closedStyle = flattenPressableStyle(renderer.root.findByProps({ accessibilityLabel: 'B 폴더, 프리셋 1개, 열기' }));
    const folderName = renderer.root.findAll((node) => (
      (node.type as unknown) === 'Text' && node.children.join('') === 'A'
    ))[0]!;

    assert.equal(closedStyle.backgroundColor, '#15251f');
    assert.equal(closedStyle.borderColor, '#2e5143');
    assert.equal(openStyle.backgroundColor, '#1b342b');
    assert.equal(openStyle.borderColor, '#4f806c');
    assert.ok((openStyle.minHeight as number) >= 44);
    assert.equal(folderName.props.style.color, '#cce9dc');
    assert.equal(folderName.props.style.fontSize, 13);
    assert.equal(folderName.props.style.fontWeight, '900');
  });
});

describe('PartyPresetSearchResults', () => {
  it('renders a polite no-results state', async () => {
    const renderer = await renderHarness('없는 이름');

    const empty = renderer.root.findByProps({ accessibilityLiveRegion: 'polite' });
    assert.equal(textCount(empty, '일치하는 프리셋이 없습니다.'), 1);
    assert.equal(findAllByTestId(renderer.root, 'party-preset-search-result').length, 0);
  });

  it('selects the pressed global result and marks only the matching result selected', async () => {
    const selectedPresetIds: number[] = [];
    const index = indexPartyPresetCatalog(CATALOG);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(PartyPresetSearchResults, {
        results: searchPartyPresetCatalog(index, 'direct'),
        selectedPresetId: 12,
        onSelectPreset: (preset) => { selectedPresetIds.push(preset.id); },
      }));
    });
    const rows = findAllByTestId(renderer.root, 'party-preset-search-result');

    assert.deepEqual(
      rows.map(({ props }) => props.accessibilityState),
      [{ selected: false }, { selected: false }, { selected: true }, { selected: false }],
    );
    await act(async () => { rows[0]?.props.onPress(); });
    assert.deepEqual(selectedPresetIds, [10]);
  });

  it('uses compact search results without member counts or breadcrumb indentation by default', async () => {
    const index = indexPartyPresetCatalog(CATALOG);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(PartyPresetSearchResults, {
        results: searchPartyPresetCatalog(index, 'direct'),
        selectedPresetId: null,
        onSelectPreset: () => undefined,
      }));
    });

    const rows = findAllByTestId(renderer.root, 'party-preset-search-result');
    assert.equal(rows.length, 4);
    rows.forEach((row) => {
      const style = flattenPressableStyle(row);
      assert.equal(style.marginLeft, 0);
      assert.equal(style.width, '100%');
      assert.equal(style.borderLeftWidth, undefined);
      assert.equal(style.minHeight, 44);
    });
    assert.equal(textCount(renderer.root, 'A › A child'), 1);
    assert.equal(renderer.root.findAll((node) => (
      (node.type as unknown) === 'Text' && /^구성원 \d+명$/.test(node.children.join(''))
    )).length, 0);
  });
});

function CatalogHarness({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [expandedFolderIds, setExpandedFolderIds] = useState<ReadonlySet<number | null>>(
    () => new Set([1, 4, null]),
  );
  const index = useMemo(() => indexPartyPresetCatalog(CATALOG), []);
  const results = useMemo(() => searchPartyPresetCatalog(index, query), [index, query]);

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('TextInput', {
      accessibilityLabel: '테스트 프리셋 검색',
      onChangeText: setQuery,
      value: query,
    }),
    query.trim().length > 0
      ? React.createElement(PartyPresetSearchResults, {
        results,
        selectedPresetId: 10,
        onSelectPreset: () => undefined,
      })
      : React.createElement(PartyPresetTree, {
        index,
        expandedFolderIds,
        selectedPresetId: 10,
        onExpandedFolderIdsChange: setExpandedFolderIds,
        onSelectPreset: () => undefined,
      }),
  );
}

async function renderHarness(initialQuery = ''): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(CatalogHarness, { initialQuery })); });
  return renderer;
}

async function renderTree({
  catalog = CATALOG,
  expandedFolderIds = new Set([1, 2, 4, null]),
  selectedPresetId = null,
  onExpandedFolderIdsChange,
  onSelectPreset = () => undefined,
}: {
  catalog?: PartyPresetCatalogResponse;
  expandedFolderIds?: ReadonlySet<number | null>;
  selectedPresetId?: number | null;
  onExpandedFolderIdsChange?: (folderIds: ReadonlySet<number | null>) => void;
  onSelectPreset?: (preset: PartyPresetResponse) => void;
}): Promise<ReactTestRenderer> {
  const index = indexPartyPresetCatalog(catalog);
  function StatefulTree() {
    const [folderIds, setFolderIds] = useState(expandedFolderIds);
    const handleChange = (nextFolderIds: ReadonlySet<number | null>) => {
      setFolderIds(nextFolderIds);
      onExpandedFolderIdsChange?.(nextFolderIds);
    };
    return React.createElement(PartyPresetTree, {
      index,
      expandedFolderIds: folderIds,
      selectedPresetId,
      onExpandedFolderIdsChange: handleChange,
      onSelectPreset,
    });
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(StatefulTree));
  });
  return renderer;
}

const CATALOG: PartyPresetCatalogResponse = {
  folders: [
    folder(1, 'A', null),
    folder(2, 'A child', 1),
    folder(4, 'B', null),
  ],
  presets: [
    preset(10, 'A direct', 1, true, 2),
    preset(11, 'A child direct', 2, false, 0),
    preset(12, 'B direct', 4, false, 1),
    preset(13, 'unassigned direct', null, false, 1),
  ],
};

function makeCatalog(
  folders: PartyPresetFolderResponse[] = [],
  presets: PartyPresetResponse[] = [],
): PartyPresetCatalogResponse {
  return { folders, presets };
}

function folder(id: number, name: string, parentFolderId: number | null): PartyPresetFolderResponse {
  return { id, name, parentFolderId, displayOrder: 0, createdAt: '', updatedAt: '' };
}

function preset(
  id: number,
  name: string,
  folderId: number | null,
  isPrimary: boolean,
  configuredMembers: number,
): PartyPresetResponse {
  return {
    id,
    accountId: 1,
    name,
    displayOrder: id,
    isPrimary,
    members: Array.from({ length: 5 }, (_, slotIndex) => ({
      slotIndex,
      characterId: slotIndex < configuredMembers ? `character-${slotIndex}` : null,
      patternSlot: null,
    })),
    createdAt: '',
    updatedAt: '',
    folderId,
  };
}

function findAllByTestId(root: ReactTestInstance, testID: string): ReactTestInstance[] {
  return root.findAll((node) => node.props.testID === testID && typeof node.type === 'string');
}

function findHosts(root: ReactTestInstance, name: string): ReactTestInstance[] {
  return root.findAll((node) => (node.type as unknown) === name);
}

function folderCount(root: ReactTestInstance, name: string): string {
  const row = root.findAll((node) => (
    node.props.accessibilityLabel?.startsWith(`${name} 폴더, 프리셋 `)
  ))[0]!;
  return findAllByTestId(row, 'party-preset-folder-count')[0]!.children.join('');
}

function assertFullWidth(row: ReactTestInstance): void {
  const flattened = flattenPressableStyle(row);
  assert.equal(flattened.marginLeft, 0);
  assert.equal(flattened.width, '100%');
  assert.equal(flattened.alignSelf, 'stretch');
}

function flattenPressableStyle(row: ReactTestInstance): Record<string, unknown> {
  const style = row.props.style({ pressed: false }) as Array<Record<string, unknown> | null>;
  return Object.assign({}, ...style.filter((entry) => entry != null));
}

function textCount(root: ReactTestInstance, text: string): number {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length;
}
