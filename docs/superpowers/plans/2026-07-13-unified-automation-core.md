# Unified Automation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent per-account unified automation runner that parses quest state, chooses exactly one next action, checkpoints every action, and runs without Kafka through a local wakeup adapter.

**Architecture:** Keep domain selection pure and isolate external HOF calls behind action executors. PostgreSQL remains the source of truth; a `AutomationWakeupPort` lets the first version run locally and the next plan replace only the adapter with Kafka. One active unified profile and job are allowed per account.

**Tech Stack:** Kotlin 2.3, Spring Boot 4.1, Spring Data JPA, QueryDSL, Flyway, PostgreSQL/H2 tests, Jsoup, JUnit 5

**Repository note:** `hof_backend` is not currently inside a Git repository. Do not initialize or relocate it automatically. Backend commit commands in this plan are used only if the user places that directory under Git before execution; otherwise each green test command is the task checkpoint.

---

## File map

- `../hof_backend/src/main/resources/db/migration/V4__add_unified_automation_core.sql`: unified module settings, action checkpoints, activity, and job columns.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/model/AutomationModels.kt`: enums and typed module configuration.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/entity/AutomationModuleConfigEntity.kt`: persisted module configuration.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/entity/AutomationActionRunEntity.kt`: durable external-action checkpoint.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/repository/UnifiedAutomationQueryRepository.kt`: account-scoped unified aggregate queries.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/dto/UnifiedAutomationDtos.kt`: settings, status, activity, and control API contracts.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/service/UnifiedAutomationService.kt`: settings and lifecycle use cases.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/controller/UnifiedAutomationController.kt`: `/api/automation/unified` endpoints.
- `../hof_backend/src/main/kotlin/app/spammy/hof/quest/model/QuestModels.kt`: normalized quest states.
- `../hof_backend/src/main/kotlin/app/spammy/hof/quest/parser/QuestPageParser.kt`: HOF quest page parser.
- `../hof_backend/src/main/kotlin/app/spammy/hof/quest/service/QuestGatewayService.kt`: quest page load, accept, and claim calls.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/policy/AutomationDecisionPolicy.kt`: pure priority evaluator.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/policy/EastMansionMapPolicy.kt`: `0563` fixed/balanced/fallback selection.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/policy/KeyQuestDefaultCatalog.kt`: `0563`, `0571`, and `0351` internal execution defaults.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/policy/AdventureMapPolicy.kt`: cooldown and daily candidate selection.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/policy/SelectedQuestPolicy.kt`: user-selected non-priority quest decisions.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/service/UnifiedAutomationRunner.kt`: one-action execution and checkpoint loop.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/port/AutomationWakeupPort.kt`: wakeup abstraction.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/adapter/LocalAutomationWakeupAdapter.kt`: non-Kafka execution adapter.

### Task 1: Persist the unified aggregate

**Files:**
- Create: `../hof_backend/src/main/resources/db/migration/V4__add_unified_automation_core.sql`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/model/AutomationModels.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/entity/AutomationModuleConfigEntity.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/entity/AutomationActionRunEntity.kt`
- Modify: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/entity/AutomationJobEntity.kt`
- Modify: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/entity/AutomationProfileMapEntity.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/automation/repository/UnifiedAutomationPersistenceTest.kt`

- [ ] **Step 1: Write a failing persistence test**

```kotlin
@Test
fun `one account stores one unified profile with module config and action checkpoint`() {
    val profile = fixture.unifiedProfile(account)
    val config = moduleConfigRepository.save(
        AutomationModuleConfigEntity(
            profile = profile,
            moduleType = AutomationModuleType.TIME,
            enabled = true,
            configJson = """{"thresholdPercent":90}""",
            updatedAt = Instant.parse("2026-07-13T00:00:00Z"),
        ),
    )
    val job = fixture.runningJob(account, profile)
    val action = actionRunRepository.save(
        AutomationActionRunEntity.pending(job, AutomationModuleType.TIME, "RUN_BATTLE", "action-1"),
    )

    assertEquals(AutomationModuleType.TIME, config.moduleType)
    assertEquals("PENDING", action.status)
    assertEquals("action-1", action.actionKey)
}
```

- [ ] **Step 2: Run the test and verify the missing schema/types failure**

Run: `cd ../hof_backend && ./gradlew test --tests '*UnifiedAutomationPersistenceTest'`

Expected: compilation fails because the new entities and enum do not exist.

- [ ] **Step 3: Add the Flyway migration**

