export const REFRESH_TOKEN_KEY = 'hof.refresh-token.v1';
export const PENDING_LOGOUT_KEY = 'hof.pending-logout.v1';
const WEB_PENDING_LOGOUT = 'WEB_COOKIE';

/** BackendApiClient가 플랫폼별 refresh token 저장 방식을 몰라도 되게 하는 최소 계약이다. */
export type RefreshTokenStorage = {
  load: () => Promise<string | null>;
  save: (token: string) => Promise<void>;
  remove: () => Promise<void>;
  loadPendingLogout?: () => Promise<string | null>;
  savePendingLogout?: (token: string | null) => Promise<void>;
  removePendingLogout?: () => Promise<void>;
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

    async loadPendingLogout() {
      if (platform === 'web') return readWebPendingLogout();
      if (!secureStore || !(await secureStore.isAvailableAsync())) return null;
      return secureStore.getItemAsync(PENDING_LOGOUT_KEY);
    },

    async savePendingLogout(token: string | null) {
      if (platform === 'web') {
        writeWebPendingLogout(WEB_PENDING_LOGOUT);
        return;
      }
      if (!token || !secureStore || !(await secureStore.isAvailableAsync())) {
        throw new Error('로그아웃 요청을 안전하게 보관할 수 없습니다.');
      }
      await secureStore.setItemAsync(PENDING_LOGOUT_KEY, token);
    },

    async removePendingLogout() {
      if (platform === 'web') {
        removeWebPendingLogout();
        return;
      }
      if (!secureStore || !(await secureStore.isAvailableAsync())) return;
      await secureStore.deleteItemAsync(PENDING_LOGOUT_KEY);
    },
  };
}

function readWebPendingLogout(): string | null {
  try {
    return globalThis.localStorage?.getItem(PENDING_LOGOUT_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeWebPendingLogout(value: string): void {
  try {
    globalThis.localStorage?.setItem(PENDING_LOGOUT_KEY, value);
  } catch {
    // 브라우저 저장소를 쓸 수 없으면 현재 runtime의 BackendApiClient가 재시도 상태를 유지한다.
  }
}

function removeWebPendingLogout(): void {
  try {
    globalThis.localStorage?.removeItem(PENDING_LOGOUT_KEY);
  } catch {
    // 이미 서버 logout이 성공했으므로 남은 marker는 다음 성공 시 멱등 정리된다.
  }
}
