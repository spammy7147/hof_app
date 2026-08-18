export type MainTabId = 'home' | 'battle' | 'characters' | 'town' | 'data';

export type MainRouteId = MainTabId | 'settings';

export type MainTab = {
  id: MainTabId;
  label: string;
};

export const MAIN_TABS: MainTab[] = [
  { id: 'home', label: '홈' },
  { id: 'battle', label: '전투' },
  { id: 'characters', label: '캐릭' },
  { id: 'town', label: '마을' },
  { id: 'data', label: '데이터' },
];

export const DEFAULT_MAIN_TAB_ID: MainTabId = 'home';

/**
 * 문자열 tab id가 실제 메인 탭에 존재하는지 찾아준다.
 */
export function getMainTab(id: string): MainTab | undefined {
  return MAIN_TABS.find((tab) => tab.id === id);
}
