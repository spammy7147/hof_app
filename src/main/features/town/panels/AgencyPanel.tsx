import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type { QuestSection, QuestSnapshot, RecruitCharacterRequest, RecruitmentResponse, TownActionResultResponse, TownRowResponse } from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { TownMutationBusyError, useTownFeature } from '../hooks/useTownFeature';

type Tab = 'ACTIVE' | 'AVAILABLE' | 'WAITING';
type Mutation = { actionNo: string; action: 'accept' | 'claim'; questName: string };

export function AgencyPanel({ api, resolveCaptcha, mode = 'adventure' }: { api: TownApi; resolveCaptcha?: () => Promise<void>; mode?: 'adventure' | 'recruitment' }) {
  return mode === 'recruitment'
    ? <RecruitmentAgencyPanel api={api} resolveCaptcha={resolveCaptcha} />
    : <AdventureAgencyPanel api={api} resolveCaptcha={resolveCaptcha} />;
}

function AdventureAgencyPanel({ api, resolveCaptcha }: { api: TownApi; resolveCaptcha?: () => Promise<void> }) {
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
    return information(mutation.action === 'accept' ? '퀘스트 수락 요청 후 목록을 갱신했습니다.' : '퀘스트 완료 요청 후 목록을 갱신했습니다.');
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
    ? { actionNo: selected.actionNo, action: selected.state === 'AVAILABLE' ? 'accept' as const : 'claim' as const, questName: selected.name }
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
    <TownConfirmSheet visible={confirmation != null} title={confirmation?.action === 'accept' ? '퀘스트 수락 확인' : '퀘스트 완료 확인'} message="HOF에 이 action을 한 번만 요청합니다." confirmLabel={confirmation?.action === 'accept' ? '수락' : '완료'} submitting={town.status === 'submitting'} details={[{ label: '퀘스트', value: confirmation?.questName ?? '선택 없음' }]} onCancel={() => setConfirmation(null)} onConfirm={submit} />
  </View>;
}

type RecruitConfirmation = RecruitCharacterRequest & { jobName: string; genderLabel: string; price: number };

function RecruitmentAgencyPanel({ api, resolveCaptcha }: { api: TownApi; resolveCaptcha?: () => Promise<void> }) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedGenderId, setSelectedGenderId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [confirmation, setConfirmation] = useState<RecruitConfirmation | null>(null);
  const [response, setResponse] = useState<RecruitmentResponse | null>(null);
  const staged = useRef<RecruitmentResponse | null>(null);
  const apiKey = identifyApi(api);
  const load = useCallback(() => api.load<RecruitmentResponse>('/api/town/agency/recruitment'), [api]);
  const submitAction = useCallback(async (request: RecruitCharacterRequest) => {
    const next = await api.submit<RecruitCharacterRequest, RecruitmentResponse>('/api/town/agency/recruitment', request);
    staged.current = next;
    return next.result ?? information('모집 요청 후 인재 알선소 정보를 갱신했습니다.');
  }, [api]);
  const town = useTownFeature<RecruitmentResponse, RecruitCharacterRequest>({
    load,
    submitAction,
    resolveCaptcha,
    featureKey: `agency-recruitment-${apiKey}`,
  });
  const data = response ?? town.data;

  useEffect(() => {
    staged.current = null;
    setResponse(null);
    setSelectedJobId(null);
    setSelectedGenderId(null);
    setName('');
    setConfirmation(null);
  }, [apiKey]);
  useEffect(() => {
    if (selectedJobId && !data?.jobs.some((job) => job.id === selectedJobId)) setSelectedJobId(null);
    if (selectedGenderId && !data?.genders.some((gender) => gender.id === selectedGenderId)) setSelectedGenderId(null);
  }, [data, selectedGenderId, selectedJobId]);

  if (!data && town.status === 'loading') return <Text style={styles.hint}>인재 정보를 불러오는 중...</Text>;
  if (!data) return <View style={styles.footer}>
    <Text accessibilityRole="alert" style={styles.error}>{town.error ?? '인재 정보를 불러오지 못했습니다.'}</Text>
    <ActionButton label="다시 시도" disabled={town.status === 'loading'} onPress={() => { void town.reload().catch(() => undefined); }} />
  </View>;

  const selectedJob = data.jobs.find((job) => job.id === selectedJobId);
  const selectedGender = data.genders.find((gender) => gender.id === selectedGenderId);
  const normalizedName = name.trim();
  const full = data.currentCharacters != null && data.capacity != null && data.currentCharacters >= data.capacity;
  const validName = normalizedName.length >= data.nameMinLength && normalizedName.length <= data.nameMaxLength;
  const canRecruit = data.recruitmentAvailable && !full && selectedJob != null && selectedGender != null && validName && town.status !== 'submitting';
  const rows: TownRowResponse[] = data.jobs.map((job) => ({
    id: job.id,
    label: job.name,
    accessibilityLabel: `${job.name} 선택`,
    selectable: data.recruitmentAvailable && !full,
    detail: null,
    imageUrl: job.imageUrl,
    price: job.price,
    quantity: null,
  }));
  const submit = () => {
    if (!confirmation) return;
    void town.submit({ jobId: confirmation.jobId, name: confirmation.name, genderId: confirmation.genderId })
      .then((result) => {
        if (staged.current) setResponse(staged.current);
        staged.current = null;
        setConfirmation(null);
        setSelectedJobId(null);
        setSelectedGenderId(null);
        setName('');
        return result;
      })
      .catch((error: unknown) => { if (!(error instanceof TownMutationBusyError)) setConfirmation(null); });
  };

  const footer = <View style={styles.footer}>
    <Text style={styles.sectionLabel}>새 캐릭터 이름</Text>
    <TextInput
      accessibilityLabel="새 캐릭터 이름"
      autoCapitalize="none"
      autoCorrect={false}
      maxLength={data.nameMaxLength}
      onChangeText={setName}
      placeholder={`${data.nameMinLength}~${data.nameMaxLength}자`}
      placeholderTextColor={theme.colors.textMuted}
      style={styles.input}
      value={name}
    />
    <Text style={styles.sectionLabel}>성별</Text>
    <View accessibilityRole="radiogroup" style={styles.genderRow}>{data.genders.map((gender) => <Pressable
      key={gender.id}
      accessibilityLabel={`${gender.label} 선택`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selectedGenderId === gender.id, disabled: !data.recruitmentAvailable || full }}
      disabled={!data.recruitmentAvailable || full}
      onPress={() => setSelectedGenderId(gender.id)}
      style={[styles.genderButton, selectedGenderId === gender.id && styles.genderSelected]}
    ><Text style={styles.tabText}>{gender.label}</Text></Pressable>)}</View>
    {!data.recruitmentAvailable ? <Text accessibilityRole="alert" style={styles.error}>HOF 모집 폼을 안전하게 확인하지 못해 모집할 수 없습니다.</Text> : null}
    {full ? <Text accessibilityRole="alert" style={styles.error}>캐릭터 정원이 가득 찼습니다.</Text> : null}
    <ActionButton label="모집하기" disabled={!canRecruit} onPress={() => {
      if (!selectedJob || !selectedGender || !canRecruit) return;
      setConfirmation({ jobId: selectedJob.id, name: normalizedName, genderId: selectedGender.id, jobName: selectedJob.name, genderLabel: selectedGender.label, price: selectedJob.price });
    }} />
    {town.result ? <TownActionResult result={town.result} onRefresh={() => { setResponse(null); void town.reload().catch(() => undefined); }} /> : null}
    {town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
  </View>;

  return <View style={styles.container}>
    <Text style={styles.title}>인재 알선소</Text>
    <Text accessibilityLabel="캐릭터 정원" style={styles.capacity}>현재 {data.currentCharacters ?? '-'} / 최대 {data.capacity ?? '-'}</Text>
    <Text style={styles.hint}>직업을 선택하고 이름과 성별을 입력해 수동으로 모집합니다.</Text>
    <TownItemList rows={rows} selectionMode="single" selectedIds={selectedJobId ? [selectedJobId] : []} onSelectionChange={(ids) => setSelectedJobId(ids[0] ?? null)} emptyMessage="모집 가능한 직업이 없습니다." footer={footer} />
    <TownConfirmSheet visible={confirmation != null} title="인재 모집 확인" message="HOF에 이 모집을 한 번만 요청합니다." confirmLabel="모집" submitting={town.status === 'submitting'} details={[
      { label: '직업', value: confirmation?.jobName ?? '선택 없음' },
      { label: '이름', value: confirmation?.name ?? '입력 없음' },
      { label: '성별', value: confirmation?.genderLabel ?? '선택 없음' },
      { label: '비용', value: confirmation ? `$${confirmation.price.toLocaleString()}` : '-' },
    ]} onCancel={() => setConfirmation(null)} onConfirm={submit} />
  </View>;
}

