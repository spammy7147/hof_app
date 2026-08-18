import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateActionTime,
  formatActionTime,
  formatFunds,
  formatPlayerDisplayName,
  formatStatusBarFunds,
  formatStatusBarStateValue,
  mergeObservedHofStatus,
} from '../../main/domain/hofStatus';
import type { HofObservedStatusResponse, HofStatusResponse } from '../../main/types/api';

describe('hof status utilities', () => {
  it('estimates action time from the observed value without passing the maximum', () => {
    const observedAt = Date.parse('2026-07-08T10:00:00.000Z');

    const estimated = estimateActionTime(
      { current: 5990, max: 6000, observedAt },
      Date.parse('2026-07-08T10:00:20.000Z'),
    );

    assert.equal(estimated.current, 6000);
    assert.equal(estimated.max, 6000);
  });

  it('formats funds and action time for compact status cards', () => {
    assert.equal(formatFunds(309385362), '$ 309,385,362');
    assert.equal(formatActionTime({ current: 6000, max: 6000 }), '6000/6000');
  });

  it('formats status bar funds without extra spacing for long balances', () => {
    assert.equal(formatStatusBarFunds(309391622), '$309,391,622');
    assert.equal(formatStatusBarFunds(100000000000), '$100,000,000,000');
  });

  it('formats status bar work and auction values compactly', () => {
    assert.equal(formatStatusBarStateValue('Nothing'), 'Nothing');
    assert.equal(formatStatusBarStateValue(' item/funds '), 'item/funds');
    assert.equal(formatStatusBarStateValue(''), '-');
    assert.equal(formatStatusBarStateValue(null), '-');
  });

  it('separates a title from the nickname while preserving untitled names', () => {
    assert.equal(formatPlayerDisplayName('《얼어붙은 손길》공민이'), '《얼어붙은 손길》 공민이');
    assert.equal(formatPlayerDisplayName('《얼어붙은 손길》  공민이'), '《얼어붙은 손길》 공민이');
    assert.equal(formatPlayerDisplayName('공민이'), '공민이');
  });

  it('merges a newer observed display status without losing synchronization metadata', () => {
    const current = fullStatus({ timeCurrent: 6000, observedAt: '2026-07-24T10:00:00Z' });
    const observed = observedStatus({ timeCurrent: 5900, observedAt: '2026-07-24T10:00:01Z' });

    const merged = mergeObservedHofStatus(current, observed);

    assert.equal(merged?.timeCurrent, 5900);
    assert.equal(merged?.characterSyncRequired, true);
    assert.equal(merged?.totalCharacterCount, 63);
  });

  it('ignores a missing, invalid, or older status observation', () => {
    const current = fullStatus({ observedAt: '2026-07-24T10:00:02Z' });

    assert.strictEqual(mergeObservedHofStatus(current, null), current);
    assert.strictEqual(
      mergeObservedHofStatus(current, observedStatus({ observedAt: '2026-07-24T10:00:01Z' })),
      current,
    );
    assert.strictEqual(
      mergeObservedHofStatus(current, observedStatus({ observedAt: 'invalid' })),
      current,
    );
  });
});

function fullStatus(overrides: Partial<HofStatusResponse> = {}): HofStatusResponse {
  return {
    accountId: 1,
    playerName: '공민이',
    funds: 331_708_318,
    timeCurrent: 6000,
    timeMax: 6000,
    work: 'Nothing',
    auction: 'Nothing',
    totalCharacterCount: 63,
    synchronizedCharacterCount: 63,
    characterSyncRequired: true,
    observedAt: '2026-07-24T10:00:00Z',
    ...overrides,
  };
}

function observedStatus(
  overrides: Partial<HofObservedStatusResponse> = {},
): HofObservedStatusResponse {
  return {
    playerName: '공민이',
    funds: 331_708_318,
    timeCurrent: 6000,
    timeMax: 6000,
    work: 'Nothing',
    auction: 'Nothing',
    observedAt: '2026-07-24T10:00:00Z',
    ...overrides,
  };
}
