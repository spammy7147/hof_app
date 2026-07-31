import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type {
  AuctionAction, AuctionActionRequest, AuctionListingResponse, AuctionMarketItem,
  AuctionMarketResponse, AuctionResponse, TownActionResultResponse, TownRowResponse,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; mode: 'auction' | 'market'; resolveCaptcha?: () => Promise<void> };

export function AuctionPanel({ api, mode, resolveCaptcha }: Props) {
  return mode === 'market'
    ? <AuctionMarketPanel api={api} />
    : <AuctionTradePanel api={api} resolveCaptcha={resolveCaptcha} />;
}

function AuctionTradePanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [response, setResponse] = useState<AuctionResponse | null>(null);
  const load = useCallback(() => api.load<AuctionResponse>(`/api/town/auction${appliedQuery ? `?query=${encodeURIComponent(appliedQuery)}` : ''}`), [api, appliedQuery]);
  const submitAction = useCallback(async (request: { action: AuctionAction; command: AuctionActionRequest }) => {
    const next = await api.submit<AuctionActionRequest, AuctionResponse>(`/api/town/auction/${request.action.toLowerCase()}`, request.command);
    setResponse(next); setSelected([]); setConfirming(false);
    return next.result ?? info('옥션 결과를 갱신했습니다.');
  }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: `auction-${appliedQuery}` });
  const data = response ?? town.data;
  const chosen = data?.listings.find((item) => key(item) === selected[0]) ?? null;
  const rows = useMemo<TownRowResponse[]>(() => data?.listings.map((item) => ({
    id: key(item), label: item.name, selectable: item.action !== 'BROWSE', imageUrl: null,
    detail: `${actionLabel(item.action)} · 총액 $${item.totalPrice.toLocaleString()} · 단가 $${item.unitPrice.toLocaleString()}`,
    price: item.totalPrice, quantity: item.quantity,
  })) ?? [], [data]);
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  return <View style={styles.container}>
    <TownItemList rows={rows} selectionMode="single" selectedIds={selected} onSelectionChange={setSelected}
      header={<View style={styles.section}><TextInput accessibilityLabel="옥션 검색어" value={query} onChangeText={setQuery} placeholder="품목명 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} /><ActionButton label="옥션 검색" disabled={town.status === 'loading'} onPress={() => { setResponse(null); setAppliedQuery(query.trim()); }} /></View>}
      footer={<View style={styles.section}>{chosen ? <ActionButton label={actionLabel(chosen.action)} disabled={town.status === 'submitting'} onPress={() => setConfirming(true)} /> : <Text style={styles.muted}>입찰·출품·회수할 항목을 선택하세요.</Text>}{data.result ? <TownActionResult result={data.result} /> : null}{town.error ? <Text style={styles.error}>{town.error}</Text> : null}</View>} />
    <TownConfirmSheet visible={confirming && chosen != null} title={`${chosen ? actionLabel(chosen.action) : '옥션'} 확인`} message="대상과 금액을 확인한 뒤 실행하세요." confirmLabel={chosen ? actionLabel(chosen.action) : '실행'} destructive
      submitting={town.status === 'submitting'} details={chosen ? [{ label: '품목', value: chosen.name }, { label: '수량', value: `${chosen.quantity.toLocaleString()}개` }, { label: '총액', value: `$${chosen.totalPrice.toLocaleString()}`, warning: true }, { label: '단가', value: `$${chosen.unitPrice.toLocaleString()}` }] : []}
      onCancel={() => setConfirming(false)} onConfirm={() => chosen && void town.submit({ action: chosen.action, command: { actionId: chosen.actionId, candidateId: chosen.candidateId, quantity: chosen.quantity } }).catch(() => undefined)} />
  </View>;
}

function AuctionMarketPanel({ api }: Pick<Props, 'api'>) {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const load = useCallback(() => api.load<AuctionMarketResponse>(`/api/town/auction-market${appliedQuery ? `?query=${encodeURIComponent(appliedQuery)}` : ''}`), [api, appliedQuery]);
  const town = useTownFeature<AuctionMarketResponse>({ load, featureKey: `auction-market-${appliedQuery}` });
  const rows = town.data?.items.map((item) => marketRow(item)) ?? [];
  if (!town.data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  return <View style={styles.container}><TownItemList rows={rows} selectionMode="none" emptyMessage="최근 30일 익명 시세가 없습니다."
    header={<View style={styles.section}><Text style={styles.notice}>판매자·입찰자 정보 없이 서버에 저장된 관측치만 표시합니다.</Text><TextInput accessibilityLabel="낙찰 시세 검색어" value={query} onChangeText={setQuery} placeholder="품목명 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} /><ActionButton label="낙찰 시세 검색" disabled={town.status === 'loading'} onPress={() => setAppliedQuery(query.trim())} />{town.data.items.slice(0, 5).map((item) => <PriceChart item={item} key={item.itemKey} />)}</View>} />
  </View>;
}

function PriceChart({ item }: { item: AuctionMarketItem }) {
  const points = item.points.slice(-12); const max = Math.max(1, ...points.map((point) => point.unitPrice));
  return <View accessibilityLabel={`${item.name} 가격 차트`} style={styles.chart}><Text style={styles.chartTitle}>{item.name} 단가 추이</Text><View style={styles.bars}>{points.map((point, index) => <View key={`${point.observedAt}-${index}`} style={[styles.bar, { height: Math.max(3, Math.round(48 * point.unitPrice / max)) }]} />)}</View></View>;
}

function marketRow(item: AuctionMarketItem): TownRowResponse { return { id: item.itemKey, label: item.name, selectable: false, imageUrl: null, price: item.latestUnitPrice, quantity: item.volume, detail: `최근 $${item.latestUnitPrice.toLocaleString()} · 평균 $${item.averageUnitPrice.toLocaleString()} · 최저/최고 $${item.minimumUnitPrice.toLocaleString()} / $${item.maximumUnitPrice.toLocaleString()} · ${item.tradeCount.toLocaleString()}건` }; }
function key(item: AuctionListingResponse) { return `${item.action}:${item.candidateId}`; }
function actionLabel(action: AuctionAction) { return ({ BROWSE: '조회', BID: '입찰', EXHIBIT: '출품', CLAIM: '회수' } as const)[action]; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => Promise<unknown> }) { return <View style={styles.container}><Text style={error ? styles.error : styles.muted}>{loading ? '옥션을 불러오는 중...' : error ?? '표시할 항목이 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void retry().catch(() => undefined)} /> : null}</View>; }
function info(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }

const styles = StyleSheet.create({
  container: { flex: 1, gap: theme.spacing.md }, section: { gap: theme.spacing.md, paddingVertical: theme.spacing.md }, muted: { color: theme.colors.textMuted }, error: { color: theme.colors.danger }, notice: { color: theme.colors.accentBlue, fontSize: 12 },
  input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md },
  button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 48, padding: theme.spacing.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 },
  chart: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, gap: theme.spacing.sm, padding: theme.spacing.md }, chartTitle: { color: theme.colors.text, fontWeight: '800' }, bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 3, height: 52 }, bar: { backgroundColor: theme.colors.accentBlue, flex: 1, minWidth: 3 },
});
