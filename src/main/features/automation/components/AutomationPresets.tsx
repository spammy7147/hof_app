import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronRight, Copy, FolderOpen, Pause, Plus, RefreshCw, Save, Trash2 } from 'lucide-react-native';
import { FixedBottomAction } from '../../../components/FixedBottomAction';
import { AppAlert } from '../../../platform/AppAlert';
import { theme } from '../../../styles/theme';
import type { AutomationPresetEditor } from '../../../domain/automationPresetEditor';
import type { AutomationPresetResponse, TypedAutomationRuntimeResponse } from '../../../types/api';

type Props = {
  children?: ReactNode;
  editor: AutomationPresetEditor;
  lifecycle: TypedAutomationRuntimeResponse['lifecycle'];
  onRefresh: () => void;
  onPause: () => void;
  onDeleted: () => void;
};

const lifecycleLabels = { RUNNING: '실행 중', DRAINING: '일시정지 중', PAUSED: '일시정지', STOPPED: '정지' };

export function AutomationPresets({ editor, lifecycle, onRefresh, onOpen }: {
  editor: AutomationPresetEditor;
  lifecycle: Props['lifecycle'];
  onRefresh: () => void;
  onOpen: (id: number | null, name?: string) => void;
}) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = state.busy || !state.loaded;
  const remove = (preset: AutomationPresetResponse) => AppAlert.alert('프리셋을 삭제할까요?',
    `「${preset.name}」의 저장본을 삭제합니다. 현재 실행 중인 자동화 설정은 그대로 유지됩니다.`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => { if (mounted.current) void editor.remove(preset.id); } },
    ]);
  return (
    <View style={styles.panel}>
      <View style={styles.appliedCard}>
        <View style={styles.row}>
          <View style={styles.copy}>
            <Text style={styles.helper}>현재 적용 중인 구성</Text>
            <Text style={styles.appliedName}>{state.loaded ? state.applied?.name ?? '직접 설정한 구성' : '불러오는 중…'}</Text>
          </View>
          <Text style={[styles.runtimeBadge, lifecycle === 'RUNNING' && styles.runningBadge]}>{lifecycleLabels[lifecycle]}</Text>
        </View>
        {state.applied && !state.applied.matchesCurrent ? <Text style={styles.warning}>적용 후 설정이 변경되어 저장본과 달라요.</Text> : null}
      </View>
      <View style={styles.section}>
        <View style={styles.row}>
          <Text accessibilityRole="header" style={[styles.title, styles.copy]}>내 프리셋</Text>
          <Text style={styles.helper}>{state.presets.length}/10개 저장</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="자동화 프리셋 새로고침" disabled={state.busy}
            onPress={onRefresh} style={({ pressed }) => [styles.iconButton, state.busy && styles.disabled, pressed && styles.pressed]}>
            <RefreshCw color={theme.colors.textMuted} size={18} />
          </Pressable>
        </View>
        {!state.loaded && !state.error ? <ActivityIndicator accessibilityLabel="프리셋 목록 불러오는 중" color={theme.colors.accentGreen} /> : null}
        {state.loaded && state.presets.length === 0 ? <Pressable accessibilityRole="button" accessibilityLabel="기본 프리셋 설정"
          accessibilityHint="현재 자동화 구성을 기본 프리셋으로 편집합니다" disabled={disabled} onPress={() => onOpen(null, '기본')}
          style={({ pressed }) => [styles.presetCard, disabled && styles.disabled, pressed && styles.pressed]}>
          <View style={styles.presetIcon}><FolderOpen color={theme.colors.accentGreen} size={21} /></View>
          <View style={styles.copy}><Text style={styles.name}>기본</Text><Text style={styles.helper}>저장 전 · 현재 구성으로 시작해요</Text></View>
          <ChevronRight color={theme.colors.textMuted} size={20} />
        </Pressable> : null}
        {state.presets.map(preset => <View key={preset.id} style={styles.presetRow}>
          <Pressable accessibilityRole="button"
          accessibilityLabel={preset.name + ' 프리셋 설정'} accessibilityHint="프리셋의 자동화 항목을 설정합니다"
          disabled={disabled} onPress={() => onOpen(preset.id)}
          style={({ pressed }) => [styles.presetCard, styles.copy, disabled && styles.disabled, pressed && styles.pressed]}>
          <View style={styles.presetIcon}><FolderOpen color={theme.colors.accentGreen} size={21} /></View>
          <View style={styles.copy}>
            <Text numberOfLines={2} style={styles.name}>{preset.name}</Text>
            <Text style={styles.helper}>{preset.entryCount}개 자동화 항목</Text>
          </View>
          {state.applied?.id === preset.id ? <Text style={styles.link}>{state.applied.matchesCurrent ? '현재 적용' : '적용 후 변경'}</Text> : null}
          <ChevronRight color={theme.colors.textMuted} size={20} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={preset.name + ' 프리셋 삭제'} disabled={disabled}
            onPress={() => remove(preset)} style={({ pressed }) => [styles.iconButton, disabled && styles.disabled, pressed && styles.pressed]}>
            <Trash2 color={theme.colors.danger} size={18} />
          </Pressable>
        </View>)}
        <Pressable accessibilityRole="button" accessibilityLabel="현재 설정으로 새 프리셋 만들기"
          disabled={disabled || state.presets.length >= 10} onPress={() => onOpen(null)}
          style={({ pressed }) => [styles.newPresetButton, (disabled || state.presets.length >= 10) && styles.disabled, pressed && styles.pressed]}>
          <Plus color={theme.colors.accentGreen} size={17} /><Text style={styles.link}>새 프리셋 만들기</Text>
        </Pressable>
        <Text style={styles.helper}>{state.presets.length >= 10 ? '프리셋은 최대 10개까지 저장할 수 있어요.' : '새 프리셋은 현재 적용 중인 구성을 복사해 만들어요.'}</Text>
      </View>
      {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
      {state.message ? <Text accessibilityLiveRegion="polite" style={styles.helper}>{state.message}</Text> : null}
    </View>
  );
}

