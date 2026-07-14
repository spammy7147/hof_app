import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Check,
  ChevronLeft,
  Minus,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react-native';

import {
  addUnifiedAutomationQuest,
  getUnifiedModuleCategoryIds,
  getUnifiedModuleTypeLabel,
  removeUnifiedAutomationQuest,
  setUnifiedAutomationMapPreset,
  setUnifiedAutomationQuestCode,
  setUnifiedAutomationQuestMaps,
  toggleUnifiedAutomationMap,
  validateUnifiedModuleDraft,
  type UnifiedAutomationModuleDraft,
} from '../../../domain/unifiedAutomation';
import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import { theme } from '../../../styles/theme';
import type {
  BattleCategoryResponse,
  BattleMapResponse,
  PartyPresetResponse,
} from '../../../types/api';
import { AutomationMapSettings } from './AutomationMapSettings';

type Props = {
  initialDraft: UnifiedAutomationModuleDraft;
  battleCategories: BattleCategoryResponse[];
  saving: boolean;
  onBack: () => void;
  onDelete: (() => Promise<void>) | null;
  onLoadBattleCategories: () => void;
  onLoadBattleMaps: (categoryId: string) => Promise<BattleMapResponse[]>;
  onListPartyPresets: () => Promise<PartyPresetResponse[]>;
  onSave: (draft: UnifiedAutomationModuleDraft) => Promise<void>;
};

const THRESHOLD_PRESETS = [80, 85, 90, 95] as const;

/**
 * 통합 자동화 모듈 한 개만 생성 또는 수정하는 화면이다.
 *
 * 편집 중인 값은 모두 로컬 초안에 남으며 저장 버튼을 누르기 전에는 백엔드를 변경하지 않는다.
 * 유형에 필요한 맵 카탈로그와 파티 프리셋만 지연 로드해 긴 목록의 초기 비용도 줄인다.
 */
