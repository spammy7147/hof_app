# Battle Map Category Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the battle-map automation editor's flat catalog with the approved category → group → map hierarchy while preserving draft order, targets, presets, and the API contract.

**Architecture:** `BattleMapAutomationEditor` remains the owner of loading, draft, search, expansion, preset, and save state. A pure domain helper builds deterministic catalog rows and small presentational components render them inside the editor's existing single `FlatList`, avoiding nested virtualized lists.

**Tech Stack:** React 19, React Native 0.86, TypeScript 6, Expo 57, `lucide-react-native`, Node test runner through `tsx`, `react-test-renderer`.

---

## File Structure

- Create `src/main/domain/battleMapCatalog.ts`: immutable category/group/map row construction.
- Create `src/main/features/automation/components/BattleMapCatalogRows.tsx`: neutral category/group rows and whole-card selectable map rows.
- Modify `src/main/features/automation/components/BattleMapAutomationEditor.tsx`: expansion state, list composition, and callbacks.
- Create `src/test/domain/battleMapCatalog.test.ts`: ordering, search, expansion, resource-state, and immutability tests.
- Modify `src/test/components/BattleMapAutomationEditor.test.ts`: mounted interaction and request-order tests.

## Task 1: Pure Catalog Row Model

**Files:**
- Create: `src/main/domain/battleMapCatalog.ts`
- Create: `src/test/domain/battleMapCatalog.test.ts`

- [ ] **Step 1: Write failing domain tests**

Create `src/test/domain/battleMapCatalog.test.ts` with these cases:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBattleMapCatalogRows } from '../../main/domain/battleMapCatalog';
import type { BattleCategoryResponse, BattleMapResponse } from '../../main/types/api';

describe('battle map automation catalog rows', () => {
  it('orders supported categories and reveals only the expanded category and groups', () => {
    const catalog = [
      map('battle_map', 'g2', '강한 고블린', '고블린 부락', 0, 1),
      map('battle_map', 'g1', '약한 고블린', '고블린 부락', 0, 0),
      map('battle_map', 'c1', '동굴 입구', '고대의 동굴', 1, 0),
      map('scenario_ocean', 's1', '연안', '연안 항로', 0, 0),
      map('adventure_map', 'daily', '일일 모험', '모험', 0, 0),
    ];
    const snapshot = [...catalog];
    const result = buildBattleMapCatalogRows({
      categories: categories(),
      catalog,
      categoryStates: settledStates(),
      expandedCategoryId: 'battle_map',
      expandedGroupKeys: ['battle_map:0:고블린 부락'],
      query: '',
    });

    assert.deepEqual(result.rows.map(({ kind, key }) => [kind, key]), [
      ['CATEGORY', 'category:battle_map'],
      ['GROUP', 'group:battle_map:0:고블린 부락'],
      ['MAP', 'map:resolved|10:battle_map|2:g1'],
      ['MAP', 'map:resolved|10:battle_map|2:g2'],
      ['GROUP', 'group:battle_map:1:고대의 동굴'],
      ['CATEGORY', 'category:scenario_ocean'],
      ['CATEGORY', 'category:raid'],
    ]);
    assert.deepEqual(catalog, snapshot);
    assert.equal(result.matchCount, 4);
  });

  it('auto expands matching categories and groups without mutating manual expansion', () => {
    const manualGroups = ['battle_map:1:고대의 동굴'];
    const result = buildBattleMapCatalogRows({
      categories: categories(),
      catalog: [
        map('battle_map', 'g1', '약한 고블린', '고블린 부락', 0, 0),
        map('scenario_ocean', 's1', '폭풍 항로', '대해', 0, 0),
      ],
      categoryStates: settledStates(),
      expandedCategoryId: 'battle_map',
      expandedGroupKeys: manualGroups,
      query: '폭풍',
    });

    assert.deepEqual(result.rows.map(({ kind }) => kind), ['CATEGORY', 'GROUP', 'MAP']);
    assert.equal(result.rows[0]?.key, 'category:scenario_ocean');
    assert.deepEqual(manualGroups, ['battle_map:1:고대의 동굴']);
  });

  it('places loading, error, and empty rows under an expanded category', () => {
    const base = {
      categories: [category('battle_map', '전투맵', 0)],
      catalog: [] as BattleMapResponse[],
      expandedCategoryId: 'battle_map',
      expandedGroupKeys: [] as string[],
      query: '',
    };
    const state = (loading: boolean, error: string | null) => ({ battle_map: { loading, error } });

    assert.equal(stateKind(buildBattleMapCatalogRows({ ...base, categoryStates: {} }).rows[1]), 'loading');
    assert.equal(stateKind(buildBattleMapCatalogRows({ ...base, categoryStates: state(true, null) }).rows[1]), 'loading');
    assert.equal(stateKind(buildBattleMapCatalogRows({ ...base, categoryStates: state(false, '실패') }).rows[1]), 'error');
    assert.equal(stateKind(buildBattleMapCatalogRows({ ...base, categoryStates: state(false, null) }).rows[1]), 'empty');
  });
});

