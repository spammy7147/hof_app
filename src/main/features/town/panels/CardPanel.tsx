import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import type {
  CardChangeRequest, CardIdentifyRequest, CardIdentifyResponse, CardItemResponse, CardMode, CardPairOptionsRequest,
  CardPairResponse, CardSellRequest, CardSellResponse, CardUpgradeRequest, SoulEchoFuseRequest,
  SoulEchoResponse, TownActionResultResponse, TownRowResponse,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownItemList } from '../components/TownItemList';
import { executeWithCaptchaRetry, useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; mode: CardMode; resolveCaptcha?: () => Promise<void> };

export function CardPanel({ api, mode, resolveCaptcha }: Props) {
  if (mode === 'identify') return <IdentifyPanel api={api} resolveCaptcha={resolveCaptcha} />;
  if (mode === 'upgrade' || mode === 'change') return <PairPanel key={mode} api={api} mode={mode} resolveCaptcha={resolveCaptcha} />;
  if (mode === 'sell') return <SellPanel api={api} resolveCaptcha={resolveCaptcha} />;
  return <SoulEchoPanel api={api} resolveCaptcha={resolveCaptcha} />;
}

function IdentifyPanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const [selected, setSelected] = useState<string[]>([]); const [response, setResponse] = useState<CardIdentifyResponse | null>(null);
  const load = useCallback(() => api.load<CardIdentifyResponse>('/api/town/cards/identify'), [api]);
  const submitAction = useCallback(async (request: CardIdentifyRequest) => { const next = await api.submit<CardIdentifyRequest, CardIdentifyResponse>('/api/town/cards/identify', request); setResponse(next); if (next.result?.status === 'SUCCESS') setSelected([]); return next.result ?? info('카드 감정 결과를 갱신했습니다.'); }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: 'card-identify' }); const data = response ?? town.data;
  useEffect(() => { if (!data) return; const live = new Set(data.cards.map((it) => it.id)); setSelected((current) => current.filter((id) => live.has(id))); }, [data]);
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const card = data.cards.find((it) => it.id === selected[0]);
  return <PanelList rows={data.cards} selectedIds={selected} selectionMode="single" onSelectionChange={setSelected} header={<Text style={styles.muted}>감정할 카드 1장을 선택하세요.</Text>} footer={<View style={styles.section}><ActionButton label="선택 카드 감정" disabled={!card || town.status === 'submitting'} onPress={() => card && void town.submit({ candidateId: card.id }).catch(() => undefined)} />{data.result ?? town.result ? <TownActionResult result={(data.result ?? town.result)!} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}</View>} />;
}

