import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  ChevronDown,
  ChevronRight,
  LucideIcon,
  Play,
  Plus,
  Save,
  Settings,
  Trash2,
} from 'lucide-react-native';

import {
  buildCreateAutomationProfileRequest,
  filterAutomationProfileCategories,
  formatAutomationProfileSummary,
  setAutomationProfileMapPreset,
  toggleAutomationProfileMap,
} from '../domain/automationProfiles';
import { orderBattleCategories } from '../domain/battleCategories';
import { AutomationMapSettings } from '../features/automation/components/AutomationMapSettings';
import { formatFunds } from '../domain/hofStatus';
import { toUserFacingErrorMessage } from '../domain/userFacingErrors';
import { theme } from '../styles/theme';
import type {
  AutomationProfileResponse,
  BattleCategoryResponse,
  BattleMapResponse,
  CreateAutomationProfileRequest,
  HofStatusResponse,
  PartyPresetResponse,
  UpdateAutomationProfileRequest,
} from '../types/api';

type HomeTabScreenProps = {
  authenticated: boolean;
  status: HofStatusResponse | null;
  characterCount: number;
  battleCategories: BattleCategoryResponse[];
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onListAutomationProfiles: () => Promise<AutomationProfileResponse[]>;
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  onCreateAutomationProfile: (
    request: CreateAutomationProfileRequest,
  ) => Promise<AutomationProfileResponse>;
  onUpdateAutomationProfile: (
    profileId: number,
    request: UpdateAutomationProfileRequest,
  ) => Promise<AutomationProfileResponse>;
  onDeleteAutomationProfile: (profileId: number) => Promise<null>;
};

/**
 * 프로필 편집은 제공하지만 실제 자동화 실행 루프는 아직 구현 범위 밖이므로 Play를 명시적으로 막아둔다.
 * 맵이나 프리셋의 완성도와 무관한 제품 기능 플래그이며, 실행 callback도 의도적으로 no-op이다.
 */
const AUTOMATION_EXECUTION_AVAILABLE = false;

/**
 * 홈 탭 화면이다.
 *
 * 사용자가 직접 추가한 자동전투 카드 목록과 카드별 맵 설정 UI를 관리한다.
 */
