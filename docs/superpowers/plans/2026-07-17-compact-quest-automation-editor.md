# Compact Quest Automation Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each quest as a compact title/mission/reward card and expose battle-map configuration only for selected combat missions through an inline editor and searchable bottom sheet.

**Architecture:** The Spring backend extends `QuestSnapshot` with display-only reward strings parsed from the quest table's reward column. The Expo app normalizes that contract, keeps summary and map-selection rules in pure domain functions, and splits the current large quest row into a summary card, combat editor, and modal map picker while `QuestAutomationEditor` continues to own loading and the save draft.

**Tech Stack:** Kotlin 2.3, Spring Boot 4, Jsoup, JUnit 5, TypeScript 6, React 19, React Native 0.86, Expo 57, Node test runner, react-test-renderer.

---

## Workspace and file map

Run commands from `/Users/spammy/playground/HOF` unless a step specifies a repository directory.

- App implementation worktree: `/Users/spammy/playground/HOF/hof_app-automation-row-interaction`
- Backend source repository with unrelated local edits: `/Users/spammy/playground/HOF/hof_backend`
- Backend execution worktree to create before Task 1: `/Users/spammy/playground/HOF/hof_backend-compact-quest-editor`

The backend worktree must branch from `hof_backend/master` without moving or cleaning the user's existing modified files. Use branch `feature/compact-quest-automation-editor`. The app work remains on the existing `feature/automation-row-interaction` branch because the approved design and row interaction commits are already there.

Files and responsibilities:

- `hof_backend-compact-quest-editor/src/main/kotlin/app/spammy/hof/quest/model/QuestModels.kt`: API reward contract.
- `hof_backend-compact-quest-editor/src/main/kotlin/app/spammy/hof/quest/parser/QuestPageParser.kt`: reward-column discovery and display-line parsing.
- `hof_backend-compact-quest-editor/src/test/resources/fixtures/quest/quest-sections-and-missions.html`: sanitized multi-reward and no-reward examples.
- `hof_backend-compact-quest-editor/src/test/kotlin/app/spammy/hof/quest/parser/QuestPageParserTest.kt`: reward parsing boundaries.
- `hof_backend-compact-quest-editor/src/test/kotlin/app/spammy/hof/quest/controller/QuestControllerTest.kt`: serialized JSON contract.
- `hof_app-automation-row-interaction/src/main/types/api.ts`: `rewards: string[]` app contract.
- `hof_app-automation-row-interaction/src/main/services/backendApi.ts`: fallback normalization for missing or invalid rewards.
- `hof_app-automation-row-interaction/src/main/domain/questAutomation.ts`: summary, selection restoration, map filter/add/replace rules.
- `hof_app-automation-row-interaction/src/main/features/automation/components/BattleMapPickerSheet.tsx`: map search/filter/add modal.
- `hof_app-automation-row-interaction/src/main/features/automation/components/CombatMissionEditor.tsx`: selected map rows and preset controls.
- `hof_app-automation-row-interaction/src/main/features/automation/components/QuestSummaryCard.tsx`: compact three-line card and combat-only expansion.
- `hof_app-automation-row-interaction/src/main/features/automation/components/QuestAutomationEditor.tsx`: loading, draft ownership, deselection cache, undo snackbar, save integration.
- Existing app domain, service, and component tests: regression and new interaction coverage.

### Task 1: Parse and serialize quest rewards in the backend

**Files:**
- Modify: `hof_backend-compact-quest-editor/src/test/resources/fixtures/quest/quest-sections-and-missions.html`
- Modify: `hof_backend-compact-quest-editor/src/test/kotlin/app/spammy/hof/quest/parser/QuestPageParserTest.kt`
- Modify: `hof_backend-compact-quest-editor/src/test/kotlin/app/spammy/hof/quest/controller/QuestControllerTest.kt`
- Modify: `hof_backend-compact-quest-editor/src/main/kotlin/app/spammy/hof/quest/model/QuestModels.kt`
- Modify: `hof_backend-compact-quest-editor/src/main/kotlin/app/spammy/hof/quest/parser/QuestPageParser.kt`

- [ ] **Step 1: Create the isolated backend worktree**

Run:

```bash
git -C hof_backend worktree add ../hof_backend-compact-quest-editor -b feature/compact-quest-automation-editor master
```

Expected: the new worktree is on `feature/compact-quest-automation-editor`; `git -C hof_backend status --short` still shows the user's three pre-existing modified files unchanged.

- [ ] **Step 2: Add sanitized reward evidence to the fixture**

Add a header row to the first quest table and reward cells to representative rows. Keep the existing title, mission, and action cells intact.

