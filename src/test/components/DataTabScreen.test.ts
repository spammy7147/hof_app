import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { BattleLogResponse, BattleStatsResponse } from '../../main/types/api';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement(name, { ...props, ref }, props.children as React.ReactNode)
));
const flatList = (props: Record<string, unknown>) => {
  const data = props.data as BattleLogResponse[];
  const renderItem = props.renderItem as (info: { item: BattleLogResponse }) => React.ReactNode;
  return React.createElement(
    'FlatList',
    props,
    props.ListHeaderComponent as React.ReactNode,
    data.map((item) => React.createElement(
      React.Fragment,
      { key: (props.keyExtractor as (value: BattleLogResponse) => string)(item) },
      renderItem({ item }),
    )),
  );
};
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: flatList,
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request.endsWith('/PrimaryButton')) return { PrimaryButton: host('PrimaryButton') };
  return originalLoad(request, parent, isMain);
};
const { DataTabScreen } = require(
  '../../main/screens/DataTabScreen',
) as typeof import('../../main/screens/DataTabScreen');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRenderer: ReactTestRenderer | null = null;

afterEach(async () => {
  if (!mountedRenderer) return;
  const renderer = mountedRenderer;
  mountedRenderer = null;
  await act(async () => { renderer.unmount(); });
});

describe('DataTabScreen recent battle card', () => {
  it('renders the approved concise battle details', async () => {
    const card = await renderBattleCard();
    const cardText = flattenText(card);
    const expected = [
      '승리',
      '07-08 12:04',
      'Frosty Mountain- 대충산',
      '소셜2, 사제',
      'Funds 3,660',
      '획득 아이템: Silver Ingot x 1, Bone x 1',
      '얼어붙은 산의 비밀을 해결했다.',
    ];

    assert.deepEqual(expected.filter((text) => !cardText.includes(text)), []);
    const itemText = card.find((node) => (
      String(node.type) === 'Text'
      && flattenChildren(node.props.children).join('') === '획득 아이템: Silver Ingot x 1, Bone x 1'
    ));
    assert.equal(itemText.props.numberOfLines, 2);
  });

  it('omits detailed battle-result rows from the recent card', async () => {
    const cardText = flattenText(await renderBattleCard());
    const forbidden = ['공민이은(는) 승리했다', '아군:', 'HP', '피해', '생존', '턴', '경험치'];

    assert.deepEqual(forbidden.filter((text) => cardText.some((line) => line.includes(text))), []);
  });
});

async function renderBattleCard(): Promise<ReactTestInstance> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(DataTabScreen, {
      authenticated: true,
      onLoadBattleLogs: async () => [battleLog],
      onLoadBattleStats: async () => emptyStats,
    }));
  });
  mountedRenderer = renderer;

  const cards = renderer.root
    .findAll((node) => String(node.type) === 'View')
    .filter((node) => {
      const text = flattenText(node);
      return text.includes('승리') && text.includes('얼어붙은 산의 비밀을 해결했다.');
    });
  const card = cards.find((candidate) => !candidate
    .findAll((node) => node !== candidate && String(node.type) === 'View')
    .some((child) => {
      const text = flattenText(child);
      return text.includes('승리') && text.includes('얼어붙은 산의 비밀을 해결했다.');
    }));

  assert.ok(card, 'recent battle card should render after loaders resolve');
  return card;
}

function flattenText(root: ReactTestInstance): string[] {
  return root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => flattenChildren(node.props.children).join(''));
}

function flattenChildren(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenChildren);
  return [];
}

const battleLog: BattleLogResponse = {
  id: 1,
  accountId: 7,
  categoryId: 'adventure_map',
  mapCode: 'snow22',
  mapName: 'Frosty Mountain- 대충산',
  characterIds: ['social2', 'priest'],
  characterNames: ['소셜2', '사제'],
  outcome: 'VICTORY',
  title: '공민이은(는) 승리했다',
  turns: 12,
  funds: 3660,
  experience: 10590,
  loots: [{ name: 'Silver Ingot x 1' }, { name: 'Bone x 1' }],
  quest: '얼어붙은 산의 비밀을 해결했다.',
  enemy: {
    hpCurrent: 0,
    hpMax: 100,
    survivorsAlive: 0,
    survivorsMax: 3,
    totalDamage: 50,
    turnCurrent: 12,
    turnMax: 12,
  },
  ally: {
    hpCurrent: 75,
    hpMax: 100,
    survivorsAlive: 2,
    survivorsMax: 2,
    totalDamage: 150,
    turnCurrent: 12,
    turnMax: 12,
  },
  rawLogUrl: null,
  createdAt: '2026-07-08T03:04:05Z',
};

const emptyStats: BattleStatsResponse = {
  accountId: 7,
  totalBattles: 0,
  victories: 0,
  defeats: 0,
  draws: 0,
  unknowns: 0,
  winRate: 0,
  totalFunds: 0,
  totalExperience: 0,
  totalLootCount: 0,
};
