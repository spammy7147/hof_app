import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type { HomeActionRequest, HomeResponse, RestStatusResponse, TownActionResultResponse, TownRowResponse } from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type Mode = 'home' | 'rest';
type HomeMutation = HomeActionRequest & { itemLabel: string; actionLabel: string; expectedRecovery: string | null; overflow: string | null };

export function HomePanel({ api, mode, resolveCaptcha }: { api: TownApi; mode: Mode; resolveCaptcha?: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [response, setResponse] = useState<HomeResponse | null>(null);
  const [facilitiesExpanded, setFacilitiesExpanded] = useState(false);
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
  useEffect(() => { staged.current = null; setResponse(null); setSelectedId(null); setFacilitiesExpanded(false); }, [api, mode]);
  useEffect(() => {
    if (selectedId && data && !rowsOf(data).some((row) => row.id === selectedId)) setSelectedId(null);
  }, [data, selectedId]);
  if (!data) return <View style={styles.container}><Text accessibilityRole={town.error ? 'alert' : undefined} style={town.error ? styles.error : styles.hint}>{town.status === 'loading' ? '정보를 불러오는 중...' : town.error ?? '표시할 정보가 없습니다.'}</Text><ActionButton label="다시 시도" disabled={town.status === 'loading'} onPress={() => void town.reload().catch(() => undefined)} /></View>;
  const selectedQuest = data.quests.find((quest) => `quest:${quest.id}` === selectedId);
  const restAction = mode === 'rest' ? data.actions.find((action) => action.type === 'RESTORE') : null;
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
  const result = data.result ?? town.result;
  return <View style={styles.container}>
    <Text style={styles.title}>{mode === 'home' ? '자택 관리' : '휴식처'}</Text>
    {mode === 'home' ? <Text style={styles.hint}>자택 퀘스트는 수락 → 조건 달성 → 완료 순서로 표시됩니다.</Text> : null}
    <TownItemList rows={mode === 'home' ? rowsOf(data) : []} selectionMode={mode === 'home' ? 'single' : 'none'} selectedIds={selectedId ? [selectedId] : []} onSelectionChange={mode === 'home' ? (ids) => setSelectedId(ids[0] ?? null) : undefined} emptyMessage={mode === 'home' ? '표시할 자택 퀘스트가 없습니다.' : null}
      header={mode === 'rest' && data.restStatus ? <RestStatusCard status={data.restStatus} expanded={facilitiesExpanded} onToggle={() => setFacilitiesExpanded((value) => !value)} /> : null}
      footer={<View style={styles.footer}>
        {mode === 'rest' && result ? <TownActionResult result={result} showStatusLabel={false} /> : null}
        {mutation ? <ActionButton label={mutation.actionLabel} disabled={town.status === 'submitting'} onPress={submit} /> : <Text style={styles.hint}>{mode === 'home' ? '수락 또는 완료 가능한 퀘스트를 선택하세요.' : '현재 휴식을 이용할 수 없습니다.'}</Text>}
        {mode === 'home' && result ? <TownActionResult result={result} onRefresh={() => { setResponse(null); void town.reload().catch(() => undefined); }} /> : null}
        {town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
      </View>} />
  </View>;
}

function RestStatusCard({ status, expanded, onToggle }: { status: RestStatusResponse; expanded: boolean; onToggle: () => void }) {
  const preview = recoveryPreview(status);
  return <View style={styles.statusCard}>
    <Text style={styles.statusTitle}>현재 휴식 상태</Text>
    {status.currentTime != null && status.maxTime != null ? <Text style={styles.statusText}>Time {status.currentTime.toLocaleString()} / {status.maxTime.toLocaleString()}</Text> : null}
    {status.baseRecovery != null ? <Text style={styles.statusText}>기본 회복 {status.baseRecovery.toLocaleString()} Time</Text> : null}
    {status.facilityRecovery != null ? <Text style={styles.statusText}>시설 추가 회복 {status.facilityRecovery.toLocaleString()} Time</Text> : null}
    {preview ? <Text style={styles.statusText}>현재 예상 회복 {preview.expected} · 초과 {preview.overflow}</Text> : null}
    {status.usedToday != null ? <Text style={styles.statusText}>{status.usedToday ? '오늘 이미 사용함' : '오늘 사용 가능'}</Text> : null}
    {status.facilities.length ? <><Pressable accessibilityRole="button" accessibilityLabel={`보유 시설 ${expanded ? '접기' : '펼치기'}`} accessibilityState={{ expanded }} onPress={onToggle} style={styles.facilityButton}><Text style={styles.facilityButtonText}>보유 시설 {status.facilities.length}개 {expanded ? '접기' : '보기'}</Text></Pressable>{expanded ? <View accessibilityLabel="보유 시설 목록" style={styles.facilityList}>{status.facilities.map((facility, index) => <Text key={`${facility}-${index}`} style={styles.statusText}>• {facility}</Text>)}</View> : null}</> : null}
  </View>;
}

function recoveryPreview(status: RestStatusResponse | null) {
  if (!status || status.currentTime == null || status.maxTime == null || status.baseRecovery == null || status.facilityRecovery == null) return null;
  const total = Math.max(0, status.baseRecovery + status.facilityRecovery);
  const capacity = Math.max(0, status.maxTime - status.currentTime);
  const expected = Math.min(total, capacity);
  return { expected: `${expected.toLocaleString()} Time`, overflow: `${Math.max(0, total - capacity).toLocaleString()} Time` };
}

function rowsOf(data: HomeResponse): TownRowResponse[] { return data.mode === 'HOME' ? data.quests.map((quest) => ({ id: `quest:${quest.id}`, label: quest.name, accessibilityLabel: `${quest.name} ${stateLabel(quest.state)}`, selectable: quest.actionId != null && (quest.state === 'AVAILABLE' || quest.state === 'CLAIMABLE'), detail: uniqueDetails([stateLabel(quest.state), ...(quest.details ?? []), quest.mission, quest.reward ? `보상 ${quest.reward}` : null]).join(' · '), imageUrl: null, price: null, quantity: null })) : data.actions.map((action) => ({ id: `action:${action.id}`, label: action.label, accessibilityLabel: `${action.label} 선택`, selectable: action.type === 'RESTORE', detail: '수동 복구 action', imageUrl: null, price: null, quantity: null })); }
function uniqueDetails(values: Array<string | null>) { return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))]; }
function stateLabel(state: HomeResponse['quests'][number]['state']) { return ({ AVAILABLE: '수락 가능', ACTIVE: '조건 달성 중', CLAIMABLE: '완료 가능', COMPLETED: '완료', WAITING: '대기 중' } as const)[state]; }
function information(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;
function identifyApi(api: TownApi) { const object = api as object; const known = apiKeys.get(object); if (known != null) return known; const next = nextApiKey++; apiKeys.set(object, next); return next; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, hint: { color: theme.colors.textMuted, lineHeight: 20 }, error: { color: theme.colors.danger, lineHeight: 20 }, footer: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md }, statusCard: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.xs, marginBottom: theme.spacing.md, padding: theme.spacing.md }, statusTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '900' }, statusText: { color: theme.colors.textMuted, lineHeight: 20 }, facilityButton: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: 44, marginTop: theme.spacing.xs }, facilityButtonText: { color: theme.colors.text, fontWeight: '800' }, facilityList: { gap: theme.spacing.xs }, button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 } });
