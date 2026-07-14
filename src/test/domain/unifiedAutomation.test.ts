import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildUnifiedModuleSummaries,
  getUnifiedModuleCategoryIds,
  getUnifiedModuleTypeLabel,
  suggestUnifiedModuleName,
} from '../../main/domain/unifiedAutomation';
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
    assert.equal(getUnifiedModuleTypeLabel('KEY_QUEST'), '열쇠 퀘스트');
    assert.equal(getUnifiedModuleTypeLabel('TIME_BURN'), 'Time 자동 소모');
    assert.equal(getUnifiedModuleTypeLabel('COOLDOWN_ADVENTURE'), '쿨다운 모험맵');
    assert.equal(getUnifiedModuleTypeLabel('DAILY_ADVENTURE'), '일일 제한 모험맵');
    assert.equal(getUnifiedModuleTypeLabel('OTHER_QUEST'), '일반 퀘스트');
  });

  it('같은 유형이 중복되면 다음 번호가 붙은 이름을 제안한다', () => {
    assert.equal(suggestUnifiedModuleName('TIME_BURN', []), 'Time 자동 소모');
    assert.equal(suggestUnifiedModuleName('TIME_BURN', [timeModule]), 'Time 자동 소모 2');
    assert.equal(
      suggestUnifiedModuleName('TIME_BURN', [
        timeModule,
        { ...timeModule, id: 32, displayName: '아침 Time', priority: 1 },
      ]),
      'Time 자동 소모 3',
    );
  });

  it('서버 모듈 목록만 요약하며 빈 계정에 기본 모듈을 합성하지 않는다', () => {
    assert.deepEqual(buildUnifiedModuleSummaries([]), []);
    assert.deepEqual(buildUnifiedModuleSummaries([timeModule]), [{
      id: 31,
      title: 'Time 자동 소모',
      typeLabel: 'Time 자동 소모',
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
});
