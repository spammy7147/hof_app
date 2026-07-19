# Backend Test Suite Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce backend test maintenance code and provide a reliable fast feedback suite while preserving persistence, security, parser, concurrency, and transaction guarantees.

**Architecture:** Plain JUnit tests remain the default fast feedback layer. Spring-backed tests keep only guarantees that require application context, database, transaction, or security infrastructure and run through a dedicated integration task as well as CI. Repeated negative matrices become parameterized tests; production code remains unchanged.

**Tech Stack:** Kotlin, Spring Boot, Gradle Kotlin DSL, JUnit 5, Mockito, H2/Flyway.

---

### Task 1: Record backend baseline and recover a stable full-run result

**Files:**
- Inspect: `src/test/kotlin/**/*.kt`
- Inspect: `build.gradle.kts`

- [ ] **Step 1: Confirm branch and metrics**

```bash
git branch --show-current
git status --short
find src/test/kotlin -name '*Test.kt' -type f | wc -l
find src/test/kotlin -name '*Test.kt' -type f -exec wc -l {} + | tail -1
rg -n '^\s*@Test' src/test/kotlin -g '*Test.kt' | wc -l
```

Expected: branch `refactor/simplify-test-suite`, 100 classes, 18,337 lines, and 514 directly annotated tests.

- [ ] **Step 2: Run a clean full baseline with explicit memory diagnostics**

```bash
./gradlew --stop
./gradlew cleanTest test --console=plain --stacktrace
```

Expected: either a passing baseline or a captured worker failure with stack trace. Do not change assertions to address a Gradle `EOFException`.

### Task 2: Add a fast test task without annotating every class

**Files:**
- Modify: `build.gradle.kts`

- [ ] **Step 1: Add the task and verify it is initially absent**

Run:

```bash
./gradlew fastTest
```

Expected: FAIL because task `fastTest` does not exist.

- [ ] **Step 2: Register `fastTest` using the exact Spring-backed class inventory**

Add a `Test` task that reuses `sourceSets["test"]` and excludes the 35 class files returned by:

```bash
rg -l '@SpringBootTest|@DataJpaTest' src/test/kotlin -g '*Test.kt'
```

Convert each source path to its fully qualified class-file pattern, for example:

```kotlin
tasks.register<Test>("fastTest") {
    description = "Runs tests that do not start a Spring application or JPA test context."
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    testClassesDirs = sourceSets["test"].output.classesDirs
    classpath = sourceSets["test"].runtimeClasspath
    useJUnitPlatform()
    exclude("**/AccountQueryRepositoryTest.class")
    exclude("**/AuthApiSecurityTest.class")
    exclude("**/RefreshTokenQueryRepositoryTest.class")
    exclude("**/UnifiedAutomationApiSecurityTest.class")
    exclude("**/AccountAutomationLeaseServiceTest.class")
    exclude("**/*IntegrationTest.class")
    exclude("**/AutomationJobQueryRepositoryTest.class")
    exclude("**/AutomationProfileQueryRepositoryTest.class")
    exclude("**/TypedAutomationPersistenceTest.class")
    exclude("**/AutomationDailyPreflightMapSyncTest.class")
    exclude("**/AutomationDailyPreflightTest.class")
    exclude("**/AutomationJobServiceTest.class")
    exclude("**/AutomationProfileServiceTest.class")
    exclude("**/BattleMapAutomationHandlerTest.class")
    exclude("**/QuestAutomationHandlerTest.class")
    exclude("**/BattleLogQueryRepositoryTest.class")
    exclude("**/BattleMapQueryRepositoryTest.class")
    exclude("**/BattleMapSeedTest.class")
    exclude("**/BattleLogServiceTest.class")
    exclude("**/BattleMapIdentityResolverTest.class")
    exclude("**/BattleMapServiceTest.class")
    exclude("**/CaptchaQueryRepositoryTest.class")
    exclude("**/CaptchaServicePersistenceTest.class")
    exclude("**/CharacterQueryRepositoryTest.class")
    exclude("**/QueryDslConfigTest.class")
    exclude("**/HttpsEnforcementTest.class")
    exclude("**/PartyPresetQueryRepositoryTest.class")
    exclude("**/PartyPresetConcurrencyTest.class")
    exclude("**/PartyPresetServiceTest.class")
    exclude("**/FreshSchemaTest.class")
    exclude("**/QuestApiSecurityTest.class")
}
```

The wildcard covers the six explicitly named `*IntegrationTest` classes. Compare the resulting excludes against the 35-file inventory so no Spring-backed class enters `fastTest`.

- [ ] **Step 3: Verify fast and full task discovery**

```bash
/usr/bin/time -p ./gradlew fastTest --console=plain
./gradlew test --dry-run
```

Expected: `fastTest` passes without Spring context startup logs; `test` remains the complete suite.