function PairPanel({ api, mode, resolveCaptcha }: Props & { mode: 'upgrade' | 'change' }) {
  const [selected, setSelected] = useState<string[]>([]); const [quantityText, setQuantityText] = useState('1'); const [response, setResponse] = useState<CardPairResponse | null>(null); const [options, setOptions] = useState<CardPairResponse | null>(null); const [optionsLoading, setOptionsLoading] = useState(false); const [optionsError, setOptionsError] = useState<string | null>(null); const [materialPickerOpen, setMaterialPickerOpen] = useState(false); const optionsSequence = useRef(0); const mounted = useRef(true);
  const path = `/api/town/cards/${mode}` as const; const title = mode === 'upgrade' ? '카드 강화' : '카드 변화';
  const load = useCallback(() => api.load<CardPairResponse>(path), [api, path]);
  const submitAction = useCallback(async (request: CardUpgradeRequest | CardChangeRequest) => { const next = await api.submit<typeof request, CardPairResponse>(path, request); setResponse(next); if (next.result?.status === 'SUCCESS') { setSelected([]); setOptions(null); setMaterialPickerOpen(false); } return next.result ?? info(`${title} 결과를 갱신했습니다.`); }, [api, path, title]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: `card-${mode}` }); const data = response ?? town.data;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; optionsSequence.current += 1; }; }, []);
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const materialLabel = mode === 'upgrade' ? '추가 카드' : '합성 재료';
  const baseCards = data.baseCards.length ? data.baseCards : town.data?.baseCards ?? [];
  const materialCards = options?.materialCards ?? [];
  const baseRows = baseCards.map((it) => row(it, `base:${it.id}`, '베이스 카드'));
  const base = selected.find((id) => id.startsWith('base:')); const material = selected.find((id) => id.startsWith('material:'));
  const baseCard = baseCards.find((it) => `base:${it.id}` === base); const materialCard = materialCards.find((it) => `material:${it.id}` === material);
  const limit = options ?? data; const selectedMaxQuantity = Math.min(limit.maxQuantity, baseCard?.owned ?? limit.maxQuantity, materialCard?.owned ?? limit.maxQuantity);
  const quantity = Number(quantityText); const validQuantity = /^\d+$/.test(quantityText) && Number.isSafeInteger(quantity) && quantity >= data.minQuantity && quantity <= selectedMaxQuantity;
  const sameCard = baseCard != null && materialCard != null && baseCard.id === materialCard.id;
  const loadOptions = (candidateId: string) => {
    const sequence = ++optionsSequence.current;
    setOptions(null); setOptionsError(null); setOptionsLoading(true);
    void executeWithCaptchaRetry(() => api.submit<CardPairOptionsRequest, CardPairResponse>(`${path}/options`, { baseCandidateId: candidateId }), resolveCaptcha, { isCancelled: () => !mounted.current || sequence !== optionsSequence.current })
      .then((next) => {
        if (!mounted.current || sequence !== optionsSequence.current) return;
        if (next.selectedBaseCandidateId !== candidateId) { setOptionsError(`선택한 베이스 카드의 ${materialLabel} 후보를 확인하지 못했습니다. 다시 시도해 주세요.`); return; }
        setOptions(next);
        setSelected((current) => current.filter((id) => !id.startsWith('material:') || next.materialCards.some((card) => `material:${card.id}` === id)));
      })
      .catch((error: unknown) => { if (!mounted.current || sequence !== optionsSequence.current) return; setOptionsError(toUserFacingErrorMessage(error)); })
      .finally(() => { if (mounted.current && sequence === optionsSequence.current) setOptionsLoading(false); });
  };
  const changeSelection = (ids: string[]) => {
    const nextBase = ids.find((id) => id.startsWith('base:'));
    if (nextBase === base) { setSelected([base, material].filter((id): id is string => id != null)); return; }
    const candidateId = nextBase?.slice('base:'.length); optionsSequence.current += 1;
    setSelected(nextBase ? [nextBase] : []); setOptions(null); setOptionsError(null); setQuantityText('1');
    setMaterialPickerOpen(false);
    if (!candidateId) { setOptionsLoading(false); return; }
    loadOptions(candidateId);
  };
  const action = <ActionButton label={title} disabled={!baseCard || !materialCard || sameCard || !validQuantity || optionsLoading || town.status === 'submitting'} onPress={() => baseCard && materialCard && validQuantity && void town.submit({ baseCandidateId: baseCard.id, materialCandidateId: materialCard.id, quantity }).catch(() => undefined)} />;
  const feedback = <>{data.result ?? town.result ? <TownActionResult result={(data.result ?? town.result)!} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}</>;
  const optionState = <>{optionsLoading ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{materialLabel} 후보를 불러오는 중...</Text> : null}{optionsError ? <><Text accessibilityRole="alert" style={styles.error}>{optionsError}</Text>{baseCard ? <ActionButton label={`${materialLabel} 다시 불러오기`} disabled={optionsLoading} onPress={() => loadOptions(baseCard.id)} /> : null}</> : null}{baseCard && !optionsLoading && options && options.materialCards.length === 0 ? <Text style={styles.muted}>{materialLabel} 후보가 없습니다.</Text> : null}</>;
  const upgradeFooter = <View style={styles.pairActionBar} testID="card-upgrade-controls">
    {action}
    {optionState}
    <MaterialSelectField disabled={!baseCard || optionsLoading || !!optionsError || materialCards.length === 0} label={materialLabel} open={materialPickerOpen} placeholder={!baseCard ? '베이스 카드를 먼저 선택하세요.' : optionsLoading ? `${materialLabel} 후보를 불러오는 중...` : materialCards.length === 0 ? `선택 가능한 ${materialLabel}가 없습니다.` : `${materialLabel}를 선택하세요.`} selected={materialCard} onOpen={() => setMaterialPickerOpen(true)} />
    <QuantityInput label={`${title} 수량`} value={quantityText} onChange={setQuantityText} min={data.minQuantity} max={selectedMaxQuantity} valid={validQuantity} />
    {sameCard ? <Text accessibilityRole="alert" style={styles.error}>베이스 카드와 재료 카드는 서로 달라야 합니다.</Text> : null}
    {feedback}
  </View>;
  const changeActionBar = <View style={styles.pairActionBar} testID="card-change-controls">
    {optionState}
    <QuantityInput label={`${title} 수량`} value={quantityText} onChange={setQuantityText} min={data.minQuantity} max={selectedMaxQuantity} valid={validQuantity} />
    <MaterialSelectField disabled={!baseCard || optionsLoading || !!optionsError || materialCards.length === 0} label={materialLabel} open={materialPickerOpen} placeholder={!baseCard ? '베이스 카드를 먼저 선택하세요.' : optionsLoading ? `${materialLabel} 후보를 불러오는 중...` : materialCards.length === 0 ? `선택 가능한 ${materialLabel}가 없습니다.` : `${materialLabel}를 선택하세요.`} selected={materialCard} onOpen={() => setMaterialPickerOpen(true)} />
    {sameCard ? <Text accessibilityRole="alert" style={styles.error}>베이스 카드와 재료 카드는 서로 달라야 합니다.</Text> : null}
    {action}
    {feedback}
  </View>;
  const list = <PanelList rows={baseRows} selectedIds={selected.filter((id) => id.startsWith('base:'))} selectionMode="single" onSelectionChange={changeSelection}
    header={<View style={styles.section}><Text style={styles.muted}>베이스 카드 1장을 선택한 뒤 하단에서 {materialLabel}를 검색해 선택하세요.</Text>{data.history.length ? <History lines={data.history} /> : null}</View>}
    footer={mode === 'upgrade' ? upgradeFooter : null} />;
  return <>
    {mode === 'upgrade' ? list : <View style={styles.container}><View style={styles.listArea} testID="card-change-list">{list}</View>{changeActionBar}</View>}
    {materialPickerOpen ? <SearchableMaterialSelect cards={materialCards} label={materialLabel} selectedId={materialCard?.id ?? null} onClose={() => setMaterialPickerOpen(false)} onSelect={(candidateId) => { setSelected([base, candidateId ? `material:${candidateId}` : null].filter((id): id is string => id != null)); setMaterialPickerOpen(false); }} /> : null}
  </>;
}

function SellPanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const [selected, setSelected] = useState<string[]>([]); const [quantities, setQuantities] = useState<Record<string, string>>({}); const [query, setQuery] = useState(''); const [response, setResponse] = useState<CardSellResponse | null>(null);
  const load = useCallback(() => api.load<CardSellResponse>('/api/town/cards/sell'), [api]);
  const submitAction = useCallback(async (request: CardSellRequest) => { const next = await api.submit<CardSellRequest, CardSellResponse>('/api/town/cards/sell', request); setResponse(next); if (next.result?.status === 'SUCCESS') { setSelected([]); setQuantities({}); } return next.result ?? info('카드 판매 결과를 갱신했습니다.'); }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: 'card-sell' }); const data = response ?? town.data;
  const visibleCards = useMemo(() => { const needle = query.trim().toLowerCase(); return data?.cards.filter((card) => !needle || [card.label, card.rarity, ...card.restrictions, card.detail].filter(Boolean).join(' ').toLowerCase().includes(needle)) ?? []; }, [data, query]);
  useEffect(() => { if (!data) return; const live = new Set(data.cards.map((it) => it.id)); setSelected((current) => current.filter((id) => live.has(id))); }, [data]);
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const lines = selected.flatMap((id) => { const card = data.cards.find((it) => it.id === id); if (!card) return []; const quantity = Number(quantities[id] ?? '1'); const valid = /^\d+$/.test(quantities[id] ?? '1') && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= (card.maxQuantity ?? card.owned ?? 0); return [{ card, quantity, valid }]; });
  const expected = lines.reduce((sum, it) => sum + (it.valid ? (it.card.blankCardValue ?? 0) * it.quantity : 0), 0);
  return <View style={styles.container}>
    <View style={styles.listArea} testID="card-sell-list"><TownItemList rows={visibleCards.map((card) => row(card))} selectedIds={selected} selectionMode="multiple" onSelectionChange={(ids) => { setSelected(ids); setQuantities((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, current[id] ?? '1'])) })); }}
      header={<View style={styles.section}><Text style={styles.muted}>판매 대가는 Funds가 아니라 Blank Card입니다. 판매할 카드만 직접 선택하세요.</Text><TextInput accessibilityLabel="판매 카드 검색" value={query} onChangeText={setQuery} placeholder="카드명·등급 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} /></View>}
      renderSelectedFooter={(selectedRow) => { const line = lines.find(({ card }) => card.id === selectedRow.id); return line ? <QuantityInput inputAccessibilityLabel={`${line.card.label} 판매 수량`} label="판매 수량" value={quantities[line.card.id] ?? '1'} onChange={(value) => setQuantities((current) => ({ ...current, [line.card.id]: value }))} min={1} max={line.card.maxQuantity ?? line.card.owned ?? 0} valid={line.valid} /> : null; }}
      footer={data.result ?? town.result ? <View style={styles.section}><TownActionResult result={(data.result ?? town.result)!} /></View> : null} /></View>
    <View style={styles.sellActionBar} testID="card-sell-action-bar"><Text style={styles.total}>예상 Blank Card +{expected.toLocaleString()}장</Text>{lines.some(({ card }) => card.blankCardValue == null) ? <Text accessibilityRole="alert" style={styles.error}>일부 카드의 교환량을 확인하지 못해 예상 합계가 실제와 다를 수 있습니다.</Text> : null}{data.blankCardsOwned != null ? <Text style={styles.muted}>현재 보유 {data.blankCardsOwned.toLocaleString()}장</Text> : null}<ActionButton label="선택 카드 판매" disabled={!lines.length || lines.some((it) => !it.valid) || town.status === 'submitting'} onPress={() => void town.submit({ cards: lines.map(({ card, quantity }) => ({ candidateId: card.id, quantity })) }).catch(() => undefined)} />{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}</View>
  </View>;
}

