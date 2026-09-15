import type * as Api from '../../main/types/api';
import type { TownApi } from '../../main/features/town/api/townApi';
import { makeBattleResource } from '../fixtures/battleResource';

const stamp = '2026-09-15T00:00:00Z';
const many = <T,>(make: (index: number) => T) => Array.from({ length: 60 }, (_, index) => make(index + 1));
export const navigationMutations: string[] = [];
export const rejectNavigationMutation = async (name = '설정 변경'): Promise<never> => {
  navigationMutations.push(name);
  console.error(`NAVIGATION_MUTATION: ${name}`);
  throw new Error('로컬 탐색 검증에서 변경 요청이 발생했습니다.');
};
const types: Api.AutomationType[] = ['QUEST', 'HOME_QUEST', 'BATTLE_MAP', 'ADVENTURE_MAP', 'RAID', 'UNION', 'FISHING'];
export const navigationAutomation: Api.TypedAutomationAggregateResponse = {
  entries: Array.from({ length: 24 }, (_, index) => ({
    id: index + 1, type: types[index] ?? 'BATTLE_MAP', priority: index, enabled: true, ready: true,
    displayName: index >= 7 ? `검증 전투맵 ${index}` : null,
    warnings: [], quests: [], homeQuests: [], battleMaps: [], adventureMaps: [], battleMapProgress: [],
    fishingMaps: [], unionMaps: [], raidTargets: [],
  })),
  runtime: { lifecycle: 'STOPPED', stopReason: null, nextAttemptAt: null, warnings: [], lastError: null, currentAction: null,
    dailyRefresh: { status: 'COMPLETE', refreshDate: '2026-09-15', refreshedAt: stamp } },
};
export const navigationHistory = async (cursor?: number): Promise<Api.AutomationHistoryPage> => ({
  nextCursor: cursor == null ? 1 : null,
  cycles: [{ id: cursor == null ? 2 : 1, result: 'IDLE', selectedEntryId: null, startedAt: stamp, finishedAt: stamp,
    events: many(index => ({ id: index + (cursor == null ? 100 : 0), sequence: index, entryId: 1, type: 'QUEST',
      entryDisplayName: `검증 판단 ${index}`, kind: 'SKIPPED', reasonCode: 'NO_RUNNABLE_ACTION', message: '현재 실행할 행동이 없습니다.',
      targetKey: null, targetName: null, actionKind: null, presetId: null, presetName: null, nextRunAt: null, occurredAt: stamp })) }],
});
export const navigationQuests: Api.QuestSnapshot[] = many(index => ({
  questKey: `quest-${index}`, displayCode: String(index), name: `검증 퀘스트 ${index}`, state: 'AVAILABLE', section: 'AVAILABLE',
  sourceOrder: index, missions: [], actionNo: null, rewards: ['검증 보상'],
}));
const side = { hpCurrent: 0, hpMax: 100, survivorsAlive: 0, survivorsMax: 3, totalDamage: 50, turnCurrent: 12, turnMax: 12 };
const logs: Api.BattleLogResponse[] = many(index => ({
  id: index, accountId: 1, categoryId: 'adventure_map', mapCode: `map-${index}`, mapName: `검증 모험맵 ${index}`,
  characterIds: ['1'], characterNames: ['소셜'], outcome: ['VICTORY','DEFEAT','DRAW'][index % 3], title: '검증 전투', turns: 12,
  funds: 100, experience: 100, loots: [], quest: null, enemy: side, ally: side,
  rawLogUrl: 'http://127.0.0.1:8766/battle-log.html', createdAt: stamp,
}));
export const navigationBattle = makeBattleResource({
  categories: ['battle_map', 'adventure_map', 'union'].map((id, order) => ({ id, label: id, description: '로컬 검증 맵', order, enabled: true })),
  loadMaps: async categoryId => many(index => ({ categoryId, mapCode: `map-${index}`, name: `검증 맵 ${index}`,
    groupName: categoryId === 'battle_map' ? '낚시 검증' : '검증', groupOrder: 0, mapOrder: index,
    recommendedLevel: null, availableCount: 10, attemptCount: 0, winCount: 0, cooldownRemainingText: null, cooldownRemainingSeconds: null,
    keyMode: 'NOT_REQUIRED', keyCount: null, requiredTime: 10, supportsThreeBattles: true, enabled: true, resolved: true, iconUrl: null, rawHref: '' })),
  loadStats: async () => ({ accountId: 1, dailyFunds: 100, weeklyFunds: 700, monthlyFunds: 3000,
    adventureMapOutcomes: many(index => ({ mapCode: `map-${index}`, mapName: `검증 모험맵 ${index}`, defeats: index, draws: 1 })) }),
  loadLogs: async query => logs.filter(log => !query?.outcome || log.outcome === query.outcome)
    .slice(query?.offset ?? 0, (query?.offset ?? 0) + (query?.limit ?? 40)),
  run: () => rejectNavigationMutation('전투'),
});
const rows = many(index => ({ id: String(index), label: `검증 품목 ${index}`, selectable: true, detail: '긴 목록 스크롤 검증',
  imageUrl: null, price: 100, quantity: 100, cost: 100, owned: 100, type: 'Item', materials: ['재료'], minQuantity: 1, maxQuantity: 100,
  workSeconds: 60 }));
