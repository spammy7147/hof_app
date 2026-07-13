const REFRESH_TOKEN_KEY = 'hof.refresh-token.v1';

/** BackendApiClient가 플랫폼별 refresh token 저장 방식을 몰라도 되게 하는 최소 계약이다. */
export type RefreshTokenStorage = {
  load: () => Promise<string | null>;
  save: (token: string) => Promise<void>;
  remove: () => Promise<void>;
};

/** Expo SecureStore의 필요한 함수만 추려 순수 단위 테스트가 가능하게 만든 adapter 계약이다. */
export type SecureStoreAdapter = {
  isAvailableAsync: () => Promise<boolean>;
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

/**
 * 네이티브는 OS 보안 저장소를 사용하고 웹은 refresh token을 JavaScript 저장소에 절대 기록하지 않는다.
 * 웹의 refresh token은 백엔드가 설정한 HttpOnly 쿠키에만 존재한다.
 */
export function createRefreshTokenStorage(
  platform: 'native' | 'web',
  secureStore: SecureStoreAdapter | null,
): RefreshTokenStorage {
  return {
    async load() {
      if (platform === 'web' || !secureStore || !(await secureStore.isAvailableAsync())) return null;
      return secureStore.getItemAsync(REFRESH_TOKEN_KEY);
    },

    async save(token: string) {
      if (platform === 'web') return;
      if (!secureStore || !(await secureStore.isAvailableAsync())) {
        throw new Error('이 기기에서는 보안 로그인 저장소를 사용할 수 없습니다.');
      }
      await secureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
    },

    async remove() {
      if (platform === 'web' || !secureStore || !(await secureStore.isAvailableAsync())) return;
      await secureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    },
  };
}

/** Node 테스트와 플랫폼을 특정하지 않은 환경은 웹과 동일하게 영구 저장을 하지 않는다. */
export const refreshTokenStorage = createRefreshTokenStorage('web', null);