```html
<tr class="quest-header">
  <th>퀘스트명</th><th>미션</th><th>보상</th><th>행동</th>
</tr>
<tr>
  <td class="td7s">[0571] 저택 서관 열쇠 수집</td>
  <td>미션 : 몬스터 처치( Killer Maid ) - [ 12 / 30 ]</td>
  <td>아이템( Red Potion(99회 사용가능) ) x2<br>아이템( Blue Potion(99회 사용가능) ) x2</td>
  <td class="td8s">-</td>
</tr>
<tr>
  <td class="td7s">[0801] 집사와 대화</td>
  <td>미션 : NPC 대화( Old Butler )</td>
  <td>-</td>
  <td class="td8s">길드 마스터: 이 대화는 보상이 아닙니다.</td>
</tr>
```

Leave the available, waiting, and completed fixture tables headerless. Their quests must continue to parse with empty rewards, which explicitly covers the missing-header fallback. The new header row contains no quest ID and therefore remains excluded by the existing parser.

- [ ] **Step 3: Write failing parser and controller assertions**

Add these tests/assertions:

```kotlin
@Test
fun parsesRewardColumnInDisplayOrderWithoutMissionOrDialogue() {
    val rewardQuest = quests.single { it.questId == "0571" }
    val noRewardQuest = quests.single { it.questId == "0801" }

    assertEquals(
        listOf(
            "아이템( Red Potion(99회 사용가능) ) x2",
            "아이템( Blue Potion(99회 사용가능) ) x2",
        ),
        rewardQuest.rewards,
    )
    assertEquals(emptyList(), noRewardQuest.rewards)
    assertTrue(rewardQuest.rewards.none { it.contains("미션") || it.contains("길드 마스터") })
}
```

In `QuestControllerTest.snapshot`, pass:

```kotlin
rewards = listOf("아이템( Red Potion ) x2"),
```

and add:

```kotlin
.andExpect(jsonPath("$[0].rewards[0]").value("아이템( Red Potion ) x2"))
```

- [ ] **Step 4: Run the focused backend tests and verify failure**

Run:

```bash
cd hof_backend-compact-quest-editor
./gradlew test --tests '*QuestPageParserTest' --tests '*QuestControllerTest'
```

Expected: compilation fails because `QuestSnapshot.rewards` does not exist.

- [ ] **Step 5: Add the backend reward contract and parser**

Append the display-only field after `actionNo` so existing named and positional construction remains compatible:

```kotlin
data class QuestSnapshot(
    val questId: String,
    val name: String,
    val state: QuestState,
    val section: QuestSection,
    val sourceOrder: Int,
    val missions: List<QuestMission>,
    val actionNo: String?,
    val rewards: List<String> = emptyList(),
)
```

Set `rewards = rewardTexts(element)` in `parseElement`. Add these focused helpers to `QuestPageParser`:

```kotlin
private fun rewardTexts(element: Element): List<String> {
    val directCells = element.children().filter { it.tagName().equals("td", ignoreCase = true) }
    val rewardIndex = rewardColumnIndex(element.closest("table")) ?: return emptyList()
    val rewardCell = directCells.getOrNull(rewardIndex) ?: return emptyList()
    return splitDisplayLines(rewardCell)
        .map { normalize(it).replace(REWARD_PREFIX, "") }
        .filter { it.isNotBlank() && it != "-" }
}

private fun rewardColumnIndex(table: Element?): Int? {
    if (table == null) return null
    return table.select("tr").firstNotNullOfOrNull { row ->
        val cells = row.children().filter {
            it.tagName().equals("th", ignoreCase = true) ||
                it.tagName().equals("td", ignoreCase = true)
        }
        cells.indexOfFirst { normalize(it.text()) == "보상" }.takeIf { it >= 0 }
    }
}

private fun splitDisplayLines(element: Element): List<String> {
    val lines = mutableListOf<String>()
    val current = StringBuilder()

    fun flush() {
        normalize(current.toString()).takeIf(String::isNotBlank)?.let(lines::add)
        current.clear()
    }

    fun visit(node: Node) {
        when (node) {
            is TextNode -> current.append(node.wholeText)
            is Element -> when {
                node.tagName().equals("br", ignoreCase = true) -> flush()
                node.normalName() in MISSION_BLOCK_TAGS -> {
                    if (current.isNotBlank()) flush()
                    node.childNodes().forEach(::visit)
                    flush()
                }
                else -> node.childNodes().forEach(::visit)
            }
        }
    }

    element.childNodes().forEach(::visit)
    flush()
    return lines
}
```

Add this companion regex:

```kotlin
val REWARD_PREFIX = Regex("^\\s*보상\\s*[:：]?\\s*")
```

The parser must use the table header index rather than guessing from Korean text in the reward itself. A missing header or cell returns an empty list and never blocks quest parsing.

- [ ] **Step 6: Run backend tests and commit**

Run:

```bash
./gradlew test --tests '*QuestPageParserTest' --tests '*QuestControllerTest' --tests '*QuestApiSecurityTest'
```