```sql
alter table automation_jobs add column current_module varchar(40);
alter table automation_jobs add column current_action varchar(80);
alter table automation_jobs add column next_run_at timestamp with time zone;
alter table automation_jobs add column last_heartbeat_at timestamp with time zone;
alter table automation_jobs add column version bigint not null default 0;

alter table automation_profile_maps add column module_type varchar(40) not null default 'NORMAL_MAP';
alter table automation_profile_maps add column purpose varchar(40) not null default 'PRIMARY';

create table automation_module_configs (
    id bigint generated by default as identity primary key,
    profile_id bigint not null references automation_profiles(id) on delete cascade,
    module_type varchar(40) not null,
    enabled boolean not null,
    config_json text not null,
    updated_at timestamp with time zone not null,
    constraint uk_automation_module_configs_profile_type unique (profile_id, module_type)
);

create table automation_action_runs (
    id bigint generated by default as identity primary key,
    job_id bigint not null references automation_jobs(id) on delete cascade,
    module_type varchar(40) not null,
    action_type varchar(80) not null,
    action_key varchar(160) not null,
    request_json text not null,
    result_json text,
    status varchar(30) not null,
    attempt_count integer not null,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone not null,
    constraint uk_automation_action_runs_job_key unique (job_id, action_key)
);

create table automation_activities (
    id bigint generated by default as identity primary key,
    job_id bigint not null references automation_jobs(id) on delete cascade,
    module_type varchar(40),
    activity_type varchar(80) not null,
    title varchar(200) not null,
    detail text,
    created_at timestamp with time zone not null
);
```

- [ ] **Step 4: Add exact enums and checkpoint factory**

```kotlin
enum class AutomationModuleType { KEY_QUEST, TIME, COOLDOWN_ADVENTURE, DAILY_ADVENTURE, UNION, NORMAL_QUEST, NORMAL_MAP }
enum class AutomationJobStatus { PENDING, RUNNING, WAITING_CAPTCHA, WAITING_CONFIG, WAITING_LOGIN, PAUSED, CANCELLED }
enum class AutomationActionStatus { PENDING, RUNNING, SUCCEEDED, RETRYABLE_FAILED, BLOCKED }

data class TimeModuleConfig(val thresholdPercent: Int)

companion object {
    fun pending(
        job: AutomationJobEntity,
        moduleType: AutomationModuleType,
        actionType: String,
        actionKey: String,
    ) = AutomationActionRunEntity(
        job = job,
        moduleType = moduleType.name,
        actionType = actionType,
        actionKey = actionKey,
        requestJson = "{}",
        resultJson = null,
        status = AutomationActionStatus.PENDING.name,
        attemptCount = 0,
        startedAt = null,
        finishedAt = null,
        createdAt = Instant.now(),
    )
}

fun runningAutomationJob(
    account: HofAccountEntity,
    profile: AutomationProfileEntity,
    now: Instant,
) = AutomationJobEntity(
    account = account,
    profile = profile,
    status = AutomationJobStatus.RUNNING.name,
    currentStepIndex = 0,
    message = "실행 준비",
    createdAt = now,
    startedAt = now,
    updatedAt = now,
    finishedAt = null,
)
```

- [ ] **Step 5: Run repository tests**

Run: `cd ../hof_backend && ./gradlew test --tests '*UnifiedAutomationPersistenceTest'`

Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add src/main/resources/db/migration/V4__add_unified_automation_core.sql src/main/kotlin/app/spammy/hof/automation src/test/kotlin/app/spammy/hof/automation/repository/UnifiedAutomationPersistenceTest.kt
git commit -m "feat: persist unified automation checkpoints"
```

### Task 2: Add the unified settings and lifecycle API

**Files:**
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/dto/UnifiedAutomationDtos.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/repository/UnifiedAutomationQueryRepository.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/service/UnifiedAutomationService.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/controller/UnifiedAutomationController.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/automation/controller/UnifiedAutomationControllerTest.kt`

- [ ] **Step 1: Write failing API tests for get, put, start, pause, resume, and stop**

```kotlin
@Test
fun `put unified settings and start returns running status`() {
    mockMvc.put("/api/automation/unified") {
        bearer(accountToken)
        contentType = MediaType.APPLICATION_JSON
        content = """{"time":{"enabled":true,"thresholdPercent":90},"keyQuest":{"enabled":true}}"""
    }.andExpect { status { isOk() }; jsonPath("$.time.thresholdPercent") { value(90) } }

    mockMvc.post("/api/automation/unified/start") { bearer(accountToken) }
        .andExpect { status { isOk() }; jsonPath("$.job.status") { value("RUNNING") } }
}
```

