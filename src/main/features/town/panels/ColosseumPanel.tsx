import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BattlePartyPresetPicker, type PartySelectionMode } from '../../battle/components/BattlePartyPresetPicker';
import type { PartyPresetCatalogResource } from '../../../domain/partyPresetCatalogLoader';
import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import { theme } from '../../../styles/theme';
import type {
  ChallengeColosseumRequest, ColosseumBattleResponse, ColosseumFighterResponse, ColosseumShopResponse, ColosseumTradeRequest,
  HofCharacter, PartyPresetResponse, SaveColosseumTeamRequest, TownActionResultResponse, TownRowResponse,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { TownMutationBusyError, useTownFeature } from '../hooks/useTownFeature';

type Props = {
  api: TownApi;
  mode: 'battle' | 'shop';
  characters?: HofCharacter[];
  partyPresetCatalog?: PartyPresetCatalogResource;
  resolveCaptcha?: () => Promise<void>;
};
type BattleMutation = { kind: 'team'; request: SaveColosseumTeamRequest } | { kind: 'challenge'; request: ChallengeColosseumRequest };
type ShopMutation = { request: ColosseumTradeRequest };
type BattleConfirm = ({ kind: 'team'; request: SaveColosseumTeamRequest } | { kind: 'challenge'; request: ChallengeColosseumRequest; opponentLabel: string }) | null;
type ShopConfirm = { request: ColosseumTradeRequest; itemLabel: string; detail: string | null } | null;
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;

export function ColosseumPanel({ api, mode, characters, partyPresetCatalog, resolveCaptcha }: Props) {
  return mode === 'battle'
    ? <ColosseumBattlePanel api={api} characters={characters} partyPresetCatalog={partyPresetCatalog} resolveCaptcha={resolveCaptcha} />
    : <ColosseumShopPanel api={api} resolveCaptcha={resolveCaptcha} />;
}

function ColosseumBattlePanel({ api, characters = [], partyPresetCatalog, resolveCaptcha }: Omit<Props, 'mode'>) {
  const apiKey = identifyApi(api);
  const [selectedTeam, setSelectedTeam] = useState<Array<string | null>>(() => emptyTeamSlots());
  const [partySelectionMode, setPartySelectionMode] = useState<PartySelectionMode>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  const [openTeamSlot, setOpenTeamSlot] = useState<number | null>(null);
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
  useEffect(() => { if (!data) return; setSelectedTeam((current) => current.some((id) => id != null) ? current.map((id) => id != null && data.fighters.some((f) => f.id === id) ? id : null) : toTeamSlots(data.selectedTeam)); }, [data]);
  useEffect(() => { setResponse(null); setSelectedOpponent(null); setOpenTeamSlot(null); setPartySelectionMode(null); setSelectedPresetId(null); setConfirm(null); }, [api]);
  if (!data) return <LoadState label="콜로세움" loading={town.status === 'loading'} error={town.error} reload={town.reload} />;
  const busy = town.status === 'loading' || town.status === 'submitting';
  const rows: TownRowResponse[] = data.opponents.map((opponent) => ({ id: opponent.id, label: opponent.label, accessibilityLabel: `${opponent.label}${busy ? ' 선택 불가' : ' 선택'}`, detail: opponent.detail, imageUrl: null, price: null, quantity: null, selectable: !busy }));
  const selectedIds = selectedOpponent ? [selectedOpponent] : [];
  const onSelection = (ids: string[]) => {
    setSelectedOpponent(ids[0] ?? null);
  };
  const selectDirectParty = () => {
    setPartySelectionMode('direct');
    setSelectedPresetId(null);
    setSelectedTeam(emptyTeamSlots());
    setOpenTeamSlot(null);
  };
  const selectPresetParty = (preset: PartyPresetResponse) => {
    setPartySelectionMode('preset');
    setSelectedPresetId(preset.id);
    setSelectedTeam(teamSlotsFromPreset(preset, data.fighters));
    setOpenTeamSlot(null);
  };
  const finish = (_result: TownActionResultResponse) => { if (staged.current) { setResponse(staged.current); setSelectedTeam(toTeamSlots(staged.current.selectedTeam)); } staged.current = null; setConfirm(null); };
  const submit = (mutation: BattleMutation) => { const submissionApi = api; staged.current = null; setResponse({ ...data, battleResult: mutation.kind === 'challenge' ? null : data.battleResult, result: null }); void town.submit(mutation).then((result) => { if (activeApi.current === submissionApi) finish(result); }).catch((error: unknown) => { if (!(error instanceof TownMutationBusyError) && activeApi.current === submissionApi) setConfirm(null); }); };
  const battle = data.battleResult;
  return <View style={styles.container}><TownItemList rows={rows} selectionMode="single" selectedIds={selectedIds} onSelectionChange={onSelection}
    header={<View style={styles.section}><Text style={styles.title}>콜로세움 전투</Text><Text style={styles.hint}>도전할 상대를 선택하세요.</Text></View>}
    footer={<View style={styles.section}>
      <ActionButton label="Challenge" disabled={busy || !selectedOpponent} onPress={() => { const opponent = data.opponents.find((o) => o.id === selectedOpponent); if (opponent) setConfirm({ kind: 'challenge', request: { opponentCandidateId: opponent.id }, opponentLabel: opponent.label }); }} />
      {battle ? <View accessibilityLabel="콜로세움 전투 결과" accessibilityLiveRegion="polite" style={styles.resultBox}><Text style={styles.resultTitle}>{battle.summary}</Text>
        <Text style={styles.hint}>{battle.turns == null ? '턴 확인 불가' : `${battle.turns}턴`} · 승자 {battle.winner ?? '확인 불가'}</Text>
        <Text style={styles.hint}>내 HP {battle.playerHp ?? '-'} · 상대 HP {battle.opponentHp ?? '-'}</Text>
        <Text style={styles.hint}>내 상태 {battle.playerStatus ?? '-'} · 상대 상태 {battle.opponentStatus ?? '-'}</Text>
        {battle.totalDamage != null ? <Text style={styles.hint}>총 데미지 {battle.totalDamage.toLocaleString()}</Text> : null}
        {battle.reward ? <Text style={styles.reward}>보상 {battle.reward}</Text> : null}
        {battle.detail.length ? <><Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} accessibilityLabel={`전투 상세 ${detailsOpen ? '접기' : '펼치기'}`} onPress={() => setDetailsOpen((v) => !v)}><Text style={styles.link}>전투 상세 {detailsOpen ? '접기' : '펼치기'}</Text></Pressable>{detailsOpen ? battle.detail.map((line, index) => <Text key={`${line.turn ?? 'line'}-${index}`} style={styles.detail}>{line.turn == null ? '' : `${line.turn}턴 · `}{line.text}</Text>) : null}</> : null}
      </View> : null}
      {selectedOpponent ? <View style={styles.teamEditor}>
        <Text style={styles.stepLabel}>STEP 1 · 파티 선택</Text>
        <BattlePartyPresetPicker
          characters={characters}
          catalog={partyPresetCatalog?.catalog ?? EMPTY_PRESET_CATALOG}
          loading={partyPresetCatalog?.loading ?? false}
          errorMessage={partyPresetCatalog?.error ?? null}
          selectedMode={partySelectionMode}
          selectedPresetId={selectedPresetId}
          onRetry={partyPresetCatalog?.retry ?? doNothing}
          onSelectDirect={selectDirectParty}
          onSelectPreset={selectPresetParty}
        />
        {partySelectionMode ? <>
          <Text style={styles.teamTitle}>콜로세움 팀</Text>
          <Text style={styles.hint}>팀원 {selectedFighterIds(selectedTeam).length}/5명 · 각 슬롯에서 캐릭터를 검색해 선택하세요.</Text>
          <ColosseumTeamSlots busy={busy} fighters={data.fighters} openSlot={openTeamSlot} selectedTeam={selectedTeam} onOpenSlot={setOpenTeamSlot} onTeamChange={setSelectedTeam} />
          <ActionButton label="팀 저장" disabled={busy || selectedFighterIds(selectedTeam).length < Math.max(data.minTeamSize, 1)} onPress={() => setConfirm({ kind: 'team', request: { fighterCandidateIds: selectedFighterIds(selectedTeam) } })} />
        </> : null}
      </View> : null}
      {data.result ? <TownActionResult result={data.result} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
    </View>} emptyMessage="현재 도전 가능한 상대가 없습니다." />
    <TownConfirmSheet visible={confirm != null} title={confirm?.kind === 'team' ? '팀 저장 확인' : '콜로세움 도전 확인'} message={confirm?.kind === 'team' ? '선택한 팀을 HOF에 저장합니다.' : '현재 HOF에 저장된 팀으로 즉시 전투합니다.'} confirmLabel={confirm?.kind === 'team' ? '팀 저장' : 'Challenge'} destructive={confirm?.kind === 'challenge'} submitting={town.status === 'submitting'} details={confirm?.kind === 'team' ? [{ label: '팀원', value: `${confirm.request.fighterCandidateIds.length}명` }] : confirm?.kind === 'challenge' ? [{ label: '상대', value: confirm.opponentLabel }, { label: '팀', value: 'HOF 저장 팀', warning: true }] : []} onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm?.kind === 'team') submit({ kind: 'team', request: confirm.request }); else if (confirm?.kind === 'challenge') submit({ kind: 'challenge', request: confirm.request }); }} />
  </View>;
}

