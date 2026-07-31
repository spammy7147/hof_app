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
  totalCharacterCount: number;
  synchronizedCharacterCount: number;
  characterSyncRequired: boolean;
  observedAt: string;
};

export type HofObservedStatusResponse = Pick<
  HofStatusResponse,
  'playerName' | 'funds' | 'timeCurrent' | 'timeMax' | 'work' | 'auction' | 'observedAt'
>;

export type BattleCategoryResponse = {
  id: string;
  label: string;
  description: string;
  order: number;
  enabled: boolean;
};

export type BattleMapKeyMode = 'NOT_REQUIRED' | 'LIMITED' | 'UNLIMITED' | 'UNKNOWN';

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
  keyMode: BattleMapKeyMode;
  keyCount: number | null;
  requiredTime: number | null;
  /** 서버가 해당 맵의 실제 전투 폼에서 관측한 3회 전투 지원 여부다. */
  supportsThreeBattles: boolean;
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
  mapName: string;
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
  preparationVersion: number;
  createdAt: string;
  answeredAt: string | null;
};

export type SubmitCaptchaAnswerRequest = {
  answer: string;
  preparationVersion: number;
};

/** 마을 공통 목록에서 HOF가 실제 선택 control을 제공한 행만 selectable이다. */
export type TownRowResponse = {
  id: string;
  label: string;
  accessibilityLabel?: string;
  selectable: boolean;
  detail: string | null;
  imageUrl: string | null;
  price: number | null;
  quantity: number | null;
};

export type TownResultStatus = 'SUCCESS' | 'FAILURE' | 'INFORMATIONAL' | 'UNKNOWN';

export type TownResultItemResponse = {
  name: string;
  quantity: number | null;
  imageUrl: string | null;
  detail: string | null;
};

/** HOF 문서나 form 필드를 포함하지 않는 마을 action 공통 표시 결과다. */
export type TownActionResultResponse = {
  status: TownResultStatus;
  messages: string[];
  items: TownResultItemResponse[];
  refreshRequired: boolean;
};

/** 앱이 호출할 수 있는 backend 마을 namespace만 표현하며 HOF URL은 받을 수 없다. */
export type TownApiPath = `/api/town/${string}`;

export type FishingAction = 'START' | 'CATCH' | 'STATUS' | 'FILTER';
export type FishingPrimaryAction = 'START' | 'CATCH' | 'NONE';
export type FishingOutcome = 'STARTED' | 'CAUGHT' | 'ESCAPED' | 'INFORMATIONAL';
export type FishingBattleTarget = { categoryId: string; mapCode: string };
export type FishingCatchItem = { name: string; quantity: number; remainingUses: number | null; effect: string | null };

export type FishingResponse = {
  notice: string | null;
  remainingCasts: number | null;
  waterStatus: string | null;
  baitCount: number | null;
  shiningBaitCount: number | null;
  escapeSeconds: number | null;
  combo: number | null;
  locationName: string;
  primaryAction: FishingPrimaryAction;
  availableActions: FishingAction[];
  lastOutcome: FishingOutcome | null;
  blockedByBattle: boolean;
  battleTarget: FishingBattleTarget | null;
  catches: FishingCatchItem[];
  result: TownActionResultResponse | null;
};

export type FishingExchangeResponse = {
  items: Array<TownRowResponse & { materials: string[] }>;
  result: TownActionResultResponse | null;
};

export type FishingExchangeRequest = { candidateId: string; quantity: number };

export type ShopMode = 'general' | 'sundries' | 'dark';
export type ShopItemResponse = TownRowResponse & { type: string | null };
export type ShopResponse = {
  shopId: ShopMode;
  items: ShopItemResponse[];
  stale: boolean;
  lastVerifiedAt: string | null;
  result: TownActionResultResponse | null;
};
export type PurchaseRequest = { items: Array<{ itemId: string; quantity: number }> };
export type SellItemResponse = TownRowResponse & { type: string | null };
export type SellResponse = { items: SellItemResponse[]; result: TownActionResultResponse | null };
export type SellRequest = { items: Array<{ candidateId: string; quantity: number }> };
export type CombineOptionResponse = { id: string; label: string; quantity: number | null };
export type CombineResponse = {
  primary: CombineOptionResponse[];
  secondarySlots: [CombineOptionResponse[], CombineOptionResponse[], CombineOptionResponse[]];
  result: TownActionResultResponse | null;
};
export type CombineRequest = { primaryCandidateId: string; secondaryCandidateIds: [string, string, string]; quantity: number };

