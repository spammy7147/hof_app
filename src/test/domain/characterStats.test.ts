import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculatePatternRequirement, recommendPatternStats } from '../../main/domain/characterStats';

describe('character pattern stat calculator', () => {
  it('counts every threshold crossed by Real INT and Real SPD only', () => {
    assert.deepEqual(calculatePatternRequirement(10, 204), { requirement: 50, additionalPatterns: 4 });
  });

  it('minimizes INT and maximizes SPD inside the selected exact threshold', () => {
    assert.deepEqual(recommendPatternStats(10, 13, 236, 4), {
      additionalPatterns: 4, targetRequirement: 50, addInt: 0, addSpd: 191, pointsUsed: 191, pointsRemaining: 45,
    });
  });

  it('does not offer a target that current points cannot reach', () => {
    assert.equal(recommendPatternStats(10, 13, 10, 4), null);
  });
});
