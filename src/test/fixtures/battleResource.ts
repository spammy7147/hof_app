import type { BattleResource } from '../../main/features/battle/useBattleResource';

export function makeBattleResource(overrides: Partial<BattleResource> = {}): BattleResource {
  return {
    categories: [], loaded: true, loading: false, errorMessage: null,
    loadCategories: async () => undefined,
    loadMaps: async () => [],
    loadLogs: async () => [],
    run: async () => { throw new Error('예상하지 않은 전투 실행'); },
    loadStats: async () => { throw new Error('예상하지 않은 통계 조회'); },
    ...overrides,
  };
}
