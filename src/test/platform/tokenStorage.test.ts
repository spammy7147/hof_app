import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRefreshTokenStorage, type SecureStoreAdapter } from '../../main/platform/tokenStorage';

describe('refresh token storage', () => {
  it('stores, loads, and removes native refresh tokens only through the secure adapter', async () => {
    const values = new Map<string, string>();
    const secureStore = fakeSecureStore(values);
    const storage = createRefreshTokenStorage('native', secureStore);

    await storage.save('refresh-token');
    assert.equal(await storage.load(), 'refresh-token');
    await storage.remove();
    assert.equal(await storage.load(), null);
  });

  it('never writes web refresh tokens to a JavaScript-accessible store', async () => {
    const values = new Map<string, string>();
    const storage = createRefreshTokenStorage('web', fakeSecureStore(values));

    await storage.save('must-not-be-stored');

    assert.equal(await storage.load(), null);
    assert.equal(values.size, 0);
  });

  it('fails native persistence when secure storage is unavailable', async () => {
    const secureStore = fakeSecureStore(new Map());
    secureStore.isAvailableAsync = async () => false;
    const storage = createRefreshTokenStorage('native', secureStore);

    await assert.rejects(storage.save('refresh-token'), /보안 로그인 저장소/);
  });
});

function fakeSecureStore(values: Map<string, string>): SecureStoreAdapter {
  return {
    isAvailableAsync: async () => true,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key) => {
      values.delete(key);
    },
  };
}
