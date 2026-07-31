import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type {
  CombineRequest,
  CombineResponse,
  PurchaseRequest,
  SellRequest,
  SellResponse,
  ShopMode,
  ShopResponse,
  TownActionResultResponse,
  TownRowResponse,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type ShopPanelMode = ShopMode | 'sell' | 'combine';
type Props = { api: TownApi; mode: ShopPanelMode; resolveCaptcha?: () => Promise<void> };

export function ShopPanel({ api, mode, resolveCaptcha }: Props) {
  if (mode === 'sell') return <SellPanel api={api} resolveCaptcha={resolveCaptcha} />;
  if (mode === 'combine') return <CombinePanel api={api} resolveCaptcha={resolveCaptcha} />;
  return <PurchasePanel api={api} mode={mode} resolveCaptcha={resolveCaptcha} />;
}

function PurchasePanel({ api, mode, resolveCaptcha }: Props & { mode: ShopMode }) {
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);
  const [response, setResponse] = useState<ShopResponse | null>(null);
  const load = useCallback(() => api.load<ShopResponse>(`/api/town/shops/${mode}`), [api, mode]);
  const submitAction = useCallback(async (request: PurchaseRequest) => {
    const next = await api.submit<PurchaseRequest, ShopResponse>(`/api/town/shops/${mode}/purchase`, request);
    setResponse(next);
    if (next.result?.status === 'SUCCESS') setCart({});
    setConfirming(false);
    return next.result ?? info('구매 결과를 갱신했습니다.');
  }, [api, mode]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: `shop-${mode}` });
  const data = response ?? town.data;
  const rows = useMemo(() => data?.items.filter((item) => `${item.label} ${item.type ?? ''} ${item.detail ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [data, query]);
  const selected = Object.keys(cart);
  const total = data?.items.reduce((sum, item) => sum + item.price! * (cart[item.id] ?? 0), 0) ?? 0;
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  return <View style={styles.container}>
    {data.stale ? <Text style={styles.warning}>상점 검증이 지연되어 마지막 확인 목록을 표시합니다.</Text> : null}
    <TextInput accessibilityLabel="상점 품목 검색" onChangeText={setQuery} placeholder="이름·유형·설명 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} value={query} />
    <TownItemList rows={rows} selectedIds={selected} selectionMode="multiple" onSelectionChange={(ids) => setCart(Object.fromEntries(ids.map((id) => [id, cart[id] ?? 1])))} />
    {selected.map((id) => <QuantityInput key={id} label={`${data.items.find((item) => item.id === id)?.label ?? id} 구매 수량`} value={cart[id]} onChange={(quantity) => setCart((current) => ({ ...current, [id]: quantity }))} />)}
    <Text style={styles.total}>예상 총액 ${total.toLocaleString()}</Text>
    <ActionButton disabled={selected.length === 0 || town.status === 'submitting'} label="장바구니 구매" onPress={() => setConfirming(true)} />
    {data.result ? <TownActionResult result={data.result} /> : null}
    {town.error ? <Text style={styles.error}>{town.error}</Text> : null}
    <TownConfirmSheet visible={confirming} title="구매 확인" message="선택한 상품을 한 번에 구매합니다." confirmLabel="구매" submitting={town.status === 'submitting'}
      details={[{ label: '상품', value: `${selected.length}종` }, { label: '예상 총액', value: `$${total.toLocaleString()}` }]}
      onCancel={() => setConfirming(false)} onConfirm={() => void town.submit({ items: selected.map((id) => ({ itemId: id, quantity: cart[id] })) }).catch(() => undefined)} />
  </View>;
}

function SellPanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const [selected, setSelected] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);
  const [response, setResponse] = useState<SellResponse | null>(null);
  const load = useCallback(() => api.load<SellResponse>('/api/town/sell'), [api]);
  const submitAction = useCallback(async (request: SellRequest) => {
    const next = await api.submit<SellRequest, SellResponse>('/api/town/sell', request);
    setResponse(next); setConfirming(false); return next.result ?? info('판매 결과를 갱신했습니다.');
  }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: 'sell' });
  const data = response ?? town.data;
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const total = data.items.reduce((sum, item) => sum + (selected.includes(item.id) ? (item.price ?? 0) * (quantities[item.id] ?? 1) : 0), 0);
  const zero = data.items.filter((item) => selected.includes(item.id) && item.price === 0);
  return <View style={styles.container}>
    <Text style={styles.muted}>판매할 품목만 직접 선택하세요. 전체 선택은 제공하지 않습니다.</Text>
    <TownItemList rows={data.items} selectionMode="multiple" selectedIds={selected} onSelectionChange={(ids) => { setSelected(ids); setQuantities((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, current[id] ?? 1])) })); }} />
    {selected.map((id) => <QuantityInput key={id} label={`${data.items.find((item) => item.id === id)?.label ?? id} 판매 수량`} value={quantities[id] ?? 1} onChange={(quantity) => setQuantities((current) => ({ ...current, [id]: quantity }))} />)}
    {zero.length ? <Text style={styles.warning}>$0 판매 품목 {zero.length}개가 포함되어 있습니다.</Text> : null}
    <Text style={styles.total}>예상 판매액 ${total.toLocaleString()}</Text>
    <ActionButton disabled={!selected.length || town.status === 'submitting'} label="선택 품목 판매" onPress={() => setConfirming(true)} />
    {data.result ? <TownActionResult result={data.result} /> : null}
    <TownConfirmSheet visible={confirming} title="판매 확인" message="선택한 품목은 되돌릴 수 없습니다." confirmLabel="판매" submitting={town.status === 'submitting'}
      details={[{ label: '품목', value: `${selected.length}종` }, { label: '예상 판매액', value: `$${total.toLocaleString()}` }, ...(zero.length ? [{ label: '$0 품목', value: `${zero.length}종`, warning: true }] : [])]}
      onCancel={() => setConfirming(false)} onConfirm={() => void town.submit({ items: selected.map((id) => ({ candidateId: id, quantity: quantities[id] ?? 1 })) }).catch(() => undefined)} />
  </View>;
}

function CombinePanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const [primary, setPrimary] = useState<string[]>([]);
  const [secondary, setSecondary] = useState<[string[], string[], string[]]>([[], [], []]);
  const [quantity, setQuantity] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [response, setResponse] = useState<CombineResponse | null>(null);
  const load = useCallback(() => api.load<CombineResponse>('/api/town/combine'), [api]);
  const submitAction = useCallback(async (request: CombineRequest) => { const next = await api.submit<CombineRequest, CombineResponse>('/api/town/combine', request); setResponse(next); setConfirming(false); return next.result ?? info('조합 결과를 갱신했습니다.'); }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: 'combine' });
  const data = response ?? town.data;
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const asRows = (items: Array<{ id: string; label: string; quantity: number | null }>): TownRowResponse[] => items.map((item) => ({ ...item, selectable: true, detail: null, imageUrl: null, price: null }));
  const ready = primary.length === 1 && secondary.every((slot) => slot.length === 1);
  return <View style={styles.container}>
    <Text style={styles.heading}>주재료 1개</Text><TownItemList rows={asRows(data.primary)} selectionMode="single" selectedIds={primary} onSelectionChange={setPrimary} />
    {data.secondarySlots.map((slot, index) => <View key={index} style={styles.container}><Text style={styles.heading}>부재료 {index + 1}</Text><TownItemList rows={asRows(slot)} selectionMode="single" selectedIds={secondary[index]} onSelectionChange={(ids) => setSecondary((current) => current.map((value, slotIndex) => slotIndex === index ? ids : value) as [string[], string[], string[]])} /></View>)}
    <QuantityInput label="조합 수량" value={quantity} onChange={setQuantity} />
    <ActionButton disabled={!ready || town.status === 'submitting'} label="조합" onPress={() => setConfirming(true)} />
    {data.result ? <TownActionResult result={data.result} /> : null}
    <TownConfirmSheet visible={confirming} title="조합 확인" message="주재료와 부재료 3개를 사용합니다." confirmLabel="Combine" submitting={town.status === 'submitting'} details={[{ label: '수량', value: `${quantity}개` }]}
      onCancel={() => setConfirming(false)} onConfirm={() => ready && void town.submit({ primaryCandidateId: primary[0], secondaryCandidateIds: secondary.map((slot) => slot[0]) as [string, string, string], quantity }).catch(() => undefined)} />
  </View>;
}

function QuantityInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <TextInput accessibilityLabel={label} keyboardType="number-pad" onChangeText={(text) => { if (/^[1-9]\d*$/.test(text)) onChange(Number(text)); }} style={styles.input} value={String(value)} />; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => Promise<unknown> }) { return <View style={styles.container}><Text style={error ? styles.error : styles.muted}>{loading ? '목록을 불러오는 중...' : error ?? '목록이 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void retry().catch(() => undefined)} /> : null}</View>; }
function info(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }

const styles = StyleSheet.create({
  container: { gap: theme.spacing.md }, heading: { color: theme.colors.text, fontSize: 15, fontWeight: '900' }, muted: { color: theme.colors.textMuted }, warning: { color: theme.colors.accentAmber, fontWeight: '800' }, error: { color: theme.colors.danger }, total: { color: theme.colors.accentGreen, fontSize: 16, fontWeight: '900' },
  input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md },
  button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 52, padding: theme.spacing.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 },
});