function categories(): BattleCategoryResponse[] {
  return [
    category('raid', '레이드', 4),
    category('adventure_map', '모험맵', 1),
    category('scenario_ocean', '시나리오- 대해', 3),
    category('union', '유니온', 2),
    category('battle_map', '전투맵', 0),
  ];
}

function category(id: string, label: string, order: number): BattleCategoryResponse {
  return { id, label, description: `${label} 설명`, order, enabled: true };
}

function settledStates() {
  return {
    battle_map: { loading: false, error: null },
    scenario_ocean: { loading: false, error: null },
    raid: { loading: false, error: null },
  };
}

function stateKind(row: ReturnType<typeof buildBattleMapCatalogRows>['rows'][number] | undefined) {
  assert.equal(row?.kind, 'STATE');
  return row?.kind === 'STATE' ? row.state : null;
}

function map(categoryId: string, mapCode: string, name: string, groupName: string, groupOrder: number, mapOrder: number): BattleMapResponse {
  return {
    categoryId, mapCode, name, groupName, groupOrder, mapOrder,
    recommendedLevel: '1-20', availableCount: null, attemptCount: null,
    winCount: null, cooldownRemainingText: null, cooldownRemainingSeconds: null,
    keyCount: null, requiredTime: 10, enabled: true, resolved: true,
    supportsThreeBattles: false, iconUrl: null, rawHref: '',
  };
}
```

- [ ] **Step 2: Run the test and verify RED**

```bash
npx tsx --test src/test/domain/battleMapCatalog.test.ts
```

Expected: FAIL because `battleMapCatalog.ts` does not exist.

- [ ] **Step 3: Implement the row model**

Create `src/main/domain/battleMapCatalog.ts`:

```ts
import { filterBattleAutomationCategories, filterBattleMapCatalog } from './battleMapAutomation';
import { orderBattleCategories } from './battleCategories';
import { buildBattleMapStateKey, groupBattleMaps, type BattleMapGroup } from './battleMaps';
import type { BattleCategoryResponse, BattleMapResponse } from '../types/api';

export type BattleMapCatalogCategoryState = { loading: boolean; error: string | null };

export type BattleMapCatalogRow =
  | { kind: 'CATEGORY'; key: string; category: BattleCategoryResponse; expanded: boolean; mapCount: number | null }
  | { kind: 'STATE'; key: string; category: BattleCategoryResponse; state: 'loading' | 'error' | 'empty'; error: string | null }
  | { kind: 'GROUP'; key: string; group: BattleMapGroup; expanded: boolean }
  | { kind: 'MAP'; key: string; map: BattleMapResponse };

type Args = {
  categories: readonly BattleCategoryResponse[];
  catalog: readonly BattleMapResponse[];
  categoryStates: Readonly<Record<string, BattleMapCatalogCategoryState | undefined>>;
  expandedCategoryId: string | null;
  expandedGroupKeys: readonly string[];
  query: string;
};

