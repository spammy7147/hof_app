# Quest Card Map Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 체크 아이콘 없는 퀘스트 카드 선택, 선택 퀘스트 우선 표시, 검색형 프리셋, 맵 드래그 정렬과 스와이프 삭제를 구현한다.

**Architecture:** `QuestAutomationEditor`는 선택 상태와 화면 정렬을 소유하고 `QuestSummaryCard`는 요약 영역 선택 표현만 담당한다. 새 `QuestMissionMapList`가 프리셋 모달, 드래그와 스와이프를 캡슐화하며 `CombatMissionEditor`는 미션 상태와 맵 추가 바텀시트에 집중한다. 정렬과 맵 순서 정규화는 순수 도메인 함수로 둔다.

**Tech Stack:** React 19, React Native 0.86, Expo 57, TypeScript 6, react-native-gesture-handler, react-native-reanimated, react-native-draggable-flatlist, Node test runner, react-test-renderer

---

## 파일 구조

- Modify: `src/main/domain/questAutomation.ts` — 선택 우선 정렬과 드래그 결과 정규화
- Modify: `src/test/domain/questAutomation.test.ts` — 순수 도메인 테스트
- Modify: `src/main/features/automation/components/QuestAutomationEditor.tsx` — 선택 ID 기반 화면 순서
- Modify: `src/main/features/automation/components/QuestSummaryCard.tsx` — 체크박스 없는 카드 선택 UI
- Create: `src/main/features/automation/components/QuestMissionMapList.tsx` — 검색형 프리셋, 드래그, 스와이프 삭제
- Modify: `src/main/features/automation/components/CombatMissionEditor.tsx` — 새 맵 목록 연결과 균등 안내 제거
- Modify: `src/test/components/QuestAutomationEditor.test.ts` — UI와 제스처 회귀 테스트

### Task 1: 선택 우선 정렬과 맵 순서 정규화

**Files:**
- Modify: `src/test/domain/questAutomation.test.ts`
- Modify: `src/main/domain/questAutomation.ts`

- [ ] **Step 1: 선택 우선 정렬의 실패 테스트 작성**

테스트 import에 `prioritizeSelectedQuests`를 추가하고 다음 테스트를 작성한다.

```ts
it('pins selected quests first while preserving HOF order in both groups', () => {
  const quests = [
    snapshot('late', 'Late', 'ACTIVE', 9, []),
    snapshot('first-selected', 'First selected', 'ACTIVE', 2, []),
    snapshot('early', 'Early', 'ACTIVE', 1, []),
    snapshot('second-selected', 'Second selected', 'ACTIVE', 7, []),
  ];

  assert.deepEqual(
    prioritizeSelectedQuests(quests, new Set(['second-selected', 'first-selected']))
      .map(({ questId }) => questId),
    ['first-selected', 'second-selected', 'early', 'late'],
  );
  assert.deepEqual(
    prioritizeSelectedQuests(quests, new Set()).map(({ questId }) => questId),
    ['early', 'first-selected', 'second-selected', 'late'],
  );
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/test/domain/questAutomation.test.ts`

Expected: `prioritizeSelectedQuests`가 없어 FAIL.

- [ ] **Step 3: 안정적인 선택 우선 정렬 구현**

`filterQuests` 아래에 다음 함수를 추가한다.

```ts
export function prioritizeSelectedQuests(
  quests: readonly QuestSnapshot[],
  selectedQuestIds: ReadonlySet<string>,
): QuestSnapshot[] {
  return [...quests].sort((left, right) => {
    const selectedRank = Number(selectedQuestIds.has(right.questId))
      - Number(selectedQuestIds.has(left.questId));
    return selectedRank || left.sourceOrder - right.sourceOrder;
  });
}
```

- [ ] **Step 4: 드래그 결과 정규화 실패 테스트 작성**

테스트 import에 `reorderMissionMaps`를 추가하고 다음 테스트를 작성한다.

```ts
it('normalizes a dragged map array to contiguous execution order', () => {
  const first = { ...mapSetting('kill', 'first', 8), executionOrder: 8 };
  const second = { ...mapSetting('kill', 'second', 3), executionOrder: 3 };
  assert.deepEqual(reorderMissionMaps([second, first]), [
    { ...second, executionOrder: 0 },
    { ...first, executionOrder: 1 },
  ]);
});
```

