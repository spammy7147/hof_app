import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CharacterManagementHubModule,
  type CharacterManagementHubBackend,
} from '../../main/domain/characterManagementHubModule';
import { makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';

describe('character management hub module', () => {
  it('publishes one selected-character snapshot and keeps a fresh stored detail', async () => {
    const character = makeHofCharacter(1);
    const stored = makeHofCharacterDetail(1, {
      detailSyncedAt: '2026-08-21T00:20:00.000Z',
    });
    let refreshes = 0;
    const hub = new CharacterManagementHubModule(
      backend({
        loadStoredDetail: async () => stored,
        refreshAuthoritativeDetail: async () => {
          refreshes += 1;
          return stored;
        },
      }),
      { now: () => Date.parse('2026-08-21T00:40:00.000Z') },
    );

    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);

    assert.equal(hub.getSnapshot().selectedCharacter, character);
    assert.equal(hub.getSnapshot().detail, stored);
    assert.equal(hub.getSnapshot().isLoading, false);
    assert.equal(hub.getSnapshot().errorMessage, null);
    assert.equal(refreshes, 0);
  });

  it('shows stored state first and refreshes authority after the 30-minute freshness boundary', async () => {
    const character = makeHofCharacter(1);
    const stored = makeHofCharacterDetail(1, {
      name: '저장 상태',
      detailSyncedAt: '2026-08-21T00:10:00.000Z',
    });
    const refreshed = makeHofCharacterDetail(1, {
      name: '권위 상태',
      detailSyncedAt: '2026-08-21T00:40:00.000Z',
    });
    const refresh = deferred<typeof refreshed>();
    const observedNames: Array<string | null> = [];
    const hub = new CharacterManagementHubModule(
      backend({
        loadStoredDetail: async () => stored,
        refreshAuthoritativeDetail: () => refresh.promise,
      }),
      { now: () => Date.parse('2026-08-21T00:40:00.000Z') },
    );
    hub.subscribe(() => observedNames.push(hub.getSnapshot().detail?.name ?? null));

    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);
    assert.equal(hub.getSnapshot().detail?.name, '저장 상태');

    refresh.resolve(refreshed);
    await settle();
    assert.equal(hub.getSnapshot().detail?.name, '권위 상태');
    assert.ok(observedNames.includes('저장 상태'));
  });

  it('clears selection and detail when roster authority removes or archives the selected record', async () => {
    const character = makeHofCharacter(1);
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => makeHofCharacterDetail(1),
    }));
    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);

    hub.observeRoster([makeHofCharacter(1, { lifecycle: 'ARCHIVED' })]);

    assert.equal(hub.getSnapshot().selectedCharacter, null);
    assert.equal(hub.getSnapshot().detail, null);
    assert.equal(hub.getSnapshot().isLoading, false);
  });

  it('does not let an older detail response overwrite a newly selected character', async () => {
    const first = makeHofCharacter(1);
    const second = makeHofCharacter(2);
    const firstLoad = deferred<ReturnType<typeof makeHofCharacterDetail>>();
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: (characterId) => characterId === first.id
        ? firstLoad.promise
        : Promise.resolve(makeHofCharacterDetail(2, {
          name: '둘째 상세',
          detailSyncedAt: new Date().toISOString(),
        })),
    }));
    hub.activate('account-1');
    hub.observeRoster([first, second]);

    const olderSelection = hub.getSnapshot().actions.select(first);
    await hub.getSnapshot().actions.select(second);
    firstLoad.resolve(makeHofCharacterDetail(1, { name: '늦은 첫째 상세' }));
    await olderSelection;

    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
    assert.equal(hub.getSnapshot().detail?.name, '둘째 상세');
  });

  it('invalidates a pending load when the account deactivates', async () => {
    const character = makeHofCharacter(1);
    const load = deferred<ReturnType<typeof makeHofCharacterDetail>>();
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: () => load.promise,
    }));
    hub.activate('account-1');
    hub.observeRoster([character]);

    const pending = hub.getSnapshot().actions.select(character);
    hub.deactivate();
    load.resolve(makeHofCharacterDetail(1));
    await pending;

    assert.equal(hub.getSnapshot().selectedCharacter, null);
    assert.equal(hub.getSnapshot().detail, null);
  });

  it('rejects every action retained from an older account generation', async () => {
    const calls: string[] = [];
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => {
        calls.push(`load:${characterId}`);
        return freshDetail(characterId);
      },
      refreshAuthoritativeDetail: async (characterId) => {
        calls.push(`refresh:${characterId}`);
        return freshDetail(characterId);
      },
    }));
    const first = makeHofCharacter(1);
    const second = makeHofCharacter(2);
    hub.activate('account-a');
    hub.observeRoster([first]);
    const oldActions = hub.getSnapshot().actions;
    await oldActions.select(first);

    hub.activate('account-b');
    hub.observeRoster([second]);
    await hub.getSnapshot().actions.select(second);
    const callsBeforeStaleActions = [...calls];

    await oldActions.select(first);
    await oldActions.reloadStored();
    await oldActions.refresh();
    oldActions.close();

    assert.deepEqual(calls, callsBeforeStaleActions);
    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
    assert.equal(hub.getSnapshot().detail?.id, second.id);
  });

  it('keeps a usable detail and reports a non-blocking warning when revalidation fails', async () => {
    let failReload = false;
    const detail = freshDetail(1);
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => {
        if (failReload) throw new Error('temporary load failure');
        return detail;
      },
      refreshAuthoritativeDetail: async () => {
        throw new Error('temporary refresh failure');
      },
    }));
    const character = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);

    failReload = true;
    await hub.getSnapshot().actions.reloadStored();
    assert.equal(hub.getSnapshot().detail, detail);
    assert.equal(hub.getSnapshot().errorMessage, null);
    assert.match(hub.getSnapshot().warningMessage ?? '', /temporary load failure/);

    await hub.getSnapshot().actions.refresh();
    assert.equal(hub.getSnapshot().detail, detail);
    assert.equal(hub.getSnapshot().errorMessage, null);
    assert.match(hub.getSnapshot().warningMessage ?? '', /temporary refresh failure/);
  });

  it('merges the latest roster identity into load and refresh responses that started earlier', async () => {
    const firstLoad = deferred<ReturnType<typeof makeHofCharacterDetail>>();
    const refresh = deferred<ReturnType<typeof makeHofCharacterDetail>>();
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: () => firstLoad.promise,
      refreshAuthoritativeDetail: () => refresh.promise,
    }));
    const before = makeHofCharacter(1, { name: '이전 이름', revision: 'revision-1' });
    const latest = makeHofCharacter(1, { name: '최신 이름', revision: 'revision-2' });
    hub.activate('account-1');
    hub.observeRoster([before]);

    const selection = hub.getSnapshot().actions.select(before);
    hub.observeRoster([latest]);
    firstLoad.resolve(makeHofCharacterDetail(1, {
      name: '오래된 상세',
      revision: 'revision-1',
      detailSyncedAt: new Date().toISOString(),
    }));
    await selection;
    assert.equal(hub.getSnapshot().detail?.name, '최신 이름');
    assert.equal(hub.getSnapshot().detail?.revision, 'revision-2');

    const refreshing = hub.getSnapshot().actions.refresh();
    hub.observeRoster([makeHofCharacter(1, {
      name: '가장 최신 이름',
      revision: 'revision-3',
    })]);
    refresh.resolve(makeHofCharacterDetail(1, {
      name: '오래된 refresh',
      revision: 'revision-2',
    }));
    await refreshing;
    assert.equal(hub.getSnapshot().detail?.name, '가장 최신 이름');
    assert.equal(hub.getSnapshot().detail?.revision, 'revision-3');
  });
});

function backend(
  overrides: Partial<CharacterManagementHubBackend>,
): CharacterManagementHubBackend {
  return {
    loadStoredDetail: async (characterId) => makeHofCharacterDetail(characterId),
    refreshAuthoritativeDetail: async (characterId) => makeHofCharacterDetail(characterId),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function settle() {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}

function freshDetail(characterId: number) {
  return makeHofCharacterDetail(characterId, {
    detailSyncedAt: new Date().toISOString(),
  });
}
