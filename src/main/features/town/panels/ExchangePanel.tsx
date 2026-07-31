import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type {
  AnnAction, AnnActionRequest, ExchangeMode, ExchangeResponse, ExchangeTradeRequest,
  LegacyGradeExchangeRequest, TownActionResultResponse, TownRowResponse,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { TownMutationBusyError, useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; mode: ExchangeMode; resolveCaptcha?: () => Promise<void> };
type Mutation =
  | { kind: 'trade'; request: ExchangeTradeRequest }
  | { kind: 'grade'; request: LegacyGradeExchangeRequest }
  | { kind: 'ann'; request: AnnActionRequest };
type Confirm =
  | { kind: 'trade'; request: ExchangeTradeRequest; itemLabel: string }
  | { kind: 'grade'; id: string; label: string }
  | { kind: 'ann'; request: AnnActionRequest; label: string; itemLabel: string | null }
  | null;
type Loaded = { key: string; value: ExchangeResponse };

const apiKeys = new WeakMap<object, number>();
let nextApiKey = 1;

export function ExchangePanel({ api, mode, resolveCaptcha }: Props) {
  const apiKey = identifyApi(api);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quantityText, setQuantityText] = useState('1');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [response, setResponse] = useState<ExchangeResponse | null>(null);
  const [actionResult, setActionResult] = useState<{ key: string; value: TownActionResultResponse } | null>(null);
  const staged = useRef<ExchangeResponse | null>(null);
  const path = categoryId == null
    ? `/api/town/exchanges/${mode}` as const
    : `/api/town/exchanges/${mode}?categoryCandidateId=${encodeURIComponent(categoryId)}` as const;
  const featureKey = `exchange-${apiKey}-${mode}-${categoryId ?? 'default'}`;
  const activeFeatureKey = useRef(featureKey);
  activeFeatureKey.current = featureKey;
  const load = useCallback(async (): Promise<Loaded> => ({ key: featureKey, value: await api.load<ExchangeResponse>(path) }), [api, featureKey, path]);
  const submitAction = useCallback(async (mutation: Mutation) => {
    const next = mutation.kind === 'trade'
      ? await api.submit<ExchangeTradeRequest, ExchangeResponse>(`/api/town/exchanges/${mode}/trade`, mutation.request)
      : mutation.kind === 'grade'
        ? await api.submit<LegacyGradeExchangeRequest, ExchangeResponse>('/api/town/exchanges/legacy/grade', mutation.request)
        : await api.submit<AnnActionRequest, ExchangeResponse>('/api/town/exchanges/ann/action', mutation.request);
    if (activeFeatureKey.current === featureKey) staged.current = next;
    return next.result ?? informational('시설 정보를 갱신했습니다.');
  }, [api, featureKey, mode]);
  const town = useTownFeature<Loaded, Mutation>({ load, submitAction, resolveCaptcha, featureKey });
  const loaded = town.data?.key === featureKey ? town.data.value : null;
  const scope = `${apiKey}-${mode}`;
  const last = useRef<{ scope: string; value: ExchangeResponse } | null>(null);
  if (loaded) last.current = { scope, value: loaded };
  const data = response ?? loaded ?? (last.current?.scope === scope ? last.current.value : null);

  useEffect(() => {
    staged.current = null; setCategoryId(null); setSelectedIds([]); setQuantityText('1'); setConfirm(null);
    setHistoryOpen(false); setResponse(null); setActionResult(null);
  }, [apiKey, mode]);
  useEffect(() => {
    staged.current = null; setSelectedIds([]); setConfirm(null); setResponse(null); setActionResult(null);
  }, [categoryId]);
  useEffect(() => {
    if (!data) return;
    const live = new Set([
      ...data.rows.filter((row) => row.selectable).map((row) => `trade:${row.id}`),
      ...data.annActions.flatMap((action) => action.rows.filter((row) => row.selectable).map((row) => `ann:${action.type}:${row.id}`)),
    ]);
    setSelectedIds((ids) => ids.filter((id) => live.has(id)));
  }, [data]);

  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} />;
  const rows: TownRowResponse[] = [
    ...data.rows.map((row) => toTownRow(`trade:${row.id}`, row, '교환 품목')),
    ...data.annActions.flatMap((action) => action.rows.map((row) => toTownRow(`ann:${action.type}:${row.id}`, row, action.label))),
    ...(historyOpen ? data.history.map((line, index): TownRowResponse => ({ id: `history:${index}`, label: line, accessibilityLabel: line, selectable: false, detail: null, imageUrl: null, price: null, quantity: null })) : []),
  ];
  const quantity = Number(quantityText);
  const selectedTradeId = selectedIds.find((id) => id.startsWith('trade:'))?.slice('trade:'.length);
  const selectedTrade = data.rows.find((row) => row.id === selectedTradeId);
  const selectedAnn = (action: AnnAction) => {
    const prefix = `ann:${action}:`;
    const id = selectedIds.find((value) => value.startsWith(prefix))?.slice(prefix.length);
    return data.annActions.find((group) => group.type === action)?.rows.find((row) => row.id === id);
  };
  const selectedAnnRow = data.annActions.map((action) => selectedAnn(action.type)).find(Boolean);
  const quantityRow = mode === 'ann' ? selectedAnnRow : selectedTrade;
  const min = quantityRow?.minQuantity ?? 1;
  const max = quantityRow?.maxQuantity ?? Number.MAX_SAFE_INTEGER;
  const quantityValid = validQuantity(quantityText, quantityRow);
  const busy = town.status === 'submitting';
  const displayedResult = data.result ?? (actionResult?.key === featureKey ? actionResult.value : null);

  const finish = (result: TownActionResultResponse) => {
    if (staged.current) setResponse(staged.current);
    setActionResult({ key: featureKey, value: result }); staged.current = null; setConfirm(null);
  };
  const submit = (mutation: Mutation) => {
    void town.submit(mutation).then(finish).catch((error: unknown) => {
      if (!(error instanceof TownMutationBusyError)) setConfirm(null);
    });
  };
  const footer = <View style={styles.section}>
    {(mode !== 'legacy' && mode !== 'ann') || quantityRow ? <QuantityInput value={quantityText} onChange={setQuantityText} valid={quantityValid} min={min} max={quantityRow?.maxQuantity ?? null} /> : null}
    {mode !== 'ann' ? <ActionButton label={mode === 'legacy' ? '선택 품목 Trade' : '교환'} disabled={!selectedTrade || !quantityValid || busy} onPress={() => { if (selectedTrade) setConfirm({ kind: 'trade', request: { candidateId: selectedTrade.id, categoryCandidateId: data.currentCategoryId, quantity }, itemLabel: selectedTrade.label }); }} /> : null}
    {data.gradeActions.length ? <View style={styles.section}><Text style={styles.sectionTitle}>등급 즉시 교환</Text>{data.warning ? <Text accessibilityRole="alert" style={styles.warning}>{data.warning}</Text> : null}{data.gradeActions.map((action) => <ActionButton key={action.id} label={action.label} disabled={busy} onPress={() => setConfirm({ kind: 'grade', id: action.id, label: action.label })} />)}</View> : null}
    {data.annActions.map((action) => {
      const selected = selectedAnn(action.type);
      const requiresTarget = action.rows.some((row) => row.selectable);
      const valid = !requiresTarget || Boolean(selected && validQuantity(quantityText, selected));
      return <ActionButton key={action.type} label={action.label} disabled={busy || !valid} onPress={() => setConfirm({ kind: 'ann', label: action.label, itemLabel: selected?.label ?? null, request: { action: action.type, candidateId: selected?.id ?? null, quantity: selected ? quantity : 1 } })} />;
    })}
    {data.history.length ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: historyOpen }} accessibilityLabel={`교환 기록 ${historyOpen ? '접기' : '펼치기'}`} onPress={() => setHistoryOpen((value) => !value)}><Text style={styles.history}>기록 {data.history.length.toLocaleString()}건 {historyOpen ? '접기' : '펼치기'}</Text></Pressable> : null}
    {displayedResult ? <TownActionResult result={displayedResult} onRefresh={() => { setResponse(null); setActionResult(null); void town.reload().catch(() => undefined); }} /> : null}
    {town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
  </View>;

  return <View style={styles.container}>
    <TownItemList rows={rows} selectionMode="grouped-single" selectedIds={selectedIds}
      selectionGroup={(row) => row.id.startsWith('ann:') ? row.id.split(':').slice(0, 2).join(':') : row.id.startsWith('trade:') ? 'trade' : 'display'}
      displayOnlyRow={(row) => row.id.startsWith('history:')}
      onSelectionChange={setSelectedIds}
      header={<View style={styles.section}><Text style={styles.title}>{title(mode)}</Text><Categories data={data} disabled={busy} onSelect={setCategoryId} />{data.ownedCurrencies.length ? <View accessibilityLabel="보유 교환 재화" style={styles.currencyBox}>{data.ownedCurrencies.map((item) => <Text key={item.label} style={styles.hint}>{item.label}: {item.quantity == null ? '수량 확인 불가' : item.quantity.toLocaleString()}</Text>)}</View> : null}</View>}
      footer={footer} emptyMessage="현재 표시할 교환 품목이 없습니다." />
    <TownConfirmSheet visible={confirm != null} title={`${confirmTitle(confirm)} 확인`} message={confirm?.kind === 'grade' ? (data.warning ?? 'HOF가 교환 대상을 자동 선택합니다.') : '실행 결과는 되돌릴 수 없습니다.'}
      confirmLabel={confirmTitle(confirm)} destructive submitting={busy}
      details={confirm?.kind === 'grade'
        ? [{ label: '교환', value: confirm.label }, { label: '대상', value: 'HOF 자동 선택', warning: true }]
        : confirm?.kind === 'trade'
          ? [{ label: '품목', value: confirm.itemLabel }, { label: '수량', value: `${confirm.request.quantity}개` }]
          : confirm?.kind === 'ann'
            ? [{ label: '품목', value: confirm.itemLabel ?? '대상 없음' }, ...(confirm.itemLabel ? [{ label: '수량', value: `${confirm.request.quantity}개` }] : [])]
            : []}
      onCancel={() => setConfirm(null)} onConfirm={() => {
        if (confirm?.kind === 'grade') submit({ kind: 'grade', request: { gradeActionId: confirm.id } });
        else if (confirm?.kind === 'ann') submit({ kind: 'ann', request: confirm.request });
        else if (confirm?.kind === 'trade') submit({ kind: 'trade', request: confirm.request });
      }} />
  </View>;
}

