import type {
  PartyPresetCatalogActions,
  PartyPresetCatalogResource,
} from '../../main/domain/partyPresetCatalogModule';
import type { PartyPresetCatalogResponse } from '../../main/types/api';

type ResourceOverrides = Partial<
  Omit<PartyPresetCatalogResource, 'catalog' | 'actions'>
> & {
  actions?: Partial<PartyPresetCatalogActions>;
};

/** 테스트가 관심 없는 카탈로그 행동을 안전한 기본값으로 채운다. */
export function makePartyPresetCatalogResource(
  catalog: PartyPresetCatalogResponse,
  overrides: ResourceOverrides = {},
): PartyPresetCatalogResource {
  const unsupported = () => Promise.reject(new Error('unsupported test action'));
  const actions: PartyPresetCatalogActions = {
    createPreset: unsupported,
    updatePreset: unsupported,
    makePresetPrimary: unsupported,
    reorderPresets: async () => [],
    deletePreset: async () => null,
    createFolder: async () => catalog,
    renameFolder: async () => catalog,
    reorderFolders: async () => catalog,
    moveFolder: async () => catalog,
    deleteFolder: async () => catalog,
    ...overrides.actions,
  };
  return {
    catalog,
    loading: false,
    error: null,
    mutationError: null,
    mutating: false,
    retry: () => undefined,
    ...overrides,
    actions,
  };
}
