# Adventure Map Group Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모험맵 자동화의 평면 맵 카탈로그를 현재 표시 맵을 누락하지 않는 검색 가능한 `그룹 → 맵` 계층으로 바꾼다.

**Architecture:** 모험맵 전용 순수 행 모델이 카탈로그를 그룹화하고 검색·수동 펼침 상태에서 FlatList 행을 만든다. 편집기는 기존 draft와 저장 순서를 계속 소유하고, 새 전용 행 컴포넌트는 표시와 접근성만 담당한다. 검색 자동 펼침은 파생 상태로 계산하며 오래된 검색·편집 callback은 live ref로 차단한다.

**Tech Stack:** React Native, React 19, TypeScript, `react-test-renderer`, Node test runner, Expo Android development build

---

## 파일 구조

- Create: `src/main/domain/adventureMapCatalog.ts` — 모험맵 전용 그룹과 FlatList 행을 순수하게 생성한다.
- Create: `src/main/features/automation/components/AdventureMapCatalogRows.tsx` — 간결한 그룹 행과 상태·제한 정보를 가진 맵 선택 행을 표시한다.
- Modify: `src/main/features/automation/components/AdventureMapAutomationEditor.tsx` — 행 모델, 검색, 다중 그룹 펼침, 선택과 저장 안전장치를 연결한다.
- Create: `src/test/domain/adventureMapCatalog.test.ts` — 정렬, 기타 그룹, 검색, 충돌, 불변성을 검증한다.
- Modify: `src/test/components/AdventureMapAutomationEditor.test.ts` — 실제 편집기 그룹 UI, 선택, 검색 복원, 저장 순서와 stale callback을 검증한다.
- Reference: `docs/superpowers/specs/2026-07-19-adventure-map-group-catalog-design.md` — 승인된 동작과 완료 기준이다.

### Task 1: 모험맵 전용 그룹 행 모델

**Files:**
- Create: `src/main/domain/adventureMapCatalog.ts`
- Create: `src/test/domain/adventureMapCatalog.test.ts`

- [ ] **Step 1: 정렬·검색·기타 그룹·허수아비 보존 실패 테스트 작성**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAdventureMapCatalogRows } from '../../main/domain/adventureMapCatalog';
import type { BattleMapResponse } from '../../main/types/api';

describe('adventure map catalog rows', () => {
  it('groups every resolved adventure map without hiding scarecrows', () => {
    const catalog = [
      map('dummy-80', 'Simulation- 전체 공격 허수아비 Lv.80', '특수 허수아비', 0, 1),
      map('dummy-60', 'Simulation- 전체 공격 허수아비 Lv.60', '특수 허수아비', 0, 0),
      map('daily', '일일 동굴', null, 1, 0),
      map('hidden', '미해결', '숨김', 2, 0, { resolved: false, mapCode: null }),
    ];

    const result = buildAdventureMapCatalogRows({
      catalog,
      expandedGroupKeys: ['13:adventure_map|1:0|7:특수 허수아비'],
      query: '',
    });

    assert.deepEqual(result.rows.map(({ kind }) => kind), ['GROUP', 'MAP', 'MAP', 'GROUP']);
    assert.deepEqual(
      result.rows.filter((row) => row.kind === 'MAP').map(({ map }) => map.name),
      ['Simulation- 전체 공격 허수아비 Lv.60', 'Simulation- 전체 공격 허수아비 Lv.80'],
    );
    const fallback = result.rows.find((row) => row.kind === 'GROUP' && row.group.name === '기타');
    assert.equal(fallback?.kind === 'GROUP' ? fallback.group.maps[0]?.name : null, '일일 동굴');
    assert.equal(result.matchCount, 3);
  });

  it('auto expands only matching groups without mutating manual expansion', () => {
    const manual = ['13:adventure_map|1:0|7:수동 그룹'];
    const result = buildAdventureMapCatalogRows({
      catalog: [
        map('manual', '수동 맵', '수동 그룹', 0, 0),
        map('needle', '바늘 모험', '검색 그룹', 1, 0),
      ],
      expandedGroupKeys: manual,
      query: '바늘',
    });

    assert.deepEqual(result.rows.map(({ kind }) => kind), ['GROUP', 'MAP']);
    assert.equal(result.rows[0]?.kind === 'GROUP' ? result.rows[0].expanded : false, true);
    assert.deepEqual(manual, ['13:adventure_map|1:0|7:수동 그룹']);
  });

  it('uses collision-safe group keys and does not mutate inputs', () => {
    const catalog = [
      map('first', '첫 맵', '2:x', 1, 0),
      map('second', '둘째 맵', 'x', 12, 0),
    ];
    const snapshot = structuredClone(catalog);
    const result = buildAdventureMapCatalogRows({ catalog, expandedGroupKeys: [], query: '' });
    const keys = result.rows.filter((row) => row.kind === 'GROUP').map(({ group }) => group.key);

    assert.equal(new Set(keys).size, 2);
    assert.deepEqual(catalog, snapshot);
  });
});

