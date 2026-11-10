import { BarChart3, Home, LucideIcon, Store, Swords, UsersRound } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MAIN_TABS, MainTabId } from '../domain/mainTabs';
import { theme } from '../styles/theme';

type BottomTabBarProps = {
  activeTabId: MainTabId;
  onChangeTab: (tabId: MainTabId) => void;
};

const tabIcons: Record<MainTabId, LucideIcon> = {
  home: Home,
  battle: Swords,
  characters: UsersRound,
  town: Store,
  data: BarChart3,
};

/**
 * 앱 하단의 고정 탭 바다.
 */
export function BottomTabBar({ activeTabId, onChangeTab }: BottomTabBarProps) {
  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        {MAIN_TABS.map((tab) => {
          const Icon = tabIcons[tab.id];
          const active = tab.id === activeTabId;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={tab.id}
              onPress={() => onChangeTab(tab.id)}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              <Icon
                color={active ? theme.colors.accentAmber : theme.colors.textMuted}
                size={21}
                strokeWidth={active ? 2.6 : 2}
              />
              <Text style={[styles.label, active && styles.activeLabel]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.accentAmberDark,
    backgroundColor: theme.colors.header,
    paddingBottom: 0,
    paddingTop: 0,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tab: {
    width: '20%',
    minHeight: theme.control.touch,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    minWidth: theme.control.touch,
  },
  pressed: {
    opacity: 0.75,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.caption,
    fontWeight: '800',
  },
  activeLabel: {
    color: theme.colors.accentAmber,
  },
});