export function buildBattleMapCatalogRows(args: Args): { rows: BattleMapCatalogRow[]; matchCount: number } {
  const categories = orderBattleCategories(
    filterBattleAutomationCategories(args.categories).filter(({ enabled }) => enabled),
  );
  const categoryIds = new Set(categories.map(({ id }) => id));
  const supportedCatalog = args.catalog.filter(({ categoryId }) => categoryIds.has(categoryId));
  const visibleMaps = filterBattleMapCatalog(supportedCatalog, args.query);
  const searching = args.query.trim().length > 0;
  const expandedGroups = new Set(args.expandedGroupKeys);
  const rows: BattleMapCatalogRow[] = [];

  for (const category of categories) {
    const maps = visibleMaps.filter(({ categoryId }) => categoryId === category.id);
    const allMaps = args.catalog.filter(({ categoryId, resolved, mapCode }) => (
      categoryId === category.id && resolved && mapCode != null
    ));
    const resource = args.categoryStates[category.id];
    const loading = resource == null || resource.loading;
    if (searching && maps.length === 0) continue;

    const expanded = searching || args.expandedCategoryId === category.id;
    rows.push({
      kind: 'CATEGORY', key: `category:${category.id}`, category, expanded,
      mapCount: loading && allMaps.length === 0 ? null : allMaps.length,
    });
    if (!expanded) continue;

    if (loading && allMaps.length === 0) {
      rows.push({ kind: 'STATE', key: `state:${category.id}:loading`, category, state: 'loading', error: null });
      continue;
    }
    if (resource?.error) {
      rows.push({ kind: 'STATE', key: `state:${category.id}:error`, category, state: 'error', error: resource.error });
      if (allMaps.length === 0) continue;
    }

    const groups = groupBattleMaps(maps);
    if (groups.length === 0) {
      rows.push({ kind: 'STATE', key: `state:${category.id}:empty`, category, state: 'empty', error: null });
      continue;
    }
    for (const group of groups) {
      const groupExpanded = searching || expandedGroups.has(group.key);
      rows.push({ kind: 'GROUP', key: `group:${group.key}`, group, expanded: groupExpanded });
      if (!groupExpanded) continue;
      for (const map of group.maps) {
        rows.push({ kind: 'MAP', key: `map:${buildBattleMapStateKey(map)}`, map });
      }
    }
  }
  return { rows, matchCount: visibleMaps.length };
}
```

- [ ] **Step 4: Verify and commit Task 1**

```bash
npx tsx --test src/test/domain/battleMapCatalog.test.ts src/test/domain/battleMaps.test.ts src/test/domain/battleMapAutomation.test.ts
npm run typecheck
git add src/main/domain/battleMapCatalog.ts src/test/domain/battleMapCatalog.test.ts
git commit -m "feat: build battle map catalog hierarchy"
```

Expected: all focused tests and typecheck PASS.

## Task 2: Presentational Catalog Rows

**Files:**
- Create: `src/main/features/automation/components/BattleMapCatalogRows.tsx`
- Modify: `src/test/components/BattleMapAutomationEditor.test.ts`

- [ ] **Step 1: Add a failing presentational component test**

Require the row exports inside the existing mocked module-loader window, immediately after requiring `BattleMapAutomationEditor` and before restoring `moduleWithLoader._load`:

```ts
const {
  BattleMapCatalogCategoryRow,
  BattleMapCatalogGroupRow,
  BattleMapCatalogMapRow,
} = require(
  '../../main/features/automation/components/BattleMapCatalogRows',
) as typeof import('../../main/features/automation/components/BattleMapCatalogRows');
```

Then add this focused case and harness:

```ts
it('uses neutral hierarchy rows and whole-card map selection', async () => {
  const map = catalogMap('goblin', 'Goblin- 고블린과 놀기(가장 약함)', {
    groupName: '고블린 부락', recommendedLevel: '1-20', keyCount: 8, requiredTime: 10,
  });
  const catalogGroup = { key: 'battle:0:고블린 부락', name: '고블린 부락', groupOrder: 0, recommendedLevel: '1-20', maps: [map] };
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(React.Fragment, null,
      React.createElement(BattleMapCatalogCategoryRow, {
        category: { id: 'battle', label: '전투맵', description: '기본 전투 맵', order: 0, enabled: true },
        expanded: false,
        mapCount: 1,
        onPress: () => undefined,
      }),
      React.createElement(BattleMapCatalogGroupRow, { group: catalogGroup, expanded: false, onPress: () => undefined }),
      React.createElement(CatalogMapHarness, { map }),
    ));
  });

  const category = renderer.root.findByProps({ accessibilityLabel: '전투맵 카테고리 열기' });
  assert.equal(category.props.accessibilityRole, 'button');
  assert.deepEqual(category.props.accessibilityState, { expanded: false });
  const groupRow = renderer.root.findByProps({ accessibilityLabel: '고블린 부락 그룹 열기' });
  assert.equal(groupRow.props.accessibilityRole, 'button');

  const mapCard = renderer.root.findByProps({ accessibilityLabel: '고블린과 놀기(가장 약함) 맵 선택' });
  assert.equal(mapCard.props.accessibilityRole, 'checkbox');
  assert.equal(mapCard.props.accessibilityState.checked, false);
  assert.equal(hasText(renderer.root, 'key 8 · Time 10'), true);
  assert.equal(hasText(renderer.root, '선택됨'), false);
  assert.equal(renderer.root.findAllByType('Folder').length, 0);
  assert.equal(renderer.root.findAllByType('Swords').length, 0);
  assert.equal(renderer.root.findAllByType('Check').length, 0);

  await act(async () => { mapCard.props.onPress(); });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: '고블린과 놀기(가장 약함) 맵 선택' }).props.accessibilityState.checked, true);
  assert.equal(hasText(renderer.root, '선택됨'), true);
});

