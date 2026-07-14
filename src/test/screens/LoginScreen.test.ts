import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('login screen copy', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/main/screens/LoginScreen.tsx'), 'utf8');

  it('uses user-facing copy instead of backend terminology', () => {
    assert.match(source, /HOF 계정을 확인하고 안전하게 연결합니다\./);
    assert.doesNotMatch(source, /연결 주소/);
    assert.doesNotMatch(source, /backendBaseUrl/);
    assert.doesNotMatch(source, /백엔드 세션/);
    assert.doesNotMatch(source, /Backend ·/);
  });
});
