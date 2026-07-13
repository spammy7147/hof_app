export type TownSectionId = 'town' | 'quest';

export type TownCategoryId = 'life' | 'market' | 'card' | 'craft';

export type TownMenuId =
  | 'fishing'
  | 'fishingExchange'
  | 'generalShop'
  | 'darkShop'
  | 'auction'
  | 'auctionMarket'
  | 'stash'
  | 'cardMix'
  | 'cardChange'
  | 'blankExchange'
  | 'orbExchange'
  | 'sewingShop'
  | 'workbase'
  | 'veteranSmithy';

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
  apkMenu: string;
  iconId: TownIconId;
};

export const DEFAULT_TOWN_SECTION_ID: TownSectionId = 'town';
export const DEFAULT_TOWN_CATEGORY_ID: TownCategoryId = 'life';

export const TOWN_CATEGORIES: readonly TownCategory[] = [
  { id: 'life', label: '생활' },
  { id: 'market', label: '상점' },
  { id: 'card', label: '카드' },
  { id: 'craft', label: '제작' },
];

export const TOWN_MENUS: readonly TownMenu[] = [
  { id: 'fishing', categoryId: 'life', label: '낚시', apkMenu: 'fishing', iconId: 'fish' },
  { id: 'fishingExchange', categoryId: 'life', label: '낚시 교환소', apkMenu: 'createF', iconId: 'fish' },
  { id: 'generalShop', categoryId: 'market', label: '일반 상점', apkMenu: 'buy', iconId: 'coin' },
  { id: 'darkShop', categoryId: 'market', label: '암흑상점', apkMenu: 'sbuy', iconId: 'potion' },
  { id: 'auction', categoryId: 'market', label: '옥션', apkMenu: 'auction', iconId: 'coin' },
  { id: 'auctionMarket', categoryId: 'market', label: '낙찰 시세', apkMenu: 'auctionMarket', iconId: 'coin' },
  { id: 'stash', categoryId: 'market', label: '상자 열기', apkMenu: 'stash', iconId: 'box' },
  { id: 'cardMix', categoryId: 'card', label: '카드 합성', apkMenu: 'cardmix', iconId: 'card' },
  { id: 'cardChange', categoryId: 'card', label: '카드 변환', apkMenu: 'cardmix2', iconId: 'card' },
  { id: 'blankExchange', categoryId: 'card', label: '블랭크 교환', apkMenu: 'cardsell', iconId: 'card' },
  { id: 'orbExchange', categoryId: 'card', label: '오브 교환소', apkMenu: 'orbboxshop', iconId: 'potion' },
  { id: 'sewingShop', categoryId: 'craft', label: '재봉/리메이크', apkMenu: 'sewingshop', iconId: 'sewing' },
  { id: 'workbase', categoryId: 'craft', label: '개인 작업장', apkMenu: 'workbase', iconId: 'book' },
  { id: 'veteranSmithy', categoryId: 'craft', label: '장로 대장간', apkMenu: 'refine2', iconId: 'smith' },
];

/** 선택한 고정 카테고리에 속한 마을 메뉴만 APK 순서대로 반환한다. */
export function getTownMenusForCategory(categoryId: TownCategoryId): TownMenu[] {
  return TOWN_MENUS.filter((menu) => menu.categoryId === categoryId);
}
