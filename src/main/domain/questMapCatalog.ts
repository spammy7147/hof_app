import type { BattleMapResponse } from '../types/api';
import { buildQuestMapIdentity } from './questAutomation';

type QuestMapCatalogCategoryId = 'battle_map' | 'adventure_map';

export type QuestMapCatalogRow =
  | { kind: 'SELECTED_HEADING'; key: 'selected-heading' }
  | { kind: 'SELECTED_MAP'; key: string; map: BattleMapResponse }
  | {
    kind: 'CATEGORY';
    key: string;
    categoryId: QuestMapCatalogCategoryId;
    label: string;
    expanded: boolean;
    count: number;
  }
  | { kind: 'GROUP'; key: string; categoryId: string; groupKey: string; name: string; meta: string; expanded: boolean }
  | { kind: 'MAP'; key: string; map: BattleMapResponse };

type BuildQuestMapCatalogRowsArgs = {
  maps: BattleMapResponse[];
  selectedIdentities: Set<string>;
  expandedCategoryIds: Set<string>;
  expandedGroupKeys: Set<string>;
  query: string;
};

type CatalogCategory = { id: QuestMapCatalogCategoryId; label: string };
type CatalogGroup = {
  key: string;
  name: string;
  recommendedLevel: string | null;
  maps: BattleMapResponse[];
};

const CATEGORIES: readonly CatalogCategory[] = [
  { id: 'battle_map', label: '전투맵' },
  { id: 'adventure_map', label: '모험맵' },
];

export function buildQuestMapCatalogRows({
  maps,
  selectedIdentities,
  expandedCategoryIds,
  expandedGroupKeys,
  query,
}: BuildQuestMapCatalogRowsArgs): QuestMapCatalogRow[] {
  const canonicalMaps = maps
    .map((map, sourceIndex) => ({ map, sourceIndex }))
    .filter(({ map }) => isSupportedMap(map))
    .sort(compareCatalogItems)
    .map(({ map }) => map);
  const selectedMaps = canonicalMaps.filter((map) => isSelectedMap(map, selectedIdentities));
  const selectedMapIdentities = new Set(selectedMaps.map(buildQuestMapIdentity));
  const remainingMaps = canonicalMaps.filter((map) => !selectedMapIdentities.has(buildQuestMapIdentity(map)));
  const needle = normalizeSearch(query);
  const searching = needle.length > 0;
  const rows: QuestMapCatalogRow[] = [];

  if (selectedMaps.length > 0) {
    rows.push({ kind: 'SELECTED_HEADING', key: 'selected-heading' });
    for (const map of selectedMaps) {
      rows.push({
        kind: 'SELECTED_MAP',
        key: `selected-map:${buildMapRowIdentity(map)}`,
        map,
      });
    }
  }

  for (const category of CATEGORIES) {
    const categoryMaps = remainingMaps.filter((map) => (
      map.categoryId === category.id && matchesQuery(map, category.label, needle)
    ));
    if (categoryMaps.length === 0) continue;

    const expanded = searching || expandedCategoryIds.has(category.id);
    rows.push({
      kind: 'CATEGORY',
      key: `category:${category.id}`,
      categoryId: category.id,
      label: category.label,
      expanded,
      count: categoryMaps.length,
    });
    if (!expanded) continue;

    for (const group of groupMaps(categoryMaps)) {
      const groupExpanded = searching || expandedGroupKeys.has(group.key);
      rows.push({
        kind: 'GROUP',
        key: `group:${group.key}`,
        categoryId: category.id,
        groupKey: group.key,
        name: group.name,
        meta: buildGroupMeta(group),
        expanded: groupExpanded,
      });
      if (!groupExpanded) continue;

      for (const map of group.maps) {
        rows.push({ kind: 'MAP', key: `map:${buildMapRowIdentity(map)}`, map });
      }
    }
  }

  return rows;
}

export function buildQuestMapCatalogGroupKey(
  map: Pick<BattleMapResponse, 'categoryId' | 'groupOrder' | 'groupName'>,
): string {
  const name = map.groupName?.trim() || '기타';
  return [map.categoryId, String(map.groupOrder), name]
    .map((part) => `${part.length}:${part}`).join('|');
}

function groupMaps(maps: readonly BattleMapResponse[]): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup>();

  for (const map of maps) {
    const key = buildQuestMapCatalogGroupKey(map);
    const existing = groups.get(key);
    if (existing != null) {
      existing.maps.push(map);
      if (!existing.recommendedLevel && map.recommendedLevel?.trim()) {
        existing.recommendedLevel = map.recommendedLevel.trim();
      }
      continue;
    }
    groups.set(key, {
      key,
      name: map.groupName?.trim() || '기타',
      recommendedLevel: map.recommendedLevel?.trim() || null,
      maps: [map],
    });
  }

  return [...groups.values()];
}

function buildGroupMeta(group: CatalogGroup): string {
  return [group.recommendedLevel ? `Lv ${group.recommendedLevel}` : null, `${group.maps.length}개`]
    .filter((part): part is string => part != null)
    .join(' · ');
}

function matchesQuery(map: BattleMapResponse, categoryLabel: string, needle: string): boolean {
  if (!needle) return true;
  return normalizeSearch([
    map.name,
    map.groupName ?? '',
    map.recommendedLevel ?? '',
    categoryLabel,
    map.categoryId,
    map.mapCode ?? '',
  ].join(' ')).includes(needle);
}

function isSupportedMap(map: BattleMapResponse): boolean {
  return map.resolved && (map.categoryId === 'battle_map' || map.categoryId === 'adventure_map');
}

function isSelectedMap(map: BattleMapResponse, selectedIdentities: ReadonlySet<string>): boolean {
  return Boolean(map.mapCode?.trim()) && selectedIdentities.has(buildQuestMapIdentity(map));
}

function compareCatalogItems(
  left: { map: BattleMapResponse; sourceIndex: number },
  right: { map: BattleMapResponse; sourceIndex: number },
): number {
  return compareCategory(left.map.categoryId, right.map.categoryId)
    || compareOrder(left.map.groupOrder, right.map.groupOrder)
    || compareOrder(left.map.mapOrder, right.map.mapOrder)
    || compareText(left.map.name, right.map.name)
    || compareText(left.map.mapCode, right.map.mapCode)
    || left.sourceIndex - right.sourceIndex;
}

function compareCategory(left: string, right: string): number {
  return categoryOrder(left) - categoryOrder(right);
}

function categoryOrder(categoryId: string): number {
  if (categoryId === 'battle_map') return 0;
  if (categoryId === 'adventure_map') return 1;
  return 2;
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

function buildMapRowIdentity(map: BattleMapResponse): string {
  if (map.mapCode?.trim()) return encodePart(buildQuestMapIdentity(map));
  return [map.categoryId, String(map.groupOrder), String(map.mapOrder), map.name.trim()]
    .map(encodePart)
    .join('|');
}

function normalizeSearch(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}
