import {
  PENDING_LOGOUT_KEY,
  REFRESH_TOKEN_KEY,
  type RefreshTokenStorage,
} from './tokenStorageCore';

export type ChromeStorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, string>) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

type ChromeExtensionGlobal = typeof globalThis & {
  chrome?: {
    runtime?: { id?: unknown };
    storage?: { local?: ChromeStorageArea };
  };
};

/** 일반 웹과 격리된 chrome-extension:// 실행 환경인지 확인한다. */
export function isChromeExtensionRuntime(): boolean {
  return typeof (globalThis as ChromeExtensionGlobal).chrome?.runtime?.id === 'string';
}

/** 확장 전용 저장소를 반환하며 일반 웹에서는 JavaScript 토큰 저장을 열지 않는다. */
export function getChromeExtensionStorageArea(): ChromeStorageArea | null {
  if (!isChromeExtensionRuntime()) return null;
  return (globalThis as ChromeExtensionGlobal).chrome?.storage?.local ?? null;
}

/**
 * 확장은 HttpOnly 쿠키를 사용할 수 없으므로 Chrome의 확장 격리 저장소에 refresh token을 보관한다.
 * service worker가 이 영역을 TRUSTED_CONTEXTS로 제한해 content script 노출을 막는다.
 */
export function createChromeExtensionRefreshTokenStorage(
  storage: ChromeStorageArea,
): RefreshTokenStorage {
  const read = async (key: string): Promise<string | null> => {
    const value = (await storage.get(key))[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  return {
    load: () => read(REFRESH_TOKEN_KEY),
    save: (token) => storage.set({ [REFRESH_TOKEN_KEY]: token }),
    remove: () => storage.remove(REFRESH_TOKEN_KEY),
    loadPendingLogout: () => read(PENDING_LOGOUT_KEY),
    async savePendingLogout(token) {
      if (!token) throw new Error('로그아웃 요청을 확장 저장소에 보관할 수 없습니다.');
      await storage.set({ [PENDING_LOGOUT_KEY]: token });
    },
    removePendingLogout: () => storage.remove(PENDING_LOGOUT_KEY),
  };
}
