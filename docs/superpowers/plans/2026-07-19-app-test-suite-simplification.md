# App Test Suite Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce app test maintenance code by removing implementation-shaped assertions and collapsing duplicated UI/domain scenarios while retaining high-value behavioral regressions.

**Architecture:** Observable behavior remains protected at one deliberate boundary: pure rules in domain tests, user workflows in mounted component tests, and runtime/configuration boundaries in platform tests. No production source files change. Deletions proceed in independently verified batches so the retained suite is always runnable.

**Tech Stack:** TypeScript 6, Node test runner, `tsx`, React 19, `react-test-renderer`, Expo 57.

---

### Task 1: Record the branch-local baseline

**Files:**
- Inspect: `src/test/**/*.test.ts`
- Inspect: `package.json`

- [ ] **Step 1: Confirm the isolated branch and clean starting point**

Run:

```bash
git branch --show-current
git status --short
```

Expected: branch `refactor/simplify-test-suite`; only this plan and its design commit are present, with no production changes.

- [ ] **Step 2: Record exact baseline metrics**

Run:

```bash
find src/test -name '*.test.ts' -type f | wc -l
find src/test -name '*.test.ts' -type f -exec wc -l {} + | tail -1
rg -n '^\s*(test|it)\(' src/test -g '*.test.ts' | wc -l
/usr/bin/time -p npm test
npm run typecheck
```

Expected: 49 files, 10,977 lines, 425 tests, all 425 tests passing, and typecheck exit 0.

### Task 2: Remove implementation-source assertions with no unique runtime guarantee

**Files:**
- Delete: `src/test/components/BattlePartyPresetPicker.test.ts`
- Delete: `src/test/components/BattleRunPanel.test.ts`
- Delete: `src/test/components/CharacterList.test.ts`
- Delete: `src/test/components/PartyPresetList.test.ts`
- Delete: `src/test/domain/characterSyncAppFlow.test.ts`
- Delete: `src/test/screens/BattleTabScreen.test.ts`
- Delete: `src/test/screens/HomeTabScreen.test.ts`
- Delete: `src/test/screens/LoginScreen.test.ts`
- Delete: `src/test/screens/MainScreenCharacterTabs.test.ts`
- Delete: `src/test/screens/MainScreenTownTab.test.ts`
- Delete: `src/test/screens/TownTabScreen.test.ts`
- Preserve: `src/test/components/CaptchaChallengeModal.test.ts`
- Preserve: `src/test/platform/platformModuleResolution.test.ts`
- Preserve: `src/test/platform/pushNotifications.test.ts`
- Preserve: `src/test/screens/townAssets.test.ts`

- [ ] **Step 1: Delete the eleven pure source-inspection files**

Apply an exact deletion patch for the eleven files listed above. These files contain 50 tests and 563 lines. Do not add replacement assertions: their checks inspect JSX spelling, hook names, callback wiring text, or copy rather than executing behavior.

- [ ] **Step 2: Prove no removed guarantee was the only domain/API contract**

Run:

```bash
rg -n 'filterPartyPresets|createExecutablePartyFromPreset|rehydrateExecutablePartyFromPresetSeed' src/test/domain src/test/services
rg -n 'buildBattleMapStateKey|formatBattleMapMeta|unresolved|mapCode' src/test/domain src/test/services
rg -n 'UnifiedAutomation|typed automation|character sync|SSE' src/test/domain src/test/services src/test/components
```

Expected: the underlying party, map identity, typed automation, backend API, and character-sync state rules still have executable tests. If one of these searches has no behavioral coverage, retain only the corresponding source test until a later behavior-level replacement can reduce net code.

- [ ] **Step 3: Run the full app suite**

Run:

```bash
npm test
npm run typecheck
```

Expected: 375 tests pass and typecheck exits 0.

- [ ] **Step 4: Commit the source-inspection removal**

```bash
git add src/test
git commit -m "test: remove implementation-shaped app assertions"
```

### Task 3: Collapse repeated domain examples into case tables

**Files:**
- Modify: `src/test/domain/partyPresets.test.ts`
- Modify: `src/test/domain/battleMaps.test.ts`
- Modify: `src/test/domain/questAutomation.test.ts`
- Modify: `src/test/domain/battleMapAutomation.test.ts`
- Modify: `src/test/domain/unifiedAutomationController.test.ts`

- [ ] **Step 1: Replace same-result examples with named scenario tables**

Use this exact structure inside the existing `describe` blocks; preserve existing expected values and production calls:

```ts
for (const scenario of [
  { name: 'descriptive first boundary', input: firstInput, expected: firstExpected },
  { name: 'descriptive second boundary', input: secondInput, expected: secondExpected },
] as const) {
  it(scenario.name, () => {
    assert.deepEqual(subject(scenario.input), scenario.expected);
  });
}
```

Only combine tests when setup, invoked production function, and assertion shape are identical. Target the following existing groups:

