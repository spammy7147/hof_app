import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { BattleResultResponse } from '../../main/types/api';
import {
  formatBattleOutcome,
  formatBattleProgressRow,
  formatBattleReward,
  formatBattleSide,
  formatBattleSideRow,
  getBattleResultRounds,
} from '../../main/domain/battleResults';

describe('battle result utilities', () => {
  it('formats victory result into compact Korean labels', () => {
    const result: BattleResultResponse = {
      outcome: 'VICTORY',
      title: '《얼어붙은 손길》공민이은(는) 승리했다!',
      turns: 36,
      funds: 3660,
      experience: 10590,
      loots: [{ name: 'Silver Ingot x 1' }, { name: 'Bone x 1' }],
      quest: '[ 퀘스트 정보 갱신 ] 마도사의 은신처 조사 지원 - ( 3 / 10 )',
      enemy: {
        hpCurrent: 0,
        hpMax: 51930,
        survivorsAlive: 0,
        survivorsMax: 7,
        totalDamage: 3044,
        turnCurrent: null,
        turnMax: null,
      },
      ally: {
        hpCurrent: 25955,
        hpMax: 26197,
        survivorsAlive: 5,
        survivorsMax: 5,
        totalDamage: 365247,
        turnCurrent: 36,
        turnMax: 100,
      },
      rawLogUrl: null,
    };

    assert.equal(formatBattleOutcome(result.outcome), '승리');
    assert.equal(formatBattleReward(result), 'Funds 3,660 · 경험치 10,590 · 전리품 2개');
    assert.equal(formatBattleSide(result.ally), '생존 5/5 · HP 25,955/26,197 · 피해 365,247 · 턴 36/100');
  });

  it('formats battle result rows for the battle result card', () => {
    const result: BattleResultResponse = {
      outcome: 'VICTORY',
      title: '《얼어붙은 손길》공민이은(는) 승리했다!',
      turns: 6,
      funds: 200,
      experience: 100,
      loots: [{ name: 'Steel Ingot x 1' }, { name: 'BlueRing x 1' }],
      quest: null,
      enemy: {
        hpCurrent: 0,
        hpMax: 780,
        survivorsAlive: 0,
        survivorsMax: 5,
        totalDamage: 0,
        turnCurrent: null,
        turnMax: null,
      },
      ally: {
        hpCurrent: 26087,
        hpMax: 26087,
        survivorsAlive: 5,
        survivorsMax: 5,
        totalDamage: 123243,
        turnCurrent: 6,
        turnMax: 100,
      },
      rawLogUrl: 'http://sic.zerosic.com/ZeroHOF/index.php?common=gb0#',
    };

    assert.equal(formatBattleSideRow('적군', result.enemy), '적군: HP : 0/780 | 생존자 : 0/5 | 총 데미지 : 0');
    assert.equal(
      formatBattleSideRow('아군', result.ally),
      '아군: HP : 26,087/26,087 | 생존자 : 5/5 | 총 데미지 : 123,243',
    );
    assert.equal(formatBattleProgressRow(result), '턴 : 6/100 | 경험치 : 100 | Funds : $ 200');
  });

  it('falls back cleanly when rewards are absent', () => {
    const result: BattleResultResponse = {
      outcome: 'DRAW',
      title: '무승부!',
      turns: 100,
      funds: null,
      experience: null,
      loots: [],
      quest: null,
      enemy: {
        hpCurrent: null,
        hpMax: null,
        survivorsAlive: null,
        survivorsMax: null,
        totalDamage: null,
        turnCurrent: null,
        turnMax: null,
      },
      ally: {
        hpCurrent: null,
        hpMax: null,
        survivorsAlive: null,
        survivorsMax: null,
        totalDamage: null,
        turnCurrent: null,
        turnMax: null,
      },
      rawLogUrl: null,
    };

    assert.equal(formatBattleOutcome(result.outcome), '무승부');
    assert.equal(formatBattleReward(result), '보상 없음');
  });

  it('returns every round when a three-battle response contains multiple results', () => {
    const result: BattleResultResponse = {
      outcome: 'VICTORY',
      title: '《얼어붙은 손길》공민이은(는) 승리했다!',
      turns: 6,
      funds: 200,
      experience: 100,
      loots: [],
      quest: null,
      enemy: {
        hpCurrent: 0,
        hpMax: 820,
        survivorsAlive: 0,
        survivorsMax: 5,
        totalDamage: 0,
        turnCurrent: null,
        turnMax: null,
      },
      ally: {
        hpCurrent: 26087,
        hpMax: 26087,
        survivorsAlive: 5,
        survivorsMax: 5,
        totalDamage: 102450,
        turnCurrent: 6,
        turnMax: 100,
      },
      rawLogUrl: null,
      rounds: [
        battleRound(102450, []),
        battleRound(90686, []),
        battleRound(93937, [{ name: 'Stone x 2' }]),
      ],
    };

    const rounds = getBattleResultRounds(result);

    assert.equal(rounds.length, 3);
    assert.deepEqual(rounds.map((round) => round.ally.totalDamage), [102450, 90686, 93937]);
    assert.deepEqual(rounds.map((round) => round.loots.map((loot) => loot.name)), [[], [], ['Stone x 2']]);
  });
});

function battleRound(
  totalDamage: number,
  loots: BattleResultResponse['loots'],
): BattleResultResponse {
  return {
    outcome: 'VICTORY',
    title: '《얼어붙은 손길》공민이은(는) 승리했다!',
    turns: 6,
    funds: 200,
    experience: 100,
    loots,
    quest: null,
    enemy: {
      hpCurrent: 0,
      hpMax: 820,
      survivorsAlive: 0,
      survivorsMax: 5,
      totalDamage: 0,
      turnCurrent: null,
      turnMax: null,
    },
    ally: {
      hpCurrent: 26087,
      hpMax: 26087,
      survivorsAlive: 5,
      survivorsMax: 5,
      totalDamage,
      turnCurrent: 6,
      turnMax: 100,
    },
    rawLogUrl: null,
  };
}
