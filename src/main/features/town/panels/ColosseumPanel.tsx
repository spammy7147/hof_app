import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import { theme } from '../../../styles/theme';
import type {
  ChallengeColosseumRequest, ColosseumBattleResponse, ColosseumShopResponse, ColosseumTradeRequest,
  SaveColosseumTeamRequest, TownActionResultResponse, TownRowResponse,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { TownMutationBusyError, useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; mode: 'battle' | 'shop'; resolveCaptcha?: () => Promise<void> };
type BattleMutation = { kind: 'team'; request: SaveColosseumTeamRequest } | { kind: 'challenge'; request: ChallengeColosseumRequest };
type ShopMutation = { request: ColosseumTradeRequest };
type BattleConfirm = ({ kind: 'team'; request: SaveColosseumTeamRequest } | { kind: 'challenge'; request: ChallengeColosseumRequest; opponentLabel: string }) | null;
type ShopConfirm = { request: ColosseumTradeRequest; itemLabel: string; detail: string | null } | null;
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;

export function ColosseumPanel({ api, mode, resolveCaptcha }: Props) {
  return mode === 'battle'
    ? <ColosseumBattlePanel api={api} resolveCaptcha={resolveCaptcha} />
    : <ColosseumShopPanel api={api} resolveCaptcha={resolveCaptcha} />;
}

function ColosseumBattlePanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const apiKey = identifyApi(api);
  const [selectedTeam, setSelectedTeam] = useState<string[]>([]);
  const [selectedOpponent, setSelectedOpponent] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<BattleConfirm>(null);
  const [response, setResponse] = useState<ColosseumBattleResponse | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const staged = useRef<ColosseumBattleResponse | null>(null);
  const latestData = useRef<ColosseumBattleResponse | null>(null);
  const activeApi = useRef(api); activeApi.current = api;
  const load = useCallback(() => api.load<ColosseumBattleResponse>('/api/town/pvp/colosseum'), [api]);
  const submitAction = useCallback(async (mutation: BattleMutation) => {
    const next = mutation.kind === 'team'
      ? await api.submit<SaveColosseumTeamRequest, ColosseumBattleResponse>('/api/town/pvp/colosseum/team', mutation.request)
      : await api.submit<ChallengeColosseumRequest, ColosseumBattleResponse>('/api/town/pvp/colosseum/challenge', mutation.request);
    if (activeApi.current !== api) return next.result ?? info('이전 계정의 완료 응답을 폐기했습니다.');
    staged.current = mutation.kind === 'challenge' && latestData.current
      ? { ...(next.fighters.length || next.opponents.length ? next : latestData.current), battleResult: next.battleResult, result: next.result }
      : next;
    return next.result ?? info(mutation.kind === 'team' ? '팀을 저장했습니다.' : '전투가 끝났습니다.');
  }, [api]);
  const town = useTownFeature<ColosseumBattleResponse, BattleMutation>({ load, submitAction, resolveCaptcha, featureKey: `colosseum-battle-${apiKey}`, describeError: toUserFacingErrorMessage });
  const data = response ?? town.data;
  latestData.current = data;
  useEffect(() => { if (!data) return; setSelectedTeam((current) => current.length ? current.filter((id) => data.fighters.some((f) => f.id === id)) : data.selectedTeam); }, [data]);
  useEffect(() => { setResponse(null); setSelectedOpponent(null); setConfirm(null); }, [api]);
  if (!data) return <LoadState label="콜로세움" loading={town.status === 'loading'} error={town.error} reload={town.reload} />;
  const busy = town.status === 'loading' || town.status === 'submitting';
  const rows: TownRowResponse[] = [
    ...data.fighters.map((fighter) => ({ id: `fighter:${fighter.id}`, label: fighter.label, accessibilityLabel: `${fighter.label}${busy ? ' 선택 불가' : ' 선택'}`, detail: fighter.detail, imageUrl: fighter.imageUrl, price: null, quantity: null, selectable: !busy })),
    ...data.opponents.map((opponent) => ({ id: `opponent:${opponent.id}`, label: opponent.label, accessibilityLabel: `${opponent.label}${busy ? ' 선택 불가' : ' 선택'}`, detail: opponent.detail, imageUrl: null, price: null, quantity: null, selectable: !busy })),
  ];
  const selectedIds = [...selectedTeam.map((id) => `fighter:${id}`), ...(selectedOpponent ? [`opponent:${selectedOpponent}`] : [])];
  const onSelection = (ids: string[]) => {
    const team = ids.filter((id) => id.startsWith('fighter:')).map((id) => id.slice(8));
    if (team.length <= data.maxTeamSize) setSelectedTeam(team);
    setSelectedOpponent(ids.find((id) => id.startsWith('opponent:'))?.slice(9) ?? null);
  };
  const finish = (_result: TownActionResultResponse) => { if (staged.current) { setResponse(staged.current); setSelectedTeam(staged.current.selectedTeam); } staged.current = null; setConfirm(null); };
  const submit = (mutation: BattleMutation) => { const submissionApi = api; staged.current = null; setResponse({ ...data, battleResult: mutation.kind === 'challenge' ? null : data.battleResult, result: null }); void town.submit(mutation).then((result) => { if (activeApi.current === submissionApi) finish(result); }).catch((error: unknown) => { if (!(error instanceof TownMutationBusyError) && activeApi.current === submissionApi) setConfirm(null); }); };
  const battle = data.battleResult;
  return <View style={styles.container}><TownItemList rows={rows} selectionMode="mixed" selectedIds={selectedIds}
    selectionGroup={(row) => row.id.startsWith('fighter:') ? row.id : 'opponent'} onSelectionChange={onSelection}
    selectionRole={(row) => row.id.startsWith('fighter:') ? 'checkbox' : 'radio'}
    header={<View style={styles.section}><Text style={styles.title}>콜로세움 전투</Text><Text style={styles.hint}>팀원 {selectedTeam.length}/{data.maxTeamSize}명 · 저장된 팀으로 즉시 도전합니다.</Text></View>}
    footer={<View style={styles.section}>
      <ActionButton label="팀 저장" disabled={busy || selectedTeam.length < data.minTeamSize || selectedTeam.length > data.maxTeamSize} onPress={() => setConfirm({ kind: 'team', request: { fighterCandidateIds: [...selectedTeam] } })} />
      <ActionButton label="Challenge" disabled={busy || !selectedOpponent} onPress={() => { const opponent = data.opponents.find((o) => o.id === selectedOpponent); if (opponent) setConfirm({ kind: 'challenge', request: { opponentCandidateId: opponent.id }, opponentLabel: opponent.label }); }} />
      {battle ? <View accessibilityLabel="콜로세움 전투 결과" accessibilityLiveRegion="polite" style={styles.resultBox}><Text style={styles.resultTitle}>{battle.summary}</Text>
        <Text style={styles.hint}>{battle.turns == null ? '턴 확인 불가' : `${battle.turns}턴`} · 승자 {battle.winner ?? '확인 불가'}</Text>
        <Text style={styles.hint}>내 HP {battle.playerHp ?? '-'} · 상대 HP {battle.opponentHp ?? '-'}</Text>
        <Text style={styles.hint}>내 상태 {battle.playerStatus ?? '-'} · 상대 상태 {battle.opponentStatus ?? '-'}</Text>
        {battle.totalDamage != null ? <Text style={styles.hint}>총 데미지 {battle.totalDamage.toLocaleString()}</Text> : null}
        {battle.reward ? <Text style={styles.reward}>보상 {battle.reward}</Text> : null}
        {battle.detail.length ? <><Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} accessibilityLabel={`전투 상세 ${detailsOpen ? '접기' : '펼치기'}`} onPress={() => setDetailsOpen((v) => !v)}><Text style={styles.link}>전투 상세 {detailsOpen ? '접기' : '펼치기'}</Text></Pressable>{detailsOpen ? battle.detail.map((line, index) => <Text key={`${line.turn ?? 'line'}-${index}`} style={styles.detail}>{line.turn == null ? '' : `${line.turn}턴 · `}{line.text}</Text>) : null}</> : null}
      </View> : null}
      {data.result ? <TownActionResult result={data.result} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
    </View>} emptyMessage="현재 콜로세움 후보가 없습니다." />
    <TownConfirmSheet visible={confirm != null} title={confirm?.kind === 'team' ? '팀 저장 확인' : '콜로세움 도전 확인'} message={confirm?.kind === 'team' ? '선택한 팀을 HOF에 저장합니다.' : '현재 HOF에 저장된 팀으로 즉시 전투합니다.'} confirmLabel={confirm?.kind === 'team' ? '팀 저장' : 'Challenge'} destructive={confirm?.kind === 'challenge'} submitting={town.status === 'submitting'} details={confirm?.kind === 'team' ? [{ label: '팀원', value: `${confirm.request.fighterCandidateIds.length}명` }] : confirm?.kind === 'challenge' ? [{ label: '상대', value: confirm.opponentLabel }, { label: '팀', value: 'HOF 저장 팀', warning: true }] : []} onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm?.kind === 'team') submit({ kind: 'team', request: confirm.request }); else if (confirm?.kind === 'challenge') submit({ kind: 'challenge', request: confirm.request }); }} />
  </View>;
}

function ColosseumShopPanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const apiKey = identifyApi(api);
  const [categoryId, setCategoryId] = useState<string | null>(null); const [selected, setSelected] = useState<string[]>([]); const [quantityText, setQuantityText] = useState('1'); const [confirm, setConfirm] = useState<ShopConfirm>(null); const [response, setResponse] = useState<ColosseumShopResponse | null>(null); const staged = useRef<ColosseumShopResponse | null>(null); const activeApi = useRef(api); activeApi.current = api;
  const path = categoryId ? `/api/town/pvp/colosseum-shop?categoryCandidateId=${encodeURIComponent(categoryId)}` as const : '/api/town/pvp/colosseum-shop' as const;
  const load = useCallback(() => api.load<ColosseumShopResponse>(path), [api, path]);
  const submitAction = useCallback(async ({ request }: ShopMutation) => { const next = await api.submit<ColosseumTradeRequest, ColosseumShopResponse>('/api/town/pvp/colosseum-shop/trade', request); if (activeApi.current === api) staged.current = next; return next.result ?? info('교환 정보를 갱신했습니다.'); }, [api]);
  const town = useTownFeature<ColosseumShopResponse, ShopMutation>({ load, submitAction, resolveCaptcha, featureKey: `colosseum-shop-${apiKey}-${categoryId ?? 'default'}`, describeError: toUserFacingErrorMessage }); const data = response ?? town.data;
  useEffect(() => { staged.current = null; setSelected([]); setResponse(null); setConfirm(null); }, [api, categoryId]);
  if (!data) return <LoadState label="콜로세움 교환소" loading={town.status === 'loading'} error={town.error} reload={town.reload} />;
  const busy = town.status === 'loading' || town.status === 'submitting'; const item = data.items.find((row) => row.id === selected[0]); const quantity = Number(quantityText); const valid = /^\d+$/.test(quantityText) && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 2_147_483_647;
  const rows = data.items.map((row): TownRowResponse => ({ id: row.id, label: row.label, accessibilityLabel: `${row.label}${row.selectable && !busy ? ' 선택' : ' 선택 불가'}`, detail: row.detail, imageUrl: null, price: row.cost, quantity: row.owned, selectable: row.selectable && !busy }));
  return <View style={styles.container}><TownItemList rows={rows} selectionMode="single" selectedIds={selected} onSelectionChange={setSelected}
    header={<View style={styles.section}><Text style={styles.title}>콜로세움 교환소</Text><View accessibilityRole="radiogroup" style={styles.chips}>{data.categories.map((category) => <Pressable key={category.id} accessibilityRole="radio" accessibilityState={{ checked: category.current, disabled: busy }} accessibilityLabel={`${category.label} 분류`} disabled={busy} onPress={() => !category.current && setCategoryId(category.id)} style={[styles.chip, category.current && styles.chipSelected]}><Text style={styles.chipText}>{category.label}</Text></Pressable>)}</View>{data.currencies.map((currency) => <Text key={currency.label} style={styles.hint}>{currency.label}: {currency.quantity?.toLocaleString() ?? '수량 확인 불가'}</Text>)}</View>}
    footer={<View style={styles.section}><TextInput accessibilityLabel="교환 수량" keyboardType="number-pad" editable={!busy} value={quantityText} onChangeText={setQuantityText} style={styles.input} />{!valid ? <Text accessibilityRole="alert" style={styles.error}>1~2,147,483,647 사이의 정수를 입력하세요.</Text> : null}<ActionButton label="교환" disabled={busy || !item || !valid} onPress={() => { if (item && valid) setConfirm({ request: { candidateId: item.id, categoryCandidateId: data.currentCategoryId, quantity }, itemLabel: item.label, detail: item.detail }); }} />{data.result ? <TownActionResult result={data.result} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}</View>} emptyMessage="현재 표시할 교환 품목이 없습니다." />
    <TownConfirmSheet visible={confirm != null} title="교환 확인" message="실행 결과는 되돌릴 수 없습니다." confirmLabel="교환" destructive submitting={town.status === 'submitting'} details={confirm ? [{ label: '품목', value: confirm.itemLabel }, { label: '수량', value: `${confirm.request.quantity}개` }, ...(confirm.detail ? [{ label: '소모 재료', value: confirm.detail }] : [])] : []} onCancel={() => setConfirm(null)} onConfirm={() => { if (!confirm) return; const request = confirm.request; const submissionApi = api; staged.current = null; setResponse({ ...data, result: null }); void town.submit({ request }).then(() => { if (activeApi.current !== submissionApi) return; if (staged.current) setResponse(staged.current); staged.current = null; setConfirm(null); }).catch((error: unknown) => { if (!(error instanceof TownMutationBusyError) && activeApi.current === submissionApi) setConfirm(null); }); }} />
  </View>;
}

function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ label, loading, error, reload }: { label: string; loading: boolean; error: string | null; reload: () => Promise<unknown> }) { return <View style={styles.container}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.hint}>{loading ? `${label} 정보를 불러오는 중...` : error ?? `${label} 정보가 없습니다.`}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void reload().catch(() => undefined)} /> : null}</View>; }
function info(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
function identifyApi(api: TownApi) { const key = api as object; const existing = apiKeys.get(key); if (existing != null) return existing; const next = nextApiKey++; apiKeys.set(key, next); return next; }
const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, hint: { color: theme.colors.textMuted, lineHeight: 20 }, error: { color: theme.colors.danger, lineHeight: 20 }, button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 48 }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 }, resultBox: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: theme.spacing.xs, padding: theme.spacing.md }, resultTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '900' }, reward: { color: theme.colors.accentGreen, fontWeight: '800' }, link: { color: theme.colors.accentBlue, fontWeight: '800', paddingVertical: theme.spacing.sm }, detail: { color: theme.colors.textMuted, lineHeight: 19 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }, chip: { borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: theme.spacing.md }, chipSelected: { borderColor: theme.colors.accentGreen }, chipText: { color: theme.colors.text, fontWeight: '700' }, input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md } });
