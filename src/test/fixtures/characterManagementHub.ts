import type {
  CharacterManagementHubActions,
  CharacterManagementHubResource,
} from '../../main/domain/characterManagementHubModule';

export function makeCharacterManagementHubResource(
  overrides: Partial<CharacterManagementHubResource> & {
    actions?: Partial<CharacterManagementHubActions>;
  } = {},
): CharacterManagementHubResource {
  const actions: CharacterManagementHubActions = {
    select: async () => undefined,
    close: () => undefined,
    reloadStored: async () => undefined,
    refresh: async () => undefined,
    dismissPatternConflict: () => undefined,
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
    ...overrides,
    actions,
  };
}
