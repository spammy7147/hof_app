import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('battle tab screen', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/main/screens/BattleTabScreen.tsx'), 'utf8');

  it('does not expose a manual captcha button in battle controls', () => {
    assert.doesNotMatch(source, /CaptchaChallengeButton/);
  });

  it('shows map metadata including dynamic key counts on each map row', () => {
    assert.match(source, /formatBattleMapMeta/);
    assert.match(source, /styles\.mapMeta/);
  });

  it('refreshes the map category after a battle so dynamic limits stay current', () => {
    assert.match(source, /refreshMapsAfterBattle/);
    assert.match(source, /keyCount: currentMap\.keyCount == null/);
    assert.match(source, /Math\.max\(0, currentMap\.keyCount - battleCount\)/);
    assert.match(source, /attemptCount: currentMap\.attemptCount == null/);
    assert.match(source, /winCount: currentMap\.winCount == null/);
    assert.match(source, /currentMap\.winCount - victoryCount/);
  });

  it('never builds a battle request from an unresolved nullable map code', () => {
    assert.match(source, /map\.mapCode == null \|\| !map\.resolved/);
    assert.match(source, /맵 코드 확인 대기/);
    assert.match(source, /mapCode:\s*map\.mapCode/);
  });

  it('uses the shared collision-safe battle map key for all row state', () => {
    assert.match(source, /buildBattleMapStateKey/);
    assert.doesNotMatch(source, /function battleMapKey/);
  });

  it('coordinates party preset loading only when a runnable map opens', () => {
    assert.match(source, /onListPartyPresets: \(\) => Promise<PartyPresetResponse\[\]>/);
    assert.match(source, /PartyPresetLoadCoordinator/);
    assert.match(source, /partyPresetLoadCoordinatorRef\.current\.start\(onListPartyPresets, force\)/);
    assert.match(source, /partyPresetLoadCoordinatorRef\.current\.invalidate\(\)/);
    assert.match(source, /const loadPartyPresets = useCallback/);
    assert.match(source, /void loadPartyPresets\(\)/);
  });

  it('passes party preset loading state and retry through each battle map row', () => {
    assert.match(source, /partyPresets=\{partyPresets\}/);
    assert.match(source, /arePartyPresetsLoading=\{arePartyPresetsLoading\}/);
    assert.match(source, /partyPresetsError=\{partyPresetsError\}/);
    assert.match(source, /onRetryPartyPresets=\{\(\) => loadPartyPresets\(true\)\}/);
  });

  it('lets the first preset or direct-choice tap through while the keyboard is open', () => {
    assert.match(source, /<FlatList[\s\S]*keyboardShouldPersistTaps="handled"[\s\S]*renderItem=\{renderItem\}/);
  });
});
