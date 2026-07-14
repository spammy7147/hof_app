/**
 * Spring 백엔드와 Expo 앱 사이의 JSON/SSE 계약 모음이다.
 *
 * DB entity나 HOF HTML 구조를 화면에 노출하지 않고, 반복 값은 배열과 명시적인 하위 객체로 표현한다.
 * 필드 변경 시 `BackendApiClient` 정규화와 backend DTO를 함께 확인해야 한다.
 */
export type HofLoginRequest = {
  loginId: string;
  password: string;
};

export type AuthClientType = 'NATIVE' | 'WEB';

export type TokenResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  accessTokenExpiresAt: string;
  refreshToken?: string;
  refreshTokenExpiresAt: string;
};

export type HofStatusResponse = {
  accountId: number;
  playerName: string;
  funds: number | null;
  timeCurrent: number | null;
  timeMax: number | null;
  work: string;
  auction: string;
  observedAt: string;
};

export type BattleCategoryResponse = {
  id: string;
  label: string;
  description: string;
  order: number;
  enabled: boolean;
};

export type BattleMapResponse = {
  categoryId: string;
  mapCode: string | null;
  name: string;
  groupName: string | null;
  groupOrder: number;
  mapOrder: number;
  recommendedLevel: string | null;
  availableCount: number | null;
  attemptCount: number | null;
  winCount: number | null;
  cooldownRemainingText: string | null;
  cooldownRemainingSeconds: number | null;
  keyCount: number | null;
  requiredTime: number | null;
  enabled: boolean;
  resolved: boolean;
  iconUrl: string | null;
  rawHref: string;
};

export type RunBattleRequest = {
  categoryId: string;
  mapCode: string;
  characterIds: string[];
  patternLoads?: BattlePatternLoadRequest[];
  battleCount?: 1 | 3;
  multi?: boolean;
};

export type BattlePatternLoadRequest = {
  characterId: string;
  slot: number;
};

export type BattleResultResponse = {
  outcome: string;
  title: string;
  turns: number | null;
  funds: number | null;
  experience: number | null;
  loots: BattleLootResponse[];
  quest: string | null;
  enemy: BattleSideResponse;
  ally: BattleSideResponse;
  rawLogUrl: string | null;
  rounds?: BattleRoundResultResponse[];
};

export type BattleRoundResultResponse = {
  outcome: string;
  title: string;
  turns: number | null;
  funds: number | null;
  experience: number | null;
  loots: BattleLootResponse[];
  quest: string | null;
  enemy: BattleSideResponse;
  ally: BattleSideResponse;
  rawLogUrl: string | null;
};

export type BattleLootResponse = {
  name: string;
};

export type BattleSideResponse = {
  hpCurrent: number | null;
  hpMax: number | null;
  survivorsAlive: number | null;
  survivorsMax: number | null;
  totalDamage: number | null;
  turnCurrent: number | null;
  turnMax: number | null;
};

export type BattleLogResponse = {
  id: number;
  accountId: number;
  categoryId: string;
  mapCode: string;
  characterIds: string[];
  characterNames: string[];
  outcome: string;
  title: string;
  turns: number | null;
  funds: number | null;
  experience: number | null;
  loots: BattleLootResponse[];
  quest: string | null;
  enemy: BattleSideResponse;
  ally: BattleSideResponse;
  rawLogUrl: string | null;
  createdAt: string;
};

export type BattleStatsResponse = {
  accountId: number;
  totalBattles: number;
  victories: number;
  defeats: number;
  draws: number;
  unknowns: number;
  winRate: number;
  totalFunds: number;
  totalExperience: number;
  totalLootCount: number;
};

export type CaptchaChallengeResponse = {
  id: number;
  accountId: number;
  status: string;
  prompt: string;
  imageUrl: string | null;
  sourceUrl: string;
  createdAt: string;
  answeredAt: string | null;
};

export type SubmitCaptchaAnswerRequest = {
  answer: string;
};

export type CreateAutomationJobRequest = {
  profileId: number;
};

export type AutomationJobResponse = {
  id: number;
  accountId: number;
  profileId: number;
  status: string;
  currentStepIndex: number;
  message: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
};

export type AutomationProfileMode = 'TIME_BURN' | 'BASIC_ADVENTURE' | 'LIMITED_DUNGEON';

export type AutomationProfileMap = {
  categoryId: string;
  mapCode: string;
  partyPresetId: number | null;
  executionOrder: number;
};

export type CreateAutomationProfileRequest = {
  name: string;
  mode: AutomationProfileMode;
  maps: AutomationProfileMap[];
};

export type UpdateAutomationProfileRequest = {
  name: string;
  mode: AutomationProfileMode;
  maps: AutomationProfileMap[];
  enabled: boolean;
};

