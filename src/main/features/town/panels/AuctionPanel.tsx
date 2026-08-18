import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type {
  AuctionBidRequest, AuctionClaimRequest, AuctionExhibitOpenRequest, AuctionExhibitRequest,
  AuctionExhibitResponse, AuctionListingResponse, AuctionMarketItem, AuctionMarketResponse,
  AuctionResponse, TownActionResultResponse, TownRowResponse,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; mode: 'auction' | 'market'; resolveCaptcha?: () => Promise<void> };
type TradeRequest =
  | { kind: 'BID'; body: AuctionBidRequest }
  | { kind: 'OPEN_EXHIBIT'; body: AuctionExhibitOpenRequest }
  | { kind: 'EXHIBIT'; body: AuctionExhibitRequest }
  | { kind: 'CLAIM_ITEM' | 'CLAIM_FUNDS'; body: AuctionClaimRequest };

export function AuctionPanel({ api, mode, resolveCaptcha }: Props) {
  return mode === 'market' ? <AuctionMarketPanel api={api} /> : <AuctionTradePanel api={api} resolveCaptcha={resolveCaptcha} />;
}

function AuctionTradePanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const [query, setQuery] = useState(''); const [appliedQuery, setAppliedQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]); const [bidPrice, setBidPrice] = useState('');
  const [response, setResponse] = useState<AuctionResponse | null>(null);
  const [exhibit, setExhibit] = useState<AuctionExhibitResponse | null>(null); const [exhibitSelected, setExhibitSelected] = useState<string[]>([]);
  const [amount, setAmount] = useState('1'); const [startPrice, setStartPrice] = useState(''); const [duration, setDuration] = useState(''); const [comment, setComment] = useState('');
  const resetExhibitDraft = useCallback(() => { setExhibitSelected([]); setAmount('1'); setStartPrice(''); setDuration(''); setComment(''); }, []);
  useEffect(() => {
    setDuration((current) => exhibit?.durations.some((option) => option.value === current)
      ? current
      : exhibit?.durations[0]?.value ?? '');
  }, [exhibit]);
  const liveRef = useRef(0); useEffect(() => { liveRef.current += 1; return () => { liveRef.current += 1; }; }, [appliedQuery]);
  const load = useCallback(() => api.load<AuctionResponse>(`/api/town/auction${appliedQuery ? `?query=${encodeURIComponent(appliedQuery)}` : ''}`), [api, appliedQuery]);
  const submitAction = useCallback(async (request: TradeRequest) => {
    const generation = liveRef.current;
    const path = request.kind === 'BID' ? '/api/town/auction/bid' : request.kind === 'OPEN_EXHIBIT' ? '/api/town/auction/exhibit/open'
      : request.kind === 'EXHIBIT' ? '/api/town/auction/exhibit' : request.kind === 'CLAIM_ITEM' ? '/api/town/auction/claim-item' : '/api/town/auction/claim-funds';
    const next = await api.submit<TradeRequest['body'], AuctionResponse | AuctionExhibitResponse>(path, request.body);
    if (generation === liveRef.current) {
      if (request.kind === 'OPEN_EXHIBIT' || request.kind === 'EXHIBIT') {
        const nextExhibit = next as AuctionExhibitResponse; resetExhibitDraft(); setExhibit(nextExhibit);
      } else { setResponse(next as AuctionResponse); setSelected([]); setBidPrice(''); }
    }
    return next.result ?? info('옥션 결과를 갱신했습니다.');
  }, [api, resetExhibitDraft]);
  const town = useTownFeature<AuctionResponse, TradeRequest>({ load, submitAction, resolveCaptcha, featureKey: `auction-${appliedQuery}` });
  const data = response ?? town.data; const busy = town.status === 'submitting';
  const chosen = data?.listings.find((item) => key(item) === selected[0]) ?? null;
  const exhibitItem = exhibit?.items.find((item) => key(item) === exhibitSelected[0]) ?? null;
  const rows = useMemo<TownRowResponse[]>(() => data?.listings.map(bidListingRow) ?? [], [data]);
  const exhibitRows = useMemo<TownRowResponse[]>(() => exhibit?.items.map(exhibitInventoryRow) ?? [], [exhibit]);
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const bid = chosen && validWhole(bidPrice, 1) ? { kind: 'BID', body: { actionId: chosen.actionId, listingId: chosen.listingId!, bidPrice: Number(bidPrice) } } as const : null;
  const durationAllowed = exhibit?.durations.some((option) => option.value === duration) === true;
  const exhibitRequest = exhibitItem?.candidateId && exhibit?.actionId && validWhole(amount, 1, 100_000)
    && validWhole(startPrice, 1) && durationAllowed && comment.length <= 300
    ? { kind: 'EXHIBIT', body: { entryActionId: exhibit.entryActionId, actionId: exhibit.actionId, candidateId: exhibitItem.candidateId, amount: Number(amount), exhibitTime: duration, startPrice: Number(startPrice), comment } } as const : null;
  const fixedAction = !exhibit && chosen
    ? <ActionButton label="입찰" disabled={busy || !bid} onPress={() => bid && void town.submit(bid).catch(() => undefined)} />
    : exhibit && exhibitItem
      ? <ActionButton label="출품" disabled={busy || !exhibitRequest} onPress={() => exhibitRequest && void town.submit(exhibitRequest).catch(() => undefined)} />
      : null;
  return <View style={styles.container}>
    <TownItemList rows={exhibit ? exhibitRows : rows} selectionMode="single" selectedIds={exhibit ? exhibitSelected : selected}
      fixedAction={fixedAction}
      onSelectionChange={(ids) => { if (!busy) (exhibit ? setExhibitSelected : setSelected)(ids); }}
      header={<View style={styles.section}>
        <TextInput accessibilityLabel="옥션 검색어" editable={!busy && !exhibit} value={query} onChangeText={setQuery} placeholder="품목명 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} />
        <ActionButton label="옥션 검색" disabled={busy || town.status === 'loading' || exhibit != null} onPress={() => { setResponse(null); setSelected([]); setAppliedQuery(query.trim()); }} />
        {!exhibit && data.capabilities.exhibitEntryActionId ? <ActionButton label="출품 준비" disabled={busy} onPress={() => { resetExhibitDraft(); town.resetOutcome(); void town.submit({ kind: 'OPEN_EXHIBIT', body: { actionId: data.capabilities.exhibitEntryActionId! } }).then(() => town.resetOutcome()).catch(() => undefined); }} /> : null}
        {!exhibit && data.capabilities.claimItemActionId ? <ActionButton label="낙찰 아이템 수령" disabled={busy} onPress={() => void town.submit({ kind: 'CLAIM_ITEM', body: { actionId: data.capabilities.claimItemActionId! } }).catch(() => undefined)} /> : null}
        {!exhibit && data.capabilities.claimFundsActionId ? <ActionButton label="Funds 수령" disabled={busy} onPress={() => void town.submit({ kind: 'CLAIM_FUNDS', body: { actionId: data.capabilities.claimFundsActionId! } }).catch(() => undefined)} /> : null}
        {exhibit ? <ActionButton label="옥션 목록으로" disabled={busy} onPress={() => { setExhibit(null); resetExhibitDraft(); town.resetOutcome(); }} /> : null}
      </View>}
      footer={<View style={styles.section}>
        {!exhibit && chosen ? <Field label="입찰가" value={bidPrice} setValue={setBidPrice} disabled={busy} numeric /> : null}
        {exhibit && exhibitItem ? <>
          <Field label="출품 수량" value={amount} setValue={setAmount} disabled={busy} numeric /><Field label="개시가" value={startPrice} setValue={setStartPrice} disabled={busy} numeric />
          <Text style={styles.fieldLabel}>출품 기간</Text>
          <View style={styles.durationOptions}>{exhibit.durations.map((option) => <Pressable key={option.value} accessibilityLabel={`출품 기간 ${option.label}`} accessibilityRole="radio" accessibilityState={{ checked: duration === option.value, disabled: busy }} disabled={busy} onPress={() => setDuration(option.value)} style={[styles.durationOption, duration === option.value && styles.durationSelected]}><Text style={styles.durationText}>{option.label}</Text></Pressable>)}</View>
          <TextInput accessibilityLabel="출품 설명" editable={!busy} maxLength={300} value={comment} onChangeText={setComment} placeholder="코멘트(선택, 최대 300자)" placeholderTextColor={theme.colors.textMuted} style={styles.input} />
        </> : null}
        {town.result ? <TownActionResult result={town.result} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
      </View>} />
  </View>;
}

