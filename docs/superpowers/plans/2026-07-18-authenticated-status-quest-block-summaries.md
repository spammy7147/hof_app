# Authenticated Status and Quest Block Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject expired HOF status pages, parse sibling quest rows as one quest, and show every mission and reward on compact quest cards.

**Architecture:** The backend validates the fetched HOF home before parsing and anchors the player name to the authenticated status container. `QuestPageParser` introduces a row-block boundary so a quest start row owns its following mission/action rows until the next quest start. The app keeps the existing API contract and changes only pure summary formatting plus card text wrapping.

**Tech Stack:** Kotlin, Spring Boot, Jsoup, JUnit 5, TypeScript, React Native, Expo, Node test runner

---

## File map

### Backend repository: `/Users/spammy/playground/HOF/hof_backend`

- Modify `src/main/kotlin/app/spammy/hof/status/service/HofStatusService.kt`: validate the fetched HOF page with `LoginStateParser` before status parsing.
- Modify `src/main/kotlin/app/spammy/hof/external/parser/HofMainStatusParser.kt`: restrict player-name parsing to the DOM container that owns Funds and Time.
- Modify `src/test/kotlin/app/spammy/hof/status/service/HofStatusServiceTest.kt`: cover expired public pages and keep the authenticated response contract.
- Modify `src/test/kotlin/app/spammy/hof/external/parser/HofMainStatusParserTest.kt`: cover public names outside the status header and flattened authenticated markup.
- Modify `src/main/kotlin/app/spammy/hof/quest/parser/QuestPageParser.kt`: group a quest start row with following sibling rows and parse fields from their correct ownership scopes.
- Modify `src/test/kotlin/app/spammy/hof/quest/parser/QuestPageParserTest.kt`: cover production row blocks and cross-quest boundaries.
- Create `src/test/resources/fixtures/quest/quest-production-row-blocks.html`: sanitized continuation-row fixture.

Do not edit or stage these existing user-owned backend changes:

- `src/main/kotlin/app/spammy/hof/battle/service/BattleMapService.kt`
- `src/main/resources/application.properties`
- `src/test/kotlin/app/spammy/hof/battle/service/BattleMapServiceTest.kt`

### App repository: `/Users/spammy/playground/HOF/hof_app`

- Modify `src/main/domain/questAutomation.ts`: join all mission/reward items and include mission progress.
- Modify `src/test/domain/questAutomation.test.ts`: lock full summary strings and blank filtering.
- Modify `src/main/features/automation/components/QuestSummaryCard.tsx`: allow mission and reward text to wrap without line truncation.
- Modify `src/test/components/QuestAutomationEditor.test.ts`: verify all summary text renders while combat expansion remains conditional.

---

### Task 1: Reject unauthenticated status pages and anchor player names

**Files:**
- Modify: `/Users/spammy/playground/HOF/hof_backend/src/test/kotlin/app/spammy/hof/status/service/HofStatusServiceTest.kt`
- Modify: `/Users/spammy/playground/HOF/hof_backend/src/test/kotlin/app/spammy/hof/external/parser/HofMainStatusParserTest.kt`
- Modify: `/Users/spammy/playground/HOF/hof_backend/src/main/kotlin/app/spammy/hof/status/service/HofStatusService.kt`
- Modify: `/Users/spammy/playground/HOF/hof_backend/src/main/kotlin/app/spammy/hof/external/parser/HofMainStatusParser.kt`

- [ ] **Step 1: Write failing service and parser tests**

Add an expired-page service test whose body contains another visible player but a login form:

```kotlin
@Test
fun fetchRejectsExpiredHofPageBeforeParsingPublicPlayerNames() {
    Mockito.`when`(accountQueryRepository.findById(1L)).thenReturn(account)
    Mockito.`when`(cookieQueryRepository.findValueMapByAccountId(1L))
        .thenReturn(mapOf("PHPSESSID" to "expired"))
    gateway.body = """
        <form><input name="id"><input name="pass"><input name="Login"></form>
        <div>《순금 120%》켄류</div>
    """.trimIndent()

    val error = assertFailsWith<ApiException> { service.fetch(1L) }

    assertEquals(ErrorCode.HOF_SESSION_EXPIRED, error.errorCode)
}
```

