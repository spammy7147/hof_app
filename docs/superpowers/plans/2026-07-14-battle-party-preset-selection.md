# Battle Party Preset Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Change the battle map flow so users search and select a saved party preset, or explicitly choose direct selection, before the five character slots and battle actions appear.

**Architecture:** Reuse the existing party preset API and BattlePartySelector. Add pure domain helpers for preset search and executable party normalization, add a focused BattlePartyPresetPicker, and let BattleTabScreen cache preset loading state while each mounted BattleRunPanel owns only its temporary selection and party edits.

**Tech Stack:** React 19, React Native 0.86, Expo 57, TypeScript 6, Node test runner through tsx

---

## File structure

- Modify src/main/domain/partyPresets.ts: searchable preset filtering and conversion to an executable five-slot party.
- Modify src/main/domain/battleParty.ts: require exactly five valid characters before battle execution.
- Modify src/test/domain/partyPresets.test.ts: preset search and missing-character normalization coverage.
- Modify src/test/domain/battleParty.test.ts: five-member readiness coverage.
- Create src/main/features/battle/components/BattlePartyPresetPicker.tsx: searchable preset dropdown and direct-selection option.
- Create src/test/components/BattlePartyPresetPicker.test.ts: structural UI contract coverage matching the repository test style.
- Modify src/main/features/battle/components/BattleRunPanel.tsx: selection-mode state and conditional party editor rendering.
- Create src/test/components/BattleRunPanel.test.ts: initial hidden slots and post-selection structure coverage.
- Modify src/main/screens/BattleTabScreen.tsx: load/cache/retry preset data and pass it to the expanded map.
- Modify src/main/screens/MainScreen.tsx: pass the existing onListPartyPresets callback into BattleTabScreen.
- Modify src/test/screens/BattleTabScreen.test.ts: preset loading and picker wiring coverage.
- Modify src/test/screens/MainScreenCharacterTabs.test.ts: battle-tab callback forwarding coverage.

### Task 1: Preset search and executable party domain rules

**Files:**
- Modify: src/main/domain/partyPresets.ts
- Modify: src/main/domain/battleParty.ts
- Test: src/test/domain/partyPresets.test.ts
- Test: src/test/domain/battleParty.test.ts

- [ ] **Step 1: Write failing tests for preset search and party normalization**

Add these imports and cases to src/test/domain/partyPresets.test.ts:

~~~typescript
import {
  createExecutablePartyFromPreset,
  createPartyFromPreset,
  emptyPartyMembers,
  filterPartyPresets,
} from '../../main/domain/partyPresets';
import { makeHofCharacter } from '../fixtures/api';

it('filters presets by preset name, character name, or character job', () => {
  const characters = [
    makeHofCharacter(1, { name: '닌자', job: 'Kunoichi' }),
    makeHofCharacter(2, { name: '사제', job: 'Cardinal' }),
  ];
  const goblin = makePreset({
    id: 1,
    name: '고블린 범용',
    members: [
      { slotIndex: 0, characterId: 'char-1', patternSlot: 0 },
    ],
  });
  const healing = makePreset({
    id: 2,
    name: '회복 파티',
    members: [
      { slotIndex: 0, characterId: 'char-2', patternSlot: 0 },
    ],
  });

  assert.deepEqual(filterPartyPresets([goblin, healing], characters, ' 고블린 '), [goblin]);
  assert.deepEqual(filterPartyPresets([goblin, healing], characters, '닌자'), [goblin]);
  assert.deepEqual(filterPartyPresets([goblin, healing], characters, 'card'), [healing]);
});

