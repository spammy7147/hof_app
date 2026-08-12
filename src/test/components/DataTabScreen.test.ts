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
  Pressable: host('Pressable'),
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
const copiedValues: string[] = [];
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'expo-clipboard') return { setStringAsync: async (value: string) => { copiedValues.push(value); } };
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
  copiedValues.length = 0;
  if (!mountedRenderer) return;
  const renderer = mountedRenderer;
  mountedRenderer = null;
  await act(async () => { renderer.unmount(); });
});

describe('DataTabScreen recent battle card', () => {
  it('keeps Funds on data home and opens period-specific adventure-map statistics', async () => {
    const periods: Array<string | undefined> = [];
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(DataTabScreen, {
        authenticated: true,
        onLoadBattleLogs: async () => [],
        onLoadBattleStats: async (period) => {
          periods.push(period);
          return ({
          accountId: 7,
          dailyFunds: 100,
          weeklyFunds: 200,
          monthlyFunds: 300,
          adventureMapOutcomes: [{ mapCode: 'snow22', mapName: '얼어붙은 산', defeats: 2, draws: 1 }],
          });
        },
      }));
    });
    mountedRenderer = renderer;
    const text = flattenText(renderer.root);

    assert.deepEqual(
      ['일일 펀드', '$ 100', '주간 펀드', '월요일~일요일', '$ 200', '월간 펀드', '$ 300', '모험맵 통계']
        .filter((value) => !text.includes(value)),
      [],
    );
    assert.equal(text.includes('얼어붙은 산'), false);

    const launch = renderer.root.find((node) => String(node.type) === 'PrimaryButton' && node.props.label === '통계 보기');
    await act(async () => { launch.props.onPress(); });
    assert.deepEqual(periods, [undefined, 'DAY']);
    assert.deepEqual(['일간', '주간', '월간', '얼어붙은 산', '2회', '1회'].filter((value) => !flattenText(renderer.root).includes(value)), []);

    const weekly = renderer.root.find((node) => String(node.type) === 'Pressable' && flattenText(node).includes('주간'));
    await act(async () => { weekly.props.onPress(); });
    assert.deepEqual(periods, [undefined, 'DAY', 'WEEK']);
    assert.deepEqual(['승률', '경험치', '전리품', '승/패/무'].filter((value) => text.includes(value)), []);
  });

  it('renders the approved concise battle details', async () => {
    const card = await renderBattleCard();
    const cardText = flattenText(card);
    const expected = [
      '승리',
      '07-08 12:04',
      'Frosty Mountain- 대충산',
      '소셜2, 사제',
      'Funds 3,660',
      '얼어붙은 산의 비밀을 해결했다.',
      'https://example.com/battle/detail/1',
    ];

    assert.deepEqual(expected.filter((text) => !cardText.includes(text)), []);
  });

  it('omits detailed battle-result rows from the recent card', async () => {
    const cardText = flattenText(await renderBattleCard());
    const forbidden = ['공민이은(는) 승리했다', '아군:', 'HP', '피해', '생존', '턴', '경험치', '획득 아이템'];

    assert.deepEqual(forbidden.filter((text) => cardText.some((line) => line.includes(text))), []);
  });

  it('loads a selected outcome from the server and copies the saved Show Detail link', async () => {
    const queries: unknown[] = [];
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(DataTabScreen, {
        authenticated: true,
        onLoadBattleLogs: async (query) => {
          queries.push(query);
          return [battleLog];
        },
        onLoadBattleStats: async () => emptyStats,
      }));
    });
    mountedRenderer = renderer;
    const openButton = renderer.root.find((node) => String(node.type) === 'PrimaryButton' && node.props.label === '로그 보기');
    await act(async () => { openButton.props.onPress(); });
    const defeatTab = renderer.root.find((node) => (
      String(node.type) === 'Pressable'
      && node.props.accessibilityRole === 'tab'
      && flattenText(node).includes('패배')
    ));
    await act(async () => { defeatTab.props.onPress(); });
    const copyButton = renderer.root.find((node) => String(node.type) === 'PrimaryButton' && node.props.label === '링크 복사');
    await act(async () => { copyButton.props.onPress(); });
    const detailButton = renderer.root.find((node) => String(node.type) === 'PrimaryButton' && node.props.label === '상세 보기');
    await act(async () => { detailButton.props.onPress(); });

    assert.deepEqual(queries.at(-1), { limit: 40, offset: 0, outcome: 'DEFEAT' });
    assert.deepEqual(copiedValues, ['https://example.com/battle/detail/1']);
    assert.ok(flattenText(renderer.root).includes('웹에서는 원본 전투 로그를 새 창으로 엽니다.'));
    assert.ok(flattenText(renderer.root).includes('Frosty Mountain- 대충산'));
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
  const openButton = renderer.root.find((node) => (
    String(node.type) === 'PrimaryButton' && node.props.label === '로그 보기'
  ));
  await act(async () => { openButton.props.onPress(); });
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
  rawLogUrl: 'https://example.com/battle/detail/1',
  createdAt: '2026-07-08T03:04:05Z',
};

const emptyStats: BattleStatsResponse = {
  accountId: 7,
  dailyFunds: 0,
  weeklyFunds: 0,
  monthlyFunds: 0,
  adventureMapOutcomes: [],
};
