import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Info, Save } from 'lucide-react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { UnifiedAutomationDashboard } from '../features/automation/components/UnifiedAutomationDashboard';
import {
  UnifiedAutomationSettings,
  type UnifiedSettingsRoute,
} from '../features/automation/components/UnifiedAutomationSettings';
import {
  getUnifiedDetailTitle,
  UnifiedAutomationDetail,
} from '../features/automation/components/UnifiedAutomationDetail';
import { toUserFacingErrorMessage } from '../domain/userFacingErrors';
import { theme } from '../styles/theme';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  PartyPresetResponse,
  UnifiedAutomationAction,
  UnifiedAutomationSettingsRequest,
  UnifiedAutomationStatusResponse,
} from '../types/api';

type HomeTabScreenProps = {
  authenticated: boolean;
  battleCategories: BattleCategoryResponse[];
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  onGetUnifiedAutomation: () => Promise<UnifiedAutomationStatusResponse>;
  onUpdateUnifiedAutomation: (
    settings: UnifiedAutomationSettingsRequest,
  ) => Promise<UnifiedAutomationStatusResponse>;
  onChangeUnifiedAutomationState: (
    action: UnifiedAutomationAction,
  ) => Promise<UnifiedAutomationStatusResponse>;
  onOpenCaptcha: () => void;
};

type HomeRoute = 'dashboard' | 'settings' | UnifiedSettingsRoute;

/**
 * 계정별 통합 자동화의 상태 확인, 실행 제어, 단계형 설정을 한 흐름으로 제공한다.
 * 첫 화면에는 현재 작업만 두고 세부 옵션은 자동화 설정 안으로 분리한다.
 */
