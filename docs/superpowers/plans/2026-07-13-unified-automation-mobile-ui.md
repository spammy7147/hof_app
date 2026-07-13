# Unified Automation Mobile UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-card automation editor with a compact status-first unified automation dashboard and drill-down settings screens.

**Architecture:** `HomeTabScreen` owns server loading and a small local route state; focused feature components render dashboard, module list, and module detail. Pure domain formatters decide labels and visibility so UI tests do not depend on React Native rendering internals. Existing `AutomationMapSettings` is reused inside module detail and extended with display-only policies.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19, TypeScript 6, lucide-react-native, Node test runner

---

## File map

- `src/main/types/api.ts`: unified status/settings/activity contracts.
- `src/main/services/backendApi.ts`: unified CRUD and lifecycle requests.
- `src/main/domain/unifiedAutomation.ts`: presentation state, labels, and key-map selection summaries.
- `src/main/features/automation/components/UnifiedAutomationDashboard.tsx`: current action, next check, module status, activity.
- `src/main/features/automation/components/UnifiedAutomationSettings.tsx`: compact module toggle list.
- `src/main/features/automation/components/TimeAutomationSettings.tsx`: threshold and map/preset drill-down.
- `src/main/features/automation/components/AdventureAutomationSettings.tsx`: cooldown/daily map and preset drill-down.
- `src/main/features/automation/components/UnionAutomationSettings.tsx`: union party and target behavior.
- `src/main/features/automation/components/NormalQuestAutomationSettings.tsx`: user-selected non-priority quests.
- `src/main/features/automation/components/KeyQuestAutomationSettings.tsx`: priority quest list.
- `src/main/features/automation/components/EastMansionQuestSettings.tsx`: fixed/balanced map and preset selection.
- `src/main/features/automation/components/AutomationRuleModal.tsx`: `!` rule popup.
- `src/main/screens/HomeTabScreen.tsx`: data orchestration and feature-local route.

### Task 1: Define unified API and presentation types

**Files:**
- Modify: `src/main/types/api.ts`
- Create: `src/main/domain/unifiedAutomation.ts`
- Test: `src/test/domain/unifiedAutomation.test.ts`

- [ ] **Step 1: Write failing status and label tests**

```typescript
test('formats running key quest without exposing map code or key count', () => {
  const view = buildUnifiedAutomationView(fixtureStatus({
    currentModule: 'KEY_QUEST',
    currentTitle: '저택 동관 열쇠 수집',
    currentMapName: '저택 동관(보쉬의 방)',
    currentMapCode: 'Noble1021',
  }));
  assert.equal(view.statusLabel, '실행 중');
  assert.equal(view.currentMapLabel, '저택 동관(보쉬의 방)');
  assert.equal(JSON.stringify(view).includes('Noble1021'), false);
});
```

- [ ] **Step 2: Run the test and verify module-not-found failure**

Run: `npm test -- src/test/domain/unifiedAutomation.test.ts`

Expected: FAIL because `unifiedAutomation.ts` does not exist.

- [ ] **Step 3: Add exact API types**

```typescript
export type AutomationJobStatus =
  | 'PENDING' | 'RUNNING' | 'WAITING_CAPTCHA' | 'WAITING_CONFIG'
  | 'WAITING_LOGIN' | 'PAUSED' | 'CANCELLED';

export type UnifiedModuleType =
  | 'KEY_QUEST' | 'TIME' | 'COOLDOWN_ADVENTURE'
  | 'DAILY_ADVENTURE' | 'UNION' | 'NORMAL_QUEST';

export type UnifiedAutomationStatusResponse = {
  profileId: number;
  job: AutomationJobResponse | null;
  currentModule: UnifiedModuleType | null;
  currentTitle: string | null;
  currentMapName: string | null;
  nextRunAt: string | null;
  modules: UnifiedAutomationModuleResponse[];
  activities: AutomationActivityResponse[];
};
```

- [ ] **Step 4: Implement safe display mapping**