function CatalogMapHarness({ map }: { map: BattleMapResponse }) {
  const [selected, setSelected] = React.useState(false);
  return React.createElement(BattleMapCatalogMapRow, {
    map,
    selected,
    disabled: false,
    onPress: () => setSelected((current) => !current),
  });
}
```

- [ ] **Step 2: Run the test and verify RED**

```bash
npx tsx --test src/test/components/BattleMapAutomationEditor.test.ts
```

Expected: FAIL because `BattleMapCatalogRows.tsx` and its exports do not exist.

- [ ] **Step 3: Create row components**

Create `BattleMapCatalogRows.tsx` with four exports:

```tsx
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatAutomationMapListMeta, formatAutomationMapListName, type BattleMapGroup } from '../../../domain/battleMaps';
import { theme } from '../../../styles/theme';
import type { BattleCategoryResponse, BattleMapResponse } from '../../../types/api';

export function BattleMapCatalogCategoryRow(props: {
  category: BattleCategoryResponse; expanded: boolean; mapCount: number | null; onPress: () => void;
}) {
  const Chevron = props.expanded ? ChevronDown : ChevronRight;
  return <Pressable accessibilityLabel={`${props.category.label} 카테고리 ${props.expanded ? '닫기' : '열기'}`} accessibilityRole="button" accessibilityState={{ expanded: props.expanded }} onPress={props.onPress} style={styles.category}>
    <View style={styles.copy}><Text style={styles.categoryName}>{props.category.label}</Text>{props.category.description ? <Text style={styles.muted}>{props.category.description}</Text> : null}</View>
    <Text style={styles.count}>{props.mapCount == null ? '확인 중' : `${props.mapCount}개`}</Text><Chevron color={theme.colors.textMuted} size={18} />
  </Pressable>;
}

export function BattleMapCatalogGroupRow(props: { group: BattleMapGroup; expanded: boolean; onPress: () => void }) {
  const Chevron = props.expanded ? ChevronDown : ChevronRight;
  const meta = [props.group.recommendedLevel ? `Lv ${props.group.recommendedLevel}` : null, `${props.group.maps.length}개`].filter(Boolean).join(' · ');
  return <Pressable accessibilityLabel={`${props.group.name} 그룹 ${props.expanded ? '닫기' : '열기'}`} accessibilityRole="button" accessibilityState={{ expanded: props.expanded }} onPress={props.onPress} style={styles.group}>
    <View style={styles.copy}><Text style={styles.groupName}>{props.group.name}</Text><Text style={styles.muted}>{meta}</Text></View><Chevron color={theme.colors.textMuted} size={18} />
  </Pressable>;
}

export function BattleMapCatalogMapRow(props: { map: BattleMapResponse; selected: boolean; disabled: boolean; onPress: () => void }) {
  const name = formatAutomationMapListName(props.map);
  const meta = formatAutomationMapListMeta(props.map);
  return <Pressable accessibilityLabel={`${name} 맵 선택`} accessibilityRole="checkbox" accessibilityState={{ checked: props.selected, disabled: props.disabled }} disabled={props.disabled} onPress={() => { if (!props.disabled) props.onPress(); }} style={[styles.map, props.selected && styles.mapSelected, props.disabled && styles.disabled]}>
    <View style={styles.copy}><Text style={styles.mapName}>{name}</Text>{meta ? <Text style={styles.muted}>{meta}</Text> : null}</View>{props.selected ? <Text style={styles.selected}>선택됨</Text> : null}
  </Pressable>;
}

