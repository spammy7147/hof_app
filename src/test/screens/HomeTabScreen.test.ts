import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const screenSource = readFileSync(resolve(process.cwd(), 'src/main/screens/HomeTabScreen.tsx'), 'utf8');
const mapSettingsSource = readFileSync(
  resolve(process.cwd(), 'src/main/features/automation/components/AutomationMapSettings.tsx'),
  'utf8',
);
const combinedSource = `${screenSource}\n${mapSettingsSource}`;

describe('home tab screen automation profiles', () => {
  it('uses user-created automation cards instead of fixed default cards', () => {
    const source = combinedSource;

    assert.match(source, /onCreateAutomationProfile/);
    assert.match(source, /buildCreateAutomationProfileRequest/);
    assert.match(source, /\+ 자동전투 추가/);
    assert.match(source, /onLoadBattleMaps/);
    assert.doesNotMatch(source, /자동전투 1/);
    assert.doesNotMatch(source, /자동전투 2/);
    assert.doesNotMatch(source, /자동전투 3/);
  });

  it('does not render the legacy automation mode selector', () => {
    const source = combinedSource;

    assert.doesNotMatch(source, /AUTOMATION_PROFILE_MODES/);
    assert.doesNotMatch(source, /formatAutomationProfileMode/);
    assert.doesNotMatch(source, /handleChangeMode/);
    assert.doesNotMatch(source, /styles\.modeRow/);
    assert.doesNotMatch(source, /일반 모험맵/);
    assert.doesNotMatch(source, /고급 던전/);
  });

  it('renders a map search input in automation map settings', () => {
    const source = combinedSource;

    assert.match(source, /filterAutomationProfileMaps/);
    assert.match(source, /placeholder="맵 검색"/);
    assert.match(source, /searchQuery/);
  });

  it('filters union out of automation map categories', () => {
    const source = combinedSource;

    assert.match(source, /filterAutomationProfileCategories/);
  });

  it('lets each selected automation map choose a party preset', () => {
    const source = combinedSource;
    const mainSource = readFileSync(resolve(process.cwd(), 'src/main/screens/MainScreen.tsx'), 'utf8');

    assert.match(source, /onListPartyPresets/);
    assert.match(source, /setAutomationProfileMapPreset/);
    assert.match(source, /선택된 맵/);
    assert.match(source, /프리셋 필요/);
    assert.match(source, /presetPicker/);
    assert.match(mainSource, /onListPartyPresets=\{onListPartyPresets\}/);
  });

  it('edits structured profile maps without legacy JSON helpers', () => {
    const source = combinedSource;

    assert.match(source, /profile\.maps/);
    assert.match(source, /maps:\s*patch\.maps \?\? profile\.maps/);
  });

  it('keeps unresolved map rows disabled and collapses a card after saving its name', () => {
    const source = combinedSource;

    assert.match(source, /map\.mapCode == null \|\| !map\.resolved/);
    assert.match(source, /맵 코드 확인 대기/);
    assert.match(source, /setExpandedProfileId\(\(current\) => \(current === profile\.id \? null : current\)\)/);
  });

  it('keeps resolved maps editable regardless of temporary enabled state and shows status text', () => {
    const source = combinedSource;

    assert.match(source, /const mapEditable = map\.mapCode != null && map\.resolved/);
    assert.match(source, /const mapUnavailable = saving \|\| !mapEditable/);
    assert.match(source, /getAutomationMapSkipReason\(map\)/);
    assert.doesNotMatch(source, /const mapUnavailable = saving \|\| !map\.enabled/);
  });

  it('merges stored maps missing from the catalog into the selected section', () => {
    const source = combinedSource;

    assert.match(source, /buildAutomationProfileSelectedMaps/);
    assert.match(source, /profileMaps,\s*orderedMaps,\s*categoryId/s);
    assert.match(source, /map\.groupName === '저장된 맵' && map\.mapCode != null\s*\? map\.mapCode/s);
  });

  it('uses shared collision-safe map keys for selected and candidate rows', () => {
    const source = combinedSource;

    assert.match(source, /buildBattleMapStateKey/);
    assert.match(source, /key={`selected:\${buildBattleMapStateKey\(map\)}`}/);
    assert.match(source, /key=\{buildBattleMapStateKey\(map\)\}/);
  });

  it('keeps Play disabled as future work rather than profile incompleteness', () => {
    const source = combinedSource;

    assert.match(source, /const AUTOMATION_EXECUTION_AVAILABLE = false/);
    assert.match(source, /disabled=\{!AUTOMATION_EXECUTION_AVAILABLE\}/);
    assert.match(source, /onPress=\{\(\) => undefined\}/);
    assert.match(source, /실행 루프/);
  });

  it('groups automation map candidates by large map category', () => {
    const source = combinedSource;

    assert.match(source, /groupBattleMaps/);
    assert.match(source, /AutomationMapGroupRow/);
    assert.match(source, /expandedMapGroupKeys/);
    assert.match(source, /automationMapTreeBranch/);
  });

  it('keeps expanded automation map rows tightly indented', () => {
    const source = combinedSource;

    assert.match(source, /automationMapTreeBranch:\s*\{[^}]*marginLeft:\s*4/s);
    assert.match(source, /automationMapTreeBranch:\s*\{[^}]*paddingLeft:\s*4/s);
    assert.match(source, /mapSelectMark:\s*\{[^}]*width:\s*18/s);
  });
});
