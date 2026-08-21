import type {
  CharacterManagementHubActions,
  CharacterManagementHubResource,
} from '../../main/domain/characterManagementHubModule';

export function makeCharacterManagementHubResource(
  overrides: Partial<Omit<CharacterManagementHubResource, 'actions'>> & {
    actions?: Partial<CharacterManagementHubActions>;
  } = {},
): CharacterManagementHubResource {
  const actions: CharacterManagementHubActions = {
    select: async () => undefined,
    close: () => undefined,
    reloadStored: async () => undefined,
    refresh: async () => undefined,
    dismissPatternConflict: () => undefined,
    clearTransfer: () => undefined,
    ...overrides.actions,
  };
  return {
    selectedCharacter: null,
    detail: null,
    isLoading: false,
    errorMessage: null,
    warningMessage: null,
    patternConflict: null,
    deepSync: { status: 'idle', progress: null, errorMessage: null },
    transfer: {
      status: 'idle',
      sourceCharacter: null,
      targetCharacterId: null,
      request: null,
      preview: null,
      progress: null,
      result: null,
      errorMessage: null,
    },
    ...overrides,
    actions,
  };
}
