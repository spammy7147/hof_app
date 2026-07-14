import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

describe('BattleRunPanel', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/main/features/battle/components/BattleRunPanel.tsx'),
    'utf8',
  );

  it('requires a preset or direct-selection choice before showing the party editor', () => {
    const pickerIndex = source.indexOf('<BattlePartyPresetPicker');
    const emptyCharacterMessageIndex = source.indexOf('동기화된 캐릭터가 없습니다.');
    const editorGateIndex = source.indexOf('{partySelectionComplete ? (');
    const editorIndex = source.indexOf('<BattlePartySelector');

    assert.notEqual(pickerIndex, -1);
    assert.notEqual(emptyCharacterMessageIndex, -1);
    assert.notEqual(editorGateIndex, -1);
    assert.notEqual(editorIndex, -1);
    assert.ok(pickerIndex < emptyCharacterMessageIndex);
    assert.ok(emptyCharacterMessageIndex < editorGateIndex);
    assert.ok(editorGateIndex < editorIndex);
    assert.match(source, /const partySelectionComplete = selectedMode != null;/);
    assert.match(source, /partySelectionComplete \? \([\s\S]*<BattlePartySelector/);
  });

  it('starts empty and records direct or preset selection without mutating saved presets', () => {
    assert.match(source, /useState<PartySelectionMode>\(null\)/);
    assert.match(source, /useState<number \| null>\(null\)/);
    assert.match(source, /useState<BattlePartyMember\[\]>\(emptyPartyMembers\)/);
    assert.match(source, /setSelectedMode\('direct'\);[\s\S]*setSelectedPresetId\(null\);[\s\S]*setParty\(emptyPartyMembers\(\)\);/);
    assert.match(source, /setSelectedMode\('preset'\);[\s\S]*setSelectedPresetId\(preset\.id\);[\s\S]*setParty\(createExecutablePartyFromPreset\(preset, characters\)\);/);
    assert.doesNotMatch(source, /onUpdatePartyPreset|savePartyPreset/);
  });

  it('keeps the picker visible and rehydrates untouched preset slots after character updates', () => {
    assert.match(source, /characters=\{characters\}/);
    assert.match(source, /presets=\{partyPresets\}/);
    assert.match(source, /loading=\{arePartyPresetsLoading\}/);
    assert.match(source, /errorMessage=\{partyPresetsError\}/);
    assert.match(source, /onRetry=\{onRetryPartyPresets\}/);
    assert.match(source, /useRef<BattlePartyMember\[\] \| null>\(null\)/);
    assert.match(source, /useRef<Set<number>>\(new Set\(\)\)/);
    assert.match(source, /presetSeedRef\.current = createPartyFromPreset\(preset\);/);
    assert.match(source, /rehydrateExecutablePartyFromPresetSeed\(/);
    assert.match(source, /getChangedBattlePartySlotIndexes\(party, nextParty\)/);
    assert.match(source, /dirtySlotIndexesRef\.current\.add\(slotIndex\)/);
    assert.match(source, /onPartyChange=\{handlePartyChange\}/);
    assert.match(source, /sanitizeBattlePartyForCharacters\(current, characters\)/);
    assert.match(source, /characters\.length === 0[\s\S]*동기화된 캐릭터가 없습니다\./);
    assert.doesNotMatch(source, /createDefaultBattleParty/);
  });
});