- [ ] **Step 2: Run the controller test and verify 404**

Run: `cd ../hof_backend && ./gradlew test --tests '*UnifiedAutomationControllerTest'`

Expected: FAIL with status 404 for `/api/automation/unified`.

- [ ] **Step 3: Define typed request/response contracts**

```kotlin
data class UnifiedAutomationSettingsRequest(
    val keyQuest: KeyQuestSettingsRequest,
    val time: TimeSettingsRequest,
    val cooldownAdventure: ToggleModuleRequest,
    val dailyAdventure: ToggleModuleRequest,
    val union: ToggleModuleRequest,
    val normalQuest: NormalQuestSettingsRequest,
)
data class ModuleMapRequest(val categoryId: String, val mapCode: String, val partyPresetId: Long?, val executionOrder: Int)
data class QuestExecutionRequest(val questId: String, val maps: List<ModuleMapRequest>)
data class KeyQuestSettingsRequest(val enabled: Boolean, val quests: List<QuestExecutionRequest>)
data class TimeSettingsRequest(val enabled: Boolean, @field:Min(70) @field:Max(100) val thresholdPercent: Int, val maps: List<ModuleMapRequest>)
data class ToggleModuleRequest(val enabled: Boolean)
data class NormalQuestSettingsRequest(val enabled: Boolean, val questIds: List<String>)
data class UnifiedAutomationStatusResponse(
    val profileId: Long,
    val job: AutomationJobResponse?,
    val settings: UnifiedAutomationSettingsRequest,
    val currentTitle: String?,
    val nextRunAt: String?,
)
```

- [ ] **Step 4: Implement account-scoped settings and lifecycle methods**

```kotlin
@Transactional
fun start(accountId: Long): UnifiedAutomationStatusResponse {
    val profile = unifiedQueryRepository.findOrCreateUnifiedProfile(accountId)
    val current = unifiedQueryRepository.findActiveJob(accountId)
    val job = current ?: jobRepository.save(runningAutomationJob(profile.account, profile, timeProvider.now()))
    wakeupPort.wake(accountId, "USER_START")
    return buildStatus(profile, job)
}

@Transactional
fun pause(accountId: Long): UnifiedAutomationStatusResponse = transition(accountId, AutomationJobStatus.PAUSED)

@Transactional
fun resume(accountId: Long): UnifiedAutomationStatusResponse =
    transition(accountId, AutomationJobStatus.RUNNING).also { wakeupPort.wake(accountId, "USER_RESUME") }

@Transactional
fun stop(accountId: Long): UnifiedAutomationStatusResponse = transition(accountId, AutomationJobStatus.CANCELLED)
```

- [ ] **Step 5: Run controller and service tests**

Run: `cd ../hof_backend && ./gradlew test --tests '*UnifiedAutomation*Test'`

Expected: PASS.

- [ ] **Step 6: Commit the API slice**

```bash
git add src/main/kotlin/app/spammy/hof/automation src/test/kotlin/app/spammy/hof/automation
git commit -m "feat: add unified automation API"
```

### Task 3: Parse the quest page as the source of truth

**Files:**
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/quest/model/QuestModels.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/quest/parser/QuestPageParser.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/quest/parser/QuestPageParserTest.kt`
- Test fixture: `../hof_backend/src/test/resources/fixtures/quest/quest-states.html`

- [ ] **Step 1: Add one fixture containing AVAILABLE, ACTIVE, CLAIMABLE, COMPLETED, and UNAVAILABLE quests**

```html
<section data-quest-id="0563"><h3>[0563] 저택 동관 열쇠 수집</h3><p>Key Keeper - [ 2 / 5 ]</p><button name="complete">완료</button></section>
<section data-quest-id="0571"><h3>[0571] 저택 서관 열쇠 수집</h3><p>Killer Maid - [ 7 / 20 ]</p></section>
<section data-quest-id="0171"><h3>[0171] 우선 키 퀘스트</h3><button name="get">수락</button></section>
<section data-quest-id="0351"><h3>[0351] 마을 지하 수로</h3><p>완료한 퀘스트</p></section>
<section data-quest-id="0999"><h3>[0999] 잠긴 퀘스트</h3></section>
```

- [ ] **Step 2: Write the failing parser test**

```kotlin
@Test
fun `parses quest state and progress without guessing completion`() {
    val quests = parser.parse(fixture("quest/quest-states.html")).associateBy { it.questId }
    assertEquals(QuestState.CLAIMABLE, quests.getValue("0563").state)
    assertEquals(QuestProgress(7, 20), quests.getValue("0571").progress)
    assertEquals(QuestState.AVAILABLE, quests.getValue("0171").state)
    assertEquals(QuestState.COMPLETED, quests.getValue("0351").state)
    assertEquals(QuestState.UNAVAILABLE, quests.getValue("0999").state)
}
```

- [ ] **Step 3: Run the parser test and verify failure**

Run: `cd ../hof_backend && ./gradlew test --tests '*QuestPageParserTest'`

Expected: compilation fails because `QuestPageParser` is missing.

- [ ] **Step 4: Implement normalized quest models and parser rules**

```kotlin
enum class QuestState { AVAILABLE, ACTIVE, CLAIMABLE, COMPLETED, UNAVAILABLE }
data class QuestProgress(val current: Int, val target: Int)
data class HofQuest(val questId: String, val name: String, val state: QuestState, val progress: QuestProgress?)