it('clears preset members that no longer exist in synced characters', () => {
  const characters = [makeHofCharacter(1)];
  const preset = makePreset({
    members: [
      { slotIndex: 0, characterId: 'char-1', patternSlot: 0 },
      { slotIndex: 1, characterId: 'missing', patternSlot: 2 },
    ],
  });

  assert.deepEqual(createExecutablePartyFromPreset(preset, characters), [
    { slotIndex: 0, characterId: 'char-1', patternSlot: 0 },
    { slotIndex: 1, characterId: null, patternSlot: null },
    { slotIndex: 2, characterId: null, patternSlot: null },
    { slotIndex: 3, characterId: null, patternSlot: null },
    { slotIndex: 4, characterId: null, patternSlot: null },
  ]);
});
~~~

Replace the existing partial-party success test in src/test/domain/battleParty.test.ts with:

~~~typescript
it('requires all five party slots before building a battle request', () => {
  const characters = Array.from({ length: 5 }, (_, index) => makeHofCharacter(index + 1));
  const party = updateBattlePartyMember(
    createDefaultBattleParty(characters),
    4,
    null,
    characters,
  );

  assert.equal(isBattlePartyReady(party, characters), false);
  assert.throws(
    () => toRunBattleRequest({
      categoryId: 'battle_map',
      mapCode: 'snow22',
      party,
      characters,
      battleCount: 1,
    }),
    /캐릭터 5명을 모두 선택해야 합니다/,
  );
});
~~~

- [ ] **Step 2: Run the domain tests and verify the expected failures**

Run:

~~~bash
npx tsx --test src/test/domain/partyPresets.test.ts src/test/domain/battleParty.test.ts
~~~

Expected: FAIL because filterPartyPresets and createExecutablePartyFromPreset do not exist, and the current readiness rule still accepts a partial party.

- [ ] **Step 3: Implement the minimal domain behavior**

Add to src/main/domain/partyPresets.ts:

~~~typescript
import type {
  CreatePartyPresetRequest,
  HofCharacter,
  PartyPresetResponse,
} from '../types/api';

export function filterPartyPresets(
  presets: PartyPresetResponse[],
  characters: HofCharacter[],
  query: string,
): PartyPresetResponse[] {
  const normalizedQuery = normalizePresetSearchText(query);
  if (normalizedQuery.length === 0) return presets;

  const characterById = new Map(
    characters.map((character) => [character.hofCharacterId, character]),
  );
  return presets.filter((preset) => {
    const memberText = preset.members
      .map((member) => {
        if (member.characterId == null) return '';
        const character = characterById.get(member.characterId);
        return character == null ? '' : character.name + ' ' + character.job;
      })
      .join(' ');
    return normalizePresetSearchText(preset.name + ' ' + memberText)
      .includes(normalizedQuery);
  });
}

export function createExecutablePartyFromPreset(
  preset: PartyPresetResponse,
  characters: HofCharacter[],
): BattlePartyMember[] {
  return sanitizeBattlePartyForCharacters(createPartyFromPreset(preset), characters);
}

export function sanitizeBattlePartyForCharacters(
  party: BattlePartyMember[],
  characters: HofCharacter[],
): BattlePartyMember[] {
  const characterIds = new Set(characters.map((character) => character.hofCharacterId));
  return party.map((member) => (
    member.characterId != null && characterIds.has(member.characterId)
      ? member
      : { ...member, characterId: null, patternSlot: null }
  ));
}

function normalizePresetSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('ko-KR');
}
~~~

Update isBattlePartyReady and its error in src/main/domain/battleParty.ts:

~~~typescript
const selectedIds = party
  .map((member) => member.characterId)
  .filter((characterId): characterId is string => (
    characterId != null && characterId.trim().length > 0
  ));
if (selectedIds.length !== BATTLE_PARTY_SIZE) return false;
if (new Set(selectedIds).size !== selectedIds.length) return false;

throw new Error('전투에 사용할 캐릭터 5명을 모두 선택해야 합니다.');
~~~

- [ ] **Step 4: Run the domain tests and verify they pass**

Run:

~~~bash
npx tsx --test src/test/domain/partyPresets.test.ts src/test/domain/battleParty.test.ts
~~~