function map(
  mapCode: string,
  name: string,
  groupName: string | null,
  groupOrder: number,
  mapOrder: number,
  overrides: Partial<BattleMapResponse> = {},
): BattleMapResponse {
  return {
    categoryId: 'adventure_map', mapCode, name, groupName, groupOrder, mapOrder,
    recommendedLevel: '60', availableCount: null, attemptCount: null, winCount: null,
    cooldownRemainingText: null, cooldownRemainingSeconds: null, keyCount: null,
    requiredTime: null, supportsThreeBattles: false, enabled: true, resolved: true,
    iconUrl: null, rawHref: '', ...overrides,
  };
}
```

- [ ] **Step 2: 새 도메인 테스트가 실패하는지 확인**

Run: `npx tsx --test src/test/domain/adventureMapCatalog.test.ts`

Expected: FAIL with `Cannot find module '../../main/domain/adventureMapCatalog'`.

- [ ] **Step 3: 모험맵 전용 그룹과 행 생성기 구현**

```ts
import type { BattleMapResponse } from '../types/api';
import { adventureMapIdentity, filterAdventureMapCatalog } from './adventureMapAutomation';

export type AdventureMapCatalogGroup = {
  key: string;
  name: string;
  groupOrder: number;
  recommendedLevel: string | null;
  maps: BattleMapResponse[];
};

export type AdventureMapCatalogRow =
  | { kind: 'GROUP'; key: string; group: AdventureMapCatalogGroup; expanded: boolean }
  | { kind: 'MAP'; key: string; map: BattleMapResponse };

export function buildAdventureMapCatalogRows({
  catalog,
  expandedGroupKeys,
  query,
}: {
  catalog: readonly BattleMapResponse[];
  expandedGroupKeys: readonly string[];
  query: string;
}): { rows: AdventureMapCatalogRow[]; matchCount: number } {
  const maps = filterAdventureMapCatalog(catalog, query).filter(
    (map): map is BattleMapResponse & { mapCode: string } => map.mapCode != null,
  );
  const searching = query.trim().length > 0;
  const expanded = new Set(expandedGroupKeys);
  const groups = new Map<string, AdventureMapCatalogGroup>();

  for (const map of maps) {
    const name = map.groupName?.trim() || '기타';
    const key = encodeGroupKey(map.categoryId, map.groupOrder, name);
    const current = groups.get(key);
    if (current) {
      current.maps.push(map);
      if (current.recommendedLevel == null && map.recommendedLevel != null) {
        current.recommendedLevel = map.recommendedLevel;
      }
    } else {
      groups.set(key, {
        key,
        name,
        groupOrder: map.groupOrder,
        recommendedLevel: map.recommendedLevel,
        maps: [map],
      });
    }
  }

  const rows: AdventureMapCatalogRow[] = [];
  for (const group of groups.values()) {
    const groupExpanded = searching || expanded.has(group.key);
    rows.push({ kind: 'GROUP', key: `group:${group.key}`, group, expanded: groupExpanded });
    if (!groupExpanded) continue;
    for (const map of group.maps) {
      rows.push({ kind: 'MAP', key: `map:${encodeIdentity(adventureMapIdentity(map))}`, map });
    }
  }
  return { rows, matchCount: maps.length };
}

function encodeGroupKey(categoryId: string, groupOrder: number, groupName: string): string {
  return [categoryId, String(groupOrder), groupName]
    .map((part) => `${part.length}:${part}`)
    .join('|');
}

