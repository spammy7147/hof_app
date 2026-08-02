import type { TownMenuId } from '../../domain/townMenus';
import type { TownApiPath } from '../../types/api';

type TownPanelModes = {
  fishing: 'fishing' | 'exchange';
  shop: 'general' | 'sundries' | 'dark' | 'sell' | 'combine';
  auction: 'auction' | 'market';
  card: 'identify' | 'upgrade' | 'change' | 'sell' | 'soul-echo';
  reward: 'orbs' | 'stash';
  crafting: 'workbase' | 'refine' | 'create' | 'veteran' | 'claris';
  agency: 'adventure' | 'recruitment';
  home: 'home' | 'rest';
  exchange: 'emblem' | 'event' | 'legacy' | 'ann';
  colosseum: 'battle' | 'shop';
  raid: 'raid';
  pantheon: 'street';
};

type TownPanelName = keyof TownPanelModes;
type TownPanelRoute = {
  [TPanel in TownPanelName]: {
    panel: TPanel;
    mode: TownPanelModes[TPanel];
  /** 이 메뉴가 최초 조회할 고정 typed endpoint다. */
    apiPath: TownApiPath | '/api/quests';
    virtualized: boolean;
  }
}[TownPanelName];

/**
 * 승인된 33개 메뉴의 유일한 화면/API 연결표다.
 *
 * `Record<TownMenuId, ...>`를 유지해 메뉴가 추가되거나 삭제될 때 컴파일 단계에서
 * 누락과 임의 fallback을 막는다. 동적 상세 endpoint는 각 panel 내부에서만 파생한다.
 */
export const TOWN_PANEL_REGISTRY = {
  fishing: route('fishing', 'fishing', '/api/town/fishing', false),
  fishingExchange: route('fishing', 'exchange', '/api/town/fishing-exchange', true),
  restRoom: route('home', 'rest', '/api/town/rest', true),

  generalShop: route('shop', 'general', '/api/town/shops/general', true),
  sundriesShop: route('shop', 'sundries', '/api/town/shops/sundries', true),
  darkShop: route('shop', 'dark', '/api/town/shops/dark', true),
  sell: route('shop', 'sell', '/api/town/sell', true),
  combine: route('shop', 'combine', '/api/town/combine', false),
  auction: route('auction', 'auction', '/api/town/auction', true),
  auctionMarket: route('auction', 'market', '/api/town/auction-market', true),

  colosseumBattle: route('colosseum', 'battle', '/api/town/pvp/colosseum', true),
  colosseumExchange: route('colosseum', 'shop', '/api/town/pvp/colosseum-shop', true),

  adventureAgency: route('agency', 'adventure', '/api/quests', true),
  talentAgency: route('agency', 'recruitment', '/api/town/agency/recruitment', true),

  homeManagement: route('home', 'home', '/api/town/home', true),
  workbase: route('crafting', 'workbase', '/api/town/crafting/workbase', true),

  refineWorkshop: route('crafting', 'refine', '/api/town/crafting/refine', true),
  createWorkshop: route('crafting', 'create', '/api/town/crafting/create', true),
  veteranSmithy: route('crafting', 'veteran', '/api/town/crafting/veteran', true),

  emblemShop: route('exchange', 'emblem', '/api/town/exchanges/emblem', true),
  eventShop: route('exchange', 'event', '/api/town/exchanges/event', true),
  sewingShop: route('crafting', 'claris', '/api/town/crafting/claris', true),
  legacyShop: route('exchange', 'legacy', '/api/town/exchanges/legacy', true),
  annShop: route('exchange', 'ann', '/api/town/exchanges/ann', true),

  cardIdentify: route('card', 'identify', '/api/town/cards/identify', true),
  cardUpgrade: route('card', 'upgrade', '/api/town/cards/upgrade', true),
  cardChange: route('card', 'change', '/api/town/cards/change', true),
  cardSell: route('card', 'sell', '/api/town/cards/sell', true),
  soulEcho: route('card', 'soul-echo', '/api/town/cards/soul-echo', true),

  orbExchange: route('reward', 'orbs', '/api/town/rewards/orbs', true),
  stash: route('reward', 'stash', '/api/town/rewards/stash', true),
  raidInfo: route('raid', 'raid', '/api/town/raid', true),
  pantheon: route('pantheon', 'street', '/api/town/pantheon', true),
} as const satisfies Record<TownMenuId, TownPanelRoute>;

function route<TPanel extends TownPanelName>(
  panel: TPanel,
  mode: TownPanelModes[TPanel],
  apiPath: TownPanelRoute['apiPath'],
  virtualized: boolean,
) {
  return { panel, mode, apiPath, virtualized } as const;
}
