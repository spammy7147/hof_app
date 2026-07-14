import { createRefreshTokenStorage } from './tokenStorageCore';

/** 웹에서는 HttpOnly 쿠키를 사용하므로 JavaScript 토큰 저장소는 의도적으로 비어 있다. */
export const refreshTokenStorage = createRefreshTokenStorage('web', null);
export type { RefreshTokenStorage } from './tokenStorageCore';
