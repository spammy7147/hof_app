import { createRefreshTokenStorage } from './tokenStorageCore';

export { createRefreshTokenStorage } from './tokenStorageCore';
export type { RefreshTokenStorage, SecureStoreAdapter } from './tokenStorageCore';

/** Node 테스트와 플랫폼을 특정하지 않은 환경은 웹과 동일하게 영구 저장을 하지 않는다. */
export const refreshTokenStorage = createRefreshTokenStorage('web', null);
