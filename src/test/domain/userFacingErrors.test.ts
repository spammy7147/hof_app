import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { toUserFacingErrorMessage } from '../../main/domain/userFacingErrors';

describe('user-facing error messages', () => {
  it('hides raw fetch and native connection error details', () => {
    assert.equal(
      toUserFacingErrorMessage(new Error('fetch failed: java.net.ConnectException: Failed to connect to /10.0.2.2:8080')),
      '서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
    );
    assert.equal(
      toUserFacingErrorMessage(new Error('Network request failed')),
      '서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
    );
  });

  it('keeps backend validation messages readable', () => {
    assert.equal(
      toUserFacingErrorMessage(new Error('HOF 계정을 찾지 못했습니다.')),
      'HOF 계정을 찾지 못했습니다.',
    );
  });
});