Expected: all selected tests pass.

Commit:

```bash
git add src/main/kotlin/app/spammy/hof/quest/model/QuestModels.kt \
  src/main/kotlin/app/spammy/hof/quest/parser/QuestPageParser.kt \
  src/test/kotlin/app/spammy/hof/quest/parser/QuestPageParserTest.kt \
  src/test/kotlin/app/spammy/hof/quest/controller/QuestControllerTest.kt \
  src/test/resources/fixtures/quest/quest-sections-and-missions.html
git commit -m "feat: expose quest reward summaries"
```

### Task 2: Normalize the reward contract in the app

**Files:**
- Modify: `hof_app-automation-row-interaction/src/main/types/api.ts`
- Modify: `hof_app-automation-row-interaction/src/main/services/backendApi.ts`
- Modify: `hof_app-automation-row-interaction/src/test/services/backendApi.test.ts`
- Modify: `hof_app-automation-row-interaction/src/test/domain/questAutomation.test.ts`
- Modify: `hof_app-automation-row-interaction/src/test/domain/unifiedAutomationController.test.ts`
- Modify: `hof_app-automation-row-interaction/src/test/components/QuestAutomationEditor.test.ts`

- [ ] **Step 1: Write a failing API normalization test**

In `backendApi.test.ts`, return one valid quest without `rewards` and one with mixed values, then assert a safe string array:

```ts
mockFetchWithCapture([
  { questId: 'a', name: 'A', state: 'ACTIVE', section: 'ACTIVE', sourceOrder: 0, missions: [], actionNo: null },
  { questId: 'b', name: 'B', state: 'ACTIVE', section: 'ACTIVE', sourceOrder: 1, missions: [], actionNo: null,
    rewards: ['Gold ×10', null, 3] },
], requests);

assert.deepEqual((await client.fetchQuests()).map(({ rewards }) => rewards), [[], ['Gold ×10']]);
```

- [ ] **Step 2: Run the service test and verify failure**

Run:

```bash
cd hof_app-automation-row-interaction
npx tsx --test src/test/services/backendApi.test.ts
```

Expected: the first result has `undefined` rewards and the second retains invalid values.

- [ ] **Step 3: Add the type and normalizer**

Add to `QuestSnapshot`:

```ts
rewards: string[];
```

Change `fetchQuests` and add a private-file helper:

```ts
async fetchQuests(): Promise<QuestSnapshot[]> {
  const snapshots = await this.request<Array<Omit<QuestSnapshot, 'rewards'> & { rewards?: unknown }>>('/api/quests');
  return snapshots.map(normalizeQuestSnapshot);
}

function normalizeQuestSnapshot(
  snapshot: Omit<QuestSnapshot, 'rewards'> & { rewards?: unknown },
): QuestSnapshot {
  return {
    ...snapshot,
    rewards: Array.isArray(snapshot.rewards)
      ? snapshot.rewards.filter((reward): reward is string => typeof reward === 'string' && reward.trim().length > 0)
      : [],
  };
}
```

Update every `QuestSnapshot` test helper to include `rewards: []`. The three exact helpers are in `questAutomation.test.ts`, `unifiedAutomationController.test.ts`, and `QuestAutomationEditor.test.ts`.

- [ ] **Step 4: Run contract tests and typecheck**

Run:

```bash
npx tsx --test src/test/services/backendApi.test.ts src/test/domain/unifiedAutomationController.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit the app contract**

```bash
git add src/main/types/api.ts src/main/services/backendApi.ts \
  src/test/services/backendApi.test.ts src/test/domain/questAutomation.test.ts \
  src/test/domain/unifiedAutomationController.test.ts src/test/components/QuestAutomationEditor.test.ts
git commit -m "feat: normalize quest reward data"
```

### Task 3: Add pure compact-summary and map-picker rules

**Files:**
- Modify: `hof_app-automation-row-interaction/src/main/domain/questAutomation.ts`
- Modify: `hof_app-automation-row-interaction/src/test/domain/questAutomation.test.ts`

- [ ] **Step 1: Write failing domain tests**

Import the new helpers and add tests with these assertions:

```ts
assert.equal(
  buildQuestMissionSummary([
    mission('kill', 'MONSTER_KILL', 'Killer Maid'),
    mission('item', 'ITEM_TURN_IN', 'Silver Key'),
  ]),
  '미션 · 몬스터 처치 · Killer Maid 외 1개',
);
assert.equal(buildQuestRewardSummary(['Red Potion ×2', 'Blue Potion ×2']), '보상 · Red Potion ×2 외 1개');
assert.equal(buildQuestRewardSummary([]), '보상 · 없음');

