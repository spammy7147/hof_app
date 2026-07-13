import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeHofAssetUrl } from '../../main/domain/hofAssets';

describe('HOF asset utilities', () => {
  it('normalizes character image paths against the HOF static asset base URL', () => {
    assert.equal(
      normalizeHofAssetUrl('/ZeroHOF/image/social-knight.png'),
      'http://sic.zerosic.com/ZeroHOF/image/social-knight.png',
    );
    assert.equal(
      normalizeHofAssetUrl('image/char/sknight02.gif'),
      'http://sic.zerosic.com/ZeroHOF/image/char/sknight02.gif',
    );
  });

  it('keeps absolute asset URLs and ignores blank values', () => {
    assert.equal(
      normalizeHofAssetUrl('http://sic.zerosic.com/ZeroHOF/image/char/sknight02.gif'),
      'http://sic.zerosic.com/ZeroHOF/image/char/sknight02.gif',
    );
    assert.equal(normalizeHofAssetUrl('   '), null);
    assert.equal(normalizeHofAssetUrl(null), null);
  });
});
