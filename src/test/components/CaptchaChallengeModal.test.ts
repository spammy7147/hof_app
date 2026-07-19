import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

describe('captcha challenge modal', () => {
  const modalSource = readFileSync(
    resolve(process.cwd(), 'src/main/components/CaptchaChallengeModal.tsx'),
    'utf8',
  );
  const appSource = readFileSync(resolve(process.cwd(), 'src/main/App.tsx'), 'utf8');

  it('renders the authenticated image source supplied by the API client', () => {
    assert.match(appSource, /api\.getAuthenticatedImageSource\(currentCaptcha\.imageUrl\)/);
    assert.match(appSource, /imageSource=\{captchaImageSource\}/);
    assert.match(modalSource, /source=\{imageSource\}/);
  });

  it('shows a useful message when the captcha image request fails', () => {
    assert.match(modalSource, /onError=\{handleImageError\}/);
    assert.match(modalSource, /캡차 이미지를 불러오지 못했습니다/);
  });

  it('keeps the retry input reachable when captcha content is taller than the screen', () => {
    assert.match(modalSource, /\bScrollView\b/);
    assert.match(modalSource, /keyboardShouldPersistTaps="handled"/);
    assert.match(modalSource, /maxHeight:\s*'90%'/);
  });
});
