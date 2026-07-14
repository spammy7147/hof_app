import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('Metro platform module resolution', () => {
  it('does not make the native token storage import itself at runtime', () => {
    const source = readFileSync('src/main/platform/tokenStorage.native.ts', 'utf8');

    assert.doesNotMatch(
      source,
      /import\s+\{[^}]+\}\s+from\s+['"]\.\/tokenStorage['"]/,
      'Metro resolves ./tokenStorage back to tokenStorage.native.ts and leaves the factory undefined.',
    );
  });
});
