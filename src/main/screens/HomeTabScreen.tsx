import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Info } from 'lucide-react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';

import {
  buildCreateUnifiedModuleDraft,
  buildEditUnifiedModuleDraft,
  buildUnifiedModuleRequest,
  buildUpdateUnifiedModuleRequest,
  type UnifiedAutomationModuleDraft,
} from '../domain/unifiedAutomation';
import type { UnifiedAutomationController } from '../domain/unifiedAutomationController';
import { UnifiedAutomationDashboard } from '../features/automation/components/UnifiedAutomationDashboard';
import { UnifiedAutomationModuleEditor } from '../features/automation/components/UnifiedAutomationModuleEditor';
import { UnifiedAutomationSettings } from '../features/automation/components/UnifiedAutomationSettings';
import { theme } from '../styles/theme';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  PartyPresetResponse,
  UnifiedAutomationModuleResponse,
  UnifiedAutomationModuleType,
} from '../types/api';

type HomeTabScreenProps = {
  authenticated: boolean;
  battleCategories: BattleCategoryResponse[];
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  automationController: UnifiedAutomationController;
  onOpenCaptcha: () => void;
};

type HomeRoute = 'dashboard' | 'settings' | 'editor';

/**
 * 공유 자동화 store를 구독하고 대시보드·설정·편집 화면을 전환하는 홈 화면이다.
 *
 * 모듈 요청과 큐는 App이 소유한 `UnifiedAutomationController`에 남으므로 탭 전환으로 이 컴포넌트가
 * unmount돼도 중단되지 않는다. 화면에는 저장 전 편집 초안과 현재 하위 경로만 로컬 state로 둔다.
 */
export function HomeTabScreen({
  authenticated,
  battleCategories,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onListPartyPresets,
  automationController,
  onOpenCaptcha,
}: HomeTabScreenProps) {
  const [route, setRoute] = useState<HomeRoute>('dashboard');
  const [editorDraft, setEditorDraft] = useState<UnifiedAutomationModuleDraft | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const {
    automation,
    loading,
    actionSaving,
    editorSaving,
    savingModuleIds,
    reordering,
    message,
  } = useSyncExternalStore(
    automationController.subscribe,
    automationController.getSnapshot,
    automationController.getSnapshot,
  );

  useEffect(() => {
    if (authenticated) void automationController.load();
    else automationController.reset();
  }, [authenticated, automationController]);

  function startCreate(type: UnifiedAutomationModuleType) {
    if (!automation) return;
    setEditorDraft(buildCreateUnifiedModuleDraft(type, automation.modules));
    automationController.clearMessage();
    setRoute('editor');
  }

  function startEdit(module: UnifiedAutomationModuleResponse) {
    if (automationController.isModuleBusy(module.id)) {
      automationController.showMessage('이 자동화를 저장하고 있어요. 완료된 뒤 다시 열어 주세요.');
      return;
    }
    setEditorDraft(buildEditUnifiedModuleDraft(module));
    automationController.clearMessage();
    setRoute('editor');
  }

  function openModule(moduleId: number) {
    const module = automation?.modules.find((candidate) => candidate.id === moduleId);
    if (module) startEdit(module);
  }

  async function saveModule(draft: UnifiedAutomationModuleDraft) {
    const saved = draft.moduleId == null
      ? await automationController.createModule(buildUnifiedModuleRequest(draft))
      : await automationController.updateModule(
        draft.moduleId,
        buildUpdateUnifiedModuleRequest(draft),
      );
    if (!saved) return;
    setEditorDraft(null);
    setRoute('settings');
  }

  async function deleteModule(moduleId: number) {
    if (!await automationController.deleteModule(moduleId)) return;
    setEditorDraft(null);
    setRoute('settings');
  }

  function reorderModules(modules: UnifiedAutomationModuleResponse[]) {
    automationController.reorderModules(modules);
  }

  function deleteEditedModule() {
    const moduleId = editorDraft?.moduleId;
    return moduleId == null ? null : () => deleteModule(moduleId);
  }

  const showPageHeader = route !== 'editor';
  return (
    <NestableScrollContainer
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.scroller}
    >
      {showPageHeader ? (
        <View style={styles.header}>
          {route === 'settings' ? (
            <Pressable accessibilityLabel="통합 자동화로" onPress={() => setRoute('dashboard')} style={styles.iconButton}>
              <ArrowLeft color={theme.colors.text} size={20} />
            </Pressable>
          ) : null}
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{route === 'dashboard' ? '통합 자동화' : '자동화 설정'}</Text>
            <Text style={styles.subtitle}>{route === 'dashboard' ? '앱을 닫아도 서버에서 계속 진행돼요' : '필요한 항목만 추가하고 드래그로 우선순위를 정하세요'}</Text>
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
      ) : null}

      {showPageHeader && rulesOpen ? (
        <View style={styles.ruleBand}>
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
          busy={actionSaving}
          onChangeState={(action) => { void automationController.changeState(action); }}
          onOpenCaptcha={onOpenCaptcha}
          onOpenModule={openModule}
          onOpenSettings={() => setRoute('settings')}
        />
      ) : null}

      {automation && route === 'settings' ? (
        <UnifiedAutomationSettings
          modules={automation.modules}
          reordering={reordering}
          savingModuleIds={savingModuleIds}
          onAdd={startCreate}
          onEdit={startEdit}
          onReorder={reorderModules}
          onToggle={(module) => { void automationController.toggleModule(module); }}
        />
      ) : null}

      {automation && route === 'editor' && editorDraft ? (
        <UnifiedAutomationModuleEditor
          key={`${editorDraft.moduleId ?? 'new'}:${editorDraft.moduleType}`}
          battleCategories={battleCategories}
          initialDraft={editorDraft}
          saving={editorSaving}
          onBack={() => {
            setEditorDraft(null);
            automationController.clearMessage();
            setRoute('settings');
          }}
          onDelete={deleteEditedModule()}
          onListPartyPresets={onListPartyPresets}
          onLoadBattleCategories={onLoadBattleCategories}
          onLoadBattleMaps={onLoadBattleMaps}
          onSave={saveModule}
        />
      ) : null}
    </NestableScrollContainer>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1 },
  container: { gap: theme.spacing.md, padding: theme.spacing.lg, paddingBottom: theme.spacing.xl },
  header: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 21, fontWeight: '900' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3 },
  iconButton: { alignItems: 'center', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  ruleBand: { borderBottomColor: theme.colors.border, borderBottomWidth: 1, gap: 5, paddingBottom: theme.spacing.md },
  ruleTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800', marginBottom: 2 },
  ruleText: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  loadingBox: { alignItems: 'center', gap: 8, padding: theme.spacing.xl },
  message: { borderLeftColor: theme.colors.accentAmber, borderLeftWidth: 3, color: theme.colors.text, fontSize: 13, lineHeight: 19, paddingLeft: theme.spacing.sm },
  muted: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
});
