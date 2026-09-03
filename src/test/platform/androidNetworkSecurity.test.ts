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
  it('이전 HOF 이미지 주소를 새 HTTPS 서버로 정규화한다', () => {
    assert.equal(
      normalizeHofAssetUrl('http://sic.zerosic.com/ZeroHOF/image/char/sknight02.gif'),
      'https://hof.zerosic.com/image/char/sknight02.gif',
    );
    const buildProperties = appConfig.expo.plugins?.find(
      (plugin): plugin is [string, { android?: { usesCleartextTraffic?: boolean } }] => (
        Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
      ),
    );
    assert.equal(buildProperties?.[1].android?.usesCleartextTraffic, true);
  });
});
