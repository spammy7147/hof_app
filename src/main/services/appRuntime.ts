import { BackendApiClient } from './backendApi';

/** React remount와 관계없이 앱 프로세스가 공유하는 backend API client다. */
const appBackendApiClient = new BackendApiClient();

export function getAppBackendApiClient(): BackendApiClient {
  return appBackendApiClient;
}
