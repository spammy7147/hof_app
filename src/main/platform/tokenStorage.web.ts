import { createRefreshTokenStorage } from './tokenStorageCore';
import {
  createChromeExtensionRefreshTokenStorage,
  getChromeExtensionStorageArea,
} from './chromeExtension';

const extensionStorage = getChromeExtensionStorageArea();

/** 일반 웹은 HttpOnly 쿠키, 확장 페이지는 격리된 chrome.storage를 사용한다. */
export const refreshTokenStorage = extensionStorage
  ? createChromeExtensionRefreshTokenStorage(extensionStorage)
  : createRefreshTokenStorage('web', null);
export type { RefreshTokenStorage } from './tokenStorageCore';