- [ ] **Step 4: Commit the feedback task**

```bash
git add build.gradle.kts
git commit -m "build: add fast backend test task"
```

### Task 3: Parameterize repeated service rejection matrices

**Files:**
- Modify: `src/test/kotlin/app/spammy/hof/captcha/service/CaptchaServiceTest.kt`
- Modify: `src/test/kotlin/app/spammy/hof/battle/service/BattleRunServiceTest.kt`
- Modify: `src/test/kotlin/app/spammy/hof/automation/service/UnifiedAutomationServiceTest.kt`

- [ ] **Step 1: Consolidate captcha ownership/status/cookie rejection tests**

Replace separate `loadImageRejects...` and `submitAnswerRejects...` setup blocks with `@ParameterizedTest` plus `@MethodSource`. Use a private `InvalidChallengeCase` data class containing `name`, `challenge`, `owned`, `cookies`, and expected `ErrorCode`. The parameterized body must invoke the relevant public method and retain these common assertions:

```kotlin
val exception = assertFailsWith<ApiException> { scenario.invoke(service) }
assertEquals(scenario.expectedCode, exception.errorCode)
assertEquals(emptyList(), gateway.requests)
```

Keep binary-response content-type and gateway-failure tests separate because their setup and postconditions differ. Target at least 220 net lines removed without dropping an invalid-input row.

- [ ] **Step 2: Consolidate battle state rejection variants**

Turn the missing/invisible, disabled/cooldown, and zero-limit variants into a named `@MethodSource` table only where they share the exact `runBattle` invocation and “no HOF request” assertion. Keep three-battle capability, multi-round recording, and captcha interruption as separate behavioral tests.

- [ ] **Step 3: Consolidate unified automation validation matrices**

Parameterize duplicate source/execution order and rejected category variants. Retain aggregate ownership, warning state, and wake behavior as separate tests.

- [ ] **Step 4: Run focused tests and inspect line reduction**

```bash
./gradlew test --tests '*CaptchaServiceTest' --tests '*BattleRunServiceTest' --tests '*UnifiedAutomationServiceTest' --console=plain
git diff --stat
git diff --check
```

Expected: all focused tests pass and at least 350 net lines are removed across the three files.

- [ ] **Step 5: Commit**

```bash
git add src/test/kotlin/app/spammy/hof/captcha/service/CaptchaServiceTest.kt \
  src/test/kotlin/app/spammy/hof/battle/service/BattleRunServiceTest.kt \
  src/test/kotlin/app/spammy/hof/automation/service/UnifiedAutomationServiceTest.kt
git commit -m "test: consolidate backend service scenarios"
```

### Task 4: Consolidate parser fixtures without losing production regressions

**Files:**
- Modify: `src/test/kotlin/app/spammy/hof/external/parser/BattleMapParserTest.kt`
- Modify: `src/test/kotlin/app/spammy/hof/external/parser/BattleResultParserTest.kt`
- Modify: `src/test/kotlin/app/spammy/hof/quest/parser/QuestPageParserTest.kt`

- [ ] **Step 1: Introduce local named parser-case tables**

Use `@ParameterizedTest(name = "{0}")` and `@MethodSource` for HTML snippets that differ only by one supported syntax. The argument object must carry the case name, HTML, and full expected parsed value. Do not combine captured fixture tests or the recent sibling-block/classless ownership regressions.

- [ ] **Step 2: Consolidate only these repeated syntax groups**

```text
BattleMapParserTest: hours-only, minutes-only, and combined cooldown parsing
BattleMapParserTest: absent, zero, and malformed advertised dynamic fields
BattleResultParserTest: equivalent reward/result row shapes
QuestPageParserTest: equivalent reward-header and row-local reward shapes
QuestPageParserTest: URL parameter decoding cases
```

Every old input must remain as a named parameter row. Fixture files under `src/test/resources/fixtures` remain unchanged.

- [ ] **Step 3: Run focused parser tests**

```bash
./gradlew test --tests '*BattleMapParserTest' --tests '*BattleResultParserTest' --tests '*QuestPageParserTest' --console=plain
```

Expected: all parser cases pass, including the production fixture and recent quest ownership regressions.

- [ ] **Step 4: Require a net simplification and commit**

```bash
git diff --stat
git diff --check
git add src/test/kotlin/app/spammy/hof/external/parser src/test/kotlin/app/spammy/hof/quest/parser
git commit -m "test: consolidate backend parser cases"
```

Expected: at least 250 net lines removed; abandon any conversion that hides fixture intent or grows the file.

### Task 5: Remove controller tests that only repeat typed delegation