export function HomeTabScreen({
  authenticated,
  battleCategories,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onListPartyPresets,
  onGetUnifiedAutomation,
  onUpdateUnifiedAutomation,
  onChangeUnifiedAutomationState,
  onOpenCaptcha,
}: HomeTabScreenProps) {
  const [route, setRoute] = useState<HomeRoute>('dashboard');
  const [automation, setAutomation] = useState<UnifiedAutomationStatusResponse | null>(null);
  const [draft, setDraft] = useState<UnifiedAutomationSettingsRequest | null>(null);
  const [partyPresets, setPartyPresets] = useState<PartyPresetResponse[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadAutomation = useCallback(async () => {
    if (!authenticated) {
      setAutomation(null);
      setDraft(null);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const loaded = await onGetUnifiedAutomation();
      setAutomation(loaded);
      setDraft(loaded.settings);
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [authenticated, onGetUnifiedAutomation]);

  useEffect(() => {
    void loadAutomation();
  }, [loadAutomation]);

  useEffect(() => {
    if (!authenticated) return;
    void onListPartyPresets()
      .then(setPartyPresets)
      .catch((error: unknown) => setMessage(toUserFacingErrorMessage(error)));
    if (battleCategories.length === 0) onLoadBattleCategories();
  }, [authenticated, battleCategories.length, onListPartyPresets, onLoadBattleCategories]);

  async function changeState(action: UnifiedAutomationAction) {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await onChangeUnifiedAutomationState(action);
      setAutomation(updated);
      setDraft(updated.settings);
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await onUpdateUnifiedAutomation(draft);
      setAutomation(updated);
      setDraft(updated.settings);
      setRoute('dashboard');
      setMessage('자동화 설정을 저장했어요.');
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function toggleModule(module: UnifiedSettingsRoute) {
    if (!draft) return;
    setDraft({
      ...draft,
      [module]: { ...draft[module], enabled: !draft[module].enabled },
    });
  }

  const title = route === 'dashboard'
    ? '통합 자동화'
    : route === 'settings'
      ? '자동화 설정'
      : getUnifiedDetailTitle(route);

  return (
    <View style={styles.stack}>
      <View style={styles.header}>
        {route !== 'dashboard' ? (
          <Pressable accessibilityLabel="이전 화면" onPress={() => setRoute(route === 'settings' ? 'dashboard' : 'settings')} style={styles.iconButton}>
            <ArrowLeft color={theme.colors.text} size={20} />
          </Pressable>
        ) : null}
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{route === 'dashboard' ? '앱을 닫아도 서버에서 계속 진행돼요' : '필요한 항목만 켜고 세부 설정을 선택하세요'}</Text>
        </View>
        <Pressable
          accessibilityLabel="자동화 실행 규칙 보기"
          accessibilityRole="button"
          onPress={() => setRulesOpen((current) => !current)}
          style={styles.iconButton}
        >
          <Info color={theme.colors.textMuted} size={20} />
        </Pressable>
      </View>

      {rulesOpen ? (
        <View style={styles.ruleCard}>
          <Text style={styles.ruleTitle}>현재 선택 규칙</Text>
          <Text style={styles.ruleText}>열쇠 퀘스트 수락·완료를 가장 먼저 확인해요.</Text>
          <Text style={styles.ruleText}>Time이 설정 비율을 넘으면 일반맵을 먼저 진행해요.</Text>
          <Text style={styles.ruleText}>퀘스트가 완료될 때까지 전투 후 상태를 다시 확인해요.</Text>
          <Text style={styles.ruleText}>캡차 인증이 필요해요 상태에서는 인증 후 같은 작업을 자동으로 이어가요.</Text>
          <Text style={styles.ruleText}>전투에 사용할 파티를 선택해 주세요 상태에서는 해당 설정만 보완하면 돼요.</Text>
        </View>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {loading && !automation ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={theme.colors.accentGreen} />
          <Text style={styles.muted}>자동화 상태 확인 중</Text>
        </View>
      ) : null}

      {!authenticated ? <Text style={styles.message}>로그인 후 통합 자동화를 설정할 수 있어요.</Text> : null}

      {automation && draft && route === 'dashboard' ? (
        <UnifiedAutomationDashboard
          automation={automation}
          busy={saving}
          onChangeState={(action) => { void changeState(action); }}
          onOpenCaptcha={onOpenCaptcha}
          onOpenSettings={() => setRoute('settings')}
        />
      ) : null}

      {draft && route === 'settings' ? (
        <>
          <UnifiedAutomationSettings
            settings={draft}
            onOpen={setRoute}
            onToggle={toggleModule}
          />
          <View style={styles.advancedCard}>
            <Text style={styles.advancedTitle}>고급 설정</Text>
            <Text style={styles.muted}>서버 장애 후 자동 복구와 계정별 순차 실행은 항상 적용돼요.</Text>
          </View>
          <PrimaryButton label="설정 저장" loading={saving} onPress={() => { void saveSettings(); }} />
        </>
      ) : null}

      {draft && route !== 'dashboard' && route !== 'settings' ? (
        <>
          <UnifiedAutomationDetail
            route={route}
            settings={draft}
            categories={battleCategories}
            partyPresets={partyPresets}
            onChange={setDraft}
            onLoadMaps={onLoadBattleMaps}
          />
          <Pressable disabled={saving} onPress={() => setRoute('settings')} style={styles.doneButton}>
            <Save color={theme.colors.buttonText} size={17} />
            <Text style={styles.doneText}>선택 완료</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing.md },
  header: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 21, fontWeight: '900' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3 },
  iconButton: { alignItems: 'center', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  ruleCard: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 5, padding: theme.spacing.md },
  ruleTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800', marginBottom: 2 },
  ruleText: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  loadingBox: { alignItems: 'center', gap: 8, padding: theme.spacing.xl },
  message: { color: theme.colors.accentAmber, fontSize: 13, lineHeight: 19 },
  muted: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  advancedCard: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 4, padding: theme.spacing.md },
  advancedTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  doneButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.sm, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 46 },
  doneText: { color: theme.colors.buttonText, fontSize: 15, fontWeight: '800' },
});
