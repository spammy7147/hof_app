import * as SecureStore from 'expo-secure-store';

import { createRefreshTokenStorage } from './tokenStorage';

/** iOS/Android에서는 refresh token을 Expo SecureStore에만 저장한다. */
export const refreshTokenStorage = createRefreshTokenStorage('native', SecureStore);
export type { RefreshTokenStorage } from './tokenStorage';