- [ ] **Step 5: 정규화 export 구현**

`moveMissionMap` 앞에 다음 함수를 추가한다.

```ts
export function reorderMissionMaps(
  maps: readonly QuestMapSettingRequest[],
): QuestMapSettingRequest[] {
  return normalizeMapOrder(maps);
}
```

- [ ] **Step 6: 테스트와 타입 검사 실행**

Run:

```bash
npx tsx --test src/test/domain/questAutomation.test.ts
npm run typecheck
```

Expected: 모두 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/main/domain/questAutomation.ts src/test/domain/questAutomation.test.ts
git commit -m "feat: add quest display and map reorder helpers"
```

### Task 2: 체크박스 없는 카드 선택과 선택 항목 우선 표시

**Files:**
- Modify: `src/test/components/QuestAutomationEditor.test.ts`
- Modify: `src/main/features/automation/components/QuestSummaryCard.tsx`
- Modify: `src/main/features/automation/components/QuestAutomationEditor.tsx`

- [ ] **Step 1: 카드 선택과 표시 순서 실패 테스트 작성**

```ts
it('uses the summary as the checkbox and pins selected quests in HOF order', async () => {
  const renderer = await renderEditor({ quests: [
    snapshot('q1', 'First', 'ACTIVE', [mission('now-1', 'IMMEDIATE', null)], 1),
    snapshot('q2', 'Second', 'ACTIVE', [mission('now-2', 'IMMEDIATE', null)], 2),
    snapshot('q3', 'Third', 'ACTIVE', [mission('now-3', 'IMMEDIATE', null)], 3),
  ] });

  const second = renderer.root.findByProps({ accessibilityLabel: 'Second 선택' });
  assert.equal(second.props.accessibilityRole, 'checkbox');
  assert.equal(renderedText(second).includes('✓'), false);
  assert.deepEqual(findQuestNames(renderer.root), ['First', 'Second', 'Third']);

  await act(async () => { second.props.onPress(); });
  assert.deepEqual(findQuestNames(renderer.root), ['Second', 'First', 'Third']);
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Third 선택' }).props.onPress(); });
  assert.deepEqual(findQuestNames(renderer.root), ['Second', 'Third', 'First']);
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Second 선택' }).props.onPress(); });
  assert.deepEqual(findQuestNames(renderer.root), ['Third', 'First', 'Second']);
});
```

테스트 helper를 추가한다.

```ts
function findQuestNames(root: ReactTestInstance): string[] {
  return root.findAll((node) => typeof node.props.testID === 'string'
    && node.props.testID.startsWith('quest-summary:'))
    .map((node) => String(node.props.testID).slice('quest-summary:'.length));
}
```

테스트 `snapshot` helper가 `sourceOrder`를 선택적으로 받도록 다음과 같이 확장한다.

```ts
function snapshot(
  questId: string,
  name: string,
  section: QuestSnapshot['section'],
  missions: QuestMission[],
  sourceOrder = 0,
): QuestSnapshot {
  return {
    questId,
    name,
    section,
    state: section === 'ACTIVE' ? 'ACTIVE' : section === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE',
    sourceOrder,
    missions,
    actionNo: null,
    rewards: [],
  };
}
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/test/components/QuestAutomationEditor.test.ts`

Expected: 선택 우선 정렬과 카드 `testID`가 없어 FAIL.

- [ ] **Step 3: `QuestSummaryCard` 체크 UI 제거**

기존 `heading`의 시각 체크박스와 copy를 다음 요약 Pressable로 교체한다.

```tsx
<Pressable
  accessibilityLabel={`${snapshot.name} 선택`}
  accessibilityRole="checkbox"
  accessibilityState={{ checked: selected != null, disabled }}
  disabled={disabled}
  onPress={onToggle}
  style={({ pressed }) => [
    styles.summaryButton,
    pressed && !disabled && styles.summaryPressed,
    disabled && styles.disabled,
  ]}
  testID={`quest-summary:${snapshot.name}`}
>
  <View style={styles.titleRow}>
    <Text numberOfLines={1} style={styles.name}>{snapshot.name}</Text>
    <Text style={styles.section}>{sectionLabel}</Text>
  </View>
  <Text style={styles.summary}>{buildQuestMissionSummary(snapshot.missions)}</Text>
  <Text style={styles.reward}>{buildQuestRewardSummary(snapshot.rewards)}</Text>