Expected: PASS with no failed tests.

- [ ] **Step 5: Commit only the task files**

~~~bash
git add src/main/domain/partyPresets.ts src/main/domain/battleParty.ts src/test/domain/partyPresets.test.ts src/test/domain/battleParty.test.ts
git commit -m "feat: add battle preset selection rules"
~~~

### Task 2: Searchable party preset picker

**Files:**
- Create: src/main/features/battle/components/BattlePartyPresetPicker.tsx
- Test: src/test/components/BattlePartyPresetPicker.test.ts

- [ ] **Step 1: Write a failing structural component test**

Create src/test/components/BattlePartyPresetPicker.test.ts:

~~~typescript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

describe('BattlePartyPresetPicker', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/main/features/battle/components/BattlePartyPresetPicker.tsx'),
    'utf8',
  );

  it('provides a searchable preset dropdown with a persistent direct option', () => {
    assert.match(source, /filterPartyPresets/);
    assert.match(source, /프리셋 이름 또는 캐릭터 검색/);
    assert.match(source, /캐릭터 직접 선택/);
    assert.match(source, /FlatList/);
    assert.match(source, /accessibilityState=\\{\\{ expanded/);
  });

  it('keeps direct selection usable after preset loading fails', () => {
    assert.match(source, /다시 시도/);
    assert.match(source, /onSelectDirect/);
    assert.doesNotMatch(source, /disabled=\\{errorMessage != null\\}/);
  });
});
~~~

- [ ] **Step 2: Run the test and verify the missing-file failure**

Run:

~~~bash
npx tsx --test src/test/components/BattlePartyPresetPicker.test.ts
~~~

Expected: FAIL with ENOENT for BattlePartyPresetPicker.tsx.

- [ ] **Step 3: Implement the searchable picker**

Create src/main/features/battle/components/BattlePartyPresetPicker.tsx with this public contract:

~~~typescript
type PartySelectionMode = 'preset' | 'direct' | null;

type BattlePartyPresetPickerProps = {
  characters: HofCharacter[];
  presets: PartyPresetResponse[];
  loading: boolean;
  errorMessage: string | null;
  selectedMode: PartySelectionMode;
  selectedPresetId: number | null;
  onRetry: () => void;
  onSelectDirect: () => void;
  onSelectPreset: (preset: PartyPresetResponse) => void;
};
~~~

Implement these behaviors in the component:

~~~typescript
const [expanded, setExpanded] = useState(false);
const [query, setQuery] = useState('');
const filteredPresets = useMemo(
  () => filterPartyPresets(presets, characters, query),
  [characters, presets, query],
);
const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;

<Pressable
  accessibilityRole="button"
  accessibilityState={{ expanded, disabled: loading }}
  disabled={loading}
  onPress={() => setExpanded((current) => !current)}
>
  <Text>{selectedMode === 'direct'
    ? '캐릭터 직접 선택'
    : selectedPreset?.name ?? '프리셋을 선택하세요'}</Text>
</Pressable>
~~~

When expanded, render a search TextInput and a max-height FlatList using nestedScrollEnabled. Render error and retry above the list when errorMessage is present. Render the direct option outside FlatList and below all search results so it remains visible for empty results and API errors:

~~~typescript
<TextInput
  autoCapitalize="none"
  autoCorrect={false}
  onChangeText={setQuery}
  placeholder="프리셋 이름 또는 캐릭터 검색"
  value={query}
/>
<FlatList
  data={filteredPresets}
  keyExtractor={(preset) => String(preset.id)}
  nestedScrollEnabled
  renderItem={({ item }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: item.id === selectedPresetId }}
      onPress={() => {
        onSelectPreset(item);
        setExpanded(false);
        setQuery('');
      }}
    >
      <Text>{item.name}</Text>
      <Text>{formatPartyPresetSummary(item)}</Text>
    </Pressable>
  )}
