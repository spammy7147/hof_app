import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('town icon asset mapping', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/main/screens/townAssets.ts'), 'utf8');

  it('uses static local sources for every APK town icon', () => {
    for (const file of [
      'fish.gif',
      'coin.gif',
      'potion.png',
      'box.gif',
      'card.gif',
      'sewing.gif',
      'book.gif',
      'smith.gif',
    ]) {
      assert.match(source, new RegExp(`assets/town/${file.replace('.', '\\.')}`));
    }
  });
});