private val idPattern = Regex("\\[(\\d{4})]")
private val progressPattern = Regex("\\[\\s*(\\d+)\\s*/\\s*(\\d+)\\s*]")

private fun stateOf(element: Element, progress: QuestProgress?): QuestState = when {
    element.selectFirst("button[name=complete], input[name=complete]") != null -> QuestState.CLAIMABLE
    element.selectFirst("button[name=get], input[name=get]") != null -> QuestState.AVAILABLE
    element.text().contains("완료한 퀘스트") -> QuestState.COMPLETED
    progress != null -> QuestState.ACTIVE
    else -> QuestState.UNAVAILABLE
}
```

- [ ] **Step 5: Run the parser test**

Run: `cd ../hof_backend && ./gradlew test --tests '*QuestPageParserTest'`

Expected: PASS.

- [ ] **Step 6: Commit the parser**

```bash
git add src/main/kotlin/app/spammy/hof/quest src/test/kotlin/app/spammy/hof/quest src/test/resources/fixtures/quest
git commit -m "feat: parse HOF quest state"
```

### Task 4: Implement key-quest and east-mansion selection policies

**Files:**
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/policy/EastMansionMapPolicy.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/policy/KeyQuestPolicy.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/policy/KeyQuestDefaultCatalog.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/automation/policy/EastMansionMapPolicyTest.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/automation/policy/KeyQuestPolicyTest.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/automation/policy/KeyQuestDefaultCatalogTest.kt`

- [ ] **Step 1: Write failing fixed, balance, and corridor fallback tests**

```kotlin
@Test
fun `multiple keyed maps consume the map with the greatest remaining key count`() {
    val selected = listOf(
        candidate("Noble1021", "저택 동관(보쉬의 방)", keyCount = 12, order = 0),
        candidate("Noble1022", "저택 동관(하인켈의 방)", keyCount = 8, order = 1),
        candidate("Noble1023", "저택 동관(커티스의 방)", keyCount = 12, order = 2),
        candidate("Noble102", "저택 동관(복도)", keyCount = null, order = 3),
    )
    assertEquals("Noble1021", policy.select(selected)?.mapCode)
}

@Test
fun `fixed keyed map without a key falls back to corridor`() {
    val fixed = listOf(candidate("Noble1021", "저택 동관(보쉬의 방)", keyCount = 0, order = 0))
    assertEquals("Noble102", policy.select(fixed)?.mapCode)
}
```

- [ ] **Step 2: Run policy tests and verify failure**

Run: `cd ../hof_backend && ./gradlew test --tests '*EastMansionMapPolicyTest' --tests '*KeyQuestPolicyTest'`

Expected: compilation fails because policy classes are missing.

- [ ] **Step 3: Implement deterministic selection**

```kotlin
fun select(selected: List<KeyQuestMapCandidate>): KeyQuestMapCandidate? {
    require(selected.isNotEmpty())
    val keyed = selected.filter { it.mapCode != CORRIDOR_CODE }
    if (selected.size == 1) {
        return selected.single().takeIf { it.keyCount == null || it.keyCount > 0 } ?: corridorFallback()
    }
    return keyed
        .filter { (it.keyCount ?: 0) > 0 }
        .sortedWith(compareByDescending<KeyQuestMapCandidate> { it.keyCount }.thenBy { it.executionOrder })
        .firstOrNull()
        ?: selected.firstOrNull { it.mapCode == CORRIDOR_CODE }
        ?: corridorFallback()
}
```

