import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const homeSource = readFileSync(resolve(process.cwd(), 'src/main/screens/HomeTabScreen.tsx'), 'utf8');
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

  it('새 모듈 CRUD와 전체 순서 변경 callback을 화면 계층에 연결한다', () => {
    assert.match(homeSource, /onCreateUnifiedAutomationModule/);
    assert.match(homeSource, /onUpdateUnifiedAutomationModule/);
    assert.match(homeSource, /onDeleteUnifiedAutomationModule/);
    assert.match(homeSource, /onReorderUnifiedAutomationModules/);
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
});