function SoulEchoPanel({ api, resolveCaptcha }: Omit<Props, 'mode'>) {
  const [selected, setSelected] = useState<string[]>([]); const [query, setQuery] = useState(''); const [response, setResponse] = useState<SoulEchoResponse | null>(null);
  const load = useCallback(() => api.load<SoulEchoResponse>('/api/town/cards/soul-echo'), [api]);
  const submitAction = useCallback(async (request: SoulEchoFuseRequest) => { const next = await api.submit<SoulEchoFuseRequest, SoulEchoResponse>('/api/town/cards/soul-echo', request); setResponse(next); return next.result ?? info('소울 에코 융합 결과를 갱신했습니다.'); }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: 'soul-echo' }); const data = response ?? town.data;
  const filteredOwned = useMemo(() => data?.ownedEchoes.filter((it) => `${it.region ?? ''} ${it.name}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [data, query]);
  useEffect(() => { if (!data) return; const live = new Set(data.recipes.map((it) => `recipe:${it.id}`)); setSelected((current) => current.filter((id) => live.has(id))); }, [data]);
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} retry={town.reload} />;
  const currentCategory = data.categories.find((it) => it.id === data.currentCategoryId);
  const rows: TownRowResponse[] = [
    ...data.categories.map((it) => ({ id: `category:${it.id}`, label: it.label, selectable: false, detail: it.id === data.currentCategoryId ? '현재 품목 분류' : '분류 전환 미지원', imageUrl: null, price: null, quantity: null })),
    ...data.recipes.map((it) => ({ id: `recipe:${it.id}`, label: it.label, selectable: it.selectable && it.category === data.currentCategoryId, detail: [data.categories.find((category) => category.id === it.category)?.label ?? it.category, it.category !== data.currentCategoryId ? '현재 분류와 다름' : null, ...it.requiredEchoes, it.successBonus != null ? `성공 보정 +${it.successBonus}%` : null].filter(Boolean).join(' · '), imageUrl: null, price: it.cost, quantity: null })),
    ...filteredOwned.map((it, index) => ({ id: `owned:${it.region ?? '기타'}:${it.name}:${index}`, label: it.name, selectable: false, detail: `보유 Echo · ${it.region ?? '기타'}`, imageUrl: null, price: null, quantity: it.quantity })),
  ];
  const categoryId = data.currentCategoryId; const recipeId = selected.find((id) => id.startsWith('recipe:'))?.slice('recipe:'.length); const recipe = data.recipes.find((it) => it.id === recipeId);
  return <PanelList rows={rows} selectedIds={[...(categoryId ? [`category:${categoryId}`] : []), ...selected]} selectionMode="grouped-single" selectionGroup={(it) => it.id.startsWith('category:') ? 'category' : 'recipe'} onSelectionChange={(ids) => setSelected(ids.filter((id) => id.startsWith('recipe:')))}
    header={<View style={styles.section}><Text style={styles.muted}>현재 HOF 분류({currentCategory?.label ?? '확인 불가'})의 융합 품목을 선택하세요. 보유 Echo는 지역별 표기로 함께 표시됩니다.</Text><TextInput accessibilityLabel="보유 소울 에코 검색" value={query} onChangeText={setQuery} placeholder="지역·보스 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} />{data.history.length ? <History lines={data.history.map((it) => `${it.success ? '성공' : '실패'} · ${it.text}`)} /> : null}</View>}
    footer={<View style={styles.section}>{!categoryId ? <Text accessibilityRole="alert" style={styles.error}>현재 품목 분류를 확인하지 못했습니다.</Text> : null}<ActionButton label="소울 에코 융합" disabled={!categoryId || !recipe || town.status === 'submitting'} onPress={() => categoryId && recipe && void town.submit({ categoryCandidateId: categoryId, recipeCandidateId: recipe.id }).catch(() => undefined)} />{data.result ?? town.result ? <TownActionResult result={(data.result ?? town.result)!} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}</View>} />;
}

function PanelList({ rows, ...props }: { rows: CardItemResponse[] | TownRowResponse[] } & Omit<ComponentProps<typeof TownItemList>, 'rows'>) { return <View style={styles.container}><TownItemList rows={rows.map((it) => 'imageUrl' in it ? it : row(it))} {...props} /></View>; }
function row(item: CardItemResponse, id = item.id, prefix?: string): TownRowResponse { const detail = [prefix, item.rarity, ...item.restrictions, item.detail].filter(Boolean).join(' · '); return { id, label: item.label, accessibilityLabel: prefix ? `${prefix} ${item.label} 선택` : undefined, selectable: item.selectable, detail: detail || null, imageUrl: null, price: item.cost, quantity: item.owned }; }
function MaterialSelectField({ disabled, label, open, placeholder, selected, onOpen }: { disabled: boolean; label: string; open: boolean; placeholder: string; selected: CardItemResponse | undefined; onOpen: () => void }) {
  return <View style={styles.materialField}>
    <Text style={styles.label}>{label}</Text>
    <Pressable accessibilityLabel={`${label} 선택`} accessibilityRole="button" accessibilityState={{ disabled, expanded: open }} disabled={disabled} onPress={onOpen} style={({ pressed }) => [styles.materialSelect, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <View style={styles.materialSelectText}>
        <Text numberOfLines={1} style={selected ? styles.materialValue : styles.materialPlaceholder}>{selected?.label ?? placeholder}</Text>
        {selected ? <Text style={styles.materialMeta}>{[selected.rarity, selected.owned != null ? `보유 ${selected.owned.toLocaleString()}장` : null].filter(Boolean).join(' · ')}</Text> : null}
      </View>
      <Text style={styles.chevron}>⌄</Text>
    </Pressable>
  </View>;
}
function SearchableMaterialSelect({ cards, label, selectedId, onClose, onSelect }: { cards: CardItemResponse[]; label: string; selectedId: string | null; onClose: () => void; onSelect: (candidateId: string) => void }) {
  const [query, setQuery] = useState('');
  const visibleCards = useMemo(() => { const needle = query.trim().toLowerCase(); return cards.filter((card) => card.selectable && (!needle || [card.label, card.rarity, ...card.restrictions, card.detail].filter(Boolean).join(' ').toLowerCase().includes(needle))); }, [cards, query]);
  return <Modal animationType="slide" onRequestClose={onClose} presentationStyle="overFullScreen" transparent visible>
    <View accessibilityViewIsModal style={styles.modalRoot}>
      <Pressable accessibilityLabel={`${label} 선택 배경 닫기`} accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHeader}><Text style={styles.modalTitle}>{label} 선택</Text><Pressable accessibilityLabel={`${label} 선택 닫기`} accessibilityRole="button" onPress={onClose} style={styles.modalClose}><Text style={styles.modalCloseText}>닫기</Text></Pressable></View>
        <TextInput accessibilityLabel={`${label} 검색`} autoFocus value={query} onChangeText={setQuery} placeholder="카드명·등급 검색" placeholderTextColor={theme.colors.textMuted} style={styles.input} />
        <FlatList accessibilityRole="radiogroup" data={visibleCards} keyboardShouldPersistTaps="handled" keyExtractor={(item) => item.id} ListEmptyComponent={<Text style={styles.muted}>검색 결과가 없습니다.</Text>} contentContainerStyle={styles.modalList} renderItem={({ item }) => {
          const checked = item.id === selectedId;
          return <Pressable accessibilityLabel={`${label} ${item.label} 선택`} accessibilityRole="radio" accessibilityState={{ checked }} onPress={() => onSelect(item.id)} style={[styles.modalOption, checked && styles.modalOptionSelected]}>
            <View style={styles.modalOptionText}><Text style={styles.modalOptionLabel}>{item.label}</Text><Text style={styles.modalOptionDetail}>{[item.rarity, ...item.restrictions, item.detail, item.owned != null ? `보유 ${item.owned.toLocaleString()}장` : null, item.cost != null ? `${item.cost.toLocaleString()} Funds` : null].filter(Boolean).join(' · ')}</Text></View>
            {checked ? <Text style={styles.selectedMark}>✓</Text> : null}
          </Pressable>;
        }} />
      </View>
    </View>
  </Modal>;
}
function QuantityInput({ label, inputAccessibilityLabel = label, value, onChange, min, max, valid }: { label: string; inputAccessibilityLabel?: string; value: string; onChange: (value: string) => void; min: number; max: number; valid: boolean }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={inputAccessibilityLabel} keyboardType="number-pad" value={value} onChangeText={onChange} style={[styles.input, !valid && styles.invalid]} />{!valid ? <Text style={styles.error}>{min}~{max.toLocaleString()} 사이의 정수를 입력하세요.</Text> : null}</View>; }
function History({ lines }: { lines: string[] }) { const [open, setOpen] = useState(false); return <View><Pressable accessibilityLabel="최근 카드 결과 펼치기" accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((value) => !value)}><Text style={styles.historyTitle}>최근 결과 {open ? '접기' : '펼치기'}</Text></Pressable>{open ? lines.slice(-30).map((line, index) => <Text key={`${line}-${index}`} style={styles.muted}>{line}</Text>) : null}</View>; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => Promise<unknown> }) { return <View style={styles.container}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.muted}>{loading ? '카드 정보를 불러오는 중...' : error ?? '카드 정보가 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void retry().catch(() => undefined)} /> : null}</View>; }
function info(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }

const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, listArea: { flex: 1, minHeight: 0 }, sellActionBar: { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.xs, padding: theme.spacing.sm }, pairActionBar: { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, marginTop: theme.spacing.md, padding: theme.spacing.sm }, section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md }, muted: { color: theme.colors.textMuted, lineHeight: 20 }, owned: { color: theme.colors.text, fontSize: 13 }, total: { color: theme.colors.accentGreen, fontSize: 16, fontWeight: '900' }, error: { color: theme.colors.danger }, field: { gap: theme.spacing.xs }, materialField: { gap: theme.spacing.xs }, label: { color: theme.colors.text, fontWeight: '800' }, materialSelect: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', minHeight: 56, paddingHorizontal: theme.spacing.md }, materialSelectText: { flex: 1, gap: 2 }, materialValue: { color: theme.colors.text, fontWeight: '800' }, materialPlaceholder: { color: theme.colors.textMuted }, materialMeta: { color: theme.colors.textMuted, fontSize: 12 }, chevron: { color: theme.colors.text, fontSize: 20, marginLeft: theme.spacing.sm }, input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md }, invalid: { borderColor: theme.colors.danger }, button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 52, padding: theme.spacing.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.75 }, historyTitle: { color: theme.colors.accentBlue, fontWeight: '800', paddingVertical: theme.spacing.sm }, modalRoot: { flex: 1, justifyContent: 'flex-end' }, modalBackdrop: { backgroundColor: 'rgba(0, 0, 0, 0.6)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 }, modalSheet: { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderTopLeftRadius: theme.radius.md, borderTopRightRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, maxHeight: '78%', padding: theme.spacing.md }, modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, modalTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '900' }, modalClose: { padding: theme.spacing.sm }, modalCloseText: { color: theme.colors.accentBlue, fontWeight: '800' }, modalList: { gap: theme.spacing.xs, paddingBottom: theme.spacing.md }, modalOption: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', minHeight: 58, padding: theme.spacing.sm }, modalOptionSelected: { borderColor: theme.colors.accentGreen }, modalOptionText: { flex: 1, gap: 3 }, modalOptionLabel: { color: theme.colors.text, fontWeight: '800' }, modalOptionDetail: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 }, selectedMark: { color: theme.colors.accentGreen, fontSize: 18, fontWeight: '900', marginLeft: theme.spacing.sm } });