Make the fake gateway body configurable and add `LoginStateParser()` to the service test constructor.

Add parser boundary tests:

```kotlin
@Test
fun usesThePlayerNameOwnedByTheStatusRow() {
    val status = parser.parse("""
        <div>《순금 120%》켄류</div>
        <table><tr>
          <td>《얼어붙은 손길》공민이</td>
          <td>Funds : $ 10<br>Work : Nothing</td>
          <td>Time : 5/10<br>Auction : Nothing</td>
        </tr></table>
    """.trimIndent())

    assertEquals("《얼어붙은 손길》공민이", status.playerName)
}

@Test
fun doesNotUseAPlayerNameOutsideAStatusContainer() {
    val status = parser.parse("<div>《순금 120%》켄류</div>")

    assertEquals("Unknown", status.playerName)
}
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
./gradlew test --tests 'app.spammy.hof.status.service.HofStatusServiceTest' --tests 'app.spammy.hof.external.parser.HofMainStatusParserTest'
```

Expected: the service returns a parsed response instead of `HOF_SESSION_EXPIRED`, and the parser chooses the public name.

- [ ] **Step 3: Add login-state validation to the status service**

Inject `LoginStateParser` and reject any fetched page that is not positively authenticated:

```kotlin
class HofStatusService(
    // existing dependencies
    private val statusParser: HofMainStatusParser,
    private val loginStateParser: LoginStateParser,
    private val timeProvider: TimeProvider,
) {
    // ...
    val response = gateway.execute(requestFactory.home(), cookies)
    val loginState = loginStateParser.parse(response.body)
    if (!loginState.isLoggedIn) {
        throw ApiException(ErrorCode.HOF_SESSION_EXPIRED, "HOF 로그인 세션이 만료되었습니다.")
    }
    val parsed = statusParser.parse(response.body)
}
```

- [ ] **Step 4: Anchor player-name parsing to the status container**

Find the smallest supported container that contains both Funds and Time. Prefer a `tr`, then a semantic/header status container, then the body only for flattened authenticated markup. Within that scope, choose the last `PLAYER_REGEX` match before the Funds marker:

```kotlin
private fun statusScope(document: Document): Element? =
    document.select("tr, header, [data-status], .status")
        .firstOrNull { FUNDS_REGEX.containsMatchIn(it.text()) && TIME_REGEX.containsMatchIn(it.text()) }
        ?: document.body().takeIf {
            FUNDS_REGEX.containsMatchIn(it.text()) && TIME_REGEX.containsMatchIn(it.text())
        }

private fun parsePlayerName(scope: Element?): String {
    val text = scope?.text()?.normalizeSpaces() ?: return UNKNOWN_VALUE
    val fundsIndex = FUNDS_REGEX.find(text)?.range?.first ?: return UNKNOWN_VALUE
    return PLAYER_REGEX.findAll(text.substring(0, fundsIndex)).lastOrNull()?.value ?: UNKNOWN_VALUE
}
```

Use this scoped parser for `playerName`; keep the existing Funds, Time, Work, and Auction parsing behavior.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: all `HofStatusServiceTest` and `HofMainStatusParserTest` tests pass.

- [ ] **Step 6: Commit only the status files**

```bash
git add src/main/kotlin/app/spammy/hof/status/service/HofStatusService.kt \
  src/main/kotlin/app/spammy/hof/external/parser/HofMainStatusParser.kt \
  src/test/kotlin/app/spammy/hof/status/service/HofStatusServiceTest.kt \
  src/test/kotlin/app/spammy/hof/external/parser/HofMainStatusParserTest.kt
git commit -m "fix: reject unauthenticated HOF status pages"
```

### Task 2: Parse sibling quest rows as one bounded quest block

**Files:**
- Create: `/Users/spammy/playground/HOF/hof_backend/src/test/resources/fixtures/quest/quest-production-row-blocks.html`
- Modify: `/Users/spammy/playground/HOF/hof_backend/src/test/kotlin/app/spammy/hof/quest/parser/QuestPageParserTest.kt`
- Modify: `/Users/spammy/playground/HOF/hof_backend/src/main/kotlin/app/spammy/hof/quest/parser/QuestPageParser.kt`

