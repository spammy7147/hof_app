import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Info } from 'lucide-react-native';

import { UnifiedAutomationDashboard } from '../features/automation/components/UnifiedAutomationDashboard';
import { UnifiedAutomationSettings } from '../features/automation/components/UnifiedAutomationSettings';
import { toUserFacingErrorMessage } from '../domain/userFacingErrors';
import { theme } from '../styles/theme';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  CreateUnifiedAutomationModuleRequest,
  PartyPresetResponse,
  UnifiedAutomationAction,
  UnifiedAutomationModuleResponse,
  UnifiedAutomationStatusResponse,
  UpdateUnifiedAutomationModuleRequest,
} from '../types/api';

type HomeTabScreenProps = {
  authenticated: boolean;
  battleCategories: BattleCategoryResponse[];
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  onGetUnifiedAutomation: () => Promise<UnifiedAutomationStatusResponse>;
  onCreateUnifiedAutomationModule: (request: CreateUnifiedAutomationModuleRequest) => Promise<UnifiedAutomationModuleResponse>;
  onUpdateUnifiedAutomationModule: (moduleId: number, request: UpdateUnifiedAutomationModuleRequest) => Promise<UnifiedAutomationModuleResponse>;
  onDeleteUnifiedAutomationModule: (moduleId: number) => Promise<void>;
  onReorderUnifiedAutomationModules: (moduleIds: number[]) => Promise<UnifiedAutomationStatusResponse>;
  onChangeUnifiedAutomationState: (action: UnifiedAutomationAction) => Promise<UnifiedAutomationStatusResponse>;
  onOpenCaptcha: () => void;
};

type HomeRoute = 'dashboard' | 'settings';

/**
 * 계정별 통합 자동화 상태와 서버에 저장된 동적 모듈 목록을 보여준다.
 * 생성·삭제·정렬 callback도 이 화면까지 전달해 두며, 최종 편집/드래그 UI가 같은 계약을 그대로 사용한다.
 */
export function HomeTabScreen({
  authenticated,
  onGetUnifiedAutomation,
  onUpdateUnifiedAutomationModule,
  onChangeUnifiedAutomationState,
  onOpenCaptcha,
}: HomeTabScreenProps) {
  const [route, setRoute] = useState<HomeRoute>('dashboard');
  const [automation, setAutomation] = useState<UnifiedAutomationStatusResponse | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadAutomation = useCallback(async () => {
    if (!authenticated) {
      setAutomation(null);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      setAutomation(await onGetUnifiedAutomation());
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [authenticated, onGetUnifiedAutomation]);

  useEffect(() => {
    void loadAutomation();
  }, [loadAutomation]);

  async function changeState(action: UnifiedAutomationAction) {
    setSaving(true);
    setMessage(null);
    try {
      setAutomation(await onChangeUnifiedAutomationState(action));
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  /** 모듈 전체 설정을 유지한 채 enabled 값만 반전해 단일 모듈 PUT 요청을 보낸다. */
  async function toggleModule(module: UnifiedAutomationModuleResponse) {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await onUpdateUnifiedAutomationModule(module.id, {
        displayName: module.displayName,
        enabled: !module.enabled,
        thresholdPercent: module.thresholdPercent,
        maps: module.maps,
        quests: module.quests,
      });
      setAutomation((current) => current ? {
        ...current,
        modules: current.modules.map((saved) => saved.id === updated.id ? updated : saved),
      } : current);
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.stack}>
      <View style={styles.header}>
        {route === 'settings' ? (
          <Pressable accessibilityLabel="이전 화면" onPress={() => setRoute('dashboard')} style={styles.iconButton}>
            <ArrowLeft color={theme.colors.text} size={20} />
          </Pressable>
        ) : null}
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{route === 'dashboard' ? '통합 자동화' : '자동화 설정'}</Text>
          <Text style={styles.subtitle}>{route === 'dashboard' ? '앱을 닫아도 서버에서 계속 진행돼요' : '저장된 모듈을 확인하고 사용할 항목을 선택하세요'}</Text>
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
          <Text style={styles.ruleTitle}>실행 규칙</Text>
          <Text style={styles.ruleText}>사용 중인 모듈을 위에서부터 우선순위대로 확인해요.</Text>
          <Text style={styles.ruleText}>현재 전투 중 설정을 바꾸면 다음 작업을 고를 때부터 적용돼요.</Text>
          <Text style={styles.ruleText}>캡차 인증이 필요해요 상태에서는 인증 후 자동화를 이어가요.</Text>
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

      {automation && route === 'dashboard' ? (
        <UnifiedAutomationDashboard
          automation={automation}
          busy={saving}
          onChangeState={(action) => { void changeState(action); }}
          onOpenCaptcha={onOpenCaptcha}
          onOpenSettings={() => setRoute('settings')}
        />
      ) : null}

      {automation && route === 'settings' ? (
        <UnifiedAutomationSettings
          modules={automation.modules}
          busy={saving}
          onToggle={(module) => { void toggleModule(module); }}
        />
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
});
