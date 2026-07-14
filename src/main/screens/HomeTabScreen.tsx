import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Info } from 'lucide-react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';

import {
  buildCreateUnifiedModuleDraft,
  buildEditUnifiedModuleDraft,
  buildToggleUnifiedModuleRequest,
  buildUnifiedModuleRequest,
  buildUpdateUnifiedModuleRequest,
  type UnifiedAutomationModuleDraft,
} from '../domain/unifiedAutomation';
import {
  appendUnifiedAutomationModule,
  normalizeUnifiedAutomationPriorities,
  removeUnifiedAutomationModule,
  replaceUnifiedAutomationModule,
} from '../domain/unifiedAutomationCollection';
import {
  UnifiedAutomationListCoordinator,
  UnifiedAutomationModuleMutationCoordinator,
} from '../domain/unifiedAutomationOperations';
import { UnifiedAutomationReorderQueue } from '../domain/unifiedAutomationReorder';
import { toUserFacingErrorMessage } from '../domain/userFacingErrors';
import { UnifiedAutomationDashboard } from '../features/automation/components/UnifiedAutomationDashboard';
import { UnifiedAutomationModuleEditor } from '../features/automation/components/UnifiedAutomationModuleEditor';
import { UnifiedAutomationSettings } from '../features/automation/components/UnifiedAutomationSettings';
import { theme } from '../styles/theme';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  CreateUnifiedAutomationModuleRequest,
  PartyPresetResponse,
  UnifiedAutomationAction,
  UnifiedAutomationModuleResponse,
  UnifiedAutomationModuleType,
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

type HomeRoute = 'dashboard' | 'settings' | 'editor';
const NEW_MODULE_OPERATION_ID = -1;

/**
 * 통합 자동화 상태 조회, 사용자 구성 CRUD와 optimistic 우선순위 저장을 조정하는 홈 화면이다.
 *
 * 목록 드롭은 즉시 로컬 상태에 반영하고 `UnifiedAutomationReorderQueue`가 마지막 순서를 직렬 저장한다.
 * 모듈 편집은 로컬 초안에서 끝낸 뒤 저장 시점에만 POST 또는 PUT을 호출한다.
 */
