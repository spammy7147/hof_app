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