```typescript
export function buildUnifiedAutomationView(status: UnifiedAutomationStatusResponse) {
  return {
    statusLabel: status.job == null ? '설정 필요' : STATUS_LABELS[status.job.status],
    currentTitle: status.currentTitle ?? '실행할 작업을 확인하고 있어요',
    currentMapLabel: status.currentMapName,
    nextLabel: status.nextRunAt == null ? '필요할 때 자동 확인' : formatNextRun(status.nextRunAt),
    modules: status.modules.map(({ type, enabled, summary, stateLabel }) => ({ type, enabled, summary, stateLabel })),
  };
}
```

- [ ] **Step 5: Run the domain test**

Run: `npm test -- src/test/domain/unifiedAutomation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit types and formatter**

```bash
git add src/main/types/api.ts src/main/domain/unifiedAutomation.ts src/test/domain/unifiedAutomation.test.ts
git commit -m "feat: model unified automation UI"
```

### Task 2: Add backend client methods

**Files:**
- Modify: `src/main/services/backendApi.ts`
- Test: `src/test/services/backendApi.test.ts`

- [ ] **Step 1: Write failing request-path tests**

```typescript
test('loads, saves, and resumes unified automation', async () => {
  await api.getUnifiedAutomation();
  await api.updateUnifiedAutomation(settingsFixture);
  await api.resumeUnifiedAutomation();
  assert.deepEqual(requests.map(({ method, path }) => [method, path]), [
    ['GET', '/api/automation/unified'],
    ['PUT', '/api/automation/unified'],
    ['POST', '/api/automation/unified/resume'],
  ]);
});
```

- [ ] **Step 2: Implement client methods with existing authenticated request helper**

```typescript
getUnifiedAutomation: () => request<UnifiedAutomationStatusResponse>('/api/automation/unified'),
updateUnifiedAutomation: (body: UnifiedAutomationSettingsRequest) =>
  request<UnifiedAutomationStatusResponse>('/api/automation/unified', { method: 'PUT', body: JSON.stringify(body) }),
startUnifiedAutomation: () => request<UnifiedAutomationStatusResponse>('/api/automation/unified/start', { method: 'POST' }),
pauseUnifiedAutomation: () => request<UnifiedAutomationStatusResponse>('/api/automation/unified/pause', { method: 'POST' }),
resumeUnifiedAutomation: () => request<UnifiedAutomationStatusResponse>('/api/automation/unified/resume', { method: 'POST' }),
stopUnifiedAutomation: () => request<UnifiedAutomationStatusResponse>('/api/automation/unified/stop', { method: 'POST' }),
```

- [ ] **Step 3: Run backend API tests**

Run: `npm test -- src/test/services/backendApi.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit client methods**

```bash
git add src/main/services/backendApi.ts src/test/services/backendApi.test.ts
git commit -m "feat: call unified automation API"
```

### Task 3: Build the status-first dashboard

**Files:**
- Create: `src/main/features/automation/components/UnifiedAutomationDashboard.tsx`
- Test: `src/test/components/UnifiedAutomationDashboard.test.ts`

- [ ] **Step 1: Write a failing component source contract test**

```typescript
test('dashboard exposes current action, next check, settings, and pause controls', () => {
  const source = readSource('src/main/features/automation/components/UnifiedAutomationDashboard.tsx');
  assert.match(source, /현재 작업/);
  assert.match(source, /다음 확인/);
  assert.match(source, /자동화 설정/);
  assert.match(source, /일시정지/);
  assert.doesNotMatch(source, /mapCode|keyCount/);
});
```

- [ ] **Step 2: Implement the dashboard interface**

