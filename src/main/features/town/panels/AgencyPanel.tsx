import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type { QuestSection, QuestSnapshot, TownActionResultResponse, TownRowResponse } from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { TownMutationBusyError, useTownFeature } from '../hooks/useTownFeature';

type Tab = 'ACTIVE' | 'AVAILABLE' | 'WAITING';
type Mutation = { actionNo: string; action: 'accept' | 'claim' };

export function AgencyPanel({ api, resolveCaptcha }: { api: TownApi; resolveCaptcha?: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Mutation | null>(null);
  const [response, setResponse] = useState<QuestSnapshot[] | null>(null);
  const staged = useRef<QuestSnapshot[] | null>(null);
  const apiKey = identifyApi(api);
  const load = useCallback(() => api.loadQuests(), [api]);
  const submitAction = useCallback(async (mutation: Mutation) => {
    const next = mutation.action === 'accept' ? await api.acceptQuest(mutation.actionNo) : await api.claimQuest(mutation.actionNo);
    staged.current = next;
    return information(mutation.action === 'accept' ? '퀘스트를 수락했습니다.' : '퀘스트 완료 보상을 받았습니다.');
  }, [api]);
  const town = useTownFeature<QuestSnapshot[], Mutation>({ load, submitAction, resolveCaptcha, featureKey: `agency-manual-${apiKey}` });
  const data = response ?? town.data ?? [];
  useEffect(() => { staged.current = null; setResponse(null); setSelectedId(null); setConfirmation(null); }, [apiKey]);
  useEffect(() => { setSelectedId(null); setConfirmation(null); }, [tab]);
  useEffect(() => {
    if (selectedId && !data.some((item) => rowId(item) === selectedId)) setSelectedId(null);
  }, [data, selectedId]);

  const filtered = useMemo(() => data.filter((quest) => tabMatches(quest.section, tab))
    .filter((quest) => `${quest.displayCode} ${quest.name} ${quest.missions.map((mission) => mission.target ?? '').join(' ')}`.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR'))), [data, query, tab]);
  const selected = data.find((item) => rowId(item) === selectedId);
  const mutation = selected?.actionNo && (selected.state === 'AVAILABLE' || selected.state === 'CLAIMABLE')
    ? { actionNo: selected.actionNo, action: selected.state === 'AVAILABLE' ? 'accept' as const : 'claim' as const }
    : null;
  const rows = filtered.map(toRow);
  const finish = (result: TownActionResultResponse) => {
    if (staged.current) setResponse(staged.current);
    staged.current = null; setConfirmation(null); setSelectedId(null);
    return result;
  };
  const submit = () => {
    if (!confirmation) return;
    void town.submit(confirmation).then(finish).catch((error: unknown) => { if (!(error instanceof TownMutationBusyError)) setConfirmation(null); });
  };

  if (!town.data && town.status === 'loading') return <Text style={styles.hint}>퀘스트를 불러오는 중...</Text>;
  return <View style={styles.container}>
    <Text style={styles.title}>모험 알선소</Text>
    <View accessibilityRole="tablist" style={styles.tabs}>{(['ACTIVE', 'AVAILABLE', 'WAITING'] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.tabSelected]}><Text style={styles.tabText}>{tabLabel(value)} {data.filter((quest) => tabMatches(quest.section, value)).length}</Text></Pressable>)}</View>
    <TextInput accessibilityLabel="퀘스트명 또는 미션 검색" value={query} onChangeText={setQuery} placeholder="퀘스트명 또는 미션 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} />
    <TownItemList rows={rows} selectionMode="single" selectedIds={selectedId ? [selectedId] : []} onSelectionChange={(ids) => setSelectedId(ids[0] ?? null)} emptyMessage="해당 상태의 퀘스트가 없습니다."
      footer={<View style={styles.footer}>{mutation ? <ActionButton label={mutation.action === 'accept' ? '수동 수락' : '수동 완료'} disabled={town.status === 'submitting'} onPress={() => setConfirmation(mutation)} /> : <Text style={styles.hint}>수락 또는 완료 가능한 퀘스트를 선택하세요.</Text>}{town.result ? <TownActionResult result={town.result} onRefresh={() => { setResponse(null); void town.reload().catch(() => undefined); }} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}</View>} />
    <TownConfirmSheet visible={confirmation != null} title={confirmation?.action === 'accept' ? '퀘스트 수락 확인' : '퀘스트 완료 확인'} message="HOF에 이 action을 한 번만 요청합니다." confirmLabel={confirmation?.action === 'accept' ? '수락' : '완료'} submitting={town.status === 'submitting'} details={[{ label: '퀘스트', value: selected?.name ?? '선택 없음' }]} onCancel={() => setConfirmation(null)} onConfirm={submit} />
  </View>;
}

function tabMatches(section: QuestSection, tab: Tab) { return tab === 'ACTIVE' ? section === 'ACTIVE' : section === tab; }
function tabLabel(tab: Tab) { return tab === 'ACTIVE' ? '진행 중' : tab === 'AVAILABLE' ? '수락 가능' : '대기 중'; }
function rowId(quest: QuestSnapshot) { return `quest:${quest.questKey}:${quest.sourceOrder}`; }
function toRow(quest: QuestSnapshot): TownRowResponse { const progress = quest.missions.map((mission) => mission.progress ? `${mission.target ?? '미션'} ${mission.progress.current}/${mission.progress.required}` : mission.target).filter(Boolean).join(' · '); return { id: rowId(quest), label: quest.name, accessibilityLabel: `${quest.name} ${quest.state === 'CLAIMABLE' ? '완료 가능' : tabState(quest)}`, selectable: quest.actionNo != null && (quest.state === 'AVAILABLE' || quest.state === 'CLAIMABLE'), detail: [quest.displayCode, progress, quest.rewards.length ? `보상 ${quest.rewards.join(', ')}` : null].filter(Boolean).join(' · '), imageUrl: null, price: null, quantity: null }; }
function tabState(quest: QuestSnapshot) { return quest.section === 'ACTIVE' ? '진행 중' : quest.section === 'AVAILABLE' ? '수락 가능' : '대기 중'; }
function information(message: string): TownActionResultResponse { return { status: 'SUCCESS', messages: [message], items: [], refreshRequired: true }; }
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;
function identifyApi(api: TownApi) { const object = api as object; const known = apiKeys.get(object); if (known != null) return known; const next = nextApiKey++; apiKeys.set(object, next); return next; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, tabs: { flexDirection: 'row', gap: theme.spacing.xs }, tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomColor: theme.colors.borderStrong, borderBottomWidth: 2 }, tabSelected: { borderBottomColor: theme.colors.accentGreen }, tabText: { color: theme.colors.text, fontWeight: '800' }, input: { minHeight: 44, borderColor: theme.colors.borderStrong, borderWidth: 1, borderRadius: theme.radius.md, color: theme.colors.text, paddingHorizontal: theme.spacing.md }, footer: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md }, hint: { color: theme.colors.textMuted }, error: { color: theme.colors.danger }, button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 } });
