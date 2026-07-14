import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

describe('BattlePartyPresetPicker', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/main/features/battle/components/BattlePartyPresetPicker.tsx'),
    'utf8',
  );

  it('provides a searchable preset dropdown with accessible list options', () => {
    assert.match(source, /filterPartyPresets/);
    assert.match(source, /프리셋 이름 또는 캐릭터 검색/);
    assert.match(source, /<FlatList/);
    assert.match(source, /nestedScrollEnabled/);
    assert.match(source, /keyboardShouldPersistTaps="handled"/);
    assert.match(source, /accessibilityState=\{\{ expanded/);
    assert.match(source, /accessibilityState=\{\{ selected:/);
  });

  it('keeps direct selection available outside preset results', () => {
    assert.match(source, /캐릭터 직접 선택/);
    assert.match(source, /프리셋 없이 캐릭터 5명과 패턴 지정/);
    assert.match(source, /onSelectDirect/);
  });

  it('shows a retry action without disabling direct selection after an error', () => {
    assert.match(source, /다시 시도/);
    assert.match(source, /onRetry/);
    assert.doesNotMatch(source, /disabled=\{errorMessage != null\}/);
  });
});
