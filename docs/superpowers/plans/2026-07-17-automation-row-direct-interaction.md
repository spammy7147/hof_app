# Automation Row Direct Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the automation row overflow menu with direct detail navigation and a left-swipe/right-side delete action while preserving reorder, toggle, confirmation, and accessibility behavior.

**Architecture:** Wrap each existing `AutomationEntryRow` with `ReanimatedSwipeable` from the already-installed gesture-handler package. Keep drag, detail, toggle, and delete as separate controls, coordinate a single open row from `UnifiedAutomationSettings`, and reuse the existing deletion Alert and controller callbacks.

**Tech Stack:** React 19, React Native 0.86, Expo 57, react-native-gesture-handler 2.32, react-native-draggable-flatlist, TypeScript, Node test runner, react-test-renderer.

---

## File map

- Modify `src/main/features/automation/components/UnifiedAutomationSettings.tsx`: remove the overflow Modal, add direct detail Pressable, add swipe-right-action deletion, and coordinate the open swipeable row.
- Modify `src/test/components/AutomationAddSheet.test.ts`: mock `ReanimatedSwipeable` and verify mounted detail/delete/busy interactions.
- Modify `src/test/screens/HomeTabScreen.test.ts`: replace the overflow-menu source contract with the direct-detail/swipe-delete source contract.

### Task 1: Lock the new interaction contract with failing tests

**Files:**
- Modify: `src/test/components/AutomationAddSheet.test.ts`
- Modify: `src/test/screens/HomeTabScreen.test.ts`

- [ ] **Step 1: Add a mounted-test mock for ReanimatedSwipeable**

Add a mock component before the module loader is installed. It must render both the row and the right action so the mounted tests can press both controls, and it must expose `close`, `openLeft`, `openRight`, and `reset` through the forwarded ref:

```tsx
const reanimatedSwipeable = React.forwardRef<
  { close: () => void; openLeft: () => void; openRight: () => void; reset: () => void },
  Record<string, unknown>
>((props, ref) => {
  const methods = {
    close: () => undefined,
    openLeft: () => undefined,
    openRight: () => undefined,
    reset: () => undefined,
  };
  React.useImperativeHandle(ref, () => methods);
  const renderRightActions = props.renderRightActions as
    | ((progress: unknown, translation: unknown, swipeable: typeof methods) => React.ReactNode)
    | undefined;
  return React.createElement(
    'ReanimatedSwipeable',
    props,
    props.children as React.ReactNode,
    renderRightActions?.({}, {}, methods),
  );
});
```

Extend `moduleWithLoader._load` with the exact import path used by production:

```ts
if (request === 'react-native-gesture-handler/ReanimatedSwipeable') {
  return { __esModule: true, default: reanimatedSwipeable };
}
```

- [ ] **Step 2: Replace the mounted overflow-menu test with direct detail and swipe delete assertions**

Replace `opens overflow detail and delete actions, confirms delete, and disables them while busy` with a test named `opens detail directly and confirms deletion from the swipe action`.

The test must:

```tsx
const detail = renderer.root.findByProps({ accessibilityLabel: '퀘스트 상세 설정' });
detail.props.onPress();
assert.equal(detailed, quest);

const remove = renderer.root.findByProps({ accessibilityLabel: '퀘스트 삭제' });
remove.props.onPress();
assert.ok(alertArguments);
const actions = alertArguments[2] as Array<{ text: string; onPress?: () => void }>;
assert.deepEqual(actions.map(({ text }) => text), ['취소', '삭제']);
await act(async () => { actions[1]?.onPress?.(); });
assert.deepEqual(deleted, [1]);
```

Then rerender with `savingEntryIds: [1]` and assert the direct detail button, swipe delete button, and switch are disabled. Also assert no `퀘스트 더 보기` button exists:

```tsx
assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '퀘스트 더 보기' }).length, 0);
assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 상세 설정' }).props.disabled, true);
assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 삭제' }).props.disabled, true);
assert.equal(renderer.root.findByProps({ accessibilityLabel: '퀘스트 끄기' }).props.disabled, true);
```

- [ ] **Step 3: Replace the source-level overflow contract**

Change the `HomeTabScreen.test.ts` case to `항목 탭 상세 설정과 왼쪽 스와이프 삭제를 제공한다`. Assert:

