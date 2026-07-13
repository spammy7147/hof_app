# 계정별 통합 자동화 설계

작성일: 2026-07-13

## 1. 목표

HOF 계정마다 하나의 통합 자동화를 상시 실행한다. 앱이 닫히거나 Android 기기가 꺼져 있어도 백엔드가 전투를 계속하며, 백엔드 또는 Kafka가 재시작되더라도 DB에 저장된 진행 상태에서 자동으로 복구한다.

한 계정 안에서는 모든 HOF 전투 API를 한 번에 하나씩만 호출한다. 서로 다른 계정은 병렬로 처리할 수 있다. 메시지 재전달이나 장애 시 마지막 전투가 중복 실행되는 at-least-once 동작은 허용한다.

자동화는 다음 조건에서만 멈춘다.

- 사용자가 일시정지하거나 종료한다.
- CAPTCHA가 필요해 사용자의 입력을 기다린다.
- 실행에 필요한 맵 또는 파티 설정이 없어 사용자 조치가 필요하다.
- 저장된 HOF 로그인 정보가 없거나 잘못되어 자동 재로그인에 명시적으로 실패한다.

실행할 작업이 없거나 다음 쿨다운까지 시간이 남은 경우에는 종료하지 않고 DB에 다음 확인 시각을 저장한 채 대기한다.

## 2. 범위

이번 통합 자동화에 포함한다.

- 우선 키 퀘스트 수락, 진행, 완료 보상 수령
- Time 초과 방지를 위한 일반맵 실행
- 쿨다운 모험맵
- 일일 승리 또는 시도 제한 모험맵
- 출현 여부와 공유 HP를 확인하는 유니온
- CAPTCHA 대기, Android 알림, 인증 성공 후 자동 재개
- 서버와 Kafka 재시작 복구
- 상태 중심 홈 화면과 단계적으로 펼치는 설정 화면

레이드 자동화와 CAPTCHA 자동 풀이는 포함하지 않는다.

## 3. 사용자 경험

### 3.1 홈 화면

홈은 설정값 전체가 아니라 현재 자동화 상태를 우선 표시한다.

- 통합 자동화 상태: 실행 중, 대기 중, 인증 필요, 설정 필요, 일시정지
- 현재 작업: 모듈 이름, 퀘스트 또는 맵 이름, 현재 처리 단계
- 다음 확인: 다음 쿨다운 또는 재확인 시각
- 자동화 항목별 한 줄 요약
- 최근 활동: 최근 전투, 퀘스트 재확인, 보상 수령
- 일시정지와 자동화 설정 진입 버튼

맵 코드는 화면에 노출하지 않고 맵 이름만 표시한다. CAPTCHA나 설정 오류처럼 사용자가 행동해야 할 때만 상단 안내를 표시한다.

### 3.2 통합 설정 화면

설정은 점진적으로 공개한다.

1. 첫 화면에서는 모듈별 사용 여부와 현재 설정 요약만 보여준다.
2. 사용자가 `설정`을 누른 모듈의 세부 값만 별도 화면에서 보여준다.
3. 장애 재시도와 인증 후 재개 같은 기본 동작은 `고급 설정`에 접어 둔다.

첫 화면의 그룹은 다음과 같다.

- 항상 먼저 확인: 키 퀘스트
- 상황에 맞춰 실행: Time 관리, 쿨다운 모험맵, 일일 모험맵, 유니온
- 알림: 인증이 필요할 때 Android 알림

우선순위 번호나 Kafka, 재시도 횟수 같은 내부 구현은 일반 설정 화면에 노출하지 않는다.

### 3.3 설정 오류

프리셋이 없는 상태를 평상시 규칙 설명에 표시하지 않는다. 실제로 실행하려는 맵의 프리셋이 없을 때만 해당 설정 행과 홈 상단에 다음처럼 안내한다.

> 전투에 사용할 파티를 선택해 주세요.

