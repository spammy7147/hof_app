import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type {
  CombineRequest,
  CombineOptionResponse,
  CombineResponse,
  PurchaseRequest,
  SellRequest,
  SellResponse,
  ShopMode,
  ShopItemResponse,
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

function PurchasePanel({ api, mode }: Props & { mode: ShopMode }) {
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
  // 공용 상점 목록 조회/구매는 화면을 CAPTCHA 대기 상태로 묶지 않는다.
  const town = useTownFeature({ load, submitAction, featureKey: `shop-${mode}` });
  const data = response ?? town.data;
  const rows = useMemo(() => data?.items
    .filter((item) => `${item.label} ${item.type ?? ''} ${item.detail ?? ''} ${item.price}`.toLowerCase().includes(query.trim().toLowerCase()))
    .map(presentShopItem) ?? [], [data, query]);
  const selected = Object.keys(cart);
  const total = data?.items.reduce((sum, item) => sum + item.price! * (cart[item.id] ?? 0), 0) ?? 0;
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const quantityInvalid = selected.some((id) => {
    const item = data.items.find((entry) => entry.id === id);
    return invalidQuantities[id] || !isValidQuantity(cart[id], maxForPrice(item?.price ?? 0));
  });
  const totalInvalid = !Number.isSafeInteger(total);
  return <View style={styles.container}>
    <View style={styles.listArea}>
      <TownItemList rows={rows} selectedIds={selected} selectionMode="multiple" onSelectionChange={(ids) => { setCart(Object.fromEntries(ids.map((id) => [id, cart[id] ?? 1]))); setInvalidQuantities((current) => Object.fromEntries(ids.map((id) => [id, current[id] ?? false]))); }}
        header={<View style={styles.section}>{data.stale ? <Text style={styles.warning}>상점 검증이 지연되어 마지막 확인 목록을 표시합니다.</Text> : null}<TextInput accessibilityLabel="상점 품목 검색" onChangeText={setQuery} placeholder="이름·유형·설명·가격 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} value={query} /></View>}
        renderSelectedFooter={(row) => { const item = data.items.find((entry) => entry.id === row.id); return item ? <QuantityInput inputAccessibilityLabel={`${item.label} 구매 수량`} label="수량" value={cart[item.id]} max={maxForPrice(item.price ?? 0)} onChange={(quantity) => setCart((current) => ({ ...current, [item.id]: quantity }))} onValidityChange={(valid) => setInvalidQuantities((current) => ({ ...current, [item.id]: !valid }))} /> : null; }}
        footer={data.result || town.error ? <View style={styles.section}>{data.result ? <TownActionResult result={data.result} /> : null}{town.error ? <Text style={styles.error}>{town.error}</Text> : null}</View> : null} />
    </View>
    <View style={styles.purchaseActionBar} testID="purchase-action-bar">
      <Text style={styles.total}>예상 총액 ${total.toLocaleString()}</Text>
      {quantityInvalid ? <Text style={styles.error}>선택한 품목의 수량을 확인하세요.</Text> : null}
      {totalInvalid ? <Text style={styles.error}>총액이 안전하게 계산할 수 있는 범위를 넘었습니다.</Text> : null}
      <ActionButton disabled={selected.length === 0 || quantityInvalid || totalInvalid || town.status === 'submitting'} label="장바구니 구매" onPress={() => setConfirming(true)} />
    </View>
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
  const rows = useMemo(() => data?.items.map(presentSellItem) ?? [], [data]);
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const total = data.items.reduce((sum, item) => sum + (selected.includes(item.id) ? (item.price ?? 0) * (quantities[item.id] ?? 1) : 0), 0);
  const zero = data.items.filter((item) => selected.includes(item.id) && item.price === 0);
  const quantityInvalid = selected.some((id) => {
    const item = data.items.find((entry) => entry.id === id);
    return invalidQuantities[id] || !isValidQuantity(quantities[id] ?? 1, item?.quantity ?? MAX_QUANTITY);
  });
  const totalInvalid = !Number.isSafeInteger(total);
  return <View style={styles.container}>
    <View style={styles.listArea}>
      <TownItemList rows={rows} selectionMode="multiple" selectedIds={selected} onSelectionChange={(ids) => { setSelected(ids); setQuantities((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, current[id] ?? 1])) })); setInvalidQuantities((current) => Object.fromEntries(ids.map((id) => [id, current[id] ?? false]))); }}
        header={<Text style={styles.muted}>판매할 품목만 직접 선택하세요. 전체 선택은 제공하지 않습니다.</Text>}
        renderSelectedFooter={(row) => { const item = data.items.find((entry) => entry.id === row.id); return item ? <QuantityInput inputAccessibilityLabel={`${item.label} 판매 수량`} label="수량" value={quantities[item.id] ?? 1} max={item.quantity ?? MAX_QUANTITY} onChange={(quantity) => setQuantities((current) => ({ ...current, [item.id]: quantity }))} onValidityChange={(valid) => setInvalidQuantities((current) => ({ ...current, [item.id]: !valid }))} /> : null; }}
        footer={data.result ? <View style={styles.section}><TownActionResult result={data.result} /></View> : null} />
    </View>
    <View style={styles.sellActionBar} testID="sell-action-bar">
      {zero.length ? <Text style={styles.warning}>$0 판매 품목 {zero.length}개가 포함되어 있습니다.</Text> : null}
      <Text style={styles.total}>예상 판매액 ${total.toLocaleString()}</Text>
      {quantityInvalid ? <Text style={styles.error}>선택한 품목의 수량을 확인하세요.</Text> : null}
      {totalInvalid ? <Text style={styles.error}>총액이 안전하게 계산할 수 있는 범위를 넘었습니다.</Text> : null}
      <ActionButton disabled={!selected.length || quantityInvalid || totalInvalid || town.status === 'submitting'} label="선택 품목 판매" onPress={() => setConfirming(true)} />
    </View>
    <TownConfirmSheet visible={confirming} title="판매 확인" message="선택한 품목은 되돌릴 수 없습니다." confirmLabel="판매" submitting={town.status === 'submitting'}
      details={[...selected.map((id) => { const item = data.items.find((entry) => entry.id === id)!; return { label: item.label, value: `${quantities[id] ?? 1}개 · $${((item.price ?? 0) * (quantities[id] ?? 1)).toLocaleString()}` }; }), { label: '예상 판매액', value: `$${total.toLocaleString()}` }, ...(zero.length ? [{ label: '$0 품목', value: `${zero.length}종`, warning: true }] : [])]}
      onCancel={() => setConfirming(false)} onConfirm={() => void town.submit({ items: selected.map((id) => ({ candidateId: id, quantity: quantities[id] ?? 1 })) }).catch(() => undefined)} />
  </View>;
}

function CombinePanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const [selections, setSelections] = useState<Record<CombineSlotId, string | null>>(EMPTY_COMBINE_SELECTIONS);
  const [activeSlotId, setActiveSlotId] = useState<CombineSlotId | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [quantityValid, setQuantityValid] = useState(true);
  const [response, setResponse] = useState<CombineResponse | null>(null);
  const load = useCallback(() => api.load<CombineResponse>('/api/town/combine'), [api]);
  const submitAction = useCallback(async (request: CombineRequest) => { const next = await api.submit<CombineRequest, CombineResponse>('/api/town/combine', request); setResponse(next); setConfirming(false); return next.result ?? info('조합 결과를 갱신했습니다.'); }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: 'combine' });
  const data = response ?? town.data;
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const groups: CombineSlot[] = [
    { id: 'primary', label: '주재료', items: data.primary },
    { id: 'secondary-large', label: '부재료(대)', items: data.secondarySlots[0] ?? [] },
    { id: 'secondary-medium', label: '부재료(중)', items: data.secondarySlots[1] ?? [] },
    { id: 'secondary-small', label: '부재료(소)', items: data.secondarySlots[2] ?? [] },
  ];
  const selectedOptions = groups.map((group) => group.items.find((item) => item.id === selections[group.id]) ?? null);
  const ready = selectedOptions.every((item) => item != null);
  const maxQuantity = selectedOptions.reduce((limit, item) => item?.quantity == null ? limit : Math.min(limit, item.quantity), MAX_QUANTITY);
  const quantityWithinLimit = Number.isSafeInteger(quantity) && quantity > 0 && quantity <= maxQuantity;
  const activeSlot = groups.find((group) => group.id === activeSlotId) ?? null;
  return <View style={styles.container}>
    <Text style={styles.muted}>주재료와 부재료(대·중·소)를 각각 선택하세요.</Text>
    <View style={styles.combineFields}>
      {groups.map((group) => <CombineSelectField key={group.id} group={group} selectedId={selections[group.id]} onPress={() => setActiveSlotId(group.id)} />)}
    </View>
    <View style={styles.section}>
      <QuantityInput label="조합 결과 수량" value={quantity} max={maxQuantity} onChange={setQuantity} onValidityChange={setQuantityValid} />
      <ActionButton disabled={!ready || !quantityValid || !quantityWithinLimit || town.status === 'submitting'} label="조합" onPress={() => setConfirming(true)} />
      {data.result ? <TownActionResult result={data.result} /> : null}
    </View>
    {activeSlot ? <SearchableCombineSelect key={activeSlot.id} group={activeSlot} selectedId={selections[activeSlot.id]} onClose={() => setActiveSlotId(null)} onSelect={(candidateId) => { setSelections((current) => ({ ...current, [activeSlot.id]: candidateId })); setActiveSlotId(null); }} /> : null}
    <TownConfirmSheet visible={confirming} title="조합 확인" message="주재료와 부재료 3개를 사용합니다." confirmLabel="Combine" submitting={town.status === 'submitting'} details={[...groups.map((group) => { const item = group.items.find((candidate) => candidate.id === selections[group.id]); return { label: group.label, value: `${item?.label ?? '미선택'} · ${quantity}개 사용` }; }), { label: '조합 결과 수량', value: `${quantity}개` }]}
      onCancel={() => setConfirming(false)} onConfirm={() => ready && void town.submit({ primaryCandidateId: selectedOptions[0]!.id, secondaryCandidateIds: selectedOptions.slice(1).map((item) => item!.id) as [string, string, string], quantity }).catch(() => undefined)} />
  </View>;
}

