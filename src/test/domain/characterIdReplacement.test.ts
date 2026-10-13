import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CharacterManagementHubModule } from '../../main/domain/characterManagementHubModule';
import { PartyPresetCatalogModule } from '../../main/domain/partyPresetCatalogModule';
import { createExecutablePartyFromPreset } from '../../main/domain/partyPresets';
import { makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';
import type { PartyPresetResponse } from '../../main/types/api';

for (const action of ['knockback', 'linkCharacter', 'linkRosterCharacter'] as const) {
  it(`${action} 후 프리셋을 다시 선택하면 같은 캐릭터의 새 HOF ID로 파티를 구성한다`, async () => {
    let currentId = 'old-id';
    let catalogLoads = 0;
    const preset = (): PartyPresetResponse => ({
      id: 1, accountId: 1, name: '검증 프리셋', displayOrder: 0,
      isPrimary: true, folderId: null,
      createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z',
      members: Array.from({ length: 5 }, (_, slotIndex) => ({
        slotIndex, characterId: slotIndex === 0 ? currentId : null, patternSlot: null,
      })),
    });
    const unsupported = async (): Promise<never> => { throw new Error('검증 범위 밖 호출'); };
    const catalog = new PartyPresetCatalogModule({
      loadCatalog: async () => { catalogLoads++; return { folders: [], presets: [preset()] }; },
      createPreset: unsupported, updatePreset: unsupported, makePresetPrimary: unsupported,
      reorderPresets: unsupported, deletePreset: unsupported, createFolder: unsupported,
      renameFolder: unsupported, reorderFolders: unsupported, moveFolder: unsupported,
      deleteFolder: unsupported,
    });
    await catalog.activate('검증 계정');
    const roster = () => [makeHofCharacter(7, { hofCharacterId: currentId })];
    const detail = () => makeHofCharacterDetail(7, {
      hofCharacterId: currentId, detailSyncedAt: new Date().toISOString(),
    });
    const hub = new CharacterManagementHubModule({
      loadStoredDetail: async () => detail(), refreshAuthoritativeDetail: async () => detail(),
      loadRoster: async () => roster(),
      executeCommand: async () => {
        currentId = 'new-id';
        return { type: 'Completed', characterId: 7, revision: 'revision-2', messages: [] };
      },
      linkCharacter: async () => { currentId = 'new-id'; return roster(); },
      reloadRelatedPresets: () => catalog.getSnapshot().actions.refresh(),
    });
    hub.activate('검증 계정');
    hub.observeRoster(roster());
    await hub.getSnapshot().actions.select(roster()[0]!);
    if (action === 'knockback') await hub.getSnapshot().actions.knockback?.('캐릭터 7');
    else if (action === 'linkCharacter') await hub.getSnapshot().actions.linkCharacter?.('new-id');
    else await hub.getSnapshot().actions.linkRosterCharacter?.(7, 'new-id');

    assert.equal(hub.getSnapshot().selectedCharacter?.hofCharacterId, 'new-id');
    const cachedPreset = catalog.getSnapshot().catalog.presets[0]!;
    const party = createExecutablePartyFromPreset(cachedPreset, roster());
    console.log(JSON.stringify({ action, catalogLoads, cachedId: cachedPreset.members[0]?.characterId,
      selectedId: hub.getSnapshot().selectedCharacter?.hofCharacterId, partyId: party[0]?.characterId }));
    // 대조군: 서버 프리셋을 명시적으로 다시 읽으면 같은 캐릭터가 복구된다.
    await catalog.getSnapshot().actions.refresh();
    assert.equal(createExecutablePartyFromPreset(catalog.getSnapshot().catalog.presets[0]!, roster())[0]?.characterId, 'new-id');
    assert.equal(party[0]?.characterId, 'new-id');
  });
}

for (const action of ['knockback', 'linkCharacter'] as const) {
  for (const changeAccount of [false, true]) {
    it(`${action} 대기 중 ${changeAccount ? '계정' : '선택 캐릭터'} 변경 시 계정 경계에 맞게 ID를 대체한다`, async () => {
      let complete!: () => void;
      const pending = new Promise<void>((resolve) => { complete = resolve; });
      let reloads = 0;
      const before = makeHofCharacter(7, { hofCharacterId: 'old-id' });
      const after = { ...before, hofCharacterId: 'new-id', revision: '2026-08-18T00:00:00Z' };
      const other = makeHofCharacter(8);
      const detail = (id: number) => makeHofCharacterDetail(id, {
        hofCharacterId: id === before.id ? before.hofCharacterId : other.hofCharacterId,
        detailSyncedAt: new Date().toISOString(),
      });
      const hub = new CharacterManagementHubModule({
        loadStoredDetail: async (id) => detail(id), refreshAuthoritativeDetail: async (id) => detail(id),
        loadRoster: async () => [after, other],
        executeCommand: async () => { await pending; return { type: 'Completed', characterId: 7, revision: 'next', messages: [] }; },
        linkCharacter: async () => { await pending; return [after, other]; },
        reloadRelatedPresets: async () => { reloads++; },
      });
      hub.activate('first');
      hub.observeRoster([before, other]);
      await hub.getSnapshot().actions.select(before);
      const operation = action === 'knockback'
        ? hub.getSnapshot().actions.knockback?.(before.name)
        : hub.getSnapshot().actions.linkCharacter?.('new-id');
      if (changeAccount) { hub.activate('second'); hub.observeRoster([other]); }
      await hub.getSnapshot().actions.select(other);
      complete();
      await operation;
      assert.equal(reloads, changeAccount ? 0 : 1);
      assert.equal(hub.getSnapshot().selectedCharacter?.id, other.id);
      assert.equal(hub.getSnapshot().characters.find((item) => item.id === before.id)?.hofCharacterId,
        changeAccount ? undefined : 'new-id');
    });
  }
}

it('명단 관측에서 같은 기록의 ID가 바뀌어도 프리셋을 갱신한다', async () => {
  let reloads = 0;
  const hub = new CharacterManagementHubModule({
    loadStoredDetail: async () => makeHofCharacterDetail(7),
    refreshAuthoritativeDetail: async () => makeHofCharacterDetail(7),
    reloadRelatedPresets: async () => { reloads++; },
  });
  hub.activate('account');
  hub.observeRoster([makeHofCharacter(7, { hofCharacterId: 'old-id' })]);
  const sink = hub.createObservationSink('account');
  sink.beginRosterObservation()([makeHofCharacter(7, { hofCharacterId: 'new-id' })]);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(reloads, 1);
});
