import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { normalizeHofAssetUrl } from '../../main/domain/hofAssets';

type ExpoConfig = {
  expo: {
    plugins?: Array<string | [string, { android?: { usesCleartextTraffic?: boolean } }]>
  };
};

const appConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), 'app.json'), 'utf8'),
) as ExpoConfig;

describe('Android HOF 이미지 네트워크 설정', () => {
  it('HTTP만 지원하는 HOF 이미지 서버의 평문 트래픽을 운영 빌드에서도 허용한다', () => {
    assert.equal(
      normalizeHofAssetUrl('/ZeroHOF/image/char/sknight02.gif'),
      'http://sic.zerosic.com/ZeroHOF/image/char/sknight02.gif',
    );
    const buildProperties = appConfig.expo.plugins?.find(
      (plugin): plugin is [string, { android?: { usesCleartextTraffic?: boolean } }] => (
        Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
      ),
    );
    assert.equal(buildProperties?.[1].android?.usesCleartextTraffic, true);
  });
});