const allMaps = [
  catalogMap('battle_map', 'maid', 'Maid Hall'),
  catalogMap('adventure_map', 'tower', 'Sky Tower'),
  catalogMap('union', 'boss', 'Union Boss'),
];
assert.deepEqual(filterQuestMapOptions(allMaps, '', 'ALL').map(({ mapCode }) => mapCode), ['maid', 'tower']);
assert.deepEqual(filterQuestMapOptions(allMaps, 'sky', 'ADVENTURE').map(({ mapCode }) => mapCode), ['tower']);

const added = appendMissionMap([], 'kill', allMaps[0]!);
assert.deepEqual(added, [{ missionKey: 'kill', categoryId: 'battle_map', mapCode: 'maid',
  executionOrder: 0, manuallyOverridden: true, presetMode: 'PRIMARY', partyPresetId: null }]);
assert.deepEqual(appendMissionMap(added, 'kill', allMaps[0]!), added);
assert.equal(replaceMissionMap(added, 'clear', allMaps[1]!)[0]?.mapCode, 'tower');
assert.equal(buildQuestMapIdentity(allMaps[0]!), 'battle_map\u0000maid');
```

Add a restoration test:

```ts
const live = snapshot('q', 'Quest', 'ACTIVE', 0, [
  mission('same', 'MONSTER_KILL', 'Maid'),
  mission('new', 'ITEM_TURN_IN', 'Key'),
]);
const cached = {
  questCode: 'q', name: 'Quest', section: 'ACTIVE' as const, sourceOrder: 0,
  enabled: true, missing: false,
  missions: [
    { ...mission('same', 'MONSTER_KILL', 'Maid'), maps: [mapSetting('same', 'maid', 0)] },
    { ...mission('gone', 'MAP_CLEAR', 'Old'), maps: [mapSetting('gone', 'old', 0)] },
  ],
};
const restored = restoreQuestSelection(live, cached, []);
assert.deepEqual(restored.missions.find(({ key }) => key === 'same')?.maps, [mapSetting('same', 'maid', 0)]);
assert.equal(restored.missions.some(({ key }) => key === 'gone'), false);
```

- [ ] **Step 2: Run the domain test and verify failure**

Run:

```bash
npx tsx --test src/test/domain/questAutomation.test.ts
```

Expected: imports fail because the summary, filter, append, replace, and restore helpers do not exist.

- [ ] **Step 3: Implement the pure rules**

Add the map filter type and helpers:

```ts
export type QuestMapFilter = 'ALL' | 'BATTLE' | 'ADVENTURE';

export function buildQuestMissionSummary(missions: readonly QuestMission[]): string {
  if (missions.length === 0) return '미션 · 없음';
  const suffix = missions.length > 1 ? ` 외 ${missions.length - 1}개` : '';
  return `미션 · ${buildMissionLabel(missions[0]!)}${suffix}`;
}

export function buildQuestRewardSummary(rewards: readonly string[]): string {
  if (rewards.length === 0) return '보상 · 없음';
  const suffix = rewards.length > 1 ? ` 외 ${rewards.length - 1}개` : '';
  return `보상 · ${rewards[0]!.trim()}${suffix}`;
}

export function filterQuestMapOptions(
  maps: readonly BattleMapResponse[],
  query: string,
  filter: QuestMapFilter,
): BattleMapResponse[] {
  const needle = normalizeSearch(query);
  return maps.filter((map) => {
    if (!map.resolved || map.mapCode == null) return false;
    if (map.categoryId !== 'battle_map' && map.categoryId !== 'adventure_map') return false;
    if (filter === 'BATTLE' && map.categoryId !== 'battle_map') return false;
    if (filter === 'ADVENTURE' && map.categoryId !== 'adventure_map') return false;
    return !needle || normalizeSearch(`${map.name} ${map.groupName ?? ''}`).includes(needle);
  });
}

export function buildQuestMapIdentity(
  map: Pick<BattleMapResponse, 'categoryId' | 'mapCode'>,
): string {
  return `${map.categoryId}\u0000${map.mapCode ?? ''}`;
}

export function appendMissionMap(
  maps: readonly QuestMapSettingRequest[],
  missionKey: string,
  selected: BattleMapResponse,
): QuestMapSettingRequest[] {
  if (selected.mapCode == null || maps.some((map) => map.categoryId === selected.categoryId && map.mapCode === selected.mapCode)) {
    return [...maps];
  }
  return normalizeMapOrder([...maps, {
    missionKey,
    categoryId: selected.categoryId,
    mapCode: selected.mapCode,
    executionOrder: maps.length,
    manuallyOverridden: true,
    presetMode: 'PRIMARY',
    partyPresetId: null,
  }]);
}