- [ ] **Step 1: Add a sanitized production-shaped fixture**

Create a table in which the base row owns the quest and rewards while following rows own missions and dialogue:

```html
<div id="contents">
  <h4>진행중인 퀘스트</h4>
  <table>
    <tr><td>퀘스트명</td><td>타입</td><td>제한</td><td>보상</td><td>행동</td></tr>
    <tr>
      <td class="td7s" rowspan="3">[0105] 포션 지원</td>
      <td>길드의 지원품</td><td>-</td>
      <td>Red Potion x2<br>Blue Potion x2</td><td class="td8s">-</td>
    </tr>
    <tr><td colspan="4">미션 : 아이템 반납( Potion Bottle ) - [ 0 / 1 ]</td></tr>
    <tr><td colspan="4">길드 마스터: 미션 물품을 가져오게.</td></tr>
    <tr>
      <td class="td7s" rowspan="3">[0571] 메이드 토벌</td>
      <td>전투</td><td>-</td><td>Fund $15,000<br>미션 포인트 x3</td><td class="td8s">-</td>
    </tr>
    <tr><td colspan="4">미션 : 몬스터 처치( Killer Maid ) - [ 12 / 30 ]<br>미션 : 맵 클리어( Maid Hall )</td></tr>
    <tr><td colspan="4"><a href="?action=complete&amp;no=maid">완료</a></td></tr>
  </table>
</div>
```

- [ ] **Step 2: Write failing block-boundary tests**

Load the fixture and assert:

```kotlin
@Test
fun groupsFollowingRowsIntoTheirOwningQuestUntilTheNextQuestStarts() {
    val quests = productionRowBlockQuests().associateBy { it.questId }

    assertEquals(listOf("Red Potion x2", "Blue Potion x2"), quests.getValue("0105").rewards)
    assertEquals(listOf(QuestMissionType.ITEM_TURN_IN), quests.getValue("0105").missions.map { it.type })
    assertEquals(QuestProgress(0, 1), quests.getValue("0105").missions.single().progress)

    val combat = quests.getValue("0571")
    assertEquals(listOf(QuestMissionType.MONSTER_KILL, QuestMissionType.MAP_CLEAR), combat.missions.map { it.type })
    assertEquals(listOf("Killer Maid", "Maid Hall"), combat.missions.map { it.target })
    assertEquals(listOf("Fund $15,000", "미션 포인트 x3"), combat.rewards)
    assertEquals("maid", combat.actionNo)
}

@Test
fun excludesDialogueAndRewardWordingFromMissionRows() {
    val quests = productionRowBlockQuests()

    assertTrue(quests.flatMap { it.missions }.none { it.target?.contains("물품") == true })
    assertTrue(quests.flatMap { it.missions }.none { it.target?.contains("포인트") == true })
}
```

- [ ] **Step 3: Run the parser test and verify RED**

Run:

```bash
./gradlew test --tests 'app.spammy.hof.quest.parser.QuestPageParserTest'
```

Expected: continuation-row missions are absent and the separate action row is not associated with its quest.

- [ ] **Step 4: Introduce a bounded quest block model**

Keep the model private to the parser:

```kotlin
private data class QuestBlock(
    val start: Element,
    val nodes: List<Element>,
)
```

Build blocks only from top-level quest starts. A row start owns subsequent sibling `tr` nodes until another sibling satisfies `isQuestStart`; a `data-quest-id` container owns only itself:

```kotlin
private fun questBlocks(scope: Element): List<QuestBlock> =
    scope.select("tr, [data-quest-id]")
        .filter(::isTopLevelQuestNode)
        .filter(::isQuestStart)
        .map { start ->
            if (!start.tagName().equals("tr", true)) QuestBlock(start, listOf(start))
            else QuestBlock(start, buildList {
                add(start)
                var sibling = start.nextElementSibling()
                while (sibling != null && sibling.tagName().equals("tr", true) && !isQuestStart(sibling)) {
                    add(sibling)
                    sibling = sibling.nextElementSibling()
                }
            })
        }
```

`isQuestStart` must inspect only the node's direct quest-name cell or `data-quest-id`; it must not match a nested table row.

- [ ] **Step 5: Parse each field from its owning portion of the block**