type CombineSlotId = 'primary' | 'secondary-large' | 'secondary-medium' | 'secondary-small';
type CombineSlot = { id: CombineSlotId; label: string; items: CombineOptionResponse[] };
const EMPTY_COMBINE_SELECTIONS: Record<CombineSlotId, string | null> = { primary: null, 'secondary-large': null, 'secondary-medium': null, 'secondary-small': null };

function CombineSelectField({ group, selectedId, onPress }: { group: CombineSlot; selectedId: string | null; onPress: () => void }) {
  const selected = group.items.find((item) => item.id === selectedId) ?? null;
  return <Pressable accessibilityLabel={`${group.label} 선택`} accessibilityRole="button" accessibilityState={{ expanded: false }} onPress={onPress} style={({ pressed }) => [styles.combineField, pressed && styles.pressed]}>
    <Text style={styles.inputLabel}>{group.label}</Text>
    <Text numberOfLines={1} style={selected ? styles.combineValue : styles.combinePlaceholder}>{selected ? `${selected.label}${selected.quantity == null ? '' : ` x ${selected.quantity.toLocaleString()}`}` : '소재를 선택하세요.'}</Text>
    <Text style={styles.dropdownMark}>⌄</Text>
  </Pressable>;
}

function SearchableCombineSelect({ group, selectedId, onClose, onSelect }: { group: CombineSlot; selectedId: string | null; onClose: () => void; onSelect: (candidateId: string | null) => void }) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const options = group.items.filter((item) => item.label.toLowerCase().includes(normalizedQuery));
  return <Modal animationType="slide" onRequestClose={onClose} presentationStyle="overFullScreen" transparent visible>
    <View style={styles.modalRoot}>
      <Pressable accessibilityLabel={`${group.label} 선택 닫기`} accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHeader}><Text style={styles.modalTitle}>{group.label} 선택</Text><Pressable accessibilityLabel={`${group.label} 선택 닫기`} accessibilityRole="button" onPress={onClose} style={styles.modalClose}><Text style={styles.modalCloseText}>닫기</Text></Pressable></View>
        <TextInput accessibilityLabel={`${group.label} 소재 검색`} autoCapitalize="none" autoCorrect={false} onChangeText={setQuery} placeholder="소재명 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} value={query} />
        <FlatList data={[{ id: '__none__', label: '선택 해제', quantity: null }, ...options]} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" ListEmptyComponent={<Text style={styles.muted}>검색 결과가 없습니다.</Text>} renderItem={({ item }) => { const candidateId = item.id === '__none__' ? null : item.id; const selected = candidateId === selectedId; return <Pressable accessibilityLabel={`${item.label} 선택`} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => onSelect(candidateId)} style={[styles.modalOption, selected && styles.modalOptionSelected]}><View style={styles.modalOptionText}><Text style={styles.combineValue}>{item.label}</Text>{item.quantity != null ? <Text style={styles.muted}>보유 {item.quantity.toLocaleString()}</Text> : null}</View>{selected ? <Text style={styles.selectedMark}>선택됨</Text> : null}</Pressable>; }} style={styles.modalList} />
      </View>
    </View>
  </Modal>;
}

