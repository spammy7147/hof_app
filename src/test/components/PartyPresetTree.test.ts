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
  it('renders a compact expanded path and one preset per full-width row', async () => {
    const renderer = await renderHarness();

    assert.equal(findAllByTestId(renderer.root, 'party-preset-folder-row').length, 3);
    assert.equal(findAllByTestId(renderer.root, 'party-preset-row').length, 2);
    assert.deepEqual(
      renderer.root.findByProps({ accessibilityLabel: '화속성 폴더 닫기' }).props.accessibilityState,
      { expanded: true },
    );
    assert.equal(findAllByTestId(renderer.root, 'party-preset-row')[0]?.props.depth, 3);
    assert.equal(textCount(renderer.root, '구성원 2명'), 1);
    assert.equal(textCount(renderer.root, '대표'), 1);
  });

  it('hides the tree during global search and restores its expanded accessibility state when cleared', async () => {
    const renderer = await renderHarness();
    const input = renderer.root.findByProps({ accessibilityLabel: '테스트 프리셋 검색' });

    await act(async () => { input.props.onChangeText('화속'); });

    assert.equal(findAllByTestId(renderer.root, 'party-preset-folder-row').length, 0);
    const results = findAllByTestId(renderer.root, 'party-preset-search-result');
    assert.equal(results.length, 3);
    assert.ok(results.every(({ props }) => props.depth === 0));
    assert.ok(results.every(({ props }) => props.fullWidth === true));
    assert.equal(textCount(renderer.root, '전투 › 레이드 › 화속성'), 2);
    assert.equal(textCount(renderer.root, '미지정'), 1);

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '테스트 프리셋 검색' }).props.onChangeText(''); });

    assert.equal(findAllByTestId(renderer.root, 'party-preset-folder-row').length, 3);
    assert.deepEqual(
      renderer.root.findByProps({ accessibilityLabel: '화속성 폴더 닫기' }).props.accessibilityState,
      { expanded: true },
    );
    assert.equal(findAllByTestId(renderer.root, 'party-preset-row').length, 2);
  });

  it('changes the single expanded path from accessible folder buttons', async () => {
    const renderer = await renderHarness();

    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '레이드 폴더 닫기' }).props.onPress(); });

    assert.equal(findAllByTestId(renderer.root, 'party-preset-folder-row').length, 2);
    assert.deepEqual(
      renderer.root.findByProps({ accessibilityLabel: '레이드 폴더 열기' }).props.accessibilityState,
      { expanded: false },
    );
    assert.equal(findAllByTestId(renderer.root, 'party-preset-row').length, 0);
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
      [{ selected: false }, { selected: true }],
    );

    await act(async () => { rows[0]?.props.onPress(); });

    assert.deepEqual(selectedPresetIds, [10]);
  });
});

describe('PartyPresetSearchResults', () => {
  it('renders a polite no-results state', async () => {
    const renderer = await renderHarness('없는 이름');

    const empty = renderer.root.findByProps({ accessibilityLiveRegion: 'polite' });
    assert.equal(textCount(empty, '일치하는 프리셋이 없습니다.'), 1);
    assert.equal(findAllByTestId(renderer.root, 'party-preset-search-result').length, 0);
  });
});

function CatalogHarness({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [expandedPath, setExpandedPath] = useState<readonly (number | null)[]>([1, 2, 3]);
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
        expandedPath,
        selectedPresetId: 10,
        onExpandedPathChange: setExpandedPath,
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
  selectedPresetId,
  onSelectPreset,
}: {
  selectedPresetId: number | null;
  onSelectPreset: (preset: PartyPresetResponse) => void;
}): Promise<ReactTestRenderer> {
  const index = indexPartyPresetCatalog(CATALOG);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(PartyPresetTree, {
      index,
      expandedPath: [1, 2, 3],
      selectedPresetId,
      onExpandedPathChange: () => undefined,
      onSelectPreset,
    }));
  });
  return renderer;
}

const CATALOG: PartyPresetCatalogResponse = {
  folders: [
    folder(1, '전투', null),
    folder(2, '레이드', 1),
    folder(3, '화속성', 2),
  ],
  presets: [
    preset(10, '화속성 주력', 3, true, 2),
    preset(11, '화속성 예비', 3, false, 0),
    preset(12, '화속성 미지정', null, false, 1),
  ],
};

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

function textCount(root: ReactTestInstance, text: string): number {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === text).length;
}