```ts
assert.match(settingsSource, /react-native-gesture-handler\/ReanimatedSwipeable/);
assert.match(settingsSource, /renderRightActions/);
assert.match(settingsSource, /accessibilityLabel=\{`\$\{metadata\.label\} 상세 설정`\}/);
assert.match(settingsSource, /accessibilityLabel=\{`\$\{metadata\.label\} 삭제`\}/);
assert.match(settingsSource, /Alert\.alert/);
assert.doesNotMatch(settingsSource, /MoreHorizontal/);
assert.doesNotMatch(settingsSource, /자동화 메뉴 닫기/);
assert.match(homeSource, /onDelete=\{[^}]*automationController\.deleteEntry/);
assert.match(homeSource, /onDetail=/);
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```bash
npm test -- --test-name-pattern='opens detail directly|항목 탭 상세 설정'
```

Expected: FAIL because `UnifiedAutomationSettings` still renders the more button and menu, has no `ReanimatedSwipeable`, and does not expose a direct detail button.

- [ ] **Step 5: Commit the failing interaction contract**

```bash
git add src/test/components/AutomationAddSheet.test.ts src/test/screens/HomeTabScreen.test.ts
git commit -m "test: define direct automation row interactions"
```

### Task 2: Implement direct detail navigation and swipe deletion

**Files:**
- Modify: `src/main/features/automation/components/UnifiedAutomationSettings.tsx`

- [ ] **Step 1: Replace overflow-specific imports and state**

Remove `Modal` and `MoreHorizontal`. Add:

```tsx
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { GripVertical, Map, Plus, ScrollText, Swords, Trash2 } from 'lucide-react-native';
```

Delete `menuEntry`, `menuActionRef`, `menuTriggerNodeRef`, `menuGenerationRef`, `menuFocusTimerRef`, `openMenu`, `closeMenu`, and `closeMenuToAddTrigger`. Keep the add-sheet focus restoration code.

Add one parent ref and callbacks:

```tsx
const openSwipeableRef = useRef<SwipeableMethods | null>(null);

const closeOpenSwipeable = useCallback(() => {
  openSwipeableRef.current?.close();
  openSwipeableRef.current = null;
}, []);

const registerOpenSwipeable = useCallback((swipeable: SwipeableMethods | null) => {
  if (openSwipeableRef.current && openSwipeableRef.current !== swipeable) {
    openSwipeableRef.current.close();
  }
  openSwipeableRef.current = swipeable;
}, []);
```

Call `closeOpenSwipeable` during unmount cleanup and before opening the add sheet.

- [ ] **Step 2: Simplify deletion without the menu lifecycle**

Keep the existing Alert copy. On confirmation, call the existing callback and restore focus to the add trigger only after a successful deletion:

```tsx
function confirmDelete(entry: TypedAutomationEntryResponse) {
  const metadata = AUTOMATION_TYPE_METADATA[entry.type];
  closeOpenSwipeable();
  Alert.alert(
    `${metadata.label} 자동화를 삭제할까요?`,
    '저장한 세부 설정도 함께 삭제됩니다.',
    [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          void onDelete(entry.id).then((deleted) => {
            if (deleted && mountedRef.current) restoreAddTriggerFocus();
          });
        },
      },
    ],
  );
}
```

- [ ] **Step 3: Pass the new callbacks to each row and remove the Modal**

Change `renderItem` to pass:

```tsx
<AutomationEntryRow
  {...params}
  entries={entries}
  reorderBusy={reordering}
  saving={savingEntryIds.includes(params.item.id)}
  onDeleteRequest={confirmDelete}
  onDetail={onDetail}
  onReorder={onReorder}
  onSwipeableOpen={registerOpenSwipeable}
  onToggle={onToggle}
/>
```

Remove the entire overflow `Modal` block and all menu busy calculations.

- [ ] **Step 4: Wrap each row with ReanimatedSwipeable**

Update `AutomationEntryRowProps` with:

```tsx
onDeleteRequest: (entry: TypedAutomationEntryResponse) => void;
onDetail: (entry: TypedAutomationEntryResponse) => void;
onSwipeableOpen: (swipeable: SwipeableMethods | null) => void;
```

Create a `swipeableRef`, and wrap the existing visual row:

```tsx
const swipeableRef = useRef<SwipeableMethods | null>(null);