</Pressable>
```

카드에 `overflow: 'hidden'`을 적용하고 선택 카드에는 강조 테두리와 `surfaceAlt` 배경을 사용한다. `checkbox`, `checkboxSelected`, `checkboxText` 스타일은 삭제한다.

- [ ] **Step 4: 화면 정렬 연결**

`QuestAutomationEditor.tsx`에 다음 memo를 적용한다.

```ts
const selectedQuestIds = useMemo(
  () => new Set(draft?.quests.map(({ questCode }) => questCode) ?? []),
  [draft],
);
const visibleQuests = useMemo(
  () => prioritizeSelectedQuests(
    filterQuests(snapshots, section, query),
    selectedQuestIds,
  ),
  [query, section, selectedQuestIds, snapshots],
);
```

- [ ] **Step 5: 테스트와 타입 검사 실행**

Run:

```bash
npx tsx --test src/test/components/QuestAutomationEditor.test.ts
npm run typecheck
```

Expected: 기존 선택 복원 테스트를 포함해 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/main/features/automation/components/QuestAutomationEditor.tsx \
  src/main/features/automation/components/QuestSummaryCard.tsx \
  src/test/components/QuestAutomationEditor.test.ts
git commit -m "feat: simplify quest card selection"
```

### Task 3: 검색형 맵 프리셋 컴포넌트

**Files:**
- Create: `src/main/features/automation/components/QuestMissionMapList.tsx`
- Modify: `src/main/features/automation/components/CombatMissionEditor.tsx`
- Modify: `src/test/components/QuestAutomationEditor.test.ts`

- [ ] **Step 1: 제스처 컴포넌트 test mock 추가**

테스트 파일에 다음 목록 mock을 추가한다.

```ts
const draggableFlatList = (props: Record<string, unknown>) => {
  const data = props.data as unknown[];
  const renderItem = props.renderItem as (params: {
    item: unknown; drag: () => void; getIndex: () => number; isActive: boolean;
  }) => React.ReactNode;
  return React.createElement('DraggableFlatList', props, data.map((item, index) => (
    React.createElement(React.Fragment, { key: index }, renderItem({
      item, drag: () => undefined, getIndex: () => index, isActive: false,
    }))
  )));
};

type SwipeableMockMethods = { close: () => void };
const reanimatedSwipeable = React.forwardRef<SwipeableMockMethods, Record<string, unknown>>((props, ref) => {
  const methods = React.useMemo(() => ({ close: () => undefined }), []);
  React.useImperativeHandle(ref, () => methods, [methods]);
  return React.createElement(
    'ReanimatedSwipeable',
    { ...props, mockMethods: methods },
    props.children as React.ReactNode,
    typeof props.renderRightActions === 'function'
      ? (props.renderRightActions as (...args: unknown[]) => React.ReactNode)({}, {}, methods)
      : null,
  );
});
```

모듈 loader에 다음 분기를 추가한다.

```ts
if (request === 'react-native-gesture-handler/ReanimatedSwipeable') {
  return { __esModule: true, default: reanimatedSwipeable };
}
if (request === 'react-native-draggable-flatlist') {
  return { __esModule: true, default: draggableFlatList };
}
```

- [ ] **Step 2: 검색형 프리셋 실패 테스트 작성**

```ts
it('selects one map preset from the searchable preset sheet', async () => {
  const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
  const renderer = await renderEditor({
    entry: questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [mapSetting('kill', 'a', 0)] }]),
    quests: [quest],
    maps: [catalogMap('battle_map', 'a', 'Alpha')],
    presets: [preset(7, 'Speed Team'), preset(8, 'Safe Team')],
  });

  assert.equal(renderer.root.findAllByProps({ accessibilityRole: 'radio' }).length, 0);
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Combat · kill 1번째 맵 프리셋 선택' }).props.onPress();
  });
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: '프리셋 검색' }).props.onChangeText('safe');
  });
  assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Speed Team 프리셋 선택' }).length, 0);
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Safe Team 프리셋 선택' }).props.onPress();
  });
  assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '프리셋 검색' }).length, 0);
  assert.equal(hasText(renderer.root, 'Safe Team'), true);
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx tsx --test src/test/components/QuestAutomationEditor.test.ts`