Refactor `parseElement` into `parseBlock`:

- ID, name, section, and normal reward column come from `block.start`.
- Mission lines come from `block.nodes` in order.
- Action link/form/control and `no` come from the first matching node in `block.nodes`.
- Explicit `보상:` continuation areas may add rewards; dialogue rows do not.

Tighten mission detection from substring matching to a normalized prefix:

```kotlin
fun flush() {
    val text = normalize(current.toString())
    if (MISSION_PREFIX.containsMatchIn(text)) segments += text
    current.clear()
}

val MISSION_PREFIX = Regex("^\\s*미션\\s*[:：]\\s*")
```

Preserve the existing `parseMission`, semantic key, duplicate occurrence priority, and `sourceOrder` logic.

- [ ] **Step 6: Run parser and quest API tests and verify GREEN**

Run:

```bash
./gradlew test --tests 'app.spammy.hof.quest.parser.QuestPageParserTest' \
  --tests 'app.spammy.hof.quest.controller.QuestControllerTest' \
  --tests 'app.spammy.hof.quest.controller.QuestApiSecurityTest'
```

Expected: all focused quest tests pass, including existing same-row and nested-table cases.

- [ ] **Step 7: Commit only quest parser files**

```bash
git add src/main/kotlin/app/spammy/hof/quest/parser/QuestPageParser.kt \
  src/test/kotlin/app/spammy/hof/quest/parser/QuestPageParserTest.kt \
  src/test/resources/fixtures/quest/quest-production-row-blocks.html
git commit -m "fix: parse multi-row HOF quest blocks"
```

### Task 3: Show every mission, progress value, and reward on quest cards

**Files:**
- Modify: `/Users/spammy/playground/HOF/hof_app/src/test/domain/questAutomation.test.ts`
- Modify: `/Users/spammy/playground/HOF/hof_app/src/main/domain/questAutomation.ts`
- Modify: `/Users/spammy/playground/HOF/hof_app/src/test/components/QuestAutomationEditor.test.ts`
- Modify: `/Users/spammy/playground/HOF/hof_app/src/main/features/automation/components/QuestSummaryCard.tsx`

- [ ] **Step 1: Change domain tests to require complete summaries**

Replace the compact-summary assertions with full ordered strings:

```typescript
it('builds full quest mission summaries with progress in source order', () => {
  assert.equal(buildQuestMissionSummary([]), '미션 · 없음');
  assert.equal(buildQuestMissionSummary([
    { ...mission('kill', 'MONSTER_KILL', 'Killer Maid'), progress: { current: 12, required: 30 } },
    mission('clear', 'MAP_CLEAR', 'Maid Hall'),
    { ...mission('item', 'ITEM_TURN_IN', 'Silver Key'), progress: { current: 1, required: 1 } },
  ]), '미션 · 몬스터 처치 · Killer Maid 12/30 · 맵 클리어 · Maid Hall · 아이템 반납 · Silver Key 1/1');
});

it('builds full reward summaries and ignores blank entries', () => {
  assert.equal(buildQuestRewardSummary([]), '보상 · 없음');
  assert.equal(
    buildQuestRewardSummary([' Red Potion ×2 ', '', 'Blue Potion ×2', '  Fund $15,000  ']),
    '보상 · Red Potion ×2 · Blue Potion ×2 · Fund $15,000',
  );
});
```

- [ ] **Step 2: Run the domain test and verify RED**

Run:

```bash
npm test -- src/test/domain/questAutomation.test.ts
```

Expected: the old implementation returns only the first entry plus `외 N개` and omits progress.

- [ ] **Step 3: Implement full ordered summary formatting**

```typescript
export function buildQuestMissionSummary(missions: readonly QuestMission[]): string {
  if (missions.length === 0) return '미션 · 없음';
  const items = missions.map((mission) => {
    const progress = buildMissionProgressLabel(mission);
    return `${buildMissionLabel(mission)}${progress ? ` ${progress.replace(' / ', '/')}` : ''}`;
  });
  return `미션 · ${items.join(' · ')}`;
}

export function buildQuestRewardSummary(rewards: readonly string[]): string {
  const items = rewards.map((reward) => reward.trim()).filter(Boolean);
  return items.length === 0 ? '보상 · 없음' : `보상 · ${items.join(' · ')}`;
}
```

