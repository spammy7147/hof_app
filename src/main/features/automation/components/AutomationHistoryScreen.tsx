import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';
import { AUTOMATION_TYPE_METADATA } from '../../../domain/typedAutomation';
import { theme } from '../../../styles/theme';
import type {
  AutomationConvergenceActionKind,
  AutomationConvergenceStatus,
  AutomationHistoryEvent,
  AutomationHistoryCycle,
  AutomationHistoryPage,
  AutomationHistoryStep,
} from '../../../types/api';

type AutomationHistoryScreenProps = {
  onBack: () => void;
  load: (cursor?: number) => Promise<AutomationHistoryPage>;
  nextAutomationDecisionAt?: string | null;
  loadConvergence?: () => Promise<AutomationConvergenceStatus>;
  allowFreshDecision?: (attemptId: number) => Promise<AutomationConvergenceStatus>;
};

export function AutomationHistoryScreen({
  onBack,
  load,
  nextAutomationDecisionAt,
  loadConvergence,
  allowFreshDecision,
}: AutomationHistoryScreenProps) {
  const [cycles, setCycles] = useState<AutomationHistoryCycle[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [convergence, setConvergence] = useState<AutomationConvergenceStatus | null>(null);
  const [convergenceLoading, setConvergenceLoading] = useState(false);
  const [convergenceError, setConvergenceError] = useState<string | null>(null);
  const [releasingAttemptId, setReleasingAttemptId] = useState<number | null>(null);
  const fetchPage = useCallback(async (next?: number) => {
    setLoading(true); setError(null);
    try { const page = await load(next); setCycles((current) => next == null ? page.cycles : [...current, ...page.cycles]); setCursor(page.nextCursor); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '자동화 기록을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [load]);
  useEffect(() => { void fetchPage(); }, [fetchPage]);
  const refreshConvergence = useCallback(async () => {
    if (!loadConvergence) return;
    setConvergenceLoading(true); setConvergenceError(null);
    try { setConvergence(await loadConvergence()); }
    catch (reason) { setConvergenceError(reason instanceof Error ? reason.message : '결과 확인 상태를 불러오지 못했습니다.'); }
    finally { setConvergenceLoading(false); }
  }, [loadConvergence]);
  useEffect(() => { void refreshConvergence(); }, [refreshConvergence]);
  const release = useCallback(async (attemptId: number) => {
    if (!allowFreshDecision || releasingAttemptId != null) return;
    setReleasingAttemptId(attemptId); setConvergenceError(null);
    try { setConvergence(await allowFreshDecision(attemptId)); }
    catch (reason) { setConvergenceError(reason instanceof Error ? reason.message : '새 행동 판단을 허용하지 못했습니다.'); }
    finally { setReleasingAttemptId(null); }
  }, [allowFreshDecision, releasingAttemptId]);
  const latestEvent = cycles[0]?.events.at(-1);
  return <NestableScrollContainer contentContainerStyle={styles.container} stickyHeaderIndices={[0]} style={styles.scroller}>
    <View style={styles.header}><Pressable accessibilityLabel="통합 자동화로" accessibilityRole="button" onPress={onBack} style={styles.back}><ArrowLeft color={theme.colors.text} size={20} /></Pressable><View><Text style={styles.title}>자동화 기록</Text><Text style={styles.subtitle}>실제 판단 순서와 실행·스킵 결과를 시간순으로 확인합니다.</Text></View></View>
    {loadConvergence ? <View accessibilityLabel="자동화 결과 확인 상태" style={styles.convergenceSection}>
      <View style={styles.convergenceHeader}><View><Text style={styles.convergenceEyebrow}>현재 결과 확인</Text><Text style={styles.convergenceHeading}>중복 실행 방지 상태</Text></View><Pressable accessibilityLabel="수렴 상태 새로고침" accessibilityRole="button" disabled={convergenceLoading} onPress={() => { void refreshConvergence(); }} style={styles.refreshButton}><Text style={styles.refreshText}>{convergenceLoading ? '확인 중' : '새로고침'}</Text></Pressable></View>
      {convergenceError ? <Text accessibilityRole="alert" style={styles.error}>{convergenceError}</Text> : null}
      {convergence?.battleGate ? <View style={styles.gateCard}>
        <Text style={styles.gateTitle}>전투 캡차 대기</Text>
        <Text style={styles.convergenceMessage}>{convergence.battleGate.reason}</Text>
        <Text style={styles.scope}>영향  {convergence.battleGate.impactScope}</Text>
        <Text style={styles.releaseCondition}>{convergence.battleGate.releaseCondition}</Text>
        <Text style={styles.nonBattleNotice}>다른 비전투 자동화는 계속 진행됩니다.</Text>
      </View> : null}
      {convergence?.items.map((item) => <View key={item.attemptId} style={styles.convergenceCard}>
        <Text style={styles.convergenceResult}>{convergenceResultLabel(item.result)}</Text>
        <Text style={styles.convergenceTitle}>{convergenceActionLabel(item.actionKind)}</Text>
        <Text style={styles.scope}>영향  {item.impactScope}</Text>
        {item.result === 'PENDING' ? <Text style={styles.observation}>관측 {item.successfulObservationCount}/5</Text> : null}
        <Text style={styles.convergenceMessage}>{item.reasonMessage}</Text>
        <Text style={styles.releaseCondition}>{item.releaseCondition}</Text>
        {item.nextProbeAt ? <Text style={styles.next}>다음 확인 {new Date(item.nextProbeAt).toLocaleString('ko-KR')}</Text> : null}
        {item.canAllowFreshDecision && allowFreshDecision ? <Pressable
          accessibilityLabel={`${convergenceActionLabel(item.actionKind)} 새 행동 판단 허용`}
          accessibilityRole="button"
          disabled={releasingAttemptId != null}
          onPress={() => { void release(item.attemptId); }}
          style={styles.releaseButton}
        ><Text style={styles.releaseButtonText}>{releasingAttemptId === item.attemptId ? '처리 중' : '새 행동 판단 허용'}</Text></Pressable> : null}
      </View>)}
      {!convergenceLoading && convergence && !convergence.battleGate && convergence.items.length === 0 ? <Text style={styles.convergenceEmpty}>현재 결과를 재확인 중인 행동이 없습니다.</Text> : null}
    </View> : null}
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => { void fetchPage(); }}><Text style={styles.link}>다시 시도</Text></Pressable></> : null}
    {!loading && cycles.length === 0 && !error ? <Text style={styles.empty}>아직 자동화 기록이 없습니다.</Text> : null}
    {nextAutomationDecisionAt ? <View accessibilityLabel="전체 자동화 재판단 대기" style={styles.statusSummary}>
      <Text style={styles.statusEyebrow}>전체 자동화</Text>
      <Text style={styles.statusTitle}>재판단 대기</Text>
      <Text style={styles.statusMessage}>현재 판단에서 실행할 행동을 찾지 못해 다음 시각에 첫 항목부터 다시 확인합니다.</Text>
      <Text style={styles.next}>전체 자동화 재판단 {new Date(nextAutomationDecisionAt).toLocaleString('ko-KR')}</Text>
    </View> : null}
    {latestEvent ? <View accessibilityLabel="최근 항목 판단" style={styles.statusSummary}>
      <Text style={styles.statusEyebrow}>{statusSummaryLabel(latestEvent.kind)}</Text>
      <Text style={styles.statusTitle}>{latestEvent.entryDisplayName ?? (latestEvent.type ? AUTOMATION_TYPE_METADATA[latestEvent.type].label : '시스템')}{latestEvent.actionKind ? ` · ${actionLabel(latestEvent.actionKind, latestEvent.type)}` : ''}</Text>
      {latestEvent.targetName || latestEvent.targetKey ? <Text style={styles.target}>대상  {latestEvent.targetName ?? latestEvent.targetKey}</Text> : null}
      <Text style={styles.statusMessage}>{displayMessage(latestEvent)}</Text>
      <Text style={styles.statusDiagnostic}>현재 판단  {diagnosticSummary(latestEvent)}</Text>
      <TypedWaitDiagnostic event={latestEvent} />
      {latestEvent.nextRunAt ? <Text style={styles.next}>{nextRunLabel(latestEvent)} {new Date(latestEvent.nextRunAt).toLocaleString('ko-KR')}</Text> : null}
    </View> : null}
    {cycles.map((cycle) => {
      const steps = historySteps(cycle);
      return <View key={cycle.id} style={styles.cycle}>
        <View style={styles.cycleHeader}><View><Text style={styles.time}>{new Date(cycle.startedAt).toLocaleString('ko-KR')}</Text><Text style={styles.cycleMeta}>판단 과정 {cycle.topLevelStepCount ?? steps.length}단계</Text></View><Text style={styles.result}>{resultLabel(cycle.result)}</Text></View>
        {steps.map((step) => <View key={`step-${step.sequence}-${step.event.id}`} style={styles.event}>
          <Text style={styles.sequence}>{step.sequence}</Text><View style={styles.eventCopy}>
            <HistoryEventContent event={step.event} />
            {step.executionEvents.length > 0 ? <View
              accessibilityLabel={`${step.event.entryDisplayName ?? (step.event.type ? AUTOMATION_TYPE_METADATA[step.event.type].label : '자동화')} 사이클 실행 단계`}
              style={styles.executionGroup}
            >
              <Text style={styles.executionHeading}>{step.event.type ? AUTOMATION_TYPE_METADATA[step.event.type].label : '자동화'} 사이클 · 실행</Text>
              {step.executionEvents.map((event) => <View key={event.id} style={styles.executionEvent}>
                <HistoryEventContent event={event} />
              </View>)}
            </View> : null}
          </View>
        </View>)}
      </View>;
    })}
    {loading ? <ActivityIndicator accessibilityLabel="자동화 기록 불러오는 중" color={theme.colors.accentGreen} /> : null}
    {cursor != null && !loading ? <Pressable accessibilityLabel="자동화 기록 더 보기" accessibilityRole="button" onPress={() => { void fetchPage(cursor); }} style={styles.more}><Text style={styles.moreText}>더 보기</Text></Pressable> : null}
  </NestableScrollContainer>;
}
function HistoryEventContent({ event }: { event: AutomationHistoryEvent }) {
  return <>
    <Text style={styles.eventTitle}>{event.entryDisplayName ?? (event.type ? AUTOMATION_TYPE_METADATA[event.type].label : '시스템')} · {kindLabel(event.kind)}</Text>
    <Text style={styles.eventTime}>기록 시각  {new Date(event.occurredAt).toLocaleString('ko-KR')}</Text>
    {event.targetName || event.targetKey ? <View style={styles.factGroup}><Text style={styles.fact}><Text style={styles.factLabel}>대상  </Text>{event.targetName ?? event.targetKey}</Text></View> : null}
    {event.presetName || event.presetId || event.actionKind ? <View style={styles.details}>{event.actionKind ? <Text style={styles.detailChip}>동작 {actionLabel(event.actionKind, event.type)}</Text> : null}{event.presetName || event.presetId ? <Text style={styles.detailChip}>프리셋 {event.presetName ?? `저장된 프리셋 ${event.presetId}`}</Text> : null}</View> : null}
    <Text style={styles.message}><Text style={styles.criteria}>{messageLabel(event.kind)}  </Text>{displayMessage(event)}</Text>
    <Text style={styles.diagnostic}>판단 내용  {diagnosticSummary(event)}</Text>
    <TypedWaitDiagnostic event={event} />
    {event.nextRunAt ? <Text style={styles.next}>{nextRunLabel(event)} {new Date(event.nextRunAt).toLocaleString('ko-KR')}</Text> : null}
  </>;
}
function historySteps(cycle: AutomationHistoryCycle): AutomationHistoryStep[] {
  if (cycle.steps) return cycle.steps;
  const selectedIndex = cycle.events.findIndex((event) => event.kind === 'SELECTED'
    && (cycle.selectedEntryId == null || event.entryId === cycle.selectedEntryId));
  if (selectedIndex < 0) {
    return cycle.events.map((event, index) => ({ sequence: index + 1, event, executionEvents: [] }));
  }
  const decisionEvents = cycle.events.slice(0, selectedIndex + 1);
  const selected = decisionEvents[selectedIndex];
  const executionEvents = cycle.events.slice(selectedIndex + 1);
  const children = executionEvents.filter((event) => event.entryId === selected.entryId
    || (event.entryId == null && event.type === selected.type));
  const standalone = executionEvents.filter((event) => !children.includes(event));
  return [
    ...decisionEvents.map((event, index) => ({
      sequence: index + 1,
      event,
      executionEvents: index === selectedIndex ? children : [],
    })),
    ...standalone.map((event, index) => ({
      sequence: decisionEvents.length + index + 1,
      event,
      executionEvents: [],
    })),
  ];
}
function resultLabel(value: AutomationHistoryCycle['result']) { return ({ ACTION_SELECTED: '행동 선택', WAITING: '대기', IDLE: '실행 없음', FATAL: '중지' } as const)[value]; }
function kindLabel(value: AutomationHistoryCycle['events'][number]['kind']) { return ({ EVALUATED: '판단', SELECTED: '선택', WAITING: '대기', SKIPPED: '스킵', CONFIGURATION_WARNING: '설정 경고', ACTION_STARTED: '실행 시작', ACTION_SUCCEEDED: '성공', ACTION_FAILED: '실패', CYCLE_COMPLETED: '사이클 완료', CYCLE_ABORTED: '사이클 중단' } as const)[value]; }
function messageLabel(value: AutomationHistoryCycle['events'][number]['kind']) { return ['EVALUATED', 'SELECTED', 'WAITING', 'SKIPPED', 'CONFIGURATION_WARNING'].includes(value) ? '판단 기준' : '처리 결과'; }
function statusSummaryLabel(kind: AutomationHistoryCycle['events'][number]['kind']) { return kind === 'ACTION_FAILED' ? '최근 막힘 사유' : kind === 'WAITING' ? '최근 항목 대기 사유' : '최근 자동화 단계'; }
function nextRunLabel(event: AutomationHistoryEvent) { return event.entryId == null ? '다음 확인' : '해당 항목 재확인'; }
function TypedWaitDiagnostic({ event }: { event: AutomationHistoryEvent }) {
  if (!event.diagnosticKind) return null;
  const isAlert = RAID_ALERT_DIAGNOSTICS.has(event.diagnosticKind);
  return <View accessible={isAlert || undefined} accessibilityRole={isAlert ? 'alert' : undefined} accessibilityLiveRegion={isAlert ? 'assertive' : undefined} style={styles.typedDiagnostic}>
    <Text style={styles.typedDiagnosticTitle}>구분  {diagnosticKindLabel(event.diagnosticKind)}</Text>
    {event.cooldownSource ? <Text style={styles.diagnostic}>출처  {cooldownSourceLabel(event.cooldownSource)}</Text> : null}
    {event.impactScope ? <Text style={styles.scope}>영향  {impactScopeLabel(event.impactScope)}</Text> : null}
    {event.releaseCondition ? <Text style={styles.releaseCondition}>해제  {event.releaseCondition}</Text> : null}
    {event.impactScope === 'RAID_ONLY' ? <Text style={styles.nonBattleNotice}>다른 자동화는 계속 진행됩니다.</Text> : null}
  </View>;
}
const RAID_ALERT_DIAGNOSTICS = new Set<NonNullable<AutomationHistoryEvent['diagnosticKind']>>([
  'RAID_COOLDOWN_OBSERVATION_HELD',
  'RAID_REWARD_OBSERVATION_HELD',
  'RAID_BATTLE_RESULT_UNKNOWN',
  'RAID_REWARD_RESULT_HELD',
]);
function diagnosticSummary(event: AutomationHistoryEvent) {
  return event.diagnosticKind ? diagnosticKindLabel(event.diagnosticKind) : reasonLabel(event.reasonCode);
}
function diagnosticKindLabel(value: NonNullable<AutomationHistoryEvent['diagnosticKind']>) {
  return ({
    RAID_HOF_COOLDOWN: 'HOF 관측 쿨타임',
    RAID_SINGLE_TARGET_TIMER: '단일 대상 추정 타이머',
    RAID_LOCAL_SAFETY_GATE: '로컬 안전 게이트',
    RAID_DEPLOYMENT_SAFETY_GATE: '배포 전환 안전 게이트',
    RAID_COOLDOWN_OBSERVATION_AMBIGUOUS: '쿨타임 관측 모호',
    RAID_COOLDOWN_OBSERVATION_HELD: '쿨타임 관측 수동 확인 필요',
    RAID_EXPLICIT_COOLDOWN_WAIT: '명시적 쿨타임 대기',
    RAID_REWARD_CONFIRMATION_WAIT: '보상 확인 대기',
    RAID_REWARD_RESULT_RECHECK: '보상 결과 재확인',
    RAID_REWARD_OBSERVATION_HELD: '보상 상태 관측 수동 확인 필요',
    RAID_BATTLE_RESULT_UNKNOWN: '레이드 전투 결과 미확정',
    RAID_REWARD_RESULT_HELD: '레이드 보상 수동 확인 필요',
  } as const)[value];
}
function cooldownSourceLabel(value: NonNullable<AutomationHistoryEvent['cooldownSource']>) {
  return ({
    HOF_DIRECT: 'HOF 직접 관측',
    HOF_SINGLE_TARGET_INFERENCE: 'HOF 단일 대상 타이머',
    LOCAL_FALLBACK: '로컬 안전 시간',
    DEPLOYMENT_FALLBACK: '배포 전환 안전 시간',
  } as const)[value];
}
function impactScopeLabel(value: NonNullable<AutomationHistoryEvent['impactScope']>) {
  return ({ RAID_ONLY: '레이드 전투만' } as const)[value];
}
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
function convergenceActionLabel(value: AutomationConvergenceActionKind) {
  return ({ QUEST_ACCEPT: '퀘스트 수락', QUEST_CLAIM: '퀘스트 보상', QUEST_BATTLE: '퀘스트 전투', HOME_ACCEPT: '자택 퀘스트 수락', HOME_CLAIM: '자택 퀘스트 완료', MAP_BATTLE: '전투 맵 실행', ADVENTURE_BATTLE: '모험 맵 전투', UNION_BATTLE: '유니온 전투', FISHING_START: '낚시 시작', FISHING_CATCH: '낚기', FISHING_OBSTRUCTION_BATTLE: '낚시 방해 전투', RAID_RESET: '레이드 리셋', RAID_REGISTER: '레이드 등록', RAID_START: '레이드 시작', RAID_REWARD: '레이드 보상', RAID_REFRESH: '레이드 상태 갱신', RAID_BATTLE: '레이드 전투', RAID_CYCLE_ABORT: '레이드 사이클 종료' } as const)[value];
}
function convergenceResultLabel(value: AutomationConvergenceStatus['items'][number]['result']) {
  return value === 'PENDING' ? '결과 확인 중' : value === 'HELD' ? '보류된 결과' : value === 'RESULT_UNOBSERVED' ? '결과 미관측' : '확인 완료';
}
const styles = StyleSheet.create({ scroller: { flex: 1 }, container: { gap: theme.spacing.md, padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }, header: { alignItems: 'center', backgroundColor: theme.colors.background, flexDirection: 'row', gap: 8 }, back: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 }, title: { color: theme.colors.text, fontSize: 21, fontWeight: '900' }, subtitle: { color: theme.colors.textMuted, fontSize: 12, marginTop: 3 }, convergenceSection: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 8, padding: theme.spacing.md }, convergenceHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, convergenceEyebrow: { color: theme.colors.accentBlue, fontSize: 10, fontWeight: '900' }, convergenceHeading: { color: theme.colors.text, fontSize: 14, fontWeight: '900', marginTop: 3 }, refreshButton: { borderColor: theme.colors.border, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 }, refreshText: { color: theme.colors.text, fontSize: 11, fontWeight: '800' }, gateCard: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.danger, borderRadius: 9, borderWidth: 1, padding: 10 }, gateTitle: { color: theme.colors.danger, fontSize: 14, fontWeight: '900' }, convergenceCard: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 9, padding: 10 }, convergenceResult: { color: theme.colors.accentBlue, fontSize: 10, fontWeight: '900' }, convergenceTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '900', marginTop: 3 }, convergenceMessage: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 5 }, scope: { color: theme.colors.text, fontSize: 11, fontWeight: '700', marginTop: 5 }, observation: { color: theme.colors.accentBlue, fontSize: 11, fontWeight: '900', marginTop: 5 }, releaseCondition: { color: theme.colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 4 }, nonBattleNotice: { color: theme.colors.accentGreen, fontSize: 10, fontWeight: '800', marginTop: 5 }, releaseButton: { alignItems: 'center', borderColor: theme.colors.accentBlue, borderRadius: 8, borderWidth: 1, marginTop: 8, minHeight: 40, justifyContent: 'center' }, releaseButtonText: { color: theme.colors.accentBlue, fontSize: 11, fontWeight: '900' }, convergenceEmpty: { color: theme.colors.textMuted, fontSize: 11, paddingVertical: 6, textAlign: 'center' }, statusSummary: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.accentBlue, borderRadius: theme.radius.md, borderWidth: 1, padding: theme.spacing.md }, statusEyebrow: { color: theme.colors.accentBlue, fontSize: 11, fontWeight: '900' }, statusTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '900', marginTop: 5 }, statusMessage: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 7 }, statusDiagnostic: { color: theme.colors.accentBlue, fontSize: 10, lineHeight: 15, marginTop: 5 }, typedDiagnostic: { backgroundColor: theme.colors.surface, borderRadius: 7, marginTop: 7, padding: 8 }, typedDiagnosticTitle: { color: theme.colors.accentBlue, fontSize: 11, fontWeight: '900' }, cycle: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 7, padding: theme.spacing.md }, cycleHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' }, time: { color: theme.colors.text, fontSize: 12, fontWeight: '800' }, cycleMeta: { color: theme.colors.textMuted, fontSize: 10, marginTop: 3 }, result: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '800' }, event: { alignItems: 'flex-start', borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, paddingTop: 8 }, sequence: { color: theme.colors.textMuted, fontSize: 11, width: 18 }, eventCopy: { flex: 1 }, eventTitle: { color: theme.colors.text, fontSize: 12, fontWeight: '800' }, eventTime: { color: theme.colors.textMuted, fontSize: 10, marginTop: 3 }, target: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800', marginTop: 5 }, factGroup: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 7, gap: 3, marginTop: 6, padding: 7 }, fact: { color: theme.colors.text, fontSize: 11 }, factLabel: { color: theme.colors.textMuted, fontWeight: '700' }, details: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 }, detailChip: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 7, color: theme.colors.text, fontSize: 11, paddingHorizontal: 7, paddingVertical: 4 }, criteria: { color: theme.colors.text, fontWeight: '700' }, message: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 5 }, diagnostic: { color: theme.colors.textMuted, fontSize: 10, marginTop: 3 }, executionGroup: { borderLeftColor: theme.colors.accentGreen, borderLeftWidth: 2, gap: 7, marginTop: 9, paddingLeft: 9 }, executionHeading: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '900' }, executionEvent: { borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 7 }, next: { color: theme.colors.accentBlue, fontSize: 11, marginTop: 3 }, empty: { color: theme.colors.textMuted, padding: theme.spacing.xl, textAlign: 'center' }, error: { color: theme.colors.danger }, link: { color: theme.colors.accentGreen, fontWeight: '800' }, more: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, minHeight: 46, justifyContent: 'center' }, moreText: { color: theme.colors.text, fontWeight: '800' } });
