import type { BattleMapResponse } from '../types/api';
import { adventureMapIdentity, filterAdventureMapCatalog } from './adventureMapAutomation';

export type AdventureMapCatalogMap = BattleMapResponse & { mapCode: string };

export type AdventureMapCatalogGroup = {
  key: string;
  name: string;
  groupOrder: number;
  recommendedLevel: string | null;
  maps: AdventureMapCatalogMap[];
};

export type AdventureMapCatalogRow =
  | {
    kind: 'GROUP';
    key: string;
    group: AdventureMapCatalogGroup;
    expanded: boolean;
  }
  | {
    kind: 'MAP';
    key: string;
    groupKey: string;
    map: AdventureMapCatalogMap;
  };

type BuildAdventureMapCatalogRowsArgs = {
  catalog: readonly BattleMapResponse[];
  expandedGroupKeys: readonly string[];
  query: string;
};

export function buildAdventureMapCatalogRows({
  catalog,
  expandedGroupKeys,
  query,
}: BuildAdventureMapCatalogRowsArgs): { rows: AdventureMapCatalogRow[]; matchCount: number } {
  const maps = filterAdventureMapCatalog(catalog, query).filter(
    (map): map is AdventureMapCatalogMap => map.mapCode != null,
  );
  const searching = query.trim().length > 0;
  const manuallyExpandedGroups = new Set(expandedGroupKeys);
  const groups = new Map<string, AdventureMapCatalogGroup>();

  for (const map of maps) {
    const name = map.groupName?.trim() || '기타';
    const key = buildGroupKey(map.categoryId, map.groupOrder, name);
    const group = groups.get(key);

    if (group == null) {
      groups.set(key, {
        key,
        name,
        groupOrder: map.groupOrder,
        recommendedLevel: map.recommendedLevel,
        maps: [map],
      });
      continue;
    }

    group.maps.push(map);
    if (group.recommendedLevel == null && map.recommendedLevel != null) {
      group.recommendedLevel = map.recommendedLevel;
    }
  }

  const rows: AdventureMapCatalogRow[] = [];
  for (const group of groups.values()) {
    const expanded = searching || manuallyExpandedGroups.has(group.key);
    rows.push({ kind: 'GROUP', key: `group:${group.key}`, group, expanded });
    if (!expanded) continue;

    for (const map of group.maps) {
      rows.push({
        kind: 'MAP',
        key: `map:${encodePart(adventureMapIdentity(map))}`,
        groupKey: group.key,
        map,
      });
    }
  }

  return { rows, matchCount: maps.length };
}

function buildGroupKey(categoryId: string, groupOrder: number, groupName: string): string {
  return [categoryId, String(groupOrder), groupName].map(encodePart).join('|');
}

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}