export function UnifiedAutomationModuleEditor({
  initialDraft,
  battleCategories,
  saving,
  onBack,
  onDelete,
  onLoadBattleCategories,
  onLoadBattleMaps,
  onListPartyPresets,
  onSave,
}: Props) {
  const [draft, setDraft] = useState(initialDraft);
  const [mapsByCategory, setMapsByCategory] = useState<Record<string, BattleMapResponse[]>>({});
  const [partyPresets, setPartyPresets] = useState<PartyPresetResponse[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState(
    getUnifiedModuleCategoryIds(initialDraft.moduleType)[0] ?? '',
  );
  const [activeQuestIndex, setActiveQuestIndex] = useState(0);
  const [loadingResources, setLoadingResources] = useState(true);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const categoryIds = useMemo(
    () => getUnifiedModuleCategoryIds(draft.moduleType),
    [draft.moduleType],
  );
  const categoryKey = categoryIds.join('|');

  useEffect(() => {
    if (battleCategories.length === 0 && categoryIds.length > 0) onLoadBattleCategories();
  }, [battleCategories.length, categoryIds.length, onLoadBattleCategories]);

  useEffect(() => {
    let active = true;
    setLoadingResources(true);
    setResourceError(null);
    Promise.all([
      onListPartyPresets(),
      ...categoryIds.map(async (categoryId) => ({
        categoryId,
        maps: await onLoadBattleMaps(categoryId),
      })),
    ]).then(([presets, ...mapResults]) => {
      if (!active) return;
      setPartyPresets(presets as PartyPresetResponse[]);
      const nextMaps: Record<string, BattleMapResponse[]> = {};
      mapResults.forEach((result) => {
        const typed = result as { categoryId: string; maps: BattleMapResponse[] };
        nextMaps[typed.categoryId] = typed.maps;
      });
      setMapsByCategory(nextMaps);
    }).catch((error: unknown) => {
      if (active) setResourceError(toUserFacingErrorMessage(error));
    }).finally(() => {
      if (active) setLoadingResources(false);
    });
    return () => { active = false; };
  }, [categoryKey, onListPartyPresets, onLoadBattleMaps]);

  function updateDraft(nextDraft: UnifiedAutomationModuleDraft) {
    setDraft(nextDraft);
    setValidationErrors([]);
  }

  async function save() {
    const errors = validateUnifiedModuleDraft(draft);
    setValidationErrors(errors);
    if (errors.length > 0) return;
    await onSave(draft);
  }

  const moduleUsesMaps = draft.moduleType === 'TIME_BURN' ||
    draft.moduleType === 'COOLDOWN_ADVENTURE' ||
    draft.moduleType === 'DAILY_ADVENTURE';
  const activeQuest = draft.quests[activeQuestIndex] ?? null;

  return (
    <View style={styles.stack}>
      <View style={styles.editorHeader}>
        <Pressable accessibilityLabel="자동화 목록으로" onPress={onBack} style={styles.iconButton}>
          <ChevronLeft color={theme.colors.text} size={20} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{initialDraft.moduleId == null ? '자동화 추가' : '자동화 편집'}</Text>
          <Text style={styles.subtitle}>{getUnifiedModuleTypeLabel(draft.moduleType)}</Text>
        </View>
      </View>

      <Text style={styles.applyNotice}>저장한 변경은 진행 중인 전투를 끊지 않고 다음 작업부터 적용돼요.</Text>

      <Section title="기본 설정">
        <FieldLabel label="자동화 이름" />
        <TextInput
          editable={!saving}
          maxLength={50}
          onChangeText={(displayName) => updateDraft({ ...draft, displayName })}
          placeholder="자동화 이름"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.textInput}
          value={draft.displayName}
        />
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.fieldTitle}>사용</Text>
            <Text style={styles.fieldHelp}>끄면 순서는 유지하고 실행만 건너뛰어요.</Text>
          </View>
          <Switch
            disabled={saving}
            onValueChange={(enabled) => updateDraft({ ...draft, enabled })}
            thumbColor={draft.enabled ? theme.colors.buttonText : theme.colors.textMuted}
            trackColor={{ false: theme.colors.border, true: theme.colors.accentGreen }}
            value={draft.enabled}
          />
        </View>
      </Section>

      {draft.moduleType === 'TIME_BURN' ? (
        <Section title="Time 기준">
          <Text style={styles.fieldHelp}>최대 Time 대비 설정 비율 이상일 때 선택한 맵을 실행해요.</Text>
          <View style={styles.segmentRow}>
            {THRESHOLD_PRESETS.map((threshold) => (
              <Pressable
                key={threshold}
                onPress={() => updateDraft({ ...draft, thresholdPercent: threshold })}
                style={[styles.segment, draft.thresholdPercent === threshold && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, draft.thresholdPercent === threshold && styles.segmentTextActive]}>{threshold}%</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.stepperRow}>
            <Pressable
              accessibilityLabel="Time 기준 1% 줄이기"
              onPress={() => updateDraft({
                ...draft,
                thresholdPercent: Math.max(1, (draft.thresholdPercent ?? 90) - 1),
              })}
              style={styles.stepperButton}
            >
              <Minus color={theme.colors.text} size={17} />
            </Pressable>
            <Text style={styles.stepperValue}>{draft.thresholdPercent ?? 90}%</Text>
            <Pressable
              accessibilityLabel="Time 기준 1% 늘리기"
              onPress={() => updateDraft({
                ...draft,
                thresholdPercent: Math.min(100, (draft.thresholdPercent ?? 90) + 1),
              })}
              style={styles.stepperButton}
            >
              <Plus color={theme.colors.text} size={17} />
            </Pressable>
          </View>
        </Section>
      ) : null}

      {draft.moduleType === 'KEY_QUEST' || draft.moduleType === 'OTHER_QUEST' ? (
        <Section title="퀘스트">
          <View style={styles.sectionHeadingRow}>
            <Text style={styles.fieldHelp}>HOF에서 사용하는 퀘스트 코드를 입력하세요.</Text>
            <Pressable
              accessibilityLabel="퀘스트 추가"
              onPress={() => {
                const next = addUnifiedAutomationQuest(draft);
                updateDraft(next);
                setActiveQuestIndex(next.quests.length - 1);
              }}
              style={styles.smallCommand}
            >
              <Plus color={theme.colors.accentGreen} size={15} />
              <Text style={styles.smallCommandText}>추가</Text>
            </Pressable>
          </View>

          {draft.quests.length === 0 ? <Text style={styles.emptyText}>퀘스트를 한 개 이상 추가해 주세요.</Text> : null}

          {draft.moduleType === 'OTHER_QUEST' ? draft.quests.map((quest, index) => (
            <View key={`quest:${index}`} style={styles.questInputRow}>
              <TextInput
                editable={!saving}
                maxLength={100}
                onChangeText={(questCode) => updateDraft(setUnifiedAutomationQuestCode(draft, index, questCode))}
                placeholder="퀘스트 코드"
                placeholderTextColor={theme.colors.textMuted}
                style={[styles.textInput, styles.questInput]}
                value={quest.questCode}
              />
              <Pressable
                accessibilityLabel={`${index + 1}번째 퀘스트 삭제`}
                onPress={() => updateDraft(removeUnifiedAutomationQuest(draft, index))}
                style={styles.deleteIconButton}
              >
                <Trash2 color={theme.colors.danger} size={17} />
              </Pressable>
            </View>
          )) : (
            <>
              <View style={styles.questTabs}>
                {draft.quests.map((quest, index) => (
                  <Pressable
                    key={`quest-tab:${index}`}
                    onPress={() => setActiveQuestIndex(index)}
                    style={[styles.questTab, activeQuestIndex === index && styles.questTabActive]}
                  >
                    <Text numberOfLines={1} style={styles.questTabText}>{quest.questCode.trim() || `퀘스트 ${index + 1}`}</Text>
                  </Pressable>
                ))}
              </View>
              {activeQuest ? (
                <View style={styles.questEditor}>
                  <View style={styles.questInputRow}>
                    <TextInput
                      editable={!saving}
                      maxLength={100}
                      onChangeText={(questCode) => updateDraft(setUnifiedAutomationQuestCode(draft, activeQuestIndex, questCode))}
                      placeholder="퀘스트 코드"
                      placeholderTextColor={theme.colors.textMuted}
                      style={[styles.textInput, styles.questInput]}
                      value={activeQuest.questCode}
                    />
                    <Pressable
                      accessibilityLabel="현재 퀘스트 삭제"
                      onPress={() => {
                        updateDraft(removeUnifiedAutomationQuest(draft, activeQuestIndex));
                        setActiveQuestIndex(Math.max(0, activeQuestIndex - 1));
                      }}
                      style={styles.deleteIconButton}
                    >
                      <Trash2 color={theme.colors.danger} size={17} />
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </>
          )}
        </Section>
      ) : null}

      {(moduleUsesMaps || (draft.moduleType === 'KEY_QUEST' && activeQuest)) ? (
        <Section title={draft.moduleType === 'KEY_QUEST' ? '퀘스트 맵' : '실행 맵'}>
          <Text style={styles.fieldHelp}>선택한 맵마다 전투에 사용할 파티 프리셋을 지정하세요.</Text>
          {categoryIds.length > 1 ? (
            <View style={styles.segmentRow}>
              {categoryIds.map((categoryId) => (
                <Pressable
                  key={categoryId}
                  onPress={() => setActiveCategoryId(categoryId)}
                  style={[styles.categoryTab, activeCategoryId === categoryId && styles.categoryTabActive]}
                >
                  <Text style={[styles.categoryTabText, activeCategoryId === categoryId && styles.categoryTabTextActive]}>
                    {getCategoryLabel(categoryId, battleCategories)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {loadingResources ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={theme.colors.accentGreen} size="small" />
              <Text style={styles.fieldHelp}>맵과 프리셋 불러오는 중</Text>
            </View>
          ) : (
            <AutomationMapSettings
              categoryId={activeCategoryId}
              errorMessage={resourceError}
              loading={false}
              maps={mapsByCategory[activeCategoryId] ?? []}
              partyPresets={partyPresets}
              profileMaps={moduleUsesMaps ? draft.maps : activeQuest?.maps ?? []}
              saving={saving}
              onAssignPreset={(map, partyPresetId) => {
                if (moduleUsesMaps) {
                  updateDraft({
                    ...draft,
                    maps: setUnifiedAutomationMapPreset(draft.maps, map, partyPresetId),
                  });
                } else if (activeQuest) {
                  updateDraft(setUnifiedAutomationQuestMaps(
                    draft,
                    activeQuestIndex,
                    setUnifiedAutomationMapPreset(activeQuest.maps, map, partyPresetId),
                  ));
                }
              }}
              onToggleMap={(map) => {
                if (moduleUsesMaps) {
                  updateDraft({ ...draft, maps: toggleUnifiedAutomationMap(draft.maps, map) });
                } else if (activeQuest) {
                  updateDraft(setUnifiedAutomationQuestMaps(
                    draft,
                    activeQuestIndex,
                    toggleUnifiedAutomationMap(activeQuest.maps, map),
                  ));
                }
              }}
            />
          )}
        </Section>
      ) : null}

      {validationErrors.length > 0 ? (
        <View style={styles.validationBox}>
          {validationErrors.map((error) => <Text key={error} style={styles.validationText}>• {error}</Text>)}
        </View>
      ) : null}

      {deleteConfirmOpen ? (
        <View style={styles.deleteConfirm}>
          <View style={styles.deleteConfirmCopy}>
            <Text style={styles.deleteConfirmTitle}>정말 삭제할까요?</Text>
            <Text style={styles.fieldHelp}>진행 중인 작업은 끝까지 실행되고 다음 판단부터 제외돼요.</Text>
          </View>
          <Pressable onPress={() => setDeleteConfirmOpen(false)} style={styles.confirmIconButton}>
            <X color={theme.colors.text} size={17} />
          </Pressable>
          <Pressable disabled={saving} onPress={() => { if (onDelete) void onDelete(); }} style={styles.confirmDeleteButton}>
            <Check color={theme.colors.buttonText} size={17} />
            <Text style={styles.confirmDeleteText}>삭제</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.footerActions}>
        {onDelete ? (
          <Pressable
            disabled={saving}
            onPress={() => setDeleteConfirmOpen(true)}
            style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed, saving && styles.disabled]}
          >
            <Trash2 color={theme.colors.danger} size={17} />
            <Text style={styles.deleteButtonText}>삭제</Text>
          </Pressable>
        ) : null}
        <Pressable
          disabled={saving}
          onPress={() => { void save(); }}
          style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}
        >
          {saving ? <ActivityIndicator color={theme.colors.buttonText} size="small" /> : <Save color={theme.colors.buttonText} size={17} />}
          <Text style={styles.saveButtonText}>저장</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

function getCategoryLabel(categoryId: string, categories: BattleCategoryResponse[]): string {
  const category = categories.find((candidate) => candidate.id === categoryId);
  if (category) return category.label.replace('시나리오-대해', '시나리오');
  if (categoryId === 'battle_map') return '전투맵';
  if (categoryId === 'scenario_ocean') return '시나리오';
  if (categoryId === 'adventure_map') return '모험맵';
  return categoryId;
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing.md },
  editorHeader: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  iconButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 38 },
  headerCopy: { flex: 1 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800', marginTop: 2 },
  applyNotice: { borderLeftColor: theme.colors.accentBlue, borderLeftWidth: 3, color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: theme.spacing.sm, paddingVertical: 5 },
  section: { borderBottomColor: theme.colors.border, borderBottomWidth: 1, gap: theme.spacing.sm, paddingBottom: theme.spacing.md },
  sectionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '900' },
  sectionHeadingRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  fieldLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800' },
  fieldTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  fieldHelp: { color: theme.colors.textMuted, flexShrink: 1, fontSize: 12, lineHeight: 17 },
  textInput: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, fontSize: 14, fontWeight: '800', minHeight: 42, paddingHorizontal: theme.spacing.md },
  toggleRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.md, justifyContent: 'space-between' },
  toggleCopy: { flex: 1 },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  segment: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: 38, minWidth: 58, paddingHorizontal: theme.spacing.sm },
  segmentActive: { backgroundColor: theme.colors.accentGreen, borderColor: theme.colors.accentGreen },
  segmentText: { color: theme.colors.text, fontSize: 13, fontWeight: '900' },
  segmentTextActive: { color: theme.colors.buttonText },
  stepperRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.md },
  stepperButton: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, height: 36, justifyContent: 'center', width: 44 },
  stepperValue: { color: theme.colors.text, fontSize: 18, fontWeight: '900', minWidth: 62, textAlign: 'center' },
  smallCommand: { alignItems: 'center', borderColor: theme.colors.accentGreen, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', gap: 3, minHeight: 32, paddingHorizontal: theme.spacing.sm },
  smallCommandText: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '900' },
  emptyText: { color: theme.colors.textMuted, fontSize: 12, paddingVertical: theme.spacing.sm },
  questInputRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  questInput: { flex: 1 },
  deleteIconButton: { alignItems: 'center', borderColor: theme.colors.danger, borderRadius: theme.radius.sm, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  questTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  questTab: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, maxWidth: 150, minHeight: 34, paddingHorizontal: theme.spacing.sm, paddingVertical: 7 },
  questTabActive: { borderColor: theme.colors.accentGreen },
  questTabText: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  questEditor: { gap: theme.spacing.sm },
  categoryTab: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, minHeight: 38, paddingHorizontal: 13, paddingVertical: 9 },
  categoryTabActive: { borderColor: theme.colors.accentBlue },
  categoryTabText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '900' },
  categoryTabTextActive: { color: theme.colors.accentBlue },
  loadingRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 56, justifyContent: 'center' },
  validationBox: { borderColor: theme.colors.danger, borderRadius: theme.radius.sm, borderWidth: 1, gap: 3, padding: theme.spacing.sm },
  validationText: { color: theme.colors.danger, fontSize: 12, lineHeight: 18 },
  deleteConfirm: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.danger, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.sm },
  deleteConfirmCopy: { flex: 1 },
  deleteConfirmTitle: { color: theme.colors.danger, fontSize: 13, fontWeight: '900' },
  confirmIconButton: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  confirmDeleteButton: { alignItems: 'center', backgroundColor: theme.colors.danger, borderRadius: theme.radius.sm, flexDirection: 'row', gap: 4, minHeight: 36, paddingHorizontal: theme.spacing.sm },
  confirmDeleteText: { color: theme.colors.buttonText, fontSize: 12, fontWeight: '900' },
  footerActions: { flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'flex-end' },
  deleteButton: { alignItems: 'center', borderColor: theme.colors.danger, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', gap: 5, minHeight: 42, paddingHorizontal: theme.spacing.md },
  deleteButtonText: { color: theme.colors.danger, fontSize: 13, fontWeight: '900' },
  saveButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.sm, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', maxWidth: 220, minHeight: 42, paddingHorizontal: theme.spacing.md },
  saveButtonText: { color: theme.colors.buttonText, fontSize: 14, fontWeight: '900' },
  pressed: { opacity: 0.74 },
  disabled: { opacity: 0.45 },
});