function encodeIdentity(identity: string): string {
  return `${identity.length}:${identity}`;
}
```

- [ ] **Step 4: 도메인 테스트 통과 확인**

Run: `npx tsx --test src/test/domain/adventureMapCatalog.test.ts`

Expected: 3 tests PASS, 0 failures.

- [ ] **Step 5: 도메인 행 모델 커밋**

```bash
git add src/main/domain/adventureMapCatalog.ts src/test/domain/adventureMapCatalog.test.ts
git commit -m "feat: build adventure map group catalog"
```

### Task 2: 간결한 그룹 행과 모험맵 카드 통합

**Files:**
- Create: `src/main/features/automation/components/AdventureMapCatalogRows.tsx`
- Modify: `src/main/features/automation/components/AdventureMapAutomationEditor.tsx`
- Modify: `src/test/components/AdventureMapAutomationEditor.test.ts`

- [ ] **Step 1: 다중 그룹, 카드 선택, 저장 순서 실패 테스트 작성**

기존 `AdventureMapAutomationEditor` describe 블록에 다음 테스트를 추가하고 `renderEditor`가 전체 props override를 받을 수 있게 확장한다.

```ts
it('renders multiple expandable groups and keeps catalog order out of saved execution order', async () => {
  const saves: UpdateAdventureMapAutomationRequest[] = [];
  const renderer = await renderEditor({
    maps: [
      map('late', '후순위 맵', { groupName: '두 번째', groupOrder: 1, mapOrder: 0 }),
      map('early', '선순위 맵', { groupName: '첫 번째', groupOrder: 0, mapOrder: 0 }),
    ],
    onSave: async (request) => { saves.push(request); return true; },
  });

  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '첫 번째 그룹 열기' }).props.onPress(); });
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '두 번째 그룹 열기' }).props.onPress(); });
  assert.ok(renderer.root.findByProps({ accessibilityLabel: '선순위 맵 모험맵 선택' }));
  assert.ok(renderer.root.findByProps({ accessibilityLabel: '후순위 맵 모험맵 선택' }));

  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '후순위 맵 모험맵 선택' }).props.onPress(); });
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '선순위 맵 모험맵 선택' }).props.onPress(); });
  assert.equal(hasText(renderer.root, '선택됨'), true);
  await act(async () => { await renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 저장' }).props.onPress(); });

  assert.deepEqual(saves[0]?.maps.map(({ mapCode, executionOrder }) => [mapCode, executionOrder]), [
    ['late', 0], ['early', 1],
  ]);
});
```

테스트 helper는 맵 fixture와 모든 editor prop을 함께 덮어쓸 수 있도록 다음처럼 바꾼다.

```ts
type RenderEditorOverrides = Partial<React.ComponentProps<typeof AdventureMapAutomationEditor>> & {
  maps?: BattleMapResponse[];
};

