import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateActionTime,
  formatActionTime,
  formatFunds,
  formatStatusBarFunds,
  formatStatusBarStateValue,
} from '../../main/domain/hofStatus';

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
});