- [ ] **Step 4: Implement priority IDs and missing-config blocking**

```kotlin
val PRIORITY_QUEST_IDS = listOf("0563", "0571", "0171", "0351")

fun decide(quests: List<HofQuest>, configs: Map<String, QuestExecutionConfig>): QuestDecision? {
    val ordered = PRIORITY_QUEST_IDS.mapNotNull { id -> quests.firstOrNull { it.questId == id } }
    ordered.firstOrNull { it.state == QuestState.CLAIMABLE }?.let { return QuestDecision.Claim(it.questId) }
    ordered.firstOrNull { it.state == QuestState.AVAILABLE }?.let { return QuestDecision.Accept(it.questId) }
    ordered.firstOrNull { it.state == QuestState.ACTIVE }?.let { quest ->
        return configs[quest.questId]?.let { QuestDecision.Battle(quest.questId, it) }
            ?: QuestDecision.WaitingConfig(quest.questId, "전투에 사용할 파티를 선택해 주세요.")
    }
    return null
}
```

- [ ] **Step 5: Encode supplied quest defaults and pattern blueprints**

```kotlin
data class PartyBlueprintSlot(val characterName: String, val patternSlot: Int)
data class PartyBlueprint(val slots: List<PartyBlueprintSlot>, val battleCount: Int)
data class QuestDefault(
    val candidates: List<String>,
    val fallbackMapCode: String?,
    val partyBlueprint: PartyBlueprint?,
    val partyBlueprintByMap: Map<String, PartyBlueprint> = emptyMap(),
)

val defaults = mapOf(
    "0563" to QuestDefault(
        candidates = listOf("Noble1021", "Noble1022", "Noble1023", "Noble102"),
        fallbackMapCode = "Noble102",
        partyBlueprint = null,
        partyBlueprintByMap = mapOf(
            "Noble1021" to PartyBlueprint(listOf(PartyBlueprintSlot("소셜2", 5), PartyBlueprintSlot("사제", 7), PartyBlueprintSlot("바드2", 8), PartyBlueprintSlot("솬서", 0), PartyBlueprintSlot("에인", 3)), 3),
            "Noble1022" to PartyBlueprint(listOf(PartyBlueprintSlot("소셜2", 6), PartyBlueprintSlot("사제", 7), PartyBlueprintSlot("바드", 0), PartyBlueprintSlot("솬서", 0), PartyBlueprintSlot("에인", 3)), 3),
            "Noble1023" to PartyBlueprint(listOf(PartyBlueprintSlot("암흑네크", 3), PartyBlueprintSlot("사제", 7), PartyBlueprintSlot("바드2", 0), PartyBlueprintSlot("솬서", 0), PartyBlueprintSlot("에인", 3)), 3),
            "Noble102" to PartyBlueprint(listOf(PartyBlueprintSlot("소셜", 0), PartyBlueprintSlot("사제", 0), PartyBlueprintSlot("바드", 0), PartyBlueprintSlot("에인", 0), PartyBlueprintSlot("동방", 0)), 3),
        ),
    ),
    "0571" to QuestDefault(
        candidates = listOf("Noble201"),
        fallbackMapCode = null,
        partyBlueprint = PartyBlueprint(
            slots = listOf(
                PartyBlueprintSlot("카발", 2),
                PartyBlueprintSlot("사제2", 3),
                PartyBlueprintSlot("낫망네크", 3),
            ),
            battleCount = 1,
        ),
    ),
    "0351" to QuestDefault(
        candidates = listOf("tnfh1"),
        fallbackMapCode = null,
        partyBlueprint = null,
        partyBlueprintByMap = emptyMap(),
    ),
)
```

`QuestDefault` gives `partyBlueprintByMap` a default value of `emptyMap()`, so `0571` can use its common blueprint without repeating a map entry. Character names are resolved in the account roster; a missing character or user override is presented as configuration required. `0351` displays `Culvert- 마을 지하 수로(입구)` and requires the user to choose a party. `0171` has no supplied map definition, so an active `0171` without user configuration returns `WAITING_CONFIG` rather than guessing a map.

- [ ] **Step 6: Add catalog assertions**

