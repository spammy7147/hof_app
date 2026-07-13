import type { ImageSource } from 'expo-image';

import type { TownIconId } from '../domain/townMenus';

/** APK에서 가져온 마을 아이콘을 Expo 번들에 정적으로 포함한다. */
export const TOWN_ICON_SOURCES: Record<TownIconId, ImageSource> = {
  fish: require('../../../assets/town/fish.gif'),
  coin: require('../../../assets/town/coin.gif'),
  potion: require('../../../assets/town/potion.png'),
  box: require('../../../assets/town/box.gif'),
  card: require('../../../assets/town/card.gif'),
  sewing: require('../../../assets/town/sewing.gif'),
  book: require('../../../assets/town/book.gif'),
  smith: require('../../../assets/town/smith.gif'),
};