```typescript
type Props = {
  status: UnifiedAutomationStatusResponse;
  onOpenSettings: () => void;
  onPause: () => void;
  onResume: () => void;
};

export function UnifiedAutomationDashboard({ status, onOpenSettings, onPause, onResume }: Props) {
  const view = buildUnifiedAutomationView(status);
  return (
    <View style={styles.container}>
      <View style={styles.header}><Text style={styles.title}>통합 자동화</Text><StatusBadge label={view.statusLabel} /></View>
      <CurrentActionCard title={view.currentTitle} mapName={view.currentMapLabel} nextLabel={view.nextLabel} />
      <Text style={styles.sectionTitle}>자동화 상태</Text>
      {view.modules.map((module, index) => <AutomationStatusRow key={module.type} index={index + 1} module={module} />)}
      <RecentAutomationActivity activities={status.activities} />
      <View style={styles.actions}>
        <PrimaryButton label={status.job?.status === 'PAUSED' ? '재개' : '일시정지'} onPress={status.job?.status === 'PAUSED' ? onResume : onPause} />
        <PrimaryButton label="자동화 설정" onPress={onOpenSettings} />
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Run dashboard tests and typecheck**

Run: `npm test -- src/test/components/UnifiedAutomationDashboard.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Commit dashboard**

```bash
git add src/main/features/automation/components/UnifiedAutomationDashboard.tsx src/test/components/UnifiedAutomationDashboard.test.ts
git commit -m "feat: show unified automation status"
```

### Task 4: Build compact module settings

**Files:**
- Create: `src/main/features/automation/components/UnifiedAutomationSettings.tsx`
- Create: `src/main/features/automation/components/AutomationModuleRow.tsx`
- Test: `src/test/components/UnifiedAutomationSettings.test.ts`

- [ ] **Step 1: Write a failing grouping test**

```typescript
test('settings keeps priority explanation and technical retry details out of the main list', () => {
  const source = readSource('src/main/features/automation/components/UnifiedAutomationSettings.tsx');
  assert.match(source, /항상 먼저 확인/);
  assert.match(source, /상황에 맞춰 실행/);
  assert.match(source, /알림/);
  assert.match(source, /고급 설정 펼치기/);
  assert.doesNotMatch(source, /Kafka|파티션|lease/);
});
```

- [ ] **Step 2: Implement grouped module rows**

```typescript
const groups: ModuleGroup[] = [
  { title: '항상 먼저 확인', modules: ['KEY_QUEST'] },
  { title: '상황에 맞춰 실행', modules: ['TIME', 'COOLDOWN_ADVENTURE', 'DAILY_ADVENTURE', 'UNION', 'NORMAL_QUEST'] },
];

export function UnifiedAutomationSettings({ draft, onToggle, onOpenModule, onSave }: Props) {
  return (
    <View style={styles.container}>
      {groups.map((group) => (
        <View key={group.title}><Text style={styles.groupTitle}>{group.title}</Text>{group.modules.map((type) => (
          <AutomationModuleRow key={type} module={draft.modules[type]} onToggle={() => onToggle(type)} onOpen={() => onOpenModule(type)} />
        ))}</View>
      ))}
      <NotificationSettingRow value={draft.captchaNotificationsEnabled} />
      <AdvancedSettingsDisclosure />
      <PrimaryButton label="저장" onPress={onSave} />
    </View>
  );
}
```

- [ ] **Step 3: Run settings tests and typecheck**

