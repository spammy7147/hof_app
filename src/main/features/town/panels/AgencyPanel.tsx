import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type { QuestSnapshot, RecruitCharacterRequest, RecruitmentResponse, TownActionResultResponse, TownRowResponse } from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type Tab = 'ACTIVE' | 'CLAIMABLE' | 'AVAILABLE' | 'WAITING';
type Mutation = { actionNo: string; action: 'accept' | 'claim'; questName: string };

export function AgencyPanel({ api, resolveCaptcha, mode = 'adventure' }: { api: TownApi; resolveCaptcha?: () => Promise<void>; mode?: 'adventure' | 'recruitment' }) {
  return mode === 'recruitment'
    ? <RecruitmentAgencyPanel api={api} resolveCaptcha={resolveCaptcha} />
    : <AdventureAgencyPanel api={api} resolveCaptcha={resolveCaptcha} />;
}

function AdventureAgencyPanel({ api, resolveCaptcha }: { api: TownApi; resolveCaptcha?: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [query, setQuery] = useState('');
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
  useEffect(() => { staged.current = null; setResponse(null); }, [apiKey]);

  const filtered = useMemo(() => data.filter((quest) => tabMatches(quest, tab))
    .filter((quest) => `${quest.displayCode} ${quest.name} ${quest.missions.map((mission) => mission.target ?? '').join(' ')}`.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR'))), [data, query, tab]);
  const rows = filtered.map(toRow);
  const questsByRowId = new Map(filtered.map((quest) => [rowId(quest), quest]));
  const finish = (result: TownActionResultResponse) => {
    if (staged.current) setResponse(staged.current);
    staged.current = null;
    return result;
  };
  const submit = (mutation: Mutation) => {
    void town.submit(mutation).then(finish).catch(() => undefined);
  };

  if (!town.data && town.status === 'loading') return <Text style={styles.hint}>퀘스트를 불러오는 중...</Text>;
  return <View style={styles.container}>
    <View accessibilityRole="tablist" style={styles.tabs}>{(['ACTIVE', 'CLAIMABLE', 'AVAILABLE', 'WAITING'] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.tabSelected]}><Text style={styles.tabText}>{tabLabel(value)} {data.filter((quest) => tabMatches(quest, value)).length}</Text></Pressable>)}</View>
    <TextInput accessibilityLabel="퀘스트명 또는 미션 검색" value={query} onChangeText={setQuery} placeholder="퀘스트명 또는 미션 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} />
    <TownItemList rows={rows} selectionMode="none" emptyMessage="해당 상태의 퀘스트가 없습니다."
      renderItemFooter={(row) => { const quest = questsByRowId.get(row.id); const mutation = questMutation(quest); return mutation ? <ActionButton label={`${quest!.name} ${mutation.action === 'accept' ? '수락' : '완료'}`} visibleLabel={mutation.action === 'accept' ? '수락' : '완료'} disabled={town.status === 'submitting'} onPress={() => submit(mutation)} compact /> : null; }}
      footer={<View style={styles.footer}>{town.result ? <TownActionResult result={town.result} onRefresh={() => { setResponse(null); void town.reload().catch(() => undefined); }} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}</View>} />
  </View>;
}

type OwnedRecruitmentResponse = { owner: number; value: RecruitmentResponse };

function RecruitmentAgencyPanel({ api, resolveCaptcha }: { api: TownApi; resolveCaptcha?: () => Promise<void> }) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedGenderId, setSelectedGenderId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const apiKey = identifyApi(api);
  const [response, setResponse] = useState<OwnedRecruitmentResponse | null>(null);
  const staged = useRef<OwnedRecruitmentResponse | null>(null);
  const activeApiKey = useRef(apiKey);
  activeApiKey.current = apiKey;
  const load = useCallback(() => api.load<RecruitmentResponse>('/api/town/agency/recruitment'), [api]);
  const submitAction = useCallback(async (request: RecruitCharacterRequest) => {
    const next = await api.submit<RecruitCharacterRequest, RecruitmentResponse>('/api/town/agency/recruitment', request);
    if (activeApiKey.current === apiKey) staged.current = { owner: apiKey, value: next };
    return next.result ?? information('모집 요청 후 인재 알선소 정보를 갱신했습니다.');
  }, [api, apiKey]);
  const town = useTownFeature<RecruitmentResponse, RecruitCharacterRequest>({
    load,
    submitAction,
    resolveCaptcha,
    featureKey: `agency-recruitment-${apiKey}`,
  });
  // api 객체는 로그인 계정에 귀속된다. effect 정리 전 렌더에서도 이전 계정 응답을 노출하지 않는다.
  const data = response?.owner === apiKey ? response.value : town.data;

  useEffect(() => {
    staged.current = null;
    setResponse(null);
    setSelectedJobId(null);
    setSelectedGenderId(null);
    setName('');
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
  const nameWidth = recruitmentNameWidth(normalizedName);
  const full = data.currentCharacters != null && data.capacity != null && data.currentCharacters >= data.capacity;
  const validName = nameWidth != null && nameWidth >= data.nameMinLength && nameWidth <= data.nameMaxLength;
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
  const submit = (request: RecruitCharacterRequest) => {
    void town.submit(request)
      .then((result) => {
        if (staged.current?.owner === apiKey) setResponse(staged.current);
        staged.current = null;
        setSelectedJobId(null);
        setSelectedGenderId(null);
        setName('');
        return result;
      })
      .catch(() => undefined);
  };
  const recruit = () => {
    if (!selectedJob || !selectedGender || !canRecruit) return;
    submit({ jobId: selectedJob.id, name: normalizedName, genderId: selectedGender.id });
  };

  const footer = <View style={styles.footer}>
    <Text style={styles.sectionLabel}>새 캐릭터 이름</Text>
    <TextInput
      accessibilityLabel="새 캐릭터 이름"
      accessibilityHint={`영문과 숫자는 1칸, 한글과 일본어 등은 2칸으로 계산해 ${data.nameMinLength}~${data.nameMaxLength}칸으로 입력합니다.`}
      autoCapitalize="none"
      autoCorrect={false}
      maxLength={data.nameMaxLength}
      onChangeText={setName}
      placeholder={`${data.nameMinLength}~${data.nameMaxLength}칸`}
      placeholderTextColor={theme.colors.textMuted}
      returnKeyType="done"
      style={styles.input}
      value={name}
    />
    <Text
      accessibilityLiveRegion="polite"
      style={name.length > 0 && !validName ? styles.error : styles.hint}
    >
      {name.length > 0 && !validName
        ? `캐릭터 이름은 영문·숫자 1칸, 한글·일본어 등은 2칸으로 계산해 ${data.nameMinLength}~${data.nameMaxLength}칸으로 입력해 주세요.`
        : `이름 ${nameWidth ?? 0}/${data.nameMaxLength}칸`}
    </Text>
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
    {town.result ? <TownActionResult result={town.result} onRefresh={() => { setResponse(null); void town.reload().catch(() => undefined); }} /> : null}
    {town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
  </View>;

  return <View style={styles.container}>
    <Text style={styles.title}>인재 알선소</Text>
    <Text accessibilityLabel="캐릭터 정원" style={styles.capacity}>현재 {data.currentCharacters ?? '-'} / 최대 {data.capacity ?? '-'}</Text>
    <Text style={styles.hint}>직업을 선택하고 이름과 성별을 입력해 수동으로 모집합니다.</Text>
    <TownItemList rows={rows} selectionMode="single" selectedIds={selectedJobId ? [selectedJobId] : []} onSelectionChange={(ids) => setSelectedJobId(ids[0] ?? null)} emptyMessage="모집 가능한 직업이 없습니다." footer={footer}
      fixedAction={<ActionButton label="모집하기" disabled={!canRecruit} onPress={recruit} />} />
  </View>;
}

function tabMatches(quest: QuestSnapshot, tab: Tab) { if (tab === 'CLAIMABLE') return quest.state === 'CLAIMABLE'; if (tab === 'ACTIVE') return quest.section === 'ACTIVE' && quest.state !== 'CLAIMABLE'; return quest.section === tab; }
function tabLabel(tab: Tab) { return tab === 'ACTIVE' ? '진행 중' : tab === 'CLAIMABLE' ? '완료 가능' : tab === 'AVAILABLE' ? '수락 가능' : '대기 중'; }
function rowId(quest: QuestSnapshot) { return `quest:${quest.questKey}:${quest.sourceOrder}`; }
function toRow(quest: QuestSnapshot): TownRowResponse { const progress = quest.missions.map((mission) => mission.progress ? `${mission.target ?? '미션'} ${mission.progress.current}/${mission.progress.required}` : mission.target).filter(Boolean).join(' · '); const label = `[${quest.displayCode}] ${quest.name}`; return { id: rowId(quest), label, accessibilityLabel: `${label} ${quest.state === 'CLAIMABLE' ? '완료 가능' : tabState(quest)}`, selectable: false, detail: [progress, quest.rewards.length ? `보상 ${quest.rewards.join(', ')}` : null].filter(Boolean).join('\n'), imageUrl: null, price: null, quantity: null }; }
function questMutation(quest: QuestSnapshot | undefined): Mutation | null { return quest?.actionNo && (quest.state === 'AVAILABLE' || quest.state === 'CLAIMABLE') ? { actionNo: quest.actionNo, action: quest.state === 'AVAILABLE' ? 'accept' : 'claim', questName: quest.name } : null; }
function tabState(quest: QuestSnapshot) { return quest.section === 'ACTIVE' ? '진행 중' : quest.section === 'AVAILABLE' ? '수락 가능' : '대기 중'; }
function information(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
const unsafeRecruitmentNameCharacter = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}]/u;
function recruitmentNameWidth(value: string): number | null {
  let width = 0;
  for (const character of value) {
    if (unsafeRecruitmentNameCharacter.test(character)) return null;
    width += character.codePointAt(0)! <= 0x7f ? 1 : 2;
  }
  return width;
}
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;
function identifyApi(api: TownApi) { const object = api as object; const known = apiKeys.get(object); if (known != null) return known; const next = nextApiKey++; apiKeys.set(object, next); return next; }
function ActionButton({ label, visibleLabel = label, disabled, onPress, compact = false }: { label: string; visibleLabel?: string; disabled: boolean; onPress: () => void; compact?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} hitSlop={compact ? { top: 4, bottom: 4, left: 4, right: 4 } : undefined} onPress={onPress} style={[styles.button, compact && styles.compactButton, disabled && styles.disabled]}><Text style={styles.buttonText}>{visibleLabel}</Text></Pressable>; }
const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, capacity: { color: theme.colors.accentGreen, fontSize: 16, fontWeight: '900' }, sectionLabel: { color: theme.colors.text, fontWeight: '800' }, tabs: { flexDirection: 'row', gap: theme.spacing.xs }, tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomColor: theme.colors.borderStrong, borderBottomWidth: 2 }, tabSelected: { borderBottomColor: theme.colors.accentGreen }, tabText: { color: theme.colors.text, fontWeight: '800' }, input: { minHeight: 44, borderColor: theme.colors.borderStrong, borderWidth: 1, borderRadius: theme.radius.md, color: theme.colors.text, paddingHorizontal: theme.spacing.md }, genderRow: { flexDirection: 'row', gap: theme.spacing.sm }, genderButton: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 44 }, genderSelected: { borderColor: theme.colors.accentGreen, borderWidth: 2 }, footer: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md }, hint: { color: theme.colors.textMuted }, error: { color: theme.colors.danger }, button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md }, compactButton: { minHeight: 36, paddingHorizontal: theme.spacing.sm }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 } });
