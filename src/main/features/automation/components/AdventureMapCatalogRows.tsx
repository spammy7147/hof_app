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
        <Text numberOfLines={2} style={styles.groupName}>{group.name}</Text>
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
  const metadata = [
    map.recommendedLevel?.trim() || null,
    ...constraints
      .filter(({ key, label }) => label !== state.label && !(key === 'UNLIMITED' && state.kind === 'UNLIMITED'))
      .map(({ label }) => label),
  ].filter((detail, index, details): detail is string => Boolean(detail) && details.indexOf(detail) === index).join(' · ');

  return (
    <Pressable
      accessibilityLabel={`${map.name} 모험맵 ${selected ? '선택 해제' : '선택'}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={() => { if (!disabled) onPress(); }}
      style={[styles.map, selected && styles.mapSelected, disabled && styles.disabled]}
    >
      <View style={styles.mapHeading}>
        <Text numberOfLines={2} style={styles.mapName}>{map.name}</Text>
        <Text style={state.kind === 'RUNNABLE' || state.kind === 'UNLIMITED' ? styles.runnable : styles.state}>{state.label}</Text>
      </View>
      {selected || metadata ? (
        <View style={styles.metaRow}>
          {selected ? <Text style={styles.selectedMeta}>선택한 맵</Text> : null}
          {metadata ? <Text numberOfLines={1} style={styles.meta}>{metadata}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1 },
  disabled: { opacity: 0.55 },
  group: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.xs,
    minHeight: theme.control.touch,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    minWidth: theme.control.touch,
  },
  groupName: { color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: '800' },
  map: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing.xs,
    marginLeft: theme.spacing.md,
    minHeight: theme.control.input,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    minWidth: theme.control.touch,
  },
  mapHeading: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs, justifyContent: 'space-between' },
  mapName: { color: theme.colors.text, flex: 1, fontSize: theme.fontSize.body, fontWeight: '800' },
  mapSelected: {
    backgroundColor: 'rgba(124, 224, 181, 0.10)',
    borderColor: theme.colors.accentGreen,
    borderLeftWidth: 3,
  },
  meta: { color: theme.colors.textMuted, flexShrink: 1, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs, marginTop: theme.spacing.hairline },
  runnable: { color: theme.colors.accentGreen, fontSize: theme.fontSize.caption, fontWeight: '800' },
  selectedMeta: { color: theme.colors.accentGreen, fontSize: theme.fontSize.caption, fontWeight: '800' },
  state: { color: theme.colors.accentAmber, fontSize: theme.fontSize.caption, fontWeight: '800' },
});
