import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const appConfig = readFileSync(resolve(process.cwd(), 'app.json'), 'utf8');
const hofAssetsSource = readFileSync(
  resolve(process.cwd(), 'src/main/domain/hofAssets.ts'),
  'utf8',
);

describe('Android HOF 이미지 네트워크 설정', () => {
  it('HTTP만 지원하는 HOF 이미지 서버의 평문 트래픽을 운영 빌드에서도 허용한다', () => {
    assert.match(hofAssetsSource, /http:\/\/sic\.zerosic\.com\/ZeroHOF\//);
    assert.match(appConfig, /"expo-build-properties"/);
    assert.match(appConfig, /"usesCleartextTraffic"\s*:\s*true/);
  });
});