async function renderEditor(overrides: RenderEditorOverrides = {}): Promise<ReactTestRenderer> {
  const { maps = [], ...props } = overrides;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(AdventureMapAutomationEditor, editorProps({
      ...props,
      onLoadBattleMaps: props.onLoadBattleMaps ?? (async () => maps),
      onSave: props.onSave ?? (async () => true),
    })));
  });
  return renderer;
}
```

- [ ] **Step 2: 컴포넌트 테스트가 평면 목록 때문에 실패하는지 확인**

Run: `npx tsx --test src/test/components/AdventureMapAutomationEditor.test.ts`

Expected: FAIL because `첫 번째 그룹 열기` does not exist.

- [ ] **Step 3: 모험맵 전용 그룹·맵 표시 컴포넌트 작성**

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';

import {
  describeAdventureMapConstraints,
  describeAdventureMapState,
} from '../../../domain/adventureMapAutomation';
import type { AdventureMapCatalogGroup } from '../../../domain/adventureMapCatalog';
import { theme } from '../../../styles/theme';
import type { BattleMapResponse } from '../../../types/api';

export function AdventureMapCatalogGroupRow({
  group, expanded, interactionDisabled, onPress,
}: {
  group: AdventureMapCatalogGroup;
  expanded: boolean;
  interactionDisabled: boolean;
  onPress: () => void;
}) {
  const action = expanded ? '닫기' : '열기';
  const details = [
    group.recommendedLevel == null ? null : `Lv ${group.recommendedLevel}`,
    `${group.maps.length}개`,
  ].filter((value): value is string => value != null).join(' · ');
  return (
    <Pressable
      accessibilityLabel={interactionDisabled ? `${group.name} 그룹 검색 결과` : `${group.name} 그룹 ${action}`}
      accessibilityRole="button"
      accessibilityState={interactionDisabled ? { disabled: true, expanded } : { expanded }}
      disabled={interactionDisabled}
      onPress={() => { if (!interactionDisabled) onPress(); }}
      style={styles.group}
    >
      <View style={styles.copy}>
        <Text style={styles.groupName}>{group.name}</Text>
        <Text style={styles.meta}>{details}</Text>
      </View>
      {expanded
        ? <ChevronDown color={theme.colors.textMuted} size={18} />
        : <ChevronRight color={theme.colors.textMuted} size={18} />}
    </Pressable>
  );
}

export function AdventureMapCatalogMapRow({
  map, selected, disabled, onPress,
}: {
  map: BattleMapResponse;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const state = describeAdventureMapState(map);
  const constraints = describeAdventureMapConstraints(map);
  return (
    <Pressable
      accessibilityLabel={`${map.name} 모험맵 선택`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={() => { if (!disabled) onPress(); }}
      style={[styles.map, selected && styles.mapSelected, disabled && styles.disabled]}
    >
      <View style={styles.copy}>
        <View style={styles.heading}>
          <Text style={styles.mapName}>{map.name}</Text>
          <View style={styles.statuses}>
            <Text style={state.kind === 'RUNNABLE' || state.kind === 'UNLIMITED' ? styles.runnable : styles.state}>{state.label}</Text>
            {selected ? <Text style={styles.selected}>선택됨</Text> : null}
          </View>
        </View>
        <Text style={styles.meta}>{[map.recommendedLevel, state.detail].filter(Boolean).join(' · ')}</Text>
        <View style={styles.chips}>
          {constraints.map((constraint) => <Text key={constraint.key} style={styles.chip}>{constraint.label}</Text>)}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, color: theme.colors.textMuted, fontSize: 10, fontWeight: '700', paddingHorizontal: theme.spacing.sm, paddingVertical: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  copy: { flex: 1, gap: 4 },
  disabled: { opacity: 0.55 },
  group: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', minHeight: 48, paddingHorizontal: theme.spacing.md },
  groupName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  heading: { alignItems: 'flex-start', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  map: { backgroundColor: theme.colors.background, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, marginLeft: theme.spacing.lg, minHeight: 62, padding: theme.spacing.md },
  mapName: { color: theme.colors.text, flex: 1, fontSize: 13, fontWeight: '800' },
  mapSelected: { backgroundColor: theme.colors.surface, borderColor: theme.colors.accentGreen },
  meta: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  runnable: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '800' },
  selected: { color: theme.colors.accentGreen, fontSize: 10, fontWeight: '900' },
  state: { color: theme.colors.accentAmber, fontSize: 11, fontWeight: '800' },
  statuses: { alignItems: 'flex-end', gap: 2 },
});
```

- [ ] **Step 4: 편집기의 단일 FlatList에 그룹 행 모델 연결**

`ListItem`의 평면 `CATALOG`을 행 모델 기반 타입으로 교체한다.

```ts
import { buildAdventureMapCatalogRows, type AdventureMapCatalogRow } from '../../../domain/adventureMapCatalog';
import { AdventureMapCatalogGroupRow, AdventureMapCatalogMapRow } from './AdventureMapCatalogRows';

type ListItem =
  | { key: string; kind: 'HEADING'; title: string }
  | { key: string; kind: 'EMPTY' }
  | { key: string; kind: 'SELECTED'; setting: AdventureMapAutomationDraft['maps'][number]; index: number }
  | { key: string; kind: 'SEARCH' }
  | { key: string; kind: 'CATALOG_EMPTY' }
  | { key: string; kind: 'CATALOG_ROW'; row: AdventureMapCatalogRow };
```

상태와 파생 행을 추가한다.

