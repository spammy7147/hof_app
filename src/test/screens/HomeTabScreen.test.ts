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
const addSheetSource = readFileSync(
  resolve(process.cwd(), 'src/main/features/automation/components/AutomationAddSheet.tsx'),
  'utf8',
);
const appSource = readFileSync(resolve(process.cwd(), 'src/main/App.tsx'), 'utf8');
const appProvidersSource = readFileSync(resolve(process.cwd(), 'src/main/components/AppProviders.tsx'), 'utf8');
const entrySource = readFileSync(resolve(process.cwd(), 'index.ts'), 'utf8');
const dashboardSource = readFileSync(
  resolve(process.cwd(), 'src/main/features/automation/components/UnifiedAutomationDashboard.tsx'),
  'utf8',
);
const questEditorSource = readFileSync(
  resolve(process.cwd(), 'src/main/features/automation/components/QuestAutomationEditor.tsx'),
  'utf8',
);
const battleEditorSource = readFileSync(
  resolve(process.cwd(), 'src/main/features/automation/components/BattleMapAutomationEditor.tsx'),
  'utf8',
);
const adventureEditorSource = readFileSync(
  resolve(process.cwd(), 'src/main/features/automation/components/AdventureMapAutomationEditor.tsx'),
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
    assert.match(homeSource, /aggregate\.entries/);
    assert.match(settingsSource, /TypedAutomationEntryResponse\[\]/);
    assert.doesNotMatch(settingsSource, /const MODULES/);
    assert.doesNotMatch(settingsSource, /union|유니온/i);
  });

  it('앱 수명주기 컨트롤러의 typed CRUD와 전체 순서 변경을 화면에 연결한다', () => {
    assert.match(appSource, /new UnifiedAutomationController/);
    assert.match(homeSource, /automationController\.createEntry/);
    assert.match(homeSource, /automationController\.deleteEntry/);
    assert.match(homeSource, /automationController\.reorderEntries/);
    assert.match(homeSource, /useSyncExternalStore/);
    assert.doesNotMatch(homeSource, /automationController\.createModule/);
    assert.doesNotMatch(homeSource, /onUpdateUnifiedAutomation:/);
  });

  it('앱 진입점과 최상위 화면이 제스처 런타임을 초기화한다', () => {
    assert.equal(entrySource.trimStart().startsWith("import 'react-native-gesture-handler';"), true);
    assert.match(appSource, /AppProviders/);
    assert.match(appProvidersSource, /GestureHandlerRootView/);
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

  it('자동화 추가 단일 trigger와 세 canonical 유형만 보여준다', () => {
    assert.match(settingsSource, /자동화 추가/);
    assert.equal((settingsSource.match(/<AutomationAddSheet/g) ?? []).length, 1);
    assert.match(settingsSource, /hasAllAutomationTypes\(entries\)/);
    assert.match(settingsSource, /accessibilityState=\{\{ disabled: allTypesAdded \}\}/);
    assert.match(addSheetSource, /AUTOMATION_TYPE_ORDER\.map/);
    assert.doesNotMatch(settingsSource, /typeGrid|typeOption|CANONICAL_UNIFIED_MODULE_TYPES/);
    assert.doesNotMatch(homeSource, /moduleType|legacyTypeToTyped/);
    assert.doesNotMatch(controllerSource, /moduleType|legacyTypeToTyped/);
  });

  it('overflow 메뉴에서 상세 설정과 typed 삭제를 제공한다', () => {
    assert.match(settingsSource, /accessibilityLabel=\{`\$\{metadata\.label\} 더 보기`\}/);
    assert.match(settingsSource, />상세 설정</);
    assert.match(settingsSource, />삭제</);
    assert.match(settingsSource, /Alert\.alert/);
    assert.match(homeSource, /onDelete=\{[^}]*automationController\.deleteEntry/);
    assert.match(homeSource, /onDetail=/);
  });

  it('드래그 핸들과 optimistic 순서 저장 큐를 실제 목록에 연결한다', () => {
    assert.match(settingsSource, /NestableDraggableFlatList/);
    assert.match(settingsSource, /GripVertical/);
    assert.match(settingsSource, /onDragEnd/);
    assert.match(controllerSource, /UnifiedAutomationReorderQueue/);
    assert.match(controllerSource, /순서를 저장하지 못해 저장된 순서로 되돌렸어요/);
  });

  it('같은 typed entry 저장을 직렬화하고 저장 중인 행 편집을 막는다', () => {
    assert.match(controllerSource, /typeTails/);
    assert.match(controllerSource, /structuralTail/);
    assert.match(controllerSource, /runTypedMutation/);
    assert.match(homeSource, /savingEntryIds\.includes\(entry\.id\)/);
    assert.doesNotMatch(homeSource, /isModuleBusy/);
    assert.match(settingsSource, /savingEntryIds\.includes\(params\.item\.id\)/);
    assert.match(settingsSource, /accessibilityState=\{\{ disabled: saving \}\}/);
    assert.match(settingsSource, /disabled=\{saving\}/);
  });

  it('typed 준비 상태와 경고를 행 chip으로 표시한다', () => {
    assert.match(settingsSource, /item\.ready/);
    assert.match(settingsSource, /item\.warnings\[0\]/);
    assert.match(settingsSource, />경고</);
  });

  it('QUEST, BATTLE_MAP, ADVENTURE_MAP 상세는 모두 typed editor를 쓴다', () => {
    assert.match(homeSource, /entry\.type === 'QUEST'/);
    assert.match(homeSource, /<QuestAutomationEditor/);
    assert.match(homeSource, /automationController\.fetchQuests/);
    assert.match(homeSource, /automationController\.saveQuestSettings/);
    assert.match(homeSource, /entry\.type === 'BATTLE_MAP'/);
    assert.match(homeSource, /<BattleMapAutomationEditor/);
    assert.match(homeSource, /automationController\.saveBattleMapSettings/);
    assert.match(homeSource, /entry\.type === 'ADVENTURE_MAP'/);
    assert.match(homeSource, /<AdventureMapAutomationEditor/);
    assert.match(homeSource, /automationController\.saveAdventureMapSettings/);
    assert.match(homeSource, /function openModule[\s\S]*aggregate\?\.entries[\s\S]*openEntryDetail/);
    assert.doesNotMatch(homeSource, /UnifiedAutomationModuleEditor|buildEditUnifiedModuleDraft|buildUpdateUnifiedModuleRequest/);
    assert.doesNotMatch(questEditorSource, /updateModule|buildUpdateUnifiedModuleRequest/);
    assert.doesNotMatch(battleEditorSource, /updateModule|buildUpdateUnifiedModuleRequest/);
    assert.doesNotMatch(adventureEditorSource, /updateModule|buildUpdateUnifiedModuleRequest/);
  });

  it('변경 사항은 현재 작업을 끊지 않고 다음 판단부터 적용된다고 안내한다', () => {
    assert.match(settingsSource, /다음 작업부터 적용/);
  });
});