export function BattleMapCatalogStateRow(props: { category: BattleCategoryResponse; state: 'loading' | 'error' | 'empty'; error: string | null; onRetry: () => void }) {
  const message = props.state === 'loading' ? `${props.category.label} 맵 불러오는 중` : props.state === 'error' ? props.error ?? `${props.category.label} 맵을 불러오지 못했어요.` : `${props.category.label} 맵이 없습니다.`;
  return <View style={styles.state}>{props.state === 'loading' ? <ActivityIndicator color={theme.colors.accentGreen} /> : null}<Text style={props.state === 'error' ? styles.problem : styles.muted}>{message}</Text>{props.state === 'error' ? <Pressable accessibilityLabel={`${props.category.label} 맵 다시 불러오기`} accessibilityRole="button" onPress={props.onRetry} style={styles.retry}><Text style={styles.retryText}>다시 시도</Text></Pressable> : null}</View>;
}

const styles = StyleSheet.create({
  category: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 58, padding: theme.spacing.md },
  group: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, marginLeft: theme.spacing.lg, minHeight: 52, padding: theme.spacing.md },
  map: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, marginLeft: theme.spacing.xl, minHeight: 52, padding: theme.spacing.md },
  mapSelected: { backgroundColor: theme.colors.surface, borderColor: theme.colors.accentGreen, borderWidth: 2 },
  copy: { flex: 1, gap: 2 }, categoryName: { color: theme.colors.text, fontSize: 14, fontWeight: '900' }, groupName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' }, mapName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  count: { color: theme.colors.accentAmber, fontSize: 11, fontWeight: '900' }, selected: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '900' }, muted: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 }, problem: { color: theme.colors.accentAmber, flex: 1, fontSize: 11, lineHeight: 16 },
  state: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, marginLeft: theme.spacing.lg, minHeight: 44 }, retry: { borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.md }, retryText: { color: theme.colors.text, fontWeight: '800' }, disabled: { opacity: 0.45 },
});
```

Do not add conditional expanded styles, icon containers, checkbox glyphs, or mint selection styling to category/group rows.

- [ ] **Step 4: Run the focused test, then commit green components**

```bash
npx tsx --test src/test/components/BattleMapAutomationEditor.test.ts
npm run typecheck
git add src/main/features/automation/components/BattleMapCatalogRows.tsx src/test/components/BattleMapAutomationEditor.test.ts
git commit -m "feat: add battle map catalog rows"
```

Expected: the focused suite and typecheck PASS before the commit.

## Task 3: Integrate into the Existing FlatList

**Files:**
- Modify: `src/main/features/automation/components/BattleMapAutomationEditor.tsx`
- Modify: `src/test/components/BattleMapAutomationEditor.test.ts`

- [ ] **Step 1: Add failing integration cases**

Add these failing cases:

```ts
it('keeps one category open, allows multiple groups, and restores expansion after search', async () => {
  const renderer = await renderEditor({
    battleCategories: [
      { id: 'battle', label: '전투맵', description: '', order: 0, enabled: true },
      { id: 'raid', label: '레이드', description: '', order: 1, enabled: true },
    ],
    onLoadBattleMaps: async (categoryId) => categoryId === 'battle'
      ? [catalogMap('g', 'Goblin- 약한 고블린', { categoryId, groupName: '고블린 부락', groupOrder: 0 }), catalogMap('c', 'Cave- 동굴 입구', { categoryId, groupName: '고대의 동굴', groupOrder: 1 })]
      : [catalogMap('r', 'Raid- 용의 둥지', { categoryId, groupName: '용의 둥지', groupOrder: 0 })],
  });
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투맵 카테고리 열기' }).props.onPress(); });
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '고블린 부락 그룹 열기' }).props.onPress(); });
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '고대의 동굴 그룹 열기' }).props.onPress(); });
  assert.ok(renderer.root.findByProps({ accessibilityLabel: '약한 고블린 맵 선택' }));
  assert.ok(renderer.root.findByProps({ accessibilityLabel: '동굴 입구 맵 선택' }));
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '레이드 카테고리 열기' }).props.onPress(); });
  assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '약한 고블린 맵 선택' }).length, 0);
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투 맵 검색' }).props.onChangeText('고블린'); });
  assert.ok(renderer.root.findByProps({ accessibilityLabel: '약한 고블린 맵 선택' }));
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투 맵 검색' }).props.onChangeText(''); });
  assert.ok(renderer.root.findByProps({ accessibilityLabel: '레이드 카테고리 닫기' }));
});

