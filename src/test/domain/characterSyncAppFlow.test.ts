import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('character sync app flow', () => {
  it('uses the streaming sync job after loading stored characters', () => {
    const syncCharacters = syncSection(
      'const syncCharacters = useCallback',
      'const manualSyncCharacters = useCallback',
    );

    assert.match(syncCharacters, /setCharacters\(await api\.listCharacters\(\)\);/);
    assert.match(syncCharacters, /await startJob\(\);/);
    assert.doesNotMatch(syncCharacters, /syncCharactersIfNeeded/);
    assert.doesNotMatch(syncCharacters, /storedCharacters\.length === 0/);
  });

  it('does not replace streaming updates with an immediate sync-job snapshot', () => {
    const startCharacterSyncJob = syncSection(
      'const startJob = useCallback',
      'const syncCharacters = useCallback',
    );

    assert.doesNotMatch(startCharacterSyncJob, /fetchCharacterSyncJob/);
  });

  it('does not clear stored characters with the empty start-job response', () => {
    const startCharacterSyncJob = syncSection(
      'const startJob = useCallback',
      'const syncCharacters = useCallback',
    );

    assert.doesNotMatch(startCharacterSyncJob, /applyCharacterSyncSnapshot\(job\)/);
  });

  it('does not use snapshot polling while the SSE stream is open', () => {
    const source = readCharacterSyncSource();

    assert.doesNotMatch(source, /setInterval\(/);
    assert.doesNotMatch(source, /startCharacterSyncSnapshotPolling/);
    assert.doesNotMatch(source, /characterSyncSnapshotPollTimerRef/);
  });

  it('does not keep legacy blocking character sync API methods', () => {
    const backendApi = readFileSync(resolve(process.cwd(), 'src/main/services/backendApi.ts'), 'utf8');

    assert.doesNotMatch(backendApi, /syncCharacters\(/);
    assert.doesNotMatch(backendApi, /syncCharactersIfNeeded/);
    assert.doesNotMatch(backendApi, /characters\/sync[`'"]/);
    assert.doesNotMatch(backendApi, /characters\/sync-if-needed[`'"]/);
  });

  it('uses the same SSE sync flow for manual character resync', () => {
    const manualSyncCharacters = syncSection(
      'const manualSyncCharacters = useCallback',
      'const resetCharacterSync = useCallback',
    );
    const mainScreen = readFileSync(resolve(process.cwd(), 'src/main/screens/MainScreen.tsx'), 'utf8');

    assert.match(manualSyncCharacters, /await syncCharacters\(\);/);
    assert.match(mainScreen, /캐릭터 재동기화/);
    assert.match(mainScreen, /재동기화/);
    assert.match(mainScreen, /await onSyncCharacters\(\)/);
  });

  it('does not pass account ids through authenticated screen callbacks', () => {
    const files = [
      'src/main/App.tsx',
      'src/main/screens/MainScreen.tsx',
      'src/main/screens/BattleTabScreen.tsx',
      'src/main/screens/HomeTabScreen.tsx',
      'src/main/screens/DataTabScreen.tsx',
      'src/main/screens/SettingsTabScreen.tsx',
      'src/main/components/PartyPresetList.tsx',
      'src/main/components/CaptchaChallengeModal.tsx',
    ];

    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      assert.doesNotMatch(source, /accountId/, `${file} still contains accountId UI plumbing`);
    }
  });
});

function syncSection(
  startMarker: string,
  endMarker: string,
): string {
  const source = readCharacterSyncSource();
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);

  return source.slice(start, end);
}

function readCharacterSyncSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/main/features/characters/useCharacterSync.ts'), 'utf8');
}
