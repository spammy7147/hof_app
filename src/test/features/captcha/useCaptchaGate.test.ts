import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

describe('useCaptchaGate on-demand preparation', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/main/features/captcha/useCaptchaGate.ts'),
    'utf8',
  );
  const appSource = readFileSync(resolve(process.cwd(), 'src/main/App.tsx'), 'utf8');

  it('prepares the latest captcha when the existing open action starts', () => {
    assert.match(source, /await api\.prepareCurrentCaptcha\(\)/);
    assert.doesNotMatch(source, /await api\.fetchCurrentCaptcha\(\)/);
  });

  it('submits the exact preparation version shown to the user', () => {
    assert.match(
      source,
      /preparationVersion:\s*captcha\.preparationVersion/,
    );
  });

  it('waits after detection and prepares only after the existing button opens authentication', () => {
    assert.doesNotMatch(appSource, /await openCaptchaModal\(\{ blocking: true \}\)/);
    assert.match(source, /pendingResumeRef\.current !== null/);
  });
});
