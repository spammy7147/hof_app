import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CharacterManagementHubModule,
  type CharacterManagementHubBackend,
} from '../../main/domain/characterManagementHubModule';
import { makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';
import type {
  CharacterCommand,
  CharacterCommandResult,
  CharacterDeepSyncResponse,
  CharacterOperationJob,
  CharacterRecoveryPreview,
  CharacterPatternApplyRequest,
  CharacterPatternOperationResult,
  CharacterTransferExecutionResult,
  CharacterTransferPreview,
  CharacterTransferPreviewRequest,
  HofCharacter,
  HofCharacterDetail,
} from '../../main/types/api';

describe('character management hub module', () => {
  it('reopens the unresolved job and retries its recovery without starting a new sync', async () => {
    const job = recoveryJob('REQUIRED');
    let starts = 0;
    const retries: number[] = [];
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => freshDetail(1),
      loadCurrentOperation: async () => job,
      deepSync: async () => { starts += 1; return { characterId: 1, progress: [] }; },
      retryRecovery: async (jobId, onJob) => {
        retries.push(jobId);
        const restored = { ...job, recoveryStatus: 'RESTORED' as const, message: '수집은 실패했지만 원본은 복원했습니다.' };
        onJob(restored);
        throw new Error(restored.message);
      },
    }));
    const character = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);
    assert.equal(hub.getSnapshot().deepSync.job?.id, job.id);
    await hub.getSnapshot().actions.deepSync?.();
    assert.equal(starts, 0);
    await hub.getSnapshot().actions.retryRecovery?.();
    assert.deepEqual(retries, [job.id]);
    assert.equal(hub.getSnapshot().deepSync.status, 'error');
    assert.equal(hub.getSnapshot().deepSync.job?.recoveryStatus, 'RESTORED');
    assert.equal(hub.getSnapshot().deepSync.recoveryBusy, false);
  });

  it('requires a preview of the same job before accepting current state and ignores an old selection', async () => {
    const job = recoveryJob('UNAVAILABLE');
    const preview: CharacterRecoveryPreview = {
      jobId: job.id, characterId: 1, confirmationToken: 'confirmed-observation',
      observedAt: '2026-09-07T00:00:00Z', expiresAt: '2026-09-07T00:05:00Z',
      hofCharacterId: '10', name: '원본 서버 이름', patterns: [], equipment: [],
      positionGuard: { positions: [], selectedPosition: 'front', guardValue: '1', guardText: '호위' },
    };
    const previews = deferred<CharacterRecoveryPreview>();
    const acceptCalls: unknown[] = [];
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (id) => freshDetail(id),
      loadCurrentOperation: async () => job,
      previewRecovery: () => previews.promise,
      acceptRecovery: async (jobId, token) => {
        acceptCalls.push({ jobId, token });
        return { ...job, status: 'STOPPED', recoveryStatus: 'ACCEPTED' };
      },
    }));
    const first = makeHofCharacter(1);
    const second = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([first, second]);
    await hub.getSnapshot().actions.select(first);
    await hub.getSnapshot().actions.acceptRecovery?.();
    assert.deepEqual(acceptCalls, []);
    const oldActions = hub.getSnapshot().actions;
    const pending = oldActions.previewRecovery?.();
    await hub.getSnapshot().actions.select(second);
    previews.resolve(preview);
    await pending;
    assert.equal(hub.getSnapshot().deepSync.preview ?? null, null);
    await oldActions.acceptRecovery?.();
    assert.deepEqual(acceptCalls, []);
    await hub.getSnapshot().actions.previewRecovery?.();
    assert.equal(hub.getSnapshot().deepSync.preview?.confirmationToken, preview.confirmationToken);
    await hub.getSnapshot().actions.acceptRecovery?.();
    assert.deepEqual(acceptCalls, [{ jobId: job.id, token: preview.confirmationToken }]);
    assert.equal(hub.getSnapshot().deepSync.job?.recoveryStatus, 'ACCEPTED');
    assert.equal(hub.getSnapshot().deepSync.preview ?? null, null);
  });

  it('does not publish a recovery lookup from the previous account', async () => {
    const response = deferred<CharacterOperationJob | null>();
    let oldAccount = true;
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => freshDetail(1), loadCurrentOperation: () => oldAccount ? response.promise : Promise.resolve(null),
    }));
    const character = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([character]);
    const pending = hub.getSnapshot().actions.select(character);
    oldAccount = false;
    hub.activate('account-2');
    response.resolve(recoveryJob('UNAVAILABLE'));
    await pending;
    assert.equal(hub.getSnapshot().deepSync.job ?? null, null);
  });

  it('owns the authoritative roster and its lifecycle mutations', async () => {
    const initial = [makeHofCharacter(1), makeHofCharacter(2, { lifecycle: 'ARCHIVED' })];
    const archived = [makeHofCharacter(1, { lifecycle: 'ARCHIVED' }), initial[1]!];
    const restored = [initial[0]!, makeHofCharacter(2)];
    const deleted = [initial[0]!];
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

    assert.equal(hub.getSnapshot().selectedCharacter?.id, character.id);
    assert.equal(hub.getSnapshot().selectedCharacter?.detailSyncedAt, stored.detailSyncedAt);
    assert.equal(hub.getSnapshot().detail, stored);
    assert.equal(hub.getSnapshot().isLoading, false);
    assert.equal(hub.getSnapshot().errorMessage, null);
    assert.equal(refreshes, 0);
  });

  it('projects a selected detail directly into the canonical roster', async () => {
    const character = makeHofCharacter(1, {
      name: '목록 이름',
      revision: '2026-08-21T00:00:00Z',
    });
    const detail = makeHofCharacterDetail(1, {
      name: '상세 이름',
      revision: '2026-08-21T00:01:00Z',
      detailSyncedAt: new Date().toISOString(),
    });
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => detail,
    }));
    hub.activate('account-1');
    hub.observeRoster([character]);

    await hub.getSnapshot().actions.select(character);

    assert.equal(hub.getSnapshot().characters[0]?.name, '상세 이름');
    assert.equal(hub.getSnapshot().selectedCharacter?.name, '상세 이름');
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

  it('keeps a newer character observation when an older roster request completes later', () => {
    const original = makeHofCharacter(1, { revision: '2026-08-21T00:00:00Z' });
    const observedOnly = makeHofCharacter(2, {
      name: 'SSE로 새로 발견',
      revision: '2026-08-21T00:01:00Z',
    });
    const observed = makeHofCharacter(1, {
      name: 'SSE 최신 이름',
      revision: '2026-08-21T00:02:00Z',
    });
    const hub = new CharacterManagementHubModule(backend({}));
    hub.activate('account-1');
    hub.observeRoster([original]);
    const observations = hub.createObservationSink('account-1');
    const publishList = observations.beginRosterObservation();

    assert.equal(observations.observeCharacter(observed), true);
    assert.equal(observations.observeCharacter(observedOnly), true);
    assert.equal(publishList([original]), true);

    assert.equal(hub.getSnapshot().characters[0]?.name, 'SSE 최신 이름');
    assert.equal(hub.getSnapshot().characters[1]?.name, 'SSE로 새로 발견');
  });

  it('rejects roster and character observations retained from a previous account', () => {
    const hub = new CharacterManagementHubModule(backend({}));
    hub.activate('account-1');
    const stale = hub.createObservationSink('account-1');
    const publishList = stale.beginRosterObservation();

    hub.activate('account-2');
    const current = hub.createObservationSink('account-2');
    assert.equal(stale.observeCharacter(makeHofCharacter(1)), false);
    assert.equal(publishList([makeHofCharacter(1)]), false);
    assert.equal(current.observeCharacter(makeHofCharacter(2)), true);

    assert.deepEqual(hub.getSnapshot().characters.map((character) => character.id), [2]);
  });

  it('keeps a newer SSE projection across a command roster and detail reload', async () => {
    const original = makeHofCharacter(1, {
      name: '명령 전 이름',
      revision: '2026-08-21T00:00:00Z',
    });
    const observed = makeHofCharacter(1, {
      name: 'SSE 최신 이름',
      revision: '2026-08-21T00:02:00Z',
    });
    const roster = deferred<HofCharacter[]>();
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => makeHofCharacterDetail(1, {
        name: '늦은 명령 상세',
        revision: '2026-08-21T00:01:00Z',
        detailSyncedAt: new Date().toISOString(),
      }),
      executeCommand: async () => ({
        type: 'Completed',
        characterId: 1,
        revision: '2026-08-21T00:01:00Z',
        messages: [],
      }),
      loadRoster: () => roster.promise,
    }));
    hub.activate('account-1');
    hub.observeRoster([original]);
    await hub.getSnapshot().actions.select(original);
    const pending = hub.getSnapshot().actions.pray?.();
    await settle();

    hub.createObservationSink('account-1').observeCharacter(observed);
    roster.resolve([original]);
    await pending;

    assert.equal(hub.getSnapshot().characters[0]?.name, 'SSE 최신 이름');
    assert.equal(hub.getSnapshot().detail?.name, 'SSE 최신 이름');
  });

  it('keeps an archive mutation when an older list request completes later', async () => {
    const active = makeHofCharacter(1);
    const archived = makeHofCharacter(1, { lifecycle: 'ARCHIVED' });
    const hub = new CharacterManagementHubModule(backend({
      archiveCharacter: async () => [archived],
    }));
    hub.activate('account-1');
    hub.observeRoster([active]);
    const publishList = hub
      .createObservationSink('account-1')
      .beginRosterObservation();

    await hub.getSnapshot().actions.archiveCharacter?.(1);
    assert.equal(publishList([active]), false);

    assert.equal(hub.getSnapshot().characters[0]?.lifecycle, 'ARCHIVED');
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
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => stored,
      executeCommand: async () => {
        stored = makeHofCharacterDetail(1, {
          name: '명령 반영',
          revision: 'revision-2',
          detailSyncedAt: new Date().toISOString(),
        });
        return {
          type: 'Completed', characterId: 1, revision: 'revision-2', messages: [],
        };
      },
    }));
    const character = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);

    await hub.getSnapshot().actions.pray?.();

    assert.equal(hub.getSnapshot().detail?.name, '명령 반영');
  });

  it('builds revision commands from the selected detail and publishes identity resolution as resource state', async () => {
    const commands: CharacterCommand[] = [];
    const character = makeHofCharacter(1, { revision: 'roster-revision' });
    const detail = makeHofCharacterDetail(1, {
      revision: 'detail-revision',
      detailSyncedAt: new Date().toISOString(),
    });
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => detail,
      executeCommand: async (command) => {
        commands.push(command);
        return command.type === 'KNOCKBACK'
          ? {
              type: 'IdentityResolutionRequired',
              characterId: 1,
              candidates: [],
              message: '새 HOF ID를 선택해 주세요.',
            }
          : {
              type: 'Completed',
              characterId: 1,
              revision: 'next-revision',
              messages: [],
            };
      },
    }));
    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);

    await hub.getSnapshot().actions.allocateStats?.({ STR: 3 });
    await hub.getSnapshot().actions.useItem?.('reset-crystal');
    await hub.getSnapshot().actions.saveEquipmentPreset?.(2);
    await hub.getSnapshot().actions.knockback?.('캐릭터 1');

    assert.deepEqual(commands, [
      {
        type: 'ALLOCATE_STATS',
        characterId: 1,
        expectedRevision: 'detail-revision',
        amounts: { STR: 3 },
      },
      {
        type: 'USE_ITEM',
        characterId: 1,
        expectedRevision: 'detail-revision',
        itemValue: 'reset-crystal',
      },
      {
        type: 'SAVE_EQUIPMENT_PRESET',
        characterId: 1,
        expectedRevision: 'detail-revision',
        slotNumber: 2,
      },
      {
        type: 'KNOCKBACK',
        characterId: 1,
        expectedRevision: 'detail-revision',
        confirmationName: '캐릭터 1',
      },
    ]);
    assert.equal(
      hub.getSnapshot().identityResolution?.message,
      '새 HOF ID를 선택해 주세요.',
    );
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
    const pending = hub.getSnapshot().actions.pray?.();
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
    const requests: CharacterPatternApplyRequest[] = [];
    let loads = 0;
    const detail = freshDetail(1);
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async () => {
        loads += 1;
        return detail;
      },
      applyPattern: async (request) => {
        requests.push(request);
        return patternResult;
      },
    }));
    const character = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);

    const change = patternChange();
    await hub.getSnapshot().actions.savePattern?.(change);
    assert.deepEqual(hub.getSnapshot().patternConflict?.rowDiffs, conflict.rowDiffs);
    assert.equal(hub.getSnapshot().patternConflict?.currentRevision, conflict.currentRevision);
    assert.equal(hub.getSnapshot().detail, detail);
    assert.equal(loads, 1);
    assert.equal(requests[0]?.characterId, character.id);
    assert.equal(requests[0]?.baseRevision, detail.revision);
    assert.equal(requests[0]?.draft.baseRevision, detail.revision);

    patternResult = { revision: 'revision-3' };
    await hub.getSnapshot().actions.resolvePatternConflict?.();
    assert.equal(hub.getSnapshot().patternConflict, null);
    assert.equal(loads, 2);
    assert.equal(requests[1]?.force, true);
    assert.equal(requests[1]?.slotAction, 'REPLACE');
    assert.equal(requests[1]?.targetSlotCode, 'slot-2');
    assert.equal(requests[1]?.slotName, '대회랑');
  });

  it('캐릭터를 바꿔도 같은 계정의 동기화 진행과 결과를 유지하고 새 실행을 막는다', async () => {
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
    assert.equal(hub.getSnapshot().deepSync.status, 'running');
    await hub.getSnapshot().actions.deepSync?.();
    assert.equal(syncCalls, 1);
    hub.getSnapshot().actions.close();
    reportProgress({ characterId: 1, progress: [] });
    assert.equal(hub.getSnapshot().deepSync.progress?.characterId, first.id);
    await hub.getSnapshot().actions.select(second);
    completion.resolve({ characterId: 1, progress: [] });
    assert.equal(await pending, undefined);

    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
    assert.equal(hub.getSnapshot().deepSync.status, 'completed');
    assert.equal(hub.getSnapshot().deepSync.progress?.characterId, first.id);
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

  it('projects command roster and detail behind the current selection fence', async () => {
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
    }));
    const character = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([character]);
    await hub.getSnapshot().actions.select(character);

    await hub.getSnapshot().actions.pray?.();

    assert.equal(hub.getSnapshot().characters[0]?.name, '명령 후 이름');
    assert.equal(hub.getSnapshot().detail?.revision, 'revision-2');
  });

  it('does not project late command observations after selection changes', async () => {
    const command = deferred<CharacterCommandResult>();
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      executeCommand: () => command.promise,
      loadRoster: async () => [makeHofCharacter(1, { revision: 'revision-2' })],
    }));
    const first = makeHofCharacter(1);
    const second = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([first, second]);
    await hub.getSnapshot().actions.select(first);
    const pending = hub.getSnapshot().actions.pray?.();
    await hub.getSnapshot().actions.select(second);

    command.resolve({
      type: 'Completed', characterId: 1, revision: 'revision-2', messages: [],
    });
    await pending;

    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
    assert.equal(hub.getSnapshot().detail?.id, second.id);
  });

  it('does not project a late authoritative refresh after selection changes', async () => {
    const refresh = deferred<HofCharacterDetail>();
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      refreshAuthoritativeDetail: () => refresh.promise,
    }));
    const first = makeHofCharacter(1);
    const second = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([first, second]);
    await hub.getSnapshot().actions.select(first);

    const pending = hub.getSnapshot().actions.refresh();
    await hub.getSnapshot().actions.select(second);
    refresh.resolve(freshDetail(1));
    await pending;

    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
    assert.equal(hub.getSnapshot().detail?.id, second.id);
  });

  it('does not project a late identity link after the account changes', async () => {
    const link = deferred<HofCharacter[]>();
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      linkCharacter: () => link.promise,
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

    assert.equal(hub.getSnapshot().selectedCharacter?.id, second.id);
  });

  it('바뀐 미리보기를 재확인해야 실행하며 이전 확인창과 clear 콜백은 새 미리보기에 적용되지 않는다', async () => {
    const request = transferRequest(2, 1);
    const before = { ...transferPreview(2, 1), confirmationToken: 'before' };
    const after = { ...transferPreview(2, 1), confirmationToken: 'after', steps: [{ id: 'skill:new', dependsOn: [], skillValue: 'new' }] };
    const submitted: unknown[] = [];
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      previewTransfer: async () => before,
      executeTransfer: async (value) => {
        submitted.push(value);
        return submitted.length === 1
          ? { targetCharacterId: 1, results: [], nextStepIndex: 0, outcome: 'PREVIEW_CHANGED', preview: after, message: '변경된 미리보기를 다시 확인해 주세요.' }
          : { targetCharacterId: 1, results: [], nextStepIndex: 0, outcome: 'COMPLETED', finalSettingsConfirmed: true };
      },
    }));
    const target = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([target, makeHofCharacter(2)]);
    await hub.getSnapshot().actions.select(target);
    await hub.getSnapshot().actions.previewTransfer?.(request);
    const oldActions = hub.getSnapshot().actions;

    await oldActions.executeTransfer?.();

    assert.equal(hub.getSnapshot().transfer.status, 'ready');
    assert.equal(hub.getSnapshot().transfer.preview, after);
    assert.equal(hub.getSnapshot().transfer.result, null);
    assert.equal(hub.getSnapshot().transfer.progress, null);
    assert.match(hub.getSnapshot().transfer.errorMessage!, /다시 확인/);
    await oldActions.executeTransfer?.();
    oldActions.clearTransfer();
    assert.equal(submitted.length, 1);
    assert.equal(hub.getSnapshot().transfer.preview, after);
    await hub.getSnapshot().actions.executeTransfer?.();
    assert.deepEqual(submitted, [
      { ...request, confirmationToken: 'before' },
      { ...request, confirmationToken: 'after' },
    ]);
    assert.equal(hub.getSnapshot().transfer.status, 'completed');
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
    let presetReloads = 0;
    const hub = new CharacterManagementHubModule(backend({
      loadStoredDetail: async (characterId) => freshDetail(characterId),
      previewTransfer: async () => preview,
      executeTransfer: async (submitted, onProgress) => {
        assert.deepEqual(submitted, { ...request, confirmationToken: preview.confirmationToken });
        onProgress(progress);
        return result;
      },
      refreshAuthoritativeDetail: async (characterId) => {
        refreshedIds.push(characterId);
        return makeHofCharacterDetail(characterId, { revision: 'revision-2' });
      },
      reloadRelatedPresets: async () => { presetReloads += 1; },
    }));
    const target = makeHofCharacter(1);
    const source = makeHofCharacter(2);
    hub.activate('account-1');
    hub.observeRoster([target, source]);
    await hub.getSnapshot().actions.select(target);
    await hub.getSnapshot().actions.previewTransfer?.(request);

    const completed = await hub.getSnapshot().actions.executeTransfer?.();

    assert.equal(completed, result);
    assert.equal(hub.getSnapshot().transfer.status, 'completed');
    assert.equal(hub.getSnapshot().transfer.progress, result);
    assert.equal(hub.getSnapshot().transfer.result, result);
    assert.deepEqual(refreshedIds, [target.id]);
    assert.equal(hub.getSnapshot().detail?.id, target.id);
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

function recoveryJob(recoveryStatus: CharacterOperationJob['recoveryStatus']): CharacterOperationJob {
  return { id: 91, operationType: 'DEEP_SYNC', status: 'FAILED', sourceCharacterId: null, targetCharacterId: 1,
    deepSync: { characterId: 1, progress: [] }, transfer: null, message: '원본 복원을 확인해 주세요.',
    updatedAt: '2026-09-07T00:00:00Z', finishedAt: '2026-09-07T00:00:00Z', recoveryStatus };
}

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

function patternChange() {
  return {
    base: { rows: [], position: '', guard: '' },
    draft: { rows: [], position: '', guard: '' },
    slotAction: 'REPLACE' as const,
    targetSlotCode: 'slot-2',
    slotName: '대회랑',
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
    confirmationToken: 'fixture-preview',
  };
}
