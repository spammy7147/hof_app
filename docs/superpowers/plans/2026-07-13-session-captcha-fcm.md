# Session Recovery, CAPTCHA Resume, and Direct FCM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically restore expired HOF sessions, resume persisted automation after CAPTCHA, and send actionable Android notifications directly through FCM without Expo Push Service.

**Architecture:** A session-recovery executor catches only `HOF_SESSION_EXPIRED`, reuses encrypted credentials through `HofAccountService`, and retries the same action once. CAPTCHA state changes write resume and push-request outbox events in their DB transactions; Kafka consumers perform the external FCM send. The Expo app obtains a native Android device token with `getDevicePushTokenAsync`; the backend stores it and sends through Firebase Admin SDK.

**Tech Stack:** Kotlin/Spring Boot, Firebase Admin Java 9.10.0, Expo SDK 57, `expo-notifications` ~57.0.3, Android FCM, existing CAPTCHA gate

**Repository note:** `hof_backend` is not currently inside a Git repository, while `hof_app` is. Do not create backend repository metadata automatically; use backend tests as checkpoints and commit only app-owned files unless the user authorizes backend Git setup.

---

## File map

- `../hof_backend/src/main/kotlin/app/spammy/hof/account/service/HofAccountService.kt`: stored-account reauthentication.
- `../hof_backend/src/main/kotlin/app/spammy/hof/automation/service/HofSessionRecoveryExecutor.kt`: one retry after fresh login.
- `../hof_backend/src/main/resources/db/migration/V6__add_push_and_captcha_resume.sql`: push targets and action/challenge link.
- `../hof_backend/src/main/kotlin/app/spammy/hof/push/*`: device target registration and Firebase sender.
- `../hof_backend/src/main/kotlin/app/spammy/hof/push/kafka/PushRequestConsumer.kt`: `hof.push.requests` consumer.
- `../hof_backend/src/main/kotlin/app/spammy/hof/captcha/service/CaptchaService.kt`: transactional automation resume hook.
- `app.json`: `expo-notifications` plugin and Android Google services file.
- `src/main/platform/pushNotifications.native.ts`: Android channel, permission, native token, listeners.
- `src/main/platform/pushNotifications.ts`: web/no-native adapter.
- `src/main/features/notifications/useAndroidPushRegistration.ts`: authenticated token registration lifecycle.
- `src/main/features/captcha/useCaptchaGate.ts`: pending challenge reload after notification tap.

### Task 1: Reauthenticate from stored credentials

**Files:**
- Modify: `../hof_backend/src/main/kotlin/app/spammy/hof/account/service/HofAccountService.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/account/service/HofAccountServiceTest.kt`

- [ ] **Step 1: Write a failing stored-account reauthentication test**

```kotlin
@Test
fun `reauthenticate decrypts stored password and replaces cookies`() {
    whenever(accountQueryRepository.findById(account.id)).thenReturn(account)
    whenever(credentialCipher.decrypt(account.encryptedPassword)).thenReturn("stored-password")
    whenever(gateway.execute(requestFactory.home())).thenReturn(homeResponse("PHPSESSID" to "new-home"))
    whenever(gateway.execute(requestFactory.login(account.loginId, "stored-password"), mapOf("PHPSESSID" to "new-home")))
        .thenReturn(loginSuccess("PHPSESSID" to "new-login"))

    service.reauthenticate(account.id)

    verify(cookieRepository).deleteAll(existingCookies)
    verify(cookieRepository).save(check { assertEquals("new-login", it.value) })
}
```

- [ ] **Step 2: Run the test and verify missing method failure**

Run: `cd ../hof_backend && ./gradlew test --tests '*HofAccountServiceTest.reauthenticate*'`

Expected: compilation fails because `reauthenticate` does not exist.

- [ ] **Step 3: Expose account-ID reauthentication and share login logic**

```kotlin
@Transactional
fun reauthenticate(accountId: Long): HofAccountEntity {
    val account = accountQueryRepository.findById(accountId)
        ?: throw ApiException(ErrorCode.RESOURCE_NOT_FOUND, "HOF 계정을 찾지 못했습니다.")
    return loginAccount(account)
}
```

