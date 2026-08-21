import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CharacterManagementHubModule,
  type CharacterManagementHubBackend,
} from '../../main/domain/characterManagementHubModule';
import { makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';
import type {
  CharacterCommandResult,
  CharacterDeepSyncResponse,
  CharacterPatternOperationResult,
  CharacterTransferExecutionResult,
  CharacterTransferPreview,
  CharacterTransferPreviewRequest,
  HofCharacter,
  HofCharacterDetail,
} from '../../main/types/api';

describe('character management hub module', () => {
  it('publishes the authoritative roster and owns roster lifecycle mutations', async () => {
    const initial = [makeHofCharacter(1), makeHofCharacter(2, { lifecycle: 'ARCHIVED' })];
    const archived = [makeHofCharacter(1, { lifecycle: 'ARCHIVED' }), initial[1]!];
    const restored = [initial[0]!, makeHofCharacter(2)];
    const deleted = [initial[0]!];
    const published: HofCharacter[][] = [];
    const hub = new CharacterManagementHubModule(backend({
      archiveCharacter: async (characterId) => {
        assert.equal(characterId, 1);
        return archived;
      },
      restoreCharacter: async (characterId) => {
        assert.equal(characterId, 2);
        return restored;
      },
      deleteCharacterPermanently: async (characterId) => {
        assert.equal(characterId, 2);
        return deleted;
      },
      publishRoster: (characters) => published.push(characters),
    }));
    hub.activate('account-1');
    hub.observeRoster(initial);

    assert.equal(hub.getSnapshot().characters, initial);
    await hub.getSnapshot().actions.archiveCharacter?.(1);
    assert.equal(hub.getSnapshot().characters, archived);
    await hub.getSnapshot().actions.restoreCharacter?.(2);
    assert.equal(hub.getSnapshot().characters, restored);
    await hub.getSnapshot().actions.deleteCharacterPermanently?.(2);
    assert.equal(hub.getSnapshot().characters, deleted);
    assert.deepEqual(published, [archived, restored, deleted]);
  });

  it('opens a transfer by selecting the exact stable target and retaining the source in the hub', async () => {
    const source = makeHofCharacter(2, { lifecycle: 'MISSING' });
    const target = makeHofCharacter(1);
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
    }));
    hub.activate('account-1');
    hub.observeRoster([target, source]);

    await hub.getSnapshot().actions.openTransfer(source, target);

    assert.equal(hub.getSnapshot().selectedCharacter?.id, target.id);
    assert.equal(hub.getSnapshot().transfer.sourceCharacter?.id, source.id);
    assert.equal(hub.getSnapshot().transfer.targetCharacterId, target.id);
  });

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

  it('publishes a roster observation and every dependent lifecycle change atomically', async () => {
    const source = makeHofCharacter(2, { lifecycle: 'MISSING' });
    const target = makeHofCharacter(1);
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
    }));
    hub.activate('account-1');
    hub.observeRoster([target, source]);
    await hub.getSnapshot().actions.openTransfer(source, target);

    const observed = [makeHofCharacter(1, { lifecycle: 'ARCHIVED' })];
    const snapshots: ReturnType<typeof hub.getSnapshot>[] = [];
    hub.subscribe(() => snapshots.push(hub.getSnapshot()));

    hub.observeRoster(observed);

    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0]?.characters, observed);
    assert.equal(snapshots[0]?.selectedCharacter, null);
    assert.equal(snapshots[0]?.detail, null);
    assert.equal(snapshots[0]?.transfer.sourceCharacter, null);
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

  it('executes a semantic command and reloads the selected authoritative projection', async () => {
    let stored = freshDetail(1);
    const commandResult: CharacterCommandResult = {
      type: 'Completed', characterId: 1, revision: 'revision-2', messages: [],
    };
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => stored,
      executeCommand: async () => {
        stored = makeHofCharacterDetail(1, {
          name: '명령 반영',
          revision: 'revision-2',
          detailSyncedAt: new Date().toISOString(),
        });
        return commandResult;
      },
    }));
    const character = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);

    const result = await hub.getSnapshot().actions.executeCommand?.({
      type: 'PRAY', characterId: 1, expectedRevision: character.revision,
    });

    assert.equal(result, commandResult);
    assert.equal(hub.getSnapshot().detail?.name, '명령 반영');
  });

  it('does not project a late command result or reload another selected character', async () => {
    const command = deferred<CharacterCommandResult>();
    const loads: number[] = [];
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => {
        loads.push(characterId);
        return freshDetail(characterId);
      },
      executeCommand: () => command.promise,
    }));
    const first = makeHofCharacter(1);
    const second = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([first, second]);
    await hub.getSnapshot().actions.select(first);
    const pending = hub.getSnapshot().actions.executeCommand?.({
      type: 'PRAY', characterId: 1, expectedRevision: first.revision,
    });
    await hub.getSnapshot().actions.select(second);
    const loadsBeforeResult = [...loads];

    command.resolve({
      type: 'Completed', characterId: 1, revision: 'revision-2', messages: [],
    });
    assert.equal(await pending, undefined);
    assert.deepEqual(loads, loadsBeforeResult);
    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
    assert.equal(hub.getSnapshot().detail?.id, second.id);
  });

  it('publishes pattern conflicts without replacing the draft detail and reloads only success', async () => {
    const conflict: CharacterPatternOperationResult = {
      currentRevision: 'revision-2',
      rowDiffs: [{ rowNumber: 1, before: null, current: null }],
    };
    let patternResult = conflict;
    let loads = 0;
    const detail = freshDetail(1);
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => {
        loads += 1;
        return detail;
      },
      applyPattern: async () => patternResult,
    }));
    const character = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);

    const request = patternRequest(character.id, character.revision);
    assert.equal(await hub.getSnapshot().actions.applyPattern?.(request), conflict);
    assert.equal(hub.getSnapshot().patternConflict, conflict);
    assert.equal(hub.getSnapshot().detail, detail);
    assert.equal(loads, 1);

    patternResult = { revision: 'revision-3' };
    await hub.getSnapshot().actions.applyPattern?.(request);
    assert.equal(hub.getSnapshot().patternConflict, null);
    assert.equal(loads, 2);
  });

  it('owns deep-sync progress and ignores progress after selection changes', async () => {
    let reportProgress!: (progress: CharacterDeepSyncResponse) => void;
    let syncCalls = 0;
    const completion = deferred<CharacterDeepSyncResponse>();
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      deepSync: (_characterId, onProgress) => {
        syncCalls += 1;
        reportProgress = onProgress;
        return completion.promise;
      },
    }));
    const first = makeHofCharacter(1);
    const second = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([first, second]);
    await hub.getSnapshot().actions.select(first);

    const pending = hub.getSnapshot().actions.deepSync?.();
    assert.equal(await hub.getSnapshot().actions.deepSync?.(), undefined);
    assert.equal(syncCalls, 1);
    reportProgress({ characterId: 1, progress: [] });
    assert.equal(hub.getSnapshot().deepSync.status, 'running');
    await hub.getSnapshot().actions.select(second);
    reportProgress({ characterId: 1, progress: [] });
    completion.resolve({ characterId: 1, progress: [] });
    assert.equal(await pending, undefined);

    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
    assert.equal(hub.getSnapshot().deepSync.status, 'idle');
  });

  it('binds saved-pattern and identity-link actions to the selected stable record', async () => {
    const calls: string[] = [];
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      loadSavedPattern: async (characterId, slotCode) => {
        calls.push(`load-pattern:${characterId}:${slotCode}`);
        return {};
      },
      deleteSavedPattern: async (characterId, slotCode) => {
        calls.push(`delete-pattern:${characterId}:${slotCode}`);
        return {};
      },
      linkCharacter: async (characterId, hofCharacterId) => {
        calls.push(`link:${characterId}:${hofCharacterId}`);
      },
    }));
    const character = makeHofCharacter(7);
    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);

    await hub.getSnapshot().actions.loadSavedPattern?.('slot-a');
    await hub.getSnapshot().actions.deleteSavedPattern?.('slot-b');
    await hub.getSnapshot().actions.linkCharacter?.('new-hof-id');

    assert.deepEqual(calls, [
      'load-pattern:7:slot-a',
      'delete-pattern:7:slot-b',
      'link:7:new-hof-id',
    ]);
  });

  it('rejects every action retained from an older character selection', async () => {
    const calls: string[] = [];
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => {
        calls.push(`detail:${characterId}`);
        return freshDetail(characterId);
      },
      refreshAuthoritativeDetail: async (characterId) => {
        calls.push(`refresh:${characterId}`);
        return freshDetail(characterId);
      },
      loadSavedPattern: async (characterId) => {
        calls.push(`load-pattern:${characterId}`);
        return {};
      },
      deleteSavedPattern: async (characterId) => {
        calls.push(`delete-pattern:${characterId}`);
        return {};
      },
      deepSync: async (characterId) => {
        calls.push(`deep-sync:${characterId}`);
        return { characterId, progress: [] };
      },
      linkCharacter: async (characterId) => {
        calls.push(`link:${characterId}`);
      },
      beginPatternEdit: async () => {
        calls.push('begin-pattern');
      },
    }));
    const first = makeHofCharacter(1);
    const second = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([first, second]);
    await hub.getSnapshot().actions.select(first);
    const firstActions = hub.getSnapshot().actions;

    await firstActions.select(second);
    const callsBeforeStaleActions = [...calls];
    firstActions.close();
    firstActions.dismissPatternConflict();
    await firstActions.reloadStored();
    await firstActions.refresh();
    await firstActions.loadSavedPattern?.('slot-a');
    await firstActions.deleteSavedPattern?.('slot-b');
    await firstActions.deepSync?.();
    await firstActions.linkCharacter?.('new-hof-id');
    await firstActions.beginPatternEdit?.();

    assert.deepEqual(calls, callsBeforeStaleActions);
    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
    assert.equal(hub.getSnapshot().detail?.id, second.id);
  });

  it('publishes command roster and detail only after the current selection fence', async () => {
    const publishedRoster: HofCharacter[][] = [];
    const publishedDetails: HofCharacterDetail[] = [];
    const updated = makeHofCharacter(1, {
      name: '명령 후 이름',
      revision: 'revision-2',
    });
    const detail = makeHofCharacterDetail(1, {
      name: '명령 후 이름',
      revision: 'revision-2',
      detailSyncedAt: new Date().toISOString(),
    });
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => detail,
      executeCommand: async () => ({
        type: 'Completed', characterId: 1, revision: 'revision-2', messages: [],
      }),
      loadRoster: async () => [updated],
      publishRoster: (roster) => publishedRoster.push(roster),
      publishDetail: (next) => publishedDetails.push(next),
    }));
    const character = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);
    publishedDetails.length = 0;

    await hub.getSnapshot().actions.executeCommand?.({
      type: 'PRAY', characterId: 1, expectedRevision: character.revision,
    });

    assert.deepEqual(publishedRoster, [[updated]]);
    assert.equal(publishedDetails.at(-1)?.revision, 'revision-2');
  });

  it('does not publish late command observations after selection changes', async () => {
    const command = deferred<CharacterCommandResult>();
    const publishedRoster: HofCharacter[][] = [];
    const publishedDetails: HofCharacterDetail[] = [];
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      executeCommand: () => command.promise,
      loadRoster: async () => [makeHofCharacter(1, { revision: 'revision-2' })],
      publishRoster: (roster) => publishedRoster.push(roster),
      publishDetail: (detail) => publishedDetails.push(detail),
    }));
    const first = makeHofCharacter(1);
    const second = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([first, second]);
    await hub.getSnapshot().actions.select(first);
    publishedDetails.length = 0;
    const pending = hub.getSnapshot().actions.executeCommand?.({
      type: 'PRAY', characterId: 1, expectedRevision: first.revision,
    });
    await hub.getSnapshot().actions.select(second);
    publishedDetails.length = 0;

    command.resolve({
      type: 'Completed', characterId: 1, revision: 'revision-2', messages: [],
    });
    await pending;

    assert.deepEqual(publishedRoster, []);
    assert.deepEqual(publishedDetails, []);
    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
  });

  it('does not publish a late authoritative refresh after selection changes', async () => {
    const refresh = deferred<HofCharacterDetail>();
    const publishedDetails: HofCharacterDetail[] = [];
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      refreshAuthoritativeDetail: () => refresh.promise,
      publishDetail: (detail) => publishedDetails.push(detail),
    }));
    const first = makeHofCharacter(1);
    const second = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([first, second]);
    await hub.getSnapshot().actions.select(first);
    publishedDetails.length = 0;

    const pending = hub.getSnapshot().actions.refresh();
    await hub.getSnapshot().actions.select(second);
    publishedDetails.length = 0;
    refresh.resolve(freshDetail(1));
    await pending;

    assert.deepEqual(publishedDetails, []);
    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
  });

  it('does not publish a late identity link after the account changes', async () => {
    const link = deferred<HofCharacter[]>();
    const publishedRoster: HofCharacter[][] = [];
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      linkCharacter: () => link.promise,
      publishRoster: (roster) => publishedRoster.push(roster),
    }));
    const first = makeHofCharacter(1);
    const second = makeHofCharacter(2);
    hub.activate('account-a');
    hub.observeRoster([first]);
    await hub.getSnapshot().actions.select(first);

    const pending = hub.getSnapshot().actions.linkCharacter?.('new-hof-id');
    hub.activate('account-b');
    hub.observeRoster([second]);
    await hub.getSnapshot().actions.select(second);
    link.resolve([makeHofCharacter(1, { hofCharacterId: 'new-hof-id' })]);
    await pending;

    assert.deepEqual(publishedRoster, []);
    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
  });

  it('owns a transfer preview for exact stable source and target records', async () => {
    const request = transferRequest(2, 1);
    const preview = transferPreview(2, 1);
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      previewTransfer: async (submitted) => {
        assert.deepEqual(submitted, request);
        return preview;
      },
    }));
    const target = makeHofCharacter(1);
    const source = makeHofCharacter(2, { lifecycle: 'ARCHIVED' });
    hub.activate('account-1');
    hub.observeRoster([target, source]);
    await hub.getSnapshot().actions.select(target);

    const observed = await hub.getSnapshot().actions.previewTransfer?.(request);

    assert.equal(observed, preview);
    assert.equal(hub.getSnapshot().transfer.status, 'ready');
    assert.equal(hub.getSnapshot().transfer.sourceCharacter, source);
    assert.equal(hub.getSnapshot().transfer.targetCharacterId, target.id);
    assert.equal(hub.getSnapshot().transfer.preview, preview);
  });

  it('projects transfer progress and refreshes only target authority and related presets', async () => {
    const request = transferRequest(2, 1);
    const preview = transferPreview(2, 1);
    const progress: CharacterTransferExecutionResult = {
      targetCharacterId: 1,
      results: [{ stepId: 'pattern', status: 'COMPLETED', message: '' }],
      nextStepIndex: 1,
    };
    const result: CharacterTransferExecutionResult = {
      targetCharacterId: 1,
      results: [{ stepId: 'pattern', status: 'COMPLETED', message: '' }],
      nextStepIndex: 2,
    };
    const refreshedIds: number[] = [];
    const publishedDetails: HofCharacterDetail[] = [];
    let presetReloads = 0;
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      previewTransfer: async () => preview,
      executeTransfer: async (submitted, onProgress) => {
        assert.deepEqual(submitted, request);
        onProgress(progress);
        return result;
      },
      refreshAuthoritativeDetail: async (characterId) => {
        refreshedIds.push(characterId);
        return makeHofCharacterDetail(characterId, { revision: 'revision-2' });
      },
      reloadRelatedPresets: async () => { presetReloads += 1; },
      publishDetail: (detail) => publishedDetails.push(detail),
    }));
    const target = makeHofCharacter(1);
    const source = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([target, source]);
    await hub.getSnapshot().actions.select(target);
    publishedDetails.length = 0;
    await hub.getSnapshot().actions.previewTransfer?.(request);

    const completed = await hub.getSnapshot().actions.executeTransfer?.();

    assert.equal(completed, result);
    assert.equal(hub.getSnapshot().transfer.status, 'completed');
    assert.equal(hub.getSnapshot().transfer.progress, result);
    assert.equal(hub.getSnapshot().transfer.result, result);
    assert.deepEqual(refreshedIds, [target.id]);
    assert.equal(publishedDetails.at(-1)?.id, target.id);
    assert.equal(presetReloads, 1);
    assert.equal(hub.getSnapshot().transfer.sourceCharacter, source);
  });

  it('ends a current transfer with an error when completion targets another stable record', async () => {
    let refreshes = 0;
    let presetReloads = 0;
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      previewTransfer: async () => transferPreview(2, 1),
      executeTransfer: async () => ({
        targetCharacterId: 99,
        results: [],
        nextStepIndex: 1,
      }),
      refreshAuthoritativeDetail: async (characterId) => {
        refreshes += 1;
        return freshDetail(characterId);
      },
      reloadRelatedPresets: async () => { presetReloads += 1; },
    }));
    const target = makeHofCharacter(1);
    const source = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([target, source]);
    await hub.getSnapshot().actions.select(target);
    await hub.getSnapshot().actions.previewTransfer?.(transferRequest(2, 1));

    const completed = await hub.getSnapshot().actions.executeTransfer?.();

    assert.equal(completed, undefined);
    assert.equal(hub.getSnapshot().transfer.status, 'error');
    assert.match(hub.getSnapshot().transfer.errorMessage ?? '', /대상이 요청과 일치하지 않습니다/);
    assert.equal(refreshes, 0);
    assert.equal(presetReloads, 0);
    hub.getSnapshot().actions.clearTransfer();
    assert.equal(hub.getSnapshot().transfer.status, 'idle');
  });

  it('fences late transfer progress and completion after target selection changes', async () => {
    const request = transferRequest(2, 1);
    const execution = deferred<CharacterTransferExecutionResult>();
    let reportProgress!: (progress: CharacterTransferExecutionResult) => void;
    let refreshes = 0;
    let presetReloads = 0;
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      previewTransfer: async () => transferPreview(2, 1),
      executeTransfer: (_request, onProgress) => {
        reportProgress = onProgress;
        return execution.promise;
      },
      refreshAuthoritativeDetail: async (characterId) => {
        refreshes += 1;
        return freshDetail(characterId);
      },
      reloadRelatedPresets: async () => { presetReloads += 1; },
    }));
    const target = makeHofCharacter(1);
    const source = makeHofCharacter(2);
    const other = makeHofCharacter(3);
    hub.activate('account-1');
    hub.observeRoster([target, source, other]);
    await hub.getSnapshot().actions.select(target);
    await hub.getSnapshot().actions.previewTransfer?.(request);
    const pending = hub.getSnapshot().actions.executeTransfer?.();

    await hub.getSnapshot().actions.select(other);
    reportProgress({ targetCharacterId: 1, results: [], nextStepIndex: 1 });
    execution.resolve({ targetCharacterId: 1, results: [], nextStepIndex: 2 });
    assert.equal(await pending, undefined);

    assert.equal(hub.getSnapshot().selectedCharacter?.id, other.id);
    assert.equal(hub.getSnapshot().transfer.status, 'idle');
    assert.equal(refreshes, 0);
    assert.equal(presetReloads, 0);
  });

  it('does not let callbacks retained from an older transfer clear or execute a newer preview', async () => {
    let executions = 0;
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      previewTransfer: async (request) => transferPreview(
        request.sourceCharacterId,
        request.targetCharacterId,
      ),
      executeTransfer: async (request) => {
        executions += 1;
        return { targetCharacterId: request.targetCharacterId, results: [], nextStepIndex: 1 };
      },
    }));
    const target = makeHofCharacter(1);
    const source = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([target, source]);
    await hub.getSnapshot().actions.select(target);
    const olderTransferActions = hub.getSnapshot().actions;
    await olderTransferActions.previewTransfer?.(transferRequest(2, 1));

    await hub.getSnapshot().actions.previewTransfer?.({
      ...transferRequest(2, 1),
      transfer: { ...transferRequest(2, 1).transfer, includeSkills: true },
    });
    const currentPreview = hub.getSnapshot().transfer.preview;
    olderTransferActions.clearTransfer();
    await olderTransferActions.executeTransfer?.();

    assert.equal(hub.getSnapshot().transfer.preview, currentPreview);
    assert.equal(executions, 0);
  });

  it('drops transfer progress and completion after logout', async () => {
    const execution = deferred<CharacterTransferExecutionResult>();
    let reportProgress!: (progress: CharacterTransferExecutionResult) => void;
    let refreshes = 0;
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      previewTransfer: async () => transferPreview(2, 1),
      executeTransfer: (_request, onProgress) => {
        reportProgress = onProgress;
        return execution.promise;
      },
      refreshAuthoritativeDetail: async (characterId) => {
        refreshes += 1;
        return freshDetail(characterId);
      },
    }));
    const target = makeHofCharacter(1);
    const source = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([target, source]);
    await hub.getSnapshot().actions.select(target);
    await hub.getSnapshot().actions.previewTransfer?.(transferRequest(2, 1));
    const pending = hub.getSnapshot().actions.executeTransfer?.();

    hub.deactivate();
    reportProgress({ targetCharacterId: 1, results: [], nextStepIndex: 1 });
    execution.resolve({ targetCharacterId: 1, results: [], nextStepIndex: 2 });
    assert.equal(await pending, undefined);

    assert.equal(hub.getSnapshot().transfer.status, 'idle');
    assert.equal(refreshes, 0);
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

function patternRequest(characterId: number, revision: string) {
  return {
    characterId,
    baseRevision: revision,
    base: { rows: [], position: '', guard: '' },
    draft: { baseRevision: revision, rows: [], position: '', guard: '' },
  };
}

function transferRequest(
  sourceCharacterId: number,
  targetCharacterId: number,
): CharacterTransferPreviewRequest {
  return {
    sourceCharacterId,
    targetCharacterId,
    transfer: {
      includeCurrentPattern: true,
      savedPatternMappings: [],
      includeStats: false,
      includeSkills: false,
      includeEquipment: false,
    },
  };
}

function transferPreview(
  sourceCharacterId: number,
  targetCharacterId: number,
): CharacterTransferPreview {
  return {
    sourceCharacterId,
    targetCharacterId,
    steps: [],
    issues: [],
    executable: true,
  };
}