```ts
const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);
const queryRef = useRef(query);
queryRef.current = query;

const catalogResult = useMemo(() => buildAdventureMapCatalogRows({
  catalog,
  expandedGroupKeys,
  query,
}), [catalog, expandedGroupKeys, query]);

const items = useMemo<ListItem[]>(() => [
  { key: 'selected-title', kind: 'HEADING', title: '선택한 모험맵 · 실행 순서' },
  ...(draft.maps.length === 0
    ? [{ key: 'empty', kind: 'EMPTY' } as const]
    : draft.maps.map((setting, index) => ({ key: `selected:${adventureMapIdentity(setting)}`, kind: 'SELECTED' as const, setting, index }))),
  { key: 'catalog-title', kind: 'HEADING', title: '모험맵 찾기' },
  { key: 'search', kind: 'SEARCH' },
  ...catalogResult.rows.map((row) => ({ key: `catalog:${row.key}`, kind: 'CATALOG_ROW' as const, row })),
  ...(query.trim().length > 0 && !mapState.loading && mapState.error == null && catalogResult.matchCount === 0
    ? [{ key: 'catalog-empty', kind: 'CATALOG_EMPTY' } as const]
    : []),
], [catalogResult, draft.maps, mapState.error, mapState.loading, query]);
```

검색 입력에서 ref를 즉시 갱신하고, 그룹과 맵 행을 렌더링한다.

```tsx
if (item.kind === 'SEARCH') {
  return <TextInput accessibilityLabel="모험맵 검색" editable={!controlsDisabled} onChangeText={(value) => {
    queryRef.current = value;
    setQuery(value);
  }} placeholder="맵 이름, 그룹, 추천 레벨 검색" placeholderTextColor={theme.colors.textMuted} style={styles.search} value={query} />;
}
if (item.kind === 'CATALOG_EMPTY') return <Text style={styles.muted}>검색 가능한 모험맵이 없습니다.</Text>;
if (item.kind === 'CATALOG_ROW') {
  if (item.row.kind === 'GROUP') {
    const searching = query.trim().length > 0;
    return <AdventureMapCatalogGroupRow
      expanded={item.row.expanded}
      group={item.row.group}
      interactionDisabled={searching}
      onPress={() => {
        if (queryRef.current.trim().length > 0) return;
        setExpandedGroupKeys((current) => {
          if (queryRef.current.trim().length > 0) return current;
          return current.includes(item.row.group.key)
            ? current.filter((key) => key !== item.row.group.key)
            : [...current, item.row.group.key];
        });
      }}
    />;
  }
  const selected = item.row.map.mapCode != null && draftRef.current.maps.some((setting) => (
    setting.categoryId === item.row.map.categoryId && setting.mapCode === item.row.map.mapCode
  ));
  return <AdventureMapCatalogMapRow
    disabled={controlsDisabled}
    map={item.row.map}
    selected={selected}
    onPress={() => updateDraft((current) => {
      const liveSelected = item.row.map.mapCode != null && current.maps.some((setting) => (
        setting.categoryId === item.row.map.categoryId && setting.mapCode === item.row.map.mapCode
      ));
      return selectAdventureMap(current, item.row.map, !liveSelected);
    })}
  />;
}
```

- [ ] **Step 5: 그룹 UI와 저장 순서 테스트 통과 확인**

Run: `npx tsx --test src/test/components/AdventureMapAutomationEditor.test.ts`

Expected: all AdventureMapAutomationEditor tests PASS.

- [ ] **Step 6: 그룹 UI 통합 커밋**

```bash
git add src/main/features/automation/components/AdventureMapCatalogRows.tsx src/main/features/automation/components/AdventureMapAutomationEditor.tsx src/test/components/AdventureMapAutomationEditor.test.ts
git commit -m "feat: group adventure automation maps"
```

### Task 3: 검색 복원과 편집 callback 안전장치

**Files:**
- Modify: `src/main/features/automation/components/AdventureMapAutomationEditor.tsx`
- Modify: `src/test/components/AdventureMapAutomationEditor.test.ts`

- [ ] **Step 1: 검색 전 callback과 저장 중 callback 회귀 테스트 작성**

