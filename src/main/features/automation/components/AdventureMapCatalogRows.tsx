import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';

import {
  describeAdventureMapConstraints,
  describeAdventureMapState,
} from '../../../domain/adventureMapAutomation';
import type {
  AdventureMapCatalogGroup,
  AdventureMapCatalogMap,
} from '../../../domain/adventureMapCatalog';
import { theme } from '../../../styles/theme';

type AdventureMapCatalogGroupRowProps = {
  group: AdventureMapCatalogGroup;
  expanded: boolean;
  interactionDisabled?: boolean;
  onPress: () => void;
};

export function AdventureMapCatalogGroupRow({
  group,
  expanded,
  interactionDisabled = false,
  onPress,
}: AdventureMapCatalogGroupRowProps) {
  const accessibilityLabel = interactionDisabled
    ? `${group.name} 그룹 검색 결과`
    : `${group.name} 그룹 ${expanded ? '닫기' : '열기'}`;
  const recommendedLevel = group.recommendedLevel?.trim();
  const details = [recommendedLevel ? `Lv ${recommendedLevel}` : null, `${group.maps.length}개`]
    .filter((detail): detail is string => detail != null)
    .join(' · ');

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={interactionDisabled ? { disabled: true, expanded } : { expanded }}
      disabled={interactionDisabled}
      onPress={() => { if (!interactionDisabled) onPress(); }}
      style={styles.group}
    >
      <View style={styles.copy}>
        <Text style={styles.groupName}>{group.name}</Text>
        <Text style={styles.meta}>{details}</Text>
      </View>
      {expanded
        ? <ChevronDown color={theme.colors.textMuted} size={18} />
        : <ChevronRight color={theme.colors.textMuted} size={18} />}
    </Pressable>
  );
}

type AdventureMapCatalogMapRowProps = {
  map: AdventureMapCatalogMap;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
};

export function AdventureMapCatalogMapRow({
  map,
  selected,
  disabled,
  onPress,
}: AdventureMapCatalogMapRowProps) {
  const state = describeAdventureMapState(map);
  const constraints = describeAdventureMapConstraints(map);
  const metadata = [map.recommendedLevel, state.detail].filter((detail): detail is string => Boolean(detail)).join(' · ');

  return (
    <Pressable
      accessibilityLabel={`${map.name} 모험맵 선택`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={() => { if (!disabled) onPress(); }}
      style={[styles.map, selected && styles.mapSelected, disabled && styles.disabled]}
    >
      <View style={styles.mapHeading}>
        <Text style={styles.mapName}>{map.name}</Text>
        <View style={styles.mapStatus}>
          <Text style={state.kind === 'RUNNABLE' || state.kind === 'UNLIMITED' ? styles.runnable : styles.state}>{state.label}</Text>
          {selected ? <Text style={styles.selected}>선택됨</Text> : null}
        </View>
      </View>
      {metadata ? <Text style={styles.meta}>{metadata}</Text> : null}
      <View style={styles.constraints}>
        {constraints.map((constraint) => (
          <Text key={constraint.key} style={styles.constraint}>{constraint.label}</Text>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  constraint: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
  },
  constraints: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  copy: { flex: 1 },
  disabled: { opacity: 0.55 },
  group: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
  },
  groupName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  map: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing.xs,
    marginLeft: theme.spacing.md,
    minHeight: 62,
    padding: theme.spacing.md,
  },
  mapHeading: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  mapName: { color: theme.colors.text, flex: 1, fontSize: 13, fontWeight: '800' },
  mapSelected: { backgroundColor: 'rgba(124, 224, 181, 0.10)', borderColor: theme.colors.accentGreen },
  mapStatus: { alignItems: 'flex-end', gap: 2 },
  meta: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  runnable: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '800' },
  selected: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '900' },
  state: { color: theme.colors.accentAmber, fontSize: 11, fontWeight: '800' },
});
