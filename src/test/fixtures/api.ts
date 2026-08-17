import type {
  CaptchaChallengeResponse,
  CharacterSyncEventResponse,
  HofCharacter,
  HofCharacterDetail,
} from '../../main/types/api';

export function makeHofCharacter(
  index = 1,
  overrides: Partial<HofCharacter> = {},
): HofCharacter {
  return {
    id: index,
    hofCharacterId: `char-${index}`,
    name: `캐릭터${index}`,
    job: 'Social Knight',
    level: 60,
    patternSlotCount: 5,
    imageUrl: null,
    lifecycle: 'ACTIVE', lastSeenAt: null, missingSince: null, archivedAt: null,
    rosterOrder: index, revision: '2026-08-17T00:00:00Z', detailSyncedAt: null, sectionStates: [],
    ...overrides,
  };
}

export function makeCharacterSyncEvent(
  overrides: Partial<CharacterSyncEventResponse> = {},
): CharacterSyncEventResponse {
  const eventType = overrides.eventType ?? 'characterSynced';

  return {
    eventId: 1,
    eventType,
    jobId: 12,
    accountId: 1,
    status: eventType === 'failed' ? 'failed' : eventType === 'completed' ? 'completed' : 'running',
    rosterCount: 2,
    syncedCount: 1,
    failedCharacterIds: [],
    character: null,
    message: null,
    emittedAt: '2026-07-08T00:00:00Z',
    ...overrides,
  };
}

export function makeHofCharacterDetail(
  index = 1,
  overrides: Partial<HofCharacterDetail> = {},
): HofCharacterDetail {
  const character = makeHofCharacter(index, overrides);

  return {
    ...character,
    statusLines: [],
    statusEffects: [],
    faith: null,
    patternSlots: [],
    stats: {
      atk: null,
      matk: null,
      defBase: null,
      defBonus: null,
      mdefBase: null,
      mdefBonus: null,
      handleUsed: null,
      handleMax: null,
      costUsed: null,
      costMax: null,
    },
    actionPatterns: [],
    patternOptions: [],
    positionGuard: {
      positions: [],
      selectedPosition: '',
      guardValue: '',
      guardText: '',
    },
    equipment: [],
    equipmentCandidates: [],
    learnedSkills: [],
    learnableSkills: [],
    ...overrides,
    imageUrl: overrides.imageUrl ?? character.imageUrl ?? null,
  };
}

export function makeCaptchaChallenge(
  overrides: Partial<CaptchaChallengeResponse> = {},
): CaptchaChallengeResponse {
  return {
    id: 3,
    accountId: 1,
    status: 'DETECTED',
    prompt: 'Enter captcha',
    imageUrl: null,
    sourceUrl: 'https://hof.example/captcha',
    preparationVersion: 0,
    createdAt: '2026-07-10T00:00:00Z',
    answeredAt: null,
    ...overrides,
  };
}