/>
<Pressable
  accessibilityRole="button"
  accessibilityState={{ selected: selectedMode === 'direct' }}
  onPress={() => {
    onSelectDirect();
    setExpanded(false);
    setQuery('');
  }}
>
  <Text>캐릭터 직접 선택</Text>
  <Text>프리셋 없이 캐릭터 5명과 패턴 지정</Text>
</Pressable>
~~~

Use StyleSheet.create, Pressable, TextInput, FlatList, ActivityIndicator, ChevronDown, and ChevronUp following the existing BattlePartySelector visual language.

- [ ] **Step 4: Run the picker test and typecheck**

Run:

~~~bash
npx tsx --test src/test/components/BattlePartyPresetPicker.test.ts
npm run typecheck
~~~

Expected: both commands exit successfully.

- [ ] **Step 5: Commit only the picker files**

~~~bash
git add src/main/features/battle/components/BattlePartyPresetPicker.tsx src/test/components/BattlePartyPresetPicker.test.ts
git commit -m "feat: add searchable battle preset picker"
~~~

### Task 3: Gate the five-character editor behind a selection

**Files:**
- Modify: src/main/features/battle/components/BattleRunPanel.tsx
- Test: src/test/components/BattleRunPanel.test.ts

- [ ] **Step 1: Write the failing BattleRunPanel structure test**

Create src/test/components/BattleRunPanel.test.ts:

~~~typescript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

describe('BattleRunPanel', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/main/features/battle/components/BattleRunPanel.tsx'),
    'utf8',
  );

  it('shows preset selection before the five-character editor', () => {
    assert.match(source, /BattlePartyPresetPicker/);
    assert.match(source, /selectedMode != null/);
    assert.match(source, /selectedMode != null \\? \\(/);
    assert.match(source, /<BattlePartySelector/);
  });

  it('starts direct selection with five empty slots', () => {
    assert.match(source, /emptyPartyMembers\\(\\)/);
    assert.match(source, /setSelectedMode\\('direct'\\)/);
  });

  it('loads a selected preset into an executable party without saving it', () => {
    assert.match(source, /createExecutablePartyFromPreset/);
    assert.match(source, /setSelectedPresetId\\(preset\\.id\\)/);
    assert.doesNotMatch(source, /onUpdatePartyPreset/);
  });
});
~~~

- [ ] **Step 2: Run the test and verify it fails for missing selection behavior**

Run:

~~~bash
npx tsx --test src/test/components/BattleRunPanel.test.ts
~~~

Expected: FAIL because BattleRunPanel immediately creates and renders a default party.

- [ ] **Step 3: Implement the selection gate**

Extend BattleRunPanelProps:

~~~typescript
type BattleRunPanelProps = {
  characters: HofCharacter[];
  partyPresets: PartyPresetResponse[];
  arePartyPresetsLoading: boolean;
  partyPresetsError: string | null;
  isRunning: boolean;
  result: BattleResultResponse | null;
  errorMessage: string | null;
  onRetryPartyPresets: () => void;
  onRunBattle: (party: BattlePartyMember[], battleCount: 1 | 3) => void;
};
~~~

Replace the default-first-five state with:

~~~typescript
const [selectedMode, setSelectedMode] = useState<'preset' | 'direct' | null>(null);
const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
const [party, setParty] = useState<BattlePartyMember[]>(emptyPartyMembers);
const [activeSlotIndex, setActiveSlotIndex] = useState(0);

useEffect(() => {
  setParty((current) => sanitizeBattlePartyForCharacters(current, characters));
  setActiveSlotIndex(0);
}, [characters]);
~~~

Import the Task 1 helpers so character synchronization preserves valid edits while clearing removed characters:

~~~typescript
import {
  createExecutablePartyFromPreset,
  emptyPartyMembers,
  sanitizeBattlePartyForCharacters,
} from '../../../domain/partyPresets';
~~~