해당 계정의 자동화는 `WAITING_CONFIG`로 전환하고 Android 알림을 한 번 보낸다. 설정을 저장하면 같은 job을 자동으로 다시 깨운다.

## 4. 통합 오케스트레이터

### 4.1 계정별 단일 job

계정마다 활성 통합 job은 최대 하나다. 기존 `AutomationProfileEntity`는 `UNIFIED` 모드 프로필을 저장하며, 프로필 안에 여러 자동화 모듈 설정을 둔다. 여러 독립 job을 동시에 실행하는 대신 모듈들이 한 오케스트레이터의 우선순위 판단에 참여한다.

서로 다른 계정은 Kafka 파티션과 consumer worker를 통해 병렬로 실행한다. 같은 계정의 이벤트는 항상 `accountId`를 Kafka key로 사용한다.

### 4.2 작업 선택 순서

오케스트레이터는 한 번 깨어날 때 현재 HOF 상태와 DB 설정을 동기화한 뒤 아래 순서에서 실행 가능한 첫 작업 하나만 선택한다. 작업 하나를 마친 뒤에는 처음부터 다시 평가한다.

1. 완료 가능한 모든 퀘스트 보상 수령
2. 수락 가능한 우선 키 퀘스트 수락
3. 진행 중인 우선 키 퀘스트 전투
4. Time 비율이 기준치를 초과하면 일반맵 전투
5. 현재 출현했고 HP가 남은 유니온 전투
6. 쿨다운이 끝난 모험맵 전투
7. 오늘 완료하지 않은 일일 제한 모험맵 전투
8. 사용자가 선택한 일반 퀘스트 수락, 진행, 보상 수령
9. 실행 가능한 작업이 없으면 가장 가까운 재확인 시각까지 대기

유니온은 언제 사라질지 모르므로 Time 초과 처리 다음, 일반 모험맵보다 먼저 둔다. 이 순서는 설정 화면에서 사용자가 직접 재정렬하지 않는다.

### 4.3 한 번에 하나의 외부 호출

한 action은 다음 중 하나다.

- 퀘스트 페이지 동기화
- 퀘스트 수락
- 퀘스트 완료 보상 수령
- 맵 상태 동기화
- 전투 API 1회 호출
- 유니온 출현 상태 동기화

action 시작 전 `automation_action_runs`에 요청 스냅샷을 저장하고, 완료 후 결과와 다음 checkpoint를 저장한다. 프로세스 메모리의 반복 횟수에 의존하지 않는다.

Kafka key 순서만으로 계정 단위 상호 배제를 보장하지 않는다. DB의 `account_automation_leases` 행을 함께 사용해 같은 계정의 worker가 겹치지 않게 한다. lease가 만료되면 다른 worker가 이어받는다.

## 5. 퀘스트 자동화

### 5.1 상태의 원천

`http://sic.zerosic.com/ZeroHOF/index.php?menu=quest` 응답을 퀘스트 상태의 원천으로 사용한다. 로컬에서 고정 전투 횟수를 차감해 완료를 추측하지 않는다.

파서는 퀘스트를 다음 상태로 정규화한다.

- `AVAILABLE`: 수락 가능
- `ACTIVE`: 진행 중이며 현재 값과 목표 값이 있음
- `CLAIMABLE`: 완료 보상 수령 가능
- `COMPLETED`: 이미 완료됨
- `UNAVAILABLE`: 현재 수락하거나 진행할 수 없음

각 전투 후 퀘스트 페이지를 다시 읽는다. 따라서 희귀 몬스터가 한 번에 많이 나오거나 40회 이상 전투가 필요한 경우에도 같은 흐름으로 처리된다.

### 5.2 공통 흐름

