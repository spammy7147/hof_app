import { CompactSwitch as Switch } from '../../../components/CompactSwitch';
import { useAutomationEditorBack } from '../useAutomationEditorBack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, RefreshCw, Save, Trash2 } from 'lucide-react-native';
import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import { FixedBottomAction } from '../../../components/FixedBottomAction';
import { theme } from '../../../styles/theme';
import type { ColosseumBattleResponse, TypedAutomationEntryResponse, UpdateColosseumAutomationRequest } from '../../../types/api';

type Props = {
  entry: TypedAutomationEntryResponse;
  saving: boolean;
  mutationMessage: string | null;
  loadColosseum: () => Promise<ColosseumBattleResponse>;
  onBack: () => void;
  onDelete: () => Promise<boolean>;
  onSave: (request: UpdateColosseumAutomationRequest) => Promise<boolean>;
};

export function ColosseumAutomationEditor({ entry, saving, mutationMessage, loadColosseum, onBack, onDelete, onSave }: Props) {
  useAutomationEditorBack(onBack, saving);
  const [enabled, setEnabled] = useState(entry.enabled);
  const [team, setTeam] = useState<ColosseumBattleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void loadColosseum().then((value) => { if (active) setTeam(value); })
      .catch((reason: unknown) => { if (active) { setTeam(null); setError(toUserFacingErrorMessage(reason)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadColosseum, refresh]);
  return <View style={styles.container}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="콜로세움 자동화 뒤로" disabled={saving} onPress={onBack} style={[styles.iconButton, saving && styles.disabled]}><ArrowLeft color={theme.colors.text} size={21} /></Pressable>
      <View style={styles.headerCopy}><Text style={styles.title}>콜로세움 전투 자동화</Text></View>
      <Switch accessibilityLabel="콜로세움 자동화 사용" disabled={saving} value={enabled} onValueChange={setEnabled} />
    </View>
    <ScrollView style={styles.scroller} contentContainerStyle={styles.content}>
      <View style={styles.guide}>
        <Text style={styles.text}>마을의 콜로세움 전투에서 저장한 5인 팀으로 랭킹에 도전합니다.</Text>
        <Text style={styles.text}>팀은 저장 시점의 캐릭터 정보로 싸웁니다. 캐릭터 정보를 바꿨다면 마을에서 팀을 다시 저장해 주세요.</Text>
        <Text style={styles.text}>쿨다운과 결과 확인 대기 중에는 다른 자동화 항목을 계속 판단합니다.</Text>
      </View>
      <View style={styles.teamHeader}>
        <View style={styles.teamHeading}>
          <Text style={styles.sectionTitle}>저장된 팀</Text>
          {team ? <Text style={styles.teamCount}>{team.selectedTeam.length}/5명</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="콜로세움 팀 새로고침" accessibilityState={{ disabled: saving || loading }} disabled={saving || loading} onPress={() => setRefresh((value) => value + 1)} style={[styles.refreshButton, (saving || loading) && styles.disabled]}>
          <RefreshCw color={theme.colors.accentGreen} size={16} /><Text style={styles.refreshText}>팀 새로고침</Text>
        </Pressable>
      </View>
      <View style={styles.teamCard}>
        {loading ? <ActivityIndicator accessibilityLabel="콜로세움 팀 조회 중" color={theme.colors.accentGreen} /> : null}
        {team ? <>
          {team.fighters.filter((fighter) => team.selectedTeam.includes(fighter.id)).map((fighter, index) => <View key={fighter.id} style={[styles.fighterRow, index > 0 && styles.fighterDivider]}>
            <Text style={styles.fighterNumber}>{index + 1}</Text><Text style={styles.fighterName}>{fighter.label}</Text>
          </View>)}
          {team.selectedTeam.length !== 5 ? <Text accessibilityRole="alert" style={styles.error}>마을에서 출전할 5명을 먼저 저장해 주세요.</Text> : null}
          {team.challengeNotice ? <Text style={styles.text}>{team.challengeNotice}</Text> : null}
        </> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </View>
      {mutationMessage ? <Text accessibilityRole="alert" style={styles.error}>{mutationMessage}</Text> : null}
    </ScrollView>
    <FixedBottomAction>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" accessibilityLabel="콜로세움 자동화 삭제" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => { void onDelete().then((deleted) => { if (deleted) onBack(); }); }} style={[styles.deleteButton, saving && styles.disabled]}>
          <Trash2 color={theme.colors.danger} size={19} /><Text style={styles.deleteText}>삭제</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="콜로세움 자동화 저장" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void onSave({ enabled })} style={[styles.button, saving && styles.disabled]}>
          <Save color={theme.colors.buttonText} size={19} /><Text style={styles.buttonText}>{saving ? '저장 중...' : '저장'}</Text>
        </Pressable>
      </View>
    </FixedBottomAction>
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, gap: theme.spacing.hairline, paddingHorizontal: theme.layout.screenPadding, paddingVertical: theme.spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  iconButton: { alignItems: 'center', justifyContent: 'center', minHeight: theme.control.touch, minWidth: theme.control.touch },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.text, fontSize: theme.fontSize.section, lineHeight: theme.lineHeight.title, fontWeight: '900' },
  scroller: { flex: 1, minHeight: 0 },
  content: { gap: theme.layout.sectionGap, paddingBottom: theme.spacing.lg },
  guide: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: theme.spacing.sm, padding: theme.layout.cardPadding },
  text: { fontSize: theme.fontSize.caption, color: theme.colors.textMuted, lineHeight: theme.lineHeight.caption },
  teamHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  teamHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.md },
  sectionTitle: { color: theme.colors.text, fontSize: theme.fontSize.body, lineHeight: theme.lineHeight.body, fontWeight: '900' },
  teamCount: { color: theme.colors.accentGreen, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption, fontWeight: '800' },
  refreshButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, minHeight: theme.control.touch, minWidth: theme.control.touch, paddingHorizontal: theme.spacing.lg },
  refreshText: { color: theme.colors.accentGreen, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption, fontWeight: '800', flexShrink: 1 },
  teamCard: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, padding: theme.layout.cardPadding, gap: theme.spacing.xs },
  fighterRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg, paddingVertical: theme.spacing.md },
  fighterDivider: { borderTopColor: theme.colors.border, borderTopWidth: 1 },
  fighterNumber: { color: theme.colors.textMuted, fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.caption },
  fighterName: { color: theme.colors.text, fontSize: theme.fontSize.body, lineHeight: theme.lineHeight.body, flex: 1, minWidth: 0 },
  error: { fontSize: theme.fontSize.caption, color: theme.colors.danger, lineHeight: theme.lineHeight.caption },
  footer: { flexDirection: 'row', gap: theme.spacing.sm },
  deleteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs, borderColor: theme.colors.danger, borderRadius: theme.radius.md, borderWidth: 1, minHeight: theme.control.input, minWidth: theme.control.touch, paddingHorizontal: theme.spacing.lg },
  deleteText: { color: theme.colors.danger, fontSize: theme.fontSize.body, fontWeight: '900' },
  button: { flex: 1, flexDirection: 'row', gap: theme.spacing.sm, backgroundColor: theme.colors.accentGreen, minHeight: theme.control.input, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md, minWidth: theme.control.touch },
  buttonText: { fontSize: theme.fontSize.body, color: theme.colors.buttonText, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});
