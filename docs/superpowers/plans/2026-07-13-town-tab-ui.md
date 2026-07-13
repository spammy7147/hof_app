# Categorized Town Tab UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the town placeholder with an APK-derived, category-first town menu UI that performs no backend requests.

**Architecture:** Keep the APK menu metadata in a pure TypeScript catalog, keep static image imports in a small Expo-facing asset module, and let `TownTabScreen` own only local section/category/menu selection state. `MainScreen` continues to own the main bottom tab and renders the town screen inside its existing scroll container.

**Tech Stack:** Expo SDK 57, React 19, React Native 0.86, TypeScript 6, `expo-image` 57, Node test runner through `tsx`.

---

## File structure

- Create `src/main/domain/townMenus.ts`: typed category and menu catalog derived from APK 3.56.
- Create `src/main/screens/townAssets.ts`: static `require()` mapping for the copied 24x24 APK icons.
- Create `src/main/screens/TownTabScreen.tsx`: sub-tabs, fixed category tabs, two-column menu grid, and selection placeholder.
- Modify `src/main/screens/MainScreen.tsx`: render `TownTabScreen` for the `town` main tab.
- Create `src/test/domain/townMenus.test.ts`: catalog coverage, ordering, and APK menu mapping tests.
- Create `src/test/screens/townAssets.test.ts`: verifies every copied asset has a static Expo source mapping.
- Create `src/test/screens/TownTabScreen.test.ts`: verifies the approved category-first interaction is present and API-free.
- Create `src/test/screens/MainScreenTownTab.test.ts`: verifies the placeholder is replaced at the main-tab boundary.
- Copy eight assets into `assets/town/`: `fish.gif`, `coin.gif`, `potion.png`, `box.gif`, `card.gif`, `sewing.gif`, `book.gif`, `smith.gif`.

The source assets are read from `../example/mobile_analysis/analysis/app-unzip/assets/icons/town/` relative to the app repository. Expo SDK 57's `expo-image` supports GIF/PNG on Android and accepts local `require()` results as `source`, so no conversion or network loading is needed.

### Task 1: Add the typed town menu catalog

**Files:**
- Create: `src/test/domain/townMenus.test.ts`
- Create: `src/main/domain/townMenus.ts`

- [ ] **Step 1: Write the failing catalog test**

Create `src/test/domain/townMenus.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TOWN_CATEGORIES,
  TOWN_MENUS,
  getTownMenusForCategory,
} from '../../main/domain/townMenus';

describe('town menu catalog', () => {
  it('keeps the approved category order', () => {
    assert.deepEqual(
      TOWN_CATEGORIES.map((category) => [category.id, category.label]),
      [
        ['life', '생활'],
        ['market', '상점'],
        ['card', '카드'],
        ['craft', '제작'],
      ],
    );
  });

  it('maps all 14 APK town menus exactly once', () => {
    assert.equal(TOWN_MENUS.length, 14);
    assert.equal(new Set(TOWN_MENUS.map((menu) => menu.id)).size, 14);
    assert.deepEqual(
      TOWN_MENUS.map((menu) => [menu.label, menu.apkMenu]),
      [
        ['낚시', 'fishing'],
        ['낚시 교환소', 'createF'],
        ['일반 상점', 'buy'],
        ['암흑상점', 'sbuy'],
        ['옥션', 'auction'],
        ['낙찰 시세', 'auctionMarket'],
        ['상자 열기', 'stash'],
        ['카드 합성', 'cardmix'],
        ['카드 변환', 'cardmix2'],
        ['블랭크 교환', 'cardsell'],
        ['오브 교환소', 'orbboxshop'],
        ['재봉/리메이크', 'sewingshop'],
        ['개인 작업장', 'workbase'],
        ['장로 대장간', 'refine2'],
      ],
    );
  });

  it('returns menus in APK order within each fixed category', () => {
    assert.deepEqual(
      getTownMenusForCategory('market').map((menu) => menu.label),
      ['일반 상점', '암흑상점', '옥션', '낙찰 시세', '상자 열기'],
    );
    assert.deepEqual(
      getTownMenusForCategory('craft').map((menu) => menu.label),
      ['재봉/리메이크', '개인 작업장', '장로 대장간'],
    );
  });
});
```

- [ ] **Step 2: Run the catalog test and verify it fails**

Run:

```bash
npx tsx --test src/test/domain/townMenus.test.ts
```

Expected: FAIL with `Cannot find module '../../main/domain/townMenus'`.