export function replaceMissionMap(
  _maps: readonly QuestMapSettingRequest[],
  missionKey: string,
  selected: BattleMapResponse,
): QuestMapSettingRequest[] {
  return appendMissionMap([], missionKey, selected);
}
```

Expose a cache-safe restoration helper next to `buildSelection`:

```ts
export function restoreQuestSelection(
  snapshot: QuestSnapshot,
  cached: QuestSelectionDraft,
  catalog: readonly QuestMapCatalogItem[] = [],
): QuestSelectionDraft {
  const fresh = buildSelection(snapshot, null, catalog);
  const cachedByKey = new Map(cached.missions.map((mission) => [mission.key, mission]));
  return {
    ...fresh,
    enabled: cached.enabled,
    missions: fresh.missions.map((mission) => {
      const previous = cachedByKey.get(mission.key);
      return previous && isCombatMission(mission) ? { ...mission, maps: normalizeMapOrder(previous.maps) } : mission;
    }),
  };
}
```

- [ ] **Step 4: Run domain tests and commit**

Run:

```bash
npx tsx --test src/test/domain/questAutomation.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

Commit:

```bash
git add src/main/domain/questAutomation.ts src/test/domain/questAutomation.test.ts
git commit -m "feat: add compact quest editor rules"
```

### Task 4: Build the searchable battle-map bottom sheet

**Files:**
- Create: `hof_app-automation-row-interaction/src/main/features/automation/components/BattleMapPickerSheet.tsx`
- Create: `hof_app-automation-row-interaction/src/test/components/BattleMapPickerSheet.test.ts`

- [ ] **Step 1: Write the failing component test**

Use the existing react-test-renderer host-mock pattern. Include `Modal`, `FlatList`, `Pressable`, `Text`, `TextInput`, and `View` in the `react-native` mock. Test these interactions:

```ts
const maps = [
  catalogMap('battle_map', 'maid', 'Maid Hall'),
  catalogMap('adventure_map', 'tower', 'Sky Tower'),
];
const selected: BattleMapResponse[] = [];
const renderer = await renderSheet({ visible: true, maps, selectedMapIdentities: ['battle_map\u0000maid'] });

assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Maid Hall 추가' }).props.disabled, true);
assert.equal(hasText(renderer.root, '추가됨'), true);
await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투맵 필터 모험맵' }).props.onPress());
assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Maid Hall 추가' }).length, 0);
await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투맵 검색' }).props.onChangeText('Sky'));
await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Sky Tower 추가' }).props.onPress());
assert.deepEqual(selected.map(({ mapCode }) => mapCode), ['tower']);
```

Also assert that the close button invokes `onClose`, a catalog error displays `전투맵을 불러오지 못했어요`, and the retry button invokes `onRetry`.

- [ ] **Step 2: Run the component test and verify failure**

Run:

```bash
npx tsx --test src/test/components/BattleMapPickerSheet.test.ts
```

Expected: module resolution fails because `BattleMapPickerSheet.tsx` does not exist.

- [ ] **Step 3: Implement the bottom sheet**

Use this public contract:

```ts
type Props = {
  visible: boolean;
  target: string | null;
  maps: BattleMapResponse[];
  selectedMapIdentities: string[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onSelect: (map: BattleMapResponse) => void;
};
```

The component owns only `query` and `filter`. Reset both when `visible` changes to true. Derive results using `filterQuestMapOptions`, and compare selected rows with `buildQuestMapIdentity`. Render a transparent `Modal`, a pressable scrim, and a bottom-aligned panel. The exact result action must be:

```tsx
<Pressable
  accessibilityLabel={`${item.name} 추가`}
  accessibilityRole="button"
  accessibilityState={{ disabled: alreadySelected || loading }}
  disabled={alreadySelected || loading}
  onPress={() => onSelect(item)}
  style={[styles.addButton, alreadySelected && styles.disabled]}
>
  <Text style={styles.addButtonText}>{alreadySelected ? '추가됨' : '추가'}</Text>
</Pressable>
```

Use these filter identities and labels:

```ts
const FILTERS = [
  { value: 'ALL' as const, label: '전체' },
  { value: 'BATTLE' as const, label: '전투맵' },
  { value: 'ADVENTURE' as const, label: '모험맵' },
];
```

The sheet must use `keyboardShouldPersistTaps="handled"`, expose a 44px close target, show category labels from stable IDs, and never call `onSelect` for unresolved maps or duplicate identities.

- [ ] **Step 4: Run the focused test and commit**

Run:

```bash
npx tsx --test src/test/components/BattleMapPickerSheet.test.ts
npm run typecheck
```

Expected: test and typecheck pass.

Commit:

```bash
git add src/main/features/automation/components/BattleMapPickerSheet.tsx \
  src/test/components/BattleMapPickerSheet.test.ts
git commit -m "feat: add quest battle map picker sheet"
```

### Task 5: Split and compact the quest card UI