1. 퀘스트 페이지를 동기화한다.
2. `CLAIMABLE` 퀘스트는 선택 여부와 관계없이 보상을 수령한다.
3. 우선 키 퀘스트 또는 사용자가 자동화 대상으로 선택한 퀘스트가 `AVAILABLE`이면 수락한다.
4. `ACTIVE`이면 해당 퀘스트의 맵 선택 규칙으로 전투 action 하나를 실행한다.
5. 퀘스트 페이지를 다시 동기화한다.
6. `CLAIMABLE`이 될 때까지 오케스트레이터가 재평가를 반복한다.

### 5.3 우선 키 퀘스트

다음 네 퀘스트는 항상 일반 퀘스트보다 먼저 수락하고 완료한다.

- `0563`
- `0571`
- `0171`
- `0351`

퀘스트 ID는 내부 식별에만 사용한다. 앱에는 퀘스트 이름을 표시한다.

`0171`을 포함해 서버에 기본 맵 조합이 없는 우선 퀘스트는 우선 대상에는 포함하되, 사용자가 앱에서 맵과 파티를 지정하기 전에는 전투하지 않는다. 필요한 설정이 없으면 `WAITING_CONFIG`로 전환한다.

### 5.4 저택 서관 열쇠 수집

- 내부 퀘스트 ID: `0571`
- 대상 몬스터: `Killer Maid`
- 내부 맵: `Noble201`
- 화면 이름: 저택 서관 관련 맵 이름
- 파티: 카발 패턴 2, 사제2 패턴 3, 낫망네크 패턴 3
- 전투 요청 방식: 현재 HOF 맵이 지원하는 묶음 전투를 사용

표시상 총 전투 횟수는 제공하지 않는다. 전투 후 퀘스트 페이지를 다시 확인한다.

### 5.5 저택 동관 열쇠 수집

- 내부 퀘스트 ID: `0563`
- 대상 몬스터: `Key Keeper`
- 후보 맵
  - `Noble1021`: 저택 동관(보쉬의 방)
  - `Noble1022`: 저택 동관(하인켈의 방)
  - `Noble1023`: 저택 동관(커티스의 방)
  - `Noble102`: 저택 동관(복도)

맵 코드는 앱에서 숨긴다. 사용자는 맵 이름과 연결된 파티 프리셋만 본다.

선택 규칙:

- 정확히 한 맵을 선택하면 그 맵을 고정 실행한다.
- 고정 맵에 필요한 키가 없으면 저택 동관(복도)로 자동 대체한다.
- 키를 사용하는 맵을 여러 개 선택하면 선택된 맵들의 남은 키 수가 균형을 이루도록 가장 많은 키를 가진 맵을 우선 실행한다. 키를 소비한 뒤에는 상태를 다시 동기화한다.
- 여러 맵 선택에 저택 동관(복도)이 포함되어 있으면, 선택된 키 맵을 실행할 수 없을 때 복도를 사용한다.
- 저택 동관(복도)이 선택되지 않았더라도 고정 키 맵의 키가 없을 때는 안전한 기본 대체 맵으로 복도를 사용할 수 있다.
- 후보가 동률이면 사용자가 설정한 맵 순서로 선택해 실행 결과를 예측 가능하게 한다.
- 전투 횟수 제한을 두지 않고 퀘스트 페이지가 `CLAIMABLE` 또는 `COMPLETED`가 될 때까지 반복한다.

현재 선택 규칙은 제목 옆 `!` 버튼을 눌렀을 때만 팝업으로 보여준다. 내부 키 개수는 사용자 화면에 표시하지 않는다.

### 5.6 마을 지하 수로 퀘스트

- 내부 퀘스트 ID: `0351`
- 화면 이름: Culvert- 마을 지하 수로(입구)
- 미션 의미: 10회 승리

10회라는 값은 설명과 파싱 검증에 사용할 수 있지만 완료 판단은 퀘스트 페이지 상태를 따른다.

## 6. Time과 맵 모듈

### 6.1 Time 관리