```ts
it('restores manual groups and fences callbacks retained before search', async () => {
  const renderer = await renderEditor({ maps: [
    map('manual', '수동 맵', { groupName: '수동 그룹', groupOrder: 0 }),
    map('needle', '바늘 맵', { groupName: '검색 그룹', groupOrder: 1 }),
  ] });
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '수동 그룹 그룹 열기' }).props.onPress(); });
  const retained = renderer.root.findByProps({ accessibilityLabel: '수동 그룹 그룹 닫기' }).props.onPress as () => void;

  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 검색' }).props.onChangeText('바늘'); });
  await act(async () => { retained(); });
  assert.ok(renderer.root.findByProps({ accessibilityLabel: '검색 그룹 그룹 검색 결과' }));

  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 검색' }).props.onChangeText(''); });
  assert.ok(renderer.root.findByProps({ accessibilityLabel: '수동 그룹 그룹 닫기' }));
  assert.ok(renderer.root.findByProps({ accessibilityLabel: '수동 맵 모험맵 선택' }));
});

it('fences every retained edit callback and baselines the submitted snapshot', async () => {
  const pending = deferred<boolean>();
  let backs = 0;
  const renderer = await renderEditor({
    entry: entry([
      setting('first', 0, 'PRIMARY', null),
      setting('second', 1, 'PRIMARY', null),
    ]),
    maps: [
      map('first', '첫 맵', { groupName: '그룹', mapOrder: 0 }),
      map('second', '둘째 맵', { groupName: '그룹', mapOrder: 1 }),
    ],
    onListPartyPresets: async () => [preset(9, '고정 파티', false)],
    onSave: async () => pending.promise,
    onBack: () => { backs += 1; },
  });
  const retainedMoveDown = renderer.root.findByProps({ accessibilityLabel: '첫 맵 아래로' }).props.onPress as () => void;
  const retainedMoveUp = renderer.root.findByProps({ accessibilityLabel: '둘째 맵 위로' }).props.onPress as () => void;
  const retainedRemove = renderer.root.findByProps({ accessibilityLabel: '첫 맵 제거' }).props.onPress as () => void;
  const retainedEnabled = renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 사용' }).props.onValueChange as (value: boolean) => void;
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '첫 맵 프리셋 선택 열기' }).props.onPress(); });
  const retainedPreset = renderer.root.findByProps({ accessibilityLabel: '고정 파티 프리셋 선택' }).props.onPress as () => void;
  let saving!: Promise<void>;

  await act(async () => { saving = renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 저장' }).props.onPress(); });
  await act(async () => {
    retainedMoveDown();
    retainedMoveUp();
    retainedRemove();
    retainedEnabled(false);
    retainedPreset();
  });
  assert.ok(renderer.root.findByProps({ accessibilityLabel: '첫 맵 제거' }));
  assert.ok(renderer.root.findByProps({ accessibilityLabel: '둘째 맵 제거' }));
  assert.equal(renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 사용' }).props.value, true);

  await act(async () => { pending.resolve(true); await saving; });
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: '모험맵 자동화 뒤로' }).props.onPress(); });
  assert.equal(backs, 1);
});
```

- [ ] **Step 2: stale callback 테스트 실패 확인**

Run: `npx tsx --test src/test/components/AdventureMapAutomationEditor.test.ts`

Expected: FAIL because retained group/edit callbacks still mutate local state.

- [ ] **Step 3: live busy ref와 guarded updater 연결**

```ts
const controlsDisabledRef = useRef(false);
const updateEditableDraft = useCallback((updater: (current: AdventureMapAutomationDraft) => AdventureMapAutomationDraft) => {
  if (controlsDisabledRef.current) return;
  updateDraft((current) => controlsDisabledRef.current ? current : updater(current));
}, [updateDraft]);

const busy = saving || localBusy;
const controlsDisabled = busy || mapState.loading;
controlsDisabledRef.current = controlsDisabled;
```

다음 사용자 편집 경로를 모두 `updateEditableDraft`로 바꾼다.

```tsx
onPress={() => updateEditableDraft((current) => moveAdventureMapSetting(current, index, index - 1))}
onPress={() => updateEditableDraft((current) => moveAdventureMapSetting(current, index, index + 1))}
onPress={() => updateEditableDraft((current) => removeAdventureMapSetting(current, index))}
onValueChange={(enabled) => updateEditableDraft((current) => ({ ...current, enabled }))}
onPress={() => updateEditableDraft((current) => {
  const selected = map.mapCode != null && current.maps.some((setting) => (
    setting.categoryId === map.categoryId && setting.mapCode === map.mapCode
  ));
  return selectAdventureMap(current, map, !selected);
})}
```

프리셋 열기와 선택은 callback 입구에서도 live 상태를 확인한다.