export function HomeTabScreen({
  authenticated,
  status,
  characterCount,
  battleCategories,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onListAutomationProfiles,
  onListPartyPresets,
  onCreateAutomationProfile,
  onUpdateAutomationProfile,
  onDeleteAutomationProfile,
}: HomeTabScreenProps) {
  const [profiles, setProfiles] = useState<AutomationProfileResponse[]>([]);
  const [partyPresets, setPartyPresets] = useState<PartyPresetResponse[]>([]);
  const [isProfilesLoading, setIsProfilesLoading] = useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [savingProfileId, setSavingProfileId] = useState<number | null>(null);
  const [expandedProfileId, setExpandedProfileId] = useState<number | null>(null);
  const [draftNames, setDraftNames] = useState<Record<number, string>>({});
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Record<number, string>>({});
  const [mapsByCategory, setMapsByCategory] = useState<Record<string, BattleMapResponse[]>>({});
  const [loadingCategoryId, setLoadingCategoryId] = useState<string | null>(null);
  const [mapErrorsByCategory, setMapErrorsByCategory] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const orderedCategories = useMemo(
    () => filterAutomationProfileCategories(orderBattleCategories(battleCategories)),
    [battleCategories],
  );

  /**
   * 현재 계정에 저장된 자동전투 카드 목록을 불러온다.
   *
   * 로그인 계정이 없으면 이전 계정의 카드가 남지 않도록 목록과 펼침 상태를 함께 비운다.
   */
  const loadProfiles = useCallback(async () => {
    if (!authenticated) {
      setProfiles([]);
      setExpandedProfileId(null);
      return;
    }

    setIsProfilesLoading(true);
    setMessage(null);
    try {
      const loadedProfiles = await onListAutomationProfiles();
      setProfiles(loadedProfiles);
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
    } finally {
      setIsProfilesLoading(false);
    }
  }, [authenticated, onListAutomationProfiles]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  /**
   * 자동전투 맵에 연결할 수 있는 캐릭터 프리셋 목록을 불러온다.
   */
  const loadPartyPresets = useCallback(async () => {
    if (!authenticated) {
      setPartyPresets([]);
      return;
    }

    try {
      setPartyPresets(await onListPartyPresets());
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
    }
  }, [authenticated, onListPartyPresets]);

  useEffect(() => {
    void loadPartyPresets();
  }, [loadPartyPresets]);

  useEffect(() => {
    if (battleCategories.length > 0) return;
    onLoadBattleCategories();
  }, [battleCategories.length, onLoadBattleCategories]);

  /**
   * 자동전투 카드 하나를 수정한다.
   *
   * 서버 API는 전체 수정 요청을 받기 때문에 변경되지 않은 값은 기존 profile 값으로 채워서 보낸다.
   */
  const updateProfile = useCallback(async (
    profile: AutomationProfileResponse,
    patch: Partial<UpdateAutomationProfileRequest>,
  ): Promise<AutomationProfileResponse | null> => {
    if (!authenticated) {
      setMessage('로그인 계정이 없습니다.');
      return null;
    }

    setSavingProfileId(profile.id);
    setMessage(null);
    try {
      const updatedProfile = await onUpdateAutomationProfile(profile.id, {
        name: patch.name ?? profile.name,
        mode: patch.mode ?? profile.mode,
        maps: patch.maps ?? profile.maps,
        enabled: patch.enabled ?? profile.enabled,
      });
      setProfiles((currentProfiles) => currentProfiles.map((currentProfile) => (
        currentProfile.id === updatedProfile.id ? updatedProfile : currentProfile
      )));
      return updatedProfile;
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
      return null;
    } finally {
      setSavingProfileId((current) => (current === profile.id ? null : current));
    }
  }, [authenticated, onUpdateAutomationProfile]);

  /**
   * 자동전투 설정에서 선택한 카테고리의 맵 목록을 불러온다.
   *
   * 한 번 불러온 카테고리는 mapsByCategory에 저장해두고, 같은 카테고리를 다시 누르면 네트워크 요청을 생략한다.
   */
  const loadMaps = useCallback(async (categoryId: string) => {
    if (mapsByCategory[categoryId]) return;

    setLoadingCategoryId(categoryId);
    setMapErrorsByCategory((current) => {
      const next = { ...current };
      delete next[categoryId];
      return next;
    });

    try {
      const loadedMaps = await onLoadBattleMaps(categoryId);
      setMapsByCategory((current) => ({
        ...current,
        [categoryId]: loadedMaps,
      }));
    } catch (error) {
      setMapErrorsByCategory((current) => ({
        ...current,
        [categoryId]: toUserFacingErrorMessage(error),
      }));
    } finally {
      setLoadingCategoryId((current) => (current === categoryId ? null : current));
    }
  }, [mapsByCategory, onLoadBattleMaps]);

  /**
   * + 자동전투 추가 버튼에서 호출된다.
   *
   * 기본 설정으로 카드를 생성한 뒤 바로 펼쳐서 이름과 맵을 설정할 수 있게 한다.
   */
  const handleCreateProfile = useCallback(async () => {
    if (!authenticated) {
      setMessage('로그인 계정이 없습니다.');
      return;
    }

    setIsCreatingProfile(true);
    setMessage(null);
    try {
      const createdProfile = await onCreateAutomationProfile(buildCreateAutomationProfileRequest());
      setProfiles((currentProfiles) => [createdProfile, ...currentProfiles]);
      setDraftNames((currentDrafts) => ({
        ...currentDrafts,
        [createdProfile.id]: createdProfile.name,
      }));
      setExpandedProfileId(createdProfile.id);
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
    } finally {
      setIsCreatingProfile(false);
    }
  }, [authenticated, onCreateAutomationProfile]);

  /**
   * 자동전투 카드를 삭제한다.
   *
   * 삭제된 카드가 열려 있던 카드라면 expandedProfileId도 정리해서 빈 설정 패널이 남지 않게 한다.
   */
  const handleDeleteProfile = useCallback(async (profile: AutomationProfileResponse) => {
    if (!authenticated) {
      setMessage('로그인 계정이 없습니다.');
      return;
    }

    setSavingProfileId(profile.id);
    setMessage(null);
    try {
      await onDeleteAutomationProfile(profile.id);
      setProfiles((currentProfiles) => currentProfiles.filter((currentProfile) => (
        currentProfile.id !== profile.id
      )));
      setExpandedProfileId((current) => (current === profile.id ? null : current));
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
    } finally {
      setSavingProfileId((current) => (current === profile.id ? null : current));
    }
  }, [authenticated, onDeleteAutomationProfile]);

  /**
   * 자동전투 카드의 상세 설정 영역을 열고 닫는다.
   *
   * 처음 열 때는 기본 카테고리를 선택하고 해당 카테고리의 맵 목록까지 미리 불러온다.
   */
  const handleToggleExpanded = useCallback((profile: AutomationProfileResponse) => {
    const nextExpandedProfileId = expandedProfileId === profile.id ? null : profile.id;
    setExpandedProfileId(nextExpandedProfileId);

    if (nextExpandedProfileId == null || orderedCategories.length === 0) return;

    const currentCategoryId = selectedCategoryIds[profile.id] ?? orderedCategories[0]?.id;
    if (!currentCategoryId) return;

    setSelectedCategoryIds((currentCategoryIds) => ({
      ...currentCategoryIds,
      [profile.id]: currentCategoryId,
    }));
    void loadMaps(currentCategoryId);
  }, [expandedProfileId, loadMaps, orderedCategories, selectedCategoryIds]);

  /**
   * 카드 설정 안에서 전투/모험 같은 맵 카테고리를 바꾼다.
   *
   * 카테고리 선택 상태는 카드별로 따로 저장해서 여러 카드를 오갈 때 사용자가 보던 위치를 유지한다.
   */
  const handleSelectCategory = useCallback((profile: AutomationProfileResponse, categoryId: string) => {
    setSelectedCategoryIds((current) => ({
      ...current,
      [profile.id]: categoryId,
    }));
    void loadMaps(categoryId);
  }, [loadMaps]);

  /**
   * 이름 입력란의 임시 값을 서버에 저장한다.
   *
   * 빈 문자열만 입력된 경우에는 기존 이름을 유지해서 이름이 사라지는 실수를 막는다.
   */
  const handleSaveName = useCallback(async (profile: AutomationProfileResponse) => {
    const nextName = (draftNames[profile.id] ?? profile.name).trim() || profile.name;
    const updatedProfile = await updateProfile(profile, { name: nextName });

    if (updatedProfile) {
      setExpandedProfileId((current) => (current === profile.id ? null : current));
    }
  }, [draftNames, updateProfile]);

  /**
   * 자동전투 카드에 포함할 맵을 선택하거나 해제한다.
   *
   * 코드가 확인된 맵만 구조화된 profile.maps에 반영하며, 도메인 helper가 실행 순서를 연속으로 다시 매긴다.
   */
  const handleToggleMap = useCallback((
    profile: AutomationProfileResponse,
    map: BattleMapResponse,
  ) => {
    if (map.mapCode == null || !map.resolved) {
      setMessage('맵 코드 확인 대기');
      return;
    }

    const maps = toggleAutomationProfileMap(profile.maps, map);
    void updateProfile(profile, { maps });
  }, [updateProfile]);

  /**
   * 선택된 자동전투 맵에 캐릭터 프리셋을 지정한다.
   */
  const handleAssignMapPreset = useCallback((
    profile: AutomationProfileResponse,
    map: BattleMapResponse,
    partyPresetId: number | null,
  ) => {
    if (map.mapCode == null || !map.resolved) {
      setMessage('맵 코드 확인 대기');
      return;
    }

    const maps = setAutomationProfileMapPreset(profile.maps, {
      categoryId: map.categoryId,
      mapCode: map.mapCode,
    }, partyPresetId);
    void updateProfile(profile, { maps });
  }, [updateProfile]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.sectionTitle}>자동전투</Text>
          <Text style={styles.sectionMeta}>
            {status?.playerName ?? '계정 확인 중'} · 캐릭터 {characterCount.toLocaleString('en-US')}명
          </Text>
        </View>
        <Pressable
          accessibilityLabel="자동전투 카드 추가"
          accessibilityRole="button"
          disabled={!authenticated || isCreatingProfile}
          onPress={handleCreateProfile}
          style={({ pressed }) => [
            styles.addButton,
            (!authenticated || isCreatingProfile) && styles.buttonDisabled,
            pressed && authenticated && !isCreatingProfile && styles.buttonPressed,
          ]}
        >
          {isCreatingProfile ? (
            <ActivityIndicator color={theme.colors.buttonText} size="small" />
          ) : (
            <Plus color={theme.colors.buttonText} size={18} strokeWidth={3} />
          )}
          <Text style={styles.addButtonText}>+ 자동전투 추가</Text>
        </Pressable>
      </View>

      <View style={styles.statusGrid}>
        <CompactStat label="Time" value={formatTime(status)} accent />
        <CompactStat label="Funds" value={status?.funds == null ? '$ -' : formatFunds(status.funds)} />
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {isProfilesLoading ? (
        <View style={styles.loadingPanel}>
          <ActivityIndicator color={theme.colors.accentGreen} />
          <Text style={styles.loadingText}>자동전투 카드 로딩 중</Text>
        </View>
      ) : profiles.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>자동전투 카드가 없습니다.</Text>
          <Text style={styles.emptyText}>필요한 자동전투를 추가해서 맵 설정을 저장하세요.</Text>
        </View>
      ) : (
        <View style={styles.profileList}>
          {profiles.map((profile) => {
            const expanded = expandedProfileId === profile.id;
            const selectedCategoryCandidate = selectedCategoryIds[profile.id] ?? null;
            const selectedCategoryId = selectedCategoryCandidate &&
              orderedCategories.some((category) => category.id === selectedCategoryCandidate)
              ? selectedCategoryCandidate
              : orderedCategories[0]?.id ?? null;

            return (
              <View key={profile.id} style={styles.profileCard}>
                <View style={styles.profileTopRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${profile.name} 설정 열기`}
                    onPress={() => handleToggleExpanded(profile)}
                    style={({ pressed }) => [
                      styles.profileMain,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <View style={styles.profileIcon}>
                      {expanded ? (
                        <ChevronDown color={theme.colors.accentGreen} size={22} strokeWidth={2.8} />
                      ) : (
                        <ChevronRight color={theme.colors.textMuted} size={22} strokeWidth={2.8} />
                      )}
                    </View>
                    <View style={styles.profileTexts}>
                      <Text style={styles.profileName} numberOfLines={1}>{profile.name}</Text>
                      <Text style={styles.profileMeta} numberOfLines={1}>
                        {formatAutomationProfileSummary(profile.maps)}
                      </Text>
                    </View>
                  </Pressable>

                  <View style={styles.profileActions}>
                    <IconButton
                      accessibilityLabel={`${profile.name} 설정`}
                      disabled={savingProfileId === profile.id}
                      icon={Settings}
                      onPress={() => handleToggleExpanded(profile)}
                    />
                    <IconButton
                      accessibilityLabel={`${profile.name} 실행 준비`}
                      disabled={!AUTOMATION_EXECUTION_AVAILABLE}
                      icon={Play}
                      onPress={() => undefined}
                    />
                  </View>
                </View>

                {expanded ? (
                  <View style={styles.profileSettings}>
                    <View style={styles.nameEditor}>
                      <TextInput
                        autoCapitalize="none"
                        autoCorrect={false}
                        onChangeText={(text) => {
                          setDraftNames((current) => ({
                            ...current,
                            [profile.id]: text,
                          }));
                        }}
                        placeholder="자동전투 이름"
                        placeholderTextColor={theme.colors.textMuted}
                        style={styles.nameInput}
                        value={draftNames[profile.id] ?? profile.name}
                      />
                      <IconButton
                        accessibilityLabel={`${profile.name} 이름 저장`}
                        disabled={savingProfileId === profile.id}
                        icon={Save}
                        onPress={() => handleSaveName(profile)}
                      />
                      <IconButton
                        accessibilityLabel={`${profile.name} 삭제`}
                        danger
                        disabled={savingProfileId === profile.id}
                        icon={Trash2}
                        onPress={() => handleDeleteProfile(profile)}
                      />
                    </View>

                    <View style={styles.categoryRow}>
                      {orderedCategories.map((category) => (
                        <Pressable
                          key={category.id}
                          accessibilityRole="button"
                          disabled={!category.enabled}
                          onPress={() => handleSelectCategory(profile, category.id)}
                          style={({ pressed }) => [
                            styles.categoryButton,
                            selectedCategoryId === category.id && styles.categoryButtonActive,
                            !category.enabled && styles.buttonDisabled,
                            pressed && category.enabled && styles.buttonPressed,
                          ]}
                        >
                          <Text style={[
                            styles.categoryButtonText,
                            selectedCategoryId === category.id && styles.categoryButtonTextActive,
                          ]} numberOfLines={1}>
                            {category.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    {selectedCategoryId ? (
                      <AutomationMapSettings
                        categoryId={selectedCategoryId}
                        profileMaps={profile.maps}
                        maps={mapsByCategory[selectedCategoryId] ?? []}
                        partyPresets={partyPresets}
                        errorMessage={mapErrorsByCategory[selectedCategoryId] ?? null}
                        loading={loadingCategoryId === selectedCategoryId}
                        saving={savingProfileId === profile.id}
                        onAssignPreset={(map, partyPresetId) => handleAssignMapPreset(profile, map, partyPresetId)}
                        onToggleMap={(map) => handleToggleMap(profile, map)}
                      />
                    ) : (
                      <Text style={styles.mutedText}>맵 카테고리가 없습니다.</Text>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

type CompactStatProps = {
  label: string;
  value: string;
  accent?: boolean;
};

/**
 * 홈 상단의 Time/Funds 같은 짧은 지표를 표시한다.
 */
function CompactStat({ label, value, accent = false }: CompactStatProps) {
  return (
    <View style={styles.compactStat}>
      <Text style={styles.compactStatLabel}>{label}</Text>
      <Text style={[styles.compactStatValue, accent && styles.compactStatValueAccent]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

type IconButtonProps = {
  accessibilityLabel: string;
  disabled?: boolean;
  danger?: boolean;
  icon: LucideIcon;
  onPress: () => void;
};

/**
 * 설정, 저장, 삭제처럼 아이콘만 사용하는 작은 버튼이다.
 *
 * danger가 true이면 삭제 성격의 버튼으로 보여주고, disabled 상태에서는 터치와 스타일을 함께 비활성화한다.
 */
function IconButton({
  accessibilityLabel,
  disabled = false,
  danger = false,
  icon: Icon,
  onPress,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        danger && styles.iconButtonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Icon
        color={danger ? theme.colors.danger : theme.colors.text}
        size={17}
        strokeWidth={2.5}
      />
    </Pressable>
  );
}

/**
 * HOF 상태의 현재 Time/최대 Time을 화면에 표시할 문자열로 변환한다.
 */
function formatTime(status: HofStatusResponse | null): string {
  if (status?.timeCurrent == null || status.timeMax == null) return '-';
  return `${status.timeCurrent.toLocaleString('en-US')}/${status.timeMax.toLocaleString('en-US')}`;
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.lg,
  },
  headerRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  sectionMeta: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  addButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.accentGreen,
    paddingHorizontal: theme.spacing.md,
  },
  addButtonText: {
    color: theme.colors.buttonText,
    fontSize: 13,
    fontWeight: '900',
  },
  statusGrid: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  compactStat: {
    flex: 1,
    minHeight: 58,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
  },
  compactStatLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  compactStatValue: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
  },
  compactStatValueAccent: {
    color: theme.colors.statusGreen,
  },
  message: {
    color: theme.colors.danger,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.md,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 19,
  },
  loadingPanel: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
  },
  loadingText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  emptyPanel: {
    minHeight: 180,
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  profileList: {
    gap: theme.spacing.md,
  },
  profileCard: {
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  profileMain: {
    flex: 1,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  profileIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.background,
  },
  profileTexts: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 24,
  },
  profileMeta: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  profileActions: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  iconButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
  },
  iconButtonDanger: {
    borderColor: theme.colors.danger,
  },
  profileSettings: {
    gap: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.md,
  },
  nameEditor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  nameInput: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: theme.spacing.md,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  categoryButton: {
    minHeight: 36,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: theme.spacing.md,
  },
  categoryButtonActive: {
    borderColor: theme.colors.accentBlue,
    backgroundColor: theme.colors.background,
  },
  categoryButtonText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  categoryButtonTextActive: {
    color: theme.colors.accentBlue,
  },
  inlineState: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  inlineStateText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  mutedText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 19,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.82,
  },
});