Expected: 단일 프리셋 버튼이 없어 FAIL.

- [ ] **Step 4: `QuestMissionMapList` 기본 구현**

새 컴포넌트는 `catalog`, `disabled`, `maps`, `missionKey`, `presets`, `questContext`, `onUpdate` props를 받는다. `presetTarget`에는 `buildQuestMapIdentity(map)`을 저장한다. 각 행은 현재 프리셋 버튼 하나만 렌더링한다.

필요한 React와 React Native import는 다음과 같다.

```ts
import { useCallback, useEffect, useRef, useState, type ElementRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';
```

프리셋 버튼 ref와 닫기 포커스 복원 상태를 다음처럼 둔다.

```ts
const presetTriggerRefs = useRef(new Map<string, ElementRef<typeof Pressable> | null>());
const restoreFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => () => {
  if (restoreFocusTimerRef.current) clearTimeout(restoreFocusTimerRef.current);
}, []);

const closePreset = useCallback((restoreFocus: boolean) => {
  const identity = presetTarget;
  setPresetTarget(null);
  if (restoreFocusTimerRef.current) clearTimeout(restoreFocusTimerRef.current);
  if (!restoreFocus || !identity) return;
  restoreFocusTimerRef.current = setTimeout(() => {
    const node = findNodeHandle(presetTriggerRefs.current.get(identity));
    if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
    restoreFocusTimerRef.current = null;
  }, 250);
}, [presetTarget]);
```

```tsx
<Pressable
  ref={(node) => {
    if (node) presetTriggerRefs.current.set(identity, node);
    else presetTriggerRefs.current.delete(identity);
  }}
  accessibilityLabel={`${questContext} · ${missionKey} ${index + 1}번째 맵 프리셋 선택`}
  accessibilityRole="button"
  disabled={disabled}
  onPress={() => setPresetTarget(identity)}
  style={styles.presetButton}
>
  <Text style={styles.presetText}>{formatAutomationPresetSelection(map, presets)}</Text>
  <Text style={styles.chevron}>⌄</Text>
</Pressable>
```

목록 아래에 기존 모달을 연결한다.

```tsx
<BattleMapPresetPickerModal
  disabled={disabled}
  mapName={resolvedTarget?.name ?? target?.mapCode ?? '전투 맵'}
  onClose={() => closePreset(true)}
  onSelect={(presetId) => {
    if (!target) return;
    onUpdate(maps.map((map) => buildQuestMapIdentity(map) !== buildQuestMapIdentity(target)
      ? map
      : presetId == null
        ? { ...map, presetMode: 'PRIMARY', partyPresetId: null }
        : { ...map, presetMode: 'EXPLICIT', partyPresetId: presetId }));
    closePreset(true);
  }}
  presets={presets}
  selectedPresetId={target?.partyPresetId ?? null}
  selectedPresetMode={target?.presetMode ?? 'PRIMARY'}
  visible={target != null}
/>
```

- [ ] **Step 5: `CombatMissionEditor`에 연결**

기존 맵 `map`, 인라인 radio chip, 위·아래·삭제 버튼과 균등 분배 `hint`를 제거하고 다음을 렌더링한다.

```tsx
<QuestMissionMapList
  catalog={catalog}
  disabled={disabled}
  maps={mission.maps}
  missionKey={mission.key}
  presets={presets}
  questContext={questContext}
  onUpdate={onUpdate}
/>
```

- [ ] **Step 6: 테스트와 타입 검사 실행**

Run:

```bash
npx tsx --test src/test/components/QuestAutomationEditor.test.ts
npm run typecheck
```

Expected: 검색형 프리셋과 기존 저장 테스트 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/main/features/automation/components/QuestMissionMapList.tsx \
  src/main/features/automation/components/CombatMissionEditor.tsx \
  src/test/components/QuestAutomationEditor.test.ts
