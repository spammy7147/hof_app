import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { BattleStatsResponse } from '../../main/types/api';
import { formatBattleLogParty, formatBattleLogTime, formatWinRate } from '../../main/domain/battleLogs';

describe('battle log utilities', () => {
  it('formats win rate as a compact percent', () => {
    const stats: BattleStatsResponse = {
      accountId: 1,
      totalBattles: 10,
      victories: 7,
      defeats: 2,
      draws: 1,
      unknowns: 0,
      winRate: 0.7,
      totalFunds: 12300,
      totalExperience: 999,
      totalLootCount: 4,
    };

    assert.equal(formatWinRate(stats), '70%');
  });

  it('formats ISO timestamps for recent logs', () => {
    assert.equal(formatBattleLogTime('2026-07-08T03:04:05Z'), '07-08 03:04');
  });

  it('formats battle log party names without exposing the internal map code', () => {
    assert.equal(
      formatBattleLogParty({
        characterNames: ['2탑전용', '골용비테', '남세이지', '낫망네크', '니트로맨'],
      }),
      '2탑전용, 골용비테, 남세이지, 낫망네크, 니트로맨',
    );
  });

  it('uses a readable fallback when a battle log has no character names', () => {
    assert.equal(formatBattleLogParty({ characterNames: ['', '   '] }), '캐릭터 없음');
  });
});
