import type { ElementRef, ReactNode } from "react";
import {
  useCallback,
  useRef,
  useState,
} from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NestableScrollContainer } from "react-native-draggable-flatlist";

import type { BattleResource } from "../features/battle/useBattleResource";
import type { CaptchaPassResource } from "../features/captcha/useCaptchaPassMaintenance";
import { BottomTabBar } from "../components/BottomTabBar";
import { FixedBottomActionHost } from "../components/FixedBottomAction";
import { scrollFocusedInputIntoView } from "../components/keyboardAwareScroll";
import { CharacterDetail } from "../components/CharacterDetail";
import { CharacterList } from "../components/CharacterList";
import { PartyPresetList } from "../components/PartyPresetList";
import { PrimaryButton } from "../components/PrimaryButton";
import {
  DEFAULT_MAIN_TAB_ID,
  MainRouteId,
} from "../domain/mainTabs";
import type { PartyPresetCatalogResource } from "../domain/partyPresetCatalogModule";
import type { CharacterManagementHubResource } from "../domain/characterManagementHubModule";
import type { UnifiedAutomationController } from "../domain/unifiedAutomationController";
import { theme } from "../styles/theme";
import type {
  FishingBattleTarget,
  CharacterSyncJobResponse,
  HofObservedStatusResponse,
  HofStatusResponse,
  PartyPresetResponse,
  HofCharacter,
} from "../types/api";
import { BattleTabScreen } from "./BattleTabScreen";
import { DataTabScreen } from "./DataTabScreen";
import { HomeTabScreen } from "./HomeTabScreen";
import { SettingsTabScreen } from "./SettingsTabScreen";
import { TownTabScrollContainer } from "./TownTabScrollContainer";
import type { TownApi } from "../features/town/api/townApi";

type MainSession = {
  loggedIn: boolean;
};

type CharacterSubTabId = "characters" | "presets";

type MainScreenProps = {
  session: MainSession | null;
  status: HofStatusResponse | null;
  battle: BattleResource;
  characterHub: CharacterManagementHubResource;
  characterSyncLabel: string | null;
  characterSyncJob?: CharacterSyncJobResponse | null;
  onSyncCharacterRoster?: () => Promise<void>;
  onStartCharacterFullSync?: () => Promise<void>;
  onStopCharacterSync?: () => Promise<void>;
  onResumeCharacterSync?: () => Promise<void>;
  notice: string | null;
  onLoadPresetPatterns?: (preset: PartyPresetResponse, characters: HofCharacter[]) => Promise<string>;
  onOpenCaptcha: () => void;
  onStatusObserved?: (status: HofObservedStatusResponse) => void;
  automationController: UnifiedAutomationController;
  partyPresetCatalog: PartyPresetCatalogResource;
  onLogout: () => void;
  onOpenLogin: () => void;
  townApi?: TownApi;
  resolveCaptcha?: () => Promise<void>;
  passMaintenance?: CaptchaPassResource;
};

/**
 * 로그인 이후의 메인 화면이다.
 *
 * 상단 상태바, 현재 탭 화면, 하단 탭 바를 조립하고 각 탭에 필요한 callback을 전달한다.
 */
