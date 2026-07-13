import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TOWN_CATEGORIES,
  TOWN_MENUS,
  getTownMenusForCategory,
} from '../../main/domain/townMenus';

describe('town menu catalog', () => {
  it('keeps the approved category order', () => {
    assert.deepEqual(
      TOWN_CATEGORIES.map((category) => [category.id, category.label]),
      [
        ['life', '생활'],
        ['market', '상점'],
        ['card', '카드'],
        ['craft', '제작'],
      ],
    );
  });

  it('maps all 14 APK town menus exactly once', () => {
    assert.equal(TOWN_MENUS.length, 14);
    assert.equal(new Set(TOWN_MENUS.map((menu) => menu.id)).size, 14);
    assert.deepEqual(
      TOWN_MENUS.map((menu) => [menu.label, menu.apkMenu]),
      [
        ['낚시', 'fishing'],
        ['낚시 교환소', 'createF'],
        ['일반 상점', 'buy'],
        ['암흑상점', 'sbuy'],
        ['옥션', 'auction'],
        ['낙찰 시세', 'auctionMarket'],
        ['상자 열기', 'stash'],
        ['카드 합성', 'cardmix'],
        ['카드 변환', 'cardmix2'],
        ['블랭크 교환', 'cardsell'],
        ['오브 교환소', 'orbboxshop'],
        ['재봉/리메이크', 'sewingshop'],
        ['개인 작업장', 'workbase'],
        ['장로 대장간', 'refine2'],
      ],
    );
  });

  it('returns menus in APK order within each fixed category', () => {
    assert.deepEqual(
      getTownMenusForCategory('market').map((menu) => menu.label),
      ['일반 상점', '암흑상점', '옥션', '낙찰 시세', '상자 열기'],
    );
    assert.deepEqual(
      getTownMenusForCategory('craft').map((menu) => menu.label),
      ['재봉/리메이크', '개인 작업장', '장로 대장간'],
    );
  });
});
