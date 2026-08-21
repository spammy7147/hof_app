import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import {
  CharacterManagementHubModule,
  type CharacterManagementHubBackend,
  type CharacterManagementHubResource,
} from '../../domain/characterManagementHubModule';
import type { BackendApiClient } from '../../services/backendApi';
import type { HofCharacter, HofCharacterDetail } from '../../types/api';

export type CharacterManagementHubApi = Pick<
  BackendApiClient,
  | 'fetchCharacterDetail'
  | 'refreshCharacterDetail'
  | 'executeCharacterCommand'
  | 'applyCharacterPattern'
  | 'loadSavedCharacterPattern'
  | 'deleteSavedCharacterPattern'
  | 'deepSyncCharacter'
  | 'linkCharacter'
  | 'listCharacters'
  | 'archiveCharacter'
  | 'restoreCharacter'
  | 'deleteCharacterPermanently'
  | 'previewCharacterTransfer'
  | 'executeCharacterTransfer'
>;

export type CharacterManagementHubIntegration = {
  publishRoster: (characters: HofCharacter[]) => void;
  publishDetail: (detail: HofCharacterDetail) => void;
  reloadRelatedPresets: () => Promise<void>;
  beginPatternEdit: () => Promise<void>;
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
    deepSync: (characterId, onProgress) =>
      api.deepSyncCharacter(characterId, onProgress),
    linkCharacter: (characterId, newHofCharacterId) =>
      api.linkCharacter(characterId, newHofCharacterId),
    loadRoster: () => api.listCharacters(),
    archiveCharacter: (characterId) => api.archiveCharacter(characterId),
    restoreCharacter: (characterId) => api.restoreCharacter(characterId),
    deleteCharacterPermanently: (characterId) =>
      api.deleteCharacterPermanently(characterId),
    publishRoster: integration.publishRoster,
    publishDetail: integration.publishDetail,
    previewTransfer: (request) => api.previewCharacterTransfer(request),
    executeTransfer: (request, onProgress) =>
      api.executeCharacterTransfer(request, [], onProgress),
    reloadRelatedPresets: integration.reloadRelatedPresets,
    beginPatternEdit: integration.beginPatternEdit,
  };
}

/** 로그인 세대별 캐릭터 관리 lifecycle과 observable snapshot 구독을 소유한다. */
export function useCharacterManagementHub(
  api: CharacterManagementHubApi,
  accountKey: unknown | null,
  characters: HofCharacter[],
  integration: CharacterManagementHubIntegration,
): CharacterManagementHubResource {
  const module = useMemo(
    () => new CharacterManagementHubModule(
      createCharacterManagementHubBackend(api, integration),
    ),
    [
      api,
      integration.beginPatternEdit,
      integration.publishDetail,
      integration.publishRoster,
      integration.reloadRelatedPresets,
    ],
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

  useLayoutEffect(() => {
    module.observeRoster(accountKey == null ? [] : characters);
  }, [accountKey, characters, module]);

  return resource;
}
