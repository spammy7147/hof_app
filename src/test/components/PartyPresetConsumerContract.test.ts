import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const CONSUMERS = [
  'src/main/features/battle/components/BattlePartyPresetPicker.tsx',
  'src/main/features/automation/components/BattleMapPresetPickerModal.tsx',
  'src/main/features/automation/components/AdventureMapAutomationEditor.tsx',
  'src/main/features/automation/components/BattleMapAutomationEditor.tsx',
  'src/main/features/automation/components/QuestAutomationEditor.tsx',
  'src/main/features/automation/components/QuestSummaryCard.tsx',
  'src/main/features/automation/components/QuestMapEditor.tsx',
  'src/main/features/automation/components/QuestMissionMapList.tsx',
] as const;

describe('party preset consumer contract', () => {
  it('accepts only the shared catalog and never reconstructs or reloads a flat catalog', () => {
    for (const file of CONSUMERS) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /\bpresets\??\s*:/, `${file} exposes a flat presets prop`);
      assert.doesNotMatch(source, /\bconst presets\s*=/, `${file} stores a private presets copy`);
      assert.doesNotMatch(source, /folders:\s*\[\]\s*,\s*presets/, `${file} synthesizes a folderless catalog`);
      assert.doesNotMatch(source, /onListPartyPresets/, `${file} retains a private flat loader`);
      assert.doesNotMatch(source, /\blistPartyPresets\b/, `${file} calls the legacy flat-list API`);
      assert.doesNotMatch(source, /\b(?:initialExpandedPath|expandedPath)\s*=/, `${file} uses the legacy expanded-path API`);
    }
  });

  it('passes each received catalog object unchanged along the shared picker chain', () => {
    const sourceByFile = new Map(CONSUMERS.map((file) => [file, readFileSync(file, 'utf8')]));

    assert.match(sourceByFile.get(CONSUMERS[0])!, /<PartyPresetPickerModal[\s\S]*?catalog=\{catalog\}/);
    assert.match(sourceByFile.get(CONSUMERS[1])!, /<PartyPresetPickerModal[\s\S]*?catalog=\{catalog\}/);
    assert.match(sourceByFile.get(CONSUMERS[2])!, /<BattleMapPresetPickerModal[\s\S]*?catalog=\{partyPresetCatalog\.catalog\}/);
    assert.match(sourceByFile.get(CONSUMERS[3])!, /<BattleMapPresetPickerModal[\s\S]*?catalog=\{partyPresetCatalog\.catalog\}/);
    assert.match(sourceByFile.get(CONSUMERS[4])!, /partyPresetCatalog=\{partyPresetCatalog\.catalog\}/);
    assert.match(sourceByFile.get(CONSUMERS[5])!, /partyPresetCatalog=\{partyPresetCatalog\}/);
    assert.match(sourceByFile.get(CONSUMERS[6])!, /partyPresetCatalog=\{partyPresetCatalog\}/);
    assert.match(sourceByFile.get(CONSUMERS[7])!, /<BattleMapPresetPickerModal[\s\S]*?catalog=\{partyPresetCatalog\}/);
  });

  it('keeps the canonical preset and folder arrays only in the MainScreen catalog resource', () => {
    const manager = readFileSync('src/main/components/PartyPresetList.tsx', 'utf8');
    const battleRun = readFileSync('src/main/features/battle/components/BattleRunPanel.tsx', 'utf8');
    const main = readFileSync('src/main/screens/MainScreen.tsx', 'utf8');

    assert.doesNotMatch(manager, /useState<PartyPresetResponse\[\]>/, 'PartyPresetList owns a private preset array');
    assert.doesNotMatch(manager, /useState<PartyPresetFolderResponse\[\]>/, 'PartyPresetList owns a private folder array');
    assert.doesNotMatch(manager, /useRef\((?:presets|folders)\)/, 'PartyPresetList retains a private canonical catalog reference');
    assert.doesNotMatch(manager, /\bset(?:Presets|Folders)\(/, 'PartyPresetList synchronizes a private canonical catalog');
    assert.doesNotMatch(battleRun, /useState<PartyPreset(?:Response|FolderResponse)\[\]>/, 'BattleRunPanel owns a private catalog array');
    assert.equal((main.match(/useState<PartyPresetCatalogResponse>/g) ?? []).length, 1);
  });
});