Run: `npm test -- src/test/components/UnifiedAutomationSettings.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Commit settings list**

```bash
git add src/main/features/automation/components/UnifiedAutomationSettings.tsx src/main/features/automation/components/AutomationModuleRow.tsx src/test/components/UnifiedAutomationSettings.test.ts
git commit -m "feat: add compact automation settings"
```

### Task 5: Add Time detail settings

**Files:**
- Create: `src/main/features/automation/components/TimeAutomationSettings.tsx`
- Test: `src/test/components/TimeAutomationSettings.test.ts`

- [ ] **Step 1: Write a failing threshold summary test**

```typescript
test('time rule explains start and stop using the same threshold', () => {
  assert.deepEqual(formatTimeRule(90), {
    start: 'Time이 90%를 넘으면 일반맵을 실행합니다.',
    stop: '90% 이하가 되면 다음 자동화로 넘어갑니다.',
  });
});
```

- [ ] **Step 2: Implement native slider-free percentage controls and map drill-down**

```typescript
const thresholds = [80, 85, 90, 95];
return (
  <View>
    <Text style={styles.title}>일반맵 실행 기준</Text>
    <View style={styles.thresholds}>{thresholds.map((value) => (
      <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: threshold === value }} onPress={() => onChangeThreshold(value)}>
        <Text>{value}%</Text>
      </Pressable>
    ))}</View>
    <AutomationMapSettings categoryId="battle_map" profileMaps={maps} maps={catalog} partyPresets={presets} loading={loading} saving={saving} errorMessage={error} onAssignPreset={onAssignPreset} onToggleMap={onToggleMap} />
    <Text>{formatTimeRule(threshold).start}</Text><Text>{formatTimeRule(threshold).stop}</Text>
  </View>
);
```

- [ ] **Step 3: Run Time settings tests**

Run: `npm test -- src/test/components/TimeAutomationSettings.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Commit Time settings**

```bash
git add src/main/features/automation/components/TimeAutomationSettings.tsx src/test/components/TimeAutomationSettings.test.ts
git commit -m "feat: configure automation time threshold"
```

### Task 6: Add adventure, union, and selected-quest detail settings

**Files:**
- Create: `src/main/features/automation/components/AdventureAutomationSettings.tsx`
- Create: `src/main/features/automation/components/UnionAutomationSettings.tsx`
- Create: `src/main/features/automation/components/NormalQuestAutomationSettings.tsx`
- Test: `src/test/components/AutomationModuleDetails.test.ts`

- [ ] **Step 1: Write failing compact-detail tests**

```typescript
test('remaining module details show only user choices', () => {
  const adventure = readSource('src/main/features/automation/components/AdventureAutomationSettings.tsx');
  const union = readSource('src/main/features/automation/components/UnionAutomationSettings.tsx');
  const quests = readSource('src/main/features/automation/components/NormalQuestAutomationSettings.tsx');
  assert.match(adventure, /맵과 파티/);
  assert.match(union, /발견된 경우에만 공격/);
  assert.match(quests, /자동 진행할 퀘스트/);
  assert.doesNotMatch(adventure + union + quests, /Kafka|lease|mapCode/);
});
```

- [ ] **Step 2: Reuse map selection for cooldown and daily modules**

```typescript
export function AdventureAutomationSettings({ mode, maps, presets, selected, onToggleMap, onAssignPreset }: Props) {
  const title = mode === 'COOLDOWN_ADVENTURE' ? '쿨다운 모험맵' : '일일 모험맵';
  const description = mode === 'COOLDOWN_ADVENTURE' ? '쿨다운이 끝난 맵부터 실행합니다.' : '매일 남은 횟수를 확인해 실행합니다.';
  return <ModuleDetail title={title} description={description}><AutomationMapSettings categoryId="adventure_map" profileMaps={selected} maps={maps} partyPresets={presets} loading={false} saving={false} errorMessage={null} onAssignPreset={onAssignPreset} onToggleMap={onToggleMap} /></ModuleDetail>;
}
```

- [ ] **Step 3: Keep union settings to one party choice and one behavior summary**

```typescript
export function UnionAutomationSettings({ partyPresetId, presets, onChange }: Props) {
  return <ModuleDetail title="유니온" description="유니온이 발견된 경우에만 공격합니다."><PartyPresetPicker value={partyPresetId} presets={presets} onChange={onChange} /><Text>대상이 없거나 HP가 없으면 자동으로 다음 작업을 확인합니다.</Text></ModuleDetail>;
}
```

- [ ] **Step 4: Add searchable multi-selection for non-priority quests**

