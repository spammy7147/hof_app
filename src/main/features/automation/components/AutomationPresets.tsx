import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, ChevronDown, Copy, FolderOpen, Pause, Plus, RefreshCw, Save, Trash2 } from 'lucide-react-native';
import { FixedBottomAction } from '../../../components/FixedBottomAction';
import { AppAlert } from '../../../platform/AppAlert';
import { theme } from '../../../styles/theme';
import type { AutomationPresetEditor } from '../../../domain/automationPresetEditor';
import type { TypedAutomationRuntimeResponse } from '../../../types/api';
import { confirmPresetNavigation } from '../confirmPresetNavigation';

type Props = {
  children?: ReactNode;
  editor: AutomationPresetEditor;
  lifecycle: TypedAutomationRuntimeResponse['lifecycle'];
  onRefresh: () => void;
  onPause: () => void;
};

const lifecycleLabels = { RUNNING: '실행 중', DRAINING: '일시정지 중', PAUSED: '일시정지', STOPPED: '정지' };

export function AutomationPresets({ editor, lifecycle, onRefresh, onPause, children }: Props) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const draft = useSyncExternalStore(editor.draft.subscribe, editor.draft.getSnapshot, editor.draft.getSnapshot);
  const [selecting, setSelecting] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = state.busy || draft.reordering || draft.savingEntryIds.length > 0 || draft.savingTypes.length > 0;
  const canApply = lifecycle === 'PAUSED' || lifecycle === 'STOPPED';
  const canSave = !busy && state.loaded && state.name.trim().length > 0;
  const saveLabel = state.selectedId == null ? '새 프리셋 저장' : '변경사항 저장';
  const loadDisabled = busy || !state.loaded || state.presets.length === 0;
  const applyDisabled = !canSave || !canApply;
  const selectedPreset = state.presets.find(preset => preset.id === state.selectedId);
  const apply = () => {
    AppAlert.alert('프리셋을 자동화에 적용할까요?',
      `「${state.name.trim()}」의 모든 항목·판단 순서·맵 설정으로 현재 구성을 교체합니다. 적용 후 자동화를 직접 시작하거나 재개해 주세요.`, [
        { text: '취소', style: 'cancel' },
        { text: '적용', onPress: () => { if (mounted.current) void editor.apply(); } },
      ]);
  };
  const select = (id: number | null) => confirmPresetNavigation(editor, () => {
    if (mounted.current) { setSelecting(false); void editor.select(id); }
  });

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
          <Text accessibilityRole="header" style={[styles.title, styles.copy]}>자동화 프리셋</Text>
          <Text style={styles.helper}>{state.presets.length}/10개 저장</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="자동화 프리셋 새로고침" disabled={busy}
            onPress={onRefresh} style={({ pressed }) => [styles.iconButton, busy && styles.disabled, pressed && styles.pressed]}>
            <RefreshCw color={theme.colors.textMuted} size={18} />
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="저장한 프리셋 불러오기"
          accessibilityState={{ expanded: selecting, disabled: loadDisabled }} disabled={loadDisabled}
          onPress={() => setSelecting(value => !value)}
          style={({ pressed }) => [styles.selector, selecting && styles.selectorOpen, loadDisabled && styles.disabled, pressed && styles.pressed]}>
          <View style={styles.presetIcon}><FolderOpen color={theme.colors.accentGreen} size={21} /></View>
          <View style={styles.copy}>
            <Text style={styles.name}>저장한 프리셋 불러오기</Text>
            <Text style={styles.helper}>{!state.loaded ? '목록을 불러오는 중…' : state.presets.length === 0
              ? '아직 저장한 프리셋이 없어요' : '저장한 이름을 선택해 구성을 불러와요'}</Text>
          </View>
          <ChevronDown color={theme.colors.textMuted} size={18} style={selecting ? styles.chevronOpen : undefined} />
        </Pressable>
        {selecting ? <View style={styles.options}>
          {state.presets.map(preset => <Pressable key={preset.id} accessibilityRole="button"
            accessibilityLabel={preset.name + ' 프리셋 불러오기'}
            accessibilityState={{ selected: state.selectedId === preset.id, disabled: busy }} disabled={busy}
            onPress={() => select(preset.id)} style={({ pressed }) => [styles.option, state.selectedId === preset.id && styles.optionSelected, pressed && styles.pressed]}>
            <View style={styles.copy}>
              <Text style={styles.name}>{preset.name}</Text>
              <Text style={styles.helper}>{preset.entryCount}개 항목{state.applied?.id === preset.id ? ' · 현재 적용' : ''}</Text>
            </View>
            <View style={styles.optionAction}>
              {state.selectedId === preset.id ? <Check color={theme.colors.accentGreen} size={16} /> : null}
              <Text style={styles.link}>{state.selectedId === preset.id ? '불러옴' : '불러오기'}</Text>
            </View>
          </Pressable>)}
        </View> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="현재 설정으로 새 프리셋 만들기"
          disabled={busy || !state.loaded} onPress={() => select(null)}
          style={({ pressed }) => [styles.newPresetButton, (busy || !state.loaded) && styles.disabled, pressed && styles.pressed]}>
          <Plus color={theme.colors.accentGreen} size={17} />
          <Text style={styles.link}>현재 구성으로 새로 만들기</Text>
        </Pressable>

        <View style={styles.nameField}>
          <Text style={styles.helper}>{state.selectedId == null ? '현재 구성을 새 프리셋으로 저장해요'
            : `편집 중인 프리셋: ${selectedPreset?.name ?? state.name}`}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>프리셋 이름</Text>
            <Text style={[styles.saveState, state.dirty && styles.warning]}>{state.dirty ? '저장하지 않은 변경사항' : state.selectedId == null ? '새 프리셋' : '저장됨'}</Text>
          </View>
          <TextInput accessibilityLabel="자동화 프리셋 이름" editable={!busy} maxLength={100} value={state.name}
            onChangeText={name => editor.setName(name)} placeholder="예: 일상 루틴, 사냥 중심"
            placeholderTextColor={theme.colors.textMuted} style={styles.input} />
        </View>
      </View>

      {children}

      {state.selectedId != null ? <View style={styles.manageActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="다른 이름으로 프리셋 전체 저장"
          disabled={!canSave || state.presets.length >= 10} onPress={() => { void editor.save(true); }}
          style={({ pressed }) => [styles.manageButton, (!canSave || state.presets.length >= 10) && styles.disabled, pressed && styles.pressed]}>
          <Copy color={theme.colors.textMuted} size={16} /><Text style={styles.helper}>다른 이름으로 저장</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="선택한 자동화 프리셋 삭제"
          disabled={busy} style={({ pressed }) => [styles.manageButton, busy && styles.disabled, pressed && styles.pressed]}
          onPress={() => AppAlert.alert('저장한 프리셋을 삭제할까요?',
            '이 프리셋의 저장본과 편집 중인 초안을 정리합니다. 현재 실행 설정은 유지됩니다.', [
              { text: '취소', style: 'cancel' },
              { text: '삭제', style: 'destructive', onPress: () => { if (mounted.current) void editor.remove(); } },
            ])}>
          <Trash2 color={theme.colors.danger} size={16} /><Text style={styles.deleteText}>삭제</Text>
        </Pressable>
      </View> : null}

      <FixedBottomAction>
        <View style={styles.footer}>
          {state.busy ? <View style={styles.feedback}><ActivityIndicator accessibilityLabel="프리셋 처리 중" color={theme.colors.accentGreen} size="small" /><Text style={styles.helper}>프리셋 처리 중…</Text></View> : null}
          {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
          {state.message && !state.dirty ? <Text accessibilityLiveRegion="polite" style={styles.helper}>{state.message}</Text> : null}
          <View style={styles.footerHint}>
            <Text style={[styles.helper, styles.copy]}>{lifecycle === 'RUNNING' ? '적용하려면 먼저 일시정지해 주세요.'
              : lifecycle === 'DRAINING' ? '진행 중인 행동을 마무리하고 있어요. 잠시 후 새로고침해 주세요.'
              : !state.name.trim() ? '이름을 입력하고 ‘새 프리셋 저장’을 눌러 주세요.' : '저장·불러오기는 실행 설정을 바꾸지 않아요.'}</Text>
            {lifecycle === 'RUNNING' ? <Pressable accessibilityRole="button" accessibilityLabel="자동화 일시정지" disabled={busy}
              onPress={onPause} style={({ pressed }) => [styles.pauseButton, busy && styles.disabled, pressed && styles.pressed]}>
              <Pause color={theme.colors.accentGreen} size={14} /><Text style={styles.link}>일시정지</Text>
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
  panel: { gap: 20 },
  appliedCard: { gap: 6, borderLeftColor: theme.colors.accentGreen, borderLeftWidth: 3, borderRadius: theme.radius.md, backgroundColor: theme.colors.header, padding: theme.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  appliedName: { color: theme.colors.text, fontSize: 17, lineHeight: 24, fontWeight: '800' },
  runtimeBadge: { color: theme.colors.textMuted, backgroundColor: theme.colors.surfaceAlt, fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  runningBadge: { color: theme.colors.accentGreen },
  section: { gap: theme.spacing.md },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '800' },
  helper: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  label: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  nameField: { gap: theme.spacing.sm, marginTop: theme.spacing.xs },
  saveState: { flexShrink: 1, color: theme.colors.textMuted, fontSize: 11, textAlign: 'right' },
  input: { backgroundColor: theme.colors.header, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10, color: theme.colors.text, fontSize: 15, minHeight: 48, padding: theme.spacing.md },
  iconButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, width: 44, borderRadius: theme.radius.md },
  link: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '700' },
  name: { color: theme.colors.text, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  selector: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, minHeight: 64, padding: theme.spacing.md, backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12 },
  selectorOpen: { borderColor: theme.colors.accentGreen },
  presetIcon: { alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 10, backgroundColor: theme.colors.surfaceAlt },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  options: { gap: 4, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12, padding: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, minHeight: 52, padding: theme.spacing.md, borderRadius: theme.radius.md },
  optionSelected: { backgroundColor: theme.colors.surface },
  optionAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  newPresetButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: theme.spacing.sm },
  manageActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.spacing.sm },
  manageButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: theme.spacing.sm },
  deleteText: { color: theme.colors.danger, fontSize: 12 },
  footer: { gap: theme.spacing.sm },
  footerHint: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  pauseButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 44, paddingHorizontal: theme.spacing.sm },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  actions: { flexDirection: 'row', gap: theme.spacing.sm },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, padding: theme.spacing.md, borderRadius: 10 },
  saveButton: { flex: 1, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.borderStrong },
  applyButton: { flex: 1, backgroundColor: theme.colors.accentGreen },
  buttonText: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  applyText: { color: theme.colors.buttonText, fontSize: 14, fontWeight: '800' },
  warning: { color: theme.colors.accentAmber, fontSize: 12, lineHeight: 18 },
  error: { color: theme.colors.danger, fontSize: 13, lineHeight: 19 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
