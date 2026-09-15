import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MainScreen } from '../../main/screens/MainScreen';
import { CharacterManagementHubModule } from '../../main/domain/characterManagementHubModule';
import { UnifiedAutomationController } from '../../main/domain/unifiedAutomationController';
import type { BattleLogResponse, BattleStatsResponse } from '../../main/types/api';
import { makeBattleResource } from '../fixtures/battleResource';
import { makePartyPresetCatalogResource } from '../fixtures/partyPresetCatalog';

/** 스크롤·상단 버튼의 실제 터치 검증용. 원격 API 대신 로컬 통계와 로그만 사용한다. */
const unavailable = async (): Promise<never> => { throw new Error('데이터 화면 검증용입니다.'); };
const hub = new CharacterManagementHubModule({
  loadStoredDetail: unavailable, refreshAuthoritativeDetail: unavailable,
  loadCurrentOperation: async () => null, previewTransfer: unavailable, executeTransfer: unavailable,
});
hub.activate('data-scroll-fixture');
const automation = new UnifiedAutomationController({
  fetch: unavailable, create: unavailable, delete: unavailable, reorder: unavailable,
  updateQuest: unavailable, updateBattle: unavailable, updateAdventure: unavailable,
  fetchQuests: async () => [], changeState: unavailable,
});
const stats: BattleStatsResponse = {
  accountId: 1, dailyFunds: 100, weeklyFunds: 700, monthlyFunds: 3000,
  adventureMapOutcomes: Array.from({ length: 60 }, (_, index) => ({
    mapCode: `map-${index + 1}`, mapName: `검증 모험맵 ${index + 1}`, defeats: index + 1, draws: 1,
  })),
};
const side = { hpCurrent: 0, hpMax: 100, survivorsAlive: 0, survivorsMax: 3, totalDamage: 50, turnCurrent: 12, turnMax: 12 };
const logs: BattleLogResponse[] = Array.from({ length: 120 }, (_, index) => ({
  id: index + 1, accountId: 1, categoryId: 'adventure_map', mapCode: `map-${index + 1}`,
  mapName: `검증 모험맵 ${index + 1}`, characterIds: ['1'], characterNames: ['검증 캐릭터'],
  outcome: ['VICTORY', 'DEFEAT', 'DRAW'][index % 3], title: '검증 전투', turns: 12,
  funds: 100, experience: 100, loots: [], quest: null, enemy: side, ally: side,
  rawLogUrl: null, createdAt: '2026-09-13T00:00:00Z',
}));
const battle = makeBattleResource({
  loadStats: async () => stats,
  loadLogs: async (query) => {
    const filtered = logs.filter((log) => !query?.outcome || log.outcome === query.outcome);
    return filtered.slice(query?.offset ?? 0, (query?.offset ?? 0) + (query?.limit ?? 40));
  },
});
const catalog = makePartyPresetCatalogResource({ folders: [], presets: [] });

function DataScreenScrollApp() {
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider>
    <MainScreen session={{ loggedIn: true }} status={null} notice={null} battle={battle}
      characterHub={hub.getSnapshot()} automationController={automation} partyPresetCatalog={catalog}
      onOpenCaptcha={() => undefined} onLogout={() => undefined} onOpenLogin={() => undefined} />
  </SafeAreaProvider></GestureHandlerRootView>;
}
registerRootComponent(DataScreenScrollApp);
