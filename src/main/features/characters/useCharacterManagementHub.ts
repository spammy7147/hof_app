import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import {
  CharacterManagementHubModule,
  type CharacterManagementHubResource,
} from '../../domain/characterManagementHubModule';
import type { HofCharacter, HofCharacterDetail } from '../../types/api';

export type CharacterManagementHubApi = {
  loadStoredDetail: (characterId: number) => Promise<HofCharacterDetail>;
  refreshAuthoritativeDetail?: (characterId: number) => Promise<HofCharacterDetail>;
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
    }),
    [api.loadStoredDetail, api.refreshAuthoritativeDetail],
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