export function HomeTabScreen({
  authenticated,
  battleCategories,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onListPartyPresets,
  onGetUnifiedAutomation,
  onCreateUnifiedAutomationModule,
  onUpdateUnifiedAutomationModule,
  onDeleteUnifiedAutomationModule,
  onReorderUnifiedAutomationModules,
  onChangeUnifiedAutomationState,
  onOpenCaptcha,
}: HomeTabScreenProps) {
  const [route, setRoute] = useState<HomeRoute>('dashboard');
  const [automation, setAutomation] = useState<UnifiedAutomationStatusResponse | null>(null);
  const [editorDraft, setEditorDraft] = useState<UnifiedAutomationModuleDraft | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionSaving, setActionSaving] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [savingModuleIds, setSavingModuleIds] = useState<number[]>([]);
  const [reordering, setReordering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const automationRef = useRef<UnifiedAutomationStatusResponse | null>(null);

  const listCoordinatorRef = useRef<UnifiedAutomationListCoordinator | null>(null);
  if (listCoordinatorRef.current == null) {
    listCoordinatorRef.current = new UnifiedAutomationListCoordinator();
  }
  const mutationCoordinatorRef = useRef<UnifiedAutomationModuleMutationCoordinator | null>(null);
  if (mutationCoordinatorRef.current == null) {
    mutationCoordinatorRef.current = new UnifiedAutomationModuleMutationCoordinator();
  }

  // 큐 인스턴스는 렌더 사이에 유지하되 최신 API callback은 ref를 통해 읽는다.
  const reorderRequestRef = useRef(onReorderUnifiedAutomationModules);
  const reloadRequestRef = useRef(onGetUnifiedAutomation);
  reorderRequestRef.current = onReorderUnifiedAutomationModules;
  reloadRequestRef.current = onGetUnifiedAutomation;

  const reorderQueueRef = useRef<UnifiedAutomationReorderQueue<UnifiedAutomationStatusResponse> | null>(null);
  if (reorderQueueRef.current == null) {
    reorderQueueRef.current = new UnifiedAutomationReorderQueue(
      (moduleIds) => reorderRequestRef.current(moduleIds),
      (serverState) => {
        applyAutomation(listCoordinatorRef.current!.mergeReorderSuccess(
          automationRef.current,
          serverState,
        ));
        setReordering(false);
      },
      async () => {
        setReordering(false);
        setMessage('순서를 저장하지 못해 이전 순서로 되돌렸어요. 저장된 상태를 다시 확인하고 있어요.');
        const current = automationRef.current;
        if (current) {
          const refreshed = await listCoordinatorRef.current!.rollbackAndReload(
            current,
            applyAutomation,
            () => reloadRequestRef.current(),
            () => automationRef.current ?? current,
          );
          if (!refreshed) {
            setMessage('순서를 저장하지 못해 이전 순서로 되돌렸어요. 잠시 후 다시 시도해 주세요.');
          }
        }
      },
      (_serverState, moduleIds) => {
        listCoordinatorRef.current!.recordConfirmedOrder(moduleIds);
      },
    );
  }

  /** React 렌더 전에도 비동기 응답이 항상 최신 목록을 읽도록 state와 ref를 함께 갱신한다. */
  function applyAutomation(next: UnifiedAutomationStatusResponse | null) {
    automationRef.current = next;
    setAutomation(next);
  }

  /** 생성·수정·삭제 결과를 가장 최근 목록에 동기적으로 합친다. */
  function updateAutomation(
    transform: (
      current: UnifiedAutomationStatusResponse | null,
    ) => UnifiedAutomationStatusResponse | null,
  ) {
    applyAutomation(transform(automationRef.current));
  }

  const loadAutomation = useCallback(async () => {
    if (!authenticated) {
      applyAutomation(null);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const loaded = await onGetUnifiedAutomation();
      listCoordinatorRef.current!.recordAuthoritativeState(loaded);
      applyAutomation(loaded);
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
    setActionSaving(true);
    setMessage(null);
    try {
      const updated = await onChangeUnifiedAutomationState(action);
      listCoordinatorRef.current!.recordAuthoritativeState(updated);
      applyAutomation(updated);
    } catch (error) {
      setMessage(toUserFacingErrorMessage(error));
    } finally {
      setActionSaving(false);
    }
  }

  /** 해당 행만 저장 상태로 표시하고 다른 모듈 조작은 유지한다. */
  async function toggleModule(module: UnifiedAutomationModuleResponse) {
    const task = mutationCoordinatorRef.current!.runExclusive(module.id, async () => {
      setSavingModuleIds((ids) => [...ids, module.id]);
      setMessage(null);
      try {
        const updated = await onUpdateUnifiedAutomationModule(
          module.id,
          buildToggleUnifiedModuleRequest(module),
        );
        updateAutomation((current) => replaceUnifiedAutomationModule(current, updated));
      } catch (error) {
        setMessage(toUserFacingErrorMessage(error));
      } finally {
        setSavingModuleIds((ids) => ids.filter((id) => id !== module.id));
      }
    });
    if (task) {
      await task;
    }
  }

  function startCreate(type: UnifiedAutomationModuleType) {
    if (!automation) return;
    setEditorDraft(buildCreateUnifiedModuleDraft(type, automation.modules));
    setMessage(null);
    setRoute('editor');
  }

  function startEdit(module: UnifiedAutomationModuleResponse) {
    if (mutationCoordinatorRef.current!.isBusy(module.id)) {
      setMessage('이 자동화를 저장하고 있어요. 완료된 뒤 다시 열어 주세요.');
      return;
    }
    setEditorDraft(buildEditUnifiedModuleDraft(module));
    setMessage(null);
    setRoute('editor');
  }

  function openModule(moduleId: number) {
    const module = automation?.modules.find((candidate) => candidate.id === moduleId);
    if (module) startEdit(module);
  }

  async function saveModule(draft: UnifiedAutomationModuleDraft) {
    const operationId = draft.moduleId ?? NEW_MODULE_OPERATION_ID;
    const task = mutationCoordinatorRef.current!.runExclusive(operationId, async () => {
      setEditorSaving(true);
      setMessage(null);
      try {
        if (draft.moduleId == null) {
          const created = await onCreateUnifiedAutomationModule(buildUnifiedModuleRequest(draft));
          listCoordinatorRef.current!.recordCreated(created.id);
          updateAutomation((current) => appendUnifiedAutomationModule(current, created));
        } else {
          const updated = await onUpdateUnifiedAutomationModule(
            draft.moduleId,
            buildUpdateUnifiedModuleRequest(draft),
          );
          updateAutomation((current) => replaceUnifiedAutomationModule(current, updated));
        }
        setEditorDraft(null);
        setRoute('settings');
      } catch (error) {
        setMessage(toUserFacingErrorMessage(error));
      } finally {
        setEditorSaving(false);
      }
    });
    if (!task) {
      setMessage('이 자동화를 저장하고 있어요. 잠시만 기다려 주세요.');
      return;
    }
    await task;
  }

  async function deleteModule(moduleId: number) {
    const task = mutationCoordinatorRef.current!.runExclusive(moduleId, async () => {
      setEditorSaving(true);
      setMessage(null);
      try {
        await onDeleteUnifiedAutomationModule(moduleId);
        listCoordinatorRef.current!.recordDeleted(moduleId);
        updateAutomation((current) => removeUnifiedAutomationModule(current, moduleId));
        setEditorDraft(null);
        setRoute('settings');
      } catch (error) {
        setMessage(toUserFacingErrorMessage(error));
      } finally {
        setEditorSaving(false);
      }
    });
    if (!task) {
      setMessage('이 자동화를 저장하고 있어요. 잠시만 기다려 주세요.');
      return;
    }
    await task;
  }

  function reorderModules(modules: UnifiedAutomationModuleResponse[]) {
    const normalized = normalizeUnifiedAutomationPriorities(modules);
    updateAutomation((current) => current ? { ...current, modules: normalized } : current);
    setReordering(true);
    reorderQueueRef.current?.enqueue(normalized.map((module) => module.id));
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
          onChangeState={(action) => { void changeState(action); }}
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
          onToggle={(module) => { void toggleModule(module); }}
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
            setMessage(null);
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