git commit -m "feat: add searchable quest map presets"
```

### Task 4: 맵 드래그 정렬과 스와이프 삭제

**Files:**
- Modify: `src/main/features/automation/components/QuestMissionMapList.tsx`
- Modify: `src/test/components/QuestAutomationEditor.test.ts`

- [ ] **Step 1: 드래그·삭제 실패 테스트 작성**

```ts
it('reorders maps by drag and removes only the swiped map action', async () => {
  const saves: UpdateQuestAutomationRequest[] = [];
  const quest = snapshot('combat', 'Combat', 'ACTIVE', [mission('kill', 'MONSTER_KILL', 'Maid')]);
  const alpha = mapSetting('kill', 'a', 0);
  const beta = mapSetting('kill', 'b', 1);
  const renderer = await renderEditor({
    entry: questEntry([{ questCode: 'combat', enabled: true, sourceOrder: 0, maps: [alpha, beta] }]),
    quests: [quest],
    maps: [catalogMap('battle_map', 'a', 'Alpha'), catalogMap('battle_map', 'b', 'Beta')],
    onSave: async (request) => { saves.push(request); return true; },
  });

  assert.equal(hasText(renderer.root, '여러 맵을 실행 가능한 순서대로 확인하고 전투 횟수를 고르게 분배해요'), false);
  const list = renderer.root.findByType('DraggableFlatList');
  await act(async () => { list.props.onDragEnd({ data: [beta, alpha], from: 1, to: 0 }); });
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Combat · kill · Beta 삭제' }).props.onPress();
  });
  await act(async () => {
    await renderer.root.findByProps({ accessibilityLabel: '퀘스트 자동화 저장' }).props.onPress();
  });
  assert.deepEqual(saves[0]?.quests[0]?.maps, [{ ...alpha, executionOrder: 0 }]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/test/components/QuestAutomationEditor.test.ts`

Expected: `DraggableFlatList`와 스와이프 액션이 없어 FAIL.

- [ ] **Step 3: 비스크롤 드래그 목록 연결**

`QuestMissionMapList`에 `DraggableFlatList`, `ReanimatedSwipeable`, `GripVertical`, `Trash2`를 import한다. 기존 map을 다음 목록으로 교체한다.

```tsx
<DraggableFlatList
  activationDistance={8}
  data={maps}
  keyExtractor={(map) => `${missionKey}:${buildQuestMapIdentity(map)}`}
  onDragEnd={({ data, from, to }) => {
    closeOpenSwipeable();
    if (from !== to) onUpdate(reorderMissionMaps(data));
  }}
  renderItem={renderMap}
  scrollEnabled={false}
/>
```

`renderMap`은 `getIndex()`로 현재 index를 얻고 다음 동작을 행 컴포넌트에 전달한다.

```tsx
<QuestMissionMapRow
  canMoveDown={index < maps.length - 1}
  canMoveUp={index > 0}
  disabled={disabled}
  drag={drag}
  index={index}
  isActive={isActive}
  map={map}
  mapContext={[resolved?.groupName, category].filter(Boolean).join(' · ')}
  mapName={name}
  missionKey={missionKey}
  presetLabel={formatAutomationPresetSelection(map, presets)}
  questContext={questContext}
  onDelete={() => onUpdate(removeMissionMap(maps, index))}
  onMove={(offset) => onUpdate(moveMissionMap(maps, index, index + offset))}
  onOpenPreset={() => setPresetTarget(identity)}
  onSwipeableOpen={registerOpenSwipeable}
/>
```

- [ ] **Step 4: 드래그 핸들과 스와이프 삭제 행 구현**

행은 다음 제스처 구조를 사용한다.

```tsx
<ReanimatedSwipeable
  ref={swipeableRef}
  enabled={!disabled && !isActive}
  friction={2}
  onSwipeableWillOpen={() => onSwipeableOpen(swipeableRef.current)}
  overshootRight={false}
  renderRightActions={() => (
    <Pressable
      accessibilityLabel={`${questContext} · ${missionKey} · ${mapName} 삭제`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onDelete}
      style={styles.deleteAction}
    >
      <Trash2 color={theme.colors.buttonText} size={17} />
      <Text style={styles.deleteText}>삭제</Text>
    </Pressable>
  )}
  rightThreshold={36}
>
  <View
    accessibilityActions={[{ name: 'delete', label: '삭제' }]}
    onAccessibilityAction={({ nativeEvent: { actionName } }) => {
      if (actionName === 'delete' && !disabled) onDelete();
    }}
    style={[styles.mapCard, isActive && styles.mapCardActive]}
  >
    <Pressable
      accessibilityActions={[
        ...(canMoveUp ? [{ name: 'decrement' as const, label: '위로 이동' }] : []),
        ...(canMoveDown ? [{ name: 'increment' as const, label: '아래로 이동' }] : []),
      ]}
      accessibilityLabel={`${questContext} · ${missionKey} · ${mapName} 순서 변경`}
      accessibilityRole="adjustable"
      disabled={disabled}
      onAccessibilityAction={({ nativeEvent: { actionName } }) => {
        if (actionName === 'decrement' && canMoveUp) onMove(-1);
        if (actionName === 'increment' && canMoveDown) onMove(1);
      }}
      onLongPress={() => {
        swipeableRef.current?.close();
        drag();
      }}
      style={styles.dragHandle}
    >
      <GripVertical color={theme.colors.textMuted} size={17} />
    </Pressable>
    <View style={styles.mapBody}>
      <Text numberOfLines={1} style={styles.mapName}>{mapName}</Text>
      {mapContext ? <Text numberOfLines={1} style={styles.mapContext}>{mapContext}</Text> : null}
      <Pressable
        accessibilityLabel={`${questContext} · ${missionKey} ${index + 1}번째 맵 프리셋 선택`}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onOpenPreset}
        style={styles.presetButton}
      >
        <Text numberOfLines={1} style={styles.presetText}>{presetLabel}</Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
    </View>
  </View>
