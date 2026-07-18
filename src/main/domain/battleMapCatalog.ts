import type { BattleCategoryResponse, BattleMapResponse } from '../types/api';
import { filterBattleAutomationCategories, filterBattleMapCatalog } from './battleMapAutomation';
import { orderBattleCategories } from './battleCategories';
import { buildBattleMapStateKey, groupBattleMaps, type BattleMapGroup } from './battleMaps';

export type BattleMapCatalogCategoryState = { loading: boolean; error: string | null };

export type BattleMapCatalogRow =
  | { kind: 'CATEGORY'; key: string; category: BattleCategoryResponse; expanded: boolean; mapCount: number | null }
  | { kind: 'STATE'; key: string; category: BattleCategoryResponse; state: 'loading' | 'error' | 'empty'; error: string | null }
  | { kind: 'GROUP'; key: string; group: BattleMapGroup; expanded: boolean }
  | { kind: 'MAP'; key: string; map: BattleMapResponse };

type BuildBattleMapCatalogRowsArgs = {
  categories: readonly BattleCategoryResponse[];
  catalog: readonly BattleMapResponse[];
  categoryStates: Readonly<Record<string, BattleMapCatalogCategoryState | undefined>>;
  expandedCategoryId: string | null;
  expandedGroupKeys: readonly string[];
  query: string;
};

export function buildBattleMapCatalogRows(
  args: BuildBattleMapCatalogRowsArgs,
): { rows: BattleMapCatalogRow[]; matchCount: number } {
  const categories = orderBattleCategories(
    filterBattleAutomationCategories(args.categories).filter(({ enabled }) => enabled),
  );
  const categoryIds = new Set(categories.map(({ id }) => id));
  const supportedCatalog = args.catalog.filter(({ categoryId }) => categoryIds.has(categoryId));
  const visibleMaps = filterBattleMapCatalog(supportedCatalog, args.query);
  const cachedMaps = filterBattleMapCatalog(supportedCatalog, '');
  const searching = args.query.trim().length > 0;
  const expandedGroups = new Set(args.expandedGroupKeys);
  const rows: BattleMapCatalogRow[] = [];

  for (const category of categories) {
    const maps = visibleMaps.filter(({ categoryId }) => categoryId === category.id);
    const allMaps = cachedMaps.filter(({ categoryId }) => categoryId === category.id);
    const resource = args.categoryStates[category.id];
    const loading = resource == null || resource.loading;

    if (searching && maps.length === 0) continue;

    const expanded = searching || args.expandedCategoryId === category.id;
    rows.push({
      kind: 'CATEGORY',
      key: `category:${category.id}`,
      category,
      expanded,
      mapCount: loading && allMaps.length === 0 ? null : allMaps.length,
    });
    if (!expanded) continue;

    if (loading && allMaps.length === 0) {
      rows.push({
        kind: 'STATE',
        key: `state:${category.id}:loading`,
        category,
        state: 'loading',
        error: null,
      });
      continue;
    }
    if (resource?.error) {
      rows.push({
        kind: 'STATE',
        key: `state:${category.id}:error`,
        category,
        state: 'error',
        error: resource.error,
      });
      if (allMaps.length === 0) continue;
    }

    const groups = groupBattleMaps(maps);
    if (groups.length === 0) {
      rows.push({
        kind: 'STATE',
        key: `state:${category.id}:empty`,
        category,
        state: 'empty',
        error: null,
      });
      continue;
    }
    for (const group of groups) {
      const groupExpanded = searching || expandedGroups.has(group.key);
      rows.push({ kind: 'GROUP', key: `group:${group.key}`, group, expanded: groupExpanded });
      if (!groupExpanded) continue;

      for (const map of group.maps) {
        rows.push({ kind: 'MAP', key: `map:${buildBattleMapStateKey(map)}`, map });
      }
    }
  }

  return { rows, matchCount: visibleMaps.length };
}
