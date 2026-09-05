import { Platform } from 'react-native';

import { normalizeHofAssetUrl } from '../domain/hofAssets';
import type {
  BattleCategoryResponse,
  BattleLogResponse,
  BattleLogQuery,
  BattleMapResponse,
  BattleResultResponse,
  BattleStatsResponse,
  AdventureMapStatsPeriod,
  CaptchaChallengeResponse,
  CaptchaPassMaintenanceResponse,
  CharacterSyncEventResponse,
  CharacterSyncEventType,
  CharacterSyncJobResponse,
  CharacterCommand,
  CharacterCommandResult,
  CharacterPatternApplyRequest,
  CharacterPatternOperationResult,
  CharacterTransferPreviewRequest,
  CharacterTransferPreview,
  CharacterTransferExecutionResult,
  CharacterDeepSyncResponse,
  CharacterOperationJob,
  CreateAutomationEntryRequest,
  CreatePartyPresetFolderRequest,
  CreatePartyPresetRequest,
  HofCharacter,
  HofCharacterDetail,
  HofLoginRequest,
  LatestAndroidReleaseResponse,
  TokenResponse,
  HofObservedStatusResponse,
  HofStatusResponse,
  QuestSnapshot,
  MovePartyPresetFolderRequest,
  MoveMapBetweenGroupsRequest,
  PartyPresetCatalogResponse,
  PartyPresetResponse,
  RunBattleRequest,
  RegisterAndroidPushTargetRequest,
  RenamePartyPresetFolderRequest,
  ReorderPartyPresetFoldersRequest,
  ReorderPartyPresetsRequest,
  SubmitCaptchaAnswerRequest,
  TownApiPath,
  DevicePushTargetResponse,
  UnifiedAutomationAction,
  TypedAutomationAggregateResponse,
  UpdateAdventureMapAutomationRequest,
  UpdateAdventureMapGroupRequest,
  UpdateBattleMapAutomationRequest,
  UpdateBattleMapGroupRequest,
  UpdatePartyPresetRequest,
  UpdateQuestAutomationRequest,
  UpdateFishingAutomationRequest,
  UpdateRaidAutomationRequest,
  UpdateUnionAutomationRequest,
  UpdateHomeQuestAutomationRequest,
  AutomationHistoryPage,
  AutomationConvergenceStatus,
} from '../types/api';
import { refreshTokenStorage, type RefreshTokenStorage } from '../platform/tokenStorage';
import { isChromeExtensionRuntime } from '../platform/chromeExtension';
import { loadAndroidPushInstallationId } from '../platform/pushNotifications';
import { createSseConnection, type SseSubscription } from './sseClient';

/** 캐릭터 sync hook이 SSE 연결 상태와 event를 받는 callback 계약이다. */
export type CharacterSyncEventHandlers = {
  onEvent: (event: CharacterSyncEventResponse) => void;
  onOpen?: () => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
};

/** HTTP status와 백엔드 표준 code를 보존해 domain error 판정과 사용자 메시지 변환에 쓰는 예외다. */
export class BackendApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string | null,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'BackendApiError';
  }
}

export class ManualActionBusyError extends Error {
  constructor() {
    super('다른 요청을 처리 중입니다. 완료 후 다시 시도해 주세요.');
    this.name = 'ManualActionBusyError';
  }
}

export class SessionRecoveryMutationBlockedError extends Error {
  constructor() {
    super('로그인 상태를 복구한 뒤 다시 시도해 주세요.');
    this.name = 'SessionRecoveryMutationBlockedError';
  }
}

export type SessionRefreshEvent =
  | { type: 'refresh-succeeded' }
  | { type: 'refresh-failed'; error: unknown };

function normalizeQuestSnapshot(
  snapshot: Omit<QuestSnapshot, 'rewards'> & { rewards?: unknown },
): QuestSnapshot {
  return {
    ...snapshot,
    rewards: Array.isArray(snapshot.rewards)
      ? snapshot.rewards.filter(
        (reward): reward is string => typeof reward === 'string' && reward.trim().length > 0,
      )
      : [],
  };
}

/**
 * React Native/Expo 앱에서 Spring 백엔드 API를 호출하는 단일 client다.
 *
 * 화면 컴포넌트가 fetch 세부 구현을 몰라도 되도록 endpoint, JSON 처리, 에러 변환,
 * 이미지 URL 정규화, SSE 구독 생성을 이 클래스에 모아둔다.
 */
export class BackendApiClient {
  readonly baseUrl: string;
  private accessToken: string | null = null;
  private refreshPromise: Promise<void> | null = null;
  private readonly sessionChannel: BroadcastChannel | null;
  private tokenMutationPromise: Promise<void> = Promise.resolve();
  private authEpoch = 0;
  private disposed = false;
  private acceptsSessionTokenBroadcasts = true;
  private readonly tokenBroadcastListeners = new Set<(token: string | null) => void>();
  private readonly manualActionListeners = new Set<(pending: boolean) => void>();
  private readonly hofStatusListeners = new Set<(status: HofObservedStatusResponse) => void>();
  private readonly sessionRefreshListeners = new Set<(event: SessionRefreshEvent) => void>();
  private manualActionPending = false;
  private sessionMutationsBlocked = false;
  private androidPushTargetId: number | null = null;
  private acceptsPushRegistrations = true;
  private readonly inFlightPushRegistrations = new Set<Promise<DevicePushTargetResponse>>();
  private pendingLogoutToken: string | null = null;
  private readonly usesWebCookieSession: boolean;

  constructor(
    baseUrl = resolveBackendBaseUrl(),
    private readonly tokenStorage: RefreshTokenStorage = refreshTokenStorage,
  ) {
    this.baseUrl = normalizeBackendBaseUrl(baseUrl, process.env.NODE_ENV === 'production');
    this.usesWebCookieSession = Platform.OS === 'web' && !isChromeExtensionRuntime();
    this.sessionChannel = createSessionChannel((token) => this.receiveBroadcastToken(token));
  }