function toTownRow(id: string, row: ExchangeResponse['rows'][number], group: string): TownRowResponse { return { id, label: row.label, accessibilityLabel: `${row.label}${row.selectable ? ' 선택' : ' 선택 불가'}`, selectable: row.selectable, detail: [group, row.detail].filter(Boolean).join(' · '), imageUrl: null, price: row.cost, quantity: row.owned }; }
function Categories({ data, disabled, onSelect }: { data: ExchangeResponse; disabled: boolean; onSelect: (id: string) => void }) { return data.categories.length ? <View accessibilityRole="radiogroup" style={styles.chips}>{data.categories.map((category) => <Pressable key={category.id} accessibilityRole="radio" accessibilityLabel={`${category.label} 분류`} accessibilityState={{ checked: category.current, disabled }} disabled={disabled} onPress={() => { if (!category.current) onSelect(category.id); }} style={[styles.chip, category.current && styles.chipSelected, disabled && styles.disabled]}><Text style={styles.chipText}>{category.label}</Text></Pressable>)}</View> : null; }
function QuantityInput({ value, onChange, valid, min, max }: { value: string; onChange: (value: string) => void; valid: boolean; min: number; max: number | null }) { return <View style={styles.section}><Text style={styles.sectionTitle}>수량</Text><TextInput accessibilityLabel="교환 수량" keyboardType="number-pad" value={value} onChangeText={onChange} style={[styles.input, !valid && styles.invalid]} />{!valid ? <Text accessibilityRole="alert" style={styles.error}>{min}~{max?.toLocaleString() ?? '허용 범위'} 사이의 정수를 입력하세요.</Text> : null}</View>; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => Promise<unknown> }) { return <View style={styles.container}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.hint}>{loading ? '교환 시설 정보를 불러오는 중...' : error ?? '교환 시설 정보가 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void reload().catch(() => undefined)} /> : null}</View>; }
function title(mode: ExchangeMode) { return ({ emblem: '교환상점', event: '특별 교환상점', legacy: '유물 가게', ann: '앤의 가게' } as const)[mode]; }
function confirmTitle(confirm: Confirm) { return confirm?.kind === 'grade' ? confirm.label : confirm?.kind === 'ann' ? confirm.label : '교환'; }
function informational(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
function validQuantity(value: string, row: ExchangeResponse['rows'][number] | undefined) { const quantity = Number(value); return Boolean(row && /^\d+$/.test(value) && Number.isSafeInteger(quantity) && quantity >= row.minQuantity && quantity <= (row.maxQuantity ?? Number.MAX_SAFE_INTEGER)); }
function identifyApi(api: TownApi) { const key = api as object; const known = apiKeys.get(key); if (known != null) return known; const next = nextApiKey++; apiKeys.set(key, next); return next; }

const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, sectionTitle: { color: theme.colors.text, fontWeight: '900' }, hint: { color: theme.colors.textMuted, lineHeight: 20 }, warning: { color: theme.colors.accentAmber, lineHeight: 20 }, error: { color: theme.colors.danger, lineHeight: 20 }, currencyBox: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: theme.spacing.xs, padding: theme.spacing.md }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }, chip: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: theme.spacing.md }, chipSelected: { borderColor: theme.colors.accentGreen }, chipText: { color: theme.colors.text, fontWeight: '700' }, input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md }, invalid: { borderColor: theme.colors.danger }, button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 48, paddingHorizontal: theme.spacing.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 }, history: { color: theme.colors.accentBlue, fontWeight: '800', paddingVertical: theme.spacing.sm } });
