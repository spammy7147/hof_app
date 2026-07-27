import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

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

const DIRECT_PICKER_CONSUMERS = [
  'src/main/features/automation/components/AdventureMapAutomationEditor.tsx',
  'src/main/features/automation/components/BattleMapAutomationEditor.tsx',
  'src/main/features/automation/components/BattleMapPresetPickerModal.tsx',
  'src/main/features/automation/components/QuestMissionMapList.tsx',
  'src/main/features/battle/components/BattlePartyPresetPicker.tsx',
] as const;

const LEGACY_EXPANSION_IDENTIFIERS = [
  'PartyPresetExpanded' + 'Path',
  'initialExpanded' + 'Path',
  'expanded' + 'Path',
  'onExpanded' + 'PathChange',
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
      for (const identifier of LEGACY_EXPANSION_IDENTIFIERS) {
        assert.equal(source.includes(identifier), false, `${file} uses the legacy single-path API`);
      }
    }
  });

  it('passes each received catalog object unchanged along the shared picker chain', () => {
    const sourceByFile = new Map(CONSUMERS.map((file) => [file, readFileSync(file, 'utf8')]));

    assert.equal(findJsxAttributeExpression(sourceByFile.get(CONSUMERS[0])!, 'PartyPresetPickerModal', 'catalog'), 'catalog');
    assert.equal(findJsxAttributeExpression(sourceByFile.get(CONSUMERS[1])!, 'PartyPresetPickerModal', 'catalog'), 'catalog');
    assert.equal(findJsxAttributeExpression(sourceByFile.get(CONSUMERS[2])!, 'BattleMapPresetPickerModal', 'catalog'), 'partyPresetCatalog.catalog');
    assert.equal(findJsxAttributeExpression(sourceByFile.get(CONSUMERS[3])!, 'BattleMapPresetPickerModal', 'catalog'), 'partyPresetCatalog.catalog');
    assert.equal(findJsxAttributeExpression(sourceByFile.get(CONSUMERS[4])!, 'QuestSummaryCard', 'partyPresetCatalog'), 'partyPresetCatalog.catalog');
    assert.equal(findJsxAttributeExpression(sourceByFile.get(CONSUMERS[5])!, 'QuestMapEditor', 'partyPresetCatalog'), 'partyPresetCatalog');
    assert.equal(findJsxAttributeExpression(sourceByFile.get(CONSUMERS[6])!, 'QuestMapList', 'partyPresetCatalog'), 'partyPresetCatalog');
    assert.equal(findJsxAttributeExpression(sourceByFile.get(CONSUMERS[7])!, 'BattleMapPresetPickerModal', 'catalog'), 'partyPresetCatalog');
  });

  it('discovers every feature wrapper that renders a shared picker', () => {
    const discovered = listTypeScriptFiles('src/main/features')
      .filter((file) => /<(?:PartyPresetPickerModal|BattleMapPresetPickerModal)\b/.test(readFileSync(file, 'utf8')))
      .sort();

    assert.deepEqual(discovered, [...DIRECT_PICKER_CONSUMERS]);
  });

  it('has no legacy single-path expansion API left in the shared picker core', () => {
    for (const file of [
      'src/main/components/PartyPresetTree.tsx',
      'src/main/components/PartyPresetPickerModal.tsx',
    ]) {
      assert.doesNotMatch(
        readFileSync(file, 'utf8'),
        new RegExp(LEGACY_EXPANSION_IDENTIFIERS.join('|')),
        `${file} retains the legacy single-path API`,
      );
    }
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

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && path.endsWith('.tsx') ? [path] : [];
  });
}

function findJsxAttributeExpression(source: string, component: string, attributeName: string): string {
  const sourceFile = ts.createSourceFile('consumer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
      && node.tagName.getText(sourceFile) === component) {
      const attribute = node.attributes.properties.find((property) => (
        ts.isJsxAttribute(property) && property.name.getText(sourceFile) === attributeName
      ));
      if (attribute && ts.isJsxAttribute(attribute)
        && attribute.initializer && ts.isJsxExpression(attribute.initializer)
        && attribute.initializer.expression) {
        matches.push(attribute.initializer.expression.getText(sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(matches.length, 1, `${component}.${attributeName} must occur exactly once`);
  return matches[0]!;
}