export type AuctionAction = 'BROWSE' | 'BID' | 'EXHIBIT' | 'CLAIM';
export type AuctionObservationKind = 'CURRENT' | 'SOLD';
export type AuctionListingResponse = {
  rowKey: string;
  candidateId: string | null;
  actionId: string;
  listingId: string | null;
  name: string;
  type: string | null;
  quantity: number;
  totalPrice: number;
  unitPrice: number;
  action: AuctionAction;
  kind: AuctionObservationKind;
};
export type AuctionResponse = {
  listings: AuctionListingResponse[];
  actions: AuctionAction[];
  capabilities: { bidActionId: string | null; exhibitEntryActionId: string | null; claimItemActionId: string | null; claimFundsActionId: string | null };
  result: TownActionResultResponse | null;
};
export type AuctionBidRequest = { actionId: string; listingId: string; bidPrice: number };
export type AuctionExhibitOpenRequest = { actionId: string };
export type AuctionExhibitRequest = { entryActionId: string; actionId: string; candidateId: string; amount: number; exhibitTime: string; startPrice: number; comment: string };
export type AuctionClaimRequest = { actionId: string };
export type AuctionExhibitResponse = { items: AuctionListingResponse[]; durations: Array<{ value: string; label: string }>; entryActionId: string; actionId: string | null; result: TownActionResultResponse | null };
export type AuctionMarketPoint = {
  totalPrice: number; unitPrice: number; quantity: number; observedAt: string; kind: AuctionObservationKind;
};
export type AuctionMarketItem = {
  itemKey: string; name: string; type: string | null; latestUnitPrice: number; averageUnitPrice: number;
  minimumUnitPrice: number; maximumUnitPrice: number; tradeCount: number; volume: number; points: AuctionMarketPoint[];
};
export type AuctionMarketResponse = { items: AuctionMarketItem[]; generatedAt: string };

export type CardMode = 'identify' | 'upgrade' | 'change' | 'sell' | 'soul-echo';
export type CardItemResponse = {
  id: string; label: string; selectable: boolean; owned: number | null; rarity: string | null;
  restrictions: string[]; detail: string | null; cost: number | null; blankCardValue?: number | null; maxQuantity?: number | null;
};
export type CardIdentifyResponse = { selectionSlots: 1; cards: CardItemResponse[]; result: TownActionResultResponse | null };
export type CardIdentifyRequest = { candidateId: string };
export type CardPairResponse = {
  selectionSlots: Array<{ id: 'base' | 'material'; label: string }>;
  baseCards: CardItemResponse[]; materialCards: CardItemResponse[]; minQuantity: number; maxQuantity: number;
  selectedBaseCandidateId: string | null; history: string[]; result: TownActionResultResponse | null;
};
export type CardPairOptionsRequest = { baseCandidateId: string };
export type CardUpgradeRequest = { baseCandidateId: string; materialCandidateId: string; quantity: number };
export type CardChangeRequest = CardUpgradeRequest;
export type CardSellResponse = { cards: CardItemResponse[]; multiSelect: true; rewardKind: 'BLANK_CARD'; blankCardsOwned: number | null; result: TownActionResultResponse | null };
export type CardSellRequest = { cards: Array<{ candidateId: string; quantity: number }> };
export type SoulEchoResponse = {
  categories: Array<{ id: string; label: string }>;
  currentCategoryId: string | null;
  recipes: Array<{ id: string; label: string; selectable: boolean; category: string | null; requiredEchoes: string[]; cost: number | null; successBonus: number | null }>;
  ownedEchoes: Array<{ name: string; region: string | null; quantity: number }>;
  history: Array<{ text: string; success: boolean }>;
  result: TownActionResultResponse | null;
};
export type SoulEchoFuseRequest = { recipeCandidateId: string; categoryCandidateId: string };

/** 저장 가능한 자동화는 백엔드가 소유하는 세 가지 singleton 유형으로 제한된다. */
export type AutomationType = 'QUEST' | 'BATTLE_MAP' | 'ADVENTURE_MAP';

/** PRIMARY는 ID를 보내지 않고 EXPLICIT은 유효한 preset ID를 반드시 보낸다. */
export type PresetSelection =
  | { presetMode: 'PRIMARY'; partyPresetId: null }
  | { presetMode: 'EXPLICIT'; partyPresetId: number };

export type CreateAutomationEntryRequest = { type: AutomationType };
export type ReorderAutomationEntriesRequest = { entryIds: number[] };

export type QuestMapSettingRequest = PresetSelection & {
  missionKey: string;
  categoryId: string;
  mapCode: string;
  executionOrder: number;
  manuallyOverridden: boolean;
};

export type QuestSelectionRequest = {
  questKey: string;
  displayCode: string;
  questName: string;
  enabled: boolean;
  sourceOrder: number;
  maps: QuestMapSettingRequest[];
};

export type UpdateQuestAutomationRequest = {
  enabled: boolean;
  quests: QuestSelectionRequest[];
};

export type BattleMapSettingRequest = PresetSelection & {
  categoryId: string;
  mapCode: string;
  dailyTargetCount: number;
  executionOrder: number;
};

export type UpdateBattleMapAutomationRequest = {
  enabled: boolean;
  maps: BattleMapSettingRequest[];
};

export type AdventureMapSettingRequest = PresetSelection & {
  categoryId: string;
  mapCode: string;
  executionOrder: number;
};

