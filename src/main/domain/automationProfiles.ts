import type { BattleCategoryResponse } from '../types/api';

/** 퀘스트 자동화에서 지원하지 않는 유니온 카테고리를 제외한다. */
export function filterAutomationProfileCategories(
  categories: BattleCategoryResponse[],
): BattleCategoryResponse[] {
  return categories.filter(({ id, label }) => {
    const normalized = id.trim().toLowerCase();
    return !normalized.includes('union') && !label.includes('유니온');
  });
}