기본 기준은 최대 Time의 90%다. `timeCurrent / timeMax > threshold`이면 설정된 일반맵 중 실행 가능한 맵으로 전투 action 하나를 실행한다. 전투 후 상태를 다시 동기화하고 비율이 기준 이하가 될 때까지 재평가한다.

사용자는 다음 값만 설정한다.

- 모듈 사용 여부
- 실행 기준 비율
- 사용할 일반맵
- 맵별 파티 프리셋

### 6.2 쿨다운 모험맵

쿨다운이 끝난 선택 맵 중 실행 가능한 맵을 실행한다. 여러 맵이 동시에 준비되면 가장 오래 기다린 맵, 설정 순서 순으로 선택한다. 전투 후 새 `cooldownUntil`을 저장한다.

### 6.3 일일 제한 모험맵

`winRemaining`, `attemptRemaining`, `availableCount`와 퀘스트 또는 맵 페이지 상태를 함께 확인한다. 하루 중 실행되기만 하면 되므로 쿨다운 맵 다음에 처리한다. 남은 승리 횟수 또는 시도 횟수가 0이면 다음 일일 초기화 시각까지 대기한다.

### 6.4 유니온

유니온 목록을 동기화해 출현 여부와 공유 HP를 확인한다. 대상이 없거나 HP가 0이면 전투하지 않는다. 전투 직전에도 한 번 더 상태를 확인하고, 이미 종료된 경우 정상적인 skip으로 기록한다.

## 7. CAPTCHA와 자동 재개

기존 `CaptchaService`와 전역 CAPTCHA 모달을 재사용한다.

1. 전투 응답에서 CAPTCHA를 발견한다.
2. challenge와 중단된 `automation_action_run_id`를 DB에 저장한다.
3. job을 `WAITING_CAPTCHA`로 변경한다.
4. 등록된 Android 기기에 직접 FCM data/notification 메시지를 보낸다.
5. 사용자가 앱에서 CAPTCHA 답안을 제출한다.
6. 인증 성공 트랜잭션에서 job을 `RUNNING`으로 되돌리고 resume event를 Kafka에 발행할 outbox row를 만든다.
7. worker는 중단된 action을 다시 실행하고, 완료 후 평상시 우선순위 평가로 돌아간다.

앱이 닫혀 있어도 challenge와 job은 DB에 남는다. 중단된 전투가 HOF에서 일부 처리되었는지 확정할 수 없으면 같은 action을 다시 실행할 수 있다. 사용자가 허용한 at-least-once 정책에 따라 이 중복 가능성을 수용한다.

Android 알림에는 계정 표시명, `인증이 필요합니다`, challenge 식별자만 포함한다. HOF 쿠키, CAPTCHA 답안, 파티 정보는 넣지 않는다. 알림을 누르면 앱의 CAPTCHA 화면으로 이동한다.

### 7.1 HOF 세션 만료 자동 복구

HOF 쿠키가 없거나 HOF 응답이 로그인 화면으로 돌아오면 사용자에게 바로 재로그인을 요구하지 않는다. `HofAccountEntity`에 암호화되어 저장된 ID와 비밀번호로 자동 재로그인한 뒤 새 쿠키를 DB에 저장하고, 중단된 action을 한 번 다시 실행한다.

자동 재로그인은 계정 lease 안에서 수행해 같은 계정이 동시에 여러 로그인 요청을 보내지 않게 한다. `HofAccountService`는 사용자 입력을 받는 `authenticate`와 별도로 저장된 계정 ID로 재인증하는 진입점을 제공하고, 두 흐름은 실제 HOF 로그인 및 쿠키 교체 로직을 공유한다.

