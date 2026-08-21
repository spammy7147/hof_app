import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import {
  CharacterManagementHubModule,
  type CharacterManagementHubResource,
} from '../../domain/characterManagementHubModule';
import type {
  CharacterCommand,
  CharacterCommandResult,
  CharacterDeepSyncResponse,
  CharacterPatternApplyRequest,
  CharacterPatternOperationResult,
  CharacterTransferExecutionResult,
  CharacterTransferPreview,
  CharacterTransferPreviewRequest,
  HofCharacter,
  HofCharacterDetail,
} from '../../types/api';

export type CharacterManagementHubApi = {
  loadStoredDetail: (characterId: number) => Promise<HofCharacterDetail>;
  refreshAuthoritativeDetail?: (characterId: number) => Promise<HofCharacterDetail>;
  executeCommand?: (command: CharacterCommand) => Promise<CharacterCommandResult>;
  applyPattern?: (
    request: CharacterPatternApplyRequest,
  ) => Promise<CharacterPatternOperationResult>;
  loadSavedPattern?: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  deleteSavedPattern?: (
    characterId: number,
    slotCode: string,
  ) => Promise<CharacterPatternOperationResult>;
  deepSync?: (
    characterId: number,
    onProgress?: (progress: CharacterDeepSyncResponse) => void,
  ) => Promise<CharacterDeepSyncResponse>;
  linkCharacter?: (
    characterId: number,
    newHofCharacterId: string,
  ) => Promise<HofCharacter[] | void>;
  loadRoster?: () => Promise<HofCharacter[]>;
  publishRoster?: (characters: HofCharacter[]) => void;
  publishDetail?: (detail: HofCharacterDetail) => void;
  previewTransfer?: (
    request: CharacterTransferPreviewRequest,
  ) => Promise<CharacterTransferPreview>;
  executeTransfer?: (
    request: CharacterTransferPreviewRequest,
    onProgress?: (progress: CharacterTransferExecutionResult) => void,
  ) => Promise<CharacterTransferExecutionResult>;
  reloadRelatedPresets?: () => Promise<void>;
  beginPatternEdit?: () => Promise<void>;
};

/** 계정과 roster 관측을 캐릭터 관리 허브의 observable lifecycle에 연결한다. */
export function useCharacterManagementHub(
  api: CharacterManagementHubApi,
  accountKey: unknown | null,
  characters: HofCharacter[],
): CharacterManagementHubResource {
  const module = useMemo(
    () => new CharacterManagementHubModule({
      loadStoredDetail: api.loadStoredDetail,
      refreshAuthoritativeDetail:
        api.refreshAuthoritativeDetail ?? api.loadStoredDetail,
      executeCommand: api.executeCommand,
      applyPattern: api.applyPattern,
      loadSavedPattern: api.loadSavedPattern,
      deleteSavedPattern: api.deleteSavedPattern,
      deepSync: api.deepSync,
      linkCharacter: api.linkCharacter,
      loadRoster: api.loadRoster,
      publishRoster: api.publishRoster,
      publishDetail: api.publishDetail,
      previewTransfer: api.previewTransfer,
      executeTransfer: api.executeTransfer
        ? (request, onProgress) => api.executeTransfer?.(request, onProgress)
          ?? Promise.reject(new Error('설정 가져오기를 실행할 수 없습니다.'))
        : undefined,
      reloadRelatedPresets: api.reloadRelatedPresets,
      beginPatternEdit: api.beginPatternEdit,
    }),
    [
      api.applyPattern,
      api.beginPatternEdit,
      api.deepSync,
      api.deleteSavedPattern,
      api.executeCommand,
      api.linkCharacter,
      api.loadRoster,
      api.loadSavedPattern,
      api.loadStoredDetail,
      api.publishDetail,
      api.publishRoster,
      api.previewTransfer,
      api.executeTransfer,
      api.reloadRelatedPresets,
      api.refreshAuthoritativeDetail,
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
