import type { BattleMapResponse } from '../types/api';
import { buildQuestMapIdentity } from './questAutomation';

export type QuestMapCatalogMap = BattleMapResponse & { mapCode: string };

export type QuestMapCatalogCategory = {
  id: 'battle_map' | 'adventure_map';
  label: '전투맵' | '모험맵';
};

export type QuestMapCatalogGroup = {
  key: string;
  categoryId: QuestMapCatalogCategory['id'];
  name: string;
  groupOrder: number;
  recommendedLevel: string | null;
  mapCount: number;
  maps: QuestMapCatalogMap[];
};

export type QuestMapCatalogRow =
  | { kind: 'SELECTED_HEADING'; key: string; count: number }
  | { kind: 'SELECTED_MAP'; key: string; map: QuestMapCatalogMap }
  | {
    kind: 'CATEGORY';
    key: string;
    category: QuestMapCatalogCategory;
    expanded: boolean;
    mapCount: number;
    groupCount: number;
  }
  | { kind: 'GROUP'; key: string; categoryId: QuestMapCatalogCategory['id']; group: QuestMapCatalogGroup; expanded: boolean }
  | { kind: 'MAP'; key: string; categoryId: QuestMapCatalogCategory['id']; groupKey: string; map: QuestMapCatalogMap };

export type BuildQuestMapCatalogRowsArgs = {
  catalog: readonly BattleMapResponse[];
  selectedMapIdentities: readonly string[];
  expandedCategoryIds: readonly string[];
  expandedGroupKeys: readonly string[];
  query: string;
};

const CATEGORIES: readonly QuestMapCatalogCategory[] = [
  { id: 'battle_map', label: '전투맵' },
  { id: 'adventure_map', label: '모험맵' },
];

export function buildQuestMapCatalogRows({
  catalog,
  selectedMapIdentities,
  expandedCategoryIds,
  expandedGroupKeys,
  query,
}: BuildQuestMapCatalogRowsArgs): { rows: QuestMapCatalogRow[]; matchCount: number } {
  const canonicalMaps = catalog
    .map((map, sourceIndex) => ({ map, sourceIndex }))
    .filter((item): item is { map: QuestMapCatalogMap; sourceIndex: number } => isSupportedMap(item.map))
    .sort(compareCatalogItems)
    .map(({ map }) => map);
  const mapsByIdentity = new Map(canonicalMaps.map((map) => [buildQuestMapIdentity(map), map]));
  const selectedIdentities = new Set<string>();
  const selectedMaps: QuestMapCatalogMap[] = [];

  for (const identity of selectedMapIdentities) {
    if (selectedIdentities.has(identity)) continue;
    const map = mapsByIdentity.get(identity);
    if (map == null) continue;
    selectedIdentities.add(identity);
    selectedMaps.push(map);
  }

  const needle = normalizeSearch(query);
  const searching = needle.length > 0;
  const manuallyExpandedCategories = new Set(expandedCategoryIds);
  const manuallyExpandedGroups = new Set(expandedGroupKeys);
  const remainingMaps = canonicalMaps.filter((map) => !selectedIdentities.has(buildQuestMapIdentity(map)));
  const rows: QuestMapCatalogRow[] = [];

  if (selectedMaps.length > 0) {
    rows.push({ kind: 'SELECTED_HEADING', key: 'selected-heading', count: selectedMaps.length });
    for (const map of selectedMaps) {
      rows.push({
        kind: 'SELECTED_MAP',
        key: `selected-map:${encodePart(buildQuestMapIdentity(map))}`,
        map,
      });
    }
  }

  let matchCount = 0;
  for (const category of CATEGORIES) {
    const maps = remainingMaps.filter((map) => (
      map.categoryId === category.id && matchesQuery(map, category.label, needle)
    ));
    if (maps.length === 0) continue;

    const groups = groupMaps(maps, category.id);
    const categoryExpanded = searching || manuallyExpandedCategories.has(category.id);
    matchCount += maps.length;
    rows.push({
      kind: 'CATEGORY',
      key: `category:${category.id}`,
      category,
      expanded: categoryExpanded,
      mapCount: maps.length,
      groupCount: groups.length,
    });
    if (!categoryExpanded) continue;

    for (const group of groups) {
      const groupExpanded = searching || manuallyExpandedGroups.has(group.key);
      rows.push({
        kind: 'GROUP',
        key: `group:${group.key}`,
        categoryId: category.id,
        group,
        expanded: groupExpanded,
      });
      if (!groupExpanded) continue;

      for (const map of group.maps) {
        rows.push({
          kind: 'MAP',
          key: `map:${encodePart(buildQuestMapIdentity(map))}`,
          categoryId: category.id,
          groupKey: group.key,
          map,
        });
      }
    }
  }

  return { rows, matchCount };
}

