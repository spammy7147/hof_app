import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  createChromeExtensionRefreshTokenStorage,
  isChromeExtensionRuntime,
  type ChromeStorageArea,
} from '../../main/platform/chromeExtension';

const extensionGlobal = globalThis as typeof globalThis & { chrome?: unknown };
const originalChrome = extensionGlobal.chrome;

afterEach(() => {
  extensionGlobal.chrome = originalChrome;
});

describe('Chrome extension runtime', () => {
  it('detects only an extension page with a runtime id', () => {
    extensionGlobal.chrome = { runtime: { id: 'extension-id' } };
    assert.equal(isChromeExtensionRuntime(), true);

    extensionGlobal.chrome = { runtime: {} };
    assert.equal(isChromeExtensionRuntime(), false);
  });

  it('persists refresh and pending logout tokens in extension storage', async () => {
    const values = new Map<string, string>();
    const storage = createChromeExtensionRefreshTokenStorage(fakeStorageArea(values));

    await storage.save('refresh-token');
    assert.equal(await storage.load(), 'refresh-token');

    await storage.savePendingLogout?.('refresh-token');
    assert.equal(await storage.loadPendingLogout?.(), 'refresh-token');

    await storage.remove();
    await storage.removePendingLogout?.();
    assert.equal(await storage.load(), null);
    assert.equal(await storage.loadPendingLogout?.(), null);
  });
});

function fakeStorageArea(values: Map<string, string>): ChromeStorageArea {
  return {
    async get(key) {
      const value = values.get(key);
      return value == null ? {} : { [key]: value };
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
  };
}