**Files:**
- Delete: `src/test/kotlin/app/spammy/hof/automation/controller/AutomationProfileControllerTest.kt`
- Delete: `src/test/kotlin/app/spammy/hof/automation/controller/UnifiedAutomationControllerTest.kt`
- Delete: `src/test/kotlin/app/spammy/hof/battle/controller/BattleCatalogControllerTest.kt`
- Delete: `src/test/kotlin/app/spammy/hof/battle/controller/BattleLogControllerTest.kt`
- Delete: `src/test/kotlin/app/spammy/hof/captcha/controller/CaptchaControllerTest.kt`
- Delete: `src/test/kotlin/app/spammy/hof/party/controller/PartyPresetControllerTest.kt`
- Preserve: `src/test/kotlin/app/spammy/hof/auth/controller/AuthApiSecurityTest.kt`
- Preserve: `src/test/kotlin/app/spammy/hof/automation/controller/AutomationJobControllerTest.kt`
- Preserve: `src/test/kotlin/app/spammy/hof/automation/controller/UnifiedAutomationApiSecurityTest.kt`
- Preserve: `src/test/kotlin/app/spammy/hof/battle/controller/BattleRunControllerTest.kt`
- Preserve: `src/test/kotlin/app/spammy/hof/character/controller/CharacterControllerLegacyEndpointTest.kt`
- Preserve: `src/test/kotlin/app/spammy/hof/quest/controller/QuestApiSecurityTest.kt`
- Preserve: `src/test/kotlin/app/spammy/hof/quest/controller/QuestControllerTest.kt`

- [ ] **Step 1: Verify the six deletion targets contain delegation assertions only**

Run:

```bash
rg -n 'MockMvc|WebTestClient|SecurityContext|assertFails|ApiException|@SpringBootTest|@DataJpaTest' \
  src/test/kotlin/app/spammy/hof/automation/controller/AutomationProfileControllerTest.kt \
  src/test/kotlin/app/spammy/hof/automation/controller/UnifiedAutomationControllerTest.kt \
  src/test/kotlin/app/spammy/hof/battle/controller/BattleCatalogControllerTest.kt \
  src/test/kotlin/app/spammy/hof/battle/controller/BattleLogControllerTest.kt \
  src/test/kotlin/app/spammy/hof/captcha/controller/CaptchaControllerTest.kt \
  src/test/kotlin/app/spammy/hof/party/controller/PartyPresetControllerTest.kt
```

Expected: no matches. If a target gains one of these boundary assertions before implementation, preserve that file and remove it from this deletion batch.

- [ ] **Step 2: Delete the six exact files**

Apply an exact deletion patch for the six files. This removes 401 lines of mock-delegate-verification code. Service tests remain the business-behavior owner; API security tests remain the authentication, validation, and serialization owner; app `backendApi.test.ts` remains the client endpoint/discriminant owner.

- [ ] **Step 3: Compile tests and run every retained controller test**

```bash
./gradlew compileTestKotlin --console=plain
./gradlew test --tests '*AuthApiSecurityTest' \
  --tests '*AutomationJobControllerTest' \
  --tests '*UnifiedAutomationApiSecurityTest' \
  --tests '*BattleRunControllerTest' \
  --tests '*CharacterControllerLegacyEndpointTest' \
  --tests '*QuestApiSecurityTest' \
  --tests '*QuestControllerTest' \
  --console=plain
```

Expected: test compilation succeeds and all retained controller/security tests pass.

- [ ] **Step 4: Run the fast suite and commit**

```bash
./gradlew fastTest --console=plain
git diff --check
git add src/test/kotlin
git commit -m "test: remove duplicated backend happy paths"
```

### Task 6: Verify backend reduction and record metrics

**Files:**
- Modify in app repository: `../hof_app/docs/superpowers/specs/2026-07-19-test-suite-simplification-design.md`

- [ ] **Step 1: Run fresh verification**

```bash
/usr/bin/time -p ./gradlew fastTest --console=plain
/usr/bin/time -p ./gradlew cleanTest test --console=plain
find src/test/kotlin -name '*Test.kt' -type f | wc -l
find src/test/kotlin -name '*Test.kt' -type f -exec wc -l {} + | tail -1
rg -n '^\s*@Test' src/test/kotlin -g '*Test.kt' | wc -l
git diff master...HEAD -- src/main
```

Expected: `fastTest` passes; full suite either passes or reports a clearly captured infrastructure failure with zero assertion failures before the worker failure; test lines are materially below 18,337; production-source diff is empty.

- [ ] **Step 2: Append backend and combined measured results**

In the app design document, record backend fast/full durations, file/case/line counts, combined percentage reduction, and any unmet target with its preservation rationale.

- [ ] **Step 3: Commit backend and app documentation state**

```bash
git status --short
```

Commit any remaining backend-only changes in `hof_backend`. Commit the measured-results documentation separately in `hof_app` with message `docs: record combined test reduction`.
