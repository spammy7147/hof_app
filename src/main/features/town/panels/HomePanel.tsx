import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type { HomeActionRequest, HomeResponse, RestStatusResponse, TownActionResultResponse, TownRowResponse } from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type Mode = 'home' | 'rest';
type HomeTab = HomeResponse['quests'][number]['state'];
type HomeMutation = HomeActionRequest & { itemLabel: string; actionLabel: string; expectedRecovery: string | null; overflow: string | null };

const HOME_TABS: readonly HomeTab[] = ['ACTIVE', 'CLAIMABLE', 'AVAILABLE', 'WAITING', 'COMPLETED'];

export function HomePanel({ api, mode, resolveCaptcha }: { api: TownApi; mode: Mode; resolveCaptcha?: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [homeTab, setHomeTab] = useState<HomeTab>('ACTIVE');
  const [response, setResponse] = useState<HomeResponse | null>(null);
  const staged = useRef<HomeResponse | null>(null);
  const path = mode === 'home' ? '/api/town/home' as const : '/api/town/rest' as const;
  const apiKey = identifyApi(api);
  const load = useCallback(() => api.load<HomeResponse>(path), [api, path]);
  const submitAction = useCallback(async (request: HomeMutation) => {
    const next = await api.submit<HomeActionRequest, HomeResponse>(mode === 'home' ? '/api/town/home/quests' : '/api/town/rest/restore', { actionId: request.actionId });
    staged.current = next;
    return next.result ?? information(mode === 'home' ? '자택 퀘스트 상태를 갱신했습니다.' : '휴식처 복구 action을 실행했습니다.');
  }, [api, mode]);
  const town = useTownFeature<HomeResponse, HomeMutation>({ load, submitAction, resolveCaptcha, featureKey: `home-${apiKey}-${mode}` });
  const data = response ?? town.data;
  useEffect(() => { staged.current = null; setResponse(null); setSelectedId(null); setHomeTab('ACTIVE'); }, [api, mode]);
  const visibleQuests = mode === 'home' ? data?.quests.filter((quest) => quest.state === homeTab) ?? [] : [];
  const rows = mode === 'home' && data ? questRows(visibleQuests) : [];
  useEffect(() => {
    if (selectedId && data && !rows.some((row) => row.id === selectedId)) setSelectedId(null);
  }, [data, rows, selectedId]);
  if (!data) return <View style={styles.container}><Text accessibilityRole={town.error ? 'alert' : undefined} style={town.error ? styles.error : styles.hint}>{town.status === 'loading' ? '정보를 불러오는 중...' : town.error ?? '표시할 정보가 없습니다.'}</Text><ActionButton label="다시 시도" disabled={town.status === 'loading'} onPress={() => void town.reload().catch(() => undefined)} /></View>;
  const result = data.result ?? town.result;
  const restCompleted = mode === 'rest' && (data.restStatus?.usedToday === true || result?.status === 'SUCCESS');
  const selectedQuest = visibleQuests.find((quest) => `quest:${quest.id}` === selectedId);
  const restAction = mode === 'rest' && !restCompleted ? data.actions.find((action) => action.type === 'RESTORE') : null;
  const actionId = selectedQuest?.actionId ?? restAction?.id ?? null;
  const label = selectedQuest?.state === 'AVAILABLE' ? '수락' : selectedQuest?.state === 'CLAIMABLE' ? '완료' : restAction ? '휴식을 취한다' : null;
  const recovery = mode === 'rest' ? recoveryPreview(data.restStatus) : null;
  const mutation = actionId && label ? {
    actionId,
    itemLabel: selectedQuest?.name ?? restAction?.label ?? '선택 없음',
    actionLabel: label,
    expectedRecovery: mode === 'rest' ? recovery?.expected ?? '확인 불가' : null,
    overflow: mode === 'rest' ? recovery?.overflow ?? '확인 불가' : null,
  } : null;
  const finish = (result: TownActionResultResponse) => { if (staged.current) setResponse(staged.current); staged.current = null; setSelectedId(null); return result; };
  const submit = () => {
    if (!mutation) return;
    void town.submit(mutation).then(finish).catch(() => undefined);
  };
  return <View style={styles.container}>
    <Text style={styles.title}>{mode === 'home' ? '자택 관리' : '휴식처'}</Text>
    {mode === 'home' ? <Text style={styles.hint}>자택 퀘스트는 수락 → 조건 달성 → 완료 순서로 표시됩니다.</Text> : null}
    {mode === 'home' ? <HomeQuestTabs quests={data.quests} selected={homeTab} onSelect={(tab) => { setHomeTab(tab); setSelectedId(null); }} /> : null}
    <TownItemList rows={rows} selectionMode={mode === 'home' ? 'single' : 'none'} selectedIds={selectedId ? [selectedId] : []} onSelectionChange={mode === 'home' ? (ids) => setSelectedId(ids[0] ?? null) : undefined} emptyMessage={mode === 'home' ? `${homeTabLabel(homeTab)} 자택 퀘스트가 없습니다.` : null}
      header={mode === 'rest' && data.restStatus ? <RestStatusCard status={data.restStatus} result={result} error={town.error} /> : null}
      footer={<View style={styles.footer}>
        {mutation ? <ActionButton label={mutation.actionLabel} disabled={town.status === 'submitting'} onPress={submit} /> : mode === 'home' ? <Text style={styles.hint}>수락 또는 완료 가능한 퀘스트를 선택하세요.</Text> : !restCompleted ? <Text style={styles.hint}>현재 휴식을 이용할 수 없습니다.</Text> : null}
        {mode === 'rest' && data.restStatus?.facilities.length ? <RestFacilities facilities={data.restStatus.facilities} /> : null}
        {mode === 'home' && result ? <TownActionResult result={result} onRefresh={() => { setResponse(null); void town.reload().catch(() => undefined); }} /> : null}
        {mode === 'home' && town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
      </View>} />
  </View>;
}

function HomeQuestTabs({ quests, selected, onSelect }: { quests: HomeResponse['quests']; selected: HomeTab; onSelect: (tab: HomeTab) => void }) {
  return <View accessibilityRole="tablist" style={styles.tabs}>
    {HOME_TABS.map((tab) => {
      const count = quests.filter((quest) => quest.state === tab).length;
      const label = `${homeTabLabel(tab)} ${count}`;
      return <Pressable
        key={tab}
        accessibilityLabel={label}
        accessibilityRole="tab"
        accessibilityState={{ selected: selected === tab }}
        onPress={() => onSelect(tab)}
        style={[styles.tab, selected === tab && styles.tabSelected]}
      ><Text numberOfLines={1} style={styles.tabText}>{label}</Text></Pressable>;
    })}
  </View>;
}

function RestStatusCard({ status, result, error }: { status: RestStatusResponse; result: TownActionResultResponse | null; error: string | null }) {
  const preview = recoveryPreview(status);
  const completed = status.usedToday === true || result?.status === 'SUCCESS';
  const recovered = result?.status === 'SUCCESS' ? recoveredTime(result.messages) : null;
  const resultMessages = result?.status !== 'SUCCESS' ? result?.messages ?? [] : [];
  const informational = result?.status === 'INFORMATIONAL';
  const problems = [...new Set([...(informational ? [] : resultMessages), error].filter((message): message is string => Boolean(message?.trim())).map((message) => message.trim()))];
  return <View accessibilityLabel="현재 휴식 상태" accessibilityLiveRegion="polite" style={styles.statusCard}>
    <Text style={styles.statusTitle}>현재 휴식 상태</Text>
    {status.currentTime != null && status.maxTime != null ? <Text style={styles.statusText}>Time {status.currentTime.toLocaleString()} / {status.maxTime.toLocaleString()}</Text> : null}
    {status.baseRecovery != null ? <Text style={styles.statusText}>기본 회복 {status.baseRecovery.toLocaleString()} Time</Text> : null}
    {status.facilityRecovery != null ? <Text style={styles.statusText}>시설 추가 회복 {status.facilityRecovery.toLocaleString()} Time</Text> : null}
    {preview && !completed ? <Text style={styles.statusText}>현재 예상 회복 {preview.expected} · 초과 {preview.overflow}</Text> : null}
    {completed ? <View accessibilityLabel={`휴식 완료${recovered ? `, ${recovered} Time 회복` : ''}`} style={styles.completion}>
      <View style={styles.completionIcon}><Text style={styles.completionMark}>✓</Text></View>
      <View style={styles.completionCopy}>
        <Text style={styles.completionTitle}>오늘의 휴식 완료</Text>
        {recovered ? <Text style={styles.completionDetail}>+{recovered} Time 회복</Text> : null}
      </View>
    </View> : status.usedToday === false ? <View style={styles.availability}><View style={styles.availabilityDot} /><Text style={styles.availabilityText}>오늘 사용 가능</Text></View> : null}
    {informational && resultMessages.length ? <View style={styles.restNotice}>{resultMessages.map((message, index) => <Text key={`${message}-${index}`} style={styles.statusText}>{message}</Text>)}</View> : null}
    {problems.length ? <View style={styles.restProblems}>{problems.map((message, index) => <Text accessibilityRole="alert" key={`${message}-${index}`} style={styles.restProblem}>{message}</Text>)}</View> : null}
  </View>;
}

function RestFacilities({ facilities }: { facilities: string[] }) {
  return <View accessibilityLabel="보유 시설 목록" style={styles.facilities}>
    <View style={styles.facilitiesHeading}>
      <Text style={styles.facilitiesTitle}>보유 시설</Text>
      <Text style={styles.facilitiesCount}>{facilities.length}개</Text>
    </View>
    {facilities.map((facility, index) => {
      const display = facilityDisplay(facility);
      return <View key={`${facility}-${index}`} style={styles.facilityCard}>
        <View style={styles.facilityCopy}>
          <Text numberOfLines={1} style={styles.facilityName}>{display.name}</Text>
          {display.detail ? <Text numberOfLines={2} style={styles.facilityDetail}>{display.detail}</Text> : null}
        </View>
        {display.quantity ? <Text style={styles.facilityQuantity}>{display.quantity}</Text> : null}
      </View>;
    })}
  </View>;
}

function facilityDisplay(value: string) {
  const trimmed = value.trim();
  const quantityMatch = /사용 가능 개수\s*:\s*([^\s]+)/.exec(trimmed);
  const quantity = quantityMatch?.[1] ?? null;
  const withoutQuantity = quantityMatch ? trimmed.replace(quantityMatch[0], '').trim() : trimmed;
  const dotted = withoutQuantity.split(/\s*·\s*/).filter(Boolean);
  if (dotted.length > 1) return { name: dotted[0], detail: dotted.slice(1).join(' · '), quantity };
  const named = /^(.+?\([^()]+\))\s+(.+)$/.exec(withoutQuantity);
  if (named) return { name: named[1], detail: named[2], quantity };
  const detailAt = withoutQuantity.search(/\s+(?=(?:효과|설명)\s*:)/);
  if (detailAt > 0) return { name: withoutQuantity.slice(0, detailAt), detail: withoutQuantity.slice(detailAt).trim(), quantity };
  return { name: withoutQuantity, detail: null, quantity };
}

function recoveryPreview(status: RestStatusResponse | null) {
  if (!status || status.currentTime == null || status.maxTime == null || status.baseRecovery == null || status.facilityRecovery == null) return null;
  const total = Math.max(0, status.baseRecovery + status.facilityRecovery);
  const capacity = Math.max(0, status.maxTime - status.currentTime);
  const expected = Math.min(total, capacity);
  return { expected: `${expected.toLocaleString()} Time`, overflow: `${Math.max(0, total - capacity).toLocaleString()} Time` };
}

function recoveredTime(messages: string[]): string | null {
  for (const message of messages) {
    const match = /Time(?:이)?\s*([\d,]+)\s*회복/.exec(message);
    if (match) return match[1];
  }
  return null;
}

function questRows(quests: HomeResponse['quests']): TownRowResponse[] { return quests.map((quest) => ({ id: `quest:${quest.id}`, label: quest.name, accessibilityLabel: `${quest.name} ${stateLabel(quest.state)}`, selectable: quest.actionId != null && (quest.state === 'AVAILABLE' || quest.state === 'CLAIMABLE'), detail: uniqueDetails([stateLabel(quest.state), ...(quest.details ?? []), quest.mission, quest.reward ? `보상 ${quest.reward}` : null]).join(' · '), imageUrl: null, price: null, quantity: null })); }
function uniqueDetails(values: Array<string | null>) { return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))]; }
function stateLabel(state: HomeResponse['quests'][number]['state']) { return ({ AVAILABLE: '수락 가능', ACTIVE: '조건 달성 중', CLAIMABLE: '완료 가능', COMPLETED: '완료', WAITING: '대기 중' } as const)[state]; }
function homeTabLabel(tab: HomeTab) { return ({ ACTIVE: '진행 중', CLAIMABLE: '완료 가능', AVAILABLE: '수락 가능', WAITING: '대기 중', COMPLETED: '완료' } as const)[tab]; }
function information(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;
function identifyApi(api: TownApi) { const object = api as object; const known = apiKeys.get(object); if (known != null) return known; const next = nextApiKey++; apiKeys.set(object, next); return next; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, hint: { color: theme.colors.textMuted, lineHeight: 20 }, error: { color: theme.colors.danger, lineHeight: 20 }, tabs: { flexDirection: 'row', gap: theme.spacing.xs }, tab: { alignItems: 'center', borderBottomColor: theme.colors.borderStrong, borderBottomWidth: 2, flex: 1, justifyContent: 'center', minHeight: 44, minWidth: 0 }, tabSelected: { borderBottomColor: theme.colors.accentGreen }, tabText: { color: theme.colors.text, fontSize: 12, fontWeight: '800' }, footer: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md }, statusCard: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.xs, marginBottom: theme.spacing.md, padding: theme.spacing.md }, statusTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '900' }, statusText: { color: theme.colors.textMuted, lineHeight: 20 }, availability: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs }, availabilityDot: { backgroundColor: theme.colors.accentGreen, borderRadius: 4, height: 8, width: 8 }, availabilityText: { color: theme.colors.accentGreen, fontSize: 13, fontWeight: '800' }, completion: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm, padding: theme.spacing.md }, completionIcon: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: 16, height: 32, justifyContent: 'center', width: 32 }, completionMark: { color: theme.colors.buttonText, fontSize: 18, fontWeight: '900', lineHeight: 20 }, completionCopy: { flex: 1, gap: 2 }, completionTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '900' }, completionDetail: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800' }, facilities: { gap: 6, marginTop: theme.spacing.xs }, facilitiesHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }, facilitiesTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '900' }, facilitiesCount: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' }, facilityCard: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 52, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }, facilityCopy: { flex: 1, gap: 2 }, facilityName: { color: theme.colors.text, fontSize: 13, fontWeight: '800' }, facilityDetail: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 15 }, facilityQuantity: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, color: theme.colors.accentGreen, fontSize: 11, fontWeight: '900', overflow: 'hidden', paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs }, restNotice: { borderTopColor: theme.colors.border, borderTopWidth: 1, gap: theme.spacing.xs, marginTop: theme.spacing.sm, paddingTop: theme.spacing.sm }, restProblems: { borderTopColor: theme.colors.border, borderTopWidth: 1, gap: theme.spacing.xs, marginTop: theme.spacing.sm, paddingTop: theme.spacing.sm }, restProblem: { color: theme.colors.danger, fontSize: 13, lineHeight: 20 }, button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 } });