- [ ] **Step 4: Run account service tests**

Run: `cd ../hof_backend && ./gradlew test --tests '*HofAccountServiceTest'`

Expected: PASS and logs contain no password or cookie values.

### Task 2: Retry an automation action once after session recovery

**Files:**
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/service/HofSessionRecoveryExecutor.kt`
- Modify: `../hof_backend/src/main/kotlin/app/spammy/hof/automation/service/AutomationActionExecutor.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/automation/service/HofSessionRecoveryExecutorTest.kt`

- [ ] **Step 1: Write success, credential rejection, and repeated-expiry tests**

```kotlin
@Test
fun `expired action logs in and retries exactly once`() {
    whenever(action()).thenThrow(ApiException(ErrorCode.HOF_SESSION_EXPIRED, "expired")).thenReturn(result)
    assertEquals(result, executor.execute(accountId) { action() })
    verify(accountService).reauthenticate(accountId)
    verify(actionProvider, times(2)).invoke()
}

@Test
fun `credential rejection becomes waiting login`() {
    whenever(action()).thenThrow(ApiException(ErrorCode.HOF_SESSION_EXPIRED, "expired"))
    whenever(accountService.reauthenticate(accountId)).thenThrow(ApiException(ErrorCode.HOF_LOGIN_FAILED, "rejected"))
    val error = assertFailsWith<AutomationBlockedException> { executor.execute(accountId) { action() } }
    assertEquals(AutomationJobStatus.WAITING_LOGIN, error.jobStatus)
}
```

- [ ] **Step 2: Implement selective retry**

```kotlin
fun <T> execute(accountId: Long, action: () -> T): T = try {
    action()
} catch (error: ApiException) {
    if (error.errorCode != ErrorCode.HOF_SESSION_EXPIRED) throw error
    try {
        accountService.reauthenticate(accountId)
    } catch (loginError: ApiException) {
        if (loginError.errorCode == ErrorCode.HOF_LOGIN_FAILED) {
            throw AutomationBlockedException(AutomationJobStatus.WAITING_LOGIN, "HOF 로그인 정보를 확인해 주세요.")
        }
        throw loginError
    }
    action()
}
```

- [ ] **Step 3: Run session recovery tests**

Run: `cd ../hof_backend && ./gradlew test --tests '*HofSessionRecoveryExecutorTest'`

Expected: PASS with exactly two action attempts in the expiration case.

### Task 3: Persist Android push targets and CAPTCHA resume context

**Files:**
- Create: `../hof_backend/src/main/resources/db/migration/V6__add_push_and_captcha_resume.sql`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/push/entity/DevicePushTargetEntity.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/push/repository/DevicePushTargetRepository.kt`
- Modify: `../hof_backend/src/main/kotlin/app/spammy/hof/captcha/entity/CaptchaChallengeEntity.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/push/repository/DevicePushTargetRepositoryTest.kt`

- [ ] **Step 1: Write a failing account-ownership and upsert test**

```kotlin
@Test
fun `same Android installation updates one active target`() {
    service.register(account.id, RegisterAndroidPushTargetRequest("installation-a", "token-a"))
    service.register(account.id, RegisterAndroidPushTargetRequest("installation-a", "token-b"))
    val targets = repository.findActiveByAccountId(account.id)
    assertEquals(1, targets.size)
    assertEquals("token-b", targets.single().targetValue)
}
```

- [ ] **Step 2: Add schema with no credential material in payloads**

```sql
create table device_push_targets (
    id bigint generated by default as identity primary key,
    account_id bigint not null references hof_accounts(id) on delete cascade,
    platform varchar(20) not null,
    target_type varchar(20) not null,
    installation_id varchar(160) not null,
    target_value text not null,
    active boolean not null,
    last_seen_at timestamp with time zone not null,
    created_at timestamp with time zone not null,
    constraint uk_device_push_targets_account_installation unique(account_id, installation_id)
);
alter table captcha_challenges add column automation_action_run_id bigint references automation_action_runs(id) on delete set null;
```

