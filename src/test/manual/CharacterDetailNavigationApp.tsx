import { useSyncExternalStore } from 'react';
import { registerRootComponent } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MainScreen } from '../../main/screens/MainScreen';
import { CharacterManagementHubModule } from '../../main/domain/characterManagementHubModule';
import { UnifiedAutomationController } from '../../main/domain/unifiedAutomationController';
import { makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';
import { makeBattleResource } from '../fixtures/battleResource';
import { makePartyPresetCatalogResource } from '../fixtures/partyPresetCatalog';

/** 별도 검증 앱의 진입점. 실제 화면·허브를 사용하고 모든 데이터는 로컬 fixture에서 공급한다. */
const characters = Array.from({ length: 65 }, (_, index) => makeHofCharacter(index + 1, {
  name: ['소셜', '사제', '조회 오류', '느린 조회', '검증 05', '목록 이동'][index] ?? `검증 ${String(index + 1).padStart(2, '0')}`,
  job: index % 2 === 0 ? 'Social Knight' : 'Cardinal',
  lifecycle: index === 63 ? 'MISSING' : index === 64 ? 'ARCHIVED' : 'ACTIVE',
  imageUrl: null,
}));
const recoveryJob = {
  id: 5, operationType: 'DEEP_SYNC' as const, targetCharacterId: 5, sourceCharacterId: null,
  status: 'FAILED' as const, collectionStatus: 'FAILED' as const, recoveryStatus: 'UNAVAILABLE' as const,
  deepSync: { characterId: 5, progress: [] }, transfer: null, message: '검증용 복구 확인',
  updatedAt: '2026-09-13T00:00:00Z', finishedAt: '2026-09-13T00:00:00Z',
};
const hub = new CharacterManagementHubModule({
  loadStoredDetail: async (id) => {
    if (id === 3) throw new Error('검증용 조회 오류');
    if (id === 4) await new Promise((resolve) => setTimeout(resolve, 15_000));
    if (id === 6) setTimeout(() => {
      hub.observeRoster(characters.map((character) => character.id === 6 ? { ...character, rosterOrder: 1000 } : character));
    }, 3_000);
    return makeHofCharacterDetail(id, {
      ...characters[id - 1], detailSyncedAt: new Date().toISOString(),
      equipment: [{ slot: 'weapon', part: '무기', name: '검증용 검', iconUrl: '', description: '', checked: true }],
      actionPatterns: [{ index: 0, judge: 'always', judgeText: '항상', quantity: '0', quantityText: '', skill: 'attack', skillText: '공격' }],
      patternOptions: [
        { type: 'CONDITION', value: 'always', label: '항상', category: null },
        { type: 'SKILL', value: 'attack', label: '공격', category: null },
      ],
      positionGuard: { positions: [{ value: 'front', checked: true }, { value: 'back', checked: false }], selectedPosition: 'front', guardValue: '1', guardText: '호위' },
    });
  },
  refreshAuthoritativeDetail: async (id) => makeHofCharacterDetail(id, { ...characters[id - 1], detailSyncedAt: new Date().toISOString() }),
  loadCurrentOperation: async (id) => id === 5 ? recoveryJob : null,
  previewRecovery: async () => ({
    jobId: 5, characterId: 5, confirmationToken: 'local-fixture', observedAt: '2026-09-13T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
    hofCharacterId: '5', name: '검증 05', patterns: [], equipment: [],
    positionGuard: { positions: [], selectedPosition: 'front', guardValue: '1', guardText: '호위' },
  }),
  previewTransfer: async (request) => ({ sourceCharacterId: request.sourceCharacterId, targetCharacterId: request.targetCharacterId, steps: [], issues: [], executable: true }),
  executeTransfer: async () => { throw new Error('검증 앱에서는 원격 설정을 적용하지 않습니다.'); },
});
hub.activate('navigation-fixture');
hub.observeRoster(characters);
const unavailable = async (): Promise<never> => { throw new Error('캐릭터 탭에서 탐색을 검증하세요.'); };
const automationController = new UnifiedAutomationController({
  fetch: unavailable, create: unavailable, delete: unavailable, reorder: unavailable,
  updateQuest: unavailable, updateBattle: unavailable, updateAdventure: unavailable,
  fetchQuests: async () => [], changeState: unavailable,
});
const battle = makeBattleResource();
const partyPresetCatalog = makePartyPresetCatalogResource({ folders: [], presets: [] });

function NavigationApp() {
  const characterHub = useSyncExternalStore(hub.subscribe, hub.getSnapshot, hub.getSnapshot);
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider>
    <MainScreen session={{ loggedIn: true }} status={null} notice={null} battle={battle}
      characterHub={characterHub} automationController={automationController} partyPresetCatalog={partyPresetCatalog}
      onOpenCaptcha={() => undefined} onLogout={() => undefined} onOpenLogin={() => undefined} />
  </SafeAreaProvider></GestureHandlerRootView>;
}

registerRootComponent(NavigationApp);
