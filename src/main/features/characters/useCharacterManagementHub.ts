import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import {
  CharacterManagementHubModule,
  type CharacterManagementHubBackend,
  type CharacterManagementObservationSink,
  type CharacterManagementHubResource,
} from '../../domain/characterManagementHubModule';
import type { BackendApiClient } from '../../services/backendApi';
import { deepSyncCharacter, restoreCharacter, executeCharacterTransfer, retryCharacterRecovery } from './characterOperations';

export type CharacterManagementHubApi = Pick<
  BackendApiClient,
  | 'fetchCharacterDetail'
  | 'refreshCharacterDetail'
  | 'executeCharacterCommand'
  | 'applyCharacterPattern'
  | 'loadSavedCharacterPattern'
  | 'deleteSavedCharacterPattern'
  | 'runManualSequence'
  | 'linkCharacter'
  | 'listCharacters'
  | 'archiveCharacter'
  | 'deleteCharacterPermanently'
  | 'previewCharacterTransfer'
  | 'fetchCurrentCharacterOperation'
  | 'fetchCharacterOperation'
  | 'previewCharacterRecovery'
  | 'acceptCharacterRecovery'
>;

export type CharacterManagementHubIntegration = {
  reloadRelatedPresets: () => Promise<void>;
  beginPatternEdit: () => Promise<void>;
};

export type CharacterManagementHubBinding = {
  resource: CharacterManagementHubResource;
  observations: CharacterManagementObservationSink;
};

/** Backend API와 앱 전역 projection을 캐릭터 관리 허브의 단일 외부 경계로 바꾼다. */
export function createCharacterManagementHubBackend(
  api: CharacterManagementHubApi,
  integration: CharacterManagementHubIntegration,
): CharacterManagementHubBackend {
  return {
    loadStoredDetail: (characterId) => api.fetchCharacterDetail(characterId),
    refreshAuthoritativeDetail: (characterId) =>
      api.refreshCharacterDetail(characterId),
    executeCommand: async (command) => {
      const result = await api.executeCharacterCommand(command);
      if (result.type === 'IdentityResolutionRequired') return result;
      if (result.type && result.type !== 'Completed') {
        if ('message' in result) throw new Error(result.message);
        throw new Error(
          '서버에서 캐릭터 설정이 변경되었습니다. 동기화 후 다시 시도해 주세요.',
        );
      }
      return result;
    },
    applyPattern: (request) => api.applyCharacterPattern(request),
    loadSavedPattern: (characterId, slotCode) =>
      api.loadSavedCharacterPattern(characterId, slotCode),
    deleteSavedPattern: (characterId, slotCode) =>
      api.deleteSavedCharacterPattern(characterId, slotCode),
    deepSync: (characterId, onProgress, onJob) =>
      deepSyncCharacter(api, characterId, onProgress, onJob),
    loadCurrentOperation: (characterId) => api.fetchCurrentCharacterOperation(characterId),
    loadOperation: (jobId) => api.fetchCharacterOperation(jobId),
    retryRecovery: (jobId, onJob) => retryCharacterRecovery(api, jobId, onJob),
    previewRecovery: (jobId) => api.previewCharacterRecovery(jobId),
    acceptRecovery: (jobId, token) => api.acceptCharacterRecovery(jobId, token),
    linkCharacter: (characterId, newHofCharacterId) =>
      api.linkCharacter(characterId, newHofCharacterId),
    loadRoster: () => api.listCharacters(),
    archiveCharacter: (characterId) => api.archiveCharacter(characterId),
    restoreCharacter: (characterId) => restoreCharacter(api, characterId),
    deleteCharacterPermanently: (characterId) =>
      api.deleteCharacterPermanently(characterId),
    previewTransfer: (request) => api.previewCharacterTransfer(request),
    executeTransfer: (request, onProgress) =>
      executeCharacterTransfer(api, request, [], onProgress),
    reloadRelatedPresets: integration.reloadRelatedPresets,
    beginPatternEdit: integration.beginPatternEdit,
  };
}

/** 로그인 세대별 캐릭터 관리 lifecycle과 observable snapshot 구독을 소유한다. */
export function useCharacterManagementHub(
  api: CharacterManagementHubApi,
  accountKey: unknown | null,
  integration: CharacterManagementHubIntegration,
): CharacterManagementHubBinding {
  const integrationRef = useRef(integration);
  useLayoutEffect(() => { integrationRef.current = integration; }, [integration]);
  // 연관 카탈로그의 콜백 갱신은 캐릭터 목록·선택·진행 중 관측의 수명주기를 바꾸지 않는다.
  const module = useMemo(
    () => new CharacterManagementHubModule(
      createCharacterManagementHubBackend(api, {
        reloadRelatedPresets: () => integrationRef.current.reloadRelatedPresets(),
        beginPatternEdit: () => integrationRef.current.beginPatternEdit(),
      }),
    ),
    [api],
  );
  const resource = useSyncExternalStore(
    module.subscribe,
    module.getSnapshot,
    module.getSnapshot,
  );

  useLayoutEffect(() => {
    if (accountKey == null) {
      module.deactivate();
      return;
    }
    module.activate(accountKey);
    return () => module.deactivate();
  }, [accountKey, module]);

  const observations = useMemo(
    () => module.createObservationSink(accountKey),
    [accountKey, module],
  );

  return { resource, observations };
}
