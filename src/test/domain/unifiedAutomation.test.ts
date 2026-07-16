import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addUnifiedAutomationQuest,
  buildCreateUnifiedModuleDraft,
  buildEditUnifiedModuleDraft,
  buildToggleUnifiedModuleRequest,
  buildUnifiedModuleRequest,
  buildUpdateUnifiedModuleRequest,
  buildUnifiedModuleSummaries,
  CANONICAL_UNIFIED_MODULE_TYPES,
  getUnifiedModuleCategoryIds,
  getUnifiedModuleTypeLabel,
  setUnifiedAutomationMapPreset,
  suggestUnifiedModuleName,
  toggleUnifiedAutomationMap,
  validateUnifiedModuleDraft,
} from '../../main/domain/unifiedAutomation';
import type { BattleMapResponse } from '../../main/types/api';
import type { UnifiedAutomationModuleResponse } from '../../main/types/api';

const timeModule: UnifiedAutomationModuleResponse = {
  id: 31,
  displayName: 'Time 자동 소모',
  moduleType: 'TIME_BURN',
  enabled: true,
  priority: 0,
  thresholdPercent: 90,
  maps: [],
  quests: [],
  ready: false,
  summary: '맵 설정 필요',
};

describe('통합 자동화 도메인', () => {
  it('서버가 지원하는 사용자 구성 모듈 유형만 한국어로 표시한다', () => {
    assert.deepEqual(CANONICAL_UNIFIED_MODULE_TYPES, ['OTHER_QUEST', 'TIME_BURN', 'DAILY_ADVENTURE']);
    assert.equal(getUnifiedModuleTypeLabel('KEY_QUEST'), '퀘스트');
    assert.equal(getUnifiedModuleTypeLabel('OTHER_QUEST'), '퀘스트');
    assert.equal(getUnifiedModuleTypeLabel('TIME_BURN'), '전투 맵');
    assert.equal(getUnifiedModuleTypeLabel('COOLDOWN_ADVENTURE'), '모험 맵');
    assert.equal(getUnifiedModuleTypeLabel('DAILY_ADVENTURE'), '모험 맵');
  });

  it('같은 유형이 중복되면 다음 번호가 붙은 이름을 제안한다', () => {
    assert.equal(suggestUnifiedModuleName('TIME_BURN', []), '전투 맵');
    assert.equal(suggestUnifiedModuleName('TIME_BURN', [timeModule]), '전투 맵 2');
    assert.equal(
      suggestUnifiedModuleName('TIME_BURN', [
        timeModule,
        { ...timeModule, id: 32, displayName: '아침 Time', priority: 1 },
      ]),
      '전투 맵 3',
    );
  });

  it('서버 모듈 목록만 요약하며 빈 계정에 기본 모듈을 합성하지 않는다', () => {
    assert.deepEqual(buildUnifiedModuleSummaries([]), []);
    assert.deepEqual(buildUnifiedModuleSummaries([timeModule]), [{
      id: 31,
      title: 'Time 자동 소모',
      typeLabel: '전투 맵',
      enabled: true,
      ready: false,
      detail: '맵 설정 필요',
    }]);
  });

  it('모듈 유형마다 선택 가능한 맵 카테고리를 제한한다', () => {
    assert.deepEqual(getUnifiedModuleCategoryIds('TIME_BURN'), ['battle_map', 'scenario_ocean']);
    assert.deepEqual(getUnifiedModuleCategoryIds('COOLDOWN_ADVENTURE'), ['adventure_map']);
    assert.deepEqual(getUnifiedModuleCategoryIds('DAILY_ADVENTURE'), ['adventure_map']);
    assert.deepEqual(getUnifiedModuleCategoryIds('KEY_QUEST'), ['battle_map']);
    assert.deepEqual(getUnifiedModuleCategoryIds('OTHER_QUEST'), []);
  });

  it('같은 유형도 별도 초안으로 추가하고 저장 전까지 서버 요청을 만들지 않는다', () => {
    const draft = buildCreateUnifiedModuleDraft('TIME_BURN', [timeModule]);

    assert.equal(draft.moduleId, null);
    assert.equal(draft.moduleType, 'TIME_BURN');
    assert.equal(draft.displayName, '전투 맵 2');
    assert.equal(draft.thresholdPercent, 90);
    assert.deepEqual(draft.maps, []);
  });

  it('맵 선택과 프리셋 지정 후 서버 실행 순서를 연속 값으로 만든다', () => {
    const firstMap = makeMap('battle_map', 'gb0');
    const secondMap = makeMap('scenario_ocean', 'Sink01');
    let maps = toggleUnifiedAutomationMap([], firstMap);
    maps = toggleUnifiedAutomationMap(maps, secondMap);
    maps = setUnifiedAutomationMapPreset(maps, firstMap, 41);

    assert.deepEqual(maps, [
      { categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: 41, executionOrder: 0 },
      { categoryId: 'scenario_ocean', mapCode: 'Sink01', partyPresetId: null, executionOrder: 1 },
    ]);

    assert.deepEqual(toggleUnifiedAutomationMap(maps, firstMap), [
      { categoryId: 'scenario_ocean', mapCode: 'Sink01', partyPresetId: null, executionOrder: 0 },
    ]);
  });

  it('열쇠 퀘스트 요청에는 퀘스트별 맵과 프리셋만 포함한다', () => {
    let draft = buildCreateUnifiedModuleDraft('KEY_QUEST', []);
    draft = addUnifiedAutomationQuest(draft, '0563');
    const map = makeMap('battle_map', 'gb0');
    const quest = draft.quests[0];
    assert.ok(quest);
    const questMaps = setUnifiedAutomationMapPreset(
      toggleUnifiedAutomationMap(quest.maps, map),
      map,
      7,
    );
    draft = { ...draft, quests: [{ ...quest, maps: questMaps }] };

    assert.deepEqual(buildUnifiedModuleRequest(draft), {
      displayName: '퀘스트',
      moduleType: 'KEY_QUEST',
      enabled: true,
      thresholdPercent: null,
      maps: [],
      quests: [{
        questCode: '0563',
        executionOrder: 0,
        maps: [{ categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: 7, executionOrder: 0 }],
      }],
    });
  });

  it('편집 초안과 토글 요청은 유형을 바꾸지 않고 기존 설정을 보존한다', () => {
    const module = {
      ...timeModule,
      maps: [{ categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: 9, executionOrder: 0 }],
    };
    const draft = buildEditUnifiedModuleDraft(module);
    draft.maps[0] = { ...draft.maps[0]!, partyPresetId: 10 };

    assert.equal(module.maps[0]?.partyPresetId, 9);
    assert.deepEqual(buildUpdateUnifiedModuleRequest(draft), {
      displayName: 'Time 자동 소모',
      enabled: true,
      thresholdPercent: 90,
      maps: [{ categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: 10, executionOrder: 0 }],
      quests: [],
    });
    assert.deepEqual(buildToggleUnifiedModuleRequest(module), {
      displayName: 'Time 자동 소모',
      enabled: false,
      thresholdPercent: 90,
      maps: [{ categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: 9, executionOrder: 0 }],
      quests: [],
    });
  });

  it('이름, 유형별 필수값과 중복 퀘스트를 검증하되 프리셋 누락은 저장을 허용한다', () => {
    const invalidTimeDraft = {
      ...buildCreateUnifiedModuleDraft('TIME_BURN', []),
      displayName: '   ',
      thresholdPercent: 101,
      maps: [{ categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: null, executionOrder: 0 }],
    };
    assert.deepEqual(validateUnifiedModuleDraft(invalidTimeDraft), [
      '자동화 이름을 입력해 주세요.',
      'Time 기준은 1%에서 100% 사이로 설정해 주세요.',
    ]);

    const saveableWithoutPreset = {
      ...buildCreateUnifiedModuleDraft('TIME_BURN', []),
      maps: [{ categoryId: 'battle_map', mapCode: 'gb0', partyPresetId: null, executionOrder: 0 }],
    };
    assert.deepEqual(validateUnifiedModuleDraft(saveableWithoutPreset), []);
    assert.equal(buildUnifiedModuleRequest(saveableWithoutPreset).maps[0]?.partyPresetId, null);

    let questDraft = buildCreateUnifiedModuleDraft('OTHER_QUEST', []);
    questDraft = addUnifiedAutomationQuest(questDraft, 'quest-1');
    questDraft = addUnifiedAutomationQuest(questDraft, ' quest-1 ');
    assert.deepEqual(validateUnifiedModuleDraft(questDraft), [
      '같은 퀘스트 코드를 두 번 추가할 수 없습니다.',
    ]);
  });
});

function makeMap(categoryId: string, mapCode: string): BattleMapResponse {
  return {
    categoryId,
    mapCode,
    name: mapCode,
    groupName: null,
    groupOrder: 0,
    mapOrder: 0,
    recommendedLevel: null,
    availableCount: null,
    attemptCount: null,
    winCount: null,
    cooldownRemainingText: null,
    cooldownRemainingSeconds: null,
    keyCount: null,
    requiredTime: null,
    supportsThreeBattles: false,
    enabled: true,
    resolved: true,
    iconUrl: null,
    rawHref: '',
  };
}