- 자동 로그인 성공: job을 `RUNNING`으로 유지하고 같은 action을 재시도
- HOF 서버 또는 네트워크의 일시적 실패: job을 종료하지 않고 backoff 후 자동 로그인 재시도
- 저장된 비밀번호가 HOF에서 명시적으로 거절됨: `WAITING_LOGIN`으로 전환하고 로그인 정보 확인 알림 발송
- 새 쿠키로 로그인에 성공했지만 action이 다시 즉시 세션 만료됨: 일시적 세션 오류로 기록하고 backoff 후 다시 평가

로그인 ID, 복호화된 비밀번호와 쿠키 값은 action 기록, Kafka 메시지, FCM 알림과 일반 로그에 남기지 않는다. 사용자가 앱에서 HOF 로그인 정보를 갱신하면 `WAITING_LOGIN` job을 자동으로 깨운다.

## 8. Kafka와 장애 복구

### 8.1 역할

DB가 job과 설정의 source of truth이고 Kafka는 실행할 계정을 깨우는 역할만 한다. Kafka 메시지 자체에 전체 진행 상태를 의존하지 않는다.

토픽:

- `hof.automation.wakeup`: 실행 또는 재평가할 계정
- `hof.automation.events`: 상태 변경과 활동 기록
- `hof.push.requests`: Android 알림 발송 요청

모든 자동화 메시지는 `accountId`를 key로 사용한다. consumer는 수동 commit으로 action과 checkpoint의 DB commit이 끝난 뒤 offset을 commit한다.

### 8.2 Transactional outbox

job 상태 변경과 Kafka 발행 사이의 유실을 막기 위해 `automation_outbox`를 사용한다. 서비스 트랜잭션은 상태 변경과 outbox insert를 함께 commit한다. publisher가 미발행 row를 Kafka로 전송하고 발행 시각을 기록한다. 중복 발행은 허용하며 consumer가 event ID를 기록해 이미 완료된 상태 전이를 다시 적용하지 않는다.

### 8.3 시작 시 복구

백엔드 시작 시 recovery service가 다음을 수행한다.

- `PENDING`, `RUNNING` job: lease가 만료된 것을 확인하고 즉시 wakeup outbox 생성
- `WAITING_CAPTCHA`: 자동 실행하지 않고 pending challenge를 유지
- `WAITING_CONFIG`: 설정이 보완되었는지 확인한 뒤 wakeup
- `PAUSED`: 사용자가 재개할 때까지 유지
- 미래 `nextRunAt`이 있는 job: scheduler가 해당 시각 이후 wakeup 생성

Kafka가 비어 있어도 DB 스캔으로 실행을 복구할 수 있다. Kafka나 backend가 재시작되어 같은 wakeup이 여러 번 도착해도 계정 lease와 action 상태로 동시에 실행되지 않는다.

## 9. 상태와 데이터 모델

### 9.1 Job 상태

- `PENDING`: 최초 실행 대기
- `RUNNING`: 실행 또는 다음 작업 평가 가능
- `WAITING_CAPTCHA`: 사용자 인증 대기
- `WAITING_CONFIG`: 맵 또는 파티 설정 대기
- `WAITING_LOGIN`: 저장된 자격 증명이 HOF에서 거절되어 사용자 확인 대기
- `PAUSED`: 사용자 일시정지
- `CANCELLED`: 사용자 종료

상시 통합 자동화는 작업이 없다는 이유로 `COMPLETED`가 되지 않는다.

### 9.2 테이블 변경

기존 테이블을 확장한다.

- `automation_profiles`
  - 계정별 `UNIFIED` 프로필 하나
- `automation_profile_maps`
  - 모듈과 용도 구분 필드 추가
  - 맵별 파티 프리셋과 사용자 선택 순서 유지
- `automation_jobs`
  - `current_module`, `current_action`, `next_run_at`, `last_heartbeat_at`, `version`
- `captcha_challenges`
  - 중단된 `automation_action_run_id` 연결

새 테이블:

- `automation_module_configs`: 모듈별 enabled와 설정 JSON
- `automation_action_runs`: 외부 호출 스냅샷, 결과, 상태, 시도 횟수
- `account_automation_leases`: 계정별 worker lease
- `automation_outbox`: Kafka 발행 보장
- `automation_consumed_events`: consumer 중복 처리 방지
- `device_push_tokens`: 계정별 Android FCM token과 마지막 사용 시각

모듈별 JSON은 REST DTO에서 타입별 검증을 거치며 임의 문자열을 실행 요청으로 사용하지 않는다.

## 10. API

기존 automation API를 통합 프로필 중심으로 확장한다.

- `GET /api/automation/unified`: 설정과 현재 job 요약
- `PUT /api/automation/unified`: 전체 설정 저장
- `POST /api/automation/unified/start`: 통합 job 시작
- `POST /api/automation/unified/pause`: 일시정지
- `POST /api/automation/unified/resume`: 재개
- `POST /api/automation/unified/stop`: 종료
- `GET /api/automation/unified/activity`: 최근 activity 조회
- `POST /api/push/android/tokens`: FCM token 등록 또는 갱신
- `DELETE /api/push/android/tokens/{tokenId}`: 기기 token 해제

CAPTCHA 답안 성공 응답은 앱 콜백에만 의존하지 않고 서버에서 resume outbox를 생성한다.

## 11. Android 직접 FCM

Expo Push Service를 사용하지 않는다. Android 앱은 Firebase 프로젝트의 native 설정으로 FCM registration token을 얻어 인증된 백엔드에 등록한다. 백엔드는 Firebase service account 자격 증명으로 FCM HTTP v1 API를 직접 호출한다.

앱 실행 여부와 관계없이 알림을 받을 수 있게 Android notification channel을 만든다. token rotation 시 백엔드 값을 갱신하고, FCM의 영구적인 invalid-token 응답은 해당 token을 비활성화한다.

Firebase service account JSON은 이미지나 저장소에 포함하지 않고 Docker secret 또는 읽기 전용 volume으로 주입한다.

## 12. Docker 운영

프로젝트 서버의 Docker Compose는 다음 서비스를 운영한다.

- `hof-backend`
- `postgres`
- `kafka` 단일 노드 KRaft

PostgreSQL과 Kafka 데이터는 named volume에 저장한다. backend는 stateless하게 재시작할 수 있으며 CAPTCHA 이미지 임시 저장소가 필요한 동안에는 별도 volume을 사용한다.

헬스체크는 backend readiness, PostgreSQL 연결, Kafka broker 상태를 구분한다. Kafka가 잠시 중단되어도 API의 설정 저장과 job 상태 저장은 가능하고 outbox가 연결 복구 후 메시지를 발행한다.

## 13. 오류 처리

- CAPTCHA: `WAITING_CAPTCHA`, FCM 알림, 인증 성공 후 자동 재개
- 프리셋 누락: `WAITING_CONFIG`, 실제 오류가 발생한 위치에만 안내
- HOF 세션 만료 또는 쿠키 없음: 저장된 자격 증명으로 자동 로그인하고 같은 action 재시도
- HOF 자격 증명 거절: `WAITING_LOGIN`, 로그인 정보 확인 알림
- 일시적인 HOF 또는 네트워크 오류: 제한된 지수 backoff 후 재시도
- 쿨다운, 키 없음, 남은 횟수 0, 유니온 종료: 실패가 아니라 skip과 다음 확인 시각으로 기록
- 파싱 불가: 원본 식별 정보와 parser version을 activity에 남기고 해당 모듈만 backoff
- backend 종료 중인 action: lease 만료 후 at-least-once 재실행

연속 실패가 있어도 job 자체를 자동으로 `CANCELLED`로 만들지 않는다. 재시도 간격을 늘리고 사용자 조치가 필요한 오류만 대기 상태와 알림으로 전환한다.

## 14. 테스트 전략

### 14.1 백엔드 단위 테스트

