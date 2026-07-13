# Android 직접 FCM 설정

이 앱은 Expo Push Service를 거치지 않고 Android 기기의 FCM 네이티브 토큰을 프로젝트 백엔드에 직접 등록한다.

## 앱 빌드 준비

1. Firebase Console에서 Android 앱 ID `app.spammy.hof`를 등록한다.
2. 내려받은 `google-services.json`을 `hof_app/google-services.json`에 둔다.
3. 실제 기기에 개발 빌드 또는 릴리스 빌드를 설치한다. Expo Go에서는 원격 푸시를 테스트할 수 없다.
4. Android 13 이상에서는 첫 로그인 뒤 표시되는 알림 권한을 허용한다.

`google-services.json`은 저장소에 커밋하지 않는다. CI에서는 보안 파일로 주입해야 한다.

## 서버 준비

Firebase 서비스 계정 JSON은 앱 설정 파일과 다른 비밀 파일이다. Docker 실행 전에 백엔드의
`FIREBASE_SERVICE_ACCOUNT_PATH`가 해당 파일을 가리키도록 설정한다. 서버는 이 자격 증명으로 FCM에 직접 전송한다.

## 동작 확인

- 로그인 뒤 앱이 `/api/push/android/targets`에 설치 ID와 네이티브 토큰을 등록한다.
- 자동화가 캡차 대기에 들어가면 `캡차 인증` 채널로 알림이 온다.
- 알림을 누르면 앱의 캡차 입력 화면이 열리며, 성공 후 서버가 중단된 작업을 자동 재개한다.
