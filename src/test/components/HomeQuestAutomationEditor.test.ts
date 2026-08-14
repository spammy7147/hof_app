import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type {
  HomeQuestResponse,
  HomeResponse,
  TypedAutomationEntryResponse,
  UpdateHomeQuestAutomationRequest,
} from '../../main/types/api';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => React.createElement(
    'FlatList',
    props,
    (props.data as HomeQuestResponse[]).map((item) => React.createElement(
      React.Fragment,
      { key: item.id },
      (props.renderItem as (value: { item: HomeQuestResponse }) => React.ReactNode)({ item }),
    )),
    (props.data as HomeQuestResponse[]).length === 0 ? props.ListEmptyComponent as React.ReactNode : null,
  ),
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
const { HomeQuestAutomationEditor } = require(
  '../../main/features/automation/components/HomeQuestAutomationEditor',
) as typeof import('../../main/features/automation/components/HomeQuestAutomationEditor');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null;
afterEach(async () => {
  if (mounted) await act(async () => mounted?.unmount());
  mounted = null;
});

describe('HomeQuestAutomationEditor', () => {
  it('자택 퀘스트를 상태별 탭과 개수로 분류한다', async () => {
    mounted = await renderEditor({ quests: questCatalog() });

    assert.equal(hasText(mounted.root, '진행 중 1'), true);
    assert.equal(hasText(mounted.root, '완료 가능 1'), true);
    assert.equal(hasText(mounted.root, '수락 가능 1'), true);
    assert.equal(hasText(mounted.root, '대기 중 1'), true);
    assert.equal(hasText(mounted.root, '완료 1'), true);
    assert.equal(hasText(mounted.root, '진행 퀘스트'), true);
    assert.equal(hasText(mounted.root, '대기 퀘스트'), false);

    await act(async () => {
      mounted?.root.findByProps({ accessibilityLabel: '대기 중 탭' }).props.onPress();
    });

    assert.equal(hasText(mounted.root, '대기 퀘스트'), true);
    assert.equal(hasText(mounted.root, '진행 퀘스트'), false);
  });

  it('탭 전환 후에도 다른 상태의 선택을 저장한다', async () => {
    const saved: UpdateHomeQuestAutomationRequest[] = [];
    mounted = await renderEditor({
      entry: homeEntry([
        { questId: 'active', questName: '진행 퀘스트', enabled: true, sourceOrder: 0 },
        { questId: 'claimable', questName: '완료 가능 퀘스트', enabled: true, sourceOrder: 1 },
      ]),
      quests: questCatalog(),
      onSave: async (request) => { saved.push(request); return true; },
    });

    await act(async () => {
      mounted?.root.findByProps({ accessibilityLabel: '수락 가능 탭' }).props.onPress();
    });
    const availableCard = mounted.root.find((node) => node.props.accessibilityRole === 'checkbox');
    await act(async () => { availableCard.props.onPress(); });
    await act(async () => {
      mounted?.root.findAll((node) => (node.type as unknown) === 'Pressable' && hasChildText(node, '저장'))[0]?.props.onPress();
      await Promise.resolve();
    });

    assert.deepEqual(saved[0]?.quests.map(({ questId, sourceOrder }) => [questId, sourceOrder]), [
      ['active', 0],
      ['claimable', 1],
      ['available', 2],
    ]);
  });
});

async function renderEditor({
  quests,
  entry = homeEntry(),
  onSave = async () => true,
}: {
  quests: HomeQuestResponse[];
  entry?: TypedAutomationEntryResponse;
  onSave?: (request: UpdateHomeQuestAutomationRequest) => Promise<boolean>;
}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(HomeQuestAutomationEditor, {
      entry,
      saving: false,
      mutationMessage: null,
      loadHome: async (): Promise<HomeResponse> => ({ mode: 'HOME', quests, actions: [], restStatus: null, result: null }),
      onBack: () => undefined,
      onDelete: async () => true,
      onSave,
    }));
    await Promise.resolve();
  });
  return renderer;
}

function homeEntry(homeQuests: NonNullable<TypedAutomationEntryResponse['homeQuests']> = []): TypedAutomationEntryResponse {
  return {
    id: 1,
    type: 'HOME_QUEST',
    enabled: true,
    priority: 0,
    ready: true,
    warnings: [],
    quests: [],
    homeQuests,
    battleMaps: [],
    battleMapProgress: [],
    adventureMaps: [],
  };
}

function questCatalog(): HomeQuestResponse[] {
  return [
    quest('active', '진행 퀘스트', 'ACTIVE'),
    quest('claimable', '완료 가능 퀘스트', 'CLAIMABLE'),
    quest('available', '수락 가능 퀘스트', 'AVAILABLE'),
    quest('waiting', '대기 퀘스트', 'WAITING'),
    quest('completed', '완료 퀘스트', 'COMPLETED'),
  ];
}

function quest(id: string, name: string, state: HomeQuestResponse['state']): HomeQuestResponse {
  return { id, name, state, mission: null, reward: null, details: [], actionId: null };
}

function hasText(root: ReactTestInstance, value: string): boolean {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === value).length > 0;
}

function hasChildText(root: ReactTestInstance, value: string): boolean {
  return root.findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === value).length > 0;
}
