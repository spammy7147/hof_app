import type { BattleCategoryResponse } from '../types/api';

/**
 * 전투 카테고리를 화면 표시 순서로 정렬한다.
 *
 * @remarks
 * 사용 가능한 카테고리를 먼저 보여주고, 같은 상태에서는 서버의 order 값과 라벨 순서를 따른다.
 */
export function orderBattleCategories(
  categories: BattleCategoryResponse[],
): BattleCategoryResponse[] {
  return [...categories].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }

    if (isScenarioSeaCategory(left) && isUnionCategory(right)) return -1;
    if (isUnionCategory(left) && isScenarioSeaCategory(right)) return 1;

    const orderCompare = left.order - right.order;
    if (orderCompare !== 0) return orderCompare;

    return formatBattleCategoryLabel(left).localeCompare(formatBattleCategoryLabel(right), 'ko-KR');
  }).map((category) => ({
    ...category,
    label: formatBattleCategoryLabel(category),
  }));
}

/**
 * HOF 원본 카테고리명을 앱에서 쓰는 짧은 표시명으로 바꾼다.
 */
function formatBattleCategoryLabel(category: BattleCategoryResponse): string {
  if (isScenarioSeaCategory(category)) return '시나리오';
  return category.label;
}

/**
 * `시나리오-대해` 카테고리인지 확인한다.
 */
function isScenarioSeaCategory(category: BattleCategoryResponse): boolean {
  return category.label.replace(/\s+/g, '').includes('시나리오-대해');
}

/**
 * 유니온 카테고리인지 확인한다.
 */
function isUnionCategory(category: BattleCategoryResponse): boolean {
  return category.id.toLocaleLowerCase().includes('union') || category.label.includes('유니온');
}
