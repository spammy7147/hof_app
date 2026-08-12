import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';
import { AUTOMATION_TYPE_METADATA } from '../../../domain/typedAutomation';
import { theme } from '../../../styles/theme';
import type { AutomationHistoryCycle, AutomationHistoryPage } from '../../../types/api';

export function AutomationHistoryScreen({ onBack, load }: { onBack: () => void; load: (cursor?: number) => Promise<AutomationHistoryPage> }) {
  const [cycles, setCycles] = useState<AutomationHistoryCycle[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchPage = useCallback(async (next?: number) => {
    setLoading(true); setError(null);
    try { const page = await load(next); setCycles((current) => next == null ? page.cycles : [...current, ...page.cycles]); setCursor(page.nextCursor); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '자동화 기록을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [load]);
  useEffect(() => { void fetchPage(); }, [fetchPage]);
  return <NestableScrollContainer contentContainerStyle={styles.container}>
    <View style={styles.header}><Pressable accessibilityLabel="통합 자동화로" accessibilityRole="button" onPress={onBack} style={styles.back}><ArrowLeft color={theme.colors.text} size={20} /></Pressable><View><Text style={styles.title}>자동화 기록</Text><Text style={styles.subtitle}>실제 판단 순서와 실행·스킵 결과를 시간순으로 확인합니다.</Text></View></View>
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => { void fetchPage(); }}><Text style={styles.link}>다시 시도</Text></Pressable></> : null}
    {!loading && cycles.length === 0 && !error ? <Text style={styles.empty}>아직 자동화 기록이 없습니다.</Text> : null}
    {cycles.map((cycle) => <View key={cycle.id} style={styles.cycle}>
      <View style={styles.cycleHeader}><Text style={styles.time}>{new Date(cycle.startedAt).toLocaleString('ko-KR')}</Text><Text style={styles.result}>{resultLabel(cycle.result)}</Text></View>
      {cycle.events.map((event) => <View key={event.id} style={styles.event}>
        <Text style={styles.sequence}>{event.sequence + 1}</Text><View style={styles.eventCopy}><Text style={styles.eventTitle}>{event.type ? AUTOMATION_TYPE_METADATA[event.type].label : '시스템'} · {kindLabel(event.kind)}</Text>
          {event.targetName || event.targetKey ? <Text style={styles.target}>대상  {event.targetName ?? event.targetKey}{event.targetName && event.targetKey ? ` (${event.targetKey})` : ''}</Text> : null}
          {event.presetName || event.actionKind ? <View style={styles.details}>{event.actionKind ? <Text style={styles.detailChip}>동작 {actionLabel(event.actionKind)}</Text> : null}{event.presetName ? <Text style={styles.detailChip}>프리셋 {event.presetName}</Text> : null}</View> : null}
          <Text style={styles.message}><Text style={styles.criteria}>{messageLabel(event.kind)}  </Text>{event.message}</Text>{event.nextRunAt ? <Text style={styles.next}>다음 확인 {new Date(event.nextRunAt).toLocaleString('ko-KR')}</Text> : null}</View>
      </View>)}
    </View>)}
    {loading ? <ActivityIndicator accessibilityLabel="자동화 기록 불러오는 중" color={theme.colors.accentGreen} /> : null}
    {cursor != null && !loading ? <Pressable accessibilityLabel="자동화 기록 더 보기" accessibilityRole="button" onPress={() => { void fetchPage(cursor); }} style={styles.more}><Text style={styles.moreText}>더 보기</Text></Pressable> : null}
  </NestableScrollContainer>;
}
function resultLabel(value: AutomationHistoryCycle['result']) { return ({ ACTION_SELECTED: '행동 선택', WAITING: '대기', IDLE: '실행 없음', FATAL: '중지' } as const)[value]; }
function kindLabel(value: AutomationHistoryCycle['events'][number]['kind']) { return ({ EVALUATED: '판단', SELECTED: '선택', WAITING: '대기', SKIPPED: '스킵', CONFIGURATION_WARNING: '설정 경고', ACTION_STARTED: '실행 시작', ACTION_SUCCEEDED: '성공', ACTION_FAILED: '실패', CYCLE_COMPLETED: '사이클 완료', CYCLE_ABORTED: '사이클 중단' } as const)[value]; }
function messageLabel(value: AutomationHistoryCycle['events'][number]['kind']) { return ['EVALUATED', 'SELECTED', 'WAITING', 'SKIPPED', 'CONFIGURATION_WARNING'].includes(value) ? '판단 기준' : '처리 결과'; }
function actionLabel(value: string) { return ({ BATTLE: '전투', START: '시작', CATCH: '잡기', REGISTER: '파티 등록', REWARD: '보상 수령', RESET: '초기화', QUEST_ACCEPT: '퀘스트 수락', QUEST_CLAIM: '퀘스트 보상', CYCLE_ABORT: '사이클 중단' } as Record<string, string>)[value] ?? value; }
const styles = StyleSheet.create({ container: { gap: theme.spacing.md, padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }, header: { alignItems: 'center', flexDirection: 'row', gap: 8 }, back: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 }, title: { color: theme.colors.text, fontSize: 21, fontWeight: '900' }, subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3 }, cycle: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 7, padding: theme.spacing.md }, cycleHeader: { flexDirection: 'row', justifyContent: 'space-between' }, time: { color: theme.colors.text, fontSize: 12, fontWeight: '800' }, result: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '800' }, event: { alignItems: 'flex-start', borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, paddingTop: 8 }, sequence: { color: theme.colors.textMuted, fontSize: 11, width: 18 }, eventCopy: { flex: 1 }, eventTitle: { color: theme.colors.text, fontSize: 12, fontWeight: '800' }, target: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800', marginTop: 5 }, details: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 }, detailChip: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 7, color: theme.colors.text, fontSize: 11, paddingHorizontal: 7, paddingVertical: 4 }, criteria: { color: theme.colors.text, fontWeight: '700' }, message: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 5 }, next: { color: theme.colors.accentBlue, fontSize: 11, marginTop: 3 }, empty: { color: theme.colors.textMuted, padding: theme.spacing.xl, textAlign: 'center' }, error: { color: theme.colors.danger }, link: { color: theme.colors.accentGreen, fontWeight: '800' }, more: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, minHeight: 46, justifyContent: 'center' }, moreText: { color: theme.colors.text, fontWeight: '800' } });
