import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('character list component', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/main/components/CharacterList.tsx'), 'utf8');

  it('passes character image URLs to list rows', () => {
    assert.match(source, /imageUrl=\{item\.imageUrl \?\? null\}/);
    assert.match(source, /<Image source=\{\{ uri: normalizedImageUrl \}\}/);
  });

  it('does not render the HOF character id in each row', () => {
    assert.doesNotMatch(source, /idText/);
    assert.doesNotMatch(source, /<Text[^>]*>\{hofCharacterId\}<\/Text>/);
  });
});