**Files:**
- Create: `hof_app-automation-row-interaction/src/main/features/automation/components/CombatMissionEditor.tsx`
- Create: `hof_app-automation-row-interaction/src/main/features/automation/components/QuestSummaryCard.tsx`
- Modify: `hof_app-automation-row-interaction/src/main/features/automation/components/QuestAutomationEditor.tsx`
- Modify: `hof_app-automation-row-interaction/src/test/components/QuestAutomationEditor.test.ts`

- [ ] **Step 1: Replace the old tall-card assertions with failing compact-card assertions**

Update the mixed quest fixture to include rewards and assert the compact content before selection:

```ts
const mixed = {
  ...snapshot('mixed', 'Mixed', 'ACTIVE', [
    { ...mission('kill', 'MONSTER_KILL', 'Killer Maid'), progress: { current: 2, required: 5 } },
    mission('item', 'ITEM_TURN_IN', 'Horn'),
  ]),
  rewards: ['Red Potion ×2', 'Blue Potion ×2'],
};
const renderer = await renderEditor({ quests: [mixed] });
assert.equal(hasText(renderer.root, '미션 · 몬스터 처치 · Killer Maid 외 1개'), true);
assert.equal(hasText(renderer.root, '보상 · Red Potion ×2 외 1개'), true);
assert.equal(hasText(renderer.root, '원본 순서 1'), false);
assert.equal(hasText(renderer.root, '맵 설정이 필요 없는 미션입니다.'), false);
assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Mixed · kill 전투맵 추가' }).length, 0);

await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Mixed 선택' }).props.onPress());
assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Mixed · kill 전투맵 추가' }));
assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Mixed · item 전투맵 추가' }).length, 0);
```

Add a non-combat test that selects an immediate quest and still finds no combat editor or no-settings explanatory line.

- [ ] **Step 2: Run the editor test and verify failure**

Run:

```bash
npx tsx --test src/test/components/QuestAutomationEditor.test.ts
```

Expected: the old per-mission blocks render and the compact summaries do not exist.

- [ ] **Step 3: Move the combat editor into a focused component**

Move the existing map rows, reorder, remove, and preset controls to `CombatMissionEditor.tsx`. Replace the inline picker state with `BattleMapPickerSheet` and use this contract:

```ts
type Props = {
  mission: QuestMissionDraft;
  catalog: BattleMapResponse[];
  presets: PartyPresetResponse[];
  presetIds: number[];
  disabled: boolean;
  questContext: string;
  catalogLoading: boolean;
  catalogError: string | null;
  onRetryCatalog: () => void;
  onUpdate: (maps: QuestMapSettingRequest[]) => void;
};
```

Open the sheet from `전투맵 추가` for `MONSTER_KILL` and `전투맵 변경` for `MAP_CLEAR`. Select with the pure rules:

```ts
function selectMap(map: BattleMapResponse) {
  const next = mission.type === 'MONSTER_KILL'
    ? appendMissionMap(mission.maps, mission.key, map)
    : replaceMissionMap(mission.maps, mission.key, map);
  onUpdate(next);
  setPickerOpen(false);
}
```

Keep `PRIMARY` and explicit preset radio controls. Keep 44px reorder/remove targets. Show `여러 맵을 실행 가능한 순서대로 확인하고 전투 횟수를 고르게 분배해요` only for a monster mission with at least two maps.

- [ ] **Step 4: Create the compact summary card**

Use this public contract for `QuestSummaryCard`:

```ts
type Props = {
  snapshot: QuestSnapshot;
  selected: QuestSelectionDraft | null;
  sectionLabel: string;
  catalog: BattleMapResponse[];
  presets: PartyPresetResponse[];
  disabled: boolean;
  catalogLoading: boolean;
  catalogError: string | null;
  onRetryCatalog: () => void;
  onToggle: () => void;
  onUpdateMission: (missionKey: string, maps: QuestMapSettingRequest[]) => void;
};
```

Its top-level JSX must follow this structure and pass the complete combat-editor contract:

```tsx
<View style={[styles.card, selected && styles.selected]}>
  <View style={styles.heading}>
    <Pressable accessibilityLabel={`${snapshot.name} 선택`} accessibilityRole="checkbox"
      accessibilityState={{ checked: selected != null, disabled }} onPress={onToggle}>
      <Text>{selected ? '✓' : ''}</Text>
    </Pressable>
    <View style={styles.copy}>
      <View style={styles.titleLine}>
        <Text numberOfLines={1} style={styles.title}>{snapshot.name}</Text>
        <Text style={styles.state}>{sectionLabel}</Text>
      </View>
      <Text numberOfLines={1} style={styles.summary}>{buildQuestMissionSummary(snapshot.missions)}</Text>
      <Text numberOfLines={1} style={styles.reward}>{buildQuestRewardSummary(snapshot.rewards)}</Text>
    </View>
  </View>
  {selected?.missions.filter(isCombatMission).map((mission) => (
    <CombatMissionEditor
      key={mission.key}
      catalog={catalog}
      catalogError={catalogError}
      catalogLoading={catalogLoading}
      disabled={disabled}
      mission={mission}
      presetIds={presets.map(({ id }) => id)}
      presets={presets}
      questContext={snapshot.name || snapshot.questId}
      onRetryCatalog={onRetryCatalog}
      onUpdate={(maps) => onUpdateMission(mission.key, maps)}
    />
  ))}
</View>
```