- [ ] **Step 3: Implement token registration DTO and service**

```kotlin
data class RegisterAndroidPushTargetRequest(
    @field:NotBlank val installationId: String,
    @field:NotBlank val nativeToken: String,
)

@Transactional
fun register(accountId: Long, request: RegisterAndroidPushTargetRequest) {
    val current = queryRepository.findOwnedByInstallation(accountId, request.installationId)
    repository.save((current ?: DevicePushTargetEntity.newAndroid(accountId, request.installationId, timeProvider.now())).apply {
        targetType = "TOKEN"
        targetValue = request.nativeToken
        active = true
        lastSeenAt = timeProvider.now()
    })
}
```

- [ ] **Step 4: Run persistence tests**

Run: `cd ../hof_backend && ./gradlew test --tests '*DevicePushTargetRepositoryTest'`

Expected: PASS.

### Task 4: Send direct FCM messages from backend

**Files:**
- Modify: `../hof_backend/build.gradle.kts`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/push/config/FirebaseConfig.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/push/service/AndroidPushService.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/push/kafka/PushRequestEvent.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/push/kafka/PushRequestConsumer.kt`
- Create: `../hof_backend/src/main/kotlin/app/spammy/hof/push/controller/DevicePushController.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/push/service/AndroidPushServiceTest.kt`

- [ ] **Step 1: Add the official Firebase Admin Java dependency**

```kotlin
implementation("com.google.firebase:firebase-admin:9.10.0")
```

- [ ] **Step 2: Initialize Firebase with Application Default Credentials**

```kotlin
@Bean
fun firebaseApp(): FirebaseApp {
    val options = FirebaseOptions.builder()
        .setCredentials(GoogleCredentials.getApplicationDefault())
        .setProjectId(firebaseProperties.projectId)
        .build()
    return FirebaseApp.initializeApp(options)
}
```

- [ ] **Step 3: Write a failing safe-payload test**

```kotlin
@Test
fun `captcha notification contains only routing data`() {
    service.sendCaptchaRequired(accountId, challengeId)
    verify(firebaseMessaging).send(check { message ->
        assertEquals("CAPTCHA_REQUIRED", message.data["type"])
        assertEquals(challengeId.toString(), message.data["challengeId"])
        assertFalse(message.data.containsKey("cookie"))
        assertFalse(message.data.containsKey("password"))
    })
}
```

- [ ] **Step 4: Define the outbox event and Kafka consumer**

```kotlin
data class PushRequestEvent(val eventId: String, val accountId: Long, val type: String, val challengeId: Long?)

@KafkaListener(topics = ["hof.push.requests"], groupId = "hof-push")
fun consume(payload: String) {
    val event = objectMapper.readValue(payload, PushRequestEvent::class.java)
    if (consumedEventRepository.existsById(event.eventId)) return
    when (event.type) {
        "CAPTCHA_REQUIRED" -> androidPushService.sendCaptchaRequired(event.accountId, requireNotNull(event.challengeId))
        "LOGIN_REQUIRED" -> androidPushService.sendLoginRequired(event.accountId)
        else -> throw IllegalArgumentException("지원하지 않는 push type입니다: ${event.type}")
    }
    consumedEventService.record(event.eventId)
}
```

- [ ] **Step 5: Build notification and Android channel payload**

```kotlin
val message = Message.builder()
    .setToken(target.targetValue)
    .setNotification(Notification.builder().setTitle("HOF 인증이 필요합니다").setBody("인증을 완료하면 자동전투가 이어집니다.").build())
    .putData("type", "CAPTCHA_REQUIRED")
    .putData("challengeId", challengeId.toString())
    .setAndroidConfig(AndroidConfig.builder().setNotification(AndroidNotification.builder().setChannelId("automation-alerts").build()).build())
    .build()