</ReanimatedSwipeable>
```

열린 행은 `useRef<SwipeableMethods | null>`로 하나만 유지한다. 다른 행이 열리거나 드래그가 시작되거나 `maps`가 바뀌면 기존 행의 `close()`를 호출한다.

- [ ] **Step 5: 테스트와 타입 검사 실행**

Run:

```bash
npx tsx --test src/test/components/QuestAutomationEditor.test.ts
npm run typecheck
```

Expected: 드래그, 스와이프, 프리셋, 저장 테스트 모두 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/main/features/automation/components/QuestMissionMapList.tsx \
  src/test/components/QuestAutomationEditor.test.ts
git commit -m "feat: drag and swipe quest mission maps"
```

### Task 5: 전체 회귀 검증

**Files:**
- Modify if failures require: `src/main/features/automation/components/QuestMissionMapList.tsx`
- Modify if failures require: `src/main/features/automation/components/CombatMissionEditor.tsx`
- Modify if failures require: `src/main/features/automation/components/QuestSummaryCard.tsx`
- Modify if failures require: `src/test/components/QuestAutomationEditor.test.ts`
- Modify if failures require: `src/test/domain/questAutomation.test.ts`

- [ ] **Step 1: 관련 테스트 실행**

```bash
npx tsx --test \
  src/test/domain/questAutomation.test.ts \
  src/test/components/QuestAutomationEditor.test.ts \
  src/test/components/AutomationAddSheet.test.ts
```

Expected: 모두 PASS.

- [ ] **Step 2: 앱 전체 테스트 실행**

Run: `npm test`

Expected: 전체 테스트 PASS, unhandled rejection과 open handle 없음.

- [ ] **Step 3: 타입과 diff 검사**

```bash
npm run typecheck
git diff --check
```

Expected: 타입 오류와 공백 오류 없음.

- [ ] **Step 4: Android 개발 빌드 수동 검증**

1. 카드 요약으로 퀘스트를 선택·해제한다.
2. 선택 퀘스트가 탭 상단으로 이동하고 해제 시 원본 순서로 돌아오는지 확인한다.
3. 프리셋 이름을 검색해 선택한다.
4. 왼쪽 핸들을 길게 눌러 맵 순서를 바꾼다.
5. 맵 행을 왼쪽으로 스와이프해 `삭제`를 누른다.
6. 저장 후 다시 열어 프리셋과 맵 순서를 확인한다.

Expected: 제스처 충돌, 목록 점프, 잘못된 퀘스트 토글 없이 동작함.

- [ ] **Step 5: 검증 수정이 있을 때만 커밋**

```bash
git add src/main src/test
git commit -m "test: verify quest map interactions"
```

- [ ] **Step 6: 브랜치 상태 확인**

```bash
git status --short --branch
git log --oneline --decorate -6
```

Expected: `feature/quest-card-map-interactions` 브랜치가 clean이며 설계와 기능 커밋이 순서대로 존재함.
