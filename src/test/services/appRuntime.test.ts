import assert from 'node:assert/strict';
import Module from 'node:module';
import { after, it } from 'node:test';

const moduleLoader = Module as typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleLoader._load;
moduleLoader._load = function loadWithReactNativeStub(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === 'react-native') return { Platform: { OS: 'ios' } };
  return originalModuleLoad.call(this, request, parent, isMain);
};

after(() => {
  moduleLoader._load = originalModuleLoad;
});

it('keeps one backend API client for the whole app process', async () => {
  const { getAppBackendApiClient } = await import('../../main/services/appRuntime');

  assert.equal(getAppBackendApiClient(), getAppBackendApiClient());
});