export function MainScreen({
  session,
  status,
  battle,
  characterHub,
  characterSyncLabel,
  characterSyncJob,
  onSyncCharacterRoster,
  onStartCharacterFullSync,
  onStopCharacterSync,
  onResumeCharacterSync,
  notice,
  onLoadPresetPatterns,
  onOpenCaptcha,
  onStatusObserved,
  automationController,
  partyPresetCatalog,
  onLogout,
  onOpenLogin,
  townApi,
  resolveCaptcha,
  passMaintenance,
}: MainScreenProps) {
  const [activeTabId, setActiveTabId] =
    useState<MainRouteId>(DEFAULT_MAIN_TAB_ID);
  const [pendingBattleTarget, setPendingBattleTarget] =
    useState<FishingBattleTarget | null>(null);
  const consumePendingBattleTarget = useCallback(
    () => setPendingBattleTarget(null),
    [],
  );
  const [characterSubTabId, setCharacterSubTabId] =
    useState<CharacterSubTabId>("characters");
  const selectedCharacter = characterHub.selectedCharacter;
  const [automationEditorOpen, setAutomationEditorOpen] = useState(false);
  const [dataLogOpen, setDataLogOpen] = useState(false);
  const [townDetailOpen, setTownDetailOpen] = useState(false);
  const isCharacterDetailOpen =
    activeTabId === "characters" && selectedCharacter != null;
  const townDetailFullScreen = activeTabId === "town" && townDetailOpen;
  const showBottomTabs =
    activeTabId !== "settings" &&
    !automationEditorOpen &&
    !dataLogOpen &&
    !townDetailFullScreen &&
    !isCharacterDetailOpen;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View
        accessibilityLabel={
          townDetailFullScreen
            ? "마을 상세 전체 화면"
            : isCharacterDetailOpen
              ? "캐릭터 상세 전체 화면"
              : undefined
        }
        style={[
          styles.content,
          (townDetailFullScreen || isCharacterDetailOpen) &&
            styles.fullScreenContent,
        ]}
      >
        <FixedBottomActionHost>
          {renderSystemMessage(session, notice, onOpenLogin)}
          {passMaintenance?.warning ? (
            <Pressable
              accessibilityRole={passMaintenance.manualAvailable ? "button" : "alert"}
              disabled={!passMaintenance.manualAvailable}
              onPress={passMaintenance.manualAvailable ? onOpenCaptcha : undefined}
              style={styles.passWarning}
            >
              <Text style={styles.passWarningText}>{passMaintenance.warning}</Text>
              {passMaintenance.manualAvailable ? <Text style={styles.passWarningAction}>직접 인증</Text> : null}
            </Pressable>
          ) : null}
          {renderActiveTab({
          activeTabId,
          status,
          authenticated: session?.loggedIn === true,
          battle,
          characterSyncLabel,
          characterSyncJob,
          onSyncCharacterRoster,
          onStartCharacterFullSync,
          onStopCharacterSync,
          onResumeCharacterSync,
          onLoadPresetPatterns,
          onOpenCaptcha,
          onOpenAppSettings: () => setActiveTabId("settings"),
          onCloseAppSettings: () => setActiveTabId("home"),
          onStatusObserved,
          automationController,
          partyPresetCatalog,
          characterHub,
          onLogout,
          characterSubTabId,
          setCharacterSubTabId,
          townApi,
          resolveCaptcha,
          pendingBattleTarget,
          consumePendingBattleTarget,
          passMaintenance,
          onOpenFishingBattle: (target) => {
            setPendingBattleTarget(target);
            setActiveTabId("battle");
          },
          onAutomationEditorModeChange: setAutomationEditorOpen,
          onDataLogModeChange: setDataLogOpen,
          onTownDetailOpenChange: setTownDetailOpen,
          })}
        </FixedBottomActionHost>
      </View>

      {showBottomTabs ? (
        <BottomTabBar activeTabId={activeTabId} onChangeTab={setActiveTabId} />
      ) : null}
    </SafeAreaView>
  );
}

type RenderActiveTabArgs = {
  activeTabId: MainRouteId;
  status: HofStatusResponse | null;
  authenticated: boolean;
  battle: BattleResource;
  characterSyncLabel: string | null;
  characterSyncJob?: CharacterSyncJobResponse | null;
  onSyncCharacterRoster?: () => Promise<void>;
  onStartCharacterFullSync?: () => Promise<void>;
  onStopCharacterSync?: () => Promise<void>;
  onResumeCharacterSync?: () => Promise<void>;
  onLoadPresetPatterns?: (preset: PartyPresetResponse, characters: HofCharacter[]) => Promise<string>;
  onOpenCaptcha: () => void;
  onOpenAppSettings: () => void;
  onCloseAppSettings: () => void;
  onStatusObserved?: (status: HofObservedStatusResponse) => void;
  automationController: UnifiedAutomationController;
  partyPresetCatalog: PartyPresetCatalogResource;
  characterHub: CharacterManagementHubResource;
  onLogout: () => void;
  characterSubTabId: CharacterSubTabId;
  setCharacterSubTabId: (tabId: CharacterSubTabId) => void;
  onAutomationEditorModeChange: (active: boolean) => void;
  onDataLogModeChange: (active: boolean) => void;
  onTownDetailOpenChange: (open: boolean) => void;
  townApi?: TownApi;
  resolveCaptcha?: () => Promise<void>;
  onOpenFishingBattle: (target: FishingBattleTarget) => void;
  pendingBattleTarget: FishingBattleTarget | null;
  consumePendingBattleTarget: () => void;
  passMaintenance?: CaptchaPassResource;
};