it('does not let catalog display order change saved execution order', async () => {
  const saves: UpdateBattleMapAutomationRequest[] = [];
  const renderer = await renderEditor({ entry: battleEntry([setting('z', 5, 0), setting('a', 6, 1)]), maps: [catalogMap('a', 'Alpha', { groupName: '앞 그룹', groupOrder: 0 }), catalogMap('z', 'Zulu', { groupName: '뒤 그룹', groupOrder: 1 })], onSave: async (request) => { saves.push(request); return true; } });
  await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투 맵 자동화 저장' }).props.onPress(); });
  assert.deepEqual(saves[0]?.maps.map(({ mapCode, executionOrder }) => [mapCode, executionOrder]), [['z', 0], ['a', 1]]);
});

it('retries only the failed category and keeps map mutation disabled while saving', async () => {
  const calls: string[] = [];
  let battleAttempts = 0;
  const renderer = await renderEditor({
    saving: true,
    battleCategories: [
      { id: 'battle', label: '전투맵', description: '', order: 0, enabled: true },
      { id: 'raid', label: '레이드', description: '', order: 1, enabled: true },
    ],
    onLoadBattleMaps: async (categoryId) => {
      calls.push(categoryId);
      if (categoryId === 'battle' && ++battleAttempts === 1) throw new Error('battle down');
      return [catalogMap(`${categoryId}-map`, categoryId === 'battle' ? '약한 고블린' : '용의 둥지', {
        categoryId,
        groupName: categoryId === 'battle' ? '고블린 부락' : '레이드',
      })];
    },
  });

  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '전투맵 카테고리 열기' }).props.onPress(); });
  await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '전투맵 맵 다시 불러오기' }).props.onPress(); });
  assert.deepEqual(calls, ['battle', 'raid', 'battle']);

  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '고블린 부락 그룹 열기' }).props.onPress(); });
  const mapCard = renderer.root.findByProps({ accessibilityLabel: '약한 고블린 맵 선택' });
  assert.equal(mapCard.props.accessibilityState.disabled, true);
  await act(async () => { mapCard.props.onPress(); });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: '약한 고블린 맵 선택' }).props.accessibilityState.checked, false);
  assert.equal(hasText(renderer.root, '선택됨'), false);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
npx tsx --test src/test/components/BattleMapAutomationEditor.test.ts
```

Expected: FAIL on missing hierarchy integration.

- [ ] **Step 3: Add editor expansion state and row types**

Import `buildBattleMapCatalogRows`, `BattleMapCatalogRow`, and the four row components. Add:

```ts
const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);

const toggleCatalogCategory = useCallback((categoryId: string) => {
  setExpandedCategoryId((current) => current === categoryId ? null : categoryId);
  setExpandedGroupKeys([]);
}, []);

const toggleCatalogGroup = useCallback((groupKey: string) => {
  setExpandedGroupKeys((current) => current.includes(groupKey) ? current.filter((key) => key !== groupKey) : [...current, groupKey]);
}, []);
```

Replace `CATALOG_MAP` with:

```ts
| { key: string; kind: 'CATALOG_ROW'; row: BattleMapCatalogRow };
```

- [ ] **Step 4: Compose hierarchy rows without changing draft order**

```ts
const catalogResult = useMemo(() => buildBattleMapCatalogRows({
  categories: eligibleCategories,
  catalog,
  categoryStates: mapStates,
  expandedCategoryId,
  expandedGroupKeys,
  query,
}), [catalog, eligibleCategories, expandedCategoryId, expandedGroupKeys, mapStates, query]);

const catalogLoading = Object.values(mapStates).some(({ loading }) => loading);
```

In `listItems`, replace flat `visibleCatalog.map(...)` with:

```ts
...catalogResult.rows.map((row) => ({ key: `catalog:${row.key}`, kind: 'CATALOG_ROW' as const, row })),
...(query.trim() && catalogResult.matchCount === 0 && !catalogLoading
  ? [{ key: 'catalog-empty', kind: 'CATALOG_EMPTY' } as const]
  : []),
