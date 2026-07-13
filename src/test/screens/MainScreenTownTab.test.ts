import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('main screen town tab', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/main/screens/MainScreen.tsx'), 'utf8');

  it('renders the categorized town screen instead of the placeholder', () => {
    assert.match(source, /import \{ TownTabScreen \} from '\.\/TownTabScreen';/);
    assert.match(source, /case 'town':[\s\S]*<TownTabScreen \/>/);
    assert.doesNotMatch(source, /상점, 교환소, 작업장 준비 중/);
  });
});