- [ ] **Step 4: Add a mounted card regression test**

Render a quest with multiple missions and rewards through `QuestAutomationEditor`, then assert the rendered text contains every item and does not contain `외 1개`. Locate the host `Text` nodes that contain the `미션 ·` and `보상 ·` summaries and require `numberOfLines` to be absent. Also assert a selected non-combat quest still has no `CombatMissionEditor` map controls.

```typescript
assert.match(textContent(renderer), /Killer Maid 12\/30/);
assert.match(textContent(renderer), /Maid Hall/);
assert.match(textContent(renderer), /Red Potion ×2/);
assert.match(textContent(renderer), /Blue Potion ×2/);
assert.doesNotMatch(textContent(renderer), /외 \d+개/);
const summaryNodes = renderer.root.findAllByType('Text').filter((node) => {
  const text = textContent(node);
  return text.startsWith('미션 ·') || text.startsWith('보상 ·');
});
assert.equal(summaryNodes.length, 2);
assert.equal(summaryNodes.every((node) => node.props.numberOfLines == null), true);
```

- [ ] **Step 5: Run the component test and verify RED for line truncation**

Run:

```bash
npm test -- src/test/components/QuestAutomationEditor.test.ts
```

Expected: text-format assertions pass only after Step 3, but the rendered summary/reward `Text` nodes still expose `numberOfLines: 1` until the component change.

- [ ] **Step 6: Allow summary and reward text to wrap**

Remove `numberOfLines={1}` only from the mission and reward `Text` elements:

```tsx
<Text style={styles.summary}>{buildQuestMissionSummary(snapshot.missions)}</Text>
<Text style={styles.reward}>{buildQuestRewardSummary(snapshot.rewards)}</Text>
```

Keep the quest title's one-line truncation and all combat editor behavior unchanged.

- [ ] **Step 7: Run app focused tests and typecheck**

```bash
npm test -- src/test/domain/questAutomation.test.ts src/test/components/QuestAutomationEditor.test.ts
npm run typecheck
```

Expected: focused tests and TypeScript compilation pass.

- [ ] **Step 8: Commit app summary changes**

```bash
git add src/main/domain/questAutomation.ts \
  src/test/domain/questAutomation.test.ts \
  src/main/features/automation/components/QuestSummaryCard.tsx \
  src/test/components/QuestAutomationEditor.test.ts
git commit -m "fix: show complete quest mission and reward summaries"
```

### Task 4: Cross-repository verification and Android-facing smoke check

**Files:**
- Verify only; no expected production changes.

- [ ] **Step 1: Run the full backend suite**

```bash
./gradlew test
```

Expected: all backend tests pass with zero failures and errors.

- [ ] **Step 2: Run the full app suite and typecheck**

```bash
npm test
npm run typecheck
```

Expected: all app tests pass and TypeScript exits with code 0.

- [ ] **Step 3: Build the Android Hermes export outside the repository**

```bash
npx expo export --platform android --output-dir /tmp/hof-app-quest-block-export --clear
```

Expected: Expo produces one Android bundle and metadata without modifying tracked files.

- [ ] **Step 4: Verify repository boundaries and formatting**

Backend:

```bash
git diff --check
git status --short
```

Expected: only the three pre-existing user-owned backend modifications remain unstaged; implementation files are committed.

App:

```bash
git diff --check
git status --short --branch
```

Expected: the app worktree is clean on `feature/automation-row-interaction`.

- [ ] **Step 5: Perform authenticated Android smoke checks when credentials are available**

Verify these exact interactions without entering or exposing credentials on the user's behalf:

1. An expired HOF session returns to the existing re-login flow instead of showing another player's name.
2. A multi-row quest displays its item-turn-in or combat mission instead of `미션 · 없음`.
3. A multi-mission quest displays every mission and progress value.
4. A multi-reward quest displays every reward without `외 N개`.
5. Long summaries wrap and remain readable.
6. Only selected combat missions expand map configuration.

- [ ] **Step 6: Commit only if verification required a scoped correction**

If no correction was required, do not create an empty commit. If a regression fix was required, repeat RED/GREEN for that behavior and commit only its files with a focused `fix:` message.