```kotlin
@Test
fun `0571 uses Noble201 and supplied pattern slots`() {
    val config = catalog.getValue("0571")
    assertEquals(listOf("Noble201"), config.candidates)
    assertEquals(listOf("카발" to 2, "사제2" to 3, "낫망네크" to 3), config.partyBlueprint!!.slots.map { it.characterName to it.patternSlot })
}

@Test
fun `0351 points to Culvert entrance but completion remains quest-page driven`() {
    assertEquals(listOf("tnfh1"), catalog.getValue("0351").candidates)
}

@Test
fun `0563 keeps a distinct supplied party for every candidate map`() {
    val parties = catalog.getValue("0563").partyBlueprintByMap
    assertEquals(listOf("소셜2", "사제", "바드2", "솬서", "에인"), parties.getValue("Noble1021").slots.map { it.characterName })
    assertEquals(listOf("소셜", "사제", "바드", "에인", "동방"), parties.getValue("Noble102").slots.map { it.characterName })
}
```

- [ ] **Step 7: Run policy tests**

Run: `cd ../hof_backend && ./gradlew test --tests '*automation.policy*'`

Expected: PASS.

- [ ] **Step 8: Commit key-quest policies**

```bash
git add src/main/kotlin/app/spammy/hof/automation/policy src/test/kotlin/app/spammy/hof/automation/policy
git commit -m "feat: select priority key quest battles"
```

### Task 5: Add the global decision policy

**Files:**
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/policy/AutomationDecisionPolicy.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/policy/AdventureMapPolicy.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/policy/SelectedQuestPolicy.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/automation/policy/AutomationDecisionPolicyTest.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/automation/policy/AdventureMapPolicyTest.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/automation/policy/SelectedQuestPolicyTest.kt`

- [ ] **Step 1: Write a failing priority table test**

```kotlin
@Test
fun `key quest wins before time overflow and union wins before adventure`() {
    val state = snapshot(keyQuest = activeQuest("0563"), timePercent = 96, unionHp = 500, cooldownReady = true)
    assertEquals(AutomationModuleType.KEY_QUEST, policy.decide(state).moduleType)

    val withoutQuest = state.copy(priorityQuestDecision = null)
    assertEquals(AutomationModuleType.TIME, policy.decide(withoutQuest).moduleType)

    val withoutOverflow = withoutQuest.copy(timePercent = 90)
    assertEquals(AutomationModuleType.UNION, policy.decide(withoutOverflow).moduleType)
}
```

- [ ] **Step 2: Run the test and verify failure**

Run: `cd ../hof_backend && ./gradlew test --tests '*AutomationDecisionPolicyTest'`

Expected: compilation fails because the policy is missing.

- [ ] **Step 3: Implement the exact priority order**

```kotlin
fun decide(snapshot: AutomationSnapshot): AutomationDecision = when {
    snapshot.claimableQuest != null -> AutomationDecision.claim(snapshot.claimableQuest)
    snapshot.acceptablePriorityQuest != null -> AutomationDecision.accept(snapshot.acceptablePriorityQuest)
    snapshot.priorityQuestDecision != null -> snapshot.priorityQuestDecision
    snapshot.timePercent > snapshot.timeThresholdPercent -> AutomationDecision.timeBattle(snapshot.timeMap)
    snapshot.unionTarget?.hp?.let { it > 0 } == true -> AutomationDecision.unionBattle(snapshot.unionTarget)
    snapshot.readyCooldownMap != null -> AutomationDecision.cooldownBattle(snapshot.readyCooldownMap)
    snapshot.readyDailyMap != null -> AutomationDecision.dailyBattle(snapshot.readyDailyMap)
    snapshot.normalQuestDecision != null -> snapshot.normalQuestDecision
    else -> AutomationDecision.sleep(snapshot.earliestNextRunAt)
}
```

- [ ] **Step 4: Add boundary tests for `90%`, exhausted counts, cooldown order, and dead union**

```kotlin
@Test
fun `exact threshold does not trigger time battle`() {
    assertEquals(AutomationDecisionType.SLEEP, policy.decide(snapshot(timePercent = 90, threshold = 90)).type)
}

@Test
fun `dead union is skipped for ready cooldown map`() {
    val decision = policy.decide(snapshot(unionHp = 0, cooldownReady = true))
    assertEquals(AutomationModuleType.COOLDOWN_ADVENTURE, decision.moduleType)
}
```

- [ ] **Step 5: Implement cooldown and daily eligibility from persisted map state**

```kotlin
fun selectCooldown(candidates: List<AdventureCandidate>, now: Instant): AdventureCandidate? =
    candidates
        .filter { it.visible && it.enabled && (it.cooldownUntil == null || !it.cooldownUntil.isAfter(now)) }
        .sortedWith(compareBy<AdventureCandidate> { it.cooldownUntil ?: Instant.EPOCH }.thenBy { it.executionOrder })
        .firstOrNull()

