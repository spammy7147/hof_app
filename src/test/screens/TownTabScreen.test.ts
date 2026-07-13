import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('town tab screen', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/main/screens/TownTabScreen.tsx'), 'utf8');

  it('keeps categories visible and swaps only the two-column menu grid', () => {
    assert.match(source, /TOWN_CATEGORIES\.map/);
    assert.match(source, /getTownMenusForCategory\(selectedCategoryId\)/);
    assert.match(source, /setSelectedCategoryId\(categoryId\)/);
    assert.match(source, /setSelectedMenuId\(null\)/);
    assert.doesNotMatch(source, /ArrowLeft|뒤로/);
  });

  it('supports town and quest sub-tabs without making service requests', () => {
    assert.match(source, /마을/);
    assert.match(source, /퀘·교환/);
    assert.match(source, /서비스 준비 중/);
    assert.match(source, /expo-image/);
    assert.doesNotMatch(source, /BackendApi|fetch\(|onLoad|onRun|onSubmit/);
  });
});
