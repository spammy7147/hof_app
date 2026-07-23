import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldStartAutomaticCharacterSync } from '../../main/domain/characterSyncPolicy';

describe('automatic character sync policy', () => {
  it('starts only when required and not yet evaluated for the session', () => {
    assert.equal(shouldStartAutomaticCharacterSync(true, false), true);
    assert.equal(shouldStartAutomaticCharacterSync(false, false), false);
    assert.equal(shouldStartAutomaticCharacterSync(true, true), false);
  });
});