firebaseMessaging.send(message)
```

- [ ] **Step 6: Deactivate permanently invalid targets**

```kotlin
catch (error: FirebaseMessagingException) {
    if (error.messagingErrorCode in setOf(MessagingErrorCode.UNREGISTERED, MessagingErrorCode.INVALID_ARGUMENT)) {
        targetService.deactivate(target.id)
    } else {
        throw error
    }
}
```

- [ ] **Step 7: Add an authenticated development-only delivery check**

```kotlin
@PostMapping("/test")
fun sendTest(@CurrentAccountId accountId: Long): ResponseEntity<Void> {
    if (!pushProperties.testEndpointEnabled) throw ApiException(ErrorCode.RESOURCE_NOT_FOUND, "푸시 테스트 기능이 비활성화되어 있습니다.")
    pushService.sendTest(accountId)
    return ResponseEntity.noContent().build()
}
```

`hof.push.test-endpoint-enabled` defaults to `false` and is enabled only in the local development profile.

- [ ] **Step 8: Run push tests**

Run: `cd ../hof_backend && ./gradlew test --tests '*AndroidPushServiceTest' --tests '*DevicePushControllerTest'`

Expected: PASS.

### Task 5: Resume automation transactionally after CAPTCHA answer

**Files:**
- Modify: `../hof_backend/src/main/kotlin/app/spammy/hof/captcha/service/CaptchaService.kt`
- Modify: `../hof_backend/src/main/kotlin/app/spammy/hof/battle/service/BattleRunService.kt`
- Test: `../hof_backend/src/test/kotlin/app/spammy/hof/captcha/service/CaptchaAutomationResumeTest.kt`

- [ ] **Step 1: Write a failing CAPTCHA resume test**

```kotlin
@Test
fun `answered automation challenge marks job running and inserts resume outbox`() {
    val challenge = pendingChallenge(actionRun)
    whenever(gateway.execute(any(), any())).thenReturn(captchaSuccessResponse())
    service.answer(accountId, challenge.id, "1234")
    assertEquals("RUNNING", jobRepository.findById(actionRun.job.id).orElseThrow().status)
    assertTrue(outboxRepository.existsByAccountIdAndReason(accountId, "CAPTCHA_ANSWERED"))
}
```

- [ ] **Step 2: Link the current action when CAPTCHA is detected**

```kotlin
captchaChallenge.automationActionRun = automationActionContext.currentActionOrNull()
automationJobStateService.waitForCaptcha(captchaChallenge.automationActionRun?.job?.id)
pushOutboxService.enqueueCaptchaRequired(account.id, captchaChallenge.id)
```

- [ ] **Step 3: Resume in the successful answer transaction**

```kotlin
challenge.automationActionRun?.job?.let { job ->
    job.status = AutomationJobStatus.RUNNING.name
    job.message = "인증 완료. 자동으로 이어서 실행합니다."
    job.updatedAt = timeProvider.now()
    outboxService.enqueue(job.account.id, "CAPTCHA_ANSWERED")
}
```

- [ ] **Step 4: Run CAPTCHA and automation tests**

Run: `cd ../hof_backend && ./gradlew test --tests '*Captcha*' --tests '*UnifiedAutomationRunnerTest'`

Expected: PASS and an unanswered challenge never enqueues a battle.

### Task 6: Register the native Android FCM token in Expo

**Files:**
- Modify: `package.json`
- Modify: `app.json`
- Modify: `.gitignore`
- Create: `src/main/platform/pushNotifications.native.ts`
- Create: `src/main/platform/pushNotifications.ts`
- Create: `src/main/features/notifications/useAndroidPushRegistration.ts`
- Modify: `src/main/services/backendApi.ts`
- Test: `src/test/platform/pushNotifications.test.ts`
- Test: `src/test/domain/androidPushRegistration.test.ts`

- [ ] **Step 1: Install the Expo 57 notification package**

Run: `npx expo install expo-notifications`

Expected: `package.json` contains `"expo-notifications": "~57.0.3"`.

- [ ] **Step 2: Configure the native plugin and Firebase file**

```json
{
  "expo": {
    "android": { "googleServicesFile": "./google-services.json" },
    "plugins": ["expo-notifications"]
  }
}
```

Add `google-services.json` to `.gitignore`; supply the Firebase project file at build time. Remote push is tested with a development or release build, not Expo Go.

- [ ] **Step 3: Write a failing native registration test around injected notification functions**

```typescript
test('creates the channel before requesting the native device token', async () => {
  const calls: string[] = [];
  const token = await registerAndroidPushTarget({
    createChannel: async () => { calls.push('channel'); },
    requestPermission: async () => { calls.push('permission'); return true; },
    getNativeToken: async () => { calls.push('token'); return 'native-fcm-token'; },
  });
  assert.deepEqual(calls, ['channel', 'permission', 'token']);
  assert.equal(token, 'native-fcm-token');
});
```

- [ ] **Step 4: Implement Android channel, permission, and native token acquisition**

```typescript
export async function getAndroidNativePushToken(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  await Notifications.setNotificationChannelAsync('automation-alerts', {
    name: '자동전투 알림',
    importance: Notifications.AndroidImportance.HIGH,
  });
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return null;
  const token = await Notifications.getDevicePushTokenAsync();
  return typeof token.data === 'string' ? token.data : null;
}
```

- [ ] **Step 5: Register token rotation and notification taps**

```typescript
const tokenSubscription = Notifications.addPushTokenListener(({ data }) => {
  if (typeof data === 'string') void backendApi.registerAndroidPushTarget(installationId, data);
});
const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
  const data = response.notification.request.content.data;
  if (data.type === 'CAPTCHA_REQUIRED') onCaptchaRequired(String(data.challengeId));
});
return () => { tokenSubscription.remove(); responseSubscription.remove(); };
```

- [ ] **Step 6: Run app tests and typecheck**

Run: `npm test && npm run typecheck`

Expected: all tests pass and TypeScript reports no errors.

- [ ] **Step 7: Commit the Android notification client**

```bash
git add package.json package-lock.json app.json .gitignore src/main/platform/pushNotifications.native.ts src/main/platform/pushNotifications.ts src/main/features/notifications/useAndroidPushRegistration.ts src/main/services/backendApi.ts src/test/platform/pushNotifications.test.ts src/test/domain/androidPushRegistration.test.ts
git commit -m "feat: register Android FCM notifications"
```

### Task 7: Verify direct FCM on Android

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Build an Android development client**

Run: `npx expo run:android`

Expected: the HOF app, not Expo Go, installs on the emulator or physical Android device.

- [ ] **Step 2: Verify registration**

Run:

```bash
ACCESS_TOKEN=$(curl -fsS -X POST -H 'Content-Type: application/json' \
  -d "{\"loginId\":\"$HOF_LOGIN_ID\",\"password\":\"$HOF_PASSWORD\",\"clientType\":\"NATIVE\"}" \
  http://localhost:8080/api/auth/login | jq -r '.accessToken')
curl -fsS -H "Authorization: Bearer $ACCESS_TOKEN" http://localhost:8080/api/push/android/targets
```

Expected: one active Android `TOKEN` target for the test installation. The shell token is a short-lived development credential and must not be committed.

- [ ] **Step 3: Trigger a CAPTCHA test event**

Run: `curl -fsS -X POST -H "Authorization: Bearer $ACCESS_TOKEN" http://localhost:8080/api/push/android/test`

Expected: Android displays the `자동전투 알림` channel notification; tapping it opens the existing CAPTCHA gate.

- [ ] **Step 4: Document the Expo limitation and direct path**

```markdown
## Android 푸시 테스트

앱은 `getDevicePushTokenAsync`로 native FCM token을 받아 자체 backend에 등록한다. Expo Push Token과 Expo Push Service는 사용하지 않는다. Expo SDK 57의 Android remote push는 Expo Go에서 동작하지 않으므로 `npx expo run:android` 개발 빌드나 release 빌드에서 테스트한다.
```