function QuantityInput({ label, inputAccessibilityLabel = label, value, max, onChange, onValidityChange }: { inputAccessibilityLabel?: string; label: string; value: number; max: number; onChange: (value: number) => void; onValidityChange: (valid: boolean) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const parsed = Number(text);
  const valid = /^[1-9]\d*$/.test(text) && Number.isSafeInteger(parsed) && parsed <= max;
  return <View style={styles.quantityField}><Text style={styles.inputLabel}>{label}</Text><TextInput accessibilityLabel={inputAccessibilityLabel} keyboardType="number-pad" onChangeText={(next) => { setText(next); const number = Number(next); const nextValid = /^[1-9]\d*$/.test(next) && Number.isSafeInteger(number) && number <= max; onValidityChange(nextValid); if (nextValid) onChange(number); }} style={[styles.input, !valid && styles.invalidInput]} value={text} />{!valid ? <Text style={styles.error}>1~{max.toLocaleString()} 사이의 정수를 입력하세요.</Text> : null}</View>;
}
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => Promise<unknown> }) { return <View style={styles.container}><Text style={error ? styles.error : styles.muted}>{loading ? '목록을 불러오는 중...' : error ?? '목록이 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void retry().catch(() => undefined)} /> : null}</View>; }
function info(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }

const styles = StyleSheet.create({
  container: { flex: 1, gap: theme.spacing.md }, listArea: { flex: 1, minHeight: 0 }, section: { gap: theme.spacing.md, paddingVertical: theme.spacing.md }, quantityField: { gap: theme.spacing.xs }, inputLabel: { color: theme.colors.text, fontSize: 13, fontWeight: '800' }, muted: { color: theme.colors.textMuted }, warning: { color: theme.colors.accentAmber, fontWeight: '800' }, error: { color: theme.colors.danger }, total: { color: theme.colors.accentGreen, fontSize: 16, fontWeight: '900' },
  input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md },
  invalidInput: { borderColor: theme.colors.danger },
  button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 52, padding: theme.spacing.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 },
  purchaseActionBar: { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  sellActionBar: { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  combineFields: { gap: theme.spacing.sm }, combineField: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.xs, minHeight: 72, padding: theme.spacing.md, paddingRight: theme.spacing.xl }, combineValue: { color: theme.colors.text, fontSize: 15, fontWeight: '800' }, combinePlaceholder: { color: theme.colors.textMuted, fontSize: 15 }, dropdownMark: { color: theme.colors.textMuted, fontSize: 20, position: 'absolute', right: theme.spacing.md, top: 25 }, pressed: { opacity: 0.78 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' }, modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.62)' }, modalSheet: { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderTopLeftRadius: theme.radius.md, borderTopRightRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.md, maxHeight: '82%', padding: theme.spacing.lg }, modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, modalTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '900' }, modalClose: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.md }, modalCloseText: { color: theme.colors.accentBlue, fontWeight: '800' }, modalList: { minHeight: 180 }, modalOption: { alignItems: 'center', borderBottomColor: theme.colors.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 60, paddingVertical: theme.spacing.sm }, modalOptionSelected: { backgroundColor: theme.colors.surfaceAlt }, modalOptionText: { flex: 1, gap: theme.spacing.xs }, selectedMark: { color: theme.colors.accentGreen, fontWeight: '900' },
});