```

Remove editor-level category map warnings; resource errors now render inside the matching expanded category. Keep the global category-list and preset warnings.

- [ ] **Step 5: Render each catalog row**

Add this branch before selected-setting rendering:

```tsx
if (item.kind === 'CATALOG_ROW') {
  const { row } = item;
  if (row.kind === 'CATEGORY') return <BattleMapCatalogCategoryRow category={row.category} expanded={row.expanded} mapCount={row.mapCount} onPress={() => toggleCatalogCategory(row.category.id)} />;
  if (row.kind === 'STATE') return <BattleMapCatalogStateRow category={row.category} state={row.state} error={row.error} onRetry={() => { void loadCategoryMaps(row.category); }} />;
  if (row.kind === 'GROUP') return <BattleMapCatalogGroupRow group={row.group} expanded={row.expanded} onPress={() => toggleCatalogGroup(row.group.key)} />;
  const selected = row.map.mapCode != null && draft.maps.some((setting) => setting.categoryId === row.map.categoryId && setting.mapCode === row.map.mapCode);
  return <BattleMapCatalogMapRow map={row.map} selected={selected} disabled={controlsDisabled} onPress={() => updateDraft((current) => selectBattleMap(current, row.map, !selected))} />;
}
```

Keep the editor's single `FlatList`. Do not disable category/group expansion while saving; only pass `controlsDisabled` to map rows.

- [ ] **Step 6: Adapt existing tests to open the hierarchy**

Give `catalogMap` a default `groupName: '기타'`. Before existing tests locate `${name} 맵 선택`, use:

```ts
async function openCatalogGroup(renderer: ReactTestRenderer, categoryLabel = '전투맵', groupName = '기타') {
  const category = renderer.root.findAllByProps({ accessibilityLabel: `${categoryLabel} 카테고리 열기` })[0];
  if (category) await act(async () => { category.props.onPress(); });
  const group = renderer.root.findAllByProps({ accessibilityLabel: `${groupName} 그룹 열기` })[0];
  if (group) await act(async () => { group.props.onPress(); });
}
```

Do not weaken existing assertions for dirty back, selected settings, preset focus, request payloads, resource fencing, or unmount cleanup.

- [ ] **Step 7: Verify and commit Task 3**

```bash
npx tsx --test src/test/domain/battleMapCatalog.test.ts src/test/domain/battleMaps.test.ts src/test/domain/battleMapAutomation.test.ts src/test/components/BattleMapAutomationEditor.test.ts
npm run typecheck
git add src/main/features/automation/components/BattleMapAutomationEditor.tsx src/test/components/BattleMapAutomationEditor.test.ts
git commit -m "feat: group battle automation maps by category"
```

Expected: all focused tests and typecheck PASS.

## Task 4: Full Regression and Android Smoke Audit

**Files:**
- Verify: `src/main/domain/battleMapCatalog.ts`
- Verify: `src/main/features/automation/components/BattleMapCatalogRows.tsx`
- Verify: `src/main/features/automation/components/BattleMapAutomationEditor.tsx`
- Verify: `src/test/domain/battleMapCatalog.test.ts`
- Verify: `src/test/components/BattleMapAutomationEditor.test.ts`

- [ ] **Step 1: Run full automated verification**

```bash
npm test
npm run typecheck
git diff --check 88bebc4..HEAD
```

Expected: all tests PASS, typecheck exits 0, and diff check prints nothing.

- [ ] **Step 2: Audit the final diff**

```bash
git diff --stat 88bebc4..HEAD
git diff 88bebc4..HEAD -- src/main/domain/battleMapCatalog.ts src/main/features/automation/components/BattleMapCatalogRows.tsx src/main/features/automation/components/BattleMapAutomationEditor.tsx
```

Confirm: one FlatList; neutral category/group rows without left icons or selected styling; mint styling and `선택됨` only on selected maps; derived search expansion; unchanged request builder and execution order; category-scoped retries; no backend/API changes.

- [ ] **Step 3: Record Android manual status**

When an Android development build is available, open the editor, expand one category and two groups, select/deselect a whole map card, search another category, clear search, save, and reopen. If unavailable, report exactly: `Android 수동 스모크 테스트는 개발 빌드가 없어 수행하지 못함.`

- [ ] **Step 4: Commit only an evidence-backed correction**

If verification finds a defect, add a failing regression test, apply the smallest fix, rerun Step 1, and commit only those corrective files:

```bash
git add src/main/domain/battleMapCatalog.ts src/main/features/automation/components/BattleMapCatalogRows.tsx src/main/features/automation/components/BattleMapAutomationEditor.tsx src/test/domain/battleMapCatalog.test.ts src/test/components/BattleMapAutomationEditor.test.ts
git commit -m "fix: harden battle map category catalog"
```

If verification changes no files, do not create an empty commit.