  /**
   * HOF 계정으로 로그인하고 플랫폼에 맞게 refresh token을 보관한다.
   */
  async login(request: HofLoginRequest): Promise<TokenResponse> {
    await this.completePendingLogout();
    this.acceptsSessionTokenBroadcasts = true;
    const epoch = this.beginAuthMutation();
    const response = await this.requestWithoutRefresh<TokenResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        ...request,
        clientType: this.usesWebCookieSession ? 'WEB' : 'NATIVE',
      }),
    });
    await this.acceptTokenResponse(response, epoch);
    if (this.isCurrentAuthEpoch(epoch)) this.acceptsPushRegistrations = true;
    return response;
  }

  /** 저장된 네이티브 토큰 또는 웹 HttpOnly 쿠키로 앱 시작 세션을 복원한다. */
  async restoreSession(): Promise<void> {
    const epoch = this.authEpoch;
    this.acceptsSessionTokenBroadcasts = true;
    if (await this.completePendingLogout()) {
      const ended = new BackendApiError(401, 'AUTH_TOKEN_INVALID', '로그아웃이 완료되었습니다.');
      this.publishSessionRefreshEvent({ type: 'refresh-failed', error: ended });
      throw ended;
    }
    if (!this.isCurrentAuthEpoch(epoch)) return;
    await this.refreshAccessToken(epoch);
    if (this.isCurrentAuthEpoch(epoch)) this.acceptsPushRegistrations = true;
  }

  /** 현재 refresh token 패밀리를 서버에서 폐기하고 로컬 토큰 상태도 비운다. */
  async logout(): Promise<void> {
    this.acceptsSessionTokenBroadcasts = false;
    this.acceptsPushRegistrations = false;
    const epoch = this.beginAuthMutation();
    const refreshToken = await this.tokenStorage.load().catch(() => null);
    const pushInstallationId = await loadAndroidPushInstallationId().catch(() => null);
    // Secure storage writes can fail independently from the already loaded credential.
    // Keep the in-memory marker and continue: the same runtime can still retry, while a
    // successful remote revocation must not be prevented by a local persistence outage.
    await this.savePendingLogout(refreshToken).catch(() => undefined);
    let localClearError: unknown = null;
    try {
      await this.clearTokenState(epoch);
    } catch (error) {
      localClearError = error;
    }
    try {
      await this.waitForPushRegistrations();
      await this.requestRemoteLogout(refreshToken, pushInstallationId);
      await this.removePendingLogout();
    } finally {
      this.androidPushTargetId = null;
      if (localClearError) throw localClearError;
    }
  }

  private async completePendingLogout(): Promise<boolean> {
    const pending = await this.loadPendingLogout();
    if (!pending) return false;
    const pushInstallationId = await loadAndroidPushInstallationId().catch(() => null);
    await this.requestRemoteLogout(pending === 'WEB_COOKIE' ? null : pending, pushInstallationId);
    await this.removePendingLogout();
    await this.clearLocalSession();
    return true;
  }

  private async requestRemoteLogout(
    refreshToken: string | null,
    pushInstallationId: string | null,
  ): Promise<void> {
    await this.requestWithoutRefresh<null>('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({
        ...(refreshToken ? { refreshToken } : {}),
        ...(this.androidPushTargetId == null ? {} : { pushTargetId: this.androidPushTargetId }),
        ...(this.androidPushTargetId != null || !pushInstallationId ? {} : { pushInstallationId }),
      }),
    });
  }

  private async loadPendingLogout(): Promise<string | null> {
    if (this.tokenStorage.loadPendingLogout) {
      return this.tokenStorage.loadPendingLogout().catch(() => this.pendingLogoutToken);
    }
    return this.pendingLogoutToken;
  }

  private async savePendingLogout(refreshToken: string | null): Promise<void> {
    this.pendingLogoutToken = refreshToken ?? 'WEB_COOKIE';
    await this.tokenStorage.savePendingLogout?.(refreshToken);
  }

  private async removePendingLogout(): Promise<void> {
    this.pendingLogoutToken = null;
    await this.tokenStorage.removePendingLogout?.();
  }

  /** 앱 runtime 종료 뒤 web broadcast와 보류 중인 인증 결과를 더 이상 받지 않는다. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.acceptsPushRegistrations = false;
    this.authEpoch += 1;
    if (this.sessionChannel) {
      this.sessionChannel.onmessage = null;
      this.sessionChannel.close();
    }
    this.tokenBroadcastListeners.clear();
    this.manualActionListeners.clear();
    this.hofStatusListeners.clear();
    this.sessionRefreshListeners.clear();
  }

  /** refresh 성공·실패를 React 인증 수명주기에 전달한다. */
  subscribeSessionRefreshEvents(listener: (event: SessionRefreshEvent) => void): () => void {
    this.sessionRefreshListeners.add(listener);
    return () => this.sessionRefreshListeners.delete(listener);
  }

  /** 일시적인 세션 복구 중에는 새 상태 변경 요청을 전송하지 않는다. */
  setSessionMutationsBlocked(blocked: boolean): void {
    this.sessionMutationsBlocked = blocked;
  }

  /** 원격 요청 없이 현재 기기의 인증 자격과 web 탭 상태를 무효화한다. */
  async clearLocalSession(): Promise<void> {
    this.acceptsSessionTokenBroadcasts = false;
    this.acceptsPushRegistrations = false;
    const epoch = this.beginAuthMutation();
    await this.clearTokenState(epoch);
  }

  /** SSE 연결에서도 같은 Bearer 값을 사용할 수 있도록 현재 메모리 Access Token을 읽는다. */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /** 로그인 전에 현재 Android APK보다 새로운 필수 릴리스가 있는지 확인한다. */
  async fetchLatestAndroidRelease(currentVersionCode: number): Promise<LatestAndroidReleaseResponse> {
    const response = await this.requestWithoutRefresh<LatestAndroidReleaseResponse>(
      `/api/app-releases/android/latest?currentVersionCode=${encodeURIComponent(currentVersionCode)}`,
    );
    return {
      ...response,
      release: {
        ...response.release,
        downloadUrl: new URL(response.release.downloadUrl, `${this.baseUrl}/`).toString(),
      },
    };
  }

  /** HOF에 보내는 수동 action의 단일 실행 상태를 앱 전역 로딩 UI에 전달한다. */
  subscribeManualActionState(listener: (pending: boolean) => void): () => void {
    this.manualActionListeners.add(listener);
    listener(this.manualActionPending);
    return () => this.manualActionListeners.delete(listener);
  }

  /** 백엔드 응답에 함께 실린 최신 HOF 상단 상태를 앱 전역에 전달한다. */
  subscribeHofStatus(listener: (status: HofObservedStatusResponse) => void): () => void {
    this.hofStatusListeners.add(listener);
    return () => this.hofStatusListeners.delete(listener);
  }

  /** 인증이 필요한 백엔드 이미지를 expo-image가 읽을 수 있는 source로 만든다. */
  getAuthenticatedImageSource(imageUrl: string): {
    uri: string;
    headers?: Record<string, string>;
  } {
    if (!this.accessToken) return { uri: imageUrl };

    return {
      uri: imageUrl,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    };
  }

  /**
   * 상단 상태바에 필요한 Time/Funds/Work/Auction 상태를 조회한다.
   */
  fetchStatus(): Promise<HofStatusResponse> {
    return this.request('/api/status');
  }

  /** 기능별 town client가 인증·401 복구를 공유하며 typed 조회 DTO를 받는다. */
  fetchTownResource<TResponse>(path: TownApiPath): Promise<TResponse> {
    return this.request(path);
  }

  /** 기능별 request DTO를 town namespace에 제출한다. 임의 HOF URL/form은 받지 않는다. */
  submitTownAction<TRequest, TResponse>(
    path: TownApiPath,
    request: TRequest,
  ): Promise<TResponse> {
    return this.runManualAction(() => this.request(path, {
      method: 'POST',
      body: JSON.stringify(request),
    }));
  }

  /**
   * 전투 탭의 큰 분류 목록을 조회한다.
   */
  fetchBattleCategories(): Promise<BattleCategoryResponse[]> {
    return this.request('/api/battle/categories');
  }

  /**
   * 선택한 전투/모험 카테고리 안의 맵 목록을 조회한다.
   */
  fetchBattleMaps(categoryId: string): Promise<BattleMapResponse[]> {
    return this.request(`/api/battle/categories/${encodeURIComponent(categoryId)}/maps`);
  }

  /**
   * 선택한 맵, 파티, 패턴 로드 정보로 전투를 실행한다.
   */
  runBattle(request: RunBattleRequest): Promise<BattleResultResponse> {
    return this.runManualAction(() => this.request('/api/battles/run', {
      method: 'POST',
      body: JSON.stringify(request),
    }));
  }

  /**
   * 데이터 탭에 보여줄 최근 전투 로그를 조회한다.
   */
  fetchBattleLogs(query: BattleLogQuery = {}): Promise<BattleLogResponse[]> {
    const params = new URLSearchParams({
      limit: String(query.limit ?? 20),
      offset: String(query.offset ?? 0),
    });
    if (query.outcome) params.set('outcome', query.outcome);
    return this.request(`/api/battle/logs?${params.toString()}`);
  }

  /**
   * 데이터 탭의 누적 전투 통계를 조회한다.
   */
  fetchBattleStats(adventurePeriod: AdventureMapStatsPeriod = 'DAY'): Promise<BattleStatsResponse> {
    return this.request(`/api/battle/stats?adventurePeriod=${adventurePeriod}`);
  }

  /**
   * 현재 계정에 대기 중인 캡차가 있는지 조회한다.
   */
  async fetchCurrentCaptcha(): Promise<CaptchaChallengeResponse | null> {
    const captcha = await this.request<CaptchaChallengeResponse | null>(
      '/api/captcha/current',
    );
    return normalizeCaptchaChallenge(captcha, this.baseUrl);
  }

  /** 사용자가 인증을 시작하는 순간 최신 HOF 캡차 form과 이미지를 준비한다. */
  async prepareCurrentCaptcha(): Promise<CaptchaChallengeResponse> {
    const captcha = await this.request<CaptchaChallengeResponse>(
      '/api/captcha/current/prepare',
      { method: 'POST' },
    );
    return normalizeCaptchaChallenge(captcha, this.baseUrl);
  }

  /** 수동 입력으로 넘겨진 캡차의 자동 인식 시도 횟수를 새로 시작한다. */
  async retryCaptchaAutomatically(challengeId: number): Promise<CaptchaChallengeResponse | null> {
    const captcha = await this.request<CaptchaChallengeResponse | null>(
      `/api/captcha/${challengeId}/auto-solve`,
      { method: 'POST' },
    );
    return normalizeCaptchaChallenge(captcha, this.baseUrl);
  }

  /**
   * 사용자가 입력한 캡차 답을 백엔드로 제출한다.
   */
  async submitCaptchaAnswer(
    challengeId: number,
    request: SubmitCaptchaAnswerRequest,
  ): Promise<CaptchaChallengeResponse> {
    const captcha = await this.request<CaptchaChallengeResponse>(
      `/api/captcha/${challengeId}/answer`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
    );
    return normalizeCaptchaChallenge(captcha, this.baseUrl);
  }

  /** 서버가 소유한 계정 전역 통행증 자동 갱신 상태를 원격 호출 없이 조회한다. */
  fetchCaptchaPassMaintenance(): Promise<CaptchaPassMaintenanceResponse> {
    return this.request('/api/captcha/pass-maintenance');
  }

  updateCaptchaPassMaintenance(enabled: boolean): Promise<CaptchaPassMaintenanceResponse> {
    return this.request('/api/captcha/pass-maintenance', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  }

  /** HOF 홈을 읽기 전용으로 관측해 통행증 상태만 새로 고친다. */
  refreshCaptchaPassMaintenance(): Promise<CaptchaPassMaintenanceResponse> {
    return this.request('/api/captcha/pass-maintenance/refresh', { method: 'POST' });
  }

  /** 계정별 통합 자동화의 현재 상태와 저장 설정을 조회한다. */
  fetchUnifiedAutomation(): Promise<TypedAutomationAggregateResponse> {
    return this.request('/api/automation/unified');
  }

  /** singleton 자동화 유형 중 아직 없는 항목을 마지막에 추가한다. */
  createAutomationEntry(
    request: CreateAutomationEntryRequest,
  ): Promise<TypedAutomationAggregateResponse> {
    return this.request('/api/automation/unified/entries', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /** 사용자 소유 typed entry를 삭제하고 정규화된 aggregate를 받는다. */
  deleteAutomationEntry(entryId: number, settingsRevision?: string): Promise<TypedAutomationAggregateResponse> {
    const query = settingsRevision == null
      ? ''
      : `?settingsRevision=${encodeURIComponent(settingsRevision)}`;
    return this.request(`/api/automation/unified/entries/${entryId}${query}`, { method: 'DELETE' });
  }

  /** 드래그가 끝난 뒤 전체 entry ID 순서를 한 번에 저장한다. */
  reorderAutomationEntries(entryIds: number[]): Promise<TypedAutomationAggregateResponse> {
    return this.request('/api/automation/unified/entries/order', {
      method: 'PUT',
      body: JSON.stringify({ entryIds }),
    });
  }

  moveMapBetweenGroups(
    targetEntryId: number,
    request: MoveMapBetweenGroupsRequest,
  ): Promise<TypedAutomationAggregateResponse> {
    return this.request(`/api/automation/unified/entries/${targetEntryId}/maps/move`, {
      method: 'POST', body: JSON.stringify(request),
    });
  }

  updateQuestAutomation(request: UpdateQuestAutomationRequest): Promise<TypedAutomationAggregateResponse> {
    return this.request('/api/automation/unified/quest', {
      method: 'PUT', body: JSON.stringify(request),
    });
  }

  updateHomeQuestAutomation(request: UpdateHomeQuestAutomationRequest): Promise<TypedAutomationAggregateResponse> {
    return this.request('/api/automation/unified/home-quests', {
      method: 'PUT', body: JSON.stringify(request),
    });
  }

  updateBattleMapAutomation(
    request: UpdateBattleMapAutomationRequest,
  ): Promise<TypedAutomationAggregateResponse> {
    return this.request('/api/automation/unified/battle-maps', {
      method: 'PUT', body: JSON.stringify(request),
    });
  }

  updateBattleMapGroup(
    entryId: number,
    request: UpdateBattleMapGroupRequest,
  ): Promise<TypedAutomationAggregateResponse> {
    return this.request(`/api/automation/unified/entries/${entryId}/battle-maps`, {
      method: 'PUT', body: JSON.stringify(request),
    });
  }

  updateAdventureMapAutomation(
    request: UpdateAdventureMapAutomationRequest,
  ): Promise<TypedAutomationAggregateResponse> {
    return this.request('/api/automation/unified/adventure-maps', {
      method: 'PUT', body: JSON.stringify(request),
    });
  }

  updateAdventureMapGroup(
    entryId: number,
    request: UpdateAdventureMapGroupRequest,
  ): Promise<TypedAutomationAggregateResponse> {
    return this.request(`/api/automation/unified/entries/${entryId}/adventure-maps`, {
      method: 'PUT', body: JSON.stringify(request),
    });
  }

  updateFishingAutomation(request: UpdateFishingAutomationRequest): Promise<TypedAutomationAggregateResponse> {
    return this.request('/api/automation/unified/fishing', { method: 'PUT', body: JSON.stringify(request) });
  }
  updateUnionAutomation(request: UpdateUnionAutomationRequest): Promise<TypedAutomationAggregateResponse> {
    return this.request('/api/automation/unified/union', { method: 'PUT', body: JSON.stringify(request) });
  }
  updateRaidAutomation(request: UpdateRaidAutomationRequest): Promise<TypedAutomationAggregateResponse> {
    return this.request('/api/automation/unified/raid', { method: 'PUT', body: JSON.stringify(request) });
  }
  fetchAutomationHistory(cursor?: number): Promise<AutomationHistoryPage> {
    return this.request(`/api/automation/unified/history${cursor == null ? '' : `?cursor=${cursor}`}`);
  }
  /** GET만 사용해 저장 행동을 재생하지 않고 현재 수렴 상태를 읽는다. */
  fetchAutomationConvergence(): Promise<AutomationConvergenceStatus> {
    return this.request('/api/automation/unified/convergence');
  }
  /** 보류된 요청 자체를 재생하지 않고 해당 억제만 닫아 새 상태 판단을 허용한다. */
  allowFreshAutomationDecision(attemptId: number): Promise<AutomationConvergenceStatus> {
    return this.request(`/api/automation/unified/convergence/${attemptId}/allow-fresh-decision`, { method: 'POST' });
  }

  async fetchQuests(): Promise<QuestSnapshot[]> {
    const snapshots = await this.request<Array<Omit<QuestSnapshot, 'rewards'> & { rewards?: unknown }>>('/api/quests');
    return snapshots.map(normalizeQuestSnapshot);
  }

  async acceptQuest(actionNo: string): Promise<QuestSnapshot[]> {
    const snapshots = await this.runManualAction(() => this.request<Array<Omit<QuestSnapshot, 'rewards'> & { rewards?: unknown }>>(
      `/api/quests/${encodeURIComponent(actionNo)}/accept`, { method: 'POST' },
    ));
    return snapshots.map(normalizeQuestSnapshot);
  }

  async claimQuest(actionNo: string): Promise<QuestSnapshot[]> {
    const snapshots = await this.runManualAction(() => this.request<Array<Omit<QuestSnapshot, 'rewards'> & { rewards?: unknown }>>(
      `/api/quests/${encodeURIComponent(actionNo)}/claim`, { method: 'POST' },
    ));
    return snapshots.map(normalizeQuestSnapshot);
  }

  /** 통합 자동화를 시작, 일시정지, 재개 또는 종료한다. */
  changeUnifiedAutomationState(
    action: UnifiedAutomationAction,
  ): Promise<TypedAutomationAggregateResponse> {
    return this.request(`/api/automation/unified/${action}`, { method: 'POST' });
  }

  /** Android 설치의 FCM 네이티브 토큰을 현재 계정에 연결한다. */
  registerAndroidPushTarget(
    request: RegisterAndroidPushTargetRequest,
  ): Promise<DevicePushTargetResponse> {
    if (!this.acceptsPushRegistrations) {
      return Promise.reject(
        new BackendApiError(401, 'AUTH_TOKEN_INVALID', '로그아웃 중에는 푸시 대상을 등록할 수 없습니다.'),
      );
    }
    const registration = this.request<DevicePushTargetResponse>('/api/push/android/targets', {
      method: 'POST',
      body: JSON.stringify(request),
    }).then((target) => {
      this.androidPushTargetId = target.id;
      return target;
    });
    this.inFlightPushRegistrations.add(registration);
    void registration.then(
      () => this.inFlightPushRegistrations.delete(registration),
      () => this.inFlightPushRegistrations.delete(registration),
    );
    return registration;
  }

  /** 이미 서버에 도착한 등록 요청보다 로그아웃의 비활성화가 반드시 나중에 commit되게 한다. */
  private async waitForPushRegistrations(): Promise<void> {
    if (this.inFlightPushRegistrations.size === 0) return;
    await Promise.allSettled([...this.inFlightPushRegistrations]);
  }

  /**
   * 캐릭터 탭의 파티 프리셋 목록을 조회한다.
   */
  listPartyPresets(): Promise<PartyPresetResponse[]> {
    return this.request('/api/party-presets');
  }

  /** 현재 계정의 파티 프리셋 폴더와 프리셋을 한 번에 조회한다. */
  getPartyPresetCatalog(): Promise<PartyPresetCatalogResponse> {
    return this.request('/api/party-presets/catalog');
  }

  /** 새 파티 프리셋 폴더를 만들고 갱신된 catalog를 받는다. */
  createPartyPresetFolder(
    request: CreatePartyPresetFolderRequest,
  ): Promise<PartyPresetCatalogResponse> {
    return this.request('/api/party-preset-folders', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /** 파티 프리셋 폴더 이름을 바꾸고 갱신된 catalog를 받는다. */
  renamePartyPresetFolder(
    folderId: number,
    request: RenamePartyPresetFolderRequest,
  ): Promise<PartyPresetCatalogResponse> {
    return this.request(`/api/party-preset-folders/${folderId}`, {
      method: 'PATCH',
      body: JSON.stringify(request),
    });
  }

  /** nullable 부모 아래의 모든 폴더를 요청 배열 순서로 저장한다. */
  reorderPartyPresetFolders(
    request: ReorderPartyPresetFoldersRequest,
  ): Promise<PartyPresetCatalogResponse> {
    return this.request('/api/party-preset-folders/order', {
      method: 'PUT',
      body: JSON.stringify(request),
    });
  }

  /** 폴더를 다른 nullable 부모와 표시 위치로 옮긴다. */
  movePartyPresetFolder(
    folderId: number,
    request: MovePartyPresetFolderRequest,
  ): Promise<PartyPresetCatalogResponse> {
    return this.request(`/api/party-preset-folders/${folderId}/location`, {
      method: 'PUT',
      body: JSON.stringify(request),
    });
  }

  /** 폴더를 안전하게 삭제하고 갱신된 catalog를 받는다. */
  deletePartyPresetFolder(folderId: number): Promise<PartyPresetCatalogResponse> {
    return this.request(`/api/party-preset-folders/${folderId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 새 파티 프리셋을 저장한다.
   */
  createPartyPreset(
    request: CreatePartyPresetRequest,
  ): Promise<PartyPresetResponse> {
    return this.request('/api/party-presets', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * 기존 파티 프리셋의 이름과 5인 슬롯 구성을 수정한다.
   */
  updatePartyPreset(
    presetId: number,
    request: UpdatePartyPresetRequest,
  ): Promise<PartyPresetResponse> {
    return this.request(`/api/party-presets/${presetId}`, {
      method: 'PATCH',
      body: JSON.stringify(request),
    });
  }

  /** 소유한 프리셋 하나를 현재 계정의 대표 프리셋으로 지정한다. */
  makePartyPresetPrimary(presetId: number): Promise<PartyPresetResponse> {
    return this.request(`/api/party-presets/${presetId}/primary`, {
      method: 'POST',
    });
  }

  /** 현재 계정의 모든 프리셋을 요청 배열 순서로 저장한다. */
  reorderPartyPresets(
    request: ReorderPartyPresetsRequest,
  ): Promise<PartyPresetResponse[]> {
    return this.request('/api/party-presets/order', {
      method: 'PUT',
      body: JSON.stringify(request),
    });
  }

  /**
   * 파티 프리셋을 삭제한다.
   */
  deletePartyPreset(presetId: number): Promise<null> {
    return this.request(`/api/party-presets/${presetId}`, {
      method: 'DELETE',
    });
  }

  /**
   * HOF 홈의 roster만 다시 관측하고 DB 캐릭터 목록을 반환한다.
   *
   * 상세 동기화 job을 만들지 않으므로 캐릭터별 상세 페이지는 조회하지 않는다.
   */
  async syncCharacterRoster(): Promise<HofCharacter[]> {
    return this.runManualAction(async () => {
      await this.fetchStatus();
      return this.listCharacters();
    });
  }

  /**
   * 전체 캐릭터의 일반 상세 동기화 job을 시작한다.
   */
  async startCharacterSyncJob(): Promise<CharacterSyncJobResponse> {
    const job = await this.request<CharacterSyncJobResponse>('/api/characters/sync-jobs', {
      method: 'POST',
    });
    return normalizeCharacterSyncJob(job);
  }

  /**
   * 캐릭터 동기화 job의 현재 snapshot을 조회한다.
   */
  async fetchCharacterSyncJob(jobId: number): Promise<CharacterSyncJobResponse> {
    const job = await this.request<CharacterSyncJobResponse>(`/api/characters/sync-jobs/${jobId}`);
    return normalizeCharacterSyncJob(job);
  }

  /**
   * 캐릭터 동기화 job의 SSE 이벤트를 구독한다.
   *
   * 각 캐릭터가 파싱될 때마다 characterSynced 이벤트가 오므로 앱은 목록을 즉시 갱신할 수 있다.
   */
  subscribeCharacterSyncJob(
    jobId: number,
    handlers: CharacterSyncEventHandlers,
  ): SseSubscription {
    return createSseConnection(
      `${this.baseUrl}/api/characters/sync-jobs/${jobId}/events`,
      {
        eventTypes: CHARACTER_SYNC_EVENT_TYPES,
        onOpen: handlers.onOpen,
        onClose: handlers.onClose,
        onError: handlers.onError,
        onMessage: (message) => {
          const parsed = parseJson(message.data ?? '');
          if (isCharacterSyncEventResponse(parsed)) {
            handlers.onEvent(normalizeCharacterSyncEvent(parsed));
          }
        },
      },
      {
        headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {},
      },
    );
  }

  /**
   * DB에 저장된 캐릭터 목록을 조회한다.
   */
  async listCharacters(): Promise<HofCharacter[]> {
    const characters = await this.request<HofCharacter[]>('/api/characters');
    return characters.map(normalizeCharacter);
  }

  /**
   * 선택한 캐릭터의 상세 스냅샷을 조회한다.
   */
  async fetchCharacterDetail(characterId: number): Promise<HofCharacterDetail> {
    const detail = await this.request<HofCharacterDetail>(
      `/api/characters/records/${characterId}`,
    );
    return normalizeCharacter(detail);
  }

  async refreshCharacterDetail(characterId: number): Promise<HofCharacterDetail> {
    return normalizeCharacter(await this.runManualAction(() => this.request<HofCharacterDetail>(
      `/api/characters/records/${characterId}/refresh`, { method: 'POST' },
    )));
  }

  async deepSyncCharacter(
    characterId: number,
    onProgress?: (progress: CharacterDeepSyncResponse) => void,
  ): Promise<CharacterDeepSyncResponse> {
    return this.runManualAction(async () => {
      const started = await this.request<CharacterOperationJob>(
        `/api/characters/records/${characterId}/deep-sync-jobs`, { method: 'POST' },
      );
      const completed = await this.pollCharacterOperation(started, (job) => {
        if (job.deepSync) onProgress?.(job.deepSync);
      });
      if (!completed.deepSync) throw new Error('전체 설정 동기화 결과를 확인하지 못했습니다.');
      return completed.deepSync;
    });
  }

  async linkCharacter(characterId: number, newHofCharacterId: string): Promise<HofCharacter[]> {
    return (await this.runManualAction(() => this.request<HofCharacter[]>('/api/characters/identity/link', {
      method: 'POST', body: JSON.stringify({ characterId, newHofCharacterId }),
    }))).map(normalizeCharacter);
  }

  async archiveCharacter(characterId: number): Promise<HofCharacter[]> {
    return (await this.runManualAction(() => this.request<HofCharacter[]>('/api/characters/archive', {
      method: 'POST', body: JSON.stringify({ characterId }),
    }))).map(normalizeCharacter);
  }

  async restoreCharacter(
    characterId: number,
    onProgress?: (progress: CharacterDeepSyncResponse) => void,
  ): Promise<HofCharacter[]> {
    return this.runManualAction(async () => {
      const started = await this.request<CharacterOperationJob>('/api/characters/restore-jobs', {
        method: 'POST', body: JSON.stringify({ characterId }),
      });
      await this.pollCharacterOperation(started, (job) => {
        if (job.deepSync) onProgress?.(job.deepSync);
      });
      return this.listCharacters();
    });
  }

  async deleteCharacterPermanently(characterId: number): Promise<HofCharacter[]> {
    return (await this.runManualAction(() => this.request<HofCharacter[]>('/api/characters/delete-permanently', {
      method: 'POST', body: JSON.stringify({ characterId }),
    }))).map(normalizeCharacter);
  }

  async previewCharacterTransfer(request: CharacterTransferPreviewRequest): Promise<CharacterTransferPreview> {
    return this.request<CharacterTransferPreview>('/api/characters/transfers/preview', {
      method: 'POST', body: JSON.stringify(request),
    });
  }

  async executeCharacterTransfer(
    request: CharacterTransferPreviewRequest,
    completedStepIds: string[] = [],
    onProgress?: (progress: CharacterTransferExecutionResult) => void,
  ): Promise<CharacterTransferExecutionResult> {
    return this.runManualAction(async () => {
      const started = await this.request<CharacterOperationJob>('/api/characters/transfers/jobs', {
        method: 'POST', body: JSON.stringify({ ...request, completedStepIds }),
      });
      const completed = await this.pollCharacterOperation(started, (job) => {
        if (job.transfer) onProgress?.(job.transfer);
      });
      if (!completed.transfer) throw new Error('설정 가져오기 결과를 확인하지 못했습니다.');
      return completed.transfer;
    });
  }

  private async pollCharacterOperation(
    initial: CharacterOperationJob,
    onProgress: (job: CharacterOperationJob) => void,
  ): Promise<CharacterOperationJob> {
    let current = initial;
    for (;;) {
      onProgress(current);
      if (current.status === 'COMPLETED') return current;
      if (current.status === 'FAILED' || current.status === 'STOPPED') {
        throw new Error(current.message || '캐릭터 작업을 완료하지 못했습니다.');
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      current = await this.request<CharacterOperationJob>(
        `/api/characters/operation-jobs/${current.id}`,
      );
    }
  }

  async executeCharacterCommand(command: CharacterCommand): Promise<CharacterCommandResult> {
    return this.runManualAction(() => this.request<CharacterCommandResult>(
      '/api/characters/commands', { method: 'POST', body: JSON.stringify(command) },
    ));
  }

  async applyCharacterPattern(request: CharacterPatternApplyRequest): Promise<CharacterPatternOperationResult> {
    return this.runManualAction(() => this.request<CharacterPatternOperationResult>(
      '/api/characters/patterns/apply', { method: 'POST', body: JSON.stringify(request) },
    ));
  }

  async loadSavedCharacterPattern(characterId: number, slotCode: string): Promise<CharacterPatternOperationResult> {
    return this.runManualAction(() => this.request<CharacterPatternOperationResult>('/api/characters/patterns/load', {
      method: 'POST', body: JSON.stringify({ characterId, slotCode }),
    }));
  }

  /** 프리셋 전체를 하나의 수동 작업으로 실행하며 결과가 불명확하면 다음 캐릭터로 진행하지 않는다. */
  async loadPartyPresetPatterns(preset: PartyPresetResponse, characters: HofCharacter[]): Promise<string> {
    const epoch = this.authEpoch;
    const members = preset.members.filter((member) => member.characterId != null);
    const targets = members.filter((member) => member.patternSlot != null);
    const skipped = members.length - targets.length;
    return this.runManualAction(async () => {
      let completed = 0;
      for (const member of targets) {
        if (!this.isCurrentAuthEpoch(epoch)) break;
        const character = characters.find((item) => item.hofCharacterId === member.characterId);
        try {
          if (!character || (character.lifecycle && character.lifecycle !== 'ACTIVE')) {
            throw new Error('현재 캐릭터 목록에서 사용할 수 없습니다. 동기화 후 다시 시도하세요.');
          }
          const slotCode = character.patternSlots?.find((slot) => Number(slot.slot) === member.patternSlot)?.slot
            ?? String(member.patternSlot);
          const result = await this.request<CharacterPatternOperationResult>('/api/characters/patterns/load', {
            method: 'POST', body: JSON.stringify({ characterId: character.id, slotCode }),
          });
          if (!this.isCurrentAuthEpoch(epoch)) break;
          if (!result.revision) throw new Error(result.message ?? '패턴 적용 결과를 확인하지 못했습니다.');
          completed += 1;
        } catch (error) {
          return `${completed}명 완료 · ${targets.length - completed - 1}명 미실행 · ${skipped}명 패턴 미지정\n${character?.name ?? member.characterId}: ${error instanceof Error ? error.message : '패턴불러오기에 실패했습니다.'}`;
        }
      }
      return `${completed}명 완료 · ${targets.length - completed}명 미실행 · ${skipped}명 패턴 미지정`;
    });
  }

  async deleteSavedCharacterPattern(characterId: number, slotCode: string): Promise<CharacterPatternOperationResult> {
    return this.runManualAction(() => this.request<CharacterPatternOperationResult>('/api/characters/patterns/delete', {
      method: 'POST', body: JSON.stringify({ characterId, slotCode }),
    }));
  }

  async stopCharacterSyncJob(jobId: number): Promise<CharacterSyncJobResponse> {
    return normalizeCharacterSyncJob(await this.request<CharacterSyncJobResponse>(
      `/api/characters/sync-jobs/${jobId}/stop`, { method: 'POST' },
    ));
  }

  async resumeCharacterSyncJob(jobId: number): Promise<CharacterSyncJobResponse> {
    return normalizeCharacterSyncJob(await this.request<CharacterSyncJobResponse>(
      `/api/characters/sync-jobs/${jobId}/resume`, { method: 'POST' },
    ));
  }

  /**
   * 모든 REST 요청이 공통으로 통과하는 private helper다.
   *
   * JSON 직렬화/역직렬화, 기본 헤더, HTTP 에러를 BackendApiError로 바꾸는 일을 담당한다.
   */
  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    if (this.sessionMutationsBlocked && isMutationRequest(init)) {
      throw new SessionRecoveryMutationBlockedError();
    }
    const response = await this.fetchResponse(path, init, this.accessToken);
    if (response.status === 401 && retry) {
      await this.refreshAccessToken();
      return this.request(path, init, false);
    }
    return this.readResponse<T>(response);
  }

  /** 수동 HOF action은 연타로 중복 전송되지 않게 앱 전체에서 한 번에 하나만 허용한다. */
  private async runManualAction<T>(operation: () => Promise<T>): Promise<T> {
    if (this.manualActionPending) throw new ManualActionBusyError();
    this.manualActionPending = true;
    this.notifyManualActionState();
    try {
      return await operation();
    } finally {
      this.manualActionPending = false;
      this.notifyManualActionState();
    }
  }

  private notifyManualActionState(): void {
    for (const listener of this.manualActionListeners) listener(this.manualActionPending);
  }

  /** 로그인·갱신·로그아웃처럼 401 자동 갱신 대상이 아닌 공개 인증 요청을 실행한다. */
  private async requestWithoutRefresh<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.readResponse<T>(await this.fetchResponse(path, init, null));
  }

  /** 동시에 들어온 401 요청들이 하나의 refresh 요청을 공유하도록 single-flight를 적용한다. */
  private async refreshAccessToken(epoch = this.authEpoch): Promise<void> {
    if (this.refreshPromise == null) {
      const operation = this.performRefresh(epoch);
      void operation.then(
        () => this.publishSessionRefreshEvent({ type: 'refresh-succeeded' }),
        (error: unknown) => this.publishSessionRefreshEvent({ type: 'refresh-failed', error }),
      );
      this.refreshPromise = operation.finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async performRefresh(epoch: number): Promise<void> {
    const refreshToken = await this.tokenStorage.load();
    if (!this.usesWebCookieSession && !refreshToken) {
      throw new BackendApiError(401, 'AUTH_TOKEN_INVALID', '저장된 로그인 정보가 없습니다.');
    }
    const accessTokenBeforeRefresh = this.accessToken;
    try {
      const response = await this.requestWithoutRefresh<TokenResponse>('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
      await this.acceptTokenResponse(response, epoch);
    } catch (error) {
      if (
        this.usesWebCookieSession &&
        error instanceof BackendApiError &&
        error.code === 'REFRESH_RETRY_REQUIRED'
      ) {
        await this.waitForBroadcastToken(accessTokenBeforeRefresh, error);
        return;
      }
      throw error;
    }
  }

  /** 새 Access Token은 메모리에 두고 네이티브 refresh token만 SecureStore에 저장한다. */
  private async acceptTokenResponse(response: TokenResponse, epoch: number): Promise<void> {
    await this.mutateTokenState(async () => {
      if (!this.isCurrentAuthEpoch(epoch)) return;
      if (response.refreshToken) await this.tokenStorage.save(response.refreshToken);
      if (!this.isCurrentAuthEpoch(epoch)) return;
      this.accessToken = response.accessToken;
      this.sessionChannel?.postMessage({ type: 'token', accessToken: response.accessToken });
    });
  }

  /** 다른 브라우저 탭에서 회전된 Access Token을 현재 탭 메모리와 대기 중 요청에 반영한다. */
  private receiveBroadcastToken(token: string | null): void {
    if (this.disposed) return;
    if (token == null) {
      this.acceptsSessionTokenBroadcasts = false;
    } else if (!this.acceptsSessionTokenBroadcasts) {
      return;
    }
    this.accessToken = token;
    for (const listener of this.tokenBroadcastListeners) listener(token);
  }

  /**
   * 같은 refresh 쿠키를 두 탭이 동시에 사용해 409를 받은 탭이 승리한 탭의 방송을 기다린다.
   * 방송이 유실되거나 다른 탭도 실패한 경우 요청을 무한 대기시키지 않고 원래 409 오류를 다시 전달한다.
   */
  private waitForBroadcastToken(
    previousToken: string | null,
    conflictError: BackendApiError,
  ): Promise<void> {
    if (this.accessToken && this.accessToken !== previousToken) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(conflictError);
      }, 2_000);
      const listener = (token: string | null) => {
        if (!token || token === previousToken) return;
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeoutId);
        this.tokenBroadcastListeners.delete(listener);
      };

      this.tokenBroadcastListeners.add(listener);
      if (this.accessToken && this.accessToken !== previousToken) listener(this.accessToken);
    });
  }

  private async fetchResponse(path: string, init: RequestInit, accessToken: string | null): Promise<Response> {
    const hasBody = init.body != null;
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      ...(this.usesWebCookieSession ? { credentials: 'include' as const } : {}),
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  }

  private async readResponse<T>(response: Response): Promise<T> {
    this.publishObservedHofStatus(response.headers?.get(HOF_STATUS_HEADER));
    const text = await response.text();
    const body = parseJson(text);

    if (!response.ok) {
      throw new BackendApiError(
        response.status,
        readErrorCode(body),
        readErrorMessage(body) ?? `요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요. (HTTP ${response.status})`,
        parseRetryAfterSeconds(response.headers?.get('Retry-After')),
      );
    }

    return body as T;
  }

  private beginAuthMutation(): number {
    this.authEpoch += 1;
    return this.authEpoch;
  }

  private isCurrentAuthEpoch(epoch: number): boolean {
    return !this.disposed && epoch === this.authEpoch;
  }

  private mutateTokenState(operation: () => Promise<void>): Promise<void> {
    const result = this.tokenMutationPromise.then(operation, operation);
    this.tokenMutationPromise = result.catch(() => undefined);
    return result;
  }

  private clearTokenState(epoch: number): Promise<void> {
    return this.mutateTokenState(async () => {
      if (!this.isCurrentAuthEpoch(epoch)) return;
      this.accessToken = null;
      try {
        await this.tokenStorage.remove();
      } finally {
        if (this.isCurrentAuthEpoch(epoch)) {
          this.sessionChannel?.postMessage({ type: 'logout' });
        }
      }
    });
  }

  private publishSessionRefreshEvent(event: SessionRefreshEvent): void {
    if (this.disposed) return;
    for (const listener of this.sessionRefreshListeners) listener(event);
  }

  private publishObservedHofStatus(encoded: string | null | undefined): void {
    const status = parseObservedHofStatusHeader(encoded);
    if (!status) return;
    for (const listener of this.hofStatusListeners) listener(status);
  }
}

function isMutationRequest(init: RequestInit): boolean {
  const method = (init.method ?? 'GET').toUpperCase();
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function parseRetryAfterSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const deltaSeconds = Number(value);
  if (Number.isFinite(deltaSeconds) && deltaSeconds >= 0) return Math.ceil(deltaSeconds);

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000));
}

const HOF_STATUS_HEADER = 'X-HOF-Observed-Status';

/** URL 인코딩된 응답 헤더를 검증된 상단 상태 계약으로 복원한다. */
export function parseObservedHofStatusHeader(
  encoded: string | null | undefined,
): HofObservedStatusResponse | null {
  if (!encoded) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(encoded));
    if (!value || typeof value !== 'object') return null;
    const status = value as Record<string, unknown>;
    if (
      typeof status.playerName !== 'string' ||
      typeof status.funds !== 'number' ||
      typeof status.timeCurrent !== 'number' ||
      typeof status.timeMax !== 'number' ||
      typeof status.work !== 'string' ||
      typeof status.auction !== 'string' ||
      typeof status.observedAt !== 'string' ||
      (
        status.characterRosterObservedAt != null &&
        typeof status.characterRosterObservedAt !== 'string'
      )
    ) {
      return null;
    }
    return status as HofObservedStatusResponse;
  } catch {
    return null;
  }
}

/** 브라우저 탭 사이에서 새 Access Token과 로그아웃 상태를 전달한다. */
function createSessionChannel(onToken: (token: string | null) => void): BroadcastChannel | null {
  if (Platform.OS !== 'web' || typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel('hof.auth.session.v1');
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (!event.data || typeof event.data !== 'object') return;
    const message = event.data as { type?: unknown; accessToken?: unknown };
    if (message.type === 'token' && typeof message.accessToken === 'string') onToken(message.accessToken);
    if (message.type === 'logout') onToken(null);
  };
  return channel;
}

const CHARACTER_SYNC_EVENT_TYPES: CharacterSyncEventType[] = [
  'started',
  'rosterParsed',
  'characterSynced',
  'characterFailed',
  'completed',
  'failed',
  'heartbeat',
];

/**
 * 앱이 호출할 백엔드 기본 주소를 결정한다.
 *
 * 환경변수 EXPO_PUBLIC_HOF_BACKEND_URL이 있으면 우선 사용하고, 운영 빌드는 공개 API를 사용한다.
 * 개발 빌드는 Android 에뮬레이터와 로컬 실행 환경의 기본 주소를 나눈다.
 */
function resolveBackendBaseUrl(): string {
  const configuredUrl = process.env.EXPO_PUBLIC_HOF_BACKEND_URL?.trim();
  if (configuredUrl) return configuredUrl;
  if (process.env.NODE_ENV === 'production') return 'https://api-hof.spammy.app';

  return Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'http://localhost:8080';
}

/**
 * 백엔드 주소의 끝 슬래시를 제거하고 운영 빌드가 평문 HTTP API를 사용하지 못하게 차단한다.
 * Android 에뮬레이터와 로컬 웹 개발은 production이 아니므로 기존 HTTP 주소를 계속 사용할 수 있다.
 */
export function normalizeBackendBaseUrl(baseUrl: string, production: boolean): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!production) return normalized;

  let protocol: string;
  try {
    protocol = new URL(normalized).protocol;
  } catch {
    throw new Error('운영 백엔드 주소가 올바르지 않습니다. HTTPS URL을 확인해 주세요.');
  }
  if (protocol !== 'https:') {
    throw new Error('운영 앱은 HTTPS 백엔드에만 연결할 수 있습니다.');
  }
  return normalized;
}

/**
 * 빈 응답이나 JSON이 아닌 응답을 안전하게 null로 처리한다.
 */
function parseJson(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 백엔드 표준 에러 응답에서 사용자 메시지를 읽는다.
 */
function readErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : null;
}

/**
 * 백엔드 표준 에러 응답에서 에러 코드를 읽는다.
 */
function readErrorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' && code.trim() ? code : null;
}

/**
 * 캡차 응답 안의 이미지 주소를 앱에서 바로 열 수 있는 URL로 정규화한다.
 */
function normalizeCaptchaChallenge(captcha: CaptchaChallengeResponse, baseUrl: string): CaptchaChallengeResponse;
function normalizeCaptchaChallenge(
  captcha: CaptchaChallengeResponse | null,
  baseUrl: string,
): CaptchaChallengeResponse | null;
function normalizeCaptchaChallenge(
  captcha: CaptchaChallengeResponse | null,
  baseUrl: string,
): CaptchaChallengeResponse | null {
  if (!captcha || captcha.imageUrl === null) return captcha;

  return {
    ...captcha,
    imageUrl: normalizeCaptchaImageUrl(captcha.imageUrl, baseUrl),
  };
}

/**
 * 캡차 이미지 URL이 상대 경로로 내려와도 앱에서 볼 수 있는 절대 URL로 만든다.
 */
function normalizeCaptchaImageUrl(imageUrl: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (imageUrl.startsWith('//')) return `${readUrlProtocol(baseUrl)}${imageUrl}`;
  if (imageUrl.startsWith('/')) return `${baseUrl}${imageUrl}`;

  try {
    return new URL(imageUrl, `${baseUrl}/`).toString();
  } catch {
    return imageUrl;
  }
}

/**
 * 캐릭터 이미지 URL을 HOF asset 기준 절대 URL로 정규화한다.
 */
function normalizeCharacter<T extends HofCharacter>(character: T): T {
  const detail = character as unknown as HofCharacterDetail;
  return {
    ...character,
    imageUrl: normalizeHofAssetUrl(character.imageUrl),
    ...('equipment' in character ? {
      equipment: detail.equipment.map((item) => ({
        ...item,
        iconUrl: normalizeHofAssetUrl(item.iconUrl) ?? '',
      })),
      equipmentCandidates: (detail.equipmentCandidates ?? []).map((item) => ({
        ...item,
        iconUrl: normalizeHofAssetUrl(item.iconUrl) ?? '',
      })),
      learnedSkills: detail.learnedSkills.map((skill) => ({
        ...skill,
        iconUrl: normalizeHofAssetUrl(skill.iconUrl) ?? '',
      })),
      learnableSkills: detail.learnableSkills.map((skill) => ({
        ...skill,
        iconUrl: normalizeHofAssetUrl(skill.iconUrl) ?? '',
      })),
    } : {}),
  };
}

/**
 * 캐릭터 동기화 job snapshot 안의 캐릭터 이미지 URL들을 정규화한다.
 */
function normalizeCharacterSyncJob(job: CharacterSyncJobResponse): CharacterSyncJobResponse {
  return {
    ...job,
    characters: job.characters.map(normalizeCharacter),
  };
}

/**
 * SSE 이벤트 안에 포함된 캐릭터 이미지 URL을 정규화한다.
 */
function normalizeCharacterSyncEvent(event: CharacterSyncEventResponse): CharacterSyncEventResponse {
  return {
    ...event,
    character: event.character ? normalizeCharacter(event.character) : null,
  };
}

/**
 * baseUrl에서 protocol을 읽어 `//host/path` 형식 URL을 보정할 때 사용한다.
 */
function readUrlProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return 'https:';
  }
}

/**
 * SSE payload가 캐릭터 동기화 이벤트 형태인지 런타임에서 확인한다.
 */
function isCharacterSyncEventResponse(value: unknown): value is CharacterSyncEventResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CharacterSyncEventResponse>;

  return (
    typeof candidate.eventId === 'number' &&
    typeof candidate.eventType === 'string' &&
    typeof candidate.jobId === 'number' &&
    typeof candidate.accountId === 'number' &&
    typeof candidate.status === 'string' &&
    typeof candidate.rosterCount === 'number' &&
    typeof candidate.syncedCount === 'number' &&
    Array.isArray(candidate.failedCharacterIds)
  );
}