- [ ] **Step 3: Implement the pure catalog**

Create `src/main/domain/townMenus.ts`:

```ts
export type TownSectionId = 'town' | 'quest';

export type TownCategoryId = 'life' | 'market' | 'card' | 'craft';

export type TownMenuId =
  | 'fishing'
  | 'fishingExchange'
  | 'generalShop'
  | 'darkShop'
  | 'auction'
  | 'auctionMarket'
  | 'stash'
  | 'cardMix'
  | 'cardChange'
  | 'blankExchange'
  | 'orbExchange'
  | 'sewingShop'
  | 'workbase'
  | 'veteranSmithy';

export type TownIconId =
  | 'fish'
  | 'coin'
  | 'potion'
  | 'box'
  | 'card'
  | 'sewing'
  | 'book'
  | 'smith';

export type TownCategory = {
  id: TownCategoryId;
  label: string;
};

export type TownMenu = {
  id: TownMenuId;
  categoryId: TownCategoryId;
  label: string;
  apkMenu: string;
  iconId: TownIconId;
};

export const DEFAULT_TOWN_SECTION_ID: TownSectionId = 'town';
export const DEFAULT_TOWN_CATEGORY_ID: TownCategoryId = 'life';

export const TOWN_CATEGORIES: readonly TownCategory[] = [
  { id: 'life', label: '생활' },
  { id: 'market', label: '상점' },
  { id: 'card', label: '카드' },
  { id: 'craft', label: '제작' },
];

export const TOWN_MENUS: readonly TownMenu[] = [
  { id: 'fishing', categoryId: 'life', label: '낚시', apkMenu: 'fishing', iconId: 'fish' },
  { id: 'fishingExchange', categoryId: 'life', label: '낚시 교환소', apkMenu: 'createF', iconId: 'fish' },
  { id: 'generalShop', categoryId: 'market', label: '일반 상점', apkMenu: 'buy', iconId: 'coin' },
  { id: 'darkShop', categoryId: 'market', label: '암흑상점', apkMenu: 'sbuy', iconId: 'potion' },
  { id: 'auction', categoryId: 'market', label: '옥션', apkMenu: 'auction', iconId: 'coin' },
  { id: 'auctionMarket', categoryId: 'market', label: '낙찰 시세', apkMenu: 'auctionMarket', iconId: 'coin' },
  { id: 'stash', categoryId: 'market', label: '상자 열기', apkMenu: 'stash', iconId: 'box' },
  { id: 'cardMix', categoryId: 'card', label: '카드 합성', apkMenu: 'cardmix', iconId: 'card' },
  { id: 'cardChange', categoryId: 'card', label: '카드 변환', apkMenu: 'cardmix2', iconId: 'card' },
  { id: 'blankExchange', categoryId: 'card', label: '블랭크 교환', apkMenu: 'cardsell', iconId: 'card' },
  { id: 'orbExchange', categoryId: 'card', label: '오브 교환소', apkMenu: 'orbboxshop', iconId: 'potion' },
  { id: 'sewingShop', categoryId: 'craft', label: '재봉/리메이크', apkMenu: 'sewingshop', iconId: 'sewing' },
  { id: 'workbase', categoryId: 'craft', label: '개인 작업장', apkMenu: 'workbase', iconId: 'book' },
  { id: 'veteranSmithy', categoryId: 'craft', label: '장로 대장간', apkMenu: 'refine2', iconId: 'smith' },
];

export function getTownMenusForCategory(categoryId: TownCategoryId): TownMenu[] {
  return TOWN_MENUS.filter((menu) => menu.categoryId === categoryId);
}
```

- [ ] **Step 4: Run the catalog test and verify it passes**

Run:

```bash
npx tsx --test src/test/domain/townMenus.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the catalog**

```bash
git add src/main/domain/townMenus.ts src/test/domain/townMenus.test.ts
git commit -m "feat: add town menu catalog"
```

### Task 2: Add APK town icon assets

**Files:**
- Create: `src/test/screens/townAssets.test.ts`
- Create: `src/main/screens/townAssets.ts`
- Create: `assets/town/book.gif`
- Create: `assets/town/box.gif`
- Create: `assets/town/card.gif`
- Create: `assets/town/coin.gif`
- Create: `assets/town/fish.gif`
- Create: `assets/town/potion.png`
- Create: `assets/town/sewing.gif`
- Create: `assets/town/smith.gif`

- [ ] **Step 1: Write the failing static asset mapping test**

Create `src/test/screens/townAssets.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('town icon asset mapping', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/main/screens/townAssets.ts'), 'utf8');

  it('uses static local sources for every APK town icon', () => {
    for (const file of [
      'fish.gif',
      'coin.gif',
      'potion.png',
      'box.gif',
      'card.gif',
      'sewing.gif',
      'book.gif',
      'smith.gif',
    ]) {
      assert.match(source, new RegExp(`require\\('\\.\\.\\/\\.\\.\\/\\.\\.\\/assets\\/town\\/${file.replace('.', '\\.')}\\'\\)`));
    }
  });
});
```

- [ ] **Step 2: Run the asset test and verify it fails**

Run:

```bash
npx tsx --test src/test/screens/townAssets.test.ts
```

Expected: FAIL with `ENOENT` for `src/main/screens/townAssets.ts`.

- [ ] **Step 3: Copy the eight decoded APK assets**

Run from `/Users/spammy/playground/HOF/hof_app`:

```bash
mkdir -p assets/town
cp ../example/mobile_analysis/analysis/app-unzip/assets/icons/town/book.gif assets/town/book.gif
cp ../example/mobile_analysis/analysis/app-unzip/assets/icons/town/box.gif assets/town/box.gif
cp ../example/mobile_analysis/analysis/app-unzip/assets/icons/town/card.gif assets/town/card.gif
cp ../example/mobile_analysis/analysis/app-unzip/assets/icons/town/coin.gif assets/town/coin.gif
cp ../example/mobile_analysis/analysis/app-unzip/assets/icons/town/fish.gif assets/town/fish.gif
cp ../example/mobile_analysis/analysis/app-unzip/assets/icons/town/potion.png assets/town/potion.png
cp ../example/mobile_analysis/analysis/app-unzip/assets/icons/town/sewing.gif assets/town/sewing.gif
cp ../example/mobile_analysis/analysis/app-unzip/assets/icons/town/smith.gif assets/town/smith.gif
```

Expected: `file assets/town/*` reports 24x24 GIF or PNG images.

- [ ] **Step 4: Add the Expo static source mapping**

Create `src/main/screens/townAssets.ts`:

```ts
import type { ImageSource } from 'expo-image';

import type { TownIconId } from '../domain/townMenus';

export const TOWN_ICON_SOURCES: Record<TownIconId, ImageSource> = {
  fish: require('../../../assets/town/fish.gif'),
  coin: require('../../../assets/town/coin.gif'),
  potion: require('../../../assets/town/potion.png'),
  box: require('../../../assets/town/box.gif'),
  card: require('../../../assets/town/card.gif'),
  sewing: require('../../../assets/town/sewing.gif'),
  book: require('../../../assets/town/book.gif'),
  smith: require('../../../assets/town/smith.gif'),
};
```

- [ ] **Step 5: Run the asset test and type checker**

Run:

```bash
npx tsx --test src/test/screens/townAssets.test.ts
npm run typecheck
```

Expected: asset test PASS and TypeScript exits with code 0.

- [ ] **Step 6: Commit the copied assets and mapping**

```bash
git add assets/town src/main/screens/townAssets.ts src/test/screens/townAssets.test.ts
git commit -m "feat: add APK town icons"
```

### Task 3: Build the fixed-category town screen

**Files:**
- Create: `src/test/screens/TownTabScreen.test.ts`
- Create: `src/main/screens/TownTabScreen.tsx`

- [ ] **Step 1: Write the failing screen structure test**

Create `src/test/screens/TownTabScreen.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('town tab screen', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/main/screens/TownTabScreen.tsx'), 'utf8');

  it('keeps categories visible and swaps only the two-column menu grid', () => {
    assert.match(source, /TOWN_CATEGORIES\.map/);
    assert.match(source, /getTownMenusForCategory\(selectedCategoryId\)/);
    assert.match(source, /setSelectedCategoryId\(category\.id\)/);
    assert.match(source, /setSelectedMenuId\(null\)/);
    assert.doesNotMatch(source, /ArrowLeft|뒤로/);
  });

  it('supports town and quest sub-tabs without making service requests', () => {
    assert.match(source, /마을/);
    assert.match(source, /퀘·교환/);
    assert.match(source, /서비스 준비 중/);
    assert.match(source, /expo-image/);
    assert.doesNotMatch(source, /BackendApi|fetch\(|onLoad|onRun|onSubmit/);
  });
});
```

- [ ] **Step 2: Run the screen test and verify it fails**

Run:

```bash
npx tsx --test src/test/screens/TownTabScreen.test.ts
```

Expected: FAIL with `ENOENT` for `src/main/screens/TownTabScreen.tsx`.

- [ ] **Step 3: Implement the approved town screen**

Create `src/main/screens/TownTabScreen.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import {
  DEFAULT_TOWN_CATEGORY_ID,
  DEFAULT_TOWN_SECTION_ID,
  TOWN_CATEGORIES,
  getTownMenusForCategory,
  type TownCategoryId,
  type TownMenuId,
  type TownSectionId,
} from '../domain/townMenus';
import { theme } from '../styles/theme';
import { TOWN_ICON_SOURCES } from './townAssets';

export function TownTabScreen() {
  const [selectedSectionId, setSelectedSectionId] = useState<TownSectionId>(DEFAULT_TOWN_SECTION_ID);
  const [selectedCategoryId, setSelectedCategoryId] = useState<TownCategoryId>(DEFAULT_TOWN_CATEGORY_ID);
  const [selectedMenuId, setSelectedMenuId] = useState<TownMenuId | null>(null);

  const visibleMenus = useMemo(
    () => getTownMenusForCategory(selectedCategoryId),
    [selectedCategoryId],
  );
  const selectedMenu = visibleMenus.find((menu) => menu.id === selectedMenuId) ?? null;

  function selectCategory(categoryId: TownCategoryId) {
    setSelectedCategoryId(categoryId);
    setSelectedMenuId(null);
  }

  return (
    <View style={styles.container}>
      <View accessibilityRole="tablist" style={styles.sectionTabs}>
        <SectionTab
          active={selectedSectionId === 'town'}
          label="마을"
          onPress={() => setSelectedSectionId('town')}
        />
        <SectionTab
          active={selectedSectionId === 'quest'}
          label="퀘·교환"
          onPress={() => setSelectedSectionId('quest')}
        />
      </View>

      {selectedSectionId === 'town' ? (
        <>
          <Text style={styles.hint}>상점·생활·교환 기능을 분류별로 선택하세요.</Text>

          <View accessibilityRole="tablist" style={styles.categoryTabs}>
            {TOWN_CATEGORIES.map((category) => {
              const active = category.id === selectedCategoryId;
              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  key={category.id}
                  onPress={() => selectCategory(category.id)}
                  style={({ pressed }) => [
                    styles.categoryTab,
                    active && styles.activeCategoryTab,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.categoryLabel, active && styles.activeCategoryLabel]}>
                    {category.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.menuGrid}>
            {visibleMenus.map((menu) => {
              const selected = menu.id === selectedMenuId;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={menu.id}
                  onPress={() => setSelectedMenuId(menu.id)}
                  style={({ pressed }) => [
                    styles.menuButton,
                    selected && styles.selectedMenuButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Image
                    accessible={false}
                    contentFit="contain"
                    source={TOWN_ICON_SOURCES[menu.iconId]}
                    style={styles.menuIcon}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.menuLabel, selected && styles.selectedMenuLabel]}
                  >
                    {menu.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.selectionPanel}>
            <Text style={styles.selectionTitle}>
              {selectedMenu?.label ?? '메뉴를 선택해 주세요'}
            </Text>
            <Text style={styles.selectionText}>
              {selectedMenu ? '서비스 준비 중' : '원하는 마을 기능을 누르면 여기에 표시돼요.'}
            </Text>
          </View>
        </>
      ) : (
        <View style={styles.selectionPanel}>
          <Text style={styles.selectionTitle}>퀘·교환</Text>
          <Text style={styles.selectionText}>퀘스트와 교환 기능을 연결할 준비 화면이에요.</Text>
        </View>
      )}
    </View>
  );
}

function SectionTab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sectionTab,
        active && styles.activeSectionTab,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.sectionLabel, active && styles.activeSectionLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.md,
  },
  sectionTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sectionTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  activeSectionTab: {
    borderBottomColor: theme.colors.accentBlue,
  },
  sectionLabel: {
    color: theme.colors.textMuted,
    fontSize: 16,
    fontWeight: '800',
  },
  activeSectionLabel: {
    color: theme.colors.text,
  },
  hint: {
    color: theme.colors.textMuted,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accentBlue,
    paddingLeft: theme.spacing.md,
    fontSize: 13,
    lineHeight: 19,
  },
  categoryTabs: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  categoryTab: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
  },
  activeCategoryTab: {
    borderColor: theme.colors.accentBlue,
    backgroundColor: theme.colors.surfaceAlt,
  },
  categoryLabel: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  activeCategoryLabel: {
    color: theme.colors.text,
  },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.sm,
  },
  menuButton: {
    width: '48.7%',
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.sm,
  },
  selectedMenuButton: {
    borderColor: theme.colors.accentAmber,
    backgroundColor: theme.colors.surfaceAlt,
  },
  menuIcon: {
    width: 24,
    height: 24,
  },
  menuLabel: {
    flexShrink: 1,
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  selectedMenuLabel: {
    color: theme.colors.accentAmber,
  },
  selectionPanel: {
    minHeight: 96,
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  selectionTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  selectionText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  pressed: {
    opacity: 0.75,
  },
});
```

- [ ] **Step 4: Run the screen test and type checker**

Run:

```bash
npx tsx --test src/test/screens/TownTabScreen.test.ts
npm run typecheck
```

Expected: 2 screen tests PASS and TypeScript exits with code 0.

- [ ] **Step 5: Commit the screen**

```bash
git add src/main/screens/TownTabScreen.tsx src/test/screens/TownTabScreen.test.ts
git commit -m "feat: build categorized town screen"
```

### Task 4: Replace the main-tab placeholder

**Files:**
- Create: `src/test/screens/MainScreenTownTab.test.ts`
- Modify: `src/main/screens/MainScreen.tsx`

- [ ] **Step 1: Write the failing main-screen wiring test**

Create `src/test/screens/MainScreenTownTab.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('main screen town tab', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/main/screens/MainScreen.tsx'), 'utf8');

  it('renders the categorized town screen instead of the placeholder', () => {
    assert.match(source, /import \{ TownTabScreen \} from '\.\/TownTabScreen';/);
    assert.match(source, /case 'town':[\s\S]*<TownTabScreen \/>/);
    assert.doesNotMatch(source, /상점, 교환소, 작업장 준비 중/);
  });
});
```

- [ ] **Step 2: Run the wiring test and verify it fails**

Run:

```bash
npx tsx --test src/test/screens/MainScreenTownTab.test.ts
```

Expected: FAIL because `MainScreen.tsx` still imports and renders `PlaceholderTabScreen` for town.

- [ ] **Step 3: Wire `TownTabScreen` into `MainScreen`**

In `src/main/screens/MainScreen.tsx`, replace:

```ts
import { PlaceholderTabScreen } from './PlaceholderTabScreen';
```

with:

```ts
import { TownTabScreen } from './TownTabScreen';
```

Then replace the entire town case with:

```tsx
    case 'town':
      return (
        <TabScrollContainer>
          <TownTabScreen />
        </TabScrollContainer>
      );
```

- [ ] **Step 4: Run the wiring test and relevant navigation tests**

Run:

```bash
npx tsx --test src/test/screens/MainScreenTownTab.test.ts src/test/domain/mainTabs.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the integration**

```bash
git add src/main/screens/MainScreen.tsx src/test/screens/MainScreenTownTab.test.ts
git commit -m "feat: show town menu from main tab"
```

### Task 5: Verify the completed UI slice

**Files:**
- Verify only; no expected source changes.

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run TypeScript validation**

```bash
npm run typecheck
```

Expected: TypeScript exits with code 0 and no diagnostics.

- [ ] **Step 3: Check formatting hazards and scoped changes**

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints nothing. Existing user-owned modifications to `src/main/services/backendApi.ts` and `src/test/services/backendApi.test.ts` remain untouched and uncommitted; town implementation files are committed.

- [ ] **Step 4: Run an Expo web smoke check**

```bash
npx expo export --platform web --output-dir /tmp/hof-town-web-export
```

Expected: export completes successfully and emits `/tmp/hof-town-web-export/index.html` without asset resolution errors.

- [ ] **Step 5: Review on Android-sized viewport**

Start the app only if a live visual check is needed:

```bash
npm run web
```

Open the app at an Android-sized viewport and verify:

- `생활 / 상점 / 카드 / 제작` stays visible without horizontal scrolling.
- Selecting `상점` shows five menus in two columns.
- Selecting `장로 대장간` highlights it and shows its name below.
- Switching to `퀘·교환` and back preserves the last town selection.
- No menu press causes a network request.

Stop the development server after the review. No additional commit is needed unless the visual review reveals a defect.