fun selectDaily(candidates: List<AdventureCandidate>): AdventureCandidate? =
    candidates
        .filter { it.visible && it.enabled }
        .filter { it.winRemaining == null || it.winRemaining > 0 }
        .filter { it.attemptRemaining == null || it.attemptRemaining > 0 }
        .filter { it.availableCount == null || it.availableCount > 0 }
        .minByOrNull { it.executionOrder }
```

- [ ] **Step 6: Implement selected normal quest policy**

```kotlin
fun decide(quests: List<HofQuest>, selectedQuestIds: Set<String>): QuestDecision? {
    val selected = quests.filter { it.questId in selectedQuestIds }
    selected.firstOrNull { it.state == QuestState.CLAIMABLE }?.let { return QuestDecision.Claim(it.questId) }
    selected.firstOrNull { it.state == QuestState.AVAILABLE }?.let { return QuestDecision.Accept(it.questId) }
    selected.firstOrNull { it.state == QuestState.ACTIVE }?.let { return QuestDecision.BattleSelectedQuest(it.questId) }
    return null
}
```

- [ ] **Step 7: Add policy assertions for cooldown age, daily exhaustion, and selected quests**

```kotlin
@Test
fun `oldest ready cooldown wins and exhausted daily map is skipped`() {
    assertEquals("cooldown-old", policy.selectCooldown(cooldownCandidates, now)?.mapCode)
    assertNull(policy.selectDaily(listOf(dailyCandidate(winRemaining = 0))))
}

@Test
fun `only user-selected normal quest can be accepted`() {
    assertEquals(QuestDecision.Accept("0998"), selectedQuestPolicy.decide(quests, setOf("0998")))
}
```

- [ ] **Step 8: Run policy tests**

Run: `cd ../hof_backend && ./gradlew test --tests '*automation.policy*'`

Expected: PASS.

- [ ] **Step 9: Commit the decision policy**

```bash
git add src/main/kotlin/app/spammy/hof/automation/policy src/test/kotlin/app/spammy/hof/automation/policy
git commit -m "feat: prioritize unified automation actions"
```

### Task 6: Execute and checkpoint one action at a time

**Files:**
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/port/AutomationWakeupPort.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/adapter/LocalAutomationWakeupAdapter.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/service/AutomationActionExecutor.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/service/UnifiedAutomationRunner.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/quest/service/QuestGatewayService.kt`
- Modify: `../hof_backend/src/main/kotlin/app/spammy/hof/external/client/HofRequestFactory.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/automation/service/UnifiedAutomationRunnerTest.kt`

- [ ] **Step 1: Write a failing checkpoint/re-evaluation test**

```kotlin
@Test
fun `runner persists battle result then reloads quest state before next action`() {
    whenever(snapshotLoader.load(accountId)).thenReturn(active0563Snapshot, claimable0563Snapshot)
    runner.runOne(accountId)
    verify(actionExecutor).execute(check { assertEquals(AutomationDecisionType.RUN_BATTLE, it.type) })
    verify(actionRunRepository).save(check { assertEquals("SUCCEEDED", it.status) })
    verify(wakeupPort).wake(accountId, "ACTION_SUCCEEDED")
}
```

- [ ] **Step 2: Run the test and verify failure**

Run: `cd ../hof_backend && ./gradlew test --tests '*UnifiedAutomationRunnerTest'`

Expected: compilation fails because the runner is missing.

- [ ] **Step 3: Implement the wakeup port and single-action transaction boundary**

```kotlin
fun interface AutomationWakeupPort {
    fun wake(accountId: Long, reason: String)
}

fun runOne(accountId: Long) {
    val job = jobQueryRepository.findRunnableByAccountId(accountId) ?: return
    val decision = decisionPolicy.decide(snapshotLoader.load(accountId))
    if (decision.type == AutomationDecisionType.SLEEP) {
        jobService.schedule(job.id, decision.nextRunAt)
        return
    }
    val action = actionRunService.start(job, decision)
    try {
        val result = actionExecutor.execute(decision)
        actionRunService.succeed(action.id, result)
        wakeupPort.wake(accountId, "ACTION_SUCCEEDED")
    } catch (error: AutomationBlockedException) {
        actionRunService.block(action.id, error.jobStatus, error.message)
    } catch (error: RuntimeException) {
        actionRunService.retryableFailure(action.id, error.message ?: error.javaClass.simpleName)
    }
}
```

- [ ] **Step 4: Implement quest page, accept, claim, and battle action dispatch**