- 퀘스트 HTML을 다섯 상태로 파싱
- claim, accept, active battle의 우선순위 선택
- Time 90% 경계값과 재평가
- `0563` 단일 맵 고정, 다중 맵 균형, 복도 fallback, 동률 순서
- 쿨다운, 일일 제한, 유니온 skip과 nextRunAt
- missing preset과 session expired 상태 전이
- CAPTCHA action 연결과 인증 성공 resume outbox
- 세션 만료 감지 후 저장된 자격 증명으로 로그인, 쿠키 교체, 동일 action 재시도
- 자동 로그인 중 일시적 실패와 자격 증명 거절의 상태 분리
- 계정 lease 획득, 갱신, 만료 인계
- outbox 중복 발행과 consumer 중복 방지

### 14.2 백엔드 통합 테스트

- 서로 다른 계정은 병렬, 같은 계정은 순차 실행
- backend 재시작 후 `RUNNING` job 복구
- Kafka 재시작 후 outbox 재발행
- `WAITING_CAPTCHA`는 재시작 후 전투하지 않음
- 설정 저장 후 `WAITING_CONFIG` job 자동 재개
- 세션 만료 후 앱 조작 없이 자동 로그인하고 action 재개
- 로그인 정보 갱신 후 `WAITING_LOGIN` job 자동 재개
- PostgreSQL migration과 유일 제약 검증

### 14.3 앱 테스트

- 홈에서 현재 작업과 다음 확인을 표시
- 설정 첫 화면에는 모듈 요약만 표시
- 모듈 설정을 눌렀을 때만 상세 화면 표시
- 맵 이름만 표시하고 내부 코드와 키 개수를 숨김
- 선택 규칙 `!` 팝업
- 실제 프리셋 오류가 있을 때만 사용자 친화적 문구 표시
- FCM 알림을 눌렀을 때 CAPTCHA 화면으로 이동
- CAPTCHA 성공 후 앱을 닫아도 서버 job이 재개됨

### 14.4 Docker 검증

- Compose 전체 기동과 healthcheck
- backend 강제 재시작 후 job 복구
- Kafka 강제 재시작 중 outbox 적재와 복구 후 발행
- PostgreSQL과 Kafka volume 재생성 없이 컨테이너 교체

## 15. 구현 단계 분할

구현은 다음 순서로 나눈다.

1. PostgreSQL migration과 통합 설정/상태 API
2. 퀘스트 파서와 키 퀘스트 모듈
3. Time, 쿨다운, 일일, 유니온 선택기
4. 계정 lease 기반 동기 실행기와 action checkpoint
5. Kafka KRaft, outbox, recovery scheduler
6. HOF 자동 재로그인, CAPTCHA 자동 재개와 Android 직접 FCM
7. 상태 중심 홈과 단계형 설정 화면
8. Docker Compose와 장애 복구 검증

각 단계는 앞 단계의 저장 모델과 API를 사용하지만 모듈별로 독립 테스트가 가능해야 한다.

## 16. 완료 조건

- 앱을 종료해도 백엔드가 자동화를 계속한다.
- 같은 계정의 전투 API가 겹치지 않는다.
- 다른 계정은 병렬로 처리된다.
- backend 또는 Kafka 재시작 후 활성 job이 DB에서 복구된다.
- CAPTCHA가 발생하면 Android 알림이 오고, 답안 성공 후 같은 자동화가 자동 재개된다.
- HOF 세션이 만료되면 저장된 로그인 정보로 자동 로그인하고 중단된 action을 이어간다.
- 퀘스트 완료는 고정 전투 횟수가 아니라 quest 페이지 상태로 판단한다.
- 통합 자동화 화면은 상태 중심이며 세부 설정은 사용자가 들어갔을 때만 보인다.
- 사용자가 멈추거나 조치가 필요한 대기 상태가 아닌 한 서버 장애 때문에 job이 종료되지 않는다.