Do not render non-combat mission blocks below the summary.

- [ ] **Step 5: Wire the new components into the editor**

Delete `QuestRow`, the local `CombatMissionEditor`, its inline query state, and unused `ArrowUp`, `ArrowDown`, `Plus`, and `X` imports from `QuestAutomationEditor.tsx`. Keep `MissingSelectionCard`, but import the extracted `CombatMissionEditor` so saved selections absent from the live page remain editable. Pass `catalogLoading`, `catalogError`, and `onRetryCatalog` from the parent to `MissingSelectionCard`, then forward those exact values to its combat editors.

Pass a combined catalog state to combat editors:

```ts
const catalogLoading = categoryLoading || eligibleCategories.some(({ id }) => mapResources[id]?.loading);
const catalogError = mapErrors.length > 0 || battleCategoriesError ? '전투맵을 불러오지 못했어요.' : null;
```

The picker retry callback calls `onLoadBattleCategories` when categories failed and calls `loadCategoryMaps` for each eligible failed category otherwise.

- [ ] **Step 6: Run component regressions and commit**

Run:

```bash
npx tsx --test src/test/components/QuestAutomationEditor.test.ts src/test/components/BattleMapPickerSheet.test.ts
npm run typecheck
```

Expected: all selected tests and typecheck pass.

Commit:

```bash
git add src/main/features/automation/components/QuestAutomationEditor.tsx \
  src/main/features/automation/components/QuestSummaryCard.tsx \
  src/main/features/automation/components/CombatMissionEditor.tsx \
  src/test/components/QuestAutomationEditor.test.ts
git commit -m "feat: compact quest automation cards"
```

### Task 6: Preserve deselected settings and provide undo

**Files:**
- Modify: `hof_app-automation-row-interaction/src/main/features/automation/components/QuestAutomationEditor.tsx`
- Modify: `hof_app-automation-row-interaction/src/test/components/QuestAutomationEditor.test.ts`

- [ ] **Step 1: Write failing deselection and undo tests**

Start with a selected monster quest that has two maps and an explicit preset. Toggle it off and assert the card collapses, the snackbar appears, and the save request excludes the quest. Re-select before saving and assert both maps and the explicit preset return.

```ts
await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress());
assert.equal(hasText(renderer.root, '선택 해제됨'), true);
assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Combat · kill 전투맵 추가' }).length, 0);

await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Combat 선택' }).props.onPress());
assert.equal(hasText(renderer.root, 'Alpha'), true);
assert.equal(hasText(renderer.root, 'Beta'), true);
assert.equal(
  renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 2번째 맵 Explicit 프리셋' })
    .props.accessibilityState.checked,
  true,
);
```

Repeat the deselection and press `선택 해제 되돌리기`; assert the checkbox is selected and the two maps return. Then save while deselected and verify a later selection builds fresh defaults instead of restoring the removed cache.

- [ ] **Step 2: Run the component test and verify failure**

Run:

```bash
npx tsx --test src/test/components/QuestAutomationEditor.test.ts
```

Expected: re-selection loses maps and no undo control exists.

- [ ] **Step 3: Add local deselection cache and undo state**

Add these states and refs:

