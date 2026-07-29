import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../styles/theme';

export type AutomationMapEditorTab = 'SELECTED' | 'CATALOG';

type Props = {
  activeTab: AutomationMapEditorTab;
  selectedCount: number;
  onChange: (tab: AutomationMapEditorTab) => void;
};

export function AutomationMapEditorTabs({ activeTab, selectedCount, onChange }: Props) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      <Tab
        active={activeTab === 'SELECTED'}
        accessibilityLabel={`선택 맵 ${selectedCount}개 탭`}
        label={`선택 맵 ${selectedCount}`}
        onPress={() => onChange('SELECTED')}
      />
      <Tab
        active={activeTab === 'CATALOG'}
        accessibilityLabel="맵 추가 탭"
        label="맵 추가"
        onPress={() => onChange('CATALOG')}
      />
    </View>
  );
}

function Tab({ active, accessibilityLabel, label, onPress }: {
  active: boolean;
  accessibilityLabel: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.activeTab]}
    >
      <Text style={[styles.tabText, active && styles.activeTabText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    padding: 4,
  },
  tab: {
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  activeTab: { backgroundColor: theme.colors.accentGreen },
  tabText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '900' },
  activeTabText: { color: theme.colors.buttonText },
});
