import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [invalidQuantities, setInvalidQuantities] = useState<Record<string, boolean>>({});
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
  const rows = useMemo(() => data?.items.filter((item) => `${item.label} ${item.type ?? ''} ${item.detail ?? ''} ${item.price}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [data, query]);
  const selected = Object.keys(cart);
  const total = data?.items.reduce((sum, item) => sum + item.price! * (cart[item.id] ?? 0), 0) ?? 0;
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const quantityInvalid = selected.some((id) => {
    const item = data.items.find((entry) => entry.id === id);
    return invalidQuantities[id] || !isValidQuantity(cart[id], maxForPrice(item?.price ?? 0));
  });
  const totalInvalid = !Number.isSafeInteger(total);
  return <View style={styles.container}>
    <TownItemList rows={rows} selectedIds={selected} selectionMode="multiple" onSelectionChange={(ids) => { setCart(Object.fromEntries(ids.map((id) => [id, cart[id] ?? 1]))); setInvalidQuantities((current) => Object.fromEntries(ids.map((id) => [id, current[id] ?? false]))); }}
      header={<View style={styles.section}>{data.stale ? <Text style={styles.warning}>상점 검증이 지연되어 마지막 확인 목록을 표시합니다.</Text> : null}<TextInput accessibilityLabel="상점 품목 검색" onChangeText={setQuery} placeholder="이름·유형·설명·가격 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} value={query} /></View>}
      footer={<View style={styles.section}>{selected.map((id) => { const item = data.items.find((entry) => entry.id === id); return <QuantityInput key={id} label={`${item?.label ?? id} 구매 수량`} value={cart[id]} max={maxForPrice(item?.price ?? 0)} onChange={(quantity) => setCart((current) => ({ ...current, [id]: quantity }))} onValidityChange={(valid) => setInvalidQuantities((current) => ({ ...current, [id]: !valid }))} />; })}<Text style={styles.total}>예상 총액 ${total.toLocaleString()}</Text>{totalInvalid ? <Text style={styles.error}>총액이 안전하게 계산할 수 있는 범위를 넘었습니다.</Text> : null}<ActionButton disabled={selected.length === 0 || quantityInvalid || totalInvalid || town.status === 'submitting'} label="장바구니 구매" onPress={() => setConfirming(true)} />{data.result ? <TownActionResult result={data.result} /> : null}{town.error ? <Text style={styles.error}>{town.error}</Text> : null}</View>} />
    <TownConfirmSheet visible={confirming} title="구매 확인" message="선택한 상품을 한 번에 구매합니다." confirmLabel="구매" submitting={town.status === 'submitting'}
      details={[...selected.map((id) => { const item = data.items.find((entry) => entry.id === id)!; return { label: item.label, value: `${cart[id]}개 · $${((item.price ?? 0) * cart[id]).toLocaleString()}` }; }), { label: '예상 총액', value: `$${total.toLocaleString()}` }]}
      onCancel={() => setConfirming(false)} onConfirm={() => void town.submit({ items: selected.map((id) => ({ itemId: id, quantity: cart[id] })) }).catch(() => undefined)} />
  </View>;
}

function SellPanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const [selected, setSelected] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);
  const [invalidQuantities, setInvalidQuantities] = useState<Record<string, boolean>>({});
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
  const quantityInvalid = selected.some((id) => {
    const item = data.items.find((entry) => entry.id === id);
    return invalidQuantities[id] || !isValidQuantity(quantities[id] ?? 1, item?.quantity ?? MAX_QUANTITY);
  });
  const totalInvalid = !Number.isSafeInteger(total);
  return <View style={styles.container}>
    <TownItemList rows={data.items} selectionMode="multiple" selectedIds={selected} onSelectionChange={(ids) => { setSelected(ids); setQuantities((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, current[id] ?? 1])) })); setInvalidQuantities((current) => Object.fromEntries(ids.map((id) => [id, current[id] ?? false]))); }}
      header={<Text style={styles.muted}>판매할 품목만 직접 선택하세요. 전체 선택은 제공하지 않습니다.</Text>}
      footer={<View style={styles.section}>{selected.map((id) => { const item = data.items.find((entry) => entry.id === id); return <QuantityInput key={id} label={`${item?.label ?? id} 판매 수량`} value={quantities[id] ?? 1} max={item?.quantity ?? MAX_QUANTITY} onChange={(quantity) => setQuantities((current) => ({ ...current, [id]: quantity }))} onValidityChange={(valid) => setInvalidQuantities((current) => ({ ...current, [id]: !valid }))} />; })}{zero.length ? <Text style={styles.warning}>$0 판매 품목 {zero.length}개가 포함되어 있습니다.</Text> : null}<Text style={styles.total}>예상 판매액 ${total.toLocaleString()}</Text>{totalInvalid ? <Text style={styles.error}>총액이 안전하게 계산할 수 있는 범위를 넘었습니다.</Text> : null}<ActionButton disabled={!selected.length || quantityInvalid || totalInvalid || town.status === 'submitting'} label="선택 품목 판매" onPress={() => setConfirming(true)} />{data.result ? <TownActionResult result={data.result} /> : null}</View>} />
    <TownConfirmSheet visible={confirming} title="판매 확인" message="선택한 품목은 되돌릴 수 없습니다." confirmLabel="판매" submitting={town.status === 'submitting'}
      details={[...selected.map((id) => { const item = data.items.find((entry) => entry.id === id)!; return { label: item.label, value: `${quantities[id] ?? 1}개 · $${((item.price ?? 0) * (quantities[id] ?? 1)).toLocaleString()}` }; }), { label: '예상 판매액', value: `$${total.toLocaleString()}` }, ...(zero.length ? [{ label: '$0 품목', value: `${zero.length}종`, warning: true }] : [])]}
      onCancel={() => setConfirming(false)} onConfirm={() => void town.submit({ items: selected.map((id) => ({ candidateId: id, quantity: quantities[id] ?? 1 })) }).catch(() => undefined)} />
  </View>;
}

function CombinePanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const [primary, setPrimary] = useState<string[]>([]);
  const [secondary, setSecondary] = useState<[string[], string[], string[]]>([[], [], []]);
  const [quantity, setQuantity] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [quantityValid, setQuantityValid] = useState(true);
  const [response, setResponse] = useState<CombineResponse | null>(null);
  const load = useCallback(() => api.load<CombineResponse>('/api/town/combine'), [api]);
  const submitAction = useCallback(async (request: CombineRequest) => { const next = await api.submit<CombineRequest, CombineResponse>('/api/town/combine', request); setResponse(next); setConfirming(false); return next.result ?? info('조합 결과를 갱신했습니다.'); }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: 'combine' });
  const data = response ?? town.data;
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const groups = [{ id: 'primary', label: '주재료', items: data.primary }, ...data.secondarySlots.map((items, index) => ({ id: `secondary-${index}`, label: `부재료 ${index + 1}`, items }))];
  const rows: TownRowResponse[] = groups.flatMap((group) => group.items.map((item) => ({ ...item, selectable: true, detail: group.label, imageUrl: null, price: null })));
  const selectedIds = [...primary, ...secondary.flat()];
  const groupById = new Map(groups.flatMap((group) => group.items.map((item) => [item.id, group.id] as const)));
  const ready = primary.length === 1 && secondary.every((slot) => slot.length === 1);
  const allOptions = groups.flatMap((group) => group.items);
  const selectedOptions = selectedIds.map((id) => allOptions.find((item) => item.id === id)).filter((item): item is (typeof allOptions)[number] => item != null);
  const maxQuantity = selectedOptions.reduce((limit, item) => item.quantity == null ? limit : Math.min(limit, item.quantity), MAX_QUANTITY);
  const quantityWithinLimit = Number.isSafeInteger(quantity) && quantity > 0 && quantity <= maxQuantity;
  return <View style={styles.container}>
    <TownItemList rows={rows} selectionMode="grouped-single" selectionGroup={(row) => groupById.get(row.id) ?? row.id} selectedIds={selectedIds} onSelectionChange={(ids) => { setPrimary(ids.filter((id) => groupById.get(id) === 'primary')); setSecondary([0, 1, 2].map((index) => ids.filter((id) => groupById.get(id) === `secondary-${index}`)) as [string[], string[], string[]]); }}
      header={<Text style={styles.muted}>주재료 1개와 부재료 슬롯별 1개를 선택하세요.</Text>}
      footer={<View style={styles.section}><QuantityInput label="조합 결과 수량" value={quantity} max={maxQuantity} onChange={setQuantity} onValidityChange={setQuantityValid} /><ActionButton disabled={!ready || !quantityValid || !quantityWithinLimit || town.status === 'submitting'} label="조합" onPress={() => setConfirming(true)} />{data.result ? <TownActionResult result={data.result} /> : null}</View>} />
    <TownConfirmSheet visible={confirming} title="조합 확인" message="주재료와 부재료 3개를 사용합니다." confirmLabel="Combine" submitting={town.status === 'submitting'} details={[...groups.map((group) => { const id = selectedIds.find((selectedId) => groupById.get(selectedId) === group.id); return { label: group.label, value: `${group.items.find((item) => item.id === id)?.label ?? '미선택'} · ${quantity}개 사용` }; }), { label: '조합 결과 수량', value: `${quantity}개` }]}
      onCancel={() => setConfirming(false)} onConfirm={() => ready && void town.submit({ primaryCandidateId: primary[0], secondaryCandidateIds: secondary.map((slot) => slot[0]) as [string, string, string], quantity }).catch(() => undefined)} />
  </View>;
}

function QuantityInput({ label, value, max, onChange, onValidityChange }: { label: string; value: number; max: number; onChange: (value: number) => void; onValidityChange: (valid: boolean) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const parsed = Number(text);
  const valid = /^[1-9]\d*$/.test(text) && Number.isSafeInteger(parsed) && parsed <= max;
  return <View style={styles.quantityField}><Text style={styles.inputLabel}>{label}</Text><TextInput accessibilityLabel={label} keyboardType="number-pad" onChangeText={(next) => { setText(next); const number = Number(next); const nextValid = /^[1-9]\d*$/.test(next) && Number.isSafeInteger(number) && number <= max; onValidityChange(nextValid); if (nextValid) onChange(number); }} style={[styles.input, !valid && styles.invalidInput]} value={text} />{!valid ? <Text style={styles.error}>1~{max.toLocaleString()} 사이의 정수를 입력하세요.</Text> : null}</View>;
}
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => Promise<unknown> }) { return <View style={styles.container}><Text style={error ? styles.error : styles.muted}>{loading ? '목록을 불러오는 중...' : error ?? '목록이 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void retry().catch(() => undefined)} /> : null}</View>; }
function info(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }

const styles = StyleSheet.create({
  container: { flex: 1, gap: theme.spacing.md }, section: { gap: theme.spacing.md, paddingVertical: theme.spacing.md }, quantityField: { gap: theme.spacing.xs }, inputLabel: { color: theme.colors.text, fontSize: 13, fontWeight: '800' }, muted: { color: theme.colors.textMuted }, warning: { color: theme.colors.accentAmber, fontWeight: '800' }, error: { color: theme.colors.danger }, total: { color: theme.colors.accentGreen, fontSize: 16, fontWeight: '900' },
  input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md },
  invalidInput: { borderColor: theme.colors.danger },
  button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 52, padding: theme.spacing.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 },
});

const MAX_QUANTITY = 2_147_483_647;
function maxForPrice(price: number): number { return price > 0 ? Math.min(MAX_QUANTITY, Math.floor(Number.MAX_SAFE_INTEGER / price)) : MAX_QUANTITY; }
function isValidQuantity(quantity: number, max: number): boolean { return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= max; }
