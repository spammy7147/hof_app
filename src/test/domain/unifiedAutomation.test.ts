import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDefaultUnifiedAutomationSettings,
  buildUnifiedModuleSummaries,
  formatUnifiedAutomationStatus,
  getPriorityQuestName,
  getUnifiedModuleCategoryIds,
} from '../../main/domain/unifiedAutomation';

describe('통합 자동화 도메인', () => {
  it('새 계정의 기본 우선순위와 Time 90% 기준을 만든다', () => {
    const settings = buildDefaultUnifiedAutomationSettings();

    assert.equal(settings.keyQuest.enabled, true);
    assert.deepEqual(settings.keyQuest.quests.map((quest) => quest.questId), ['0563', '0571', '0171', '0351']);
    assert.equal(settings.time.thresholdPercent, 90);
    assert.equal(settings.normalQuest.enabled, false);
  });

  it('서버 상태를 짧은 한국어 안내로 변환한다', () => {
    assert.equal(formatUnifiedAutomationStatus('RUNNING'), '자동 전투 중');
    assert.equal(formatUnifiedAutomationStatus('WAITING_CAPTCHA'), '캡차 인증이 필요해요');
    assert.equal(formatUnifiedAutomationStatus('WAITING_CONFIG'), '전투에 사용할 파티를 선택해 주세요');
    assert.equal(formatUnifiedAutomationStatus('PAUSED'), '일시정지됨');
  });

  it('설정을 맵 코드나 열쇠 수량이 없는 모듈 요약으로 바꾼다', () => {
    const summaries = buildUnifiedModuleSummaries(buildDefaultUnifiedAutomationSettings());

    assert.deepEqual(summaries.map(({ title }) => title), [
      '열쇠 퀘스트',
      'Time 자동 소모',
      '쿨다운 모험맵',
      '일일 제한 모험맵',
      '유니온',
      '일반 퀘스트',
    ]);
    assert.equal(JSON.stringify(summaries).includes('Noble'), false);
    const emptyConfiguredQuests = buildDefaultUnifiedAutomationSettings();
    emptyConfiguredQuests.keyQuest.quests = [];
    assert.equal(buildUnifiedModuleSummaries(emptyConfiguredQuests)[0]?.detail, '4개 우선 퀘스트');
  });

  it('우선 퀘스트는 사용자에게 이름으로만 보여준다', () => {
    assert.equal(getPriorityQuestName('0563'), '저택 동관 열쇠 수집');
    assert.equal(getPriorityQuestName('0571'), '저택 서관 열쇠 수집');
    assert.equal(getPriorityQuestName('0171'), '우선 열쇠 퀘스트');
    assert.equal(getPriorityQuestName('0351'), '마을 지하 수로 열쇠 수집');
  });

  it('모듈마다 관련된 맵 종류만 선택하게 한다', () => {
    assert.deepEqual(getUnifiedModuleCategoryIds('time'), ['battle_map', 'scenario_ocean']);
    assert.deepEqual(getUnifiedModuleCategoryIds('cooldownAdventure'), ['adventure_map']);
    assert.deepEqual(getUnifiedModuleCategoryIds('dailyAdventure'), ['adventure_map']);
    assert.deepEqual(getUnifiedModuleCategoryIds('union'), ['union']);
  });
});
