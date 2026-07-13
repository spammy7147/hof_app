import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('main screen character tabs', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/main/screens/MainScreen.tsx'), 'utf8');

  it('splits the character tab into character list and preset sub-tabs', () => {
    assert.match(source, /characterSubTabId/);
    assert.match(source, /캐릭터창/);
    assert.match(source, /프리셋/);
    assert.match(source, /PartyPresetList/);
  });
});