/**
 * 현재 선택된 하단 탭에 맞는 실제 화면 컴포넌트를 선택한다.
 *
 * MainScreen이 가진 공통 상태와 API callback을 각 탭이 필요한 형태로 나누어 전달하는 라우터 역할을 한다.
 */
function renderActiveTab({
  activeTabId,
  status,
  authenticated,
  battle,
  characterSyncLabel,
  characterSyncJob,
  onSyncCharacterRoster,
  onStartCharacterFullSync,
  onStopCharacterSync,
  onResumeCharacterSync,
  onLoadPresetPatterns,
  onOpenCaptcha,
  onOpenAppSettings,
  onCloseAppSettings,
  onStatusObserved,
  automationController,
  partyPresetCatalog,
  characterHub,
  onLogout,
  characterSubTabId,
  setCharacterSubTabId,
  onAutomationEditorModeChange,
  onTownDetailOpenChange,
  townApi,
  resolveCaptcha,
  onOpenFishingBattle,
  pendingBattleTarget,
  consumePendingBattleTarget,
  onDataLogModeChange,
  passMaintenance,
}: RenderActiveTabArgs) {
  const selectedCharacter = characterHub.selectedCharacter;
  const characters = characterHub.characters;
  switch (activeTabId) {
    case "home":
      return (
        <HomeTabScreen
          authenticated={authenticated}
          status={status}
          battle={battle}
          partyPresetCatalog={partyPresetCatalog}
          automationController={automationController}
          onOpenCaptcha={onOpenCaptcha}
          onOpenAppSettings={onOpenAppSettings}
          onStatusObserved={onStatusObserved}
          onDetailModeChange={onAutomationEditorModeChange}
          townApi={townApi}
        />
      );
    case "battle":
      return (
        <BattleTabScreen
          battle={battle}
          authenticated={authenticated}
          characters={characters}
          partyPresetCatalog={partyPresetCatalog}
          initialTarget={pendingBattleTarget}
          onInitialTargetConsumed={consumePendingBattleTarget}
        />
      );
    case "characters":
      return selectedCharacter ? (
        <View style={[styles.tabPanel, styles.detailPanel]}>
          <CharacterDetailScroll>
            <CharacterDetail
              characterHub={characterHub}
            />
          </CharacterDetailScroll>
        </View>
      ) : (
        <View style={styles.tabPanel}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>캐릭터</Text>
            <View style={styles.sectionActions}>
              <Text style={styles.sectionMeta}>
                {characterSyncLabel ?? `${characters.length}명`}
              </Text>
              {characterSyncLabel == null &&
                characterSyncJob?.status !== "running" &&
                characterSyncJob?.status !== "pending" &&
                characterSyncJob?.status !== "stopped" &&
                onSyncCharacterRoster && (
                  <Pressable
                    accessibilityLabel="캐릭터 목록 동기화"
                    accessibilityRole="button"
                    onPress={() => void onSyncCharacterRoster()}
                    style={styles.syncControl}
                  >
                    <Text style={styles.syncControlText}>목록 동기화</Text>
                  </Pressable>
                )}
              {characterSyncLabel == null &&
                characterSyncJob?.status !== "running" &&
                characterSyncJob?.status !== "pending" &&
                characterSyncJob?.status !== "stopped" &&
                onStartCharacterFullSync && (
                  <Pressable
                    accessibilityLabel="전체 캐릭터 상세 동기화"
                    accessibilityRole="button"
                    onPress={() => void onStartCharacterFullSync()}
                    style={[styles.syncControl, styles.syncControlPrimary]}
                  >
                    <Text
                      style={[
                        styles.syncControlText,
                        styles.syncControlPrimaryText,
                      ]}
                    >
                      전체 상세 동기화
                    </Text>
                  </Pressable>
                )}
              {(characterSyncJob?.status === "running" ||
                characterSyncJob?.status === "pending") && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void onStopCharacterSync?.()}
                  style={styles.syncControl}
                >
                  <Text style={styles.syncControlText}>
                    현재 캐릭터 후 중지
                  </Text>
                </Pressable>
              )}
              {characterSyncJob?.status === "stopped" && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void onResumeCharacterSync?.()}
                  style={styles.syncControl}
                >
                  <Text style={styles.syncControlText}>이어하기</Text>
                </Pressable>
              )}
            </View>
          </View>
          <View style={styles.characterSubTabs}>
            <CharacterSubTabButton
              active={characterSubTabId === "characters"}
              label="캐릭터창"
              onPress={() => setCharacterSubTabId("characters")}
            />
            <CharacterSubTabButton
              active={characterSubTabId === "presets"}
              label="프리셋"
              onPress={() => setCharacterSubTabId("presets")}
            />
          </View>
          {characterSubTabId === "characters" ? (
            <CharacterList
              characterHub={characterHub}
            />
          ) : (
            <PartyPresetList
              authenticated={authenticated}
              characters={characters}
              partyPresetCatalog={partyPresetCatalog}
              onLoadPresetPatterns={onLoadPresetPatterns}
            />
          )}
        </View>
      );
    case "town":
      return (
        <TownTabScrollContainer
          onRunBattle={battle.run}
          townApi={townApi}
          resolveCaptcha={resolveCaptcha}
          onOpenFishingBattle={onOpenFishingBattle}
          characters={characters}
          partyPresetCatalog={partyPresetCatalog}
          onDetailOpenChange={onTownDetailOpenChange}
        />
      );
    case "data":
      return (
        <DataTabScreen
          authenticated={authenticated}
          battle={battle}
          onFullScreenChange={onDataLogModeChange}
        />
      );
    case "settings":
      return (
        <TabScrollContainer>
          <SettingsTabScreen
            authenticated={authenticated}
            onBack={onCloseAppSettings}
            onLogout={onLogout}
            onOpenCaptcha={onOpenCaptcha}
            passMaintenance={passMaintenance}
          />
        </TabScrollContainer>
      );
  }
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
      <Text
        style={[
          styles.characterSubTabText,
          active && styles.activeCharacterSubTabText,
        ]}
      >
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
          <Text style={styles.authText}>
            저장 로그인 확인이 실패하면 로그인 화면에서 다시 시도하세요.
          </Text>
          <PrimaryButton
            label="로그인 화면"
            variant="secondary"
            onPress={onOpenLogin}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * 스크롤이 필요한 탭 화면에 공통 padding과 ScrollView 설정을 적용한다.
 */