```typescript
export function NormalQuestAutomationSettings({ quests, selectedIds, onToggle }: Props) {
  return <ModuleDetail title="기타 퀘스트" description="자동 진행할 퀘스트만 선택합니다.">{quests.map((quest) => <Pressable key={quest.id} accessibilityRole="checkbox" accessibilityState={{ checked: selectedIds.includes(quest.id) }} onPress={() => onToggle(quest.id)}><Text>{quest.name}</Text></Pressable>)}</ModuleDetail>;
}
```

- [ ] **Step 5: Run module-detail tests and typecheck**

Run: `npm test -- src/test/components/AutomationModuleDetails.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the remaining detail screens**

```bash
git add src/main/features/automation/components/AdventureAutomationSettings.tsx src/main/features/automation/components/UnionAutomationSettings.tsx src/main/features/automation/components/NormalQuestAutomationSettings.tsx src/test/components/AutomationModuleDetails.test.ts
git commit -m "feat: configure remaining automation modules"
```

### Task 7: Add key-quest and east-mansion detail settings

**Files:**
- Create: `src/main/features/automation/components/KeyQuestAutomationSettings.tsx`
- Create: `src/main/features/automation/components/EastMansionQuestSettings.tsx`
- Create: `src/main/features/automation/components/AutomationRuleModal.tsx`
- Modify: `src/main/features/automation/components/AutomationMapSettings.tsx`
- Modify: `src/main/domain/battleMaps.ts`
- Test: `src/test/components/EastMansionQuestSettings.test.ts`
- Test: `src/test/domain/battleMaps.test.ts`

- [ ] **Step 1: Write tests that hide internal codes, key counts, and total battle counts**

```typescript
test('east mansion settings expose only names, presets, and compact selection help', () => {
  const source = readSource('src/main/features/automation/components/EastMansionQuestSettings.tsx');
  assert.match(source, /1개 선택은 고정 실행 · 여러 개 선택은 자동 균형/);
  assert.match(source, /저택 동관\(복도\)/);
  assert.doesNotMatch(source, /Noble102|keyCount|회 전투/);
});
```

- [ ] **Step 2: Define the four priority quest rows without IDs in visible text**

```typescript
const priorityQuests: PriorityQuestDisplay[] = [
  { internalId: '0563', name: '저택 동관 열쇠 수집' },
  { internalId: '0571', name: '저택 서관 열쇠 수집' },
  { internalId: '0351', name: '마을 지하 수로 퀘스트' },
  { internalId: '0171', name: '우선 키 퀘스트' },
];
```

- [ ] **Step 3: Implement east-mansion selection and rule popup**

```typescript
return (
  <View>
    <View style={styles.titleRow}><Text>저택 동관 열쇠 수집</Text><Pressable accessibilityLabel="선택 규칙 보기" onPress={() => setRulesVisible(true)}><Text>!</Text></Pressable></View>
    <Text style={styles.help}>1개 선택은 고정 실행 · 여러 개 선택은 자동 균형</Text>
    <AutomationMapSettings hideMapCodes hideKeyCounts totalBattleCountLabel={null} categoryId="battle_map" profileMaps={maps} maps={eastMansionMaps} partyPresets={presets} loading={loading} saving={saving} errorMessage={error} onAssignPreset={onAssignPreset} onToggleMap={onToggleMap} />
    <AutomationRuleModal visible={rulesVisible} rules={['선택한 방의 키가 비슷하게 남도록 자동 조정', '키가 없으면 저택 동관(복도)로 자동 전환', '퀘스트 완료까지 전투 후 상태 재확인']} onClose={() => setRulesVisible(false)} />
  </View>
);
```

- [ ] **Step 4: Display preset errors only when backend reports the actual blocked map**

```typescript
const presetError = blockedReason?.code === 'MISSING_PRESET' && blockedReason.mapId === map.id
  ? '전투에 사용할 파티를 선택해 주세요.'
  : null;