export function AutomationPresetDetail({ editor, lifecycle, onRefresh, onPause, onDeleted, children }: Props) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const draft = useSyncExternalStore(editor.draft.subscribe, editor.draft.getSnapshot, editor.draft.getSnapshot);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [copyName, setCopyName] = useState<string | null>(null);
  const busy = state.busy || draft.reordering || draft.savingEntryIds.length > 0 || draft.savingTypes.length > 0;
  const canApplyLive = lifecycle === 'RUNNING' && editor.canApplyWhileRunning();
  const canApply = lifecycle === 'PAUSED' || lifecycle === 'STOPPED' || canApplyLive;
  const canSave = !busy && state.loaded && state.name.trim().length > 0 && (state.selectedId != null || state.presets.length < 10);
  const saveLabel = state.selectedId == null ? '새 프리셋 저장' : '변경사항 저장';
  const applyDisabled = !canSave || !canApply;
  const apply = () => {
    AppAlert.alert('프리셋을 자동화에 적용할까요?',
      canApplyLive ? `「${state.name.trim()}」의 항목 켜기·끄기를 실행 중인 자동화에 반영합니다. 진행 중인 행동은 마무리하고 다음 판단부터 반영해요.`
        : `「${state.name.trim()}」의 모든 항목·판단 순서·맵 설정으로 현재 구성을 교체합니다. 적용 후 자동화를 직접 시작하거나 재개해 주세요.`, [
        { text: '취소', style: 'cancel' },
        { text: '적용', onPress: () => { if (mounted.current) void editor.apply(); } },
      ]);
  };
  const remove = async () => {
    if (!mounted.current) return;
    if (await editor.remove() && mounted.current) onDeleted();
  };
  const saveCopy = async () => {
    if (copyName == null) return;
    if (await editor.save(true, copyName) && mounted.current) setCopyName(null);
  };
  return (
    <View style={styles.panel}>
      <View style={styles.nameField}>
        <View style={styles.row}>
          <Text style={styles.label}>프리셋 이름</Text>
          <Text style={[styles.saveState, state.dirty && styles.warning]}>{state.dirty ? '저장하지 않은 변경사항' : state.selectedId == null ? '새 프리셋' : '저장됨'}</Text>
        </View>
        <TextInput accessibilityLabel="자동화 프리셋 이름" editable={!busy} maxLength={100} value={state.name}
          onChangeText={name => editor.setName(name)} placeholder="예: 일상 루틴, 사냥 중심"
          placeholderTextColor={theme.colors.textMuted} style={styles.input} />
      </View>

      {state.selectedId != null ? <View style={styles.manageActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="다른 이름으로 프리셋 전체 저장"
          disabled={busy || state.presets.length >= 10} onPress={() => setCopyName('')}
          style={({ pressed }) => [styles.manageButton, (busy || state.presets.length >= 10) && styles.disabled, pressed && styles.pressed]}>
          <Copy color={theme.colors.textMuted} size={16} /><Text style={styles.helper}>다른 이름으로 저장</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="선택한 자동화 프리셋 삭제"
          disabled={busy} style={({ pressed }) => [styles.manageButton, busy && styles.disabled, pressed && styles.pressed]}
          onPress={() => AppAlert.alert('저장한 프리셋을 삭제할까요?',
            '이 프리셋의 저장본과 편집 중인 초안을 정리합니다. 현재 실행 설정은 유지됩니다.', [
              { text: '취소', style: 'cancel' },
              { text: '삭제', style: 'destructive', onPress: () => { void remove(); } },
            ])}>
          <Trash2 color={theme.colors.danger} size={16} /><Text style={styles.deleteText}>삭제</Text>
        </Pressable>
      </View> : null}

      {children}

      {copyName != null ? <Modal transparent visible animationType="fade" onRequestClose={() => { if (!busy) setCopyName(null); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View accessibilityViewIsModal style={styles.copyDialog}>
            <Text accessibilityRole="header" style={styles.title}>다른 이름으로 저장</Text>
            <Text style={styles.helper}>편집한 구성을 새 프리셋으로 저장해요. 기존 프리셋은 그대로 유지돼요.</Text>
            <TextInput autoFocus accessibilityLabel="새 프리셋 이름" placeholder="새 프리셋 이름" placeholderTextColor={theme.colors.textMuted}
              maxLength={100} editable={!busy} value={copyName} onChangeText={setCopyName} style={styles.input} />
            {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel="다른 이름으로 저장 취소" disabled={busy} onPress={() => setCopyName(null)}
                style={[styles.button, styles.saveButton]}><Text style={styles.buttonText}>취소</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="새 이름으로 저장" disabled={busy || !copyName.trim()}
                onPress={() => { void saveCopy(); }} style={[styles.button, styles.applyButton, (busy || !copyName.trim()) && styles.disabled]}>
                <Text style={styles.applyText}>새 이름으로 저장</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal> : null}

      <FixedBottomAction>
        <View style={styles.footer}>
          {state.busy ? <View style={styles.feedback}><ActivityIndicator accessibilityLabel="프리셋 처리 중" color={theme.colors.accentGreen} size="small" /><Text style={styles.helper}>프리셋 처리 중…</Text></View> : null}
          {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
          {state.message && !state.dirty ? <Text accessibilityLiveRegion="polite" style={styles.helper}>{state.message}</Text> : null}
          <View style={styles.footerHint}>
            <Text style={[styles.helper, styles.copy]}>{canApplyLive ? '항목 켜기·끄기는 자동화를 멈추지 않고 반영할 수 있어요.'
              : lifecycle === 'RUNNING' ? '저장은 실행 중에도 가능해요. 구성 전체 교체는 일시정지 후 적용해 주세요.'
              : lifecycle === 'DRAINING' ? '진행 중인 행동을 마무리하고 있어요. 잠시 후 새로고침해 주세요.'
              : !state.name.trim() ? '이름을 입력하고 ‘새 프리셋 저장’을 눌러 주세요.' : '저장 후 자동화에 적용하면 실행 설정이 바뀌어요.'}</Text>
            {lifecycle === 'RUNNING' && !canApplyLive ? <Pressable accessibilityRole="button" accessibilityLabel="자동화 일시정지" disabled={busy}
              onPress={onPause} style={({ pressed }) => [styles.pauseButton, busy && styles.disabled, pressed && styles.pressed]}>
              <Pause color={theme.colors.accentGreen} size={14} /><Text style={styles.link}>일시정지</Text>
            </Pressable> : null}
            {lifecycle === 'DRAINING' ? <Pressable accessibilityRole="button" accessibilityLabel="자동화 실행 상태 새로고침" disabled={busy}
              onPress={onRefresh} style={({ pressed }) => [styles.pauseButton, busy && styles.disabled, pressed && styles.pressed]}>
              <RefreshCw color={theme.colors.accentGreen} size={14} /><Text style={styles.link}>상태 확인</Text>
            </Pressable> : null}
          </View>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={saveLabel} disabled={!canSave}
              onPress={() => { void editor.save(); }} style={({ pressed }) => [styles.button, styles.saveButton, !canSave && styles.disabled, pressed && styles.pressed]}>
              <Save color={theme.colors.text} size={17} /><Text style={styles.buttonText}>{saveLabel}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="자동화에 전체 적용" disabled={applyDisabled}
              onPress={apply} style={({ pressed }) => [styles.button, styles.applyButton, applyDisabled && styles.disabled, pressed && styles.pressed]}>
              <Text style={styles.applyText}>{state.dirty || state.selectedId == null ? '저장하고 적용' : '자동화에 적용'}</Text>
            </Pressable>
          </View>
        </View>
      </FixedBottomAction>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: theme.spacing.lg },
  appliedCard: { gap: theme.spacing.xs, borderLeftColor: theme.colors.accentGreen, borderLeftWidth: 3, borderRadius: theme.radius.md, backgroundColor: theme.colors.header, padding: theme.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  appliedName: { color: theme.colors.text, fontSize: theme.fontSize.section, lineHeight: theme.lineHeight.section, fontWeight: '800' },
  runtimeBadge: { color: theme.colors.textMuted, backgroundColor: theme.colors.surfaceAlt, fontSize: theme.fontSize.caption, fontWeight: '700', paddingHorizontal: theme.spacing.xs, paddingVertical: theme.spacing.hairline, borderRadius: theme.radius.md, overflow: 'hidden' },
  runningBadge: { color: theme.colors.accentGreen },
  section: { gap: theme.spacing.sm },
  title: { color: theme.colors.text, fontSize: theme.fontSize.section, fontWeight: '800' },
  helper: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption },
  label: { color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: '700' },
  nameField: { gap: theme.spacing.sm, marginTop: theme.spacing.xs },
  saveState: { flexShrink: 1, color: theme.colors.textMuted, fontSize: theme.fontSize.caption, textAlign: 'right' },
  input: { backgroundColor: theme.colors.header, borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.md, color: theme.colors.text, fontSize: theme.fontSize.body, minHeight: theme.control.input, padding: theme.spacing.lg, minWidth: theme.control.touch, },
  iconButton: { alignItems: 'center', justifyContent: 'center', minHeight: theme.control.touch, width: 44, borderRadius: theme.radius.md, minWidth: theme.control.touch, },
  link: { color: theme.colors.accentGreen, fontSize: theme.fontSize.caption, fontWeight: '700' },
  name: { color: theme.colors.text, fontSize: theme.fontSize.body, lineHeight: theme.lineHeight.body, fontWeight: '700' },
  presetCard: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, minHeight: theme.control.input, padding: theme.spacing.md, backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.md, minWidth: theme.control.touch, },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  presetIcon: { alignItems: 'center', justifyContent: 'center', width: theme.icon.preset, height: theme.icon.preset, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt },
  newPresetButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs, minHeight: theme.control.touch, borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.sm, minWidth: theme.control.touch, },
  manageActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.spacing.sm },
  manageButton: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, minHeight: theme.control.touch, paddingHorizontal: theme.spacing.sm, minWidth: theme.control.touch, },
  deleteText: { color: theme.colors.danger, fontSize: theme.fontSize.caption },
  modalOverlay: { flex: 1, justifyContent: 'center', padding: theme.spacing.lg, backgroundColor: theme.colors.overlay },
  copyDialog: { gap: theme.spacing.md, padding: theme.spacing.lg, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface, width: '100%', maxWidth: 480, alignSelf: 'center' },
  footer: { gap: theme.spacing.sm },
  footerHint: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap', },
  pauseButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.hairline, minHeight: theme.control.touch, paddingHorizontal: theme.spacing.sm, minWidth: theme.control.touch, },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  actions: { flexDirection: 'row', gap: theme.spacing.sm },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs, minHeight: theme.control.primary, padding: theme.spacing.lg, borderRadius: theme.radius.md, minWidth: theme.control.touch, },
  saveButton: { flex: 1, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.borderStrong },
  applyButton: { flex: 1, backgroundColor: theme.colors.accentGreen },
  buttonText: { color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: '700' },
  applyText: { color: theme.colors.buttonText, fontSize: theme.fontSize.body, fontWeight: '800' },
  warning: { color: theme.colors.accentAmber, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption },
  error: { color: theme.colors.danger, fontSize: theme.fontSize.body, lineHeight: theme.lineHeight.caption },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