Wire picker callbacks:

~~~typescript
function selectPreset(preset: PartyPresetResponse) {
  setSelectedMode('preset');
  setSelectedPresetId(preset.id);
  setParty(createExecutablePartyFromPreset(preset, characters));
  setActiveSlotIndex(0);
}

function selectDirect() {
  setSelectedMode('direct');
  setSelectedPresetId(null);
  setParty(emptyPartyMembers());
  setActiveSlotIndex(0);
}
~~~

Always render BattlePartyPresetPicker. Render BattlePartySelector, sortie count, action buttons, error, and result only inside selectedMode != null. Keep the existing no-characters message above execution controls, but allow the picker and its error/direct state to render.

- [ ] **Step 4: Run the component/domain tests and typecheck**

Run:

~~~bash
npx tsx --test src/test/components/BattleRunPanel.test.ts src/test/domain/partyPresets.test.ts
npm run typecheck
~~~

Expected: both commands exit successfully.

- [ ] **Step 5: Commit only the panel and helper files**

~~~bash
git add src/main/features/battle/components/BattleRunPanel.tsx src/main/domain/partyPresets.ts src/test/components/BattleRunPanel.test.ts src/test/domain/partyPresets.test.ts
git commit -m "feat: gate battle party editor behind preset choice"
~~~

### Task 4: Load and cache presets in the battle tab

**Files:**
- Modify: src/main/screens/BattleTabScreen.tsx
- Modify: src/main/screens/MainScreen.tsx
- Modify: src/test/screens/BattleTabScreen.test.ts
- Modify: src/test/screens/MainScreenCharacterTabs.test.ts

- [ ] **Step 1: Write failing screen wiring tests**

Add to src/test/screens/BattleTabScreen.test.ts:

~~~typescript
it('loads party presets when a map is opened and passes picker state to the run panel', () => {
  assert.match(source, /onListPartyPresets/);
  assert.match(source, /loadPartyPresets/);
  assert.match(source, /partyPresets=\\{partyPresets/);
  assert.match(source, /onRetryPartyPresets=\\{/);
});

it('reuses a successful preset response instead of loading for every map', () => {
  assert.match(source, /partyPresetsLoaded/);
  assert.match(source, /if \\(!force && partyPresetsLoaded\\) return/);
});
~~~

Add to src/test/screens/MainScreenCharacterTabs.test.ts:

~~~typescript
it('forwards the existing party preset loader into the battle tab', () => {
  assert.match(source, /<BattleTabScreen/);
  assert.match(source, /onListPartyPresets=\\{onListPartyPresets\\}/);
});
~~~

- [ ] **Step 2: Run the screen tests and verify they fail**

Run:

~~~bash
npx tsx --test src/test/screens/BattleTabScreen.test.ts src/test/screens/MainScreenCharacterTabs.test.ts
~~~

Expected: FAIL because BattleTabScreen does not accept or load party presets.

- [ ] **Step 3: Forward the existing callback from MainScreen**

Add this prop to the BattleTabScreen call in renderActiveTab:

~~~typescript
<BattleTabScreen
  authenticated={authenticated}
  categories={battleCategories}
  isLoading={isBattleCategoriesLoading}
  errorMessage={battleCategoriesError}
  characters={characters}
  onListPartyPresets={onListPartyPresets}
  onLoadCategories={onLoadBattleCategories}
  onLoadMaps={onLoadBattleMaps}
  onRunBattle={onRunBattle}
/>
~~~

- [ ] **Step 4: Implement preset loading, caching, and retry**

Extend BattleTabScreenProps:

~~~typescript
onListPartyPresets: () => Promise<PartyPresetResponse[]>;
~~~

Add state and a callback inside BattleTabScreen:

~~~typescript
const [partyPresets, setPartyPresets] = useState<PartyPresetResponse[]>([]);
const [partyPresetsLoaded, setPartyPresetsLoaded] = useState(false);
const [partyPresetsLoading, setPartyPresetsLoading] = useState(false);
const [partyPresetsError, setPartyPresetsError] = useState<string | null>(null);

const loadPartyPresets = useCallback(async (force = false) => {
  if (!force && partyPresetsLoaded) return;
  if (partyPresetsLoading) return;
  setPartyPresetsLoading(true);
  setPartyPresetsError(null);
  try {
    setPartyPresets(await onListPartyPresets());
    setPartyPresetsLoaded(true);
  } catch (error) {
    setPartyPresetsError(
      error instanceof Error ? error.message : '파티 프리셋을 불러오지 못했습니다.',
    );
  } finally {
    setPartyPresetsLoading(false);
  }
}, [onListPartyPresets, partyPresetsLoaded, partyPresetsLoading]);
~~~

Call void loadPartyPresets() when toggleMap opens a map. Pass these values through BattleMapRow to BattleRunPanel:

~~~typescript
partyPresets={partyPresets}
arePartyPresetsLoading={partyPresetsLoading}
partyPresetsError={partyPresetsError}
onRetryPartyPresets={() => void loadPartyPresets(true)}
~~~

Do not clear partyPresets on a map change. Clear loaded preset state only when authenticated becomes false so another session cannot reuse the previous account's presets.

- [ ] **Step 5: Run screen tests, all tests, and typecheck**

Run:

~~~bash
npx tsx --test src/test/screens/BattleTabScreen.test.ts src/test/screens/MainScreenCharacterTabs.test.ts
npm test
npm run typecheck
~~~

Expected: all commands exit successfully with zero failed tests and zero TypeScript errors.

- [ ] **Step 6: Commit only the screen wiring files**

~~~bash
git add src/main/screens/BattleTabScreen.tsx src/main/screens/MainScreen.tsx src/test/screens/BattleTabScreen.test.ts src/test/screens/MainScreenCharacterTabs.test.ts
git commit -m "feat: load party presets in battle tab"
~~~

### Task 5: Final mobile behavior verification

**Files:**
- Verify only; no planned production changes.

- [ ] **Step 1: Run clean automated verification**

~~~bash
npm test
npm run typecheck
git diff --check
~~~

Expected: tests and typecheck succeed; git diff --check prints no output.

- [ ] **Step 2: Run the Android development build**

~~~bash
npx expo start --dev-client
~~~

On the Android emulator, verify:

1. Open Battle → Battle Map → a group → a map.
2. Confirm the five character rows are hidden initially.
3. Open the preset picker and search by preset name, character name, and job.
4. Select a preset and confirm all five rows and pattern controls appear.
5. Modify one character or pattern and confirm the saved preset remains unchanged in the Characters → Presets tab.
6. Close and reopen the map and confirm temporary edits reset.
7. Choose direct selection and confirm all five slots start empty.
8. Fill all five slots; confirm battle buttons stay disabled until the fifth valid character and pattern are selected.
9. Run one battle and confirm existing captcha, session recovery, result, and map-refresh behavior still works.

- [ ] **Step 3: Review the final diff without touching unrelated changes**

~~~bash
git status --short
git diff -- src/main/domain/partyPresets.ts src/main/domain/battleParty.ts src/main/features/battle/components/BattlePartyPresetPicker.tsx src/main/features/battle/components/BattleRunPanel.tsx src/main/screens/BattleTabScreen.tsx src/main/screens/MainScreen.tsx src/test/domain/partyPresets.test.ts src/test/domain/battleParty.test.ts src/test/components/BattlePartyPresetPicker.test.ts src/test/components/BattleRunPanel.test.ts src/test/screens/BattleTabScreen.test.ts src/test/screens/MainScreenCharacterTabs.test.ts
~~~

Expected: only the planned battle preset selection changes appear. Preserve the existing captcha and React Native dependency changes already present in the worktree.
