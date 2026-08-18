import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

describe('fixed bottom actions', () => {
  const hostSource = readFileSync(
    resolve(process.cwd(), 'src/main/components/FixedBottomAction.tsx'),
    'utf8',
  );
  const mainSource = readFileSync(
    resolve(process.cwd(), 'src/main/screens/MainScreen.tsx'),
    'utf8',
  );
  const skillsSource = readFileSync(
    resolve(process.cwd(), 'src/main/features/characters/skills/CharacterSkillsScreen.tsx'),
    'utf8',
  );

  it('renders the active action as a sibling below the flexible screen content', () => {
    assert.match(hostSource, /<View style=\{styles\.content\}>\{children\}<\/View>/);
    assert.match(hostSource, /accessibilityLabel="고정 하단 작업"/);
    assert.match(hostSource, /host:\s*\{ flex: 1, minHeight: 0 \}/);
    assert.match(hostSource, /content:\s*\{ flex: 1, minHeight: 0 \}/);
  });

  it('provides one app-level host around the active screen', () => {
    assert.match(mainSource, /<FixedBottomActionHost>/);
    assert.match(mainSource, /\{renderActiveTab\(\{/);
    assert.match(mainSource, /<\/FixedBottomActionHost>/);
  });

  it('keeps static skill points in content and fixes only a selected learning action', () => {
    const points = skillsSource.indexOf('<View style={styles.pointsRow}>');
    const selectedAction = skillsSource.indexOf('mode === "learn" && selected');
    const fixedAction = skillsSource.indexOf('<FixedBottomAction>', selectedAction);
    assert.ok(points >= 0 && selectedAction > points);
    assert.ok(fixedAction > selectedAction);
    assert.ok(skillsSource.indexOf('</FixedBottomAction>', fixedAction) > fixedAction);
  });
});