export function buildQuestMapCatalogGroupKey(
  categoryId: string,
  groupOrder: number,
  groupName: string | null,
): string {
  const name = groupName?.trim() || '기타';
  return [categoryId, String(groupOrder), name].map(encodePart).join('|');
}

function groupMaps(
  maps: readonly QuestMapCatalogMap[],
  categoryId: QuestMapCatalogCategory['id'],
): QuestMapCatalogGroup[] {
  const groups = new Map<string, QuestMapCatalogGroup>();

  for (const map of maps) {
    const name = map.groupName?.trim() || '기타';
    const key = buildQuestMapCatalogGroupKey(categoryId, map.groupOrder, name);
    const existing = groups.get(key);
    if (existing != null) {
      existing.maps.push(map);
      existing.mapCount += 1;
      if (!existing.recommendedLevel?.trim() && map.recommendedLevel?.trim()) {
        existing.recommendedLevel = map.recommendedLevel;
      }
      continue;
    }

    groups.set(key, {
      key,
      categoryId,
      name,
      groupOrder: map.groupOrder,
      recommendedLevel: map.recommendedLevel?.trim() ? map.recommendedLevel : null,
      mapCount: 1,
      maps: [map],
    });
  }

  return [...groups.values()];
}

function matchesQuery(map: QuestMapCatalogMap, categoryLabel: string, needle: string): boolean {
  if (!needle) return true;
  return normalizeSearch([
    map.name,
    map.groupName ?? '',
    map.recommendedLevel ?? '',
    categoryLabel,
    map.categoryId,
    map.mapCode,
  ].join(' ')).includes(needle);
}

function isSupportedMap(map: BattleMapResponse): map is QuestMapCatalogMap {
  return map.resolved
    && map.mapCode != null
    && (map.categoryId === 'battle_map' || map.categoryId === 'adventure_map');
}

function compareCatalogItems(
  left: { map: QuestMapCatalogMap; sourceIndex: number },
  right: { map: QuestMapCatalogMap; sourceIndex: number },
): number {
  return compareOrder(left.map.groupOrder, right.map.groupOrder)
    || compareOrder(left.map.mapOrder, right.map.mapOrder)
    || compareText(left.map.name, right.map.name)
    || compareText(left.map.mapCode, right.map.mapCode)
    || left.sourceIndex - right.sourceIndex;
}

function compareOrder(left: number, right: number): number {
  const normalizedLeft = Number.isFinite(left) ? left : Number.MAX_SAFE_INTEGER;
  const normalizedRight = Number.isFinite(right) ? right : Number.MAX_SAFE_INTEGER;
  return normalizedLeft - normalizedRight;
}

function compareText(left: string | null | undefined, right: string | null | undefined): number {
  const normalizedLeft = left?.trim() ?? '';
  const normalizedRight = right?.trim() ?? '';
  if (!normalizedLeft && normalizedRight) return 1;
  if (normalizedLeft && !normalizedRight) return -1;
  return normalizedLeft.localeCompare(normalizedRight, 'ko-KR');
}

function normalizeSearch(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}
