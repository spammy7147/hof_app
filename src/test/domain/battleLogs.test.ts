import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatBattleLogFunds,
  formatBattleLogItems,
  formatBattleLogMap,
  formatBattleLogParty,
  formatBattleLogTime,
} from '../../main/domain/battleLogs';

describe('battle log utilities', () => {
  it('formats ISO timestamps for recent logs', () => {
    assert.equal(formatBattleLogTime('2026-07-08T03:04:05Z'), '07-08 12:04');
    assert.equal(formatBattleLogTime('2026-07-08T18:30:00Z'), '07-09 03:30');
    assert.equal(formatBattleLogTime('not-a-date'), '-');
  });

  it('formats the map name with a map code fallback', () => {
    assert.equal(formatBattleLogMap({ mapName: 'Frosty Mountain', mapCode: 'snow22' }), 'Frosty Mountain');
    assert.equal(formatBattleLogMap({ mapName: '   ', mapCode: 'snow22' }), 'snow22');
  });

  it('formats battle log funds', () => {
    assert.equal(formatBattleLogFunds({ funds: 3660 }), 'Funds 3,660');
    assert.equal(formatBattleLogFunds({ funds: null }), 'Funds 없음');
  });

  it('formats acquired battle log items', () => {
    assert.equal(
      formatBattleLogItems({ loots: [{ name: 'Silver Ingot x 1' }, { name: 'Bone x 1' }] }),
      '획득 아이템: Silver Ingot x 1, Bone x 1',
    );
    assert.equal(
      formatBattleLogItems({ loots: [{ name: '  Bone x 1  ' }, { name: '   ' }] }),
      '획득 아이템: Bone x 1',
    );
    assert.equal(formatBattleLogItems({ loots: [] }), '획득 아이템 없음');
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
