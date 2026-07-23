import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('MainScreen character synchronization controls', () => {
  it('does not expose a manual full synchronization action', () => {
    const source = readFileSync('src/main/screens/MainScreen.tsx', 'utf8');
    assert.equal(source.includes('SyncCharactersButton'), false);
    assert.equal(source.includes('onSyncCharacters'), false);
    assert.equal(source.includes('재동기화'), false);
  });
});