```

- [ ] **Step 5: Run quest settings and map tests**

Run: `npm test -- src/test/components/EastMansionQuestSettings.test.ts src/test/domain/battleMaps.test.ts && npm run typecheck`

Expected: PASS and snapshots contain no internal map codes or key counts.

- [ ] **Step 6: Commit quest settings**

```bash
git add src/main/features/automation/components src/main/domain/battleMaps.ts src/test/components/EastMansionQuestSettings.test.ts src/test/domain/battleMaps.test.ts
git commit -m "feat: configure priority key quests"
```

### Task 8: Integrate the unified flow into HomeTabScreen

**Files:**
- Modify: `src/main/screens/HomeTabScreen.tsx`
- Test: `src/test/screens/HomeTabScreen.test.ts`

- [ ] **Step 1: Add a failing screen-state test**

```typescript
test('home routes dashboard to settings and module detail without showing all forms together', () => {
  const source = readSource('src/main/screens/HomeTabScreen.tsx');
  assert.match(source, /type AutomationScreen = 'dashboard' \| 'settings' \| 'time' \| 'key-quest' \| 'cooldown' \| 'daily' \| 'union' \| 'normal-quest'/);
  assert.match(source, /UnifiedAutomationDashboard/);
  assert.match(source, /UnifiedAutomationSettings/);
  assert.doesNotMatch(source, /profiles\.map/);
});
```

- [ ] **Step 2: Replace profile expansion state with one local route**

```typescript
type AutomationScreen = 'dashboard' | 'settings' | 'time' | 'key-quest' | 'cooldown' | 'daily' | 'union' | 'normal-quest';
const [automationScreen, setAutomationScreen] = useState<AutomationScreen>('dashboard');
const [automation, setAutomation] = useState<UnifiedAutomationStatusResponse | null>(null);

const moduleRoutes: Record<UnifiedModuleType, AutomationScreen> = {
  KEY_QUEST: 'key-quest',
  TIME: 'time',
  COOLDOWN_ADVENTURE: 'cooldown',
  DAILY_ADVENTURE: 'daily',
  UNION: 'union',
  NORMAL_QUEST: 'normal-quest',
};

if (automationScreen === 'settings') {
  return <UnifiedAutomationSettings draft={draft} onOpenModule={(type) => setAutomationScreen(moduleRoutes[type])} onSave={handleSave} />;
}
return <UnifiedAutomationDashboard status={automation} onOpenSettings={() => setAutomationScreen('settings')} onPause={handlePause} onResume={handleResume} />;
```

- [ ] **Step 3: Preserve Time/Funds status and refresh automation after every mutation**

```typescript
const mutate = useCallback(async (operation: () => Promise<UnifiedAutomationStatusResponse>) => {
  setSaving(true);
  try { setAutomation(await operation()); }
  finally { setSaving(false); }
}, []);
```

- [ ] **Step 4: Run home screen tests**

Run: `npm test -- src/test/screens/HomeTabScreen.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit integration**

```bash
git add src/main/screens/HomeTabScreen.tsx src/test/screens/HomeTabScreen.test.ts
git commit -m "feat: integrate unified automation screens"
```

### Task 9: Verify the complete mobile UI

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run all app tests**

Run: `npm test`

Expected: all Node tests pass.

- [ ] **Step 2: Run TypeScript validation**

Run: `npm run typecheck`

Expected: no TypeScript errors.

- [ ] **Step 3: Run Android and inspect the three-level flow**

Run: `npx expo run:android`

Expected: dashboard → settings → Time/key-quest detail works without horizontal clipping at 320 dp and no internal map code or key count is visible.

- [ ] **Step 4: Document the interaction**

```markdown
## 통합 자동화 화면

홈은 현재 작업과 다음 확인을 먼저 표시한다. `자동화 설정`에서는 모듈 사용 여부와 요약만 보여주며, 맵·파티·Time 기준은 모듈 상세 화면에서 설정한다. 내부 맵 코드와 키 수량은 표시하지 않는다.
```

- [ ] **Step 5: Commit final UI documentation**

```bash
git add README.md
git commit -m "docs: explain unified automation UI"
```
