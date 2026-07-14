import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const homeSource = readFileSync(resolve(process.cwd(), 'src/main/screens/HomeTabScreen.tsx'), 'utf8');
const controllerSource = readFileSync(
  resolve(process.cwd(), 'src/main/domain/unifiedAutomationController.ts'),
  'utf8',
);
const settingsSource = readFileSync(
  resolve(process.cwd(), 'src/main/features/automation/components/UnifiedAutomationSettings.tsx'),
  'utf8',
);
const appSource = readFileSync(resolve(process.cwd(), 'src/main/App.tsx'), 'utf8');
const entrySource = readFileSync(resolve(process.cwd(), 'index.ts'), 'utf8');
const dashboardSource = readFileSync(
  resolve(process.cwd(), 'src/main/features/automation/components/UnifiedAutomationDashboard.tsx'),
  'utf8',
);
const editorSource = readFileSync(
  resolve(process.cwd(), 'src/main/features/automation/components/UnifiedAutomationModuleEditor.tsx'),
  'utf8',
);

describe('통합 자동화 홈 화면', () => {
  it('한 계정의 자동화를 상태 대시보드와 설정 화면으로 나눈다', () => {
    assert.match(homeSource, /통합 자동화/);
    assert.match(dashboardSource, /현재 작업/);
    assert.match(homeSource, /자동화 설정/);
    assert.match(homeSource, /UnifiedAutomationDashboard/);
    assert.match(homeSource, /UnifiedAutomationSettings/);
    assert.doesNotMatch(homeSource, /buildDefaultUnifiedAutomationSettings/);
  });

  it('고정 모듈을 만들지 않고 서버가 반환한 동적 모듈 목록을 사용한다', () => {
    assert.match(homeSource, /automation\.modules/);
    assert.match(settingsSource, /UnifiedAutomationModuleResponse\[\]/);
    assert.doesNotMatch(settingsSource, /const MODULES/);
    assert.doesNotMatch(settingsSource, /union|유니온/i);
  });

  it('앱 수명주기 컨트롤러의 CRUD와 전체 순서 변경을 화면에 연결한다', () => {
    assert.match(appSource, /new UnifiedAutomationController/);
    assert.match(homeSource, /automationController\.createModule/);
    assert.match(homeSource, /automationController\.updateModule/);
    assert.match(homeSource, /automationController\.deleteModule/);
    assert.match(homeSource, /automationController\.reorderModules/);
    assert.match(homeSource, /useSyncExternalStore/);
    assert.doesNotMatch(homeSource, /onUpdateUnifiedAutomation:/);
  });

  it('앱 진입점과 최상위 화면이 제스처 런타임을 초기화한다', () => {
    assert.equal(entrySource.trimStart().startsWith("import 'react-native-gesture-handler';"), true);
    assert.match(appSource, /GestureHandlerRootView/);
  });

  it('캡차와 파티 설정 대기 상태를 사용자 친화적으로 안내한다', () => {
    assert.match(homeSource, /캡차 인증이 필요해요/);
    assert.match(homeSource, /전투에 사용할 파티를 선택해 주세요/);
  });

  it('화면에 내부 맵 코드나 열쇠 수량 또는 예상 전투 횟수를 노출하지 않는다', () => {
    assert.doesNotMatch(homeSource, /mapCode/);
    assert.doesNotMatch(homeSource, /keyCount/);
    assert.doesNotMatch(homeSource, /몇 회|전투 횟수|예상 전투/);
  });

  it('세부 규칙은 정보 버튼으로 접어 둔다', () => {
    assert.match(homeSource, /accessibilityLabel="자동화 실행 규칙 보기"/);
    assert.match(homeSource, /위에서부터 우선순위대로/);
  });

  it('빈 상태에서 지원 유형을 고르고 같은 유형도 반복 추가할 수 있다', () => {
    assert.match(settingsSource, /자동화 추가/);
    assert.match(settingsSource, /KEY_QUEST/);
    assert.match(settingsSource, /TIME_BURN/);
    assert.match(settingsSource, /COOLDOWN_ADVENTURE/);
    assert.match(settingsSource, /DAILY_ADVENTURE/);
    assert.match(settingsSource, /OTHER_QUEST/);
    assert.doesNotMatch(settingsSource, /filter\([^\n]*moduleType/);
  });

  it('드래그 핸들과 optimistic 순서 저장 큐를 실제 목록에 연결한다', () => {
    assert.match(settingsSource, /NestableDraggableFlatList/);
    assert.match(settingsSource, /GripVertical/);
    assert.match(settingsSource, /onDragEnd/);
    assert.match(controllerSource, /UnifiedAutomationReorderQueue/);
    assert.match(controllerSource, /순서를 저장하지 못해 이전 순서로 되돌렸어요/);
  });

  it('같은 모듈 저장을 조정하고 저장 중인 행 편집을 막는다', () => {
    assert.match(controllerSource, /UnifiedAutomationModuleMutationCoordinator/);
    assert.match(controllerSource, /runExclusive/);
    assert.match(homeSource, /automationController\.isModuleBusy/);
    assert.match(settingsSource, /accessibilityState=\{\{ disabled: saving \}\}/);
    assert.match(settingsSource, /disabled=\{saving\}/);
  });

  it('모듈 편집기에서 이름, 사용 여부, 유형별 맵·프리셋·퀘스트를 저장한다', () => {
    assert.match(editorSource, /AutomationMapSettings/);
    assert.match(editorSource, /파티 프리셋/);
    assert.match(editorSource, /퀘스트 코드/);
    assert.match(editorSource, /Time 기준/);
    assert.match(editorSource, /정말 삭제할까요/);
    assert.match(editorSource, /프리셋 없이도 저장할 수 있지만/);
    assert.match(homeSource, /buildUnifiedModuleRequest/);
    assert.match(homeSource, /buildUpdateUnifiedModuleRequest/);
  });

  it('변경 사항은 현재 작업을 끊지 않고 다음 판단부터 적용된다고 안내한다', () => {
    assert.match(settingsSource, /다음 작업부터 적용/);
    assert.match(editorSource, /다음 작업부터 적용/);
  });
});
