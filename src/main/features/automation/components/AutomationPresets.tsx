import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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

export function AutomationPresets({ editor, lifecycle, onRefresh, onPause, children }: Props) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const draft = useSyncExternalStore(editor.draft.subscribe, editor.draft.getSnapshot, editor.draft.getSnapshot);
  const [selecting, setSelecting] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = state.busy || draft.reordering || draft.savingEntryIds.length > 0 || draft.savingTypes.length > 0;
  const canApply = lifecycle === 'PAUSED' || lifecycle === 'STOPPED';
  const count = draft.aggregate?.entries.length ?? 0;
  const canSave = !busy && state.loaded && state.name.trim().length > 0;
  const apply = () => {
    AppAlert.alert('프리셋 전체를 적용할까요?', state.name + '의 모든 항목·판단 순서·맵 설정으로 현재 구성을 교체합니다.', [
      { text: '취소', style: 'cancel' },
      { text: '적용', onPress: () => { if (mounted.current) void editor.apply(); } },
    ]);
  };
  const select = (id: number | null) => confirmPresetNavigation(editor, () => {
    if (mounted.current) { setSelecting(false); void editor.select(id); }
  });

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.title}>자동화 프리셋</Text>
        <Text style={styles.helper}>{state.presets.length}/10</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="자동화 프리셋 새로고침" disabled={busy}
          onPress={onRefresh} style={[styles.button, busy && styles.disabled]}><Text style={styles.link}>새로고침</Text></Pressable>
      </View>
      <Text style={styles.helper}>프리셋 하나에 아래의 자동화 구성 전체를 담아요.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="편집할 자동화 프리셋 선택"
        accessibilityState={{ expanded: selecting, disabled: busy }} disabled={busy}
        onPress={() => setSelecting(value => !value)} style={styles.selector}>
        <Text style={styles.name}>{state.selectedId == null ? '현재 설정으로 새 프리셋 만들기' : state.presets.find(p => p.id === state.selectedId)?.name ?? state.name}</Text>
        <Text style={styles.link}>{selecting ? '닫기' : '선택 ▾'}</Text>
      </Pressable>
      {selecting ? <View style={styles.options}>
        <Pressable accessibilityRole="button" accessibilityLabel="현재 설정으로 새 프리셋 만들기"
          onPress={() => select(null)} style={styles.option}><Text style={styles.link}>현재 설정으로 새 프리셋 만들기</Text></Pressable>
        {state.presets.map(preset => <Pressable key={preset.id} accessibilityRole="button"
          accessibilityLabel={preset.name + ' 프리셋 편집'} onPress={() => select(preset.id)} style={styles.option}>
          <Text style={styles.name}>{preset.name}</Text><Text style={styles.helper}>{preset.entryCount}개 항목</Text>
        </Pressable>)}
      </View> : null}
      <Text style={styles.label}>편집 중인 전체 구성 · {count}개 항목{state.dirty ? ' · 변경됨' : ''}</Text>
      <TextInput accessibilityLabel="자동화 프리셋 이름" editable={!busy} maxLength={100} value={state.name}
        onChangeText={name => editor.setName(name)} placeholder="예: 일상 루틴, 사냥 중심"
        placeholderTextColor={theme.colors.textMuted} style={styles.input} />
      {children}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="프리셋 전체 저장" disabled={!canSave}
          onPress={() => { void editor.save(); }} style={[styles.button, styles.primary, !canSave && styles.disabled]}>
          <Text style={styles.link}>전체 저장</Text>
        </Pressable>
        {state.selectedId != null ? <Pressable accessibilityRole="button" accessibilityLabel="다른 이름으로 프리셋 전체 저장"
          disabled={!canSave || state.presets.length >= 10} onPress={() => { void editor.save(true); }}
          style={[styles.button, (!canSave || state.presets.length >= 10) && styles.disabled]}>
          <Text style={styles.link}>다른 이름으로 저장</Text>
        </Pressable> : null}
      </View>
      {state.selectedId != null ? <Text style={styles.helper}>이름을 바꾸고 다른 이름으로 저장하면 기존 구성도 남아요.</Text> : null}
      <View style={styles.application}>
        <Text style={styles.label}>현재 적용: {state.applied ? state.applied.name + (state.applied.matchesCurrent ? '' : ' · 저장본과 다름') : '별도 설정'}</Text>
        <Text style={styles.helper}>선택·편집·저장은 현재 실행에 영향을 주지 않아요. 적용한 뒤 직접 시작·재개해 주세요.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="자동화에 전체 적용"
          disabled={busy || !canApply || !state.loaded || (!state.selectedId && !state.name.trim())}
          onPress={apply} style={[styles.button, styles.primary, (busy || !canApply || !state.loaded || (!state.selectedId && !state.name.trim())) && styles.disabled]}>
          <Text style={styles.link}>{state.dirty || state.selectedId == null ? '저장하고 전체 적용' : '자동화에 전체 적용'}</Text>
        </Pressable>
        {!canApply ? <Text style={styles.helper}>{lifecycle === 'DRAINING'
          ? '진행 중인 행동을 마무리하고 있어요. 잠시 후 새로고침해 주세요.'
          : '전체 적용 전에 자동화를 일시정지해 주세요. 편집과 저장은 계속할 수 있어요.'}</Text> : null}
        {lifecycle === 'RUNNING' ? <Pressable accessibilityRole="button" disabled={busy} onPress={onPause}
          style={[styles.button, busy && styles.disabled]}><Text style={styles.link}>자동화 일시정지</Text></Pressable> : null}
      </View>
      {state.selectedId != null ? <Pressable accessibilityRole="button" accessibilityLabel="선택한 자동화 프리셋 삭제"
        disabled={busy} style={[styles.button, busy && styles.disabled]} onPress={() => AppAlert.alert('저장한 프리셋을 삭제할까요?',
          '이 프리셋의 저장본과 편집 중인 초안을 정리합니다. 현재 실행 설정은 유지됩니다.', [
            { text: '취소', style: 'cancel' },
            { text: '삭제', style: 'destructive', onPress: () => { if (mounted.current) void editor.remove(); } },
          ])}><Text style={styles.helper}>이 프리셋 삭제</Text></Pressable> : null}
      {state.busy ? <ActivityIndicator accessibilityLabel="프리셋 처리 중" color={theme.colors.accentGreen} /> : null}
      {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
      {state.message ? <Text accessibilityLiveRegion="polite" style={styles.helper}>{state.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: theme.spacing.sm, borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.md, padding: theme.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  title: { flex: 1, color: theme.colors.text, fontSize: 16, fontWeight: '900' },
  helper: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  label: { color: theme.colors.text, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  input: { borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.md, color: theme.colors.text, minHeight: 44, padding: theme.spacing.sm },
  button: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface },
  primary: { borderWidth: 1, borderColor: theme.colors.accentGreen },
  link: { color: theme.colors.accentGreen, fontSize: 13, fontWeight: '700' },
  name: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  selector: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, padding: 10, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
  options: { gap: 4, borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.md, padding: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, padding: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  application: { gap: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.spacing.md },
  error: { color: theme.colors.danger, fontSize: 13, lineHeight: 19 },
  disabled: { opacity: 0.4 },
});