function tabMatches(section: QuestSection, tab: Tab) { return tab === 'ACTIVE' ? section === 'ACTIVE' : section === tab; }
function tabLabel(tab: Tab) { return tab === 'ACTIVE' ? '진행 중' : tab === 'AVAILABLE' ? '수락 가능' : '대기 중'; }
function rowId(quest: QuestSnapshot) { return `quest:${quest.questKey}:${quest.sourceOrder}`; }
function toRow(quest: QuestSnapshot): TownRowResponse { const progress = quest.missions.map((mission) => mission.progress ? `${mission.target ?? '미션'} ${mission.progress.current}/${mission.progress.required}` : mission.target).filter(Boolean).join(' · '); return { id: rowId(quest), label: quest.name, accessibilityLabel: `${quest.name} ${quest.state === 'CLAIMABLE' ? '완료 가능' : tabState(quest)}`, selectable: quest.actionNo != null && (quest.state === 'AVAILABLE' || quest.state === 'CLAIMABLE'), detail: [quest.displayCode, progress, quest.rewards.length ? `보상 ${quest.rewards.join(', ')}` : null].filter(Boolean).join(' · '), imageUrl: null, price: null, quantity: null }; }
function tabState(quest: QuestSnapshot) { return quest.section === 'ACTIVE' ? '진행 중' : quest.section === 'AVAILABLE' ? '수락 가능' : '대기 중'; }
function information(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;
function identifyApi(api: TownApi) { const object = api as object; const known = apiKeys.get(object); if (known != null) return known; const next = nextApiKey++; apiKeys.set(object, next); return next; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, capacity: { color: theme.colors.accentGreen, fontSize: 16, fontWeight: '900' }, sectionLabel: { color: theme.colors.text, fontWeight: '800' }, tabs: { flexDirection: 'row', gap: theme.spacing.xs }, tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomColor: theme.colors.borderStrong, borderBottomWidth: 2 }, tabSelected: { borderBottomColor: theme.colors.accentGreen }, tabText: { color: theme.colors.text, fontWeight: '800' }, input: { minHeight: 44, borderColor: theme.colors.borderStrong, borderWidth: 1, borderRadius: theme.radius.md, color: theme.colors.text, paddingHorizontal: theme.spacing.md }, genderRow: { flexDirection: 'row', gap: theme.spacing.sm }, genderButton: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 44 }, genderSelected: { borderColor: theme.colors.accentGreen, borderWidth: 2 }, footer: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md }, hint: { color: theme.colors.textMuted }, error: { color: theme.colors.danger }, button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 } });
