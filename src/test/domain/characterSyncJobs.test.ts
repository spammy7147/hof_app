import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { CharacterSyncEventResponse, HofCharacter } from '../../main/types/api';
import { makeCharacterSyncEvent, makeHofCharacter } from '../fixtures/api';
import {
  formatCharacterSyncProgress,
  shouldCloseCharacterSyncSubscription,
  upsertCharacterFromSyncEvent,
} from '../../main/domain/characterSyncJobs';

describe('character sync job utilities', () => {
  const existing = makeHofCharacter(1, {
    hofCharacterId: '111',
    name: '소셜',
    patternSlotCount: 1,
  });

  const incoming = makeHofCharacter(2, {
    hofCharacterId: '222',
    name: '카발',
    job: 'Cavalry',
    patternSlotCount: 3,
  });

  it('adds a character when a characterSynced SSE event arrives', () => {
    const next = upsertCharacterFromSyncEvent([existing], event('characterSynced', incoming));

    assert.deepEqual(next.map((character) => character.hofCharacterId), ['222', '111']);
  });

  it('replaces an existing character with the same HOF character id', () => {
    const next = upsertCharacterFromSyncEvent(
      [existing],
      event('characterSynced', { ...existing, name: '소셜2', patternSlotCount: 7 }),
    );

    assert.equal(next.length, 1);
    assert.equal(next[0]?.name, '소셜2');
    assert.equal(next[0]?.patternSlotCount, 7);
  });

  it('formats sync progress and closes only on terminal events', () => {
    assert.equal(formatCharacterSyncProgress(event('rosterParsed', null, 0, 45)), '0/45');
    assert.equal(formatCharacterSyncProgress(event('characterSynced', incoming, 17, 45)), '17/45');
    assert.equal(shouldCloseCharacterSyncSubscription(event('characterSynced', incoming)), false);
    assert.equal(shouldCloseCharacterSyncSubscription(event('completed', null)), true);
    assert.equal(shouldCloseCharacterSyncSubscription(event('failed', null)), true);
  });
});

function event(
  eventType: CharacterSyncEventResponse['eventType'],
  character: HofCharacter | null,
  syncedCount = 1,
  rosterCount = 2,
): CharacterSyncEventResponse {
  return makeCharacterSyncEvent({
    eventType,
    rosterCount,
    syncedCount,
    character,
  });
}