return (
  <ReanimatedSwipeable
    ref={swipeableRef}
    enabled={!saving && !isActive}
    friction={2}
    overshootRight={false}
    rightThreshold={42}
    onSwipeableWillOpen={() => onSwipeableOpen(swipeableRef.current)}
    renderRightActions={(_progress, _translation, swipeable) => (
      <Pressable
        accessibilityHint="확인 후 선택한 자동화를 삭제합니다"
        accessibilityLabel={`${metadata.label} 삭제`}
        accessibilityRole="button"
        accessibilityState={{ busy: saving, disabled: saving }}
        disabled={saving}
        onPress={() => {
          swipeable.close();
          onDeleteRequest(item);
        }}
        style={({ pressed }) => [styles.swipeDelete, pressed && styles.pressed]}
      >
        <Trash2 color={theme.colors.text} size={18} />
        <Text style={styles.swipeDeleteText}>삭제</Text>
      </Pressable>
    )}
    containerStyle={styles.swipeContainer}
  >
    <View style={[styles.row, isActive && styles.rowActive]}>
      {/* independent drag handle, detail body, and switch */}
    </View>
  </ReanimatedSwipeable>
);
```

- [ ] **Step 5: Make the card body the direct detail control**

Keep the drag handle unchanged. Replace the icon/copy area and more button with one `Pressable` placed between the drag handle and switch:

```tsx
<Pressable
  accessibilityActions={[{ name: 'delete', label: '삭제' }]}
  accessibilityHint="선택한 자동화의 세부 설정 화면을 엽니다"
  accessibilityLabel={`${metadata.label} 상세 설정`}
  accessibilityRole="button"
  accessibilityState={{ disabled: saving }}
  disabled={saving}
  onAccessibilityAction={({ nativeEvent: { actionName } }) => {
    if (actionName === 'delete') onDeleteRequest(item);
  }}
  onPress={() => {
    swipeableRef.current?.close();
    onDetail(item);
  }}
  style={({ pressed }) => [styles.detailButton, pressed && styles.pressed]}
>
  <View style={styles.typeIcon}><AutomationTypeIcon type={item.type} /></View>
  <View style={styles.rowCopy}>{/* existing title, summary, warning */}</View>
</Pressable>
```

Keep the existing `Switch` after this Pressable. This prevents direct detail navigation when the user uses the drag handle or switch.

- [ ] **Step 6: Replace menu styles with swipe styles**

Delete `menuRoot`, `menuBackdrop`, `menu`, `menuTitle`, `menuAction`, `menuActionText`, `deleteText`, and `moreButton`. Add:

```tsx
swipeContainer: {
  borderRadius: theme.radius.md + 4,
  marginBottom: theme.spacing.sm,
  overflow: 'hidden',
},
detailButton: {
  alignItems: 'center',
  flex: 1,
  flexDirection: 'row',
  gap: theme.spacing.sm,
  minWidth: 0,
},
swipeDelete: {
  alignItems: 'center',
  backgroundColor: theme.colors.danger,
  gap: 4,
  justifyContent: 'center',
  width: 76,
},
swipeDeleteText: {
  color: theme.colors.text,
  fontSize: 11,
  fontWeight: '900',
},
```

Move the old row `marginBottom` to `swipeContainer` so the red action does not leave an uncovered gap.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
npm test -- --test-name-pattern='UnifiedAutomationSettings|항목 탭 상세 설정'
```

Expected: PASS with direct detail, swipe delete, busy-state, reorder, and toggle assertions all green.

- [ ] **Step 8: Commit the implementation**

```bash
git add src/main/features/automation/components/UnifiedAutomationSettings.tsx
git commit -m "feat: streamline automation row actions"
```

### Task 3: Verify the complete app contract

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Run all app tests**

```bash
npm test
```

Expected: all test files pass with zero failures.

- [ ] **Step 2: Run TypeScript validation**

```bash
npm run typecheck
```

Expected: exit code 0 with no TypeScript diagnostics.

- [ ] **Step 3: Inspect the final diff**

```bash
git diff --check HEAD~2..HEAD
git status --short
```

Expected: no whitespace errors and no uncommitted source/test changes. The project-root `.superpowers/` visual mockup remains outside the app Git repository.

- [ ] **Step 4: Manually verify the Android interaction**

Start the existing Android development build, open `홈 → 자동화 설정`, and verify:

1. Tapping the quest, battle-map, and adventure-map body opens the corresponding editor.
2. Tapping the switch only toggles enabled state.
3. Long-pressing the grip still reorders rows.
4. Swiping a row left reveals one red delete button on the right.
5. Swiping another row closes the previously opened row.
6. Delete opens the existing confirmation Alert and cancel leaves the entry intact.

- [ ] **Step 5: Record the verified result**

No additional commit is required when Steps 1–4 pass without changes. If verification requires a correction, add a focused regression test first, apply the minimal fix, rerun Steps 1–4, and commit the correction separately.