```kotlin
sealed interface AutomationActionResult {
    data class QuestSnapshot(val quests: List<HofQuest>) : AutomationActionResult
    data class Battle(val result: BattleResultResponse) : AutomationActionResult
    data class MapSnapshot(val maps: List<BattleMapResponse>) : AutomationActionResult

    companion object {
        fun quests(value: List<HofQuest>) = QuestSnapshot(value)
        fun battle(value: BattleResultResponse) = Battle(value)
        fun maps(value: List<BattleMapResponse>) = MapSnapshot(value)
    }
}

fun execute(accountId: Long, decision: AutomationDecision): AutomationActionResult =
    sessionRecoveryExecutor.execute(accountId) {
        when (decision.type) {
            AutomationDecisionType.SYNC_QUESTS -> AutomationActionResult.quests(questGateway.load(accountId))
            AutomationDecisionType.ACCEPT_QUEST -> AutomationActionResult.quests(questGateway.accept(accountId, requireNotNull(decision.questId)))
            AutomationDecisionType.CLAIM_QUEST -> AutomationActionResult.quests(questGateway.claim(accountId, requireNotNull(decision.questId)))
            AutomationDecisionType.RUN_BATTLE -> AutomationActionResult.battle(battleRunService.runBattle(accountId, requireNotNull(decision.battleRequest)))
            AutomationDecisionType.SYNC_MAPS -> AutomationActionResult.maps(battleMapService.sync(accountId))
            AutomationDecisionType.SYNC_UNION -> AutomationActionResult.maps(battleMapService.syncUnion(accountId))
            AutomationDecisionType.SLEEP -> throw IllegalArgumentException("SLEEP은 action executor로 전달할 수 없습니다.")
        }
    }
```

`HofRequestFactory` adds `questPage()`, `acceptQuest(questId)`, and `claimQuest(questId)` requests against `index.php?menu=quest`. `QuestGatewayService` parses the response after every accept/claim. A successful battle schedules a new wakeup; the next runner invocation reloads the quest page before choosing another battle.

- [ ] **Step 5: Assert claim-all behavior and post-battle quest reload**

```kotlin
@Test
fun `claimable unselected quest is claimed before accepting selected quest`() {
    val snapshot = snapshot(claimableQuest = quest("0888"), acceptableNormalQuest = quest("0998"))
    assertEquals(AutomationDecision.claim("0888"), decisionPolicy.decide(snapshot))
}

@Test
fun `battle success wakes a fresh evaluation instead of decrementing local quest progress`() {
    runner.runOne(accountId)
    verify(snapshotLoader, times(1)).load(accountId)
    verify(wakeupPort).wake(accountId, "ACTION_SUCCEEDED")
}
```

- [ ] **Step 6: Implement local wakeups with per-account serialization**

```kotlin
private val executors = ConcurrentHashMap<Long, ExecutorService>()

override fun wake(accountId: Long, reason: String) {
    executors.computeIfAbsent(accountId) { Executors.newSingleThreadExecutor() }
        .submit { runnerProvider.getObject().runOne(accountId) }
}
```

- [ ] **Step 7: Run runner and automation tests**

Run: `cd ../hof_backend && ./gradlew test --tests '*automation*' --tests '*quest*'`

Expected: PASS and the runner test shows only one external action per invocation.

- [ ] **Step 8: Commit the local runner**

```bash
git add src/main/kotlin/app/spammy/hof/automation src/main/kotlin/app/spammy/hof/quest src/test/kotlin/app/spammy/hof/automation
git commit -m "feat: run persistent automation actions"
```

### Task 7: Verify the core slice

**Files:**
- Modify: `../hof_backend/docs/features/maps-battle-automation.md`

- [ ] **Step 1: Document the working local-runner boundary**

```markdown
## 통합 자동화 코어

계정별 통합 job은 퀘스트 페이지와 맵 상태를 다시 읽어 다음 action 하나를 결정한다. 각 action은 `automation_action_runs`에 저장되며, Kafka 도입 전에는 계정별 단일 thread local adapter가 같은 계정의 호출을 직렬화한다.
```

- [ ] **Step 2: Run all backend tests**

Run: `cd ../hof_backend && ./gradlew test`

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Start backend with the test profile and verify migration**

Run: `cd ../hof_backend && ./gradlew bootRun --args='--spring.profiles.active=test'`

Expected: application starts and Flyway reports schema version `4`.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/features/maps-battle-automation.md
git commit -m "docs: describe unified automation core"
```
