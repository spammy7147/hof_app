import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const sheetPath = resolve(
  process.cwd(),
  'src/main/features/automation/components/AutomationAddSheet.tsx',
);
const sheetSource = existsSync(sheetPath) ? readFileSync(sheetPath, 'utf8') : '';

describe('AutomationAddSheet', () => {
  it('renders a controlled transparent native bottom sheet with accessible dismissal', () => {
    assert.match(sheetSource, /visible:\s*boolean/);
    assert.match(sheetSource, /<Modal[\s\S]*transparent/);
    assert.match(sheetSource, /onRequestClose=\{onClose\}/);
    assert.match(sheetSource, /accessibilityViewIsModal/);
    assert.match(sheetSource, /accessibilityLabel="자동화 추가 닫기"/);
    assert.match(sheetSource, /contentInsetAdjustmentBehavior="automatic"/);
  });

  it('shows the exact three typed automation rows in canonical order', () => {
    assert.match(sheetSource, /AUTOMATION_TYPE_ORDER\.map/);
    assert.match(sheetSource, /AUTOMATION_TYPE_METADATA\[type\]/);
    assert.match(sheetSource, /QUEST:[\s\S]*BATTLE_MAP:[\s\S]*ADVENTURE_MAP:/);
    assert.doesNotMatch(sheetSource, /KEY_QUEST|COOLDOWN_ADVENTURE|DAILY_ADVENTURE|TIME_BURN/);
  });

  it('marks an existing type as added and exposes its disabled accessibility state', () => {
    assert.match(sheetSource, /existingTypes\.has\(type\)/);
    assert.match(sheetSource, /추가됨/);
    assert.match(sheetSource, /accessibilityState=\{\{[\s\S]*disabled:[\s\S]*busy:/);
    assert.match(sheetSource, /disabled=\{disabled\}/);
  });

  it('guards duplicate taps and only closes after a successful add', () => {
    assert.match(sheetSource, /submittingTypes\.current\.has\(type\)/);
    assert.match(sheetSource, /submittingTypes\.current\.add\(type\)/);
    assert.match(sheetSource, /const added = await onAdd\(type\)/);
    assert.match(sheetSource, /if \(added\) onClose\(\)/);
    assert.match(sheetSource, /finally[\s\S]*submittingTypes\.current\.delete\(type\)/);
  });
});
