import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';

import { BottomTabBar } from '../components/BottomTabBar';
import { CharacterDetail } from '../components/CharacterDetail';
import { CharacterList } from '../components/CharacterList';
import { GameStatusBar } from '../components/GameStatusBar';
import { PartyPresetList } from '../components/PartyPresetList';
import { PrimaryButton } from '../components/PrimaryButton';
import { DEFAULT_MAIN_TAB_ID, MainTabId } from '../domain/mainTabs';
import type { UnifiedAutomationController } from '../domain/unifiedAutomationController';
import { toUserFacingErrorMessage } from '../domain/userFacingErrors';
import { theme } from '../styles/theme';
import type {
  AutomationJobResponse,
  BattleCategoryResponse,
  BattleLogResponse,
  BattleMapResponse,
  BattleResultResponse,
  BattleStatsResponse,
  CreatePartyPresetRequest,
  HofCharacter,
  HofCharacterDetail,
  HofStatusResponse,
  LoadPatternResponse,
  PartyPresetResponse,
  RunBattleRequest,
  UpdatePartyPresetRequest,
} from '../types/api';
import { BattleTabScreen } from './BattleTabScreen';
import { DataTabScreen } from './DataTabScreen';
import { HomeTabScreen } from './HomeTabScreen';
import { SettingsTabScreen } from './SettingsTabScreen';
import { TownTabScreen } from './TownTabScreen';

type MainSession = {
  loggedIn: boolean;
};

type CharacterSubTabId = 'characters' | 'presets';