export type AutomationProfileResponse = {
  id: number;
  accountId: number;
  name: string;
  mode: AutomationProfileMode;
  maps: AutomationProfileMap[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** 자동화 모듈이 실행할 맵과 그 맵에서 사용할 파티 프리셋을 나타낸다. */
export type UnifiedAutomationMap = {
  categoryId: string;
  mapCode: string;
  partyPresetId: number | null;
  executionOrder: number;
};

/** 퀘스트 모듈 안에서 실행할 퀘스트와 퀘스트별 맵 순서를 나타낸다. */
export type UnifiedAutomationQuest = {
  questCode: string;
  executionOrder: number;
  maps: UnifiedAutomationMap[];
};

/** 백엔드가 사용자에게 허용하는 통합 자동화 모듈 유형이다. */
export type UnifiedAutomationModuleType =
  | 'KEY_QUEST'
  | 'TIME_BURN'
  | 'COOLDOWN_ADVENTURE'
  | 'DAILY_ADVENTURE'
  | 'OTHER_QUEST';

/** 새 모듈 생성 요청이다. 유형은 생성한 뒤에는 변경할 수 없다. */
export type CreateUnifiedAutomationModuleRequest = {
  displayName: string;
  moduleType: UnifiedAutomationModuleType;
  enabled: boolean;
  thresholdPercent: number | null;
  maps: UnifiedAutomationMap[];
  quests: UnifiedAutomationQuest[];
};

/** 기존 모듈 수정 요청이다. ID, 유형, 우선순위는 URL과 기존 서버 상태를 따른다. */
export type UpdateUnifiedAutomationModuleRequest = Omit<
  CreateUnifiedAutomationModuleRequest,
  'moduleType'
>;

/** 서버가 저장한 모듈 인스턴스 한 개와 현재 실행 준비 상태다. */
export type UnifiedAutomationModuleResponse = {
  id: number;
  displayName: string;
  moduleType: UnifiedAutomationModuleType;
  enabled: boolean;
  priority: number;
  thresholdPercent: number | null;
  maps: UnifiedAutomationMap[];
  quests: UnifiedAutomationQuest[];
  ready: boolean;
  summary: string;
};

export type UnifiedAutomationStatusResponse = {
  profileId: number;
  job: AutomationJobResponse | null;
  modules: UnifiedAutomationModuleResponse[];
  currentTitle: string | null;
  nextRunAt: string | null;
};

export type UnifiedAutomationAction = 'start' | 'pause' | 'resume' | 'stop';

export type RegisterAndroidPushTargetRequest = {
  installationId: string;
  nativeToken: string;
};

export type DevicePushTargetResponse = {
  id: number;
  platform: string;
  installationId: string;
  active: boolean;
  lastSeenAt: string;
};

export type PartyPresetMember = {
  slotIndex: number;
  characterId: string | null;
  patternSlot: number | null;
};

export type CreatePartyPresetRequest = {
  name: string;
  members: PartyPresetMember[];
};

export type UpdatePartyPresetRequest = {
  name: string;
  members: PartyPresetMember[];
};

export type PartyPresetResponse = {
  id: number;
  accountId: number;
  name: string;
  members: PartyPresetMember[];
  createdAt: string;
  updatedAt: string;
};

export type HofCharacter = {
  id: number;
  hofCharacterId: string;
  name: string;
  job: string;
  level: number | null;
  patternSlotCount: number;
  imageUrl?: string | null;
  patternSlots?: HofCharacterPatternSlot[];
};

export type HofCharacterDetail = HofCharacter & {
  imageUrl: string | null;
  statusLines: string[];
  patternSlots: HofCharacterPatternSlot[];
  stats: HofCharacterStats;
  actionPatterns: HofCharacterActionPattern[];
  positionGuard: HofCharacterPositionGuard;
  equipment: HofCharacterEquipment[];
  learnedSkills: HofCharacterSkill[];
  learnableSkills: HofCharacterSkill[];
};

export type HofCharacterPatternSlot = {
  slot: string;
  label: string;
  canLoad: boolean;
};

export type HofCharacterStats = {
  atk: number | null;
  matk: number | null;
  defBase: number | null;
  defBonus: number | null;
  mdefBase: number | null;
  mdefBonus: number | null;
  handleUsed: number | null;
  handleMax: number | null;
  costUsed: number | null;
  costMax: number | null;
};

export type HofCharacterActionPattern = {
  index: number;
  judge: string;
  judgeText: string;
  quantity: string;
  quantityText: string;
  skill: string;
  skillText: string;
};

export type HofCharacterPositionGuard = {
  positions: HofCharacterPositionChoice[];
  selectedPosition: string;
  guardValue: string;
  guardText: string;
};

export type HofCharacterPositionChoice = {
  value: string;
  checked: boolean;
};

export type HofCharacterEquipment = {
  slot: string;
  part: string;
  name: string;
  iconUrl: string;
  description: string;
  checked: boolean;
};

export type HofCharacterSkill = {
  value: string;
  name: string;
  iconUrl: string;
  category: string;
};

export type LoadPatternResponse = {
  accountId: number;
  hofCharacterId: string;
  slot: number;
  loaded: boolean;
  message: string;
};

export type CharacterSyncJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type CharacterSyncEventType =
  | 'started'
  | 'rosterParsed'
  | 'characterSynced'
  | 'characterFailed'
  | 'completed'
  | 'failed'
  | 'heartbeat';

export type CharacterSyncJobResponse = {
  jobId: number;
  accountId: number;
  status: CharacterSyncJobStatus;
  rosterCount: number;
  syncedCount: number;
  failedCharacterIds: string[];
  characters: HofCharacter[];
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type CharacterSyncEventResponse = {
  eventId: number;
  eventType: CharacterSyncEventType;
  jobId: number;
  accountId: number;
  status: CharacterSyncJobStatus;
  rosterCount: number;
  syncedCount: number;
  failedCharacterIds: string[];
  character: HofCharacter | null;
  message: string | null;
  emittedAt: string;
};
