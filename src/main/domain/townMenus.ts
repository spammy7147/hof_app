export type TownCategoryId =
  | 'life'
  | 'market'
  | 'pvp'
  | 'agency'
  | 'home'
  | 'smithy'
  | 'arcade'
  | 'card'
  | 'special';

export type TownCategoryFilterId = 'all' | TownCategoryId;

export type TownMenuId =
  | 'fishing'
  | 'fishingExchange'
  | 'restRoom'
  | 'generalShop'
  | 'sundriesShop'
  | 'darkShop'
  | 'sell'
  | 'combine'
  | 'auction'
  | 'auctionMarket'
  | 'colosseumBattle'
  | 'colosseumExchange'
  | 'adventureAgency'
  | 'talentAgency'
  | 'homeManagement'
  | 'workbase'
  | 'refineWorkshop'
  | 'createWorkshop'
  | 'veteranSmithy'
  | 'emblemShop'
  | 'eventShop'
  | 'sewingShop'
  | 'legacyShop'
  | 'annShop'
  | 'cardIdentify'
  | 'cardUpgrade'
  | 'cardChange'
  | 'cardSell'
  | 'soulEcho'
  | 'orbExchange'
  | 'stash'
  | 'raidInfo'
  | 'pantheon';

export type TownFeatureKind =
  | 'fishing'
  | 'shop'
  | 'auction'
  | 'card'
  | 'reward'
  | 'crafting'
  | 'home'
  | 'pvp'
  | 'agency'
  | 'exchange'
  | 'raid'
  | 'pantheon';

export type TownIconId =
  | 'fish'
  | 'coin'
  | 'potion'
  | 'box'
  | 'card'
  | 'sewing'
  | 'book'
  | 'smith';

export type TownCategory = {
  id: TownCategoryId;
  label: string;
};

export type TownMenu = {
  id: TownMenuId;
  categoryId: TownCategoryId;
  label: string;
  featureKind: TownFeatureKind;
  /** 직접 확인된 HOF menu code만 기록한다. null은 백엔드 위치 발견으로 해석한다. */
  apkMenu: string | null;
  iconId: TownIconId;
};

export const DEFAULT_TOWN_CATEGORY_ID: TownCategoryFilterId = 'all';

export const TOWN_CATEGORIES: readonly TownCategory[] = [
  { id: 'life', label: '생활' },
  { id: 'market', label: '시장' },
  { id: 'pvp', label: 'PVP' },
  { id: 'agency', label: '알선소' },
  { id: 'home', label: '자택' },
  { id: 'smithy', label: '대장간' },
  { id: 'arcade', label: '상점가' },
  { id: 'card', label: '카드 가게' },
  { id: 'special', label: '특수 시설' },
];

export const TOWN_MENUS: readonly TownMenu[] = [
  menu('fishing', 'life', '낚시터', 'fishing', 'fishing', 'fish'),
  menu('fishingExchange', 'life', '낚시 교환소', 'fishing', 'createF', 'fish'),
  menu('restRoom', 'life', '휴식처', 'home', null, 'book'),

  menu('generalShop', 'market', '일반상점', 'shop', 'buy', 'coin'),
  menu('sundriesShop', 'market', '잡화점', 'shop', 'buy2', 'potion'),
  menu('darkShop', 'market', '암흑상점', 'shop', 'sbuy', 'potion'),
  menu('sell', 'market', '판매', 'shop', null, 'coin'),
  menu('combine', 'market', '조합소', 'shop', null, 'potion'),
  menu('auction', 'market', '옥션', 'auction', null, 'coin'),
  menu('auctionMarket', 'market', '낙찰 시세', 'auction', null, 'coin'),

  menu('colosseumBattle', 'pvp', '콜로세움 전투', 'pvp', null, 'smith'),
  menu('colosseumExchange', 'pvp', '콜로세움 교환소', 'pvp', null, 'coin'),

  menu('adventureAgency', 'agency', '모험 알선소', 'agency', null, 'book'),
  menu('talentAgency', 'agency', '인재 알선소', 'agency', null, 'book'),

  menu('homeManagement', 'home', '자택 관리', 'home', null, 'book'),
  menu('workbase', 'home', '작업장-재봉틀', 'crafting', 'workbase', 'sewing'),

  menu('refineWorkshop', 'smithy', '제련공방', 'crafting', 'refine', 'smith'),
  menu('createWorkshop', 'smithy', '제작공방', 'crafting', 'create', 'smith'),
  menu('veteranSmithy', 'smithy', '장로대장간', 'crafting', 'refine2', 'smith'),

  menu('emblemShop', 'arcade', '교환상점', 'exchange', null, 'coin'),
  menu('eventShop', 'arcade', '특별 교환상점', 'exchange', null, 'coin'),
  menu('sewingShop', 'arcade', '클라리스의 재봉실', 'crafting', 'sewingshop', 'sewing'),
  menu('legacyShop', 'arcade', '유물 가게', 'exchange', null, 'smith'),
  menu('annShop', 'arcade', '앤의 가게', 'exchange', null, 'potion'),

  menu('cardIdentify', 'card', '카드 감정', 'card', 'cardshop', 'card'),
  menu('cardUpgrade', 'card', '카드 강화', 'card', 'cardmix', 'card'),
  menu('cardChange', 'card', '카드 변화', 'card', 'cardmix2', 'card'),
  menu('cardSell', 'card', '카드 판매', 'card', 'cardsell', 'card'),
  menu('soulEcho', 'card', '소울 에코 교환', 'card', null, 'card'),

  menu('orbExchange', 'special', '오브 교환소', 'reward', 'orbboxshop', 'potion'),
  menu('stash', 'special', '상자 열기', 'reward', 'stash', 'box'),
  menu('raidInfo', 'special', '전투 정보실', 'raid', 'raidpub', 'book'),
  menu('pantheon', 'special', '신전 거리', 'pantheon', null, 'book'),
];

/** 선택한 카테고리에 속한 마을 메뉴만 승인된 카탈로그 순서대로 반환한다. */
export function getTownMenusForCategory(categoryId: TownCategoryId): TownMenu[] {
  return TOWN_MENUS.filter((menuItem) => menuItem.categoryId === categoryId);
}

/** 카테고리와 정규화한 메뉴명 검색을 함께 적용하되 원래 카탈로그 순서를 유지한다. */
export function searchTownMenus(
  query: string,
  categoryId: TownCategoryFilterId = 'all',
): TownMenu[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
  return TOWN_MENUS.filter((menuItem) => (
    (categoryId === 'all' || menuItem.categoryId === categoryId)
    && (normalizedQuery.length === 0
      || menuItem.label.toLocaleLowerCase('ko-KR').includes(normalizedQuery))
  ));
}

/** 상세 route가 사용하는 안정적인 id로 메뉴를 조회한다. */
export function getTownMenuById(menuId: string): TownMenu | undefined {
  return TOWN_MENUS.find((menuItem) => menuItem.id === menuId);
}

function menu(
  id: TownMenuId,
  categoryId: TownCategoryId,
  label: string,
  featureKind: TownFeatureKind,
  apkMenu: string | null,
  iconId: TownIconId,
): TownMenu {
  return { id, categoryId, label, featureKind, apkMenu, iconId };
}