export type UpdateAdventureMapAutomationRequest = {
  enabled: boolean;
  maps: AdventureMapSettingRequest[];
};

export type QuestMapSettingResponse = QuestMapSettingRequest;
export type QuestSelectionResponse = QuestSelectionRequest;
export type BattleMapSettingResponse = BattleMapSettingRequest;
export type BattleMapDailyProgressResponse = {
  categoryId: string;
  mapCode: string;
  successfulRuns: number;
};
export type AdventureMapSettingResponse = AdventureMapSettingRequest & {
  /** 저장된 맵이 현재 라이브 목록에 없어도 내부 코드를 노출하지 않기 위한 카탈로그 이름이다. */
  displayName?: string | null;
};

export type TypedAutomationEntryResponse = {
  id: number;
  type: AutomationType;
  enabled: boolean;
  priority: number;
  ready: boolean;
  warnings: string[];
  quests: QuestSelectionResponse[];
  battleMaps: BattleMapSettingResponse[];
  /** 설정과 별도로 서버가 소유하는 한국 날짜 기준 전투맵 성공 횟수다. */
  battleMapProgress: BattleMapDailyProgressResponse[];
  adventureMaps: AdventureMapSettingResponse[];
};

export type TypedAutomationLifecycle = 'RUNNING' | 'PAUSED' | 'STOPPED';
export type AutomationWaitReason = 'SCHEDULED' | 'HOF_CONNECTION';
export type AutomationStopReason =
  | 'AUTHENTICATION'
  | 'CAPTCHA'
  | 'MANUAL_STOP'
  | 'NETWORK'
  | 'FATAL'
  | 'UNKNOWN';

export type TypedAutomationRuntimeResponse = {
  lifecycle: TypedAutomationLifecycle;
  stopReason: AutomationStopReason | null;
  nextAttemptAt: string | null;
  waitReason?: AutomationWaitReason | null;
  warnings: string[];
  lastError: string | null;
  currentAction: TypedAutomationCurrentActionResponse | null;
  dailyRefresh: AdventureDailyRefreshResponse;
};

export type TypedAutomationCurrentActionResponse = {
  source: AutomationType;
  kind: string;
  actionLabel: string;
  questName: string | null;
  missionLabel: string | null;
  missionCurrent: number | null;
  missionRequired: number | null;
  mapName: string | null;
  battleCount: number | null;
};

export type AdventureDailyRefreshResponse = {
  status: 'PENDING' | 'COMPLETE';
  refreshDate: string | null;
  refreshedAt: string | null;
};

export type TypedAutomationAggregateResponse = {
  entries: TypedAutomationEntryResponse[];
  runtime: TypedAutomationRuntimeResponse;
  hofStatus?: HofObservedStatusResponse | null;
};

export type QuestState = 'AVAILABLE' | 'ACTIVE' | 'CLAIMABLE' | 'COMPLETED' | 'UNAVAILABLE';
export type QuestSection = 'ACTIVE' | 'AVAILABLE' | 'WAITING' | 'COMPLETED';
export type QuestMissionType = 'IMMEDIATE' | 'ITEM_TURN_IN' | 'MONSTER_KILL' | 'MAP_CLEAR' | 'OTHER';
export type QuestProgress = { current: number; required: number };
export type QuestMission = {
  key: string;
  type: QuestMissionType;
  target: string | null;
  progress: QuestProgress | null;
  completable: boolean;
};
export type QuestSnapshot = {
  questKey: string;
  displayCode: string;
  name: string;
  state: QuestState;
  section: QuestSection;
  sourceOrder: number;
  missions: QuestMission[];
  actionNo: string | null;
  rewards: string[];
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
  folderId?: number | null;
};

export type UpdatePartyPresetRequest = {
  name: string;
  members: PartyPresetMember[];
  folderId?: number | null;
};

export type ReorderPartyPresetsRequest = {
  folderId?: number | null;
  presetIds: number[];
};

export type PartyPresetResponse = {
  id: number;
  accountId: number;
  name: string;
  displayOrder: number;
  isPrimary: boolean;
  members: PartyPresetMember[];
  createdAt: string;
  updatedAt: string;
  folderId: number | null;
};

export type PartyPresetFolderResponse = {
  id: number;
  name: string;
  parentFolderId: number | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PartyPresetCatalogResponse = {
  folders: PartyPresetFolderResponse[];
  presets: PartyPresetResponse[];
};

export type CreatePartyPresetFolderRequest = {
  name: string;
  parentFolderId: number | null;
};

export type RenamePartyPresetFolderRequest = {
  name: string;
};

export type ReorderPartyPresetFoldersRequest = {
  parentFolderId: number | null;
  folderIds: number[];
};

export type MovePartyPresetFolderRequest = {
  parentFolderId: number | null;
  displayOrder: number;
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
  characterSynchronized: boolean;
  character: HofCharacterDetail | null;
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
