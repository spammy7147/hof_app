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
  const latestEvent = cycles[0]?.events.at(-1);
  return <NestableScrollContainer contentContainerStyle={styles.container} style={styles.scroller}>
    <View style={styles.header}><Pressable accessibilityLabel="통합 자동화로" accessibilityRole="button" onPress={onBack} style={styles.back}><ArrowLeft color={theme.colors.text} size={20} /></Pressable><View><Text style={styles.title}>자동화 기록</Text><Text style={styles.subtitle}>실제 판단 순서와 실행·스킵 결과를 시간순으로 확인합니다.</Text></View></View>
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => { void fetchPage(); }}><Text style={styles.link}>다시 시도</Text></Pressable></> : null}
    {!loading && cycles.length === 0 && !error ? <Text style={styles.empty}>아직 자동화 기록이 없습니다.</Text> : null}
    {latestEvent ? <View accessibilityLabel="최근 자동화 상태" style={styles.statusSummary}>
      <Text style={styles.statusEyebrow}>{statusSummaryLabel(latestEvent.kind)}</Text>
      <Text style={styles.statusTitle}>{latestEvent.type ? AUTOMATION_TYPE_METADATA[latestEvent.type].label : '시스템'}{latestEvent.actionKind ? ` · ${actionLabel(latestEvent.actionKind, latestEvent.type)}` : ''}</Text>
      {latestEvent.targetName || latestEvent.targetKey ? <Text style={styles.target}>대상  {latestEvent.targetName ?? latestEvent.targetKey}</Text> : null}
      <Text style={styles.statusMessage}>{displayMessage(latestEvent)}</Text>
      <Text style={styles.statusDiagnostic}>현재 판단  {reasonLabel(latestEvent.reasonCode)}</Text>
      {latestEvent.nextRunAt ? <Text style={styles.next}>다음 확인 {new Date(latestEvent.nextRunAt).toLocaleString('ko-KR')}</Text> : null}
    </View> : null}
    {cycles.map((cycle) => <View key={cycle.id} style={styles.cycle}>
      <View style={styles.cycleHeader}><View><Text style={styles.time}>{new Date(cycle.startedAt).toLocaleString('ko-KR')}</Text><Text style={styles.cycleMeta}>판단 과정 {cycle.events.length}단계</Text></View><Text style={styles.result}>{resultLabel(cycle.result)}</Text></View>
      {cycle.events.map((event) => <View key={event.id} style={styles.event}>
        <Text style={styles.sequence}>{event.sequence + 1}</Text><View style={styles.eventCopy}><Text style={styles.eventTitle}>{event.type ? AUTOMATION_TYPE_METADATA[event.type].label : '시스템'} · {kindLabel(event.kind)}</Text>
          <Text style={styles.eventTime}>기록 시각  {new Date(event.occurredAt).toLocaleString('ko-KR')}</Text>
          {event.targetName || event.targetKey ? <View style={styles.factGroup}><Text style={styles.fact}><Text style={styles.factLabel}>대상  </Text>{event.targetName ?? event.targetKey}</Text></View> : null}
          {event.presetName || event.presetId || event.actionKind ? <View style={styles.details}>{event.actionKind ? <Text style={styles.detailChip}>동작 {actionLabel(event.actionKind, event.type)}</Text> : null}{event.presetName || event.presetId ? <Text style={styles.detailChip}>프리셋 {event.presetName ?? `저장된 프리셋 ${event.presetId}`}</Text> : null}</View> : null}
          <Text style={styles.message}><Text style={styles.criteria}>{messageLabel(event.kind)}  </Text>{displayMessage(event)}</Text>
          <Text style={styles.diagnostic}>판단 내용  {reasonLabel(event.reasonCode)}</Text>
          {event.nextRunAt ? <Text style={styles.next}>다음 확인 {new Date(event.nextRunAt).toLocaleString('ko-KR')}</Text> : null}</View>
      </View>)}
    </View>)}
    {loading ? <ActivityIndicator accessibilityLabel="자동화 기록 불러오는 중" color={theme.colors.accentGreen} /> : null}
    {cursor != null && !loading ? <Pressable accessibilityLabel="자동화 기록 더 보기" accessibilityRole="button" onPress={() => { void fetchPage(cursor); }} style={styles.more}><Text style={styles.moreText}>더 보기</Text></Pressable> : null}
  </NestableScrollContainer>;
}
function resultLabel(value: AutomationHistoryCycle['result']) { return ({ ACTION_SELECTED: '행동 선택', WAITING: '대기', IDLE: '실행 없음', FATAL: '중지' } as const)[value]; }
function kindLabel(value: AutomationHistoryCycle['events'][number]['kind']) { return ({ EVALUATED: '판단', SELECTED: '선택', WAITING: '대기', SKIPPED: '스킵', CONFIGURATION_WARNING: '설정 경고', ACTION_STARTED: '실행 시작', ACTION_SUCCEEDED: '성공', ACTION_FAILED: '실패', CYCLE_COMPLETED: '사이클 완료', CYCLE_ABORTED: '사이클 중단' } as const)[value]; }
function messageLabel(value: AutomationHistoryCycle['events'][number]['kind']) { return ['EVALUATED', 'SELECTED', 'WAITING', 'SKIPPED', 'CONFIGURATION_WARNING'].includes(value) ? '판단 기준' : '처리 결과'; }
function statusSummaryLabel(kind: AutomationHistoryCycle['events'][number]['kind']) { return kind === 'ACTION_FAILED' ? '최근 막힘 사유' : kind === 'WAITING' ? '현재 대기 사유' : '최근 자동화 단계'; }
function actionLabel(value: string, type?: AutomationHistoryCycle['events'][number]['type']) {
  if (value === 'START') return type === 'FISHING' ? '낚시 시작' : type === 'RAID' ? '전투 시작' : '시작';
  return ({ BATTLE: '전투', BATTLE_MAP: '전투 맵 실행', ADVENTURE_MAP: '모험 맵 실행', QUEST_BATTLE: '퀘스트 전투', FISHING_TOWN: '낚시 진행', RAID_TOWN: '레이드 진행', HOME_QUEST: '자택 퀘스트 진행', CATCH: '낚기', REGISTER: '파티 등록', REWARD: '보상 수령', REFRESH: '상태 갱신', RESET: '레이드 리셋', WAIT: '대기', QUEST_ACCEPT: '퀘스트 수락', QUEST_CLAIM: '퀘스트 보상', HOME_ACCEPT: '자택 퀘스트 수락', HOME_CLAIM: '자택 퀘스트 완료', CYCLE_ABORT: '사이클 중단', RAID_CYCLE_ABORT: '레이드 사이클 중단' } as Record<string, string>)[value] ?? '자동화 작업';
}
function displayMessage(event: AutomationHistoryCycle['events'][number]) {
  const action = event.actionKind ? actionLabel(event.actionKind, event.type) : '자동화 작업';
  const exact = event.message.trim();
  if (exact === '자동화 행동을 시작했습니다.') return `${action}을 시작했습니다.`;
  if (exact === '자동화 행동을 완료했습니다.') return `${action}을 완료했습니다.`;
  if (exact === 'HOF 로그인 세션이 만료되었습니다.') return 'HOF 로그인 유효 시간이 끝나 저장된 로그인 정보로 다시 연결을 시도합니다.';
  if (event.type === 'FISHING' && exact.includes('다음 동작이 START입니다')) {
    return exact.replace('낚시 화면의 다음 동작이 START입니다.', '낚시 화면에서 ‘낚시 시작’ 버튼을 확인했습니다.');
  }
  if (event.type === 'FISHING' && exact.includes('다음 동작이 CATCH입니다')) {
    return exact.replace('낚시 화면의 다음 동작이 CATCH입니다.', '낚시 화면에서 ‘낚기’ 버튼을 확인했습니다.');
  }
  return exact
    .replaceAll('FISHING_TOWN', '낚시 진행')
    .replaceAll('RAID_TOWN', '레이드 진행')
    .replaceAll('QUEST_CLAIM', '퀘스트 보상 수령')
    .replaceAll('QUEST_ACCEPT', '퀘스트 수락')
    .replaceAll('QUEST_BATTLE', '퀘스트 전투')
    .replaceAll('BATTLE_MAP', '전투 맵 실행')
    .replaceAll('ADVENTURE_MAP', '모험 맵 실행');
}
function reasonLabel(value: string) {
  if (value === 'RUNNABLE') return '현재 조건을 통과해 이 작업을 선택함';
  if (value === 'ACTION_STARTED') return '선택한 요청을 HOF에 실행 중';
  if (value === 'TYPED_ACTION_COMPLETED') return '요청 처리와 후속 상태 저장을 완료함';
  if (value === 'TYPED_SHARED_COOLDOWN_SKIPPED') return '공유 쿨다운을 확인해 다음 판단으로 넘김';
  if (value.includes('AMBIGUOUS')) return '요청 결과가 불확실해 중복 실행 없이 상태를 재확인함';
  if (value.includes('DEFERRED')) return 'HOF 서버 응답 지연으로 현재 단계를 보존하고 재시도함';
  if (value.includes('COOLDOWN')) return '쿨다운 종료 시각까지 기다림';
  if (value.includes('DAILY_LIMIT')) return '오늘 실행 가능한 횟수를 모두 사용함';
  if (value.includes('PRESET') || value.includes('PARTY') || value.includes('TARGET_MISSING')) return '필수 자동화 설정을 확인해야 함';
  if (value === 'NO_RUNNABLE_ACTION') return '현재 실행 조건을 만족하는 작업이 없음';
  if (value === 'ACTION_FAILED') return '실행 중 오류가 발생해 자동 재시도 대상으로 전환됨';
  return '해당 시점의 자동화 판단 결과';
}
const styles = StyleSheet.create({ scroller: { flex: 1 }, container: { gap: theme.spacing.md, padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }, header: { alignItems: 'center', flexDirection: 'row', gap: 8 }, back: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 }, title: { color: theme.colors.text, fontSize: 21, fontWeight: '900' }, subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3 }, statusSummary: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.accentBlue, borderRadius: theme.radius.md, borderWidth: 1, padding: theme.spacing.md }, statusEyebrow: { color: theme.colors.accentBlue, fontSize: 11, fontWeight: '900' }, statusTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '900', marginTop: 5 }, statusMessage: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 7 }, statusDiagnostic: { color: theme.colors.accentBlue, fontSize: 10, lineHeight: 15, marginTop: 5 }, cycle: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 7, padding: theme.spacing.md }, cycleHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' }, time: { color: theme.colors.text, fontSize: 12, fontWeight: '800' }, cycleMeta: { color: theme.colors.textMuted, fontSize: 10, marginTop: 3 }, result: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '800' }, event: { alignItems: 'flex-start', borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, paddingTop: 8 }, sequence: { color: theme.colors.textMuted, fontSize: 11, width: 18 }, eventCopy: { flex: 1 }, eventTitle: { color: theme.colors.text, fontSize: 12, fontWeight: '800' }, eventTime: { color: theme.colors.textMuted, fontSize: 10, marginTop: 3 }, target: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800', marginTop: 5 }, factGroup: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 7, gap: 3, marginTop: 6, padding: 7 }, fact: { color: theme.colors.text, fontSize: 11 }, factLabel: { color: theme.colors.textMuted, fontWeight: '700' }, details: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 }, detailChip: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 7, color: theme.colors.text, fontSize: 11, paddingHorizontal: 7, paddingVertical: 4 }, criteria: { color: theme.colors.text, fontWeight: '700' }, message: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 5 }, diagnostic: { color: theme.colors.textMuted, fontSize: 10, marginTop: 3 }, next: { color: theme.colors.accentBlue, fontSize: 11, marginTop: 3 }, empty: { color: theme.colors.textMuted, padding: theme.spacing.xl, textAlign: 'center' }, error: { color: theme.colors.danger }, link: { color: theme.colors.accentGreen, fontWeight: '800' }, more: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, minHeight: 46, justifyContent: 'center' }, moreText: { color: theme.colors.text, fontWeight: '800' } });
