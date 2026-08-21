import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import {
  PartyPresetCatalogModule,
  type PartyPresetCatalogBackend,
  type PartyPresetCatalogResource,
} from '../../domain/partyPresetCatalogModule';
import type { BackendApiClient } from '../../services/backendApi';

export type PartyPresetCatalogApi = Pick<
  BackendApiClient,
  | 'getPartyPresetCatalog'
  | 'createPartyPreset'
  | 'updatePartyPreset'
  | 'makePartyPresetPrimary'
  | 'reorderPartyPresets'
  | 'deletePartyPreset'
  | 'createPartyPresetFolder'
  | 'renamePartyPresetFolder'
  | 'reorderPartyPresetFolders'
  | 'movePartyPresetFolder'
  | 'deletePartyPresetFolder'
>;

/** Backend API를 카탈로그 module의 단일 외부 경계로 바꾼다. */
export function createPartyPresetCatalogBackend(
  api: PartyPresetCatalogApi,
): PartyPresetCatalogBackend {
  return {
    loadCatalog: () => api.getPartyPresetCatalog(),
    createPreset: (request) => api.createPartyPreset(request),
    updatePreset: (presetId, request) => api.updatePartyPreset(presetId, request),
    makePresetPrimary: (presetId) => api.makePartyPresetPrimary(presetId),
    reorderPresets: (request) => api.reorderPartyPresets(request),
    deletePreset: (presetId) => api.deletePartyPreset(presetId),
    createFolder: (request) => api.createPartyPresetFolder(request),
    renameFolder: (folderId, request) => api.renamePartyPresetFolder(folderId, request),
    reorderFolders: (request) => api.reorderPartyPresetFolders(request),
    moveFolder: (folderId, request) => api.movePartyPresetFolder(folderId, request),
    deleteFolder: (folderId) => api.deletePartyPresetFolder(folderId),
  };
}

/** 로그인 세대별 카탈로그 lifecycle과 observable snapshot 구독을 소유한다. */
export function usePartyPresetCatalog(
  api: PartyPresetCatalogApi,
  accountKey: unknown | null,
): PartyPresetCatalogResource {
  const module = useMemo(
    () => new PartyPresetCatalogModule(createPartyPresetCatalogBackend(api)),
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
    void module.activate(accountKey);
    return () => module.deactivate();
  }, [accountKey, module]);

  return resource;
}
