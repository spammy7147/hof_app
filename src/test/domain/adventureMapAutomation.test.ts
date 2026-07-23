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

  it('trusts unlimited key mode over a stray zero key count', () => {
    const unlimited = map('unlimited-stray-count', { keyMode: 'UNLIMITED', keyCount: 0 });

    assert.notEqual(describeAdventureMapState(unlimited).kind, 'MISSING_KEY');
    assert.deepEqual(describeAdventureMapConstraints(unlimited), [{ key: 'KEY', label: '영구 키' }]);
  });

  it('treats a limited key with an unknown count as unavailable', () => {
    const limited = map('limited-unknown-count', { keyMode: 'LIMITED', keyCount: null });

    assert.equal(describeAdventureMapState(limited).kind, 'MISSING_KEY');
  });

  it('describes a limited key with an unknown count as unobserved', () => {
    const limited = map('limited-unknown-count', { keyMode: 'LIMITED', keyCount: null });

    assert.deepEqual(describeAdventureMapConstraints(limited), [{ key: 'KEY', label: '키 상태 미확인' }]);
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

  it('uses the stored display name when the selected map is absent from the live catalog', () => {
    const stored = entry();
    stored.adventureMaps = [{
      categoryId: 'adventure_map',
      mapCode: 'festival01',
      displayName: 'Arena- 천년제 무투회',
      presetMode: 'PRIMARY',
      partyPresetId: null,
      executionOrder: 0,
    }];

    const draft = buildAdventureMapAutomationDraft(stored, []);

    assert.equal(draft.maps[0]?.displayName, 'Arena- 천년제 무투회');
    assert.equal(draft.maps[0]?.resolved, false);
  });

  it('uses the bundled catalog name when an older server omits the stored display name', () => {
    const stored = entry();
    stored.adventureMaps = [{
      categoryId: 'adventure_map',
      mapCode: 'sion00',
      presetMode: 'PRIMARY',
      partyPresetId: null,
      executionOrder: 0,
    }];

    const draft = buildAdventureMapAutomationDraft(stored, []);

    assert.equal(draft.maps[0]?.displayName, 'Castle In The Sky- 천공성(외곽)');
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

  it('describes only a finite key count when no other constraints apply', () => {
    assert.deepEqual(describeAdventureMapConstraints(map('limited', {
      keyMode: 'LIMITED',
      keyCount: 114,
    })), [{ key: 'KEY', label: '키 114개' }]);
  });

  it('describes an unlimited key without repeating absent constraints', () => {
    assert.deepEqual(describeAdventureMapConstraints(map('unlimited', {
      keyMode: 'UNLIMITED',
      keyCount: null,
    })), [{ key: 'KEY', label: '영구 키' }]);
  });

  it('uses one unrestricted fallback when a map needs no key and has no dynamic constraints', () => {
    assert.deepEqual(describeAdventureMapConstraints(map('open', {
      keyMode: 'NOT_REQUIRED',
    })), [{ key: 'UNLIMITED', label: '제한 없음' }]);
  });

  it('describes an unknown key state without inventing other constraints', () => {
    assert.deepEqual(describeAdventureMapConstraints(map('unknown', {
      keyMode: 'UNKNOWN',
      keyCount: null,
    })), [{ key: 'KEY', label: '키 상태 미확인' }]);
  });

  it('describes each meaningful dynamic constraint exactly once', () => {
    assert.deepEqual(describeAdventureMapConstraints(map('combined', {
      availableCount: 4,
      attemptCount: 2,
      winCount: 1,
      cooldownRemainingSeconds: 90,
      cooldownRemainingText: '1분 30초',
      keyMode: 'LIMITED',
      keyCount: 0,
    })), [
      { key: 'COOLDOWN', label: '쿨다운 1분 30초' },
      { key: 'KEY', label: '키 0개' },
      { key: 'AVAILABLE', label: '가능 4회' },
      { key: 'ATTEMPT', label: '도전 2회' },
      { key: 'WIN', label: '승리 1회' },
    ]);
  });

  it('uses one unknown-status fallback when a stored map has no successful observation', () => {
    assert.deepEqual(describeAdventureMapConstraints(null), [{ key: 'STATE', label: '상태 미확인' }]);
  });

  it('does not repeat a finite key count as observed remaining state detail', () => {
    assert.equal(describeAdventureMapState(map('limited', {
      keyMode: 'LIMITED',
      keyCount: 114,
    })).detail, null);
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
  return { id, accountId: 1, name, displayOrder: id, isPrimary, members: [], createdAt: '', updatedAt: '' };
}
