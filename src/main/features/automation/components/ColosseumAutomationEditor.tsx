import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
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
      <Pressable accessibilityRole="button" accessibilityLabel="콜로세움 자동화 뒤로" disabled={saving} onPress={onBack}><Text style={styles.link}>뒤로</Text></Pressable>
      <Text style={styles.title}>콜로세움 전투 자동화</Text>
      <Switch accessibilityLabel="콜로세움 자동화 사용" disabled={saving} value={enabled} onValueChange={setEnabled} />
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.text}>마을의 콜로세움 전투에서 저장한 5인 팀으로 랭킹에 도전합니다.</Text>
      <Text style={styles.text}>팀은 저장 시점의 캐릭터 정보로 싸웁니다. 캐릭터 정보를 바꿨다면 마을에서 팀을 다시 저장해 주세요.</Text>
      <Text style={styles.text}>쿨다운과 결과 확인 대기 중에는 다른 자동화 항목을 계속 판단합니다.</Text>
      <Text style={styles.title}>저장된 팀</Text>
      {loading ? <ActivityIndicator accessibilityLabel="콜로세움 팀 조회 중" color={theme.colors.accentGreen} /> : null}
      {team ? <>
        <Text style={styles.text}>{team.selectedTeam.length}/5명</Text>
        {team.fighters.filter((fighter) => team.selectedTeam.includes(fighter.id)).map((fighter) => <Text key={fighter.id} style={styles.text}>{fighter.label}</Text>)}
        {team.selectedTeam.length !== 5 ? <Text accessibilityRole="alert" style={styles.error}>마을에서 출전할 5명을 먼저 저장해 주세요.</Text> : null}
        {team.challengeNotice ? <Text style={styles.text}>{team.challengeNotice}</Text> : null}
      </> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="콜로세움 팀 새로고침" disabled={saving || loading} onPress={() => setRefresh((value) => value + 1)}><Text style={styles.link}>팀 새로고침</Text></Pressable>
      {mutationMessage ? <Text accessibilityRole="alert" style={styles.error}>{mutationMessage}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="콜로세움 자동화 삭제" disabled={saving} onPress={() => { void onDelete().then((deleted) => { if (deleted) onBack(); }); }}><Text style={styles.error}>자동화 삭제</Text></Pressable>
    </ScrollView>
    <FixedBottomAction><Pressable accessibilityRole="button" accessibilityLabel="콜로세움 자동화 저장" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void onSave({ enabled })} style={[styles.button, saving && styles.disabled]}><Text style={styles.buttonText}>{saving ? '저장 중...' : '저장'}</Text></Pressable></FixedBottomAction>
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 }, header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, padding: theme.spacing.md },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '800', flexShrink: 1 }, content: { gap: theme.spacing.md, padding: theme.spacing.md },
  text: { color: theme.colors.textMuted, lineHeight: 22 }, link: { color: theme.colors.accentGreen, paddingVertical: 12 }, error: { color: theme.colors.danger, lineHeight: 22 },
  button: { backgroundColor: theme.colors.accentGreen, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md },
  buttonText: { color: theme.colors.background, fontWeight: '800' }, disabled: { opacity: 0.5 },
});
