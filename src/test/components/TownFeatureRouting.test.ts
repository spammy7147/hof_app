import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

import { TOWN_CATEGORIES, TOWN_MENUS } from '../../main/domain/townMenus';
import { TOWN_PANEL_REGISTRY } from '../../main/features/town/townPanelRegistry';

describe('마을 33개 기능 route 통합', () => {
  it('9개 분류와 33개 메뉴를 누락·중복 없이 각각 하나의 concrete panel/API에 연결한다', () => {
    assert.equal(TOWN_CATEGORIES.length, 9);
    assert.equal(TOWN_MENUS.length, 33);
    assert.deepEqual(Object.keys(TOWN_PANEL_REGISTRY).sort(), TOWN_MENUS.map(({ id }) => id).sort());

    for (const menu of TOWN_MENUS) {
      const route = TOWN_PANEL_REGISTRY[menu.id];
      assert.ok(route.panel.length > 0, `${menu.id} panel missing`);
      assert.ok(route.mode.length > 0, `${menu.id} mode missing`);
      assert.match(route.apiPath, /^\/api\/(?:town\/|quests$)/, `${menu.id} typed API missing`);
    }
  });

  it('모든 승인 메뉴의 최초 조회 endpoint를 고정한다', () => {
    assert.deepEqual(
      TOWN_MENUS.map(({ id }) => [id, TOWN_PANEL_REGISTRY[id].panel, TOWN_PANEL_REGISTRY[id].mode]),
      [
        ['fishing', 'fishing', 'fishing'], ['fishingExchange', 'fishing', 'exchange'], ['restRoom', 'home', 'rest'],
        ['generalShop', 'shop', 'general'], ['sundriesShop', 'shop', 'sundries'], ['darkShop', 'shop', 'dark'],
        ['sell', 'shop', 'sell'], ['combine', 'shop', 'combine'], ['auction', 'auction', 'auction'],
        ['auctionMarket', 'auction', 'market'], ['colosseumBattle', 'colosseum', 'battle'],
        ['colosseumExchange', 'colosseum', 'shop'], ['adventureAgency', 'agency', 'adventure'],
        ['talentAgency', 'agency', 'recruitment'], ['homeManagement', 'home', 'home'],
        ['workbase', 'crafting', 'workbase'], ['refineWorkshop', 'crafting', 'refine'],
        ['createWorkshop', 'crafting', 'create'], ['veteranSmithy', 'crafting', 'veteran'],
        ['emblemShop', 'exchange', 'emblem'], ['eventShop', 'exchange', 'event'],
        ['sewingShop', 'crafting', 'claris'], ['legacyShop', 'exchange', 'legacy'], ['annShop', 'exchange', 'ann'],
        ['cardIdentify', 'card', 'identify'], ['cardUpgrade', 'card', 'upgrade'], ['cardChange', 'card', 'change'],
        ['cardSell', 'card', 'sell'], ['soulEcho', 'card', 'soul-echo'], ['orbExchange', 'reward', 'orbs'],
        ['stash', 'reward', 'stash'], ['raidInfo', 'raid', 'raid'], ['pantheon', 'pantheon', 'street'],
      ],
    );
    assert.deepEqual(
      TOWN_MENUS.map(({ id }) => [id, TOWN_PANEL_REGISTRY[id].apiPath]),
      [
        ['fishing', '/api/town/fishing'],
        ['fishingExchange', '/api/town/fishing-exchange'],
        ['restRoom', '/api/town/rest'],
        ['generalShop', '/api/town/shops/general'],
        ['sundriesShop', '/api/town/shops/sundries'],
        ['darkShop', '/api/town/shops/dark'],
        ['sell', '/api/town/sell'],
        ['combine', '/api/town/combine'],
        ['auction', '/api/town/auction'],
        ['auctionMarket', '/api/town/auction-market'],
        ['colosseumBattle', '/api/town/pvp/colosseum'],
        ['colosseumExchange', '/api/town/pvp/colosseum-shop'],
        ['adventureAgency', '/api/quests'],
        ['talentAgency', '/api/town/agency/recruitment'],
        ['homeManagement', '/api/town/home'],
        ['workbase', '/api/town/crafting/workbase'],
        ['refineWorkshop', '/api/town/crafting/refine'],
        ['createWorkshop', '/api/town/crafting/create'],
        ['veteranSmithy', '/api/town/crafting/veteran'],
        ['emblemShop', '/api/town/exchanges/emblem'],
        ['eventShop', '/api/town/exchanges/event'],
        ['sewingShop', '/api/town/crafting/claris'],
        ['legacyShop', '/api/town/exchanges/legacy'],
        ['annShop', '/api/town/exchanges/ann'],
        ['cardIdentify', '/api/town/cards/identify'],
        ['cardUpgrade', '/api/town/cards/upgrade'],
        ['cardChange', '/api/town/cards/change'],
        ['cardSell', '/api/town/cards/sell'],
        ['soulEcho', '/api/town/cards/soul-echo'],
        ['orbExchange', '/api/town/rewards/orbs'],
        ['stash', '/api/town/rewards/stash'],
        ['raidInfo', '/api/town/raid'],
        ['pantheon', '/api/town/pantheon'],
      ],
    );
    assert.deepEqual(
      TOWN_MENUS.filter(({ id }) => !TOWN_PANEL_REGISTRY[id].virtualized).map(({ id }) => id),
      ['fishing', 'combine'],
    );
  });

  it('제외 기능과 준비 중 placeholder가 카탈로그·상세 shell에 없다', () => {
    assert.equal(
      TOWN_MENUS.some(({ label }) => /검문소|스토리 아이템|마을 신문|초코/.test(label)),
      false,
    );
    const detailShell = readFileSync(
      new URL('../../main/features/town/components/TownDetailShell.tsx', import.meta.url),
      'utf8',
    );
    const townScreen = readFileSync(
      new URL('../../main/screens/TownTabScreen.tsx', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(`${detailShell}\n${townScreen}`, /기능 연결을 준비하고 있습니다/);
  });
});
