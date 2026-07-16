import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('party preset list component', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/main/components/PartyPresetList.tsx'), 'utf8');

  it('uses the reusable battle party selector inside expanded preset cards', () => {
    assert.match(source, /BattlePartySelector/);
    assert.match(source, /expandedPresetId/);
    assert.match(source, /formatPartyPresetSummary/);
  });

  it('keeps preset list cards compact until the user expands one', () => {
    assert.match(source, /프리셋 이름/);
    assert.match(source, /\+ 추가/);
    assert.doesNotMatch(source, /member-line/);
    assert.doesNotMatch(source, /partyMemberSummary/);
  });

  it('collapses the expanded preset card after a successful save', () => {
    assert.match(source, /저장이 성공하면 방금 편집하던 카드를 접어서 목록 화면으로 되돌리고/);
    assert.match(source, /setExpandedPresetId\(null\);/);
    assert.doesNotMatch(source, /setExpandedPresetId\(created\.id\);/);
  });

  it('shows a single primary badge and explicit make-primary action without replacement-on-delete logic', () => {
    assert.match(source, /isPrimary/);
    assert.match(source, /대표 프리셋/);
    assert.match(source, /대표로 지정/);
    assert.match(source, /onMakePartyPresetPrimary/);
    assert.doesNotMatch(source, /findReplacementPrimary|auto.*primary/i);
  });
});