- `partyPresets.test.ts`: name/job filtering variants; missing/partial character rehydration variants.
- `battleMaps.test.ts`: dynamic-limit metadata variants; automation eligibility variants.
- `questAutomation.test.ts`: invalid map/preset/duplicate validation variants; cached map-clear restoration variants.
- `battleMapAutomation.test.ts`: target parsing variants; rejected category variants; progress boundary variants.
- `unifiedAutomationController.test.ts`: stale aggregate ownership variants that differ only by completion order.

- [ ] **Step 2: Run each affected domain file after its table conversion**

Run these focused commands after each corresponding file conversion:

```bash
npx tsx --test src/test/domain/partyPresets.test.ts
npx tsx --test src/test/domain/battleMaps.test.ts
npx tsx --test src/test/domain/questAutomation.test.ts
npx tsx --test src/test/domain/battleMapAutomation.test.ts
npx tsx --test src/test/domain/unifiedAutomationController.test.ts
```

Expected: every named scenario passes and the number of behavioral inputs remains unchanged.

- [ ] **Step 3: Check that the refactor produces a meaningful net reduction**

Run:

```bash
git diff --stat
git diff --check
```

Expected: no production files changed, no whitespace errors, and at least 150 net test lines removed. Revert any table conversion that makes the behavior less readable or increases line count.

- [ ] **Step 4: Run and commit**

```bash
npm test
npm run typecheck
git add src/test/domain
git commit -m "test: consolidate app domain scenarios"
```

Expected: full suite and typecheck pass before commit.

### Task 4: Trim UI tests that duplicate retained domain guarantees

**Files:**
- Modify: `src/test/components/QuestAutomationEditor.test.ts`
- Modify: `src/test/components/BattleMapAutomationEditor.test.ts`
- Modify: `src/test/components/AdventureMapAutomationEditor.test.ts`

- [ ] **Step 1: Remove quest editor assertions already owned by domain tests**

Delete the following complete `it(...)` blocks only after mapping each to a retained domain test in `questAutomation.test.ts`:

```text
prioritizes selected quests after source-order filtering without changing their selection order
reinstates a middle quest at its stable selection rank for direct reselect and undo
uses stable selection order when multiple cached quests restore non-LIFO
reorders selected monster maps and saves normalized execution order
removes a selected monster map and normalizes the remaining order
marks an already selected map as added and prevents duplicate insertion
```

Retain all recent stale-callback, focus fencing, async catalog ownership, save failure, dirty-back, and accessibility cases.

- [ ] **Step 2: Remove battle editor assertions already owned by domain/catalog tests**

Delete these complete blocks only while the corresponding domain cases remain:

```text
rejects pasted non-decimal target formats and saves trimmed leading-zero decimal input as an integer
keeps saved execution order independent from catalog category and group display order
does not load or offer adventure/union maps but keeps legacy rows and a dynamically unavailable supported map selectable
```

Retain the complete edit-and-save flow, failure recovery, busy guards, stale callback fences, focus/accessibility, and catalog loading ownership cases.

- [ ] **Step 3: Consolidate adventure stale-guard variants without deleting their inputs**

Keep every recent regression input but move repeated renderer setup and retained-callback invocation into local helpers. Helpers must accept a named mutation and expected call count; they must not contain assertions unrelated to that guard. Target at least 120 net lines removed from this file without removing any regression scenario introduced by commits `6749b8b`, `8bac895`, `5841b38`, `935d5cf`, or `e876adb`.

- [ ] **Step 4: Run focused component tests**

```bash
npx tsx --test src/test/components/QuestAutomationEditor.test.ts
npx tsx --test src/test/components/BattleMapAutomationEditor.test.ts
npx tsx --test src/test/components/AdventureMapAutomationEditor.test.ts
```

Expected: all retained component tests pass.

- [ ] **Step 5: Run and commit**

```bash
npm test
npm run typecheck
git diff --check
git add src/test/components
git commit -m "test: focus automation editor coverage"
```

### Task 5: Verify app reduction and document the measured result

**Files:**
- Modify: `docs/superpowers/specs/2026-07-19-test-suite-simplification-design.md`

- [ ] **Step 1: Run fresh completion verification**

```bash
/usr/bin/time -p npm test
npm run typecheck
find src/test -name '*.test.ts' -type f | wc -l
find src/test -name '*.test.ts' -type f -exec wc -l {} + | tail -1
rg -n '^\s*(test|it)\(' src/test -g '*.test.ts' | wc -l
rg -l 'readFileSync' src/test -g '*.test.ts'
git diff master...HEAD -- src/main
```

Expected: tests and typecheck exit 0; test lines are materially below 10,977; only the four explicitly preserved boundary files still use `readFileSync`; and the production-source diff is empty.

- [ ] **Step 2: Append measured app results to the design document**

Add a `## Measured Results` section containing the new file, case, line, and wall-clock values and the percentage change from baseline. State any retained source-inspection test and its boundary rationale explicitly.

- [ ] **Step 3: Commit metrics**

```bash
git add docs/superpowers/specs/2026-07-19-test-suite-simplification-design.md
git commit -m "docs: record app test reduction"
```