```ts
const openPresetPicker = useCallback((identity: string) => {
  if (controlsDisabledRef.current) return;
  setActivePresetIdentity(identity);
}, []);

onSelect={(presetId) => {
  if (controlsDisabledRef.current || activePresetIdentity == null) return;
  updateEditableDraft((current) => ({
    ...current,
    maps: current.maps.map((map) => adventureMapIdentity(map) !== activePresetIdentity ? map : presetId == null
      ? { ...map, presetMode: 'PRIMARY', partyPresetId: null }
      : { ...map, presetMode: 'EXPLICIT', partyPresetId: presetId }),
  }));
  setActivePresetIdentity(null);
}}
```

- [ ] **Step 4: 실제 제출 draft를 저장 성공 기준점으로 고정**

```ts
async function save() {
  if (saveDisabled || controlsDisabledRef.current) return;
  controlsDisabledRef.current = true;
  setLocalBusy(true);
  onClearMutationMessage();
  try {
    const submittedDraft = draftRef.current;
    const request = buildAdventureMapAutomationRequest(submittedDraft, validPresetIds);
    const submittedBaseline = serializeDraft(submittedDraft);
    if (await onSave(request)) baselineRef.current = submittedBaseline;
  } finally {
    if (mountedRef.current) setLocalBusy(false);
  }
}
```

삭제 확인 callback도 실행 직전에 live 상태를 확인하고 내부 mutation 동안 ref를 true로 설정한다.

```ts
function confirmDelete() {
  if (controlsDisabledRef.current) return;
  Alert.alert('모험맵 자동화를 삭제할까요?', '선택한 모험맵 설정이 삭제됩니다.', [
    { text: '취소', style: 'cancel' },
    { text: '삭제', style: 'destructive', onPress: async () => {
      if (controlsDisabledRef.current) return;
      controlsDisabledRef.current = true;
      setLocalBusy(true);
      onClearMutationMessage();
      try {
        if (await onDelete()) onBack();
      } finally {
        if (mountedRef.current) setLocalBusy(false);
      }
    } },
  ]);
}
```

- [ ] **Step 5: 안전장치 테스트와 타입 검사 통과 확인**

Run: `npx tsx --test src/test/components/AdventureMapAutomationEditor.test.ts && npm run typecheck`

Expected: AdventureMapAutomationEditor tests PASS and `tsc --noEmit` exits 0.

- [ ] **Step 6: 상호작용 안전장치 커밋**

```bash
git add src/main/features/automation/components/AdventureMapAutomationEditor.tsx src/test/components/AdventureMapAutomationEditor.test.ts
git commit -m "fix: fence adventure catalog interactions"
```

### Task 4: 전체 회귀 및 Android 검증

**Files:**
- Modify only if verification reveals a scoped defect.

- [ ] **Step 1: 변경 파일 공백과 범위 검사**

Run: `git diff --check master..HEAD && git diff --stat master..HEAD`

Expected: no whitespace errors; only approved domain, component, test and plan/spec files appear.

- [ ] **Step 2: 전체 테스트 실행**

Run: `npm test`

Expected: all suites PASS with 0 failures.

- [ ] **Step 3: TypeScript 검사 실행**

Run: `npm run typecheck`

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 4: Android 개발 빌드 수동 확인**

Android 에뮬레이터에서 다음 순서로 확인한다.

1. `모험맵 자동화` 편집기를 연다.
2. 모든 그룹이 처음에는 접혀 있는지 확인한다.
3. 서로 다른 두 그룹을 펼치고 두 그룹의 맵이 동시에 보이는지 확인한다.
4. 현재 평면 목록에 보이던 `Simulation` 허수아비 맵이 그룹 안에 그대로 있는지 확인한다.
5. 다른 그룹의 맵 이름을 검색하고 해당 그룹만 검색 결과로 자동 펼쳐지는지 확인한다.
6. 검색어를 지우고 이전 두 그룹의 수동 펼침 상태가 복원되는지 확인한다.
7. 맵 카드를 선택·해제해 카드 테두리, `선택됨`, 접근성 checked 상태가 함께 바뀌는지 확인한다.
8. 원래 서버 설정을 기록한 뒤 저장·재진입을 확인하고 원래 설정으로 복원한다.

Expected: 그룹 탐색과 검색 복원이 정확하고, 기존 상태·제한·프리셋·저장 동작이 유지된다.

- [ ] **Step 5: 최종 상태 확인**

Run: `git status --short --branch && git log --oneline --decorate -5`

Expected: `feature/adventure-map-group-catalog` is clean and contains the design, plan, and three implementation commits.