function TabScrollContainer({ children }: { children: ReactNode }) {
  const scrollRef = useRef<ScrollView>(null);
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onFocus={(event) =>
        scrollFocusedInputIntoView(scrollRef.current, event.nativeEvent.target)
      }
      ref={scrollRef}
      style={styles.tabScroller}
    >
      {children}
    </ScrollView>
  );
}

function CharacterDetailScroll({ children }: { children: ReactNode }) {
  const scrollRef = useRef<ElementRef<typeof NestableScrollContainer>>(null);
  return (
    <NestableScrollContainer
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.detailContainer}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onFocus={(event) =>
        scrollFocusedInputIntoView(scrollRef.current, event.nativeEvent.target)
      }
      ref={scrollRef}
      style={styles.tabScroller}
    >
      {children}
    </NestableScrollContainer>
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
  fullScreenContent: {
    backgroundColor: theme.colors.background,
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
  detailPanel: {
    gap: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  detailContainer: {
    paddingBottom: 0,
  },
  systemMessages: {
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
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
  passWarning: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.accentAmber,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: theme.spacing.sm,
    justifyContent: "space-between",
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
  },
  passWarningText: {
    color: theme.colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  passWarningAction: {
    color: theme.colors.accentAmber,
    fontSize: 13,
    fontWeight: "900",
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  sectionActions: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 30,
  },
  sectionMeta: {
    color: theme.colors.accentGreen,
    fontSize: 15,
    fontWeight: "900",
  },
  syncControl: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: theme.colors.surfaceAlt,
  },
  syncControlText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  syncControlPrimary: {
    backgroundColor: theme.colors.accentGreen,
  },
  syncControlPrimaryText: {
    color: theme.colors.buttonText,
  },
  characterSubTabs: {
    flexDirection: "row",
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
    alignItems: "center",
    justifyContent: "center",
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
    fontWeight: "900",
  },
  activeCharacterSubTabText: {
    color: theme.colors.accentAmber,
  },
  settingsPanel: {
    gap: theme.spacing.lg,
  },
});