```ts
const [deselectedCache, setDeselectedCache] = useState<Record<string, QuestSelectionDraft>>({});
const [undoQuestId, setUndoQuestId] = useState<string | null>(null);
const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Use one toggle function:

```ts
const toggleQuest = useCallback((snapshot: QuestSnapshot) => {
  const current = draftRef.current;
  if (!current) return;
  const selected = current.quests.find(({ questCode }) => questCode === snapshot.questId);
  if (selected) {
    setDeselectedCache((cache) => ({ ...cache, [snapshot.questId]: selected }));
    updateDraft((draft) => selectQuest(draft, snapshot, false, catalog));
    setUndoQuestId(snapshot.questId);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoQuestId(null), 4_000);
    return;
  }

  updateDraft((draft) => {
    const cached = deselectedCache[snapshot.questId];
    if (!cached) return selectQuest(draft, snapshot, true, catalog);
    return { ...draft, quests: [...draft.quests, restoreQuestSelection(snapshot, cached, catalog)] };
  });
  setUndoQuestId(null);
}, [catalog, deselectedCache, updateDraft]);
```

Use an effect cleanup to clear the timer on unmount. Implement undo by looking up the current snapshot and calling `toggleQuest(snapshot)` only if the quest remains deselected.

- [ ] **Step 4: Render and clear the snackbar/cache at the right boundaries**

Render above the footer:

```tsx
{undoQuestId ? (
  <View accessibilityLiveRegion="polite" style={styles.snackbar}>
    <Text style={styles.snackbarText}>선택 해제됨</Text>
    <Pressable accessibilityLabel="선택 해제 되돌리기" accessibilityRole="button" onPress={undoDeselection}>
      <Text style={styles.undoText}>되돌리기</Text>
    </Pressable>
  </View>
) : null}
```

After `onSave` returns true, discard cache entries for quests absent from the saved draft and clear `undoQuestId`. When the server-settings reload button replaces the draft, clear the entire cache and snackbar. Leaving without saving needs no backend action; component unmount drops the local state.

- [ ] **Step 5: Run editor tests and commit**

Run:

```bash
npx tsx --test src/test/components/QuestAutomationEditor.test.ts
npm run typecheck
```

Expected: deselect, undo, reselect, save, and existing editor tests pass.

Commit:

```bash
git add src/main/features/automation/components/QuestAutomationEditor.tsx \
  src/test/components/QuestAutomationEditor.test.ts
git commit -m "feat: restore temporarily deselected quest settings"
```

### Task 7: Run full verification and inspect the Android-facing result

**Files:**
- Modify only if verification exposes a defect in a file already listed above.

- [ ] **Step 1: Run the complete backend test suite**

Run:

```bash
cd /Users/spammy/playground/HOF/hof_backend-compact-quest-editor
./gradlew test
```

Expected: `BUILD SUCCESSFUL` with no failing tests.

- [ ] **Step 2: Run the complete app verification**

Run:

```bash
cd /Users/spammy/playground/HOF/hof_app-automation-row-interaction
npm test
npm run typecheck
```

Expected: every Node test passes and TypeScript reports no errors.

- [ ] **Step 3: Check formatting and repository isolation**

Run:

```bash
git -C /Users/spammy/playground/HOF/hof_backend-compact-quest-editor diff --check
git -C /Users/spammy/playground/HOF/hof_app-automation-row-interaction diff --check
git -C /Users/spammy/playground/HOF/hof_backend status --short
```

Expected: both feature worktrees have no whitespace errors. The original backend repository still shows only the user's pre-existing `BattleMapService.kt`, `application.properties`, and `BattleMapServiceTest.kt` modifications.

- [ ] **Step 4: Run the Expo screen on Android**

With the backend serving the new reward field, run:

```bash
cd /Users/spammy/playground/HOF/hof_app-automation-row-interaction
npx expo start --dev-client --clear
```

Verify on the Android emulator:

1. Unselected quests use the approved three-line title/mission/reward density.
2. Selecting a non-combat quest does not expand it.
3. Selecting a monster quest expands map rows and `전투맵 추가` opens the bottom sheet.
4. Search and the three filters update results; a chosen map closes the sheet and appears with the representative preset.
5. Selecting a map-clear quest shows one auto-matched or user-selected map and `전투맵 변경` replaces it.
6. Deselection collapses the card; undo and re-selection restore unsaved settings.
7. Saving a deselected quest removes it from the saved automation.

- [ ] **Step 5: Commit any verification-only fixes separately**

If a backend verification defect required changes, rerun the affected focused test and full backend verification, then commit only the backend feature files from the backend feature worktree:

```bash
git add src/main/kotlin/app/spammy/hof/quest/model/QuestModels.kt \
  src/main/kotlin/app/spammy/hof/quest/parser/QuestPageParser.kt \
  src/test/kotlin/app/spammy/hof/quest/parser/QuestPageParserTest.kt \
  src/test/kotlin/app/spammy/hof/quest/controller/QuestControllerTest.kt \
  src/test/resources/fixtures/quest/quest-sections-and-missions.html
git commit -m "fix: complete quest reward verification"
```

If an app verification defect required changes, rerun the affected focused test and full app verification, then commit only the app feature files from the app worktree:

```bash
git add src/main/types/api.ts src/main/services/backendApi.ts src/main/domain/questAutomation.ts \
  src/main/features/automation/components/BattleMapPickerSheet.tsx \
  src/main/features/automation/components/CombatMissionEditor.tsx \
  src/main/features/automation/components/QuestSummaryCard.tsx \
  src/main/features/automation/components/QuestAutomationEditor.tsx \
  src/test/services/backendApi.test.ts src/test/domain/questAutomation.test.ts \
  src/test/domain/unifiedAutomationController.test.ts \
  src/test/components/BattleMapPickerSheet.test.ts \
  src/test/components/QuestAutomationEditor.test.ts
git commit -m "fix: complete compact quest editor verification"
```

If no defect was found, do not create an empty commit.