type MainScreenProps = {
  session: MainSession | null;
  status: HofStatusResponse | null;
  battleCategories: BattleCategoryResponse[];
  isBattleCategoriesLoading: boolean;
  battleCategoriesError: string | null;
  characters: HofCharacter[];
  characterSyncLabel: string | null;
  notice: string | null;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onRunBattle: (request: RunBattleRequest) => Promise<BattleResultResponse>;
  onLoadBattleLogs: (limit?: number) => Promise<BattleLogResponse[]>;
  onLoadBattleStats: () => Promise<BattleStatsResponse>;
  onOpenCaptcha: () => void;
  onLoadCurrentAutomationJob: () => Promise<AutomationJobResponse | null>;
  automationController: UnifiedAutomationController;
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  onCreatePartyPreset: (
    request: CreatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onUpdatePartyPreset: (
    presetId: number,
    request: UpdatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onDeletePartyPreset: (presetId: number) => Promise<null>;
  onLoadCharacterDetail: (hofCharacterId: string) => Promise<HofCharacterDetail>;
  onLoadPattern: (hofCharacterId: string, slot: number) => Promise<LoadPatternResponse>;
  onSyncCharacters: () => Promise<void>;
  onLogout: () => void;
  onOpenLogin: () => void;
};

/**
 * 로그인 이후의 메인 화면이다.
 *
 * 상단 상태바, 현재 탭 화면, 하단 탭 바를 조립하고 각 탭에 필요한 callback을 전달한다.
 */
export function MainScreen({
  session,
  status,
  battleCategories,
  isBattleCategoriesLoading,
  battleCategoriesError,
  characters,
  characterSyncLabel,
  notice,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onRunBattle,
  onLoadBattleLogs,
  onLoadBattleStats,
  onOpenCaptcha,
  onLoadCurrentAutomationJob,
  automationController,
  onListPartyPresets,
  onCreatePartyPreset,
  onUpdatePartyPreset,
  onDeletePartyPreset,
  onLoadCharacterDetail,
  onLoadPattern,
  onSyncCharacters,
  onLogout,
  onOpenLogin,
}: MainScreenProps) {
  const [activeTabId, setActiveTabId] = useState<MainTabId>(DEFAULT_MAIN_TAB_ID);
  const [characterSubTabId, setCharacterSubTabId] = useState<CharacterSubTabId>('characters');
  const [selectedCharacter, setSelectedCharacter] = useState<HofCharacter | null>(null);
  const [selectedCharacterDetail, setSelectedCharacterDetail] = useState<HofCharacterDetail | null>(null);
  const [isCharacterDetailLoading, setIsCharacterDetailLoading] = useState(false);
  const [characterDetailError, setCharacterDetailError] = useState<string | null>(null);
  const [isCharacterSyncStarting, setIsCharacterSyncStarting] = useState(false);
  const isCharacterDetailOpen = activeTabId === 'characters' && selectedCharacter != null;
  const isCharacterSyncing = characterSyncLabel != null;

  /**
   * SSE 동기화로 characters 배열이 갱신되면 현재 선택된 캐릭터 객체도 최신 값으로 교체한다.
   *
   * 같은 hofCharacterId를 더 이상 찾지 못하면 동기화 중 사라진 캐릭터로 보고 상세 화면을 닫는다.
   */
  useEffect(() => {
    if (!selectedCharacter) return;
    const refreshedCharacter = characters.find(
      (character) => character.hofCharacterId === selectedCharacter.hofCharacterId,
    );
    setSelectedCharacter(refreshedCharacter ?? null);
  }, [characters, selectedCharacter?.hofCharacterId]);

  /**
   * 캐릭터 상세 화면에서 선택 캐릭터의 상세 정보를 불러온다.
   *
   * 사용자가 빠르게 다른 캐릭터로 이동해도 이전 요청 결과가 늦게 도착해 화면을 덮어쓰지 않도록 cancelled 플래그를 사용한다.
   */
  useEffect(() => {
    if (!selectedCharacter || !session?.loggedIn) {
      setSelectedCharacterDetail(null);
      setIsCharacterDetailLoading(false);
      setCharacterDetailError(null);
      return;
    }

    let cancelled = false;
    setSelectedCharacterDetail(null);
    setIsCharacterDetailLoading(true);
    setCharacterDetailError(null);

    onLoadCharacterDetail(selectedCharacter.hofCharacterId)
      .then((detail) => {
        if (!cancelled) {
          setSelectedCharacterDetail(detail);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCharacterDetailError(toUserFacingErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCharacterDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onLoadCharacterDetail, selectedCharacter?.hofCharacterId, session?.loggedIn]);

  /**
   * 캐릭터 탭의 재동기화 버튼에서 호출된다.
   *
   * 로그인되지 않았거나 SSE 동기화가 진행 중이면 중복 시작 요청을 막는다.
   */
  async function handleSyncCharacters() {
    if (!session?.loggedIn || isCharacterSyncing || isCharacterSyncStarting) return;

    setIsCharacterSyncStarting(true);
    try {
      await onSyncCharacters();
    } finally {
      setIsCharacterSyncStarting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <GameStatusBar status={status} />

      <View style={styles.content}>
        {renderSystemMessage(session, notice, onOpenLogin)}
        {renderActiveTab({
          activeTabId,
          authenticated: session?.loggedIn === true,
          battleCategories,
          isBattleCategoriesLoading,
          battleCategoriesError,
          characters,
          characterSyncLabel,
          isCharacterSyncing,
          isCharacterSyncStarting,
          onLoadBattleCategories,
          onLoadBattleMaps,
          onRunBattle,
          onLoadBattleLogs,
          onLoadBattleStats,
          onOpenCaptcha,
          onLoadCurrentAutomationJob,
          automationController,
          onListPartyPresets,
          onCreatePartyPreset,
          onUpdatePartyPreset,
          onDeletePartyPreset,
          onLoadPattern,
          onSyncCharacters: handleSyncCharacters,
          onLogout,
          characterDetailError,
          isCharacterDetailLoading,
          selectedCharacter,
          selectedCharacterDetail,
          characterSubTabId,
          setCharacterSubTabId,
          setSelectedCharacter,
        })}
      </View>

      {isCharacterDetailOpen ? (
        <View style={styles.stickyBackFooter}>
          <PrimaryButton
            label="목록으로"
            variant="secondary"
            onPress={() => setSelectedCharacter(null)}
          />
        </View>
      ) : null}

      <BottomTabBar activeTabId={activeTabId} onChangeTab={setActiveTabId} />
    </SafeAreaView>
  );
}

type RenderActiveTabArgs = {
  activeTabId: MainTabId;
  authenticated: boolean;
  battleCategories: BattleCategoryResponse[];
  isBattleCategoriesLoading: boolean;
  battleCategoriesError: string | null;
  characters: HofCharacter[];
  characterSyncLabel: string | null;
  isCharacterSyncing: boolean;
  isCharacterSyncStarting: boolean;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onRunBattle: (request: RunBattleRequest) => Promise<BattleResultResponse>;
  onLoadBattleLogs: (limit?: number) => Promise<BattleLogResponse[]>;
  onLoadBattleStats: () => Promise<BattleStatsResponse>;
  onOpenCaptcha: () => void;
  onLoadCurrentAutomationJob: () => Promise<AutomationJobResponse | null>;
  automationController: UnifiedAutomationController;
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  onCreatePartyPreset: (
    request: CreatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onUpdatePartyPreset: (
    presetId: number,
    request: UpdatePartyPresetRequest,
  ) => Promise<PartyPresetResponse>;
  onDeletePartyPreset: (presetId: number) => Promise<null>;
  onLoadPattern: (hofCharacterId: string, slot: number) => Promise<LoadPatternResponse>;
  onSyncCharacters: () => void;
  onLogout: () => void;
  characterDetailError: string | null;
  isCharacterDetailLoading: boolean;
  selectedCharacter: HofCharacter | null;
  selectedCharacterDetail: HofCharacterDetail | null;
  characterSubTabId: CharacterSubTabId;
  setCharacterSubTabId: (tabId: CharacterSubTabId) => void;
  setSelectedCharacter: (character: HofCharacter | null) => void;
};

/**
 * 현재 선택된 하단 탭에 맞는 실제 화면 컴포넌트를 선택한다.
 *
 * MainScreen이 가진 공통 상태와 API callback을 각 탭이 필요한 형태로 나누어 전달하는 라우터 역할을 한다.
 */
function renderActiveTab({
  activeTabId,
  authenticated,
  battleCategories,
  isBattleCategoriesLoading,
  battleCategoriesError,
  characters,
  characterSyncLabel,
  isCharacterSyncing,
  isCharacterSyncStarting,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onRunBattle,
  onLoadBattleLogs,
  onLoadBattleStats,
  onOpenCaptcha,
  onLoadCurrentAutomationJob,
  automationController,
  onListPartyPresets,
  onCreatePartyPreset,
  onUpdatePartyPreset,
  onDeletePartyPreset,
  onLoadPattern,
  onSyncCharacters,
  onLogout,
  characterDetailError,
  isCharacterDetailLoading,
  selectedCharacter,
  selectedCharacterDetail,
  characterSubTabId,
  setCharacterSubTabId,
  setSelectedCharacter,
}: RenderActiveTabArgs) {
  switch (activeTabId) {
    case 'home':
      return (
        <HomeTabScreen
          authenticated={authenticated}
          battleCategories={battleCategories}
          onLoadBattleCategories={onLoadBattleCategories}
          onLoadBattleMaps={onLoadBattleMaps}
          onListPartyPresets={onListPartyPresets}
          automationController={automationController}
          onOpenCaptcha={onOpenCaptcha}
        />
      );
    case 'battle':
      return (
        <BattleTabScreen
          authenticated={authenticated}
          categories={battleCategories}
          isLoading={isBattleCategoriesLoading}
          errorMessage={battleCategoriesError}
          characters={characters}
          onLoadCategories={onLoadBattleCategories}
          onLoadMaps={onLoadBattleMaps}
          onRunBattle={onRunBattle}
        />
      );
    case 'characters':
      return selectedCharacter ? (
        <View style={styles.tabPanel}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>캐릭터 상세</Text>
            <View style={styles.sectionActions}>
              <Text style={styles.sectionMeta}>{characterSyncLabel ?? `${characters.length}명`}</Text>
            </View>
          </View>
          <ScrollView
            contentContainerStyle={[styles.detailContainer, styles.containerWithStickyFooter]}
            contentInsetAdjustmentBehavior="automatic"
            style={styles.tabScroller}
          >
            <CharacterDetail
              character={selectedCharacter}
              detail={selectedCharacterDetail}
              isLoading={isCharacterDetailLoading}
              errorMessage={characterDetailError}
              onLoadPattern={onLoadPattern}
            />
          </ScrollView>
        </View>
      ) : (
        <View style={styles.tabPanel}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>캐릭터</Text>
            <View style={styles.sectionActions}>
              <Text style={styles.sectionMeta}>{characterSyncLabel ?? `${characters.length}명`}</Text>
              <SyncCharactersButton
                disabled={!authenticated || isCharacterSyncing}
                loading={isCharacterSyncStarting}
                onPress={onSyncCharacters}
              />
            </View>
          </View>
          <View style={styles.characterSubTabs}>
            <CharacterSubTabButton
              active={characterSubTabId === 'characters'}
              label="캐릭터창"
              onPress={() => setCharacterSubTabId('characters')}
            />
            <CharacterSubTabButton
              active={characterSubTabId === 'presets'}
              label="프리셋"
              onPress={() => setCharacterSubTabId('presets')}
            />
          </View>
          {characterSubTabId === 'characters' ? (
            <CharacterList characters={characters} onSelectCharacter={setSelectedCharacter} />
          ) : (
            <PartyPresetList
              authenticated={authenticated}
              characters={characters}
              onListPartyPresets={onListPartyPresets}
              onCreatePartyPreset={onCreatePartyPreset}
              onUpdatePartyPreset={onUpdatePartyPreset}
              onDeletePartyPreset={onDeletePartyPreset}
            />
          )}
        </View>
      );
    case 'town':
      return (
        <TabScrollContainer>
          <TownTabScreen />
        </TabScrollContainer>
      );
    case 'data':
      return (
        <DataTabScreen
          authenticated={authenticated}
          onLoadBattleLogs={onLoadBattleLogs}
          onLoadBattleStats={onLoadBattleStats}
        />
      );
    case 'settings':
      return (
        <TabScrollContainer>
          <SettingsTabScreen
            authenticated={authenticated}
            onLogout={onLogout}
            onOpenCaptcha={onOpenCaptcha}
            onLoadCurrentAutomationJob={onLoadCurrentAutomationJob}
          />
        </TabScrollContainer>
      );
  }
}

/**
 * 캐릭터 목록을 다시 동기화하는 버튼이다.
 *
 * 동기화 시작 요청 중에는 스피너를 보여주고, 실제 동기화 진행 중에는 상위 상태로 disabled 처리된다.
 */
function SyncCharactersButton({
  disabled,
  loading,
  onPress,
}: {
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel="캐릭터 재동기화"
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.syncButton,
        (disabled || loading) && styles.syncButtonDisabled,
        pressed && !disabled && !loading && styles.syncButtonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.text} size="small" />
      ) : (
        <RefreshCw color={theme.colors.text} size={16} strokeWidth={2.5} />
      )}
      <Text style={styles.syncButtonText}>재동기화</Text>
    </Pressable>
  );
}

/**
 * 캐릭터 탭 내부의 캐릭터창/프리셋 하위 탭 버튼이다.
 */
function CharacterSubTabButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.characterSubTabButton,
        active && styles.activeCharacterSubTabButton,
        pressed && styles.characterSubTabButtonPressed,
      ]}
    >
      <Text style={[styles.characterSubTabText, active && styles.activeCharacterSubTabText]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 로그인 상태 경고와 전역 안내 메시지를 화면 상단에 표시한다.
 *
 * 메시지가 없고 로그인도 정상이라면 null을 반환해서 빈 영역을 만들지 않는다.
 */
function renderSystemMessage(
  session: MainSession | null,
  notice: string | null,
  onOpenLogin: () => void,
) {
  const shouldShowNotice = notice != null && notice.length > 0;
  const shouldShowAuthPanel = !session?.loggedIn;
  if (!shouldShowNotice && !shouldShowAuthPanel) return null;

  return (
    <View style={styles.systemMessages}>
      {shouldShowNotice ? <Text style={styles.notice}>{notice}</Text> : null}

      {shouldShowAuthPanel ? (
        <View style={styles.authPanel}>
          <Text style={styles.authText}>저장 로그인 확인이 실패하면 로그인 화면에서 다시 시도하세요.</Text>
          <PrimaryButton label="로그인 화면" variant="secondary" onPress={onOpenLogin} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * 스크롤이 필요한 탭 화면에 공통 padding과 ScrollView 설정을 적용한다.
 */
function TabScrollContainer({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.tabScroller}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
  },
  tabScroller: {
    flex: 1,
  },
  tabPanel: {
    flex: 1,
    gap: 10,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
  },
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  detailContainer: {
    gap: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  containerWithStickyFooter: {
    paddingBottom: 96,
  },
  systemMessages: {
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
  stickyBackFooter: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  notice: {
    color: theme.colors.text,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accentAmber,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    fontSize: 14,
    lineHeight: 20,
  },
  authPanel: {
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  authText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  sectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30,
  },
  sectionMeta: {
    color: theme.colors.accentGreen,
    fontSize: 15,
    fontWeight: '900',
  },
  characterSubTabs: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.header,
    padding: theme.spacing.xs,
  },
  characterSubTabButton: {
    minHeight: 34,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.sm,
  },
  activeCharacterSubTabButton: {
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surfaceAlt,
  },
  characterSubTabButtonPressed: {
    opacity: 0.82,
  },
  characterSubTabText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  activeCharacterSubTabText: {
    color: theme.colors.accentAmber,
  },
  syncButton: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  syncButtonDisabled: {
    opacity: 0.45,
  },
  syncButtonPressed: {
    opacity: 0.82,
  },
  syncButtonText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: '800',
  },
  settingsPanel: {
    gap: theme.spacing.lg,
  },
});
