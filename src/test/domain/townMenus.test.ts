import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TOWN_CATEGORIES,
  TOWN_MENUS,
  getTownMenuById,
  getTownMenusForCategory,
  searchTownMenus,
} from '../../main/domain/townMenus';

describe('town menu catalog', () => {
  it('keeps the approved nine-category order', () => {
    assert.equal(TOWN_CATEGORIES.length, 9);
    assert.deepEqual(TOWN_CATEGORIES.map(({ label }) => label), [
      '생활',
      '시장',
      'PVP',
      '알선소',
      '자택',
      '대장간',
      '상점가',
      '카드 가게',
      '특수 시설',
    ]);
  });

  it('maps all 33 approved town menus exactly once', () => {
    assert.equal(TOWN_MENUS.length, 33);
    assert.equal(new Set(TOWN_MENUS.map(({ id }) => id)).size, 33);
    assert.equal(TOWN_MENUS.every(({ featureKind }) => featureKind.length > 0), true);
  });

  it('locks every menu identity, category, label, and feature kind in approved order', () => {
    assert.deepEqual(
      TOWN_MENUS.map(({ id, categoryId, label, featureKind }) => [id, categoryId, label, featureKind]),
      [
        ['fishing', 'life', '낚시터', 'fishing'],
        ['fishingExchange', 'life', '낚시 교환소', 'fishing'],
        ['restRoom', 'life', '휴식처', 'home'],
        ['generalShop', 'market', '일반상점', 'shop'],
        ['sundriesShop', 'market', '잡화점', 'shop'],
        ['darkShop', 'market', '암흑상점', 'shop'],
        ['sell', 'market', '판매', 'shop'],
        ['combine', 'market', '조합소', 'shop'],
        ['auction', 'market', '옥션', 'auction'],
        ['auctionMarket', 'market', '낙찰 시세', 'auction'],
        ['colosseumBattle', 'pvp', '콜로세움 전투', 'pvp'],
        ['colosseumExchange', 'pvp', '콜로세움 교환소', 'pvp'],
        ['adventureAgency', 'agency', '모험 알선소', 'agency'],
        ['talentAgency', 'agency', '인재 알선소', 'agency'],
        ['homeManagement', 'home', '자택 관리', 'home'],
        ['workbase', 'home', '작업장-재봉틀', 'crafting'],
        ['refineWorkshop', 'smithy', '제련공방', 'crafting'],
        ['createWorkshop', 'smithy', '제작공방', 'crafting'],
        ['veteranSmithy', 'smithy', '장로대장간', 'crafting'],
        ['emblemShop', 'arcade', '교환상점', 'exchange'],
        ['eventShop', 'arcade', '특별 교환상점', 'exchange'],
        ['sewingShop', 'arcade', '클라리스의 재봉실', 'crafting'],
        ['legacyShop', 'arcade', '유물 가게', 'exchange'],
        ['annShop', 'arcade', '앤의 가게', 'exchange'],
        ['cardIdentify', 'card', '카드 감정', 'card'],
        ['cardUpgrade', 'card', '카드 강화', 'card'],
        ['cardChange', 'card', '카드 변화', 'card'],
        ['cardSell', 'card', '카드 판매', 'card'],
        ['soulEcho', 'card', '소울 에코 교환', 'card'],
        ['orbExchange', 'special', '오브 교환소', 'reward'],
        ['stash', 'special', '상자 열기', 'reward'],
        ['raidInfo', 'special', '전투 정보실', 'raid'],
        ['pantheon', 'special', '신전 거리', 'pantheon'],
      ],
    );
  });

  it('keeps PVP and special-facility menus independent', () => {
    assert.deepEqual(getTownMenusForCategory('pvp').map(({ label }) => label), [
      '콜로세움 전투',
      '콜로세움 교환소',
    ]);
    assert.deepEqual(getTownMenusForCategory('special').map(({ label }) => label), [
      '오브 교환소',
      '상자 열기',
      '전투 정보실',
      '신전 거리',
    ]);
  });

  it('uses final approved names and omits excluded features', () => {
    const labels = TOWN_MENUS.map(({ label }) => label);
    assert.equal(labels.includes('일반상점'), true);
    assert.equal(labels.includes('카드 강화'), true);
    assert.equal(labels.includes('카드 변화'), true);
    assert.equal(labels.includes('클라리스의 재봉실'), true);
    assert.equal(labels.includes('마을 신문'), false);
    assert.equal(labels.includes('스토리 아이템'), false);
    assert.equal(labels.includes('자경단 검문소'), false);
  });

  it('searches menu labels across categories without changing catalog order', () => {
    assert.deepEqual(searchTownMenus('교환').map(({ label }) => label), [
      '낚시 교환소',
      '콜로세움 교환소',
      '교환상점',
      '특별 교환상점',
      '소울 에코 교환',
      '오브 교환소',
    ]);
    assert.deepEqual(searchTownMenus('  카드 ', 'card').map(({ label }) => label), [
      '카드 감정',
      '카드 강화',
      '카드 변화',
      '카드 판매',
    ]);
  });

  it('finds a menu by its stable id', () => {
    assert.equal(getTownMenuById('raidInfo')?.label, '전투 정보실');
    assert.equal(getTownMenuById('does-not-exist'), undefined);
  });
});