const categories = [{ id: 'category', label: '검증 분류', current: true }];
const cards: Api.CardItemResponse[] = rows.map(row => ({ ...row, rarity: '일반', restrictions: [], blankCardValue: 1, maxQuantity: 100 }));
const auctionListings: Api.AuctionListingResponse[] = rows.map(row => ({
  rowKey: row.id, candidateId: row.id, actionId: 'fixture', listingId: row.id, name: row.label, type: 'Item', quantity: 10,
  totalPrice: 1000, unitPrice: 100, action: 'BID', kind: 'CURRENT',
}));
const result = null;
export const navigationTownData: Record<string, unknown> = {
  '/api/town/fishing': { notice: many(i => `낚시 상태 ${i}`).join('\n'), remainingCasts: 10, waterStatus: 'WAITING', baitCount: 100,
    shiningBaitCount: 2, escapeSeconds: null, combo: null, locationName: '검증 낚시터', primaryAction: 'NONE', availableActions: [],
    lastOutcome: null, blockedByBattle: false, battleTarget: null, catches: [], result } satisfies Api.FishingResponse,
  '/api/town/fishing-exchange': { categories, currentCategoryId: 'category', items: rows, result } satisfies Api.FishingExchangeResponse,
  '/api/town/sell': { items: rows, result } satisfies Api.SellResponse,
  '/api/town/combine': { primary: rows, secondarySlots: [rows, rows, rows], result } satisfies Api.CombineResponse,
  '/api/town/auction': { listings: auctionListings, actions: ['BROWSE'], capabilities: { bidActionId: 'fixture', exhibitEntryActionId: 'fixture', claimItemActionId: null, claimFundsActionId: null }, result } satisfies Api.AuctionResponse,
  '/api/town/auction-market': { items: rows.map(row => ({ itemKey: row.id, name: row.label, type: 'Item', latestUnitPrice: 100, averageUnitPrice: 100, minimumUnitPrice: 100, maximumUnitPrice: 100, tradeCount: 1, volume: 1, points: [] })), generatedAt: stamp } satisfies Api.AuctionMarketResponse,
  '/api/town/cards/identify': { cards, selectionSlots: 1, result } satisfies Api.CardIdentifyResponse,
  '/api/town/cards/sell': { cards, multiSelect: true, rewardKind: 'BLANK_CARD', blankCardsOwned: 100, result } satisfies Api.CardSellResponse,
  '/api/town/cards/soul-echo': { categories, currentCategoryId: 'category', recipes: rows.map(row => ({ ...row, category: 'category', requiredEchoes: ['검증'], successBonus: 1 })), ownedEchoes: [], history: [], result } satisfies Api.SoulEchoResponse,
  '/api/town/rewards/stash': { boxes: rows, actions: [], result } satisfies Api.StashResponse,
  '/api/town/rewards/orbs': { displayedOrbs: { red: 10, blue: 10, green: 10 }, orbCountsEstimated: false, remainingRewards: 60, rewardMonth: '2026-09', rewards: rows.map(row => ({ key: row.id, label: row.label, remaining: 1, unlimited: false })), actions: [], outcomes: [], lastAction: null, result } satisfies Api.OrbExchangeResponse,
  '/api/town/agency/recruitment': { currentCharacters: 65, capacity: 100, jobs: rows.map(row => ({ id: row.id, name: row.label, price: 100, imageUrl: null })), genders: [{ id: 'M', label: '남' }], nameMinLength: 1, nameMaxLength: 16, recruitmentAvailable: true, result } satisfies Api.RecruitmentResponse,
  '/api/town/home': { mode: 'HOME', quests: rows.map(row => ({ id: row.id, name: row.label, state: 'AVAILABLE', mission: '검증', reward: '검증', details: [], actionId: null })), actions: [], restStatus: null, result } satisfies Api.HomeResponse,
  '/api/town/rest': { mode: 'REST', quests: [], actions: [], restStatus: { currentTime: 100, maxTime: 1000, baseRecovery: 10, facilityRecovery: 10, usedToday: false, facilities: many(i => `시설 ${i}`) }, result } satisfies Api.HomeResponse,
  '/api/town/pvp/colosseum': { fighters: rows.map(row => ({ ...row, selected: false })), selectedTeam: [], minTeamSize: 1, maxTeamSize: 3, opponents: rows, battleResult: null, result } satisfies Api.ColosseumBattleResponse,
  '/api/town/pvp/colosseum-shop': { categories, currentCategoryId: 'category', items: rows, currencies: [], result } satisfies Api.ColosseumShopResponse,
  '/api/town/raid': { raids: rows.map(row => ({ id: row.id, name: row.label, playable: true, difficulty: '검증', maxPartySize: 3, rewardDamage: null, status: 'RECRUITING', statusText: '모집 중', waitSeconds: null, applicants: [], joined: false, actions: [], battleTarget: null })), applied: false, applyWait: false, applyWaitSeconds: null, myStatus: null, globalActions: [], result } satisfies Api.RaidPubResponse,
  '/api/town/pantheon': { shrines: rows.map(row => ({ id: row.id, name: row.label, alias: null, color: null, imageUrl: null, actions: [] })) } satisfies Api.PantheonStreetResponse,
};
for (const mode of ['general', 'sundries', 'dark'] as const) navigationTownData[`/api/town/shops/${mode}`] = { shopId: mode, items: rows, stale: false, lastVerifiedAt: stamp, result } satisfies Api.ShopResponse;
for (const mode of ['upgrade', 'change']) navigationTownData[`/api/town/cards/${mode}`] = { selectionSlots: [{ id: 'base', label: '기본 카드' }, { id: 'material', label: '재료 카드' }], baseCards: cards, materialCards: cards, minQuantity: 1, maxQuantity: 100, selectedBaseCandidateId: null, history: [], result } satisfies Api.CardPairResponse;
for (const mode of ['workbase', 'claris', 'refine', 'create', 'veteran'] as const) navigationTownData[`/api/town/crafting/${mode}`] = { mode: ({workbase:'WORKBASE',claris:'CLARIS',refine:'REFINE',create:'CREATE',veteran:'VETERAN'} as const)[mode], categories, currentCategoryId: 'category', rows, minQuantity: 1, maxQuantity: 100, activeJob: null, allowedRefineCounts: [1], additionalMaterials: rows, additionalMaterialsOptional: true, warningCode: null, history: many(i => `검증 제련 기록 ${i}`), result } satisfies Api.CraftingResponse;
for (const mode of ['emblem', 'event', 'legacy', 'ann'] as const) navigationTownData[`/api/town/exchanges/${mode}`] = { mode: ({emblem:'EMBLEM',event:'EVENT',legacy:'LEGACY',ann:'ANN'} as const)[mode], categories, currentCategoryId: 'category', rows, ownedCurrencies: [], gradeActions: [], annActions: [{ type: 'GIVE_GIFT', label: '검증', rows }], warning: null, history: [], result } satisfies Api.ExchangeResponse;
export const navigationTown: TownApi = {
  load: async <T,>(path: Api.TownApiPath): Promise<T> => {
    const data = navigationTownData[path.split('?')[0]];
    if (!data) throw new Error(`누락된 검증 데이터: ${path}`);
    return data as T;
  },
  submit: async <TRequest, TResponse>(path: Api.TownApiPath, _request: TRequest): Promise<TResponse> => {
    // 출품 준비는 읽기 성격의 로컬 화면 전환만 재현한다. 확정 요청은 모두 감시한다.
    if (path.endsWith('/exhibit/open')) return { items: auctionListings, durations: [{ value: '1', label: '1일' }], entryActionId: 'fixture', actionId: 'fixture', result } satisfies Api.AuctionExhibitResponse as TResponse;
    return rejectNavigationMutation(path);
  },
  loadQuests: async () => navigationQuests,
  acceptQuest: () => rejectNavigationMutation('퀘스트 수락'),
  claimQuest: () => rejectNavigationMutation('퀘스트 완료'),
};