const MAX_QUANTITY = 2_147_483_647;
function maxForPrice(price: number): number { return price > 0 ? Math.min(MAX_QUANTITY, Math.floor(Number.MAX_SAFE_INTEGER / price)) : MAX_QUANTITY; }
function isValidQuantity(quantity: number, max: number): boolean { return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= max; }

function presentShopItem(item: ShopItemResponse): ShopItemResponse {
  const raw = item.detail?.trim() ?? '';
  const withoutPrice = raw.replace(/^[$￦]\s*[0-9][0-9,]*\s*/, '').trim();
  let inferredType = item.type?.trim() || null;
  let detail = withoutPrice;
  if (withoutPrice.startsWith(item.label)) {
    detail = withoutPrice.slice(item.label.length).trim();
    const prefix = detail.match(/^((?:\s*\([^)]*\))+)(?:\s*\/\s*)?/);
    if (prefix) {
      const tokens = [...prefix[1].matchAll(/\(([^)]*)\)/g)];
      const typeToken = inferredType
        ? tokens.find((token) => token[1].trim().toLowerCase() === inferredType?.toLowerCase())
        : [...tokens].reverse().find((token) => /^[A-Za-z][A-Za-z &-]*$/.test(token[1].trim()));
      if (typeToken) {
        inferredType ??= typeToken[1].trim();
        const remainingPrefix = prefix[1].replace(typeToken[0], '').replace(/\s+/g, ' ').trim();
        const remainder = detail.slice(prefix[0].length).trim();
        detail = [remainingPrefix, remainder].filter(Boolean).join(' / ');
      }
    }
    detail = detail.replace(/^\/\s*/, '').trim();
  }
  const labelHasType = /\([^)]+\)\s*$/.test(item.label);
  return {
    ...item,
    accessibilityLabel: `${item.label} 선택`,
    label: inferredType && !labelHasType ? `${item.label} (${inferredType})` : item.label,
    detail: detail || null,
    type: inferredType,
  };
}

function presentSellItem(item: SellResponse['items'][number]): TownRowResponse {
  const normalized = presentShopItem(item);
  const label = normalized.label.replace(/\s+(?:x|×)\s*[0-9][0-9,]*\s*$/i, '').trim();
  const detail = normalized.detail?.replace(/^(?:x|×|보유\s*)\s*[0-9][0-9,]*\s*(?:\/\s*)?/i, '').trim() || null;
  return {
    ...normalized,
    accessibilityLabel: `${item.label} 선택`,
    label: `${label}${item.quantity == null ? '' : ` x ${item.quantity.toLocaleString()}`}`,
    detail,
    quantity: null,
  };
}
