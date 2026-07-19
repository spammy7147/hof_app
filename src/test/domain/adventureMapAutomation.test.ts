import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAdventureMapAutomationDraft,
  buildAdventureMapAutomationRequest,
  describeAdventureMapConstraints,
  describeAdventureMapState,
  formatAdventureDailyRefresh,
  formatAutomationPresetSelection,
  moveAdventureMapSetting,
  selectAdventureMap,
  validateAdventureMapAutomationDraft,
} from '../../main/domain/adventureMapAutomation';
import type {
  BattleMapResponse,
  PartyPresetResponse,
  TypedAutomationEntryResponse,
} from '../../main/types/api';

describe('adventure map automation domain', () => {
  it('describes cooldown, daily complete, missing key, runnable, and unlimited repeat states', () => {
    assert.equal(describeAdventureMapState(map('cooldown', { cooldownRemainingSeconds: 90, cooldownRemainingText: '1분 30초' })).label, '쿨다운 1분 30초');
    assert.equal(describeAdventureMapState(map('daily', { attemptCount: 0 })).label, '오늘 횟수 완료');
    assert.equal(describeAdventureMapState(map('key', { keyMode: 'LIMITED', keyCount: 0 })).label, '열쇠 부족');
    assert.equal(describeAdventureMapState(map('ready', { keyMode: 'LIMITED', keyCount: 2, attemptCount: 3 })).label, '실행 가능');
    assert.equal(describeAdventureMapState(map('unlimited', { keyMode: 'UNLIMITED' })).label, '횟수 제한 없음 · 반복 실행');
    assert.equal(describeAdventureMapState(map('disabled', { enabled: false })).label, '현재 실행 불가');
  });

  it('keeps unavailable maps selectable, ordered, and serializes exact preset modes', () => {
    const unavailable = map('later', { availableCount: 0, enabled: false });
    let draft = buildAdventureMapAutomationDraft(entry(), [unavailable, map('always')]);
    draft = selectAdventureMap(draft, unavailable, true);
    draft = selectAdventureMap(draft, map('always'), true);
    draft.maps[1] = { ...draft.maps[1]!, presetMode: 'EXPLICIT', partyPresetId: 9 };
    draft = moveAdventureMapSetting(draft, 1, 0);

    assert.deepEqual(validateAdventureMapAutomationDraft(draft, [9]), []);
    assert.deepEqual(buildAdventureMapAutomationRequest(draft, [9]), {
      enabled: true,
      maps: [
        { categoryId: 'adventure_map', mapCode: 'always', presetMode: 'EXPLICIT', partyPresetId: 9, executionOrder: 0 },
        { categoryId: 'adventure_map', mapCode: 'later', presetMode: 'PRIMARY', partyPresetId: null, executionOrder: 1 },
      ],
    });
  });

  it('dynamically relabels PRIMARY selections while explicit selections stay fixed', () => {
    const primary = { presetMode: 'PRIMARY' as const, partyPresetId: null };
    const explicit = { presetMode: 'EXPLICIT' as const, partyPresetId: 9 };
    const before = [preset(7, '기존 대표', true), preset(9, '고정 파티', false)];
    const after = [preset(7, '기존 대표', false), preset(8, '새 대표', true), preset(9, '고정 파티', false)];

    assert.equal(formatAutomationPresetSelection(primary, before), '대표 · 기존 대표');
    assert.equal(formatAutomationPresetSelection(primary, after), '대표 · 새 대표');
    assert.equal(formatAutomationPresetSelection(explicit, before), '고정 파티');
    assert.equal(formatAutomationPresetSelection(explicit, after), '고정 파티');
    assert.deepEqual(primary, { presetMode: 'PRIMARY', partyPresetId: null });
    assert.deepEqual(explicit, { presetMode: 'EXPLICIT', partyPresetId: 9 });
  });

  it('formats the Korea-date daily refresh timestamp and pending state', () => {
    assert.equal(formatAdventureDailyRefresh({
      status: 'COMPLETE',
      refreshDate: '2026-07-16',
      refreshedAt: '2026-07-15T15:03:00Z',
    }), '오늘 초기화 완료 · 오전 12:03');
    assert.equal(formatAdventureDailyRefresh({ status: 'PENDING', refreshDate: null, refreshedAt: null }), '오늘 초기화 대기');
    assert.equal(formatAdventureDailyRefresh(undefined), '오늘 초기화 대기');
  });

  it('describes every observed constraint independently even when several apply together', () => {
    assert.deepEqual(describeAdventureMapConstraints(map('combined', {
      availableCount: 4,
      attemptCount: 2,
      winCount: 1,
      cooldownRemainingSeconds: 90,
      cooldownRemainingText: '1분 30초',
      keyMode: 'LIMITED',
      keyCount: 0,
    })).map(({ label }) => label), [
      '쿨다운 · 1분 30초',
      '열쇠 · 0개',
      '가능 횟수 · 4회',
      '도전 잔여 · 2회',
      '승리 잔여 · 1회',
    ]);
  });

  it('marks each constraint unknown when a stored map has no successful observation', () => {
    assert.deepEqual(describeAdventureMapConstraints(null).map(({ label }) => label), [
      '쿨다운 · 미확인',
      '열쇠 · 미확인',
      '가능 횟수 · 미확인',
      '도전 잔여 · 미확인',
      '승리 잔여 · 미확인',
    ]);
  });
});

function entry(): TypedAutomationEntryResponse {
  return {
    id: 15,
    type: 'ADVENTURE_MAP',
    enabled: true,
    priority: 2,
    ready: true,
    warnings: [],
    quests: [],
    battleMaps: [],
    battleMapProgress: [],
    adventureMaps: [],
  };
}

function map(mapCode: string, overrides: Partial<BattleMapResponse> = {}): BattleMapResponse {
  return {
    categoryId: 'adventure_map',
    mapCode,
    name: mapCode,
    groupName: '모험',
    groupOrder: 0,
    mapOrder: 0,
    recommendedLevel: null,
    availableCount: null,
    attemptCount: null,
    winCount: null,
    cooldownRemainingText: null,
    cooldownRemainingSeconds: null,
    keyMode: 'NOT_REQUIRED',
    keyCount: null,
    requiredTime: null,
    supportsThreeBattles: false,
    enabled: true,
    resolved: true,
    iconUrl: null,
    rawHref: '',
    ...overrides,
  };
}

function preset(id: number, name: string, isPrimary: boolean): PartyPresetResponse {
  return { id, accountId: 1, name, isPrimary, members: [], createdAt: '', updatedAt: '' };
}