function ColosseumTeamSlots({ busy, fighters, openSlot, selectedTeam, onOpenSlot, onTeamChange }: {
  busy: boolean;
  fighters: ColosseumFighterResponse[];
  openSlot: number | null;
  selectedTeam: Array<string | null>;
  onOpenSlot: (slot: number | null) => void;
  onTeamChange: (team: Array<string | null>) => void;
}) {
  const [query, setQuery] = useState('');
  const selectedFighter = openSlot == null ? null : fighters.find((fighter) => fighter.id === selectedTeam[openSlot]) ?? null;
  const options = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return fighters;
    return fighters.filter((fighter) => `${fighter.label} ${fighter.detail ?? ''}`.toLocaleLowerCase().includes(normalized));
  }, [fighters, query]);
  const close = () => { setQuery(''); onOpenSlot(null); };
  const select = (fighterId: string | null) => {
    if (openSlot == null) return;
    const slots = [...selectedTeam];
    if (fighterId != null) {
      slots.forEach((id, index) => { if (id === fighterId && index !== openSlot) slots[index] = null; });
    }
    slots[openSlot] = fighterId;
    onTeamChange(slots);
    close();
  };

  return <View style={styles.teamSlots}>{Array.from({ length: 5 }, (_, slot) => {
    const fighter = fighters.find((candidate) => candidate.id === selectedTeam[slot]);
    return <Pressable key={slot} accessibilityRole="button" accessibilityLabel={`${slot + 1}번 팀원 선택`} accessibilityState={{ disabled: busy, expanded: openSlot === slot }} disabled={busy} onPress={() => { setQuery(''); onOpenSlot(slot); }} style={({ pressed }) => [styles.teamSlot, pressed && styles.pressed]}>
      <View style={styles.teamSlotText}><Text style={styles.teamSlotName} numberOfLines={1}>{fighter?.label ?? '캐릭터 선택'}</Text><Text style={styles.teamSlotDetail} numberOfLines={1}>{fighter?.detail ?? '비어 있음'}</Text></View><Text style={styles.dropdownMark}>⌄</Text>
    </Pressable>;
  })}
    {openSlot != null ? <Modal animationType="slide" onRequestClose={close} presentationStyle="overFullScreen" transparent visible>
      <View style={styles.modalRoot}><Pressable accessibilityLabel="캐릭터 선택 닫기" accessibilityRole="button" onPress={close} style={styles.modalBackdrop} />
        <View style={styles.modalSheet}><View style={styles.modalHeader}><Text style={styles.modalTitle}>{openSlot + 1}번 팀원 선택</Text><Pressable accessibilityLabel="캐릭터 선택 닫기" accessibilityRole="button" onPress={close}><Text style={styles.link}>닫기</Text></Pressable></View>
          <TextInput accessibilityLabel={`${openSlot + 1}번 팀원 검색`} autoCapitalize="none" autoCorrect={false} onChangeText={setQuery} placeholder="캐릭터 이름 / 상세 정보 검색" placeholderTextColor={theme.colors.textMuted} style={styles.searchInput} value={query} />
          <FlatList data={options} keyExtractor={(fighter) => fighter.id} keyboardShouldPersistTaps="handled" ListHeaderComponent={<Pressable accessibilityLabel="선택 없음" accessibilityRole="button" accessibilityState={{ selected: selectedFighter == null }} onPress={() => select(null)} style={styles.pickerOption}><Text style={styles.teamSlotName}>선택 없음</Text></Pressable>} ListEmptyComponent={<Text style={styles.empty}>검색 결과가 없습니다.</Text>} renderItem={({ item }) => <Pressable accessibilityLabel={`${item.label} 팀원 선택`} accessibilityRole="button" accessibilityState={{ selected: item.id === selectedFighter?.id }} onPress={() => select(item.id)} style={[styles.pickerOption, item.id === selectedFighter?.id && styles.pickerOptionSelected]}><View style={styles.teamSlotText}><Text style={styles.teamSlotName}>{item.label}</Text>{item.detail ? <Text style={styles.teamSlotDetail}>{item.detail}</Text> : null}</View>{selectedTeam.includes(item.id) ? <Text style={styles.selectedMark}>{item.id === selectedFighter?.id ? '선택됨' : '다른 슬롯'}</Text> : null}</Pressable>} />
        </View>
      </View>
    </Modal> : null}
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
const EMPTY_PRESET_CATALOG = { folders: [], presets: [] };
function doNothing() {}
function emptyTeamSlots(): Array<string | null> { return Array.from({ length: 5 }, () => null); }
function toTeamSlots(ids: readonly string[]): Array<string | null> { return Array.from({ length: 5 }, (_, index) => ids[index] ?? null); }
function teamSlotsFromPreset(preset: PartyPresetResponse, fighters: readonly ColosseumFighterResponse[]): Array<string | null> {
  const fighterIds = new Set(fighters.map((fighter) => fighter.id));
  const slots = emptyTeamSlots();
  preset.members.forEach((member) => {
    if (member.slotIndex < 0 || member.slotIndex >= slots.length || member.characterId == null) return;
    slots[member.slotIndex] = fighterIds.has(member.characterId) ? member.characterId : null;
  });
  return slots;
}
function selectedFighterIds(slots: readonly (string | null)[]): string[] { return slots.filter((id): id is string => id != null); }
function identifyApi(api: TownApi) { const key = api as object; const existing = apiKeys.get(key); if (existing != null) return existing; const next = nextApiKey++; apiKeys.set(key, next); return next; }
const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, stepLabel: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '900' }, hint: { color: theme.colors.textMuted, lineHeight: 20 }, error: { color: theme.colors.danger, lineHeight: 20 }, button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 48 }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.82 }, resultBox: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: theme.spacing.xs, padding: theme.spacing.md }, resultTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '900' }, reward: { color: theme.colors.accentGreen, fontWeight: '800' }, link: { color: theme.colors.accentBlue, fontWeight: '800', paddingVertical: theme.spacing.sm }, detail: { color: theme.colors.textMuted, lineHeight: 19 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }, chip: { borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: theme.spacing.md }, chipSelected: { borderColor: theme.colors.accentGreen }, chipText: { color: theme.colors.text, fontWeight: '700' }, input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md }, teamEditor: { borderTopColor: theme.colors.border, borderTopWidth: 1, gap: theme.spacing.sm, marginTop: theme.spacing.sm, paddingTop: theme.spacing.md }, teamTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '900' }, teamSlots: { gap: 6 }, teamSlot: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', minHeight: 54, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs }, teamSlotText: { flex: 1, gap: 2, minWidth: 0 }, teamSlotName: { color: theme.colors.text, fontSize: 15, fontWeight: '800' }, teamSlotDetail: { color: theme.colors.textMuted, fontSize: 13 }, dropdownMark: { color: theme.colors.textMuted, fontSize: 20 }, modalRoot: { backgroundColor: 'rgba(0,0,0,0.55)', flex: 1, justifyContent: 'flex-end' }, modalBackdrop: { flex: 1 }, modalSheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.md, borderTopRightRadius: theme.radius.md, gap: theme.spacing.sm, maxHeight: '78%', padding: theme.spacing.md }, modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, modalTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '900' }, searchInput: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md }, pickerOption: { alignItems: 'center', borderBottomColor: theme.colors.border, borderBottomWidth: 1, flexDirection: 'row', minHeight: 56, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.sm }, pickerOptionSelected: { backgroundColor: theme.colors.surfaceAlt }, selectedMark: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800' }, empty: { color: theme.colors.textMuted, padding: theme.spacing.xl, textAlign: 'center' } });