function AuctionMarketPanel({ api }: Pick<Props, 'api'>) {
  const [query, setQuery] = useState(''); const [appliedQuery, setAppliedQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const load = useCallback(() => api.load<AuctionMarketResponse>(`/api/town/auction-market${appliedQuery ? `?query=${encodeURIComponent(appliedQuery)}` : ''}`), [api, appliedQuery]);
  const town = useTownFeature<AuctionMarketResponse>({ load, featureKey: `auction-market-${appliedQuery}` });
  const rows = town.data?.items.map(marketRow) ?? [];
  if (!town.data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const selectedItem = town.data.items.find((item) => item.itemKey === selected[0]) ?? null;
  return <View style={styles.container}><TownItemList rows={rows} selectionMode="single" selectedIds={selected} onSelectionChange={setSelected} emptyMessage={null}
    header={<View style={styles.section}><TextInput accessibilityLabel="낙찰 시세 검색어" value={query} onChangeText={setQuery} placeholder="품목명 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} /><ActionButton label="낙찰 시세 검색" disabled={town.status === 'loading'} onPress={() => { setSelected([]); setAppliedQuery(query.trim()); }} /></View>}
    footer={selectedItem ? <PriceChart item={selectedItem} /> : null} />
  </View>;
}

function PriceChart({ item }: { item: AuctionMarketItem }) {
  const points = item.points.slice(-24); const max = Math.max(1, ...points.map((point) => point.unitPrice));
  return <View accessibilityLabel={`${item.name} 가격 차트 ${points.length}개 관측`} style={styles.chart}><Text style={styles.chartTitle}>{item.name} 단가 추이</Text><View style={styles.bars}>{points.map((point, index) => <View accessibilityLabel={`${new Date(point.observedAt).toLocaleString()} 단가 ${point.unitPrice} 총액 ${point.totalPrice} 수량 ${point.quantity}`} accessible key={`${point.observedAt}-${index}`} style={[styles.bar, { height: Math.max(3, Math.round(48 * point.unitPrice / max)) }]} />)}</View></View>;
}

function bidListingRow(item: AuctionListingResponse): TownRowResponse {
  const detail = `총액 $${item.totalPrice.toLocaleString()} · 단가 $${item.unitPrice.toLocaleString()} · 로트 수량 ${item.quantity.toLocaleString()}개`;
  return { id: key(item), label: item.name, accessibilityLabel: `${item.name} 입찰 로트 선택. ${detail}`, selectable: true, imageUrl: null, detail, price: null, quantity: null };
}
function exhibitInventoryRow(item: AuctionListingResponse): TownRowResponse {
  return { id: key(item), label: item.name, accessibilityLabel: `${item.name} 출품 재고 선택. 보유 ${item.quantity.toLocaleString()}개`, selectable: true, imageUrl: null, detail: null, price: null, quantity: item.quantity };
}
function marketRow(item: AuctionMarketItem): TownRowResponse {
  const latestTotal = item.points.at(-1)?.totalPrice;
  const detail = `최근 총액 ${latestTotal == null ? '-' : `$${latestTotal.toLocaleString()}`} · 최근 단가 $${item.latestUnitPrice.toLocaleString()} · 평균 $${item.averageUnitPrice.toLocaleString()} · 최저 $${item.minimumUnitPrice.toLocaleString()} · 최고 $${item.maximumUnitPrice.toLocaleString()} · 총 거래량 ${item.volume.toLocaleString()}개 · ${item.tradeCount.toLocaleString()}건`;
  return { id: item.itemKey, label: item.name, accessibilityLabel: `${item.name} 시세 이력 열기. ${detail}`, selectable: true, imageUrl: null, price: null, quantity: null, detail };
}
function key(item: AuctionListingResponse) { return item.rowKey; }
function validWhole(value: string, min: number, max = Number.MAX_SAFE_INTEGER) { return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max; }
function Field({ label, value, setValue, disabled, numeric }: { label: string; value: string; setValue: (value: string) => void; disabled: boolean; numeric?: boolean }) { return <TextInput accessibilityLabel={label} editable={!disabled} keyboardType={numeric ? 'number-pad' : 'default'} value={value} onChangeText={setValue} placeholder={label} placeholderTextColor={theme.colors.textMuted} style={styles.input} />; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => Promise<unknown> }) { return <View style={styles.container}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.muted}>{loading ? '옥션을 불러오는 중...' : error ?? '표시할 항목이 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void retry().catch(() => undefined)} /> : null}</View>; }
function info(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }

const styles = StyleSheet.create({
  container: { flex: 1, gap: theme.spacing.md }, section: { gap: theme.spacing.md, paddingVertical: theme.spacing.md }, muted: { color: theme.colors.textMuted }, error: { color: theme.colors.danger },
  input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md },
  button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 48, padding: theme.spacing.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 },
  fieldLabel: { color: theme.colors.text, fontWeight: '800' }, durationOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }, durationOption: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, minHeight: 44, paddingHorizontal: theme.spacing.md, justifyContent: 'center' }, durationSelected: { borderColor: theme.colors.accentGreen, borderWidth: 2 }, durationText: { color: theme.colors.text, fontWeight: '700' },
  chart: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, gap: theme.spacing.sm, padding: theme.spacing.md }, chartTitle: { color: theme.colors.text, fontWeight: '800' }, bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 3, height: 52 }, bar: { backgroundColor: theme.colors.accentBlue, flex: 1, minWidth: 3 },
});
