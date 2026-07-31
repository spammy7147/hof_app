import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type {
  ClarisCraftRequest, CreateCraftRequest, CraftingMode, CraftingResponse, RefineRequest,
  TownActionResultResponse, TownRowResponse, WorkbaseStartRequest,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { TownMutationBusyError, useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; mode: CraftingMode; resolveCaptcha?: () => Promise<void> };
type Mutation = { kind: 'complete' } | { kind: 'item'; request: WorkbaseStartRequest | ClarisCraftRequest | RefineRequest | CreateCraftRequest };
type LoadedCrafting = { key: string; value: CraftingResponse };

const apiKeys = new WeakMap<object, number>();
let nextApiKey = 1;

export function CraftingPanel({ api, mode, resolveCaptcha }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [additionalIds, setAdditionalIds] = useState<string[]>([]);
  const [quantityText, setQuantityText] = useState('1');
  const [refineCount, setRefineCount] = useState<number | null>(null);
  const [requestedCategoryId, setRequestedCategoryId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<'item' | 'complete' | null>(null);
  const [response, setResponse] = useState<CraftingResponse | null>(null);
  const [actionResult, setActionResult] = useState<{ key: string; value: TownActionResultResponse } | null>(null);
  const stagedResponse = useRef<CraftingResponse | null>(null);
  const apiKey = identifyApi(api);
  const basePath = `/api/town/crafting/${mode}` as const;
  const featureKey = `crafting-${apiKey}-${mode}-${requestedCategoryId ?? 'default'}`;
  const path = requestedCategoryId == null
    ? basePath
    : `${basePath}?categoryCandidateId=${encodeURIComponent(requestedCategoryId)}` as const;
  const load = useCallback(async (): Promise<LoadedCrafting> => ({ key: featureKey, value: await api.load<CraftingResponse>(path) }), [api, featureKey, path]);
  const submitAction = useCallback(async (mutation: Mutation) => {
    const next = mutation.kind === 'complete'
      ? await api.submit<Record<string, never>, CraftingResponse>('/api/town/crafting/workbase/complete', {})
      : await api.submit<typeof mutation.request, CraftingResponse>(basePath, mutation.request);
    if (activeFeatureKey.current === featureKey) stagedResponse.current = next;
    return next.result ?? information('제작 시설 정보를 갱신했습니다.');
  }, [api, basePath, featureKey]);
  const activeFeatureKey = useRef(featureKey);
  activeFeatureKey.current = featureKey;
  const town = useTownFeature<LoadedCrafting, Mutation>({ load, submitAction, resolveCaptcha, featureKey });
  const loadedData = town.data?.key === featureKey ? town.data.value : null;
  const scopeKey = `${apiKey}-${mode}`;
  const lastData = useRef<{ scope: string; value: CraftingResponse } | null>(null);
  if (loadedData) lastData.current = { scope: scopeKey, value: loadedData };
  const data = response ?? loadedData ?? (lastData.current?.scope === scopeKey ? lastData.current.value : null);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    stagedResponse.current = null;
    setResponse(null); setActionResult(null); setSelectedIds([]); setAdditionalIds([]); setQuantityText('1'); setRefineCount(null); setRequestedCategoryId(null); setHistoryOpen(false); setConfirmation(null);
  }, [apiKey, mode]);
  useEffect(() => {
    stagedResponse.current = null;
    setResponse(null); setActionResult(null); setSelectedIds([]); setAdditionalIds([]); setConfirmation(null);
  }, [requestedCategoryId]);
  useEffect(() => {
    if (!data) return;
    const live = new Set(data.rows.filter((row) => row.selectable).map((row) => row.id));
    const addLive = new Set(data.additionalMaterials.filter((row) => row.selectable).map((row) => row.id));
    setSelectedIds((current) => current.filter((id) => live.has(id)).slice(0, 1));
    setAdditionalIds((current) => current.filter((id) => addLive.has(id)).slice(0, 1));
    setRefineCount((current) => current != null && data.allowedRefineCounts.includes(current) ? current : data.allowedRefineCounts[0] ?? null);
    setRemaining(data.activeJob?.remainingSeconds ?? null);
  }, [data]);
  useEffect(() => {
    if (mode !== 'workbase' || remaining == null || remaining <= 0) return;
    const timer = setInterval(() => setRemaining((current) => current == null ? null : Math.max(0, current - 1)), 1_000);
    return () => clearInterval(timer);
  }, [mode, remaining == null || remaining <= 0]);

  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} />;
  const rows = data.rows.map((item) => toRow(item, 'recipe'));
  const addRows = mode === 'create' ? data.additionalMaterials.map((item): TownRowResponse => ({ id: `additional:${item.id}`, accessibilityLabel: `${item.label}${item.selectable ? ' 추가 소재 선택' : ' 추가 소재 선택 불가'}`, label: item.label, selectable: item.selectable, detail: ['추가 소재', item.detail].filter(Boolean).join(' · '), imageUrl: null, price: null, quantity: item.owned })) : [];
  const historyRows = historyOpen ? data.history.map((line, index): TownRowResponse => ({ id: `history:${index}`, accessibilityLabel: line, label: line, selectable: false, detail: null, imageUrl: null, price: null, quantity: null })) : [];
  const listRows = [...rows, ...addRows, ...historyRows];
  const selected = data.rows.find((row) => row.id === selectedIds[0]);
  const material = data.additionalMaterials.find((row) => row.id === additionalIds[0]);
  const categoryId = data.currentCategoryId;
  const quantity = Number(quantityText);
  const needsQuantity = mode === 'workbase' || mode === 'claris' || mode === 'create';
  const quantityValid = !needsQuantity || /^\d+$/.test(quantityText) && Number.isSafeInteger(quantity) && quantity >= data.minQuantity && quantity <= data.maxQuantity;
  const canSubmit = Boolean(selected && categoryId && quantityValid && town.status !== 'loading' && (mode !== 'refine' && mode !== 'veteran' || refineCount != null));
  const title = titleFor(mode);
  const request = buildRequest(mode, selected?.id, categoryId, quantity, refineCount, material?.id);
  const displayedResult = data.result ?? (actionResult?.key === featureKey ? actionResult.value : null);

  const finish = (result: TownActionResultResponse) => {
    if (stagedResponse.current) setResponse(stagedResponse.current);
    setActionResult({ key: featureKey, value: result });
    stagedResponse.current = null;
    setConfirmation(null);
  };
  const submit = (mutation: Mutation) => {
    void town.submit(mutation).then(finish).catch((error: unknown) => {
      if (!(error instanceof TownMutationBusyError)) setConfirmation(null);
    });
  };
  const footer = <View style={styles.section}>
    {needsQuantity ? <QuantityInput value={quantityText} onChange={setQuantityText} min={data.minQuantity} max={data.maxQuantity} valid={quantityValid} /> : null}
    {mode === 'refine' || mode === 'veteran' ? <View style={styles.section}><Text style={styles.label}>제련 횟수</Text><View style={styles.chips}>{data.allowedRefineCounts.map((count) => <Pressable key={count} accessibilityLabel={`제련 ${count}회 선택`} accessibilityRole="radio" accessibilityState={{ checked: refineCount === count }} onPress={() => setRefineCount(count)} style={[styles.chip, refineCount === count && styles.chipSelected]}><Text style={styles.chipText}>{count}회</Text></Pressable>)}</View></View> : null}
    {mode === 'create' ? <Text style={styles.hint}>{addRows.length ? '추가 소재는 품목 목록 아래에서 선택할 수 있습니다.' : '보유 추가 소재가 없습니다.'}</Text> : null}
    <ActionButton label={mode === 'refine' || mode === 'veteran' ? '제련' : mode === 'workbase' ? '작업 시작' : mode === 'claris' ? '교환' : '제작'} disabled={!canSubmit || town.status === 'submitting'} onPress={() => setConfirmation('item')} />
    {data.warningCode === 'NO_ADDITIONAL_MATERIAL' ? <Text accessibilityRole="alert" style={styles.warning}>추가 소재 없이 제작했습니다.</Text> : null}
    {data.history.length ? <History count={data.history.length} open={historyOpen} onToggle={() => setHistoryOpen((value) => !value)} /> : null}
    {displayedResult ? <TownActionResult result={displayedResult} onRefresh={() => { setResponse(null); setActionResult(null); void town.reload().catch(() => undefined); }} /> : null}
    {town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
  </View>;

  return <View style={styles.container}>
    <TownItemList rows={listRows} selectionMode="grouped-single" selectedIds={[...selectedIds.map((id) => `recipe:${id}`), ...additionalIds.map((id) => `additional:${id}`)]}
      selectionGroup={(row) => row.id.startsWith('additional:') ? 'additional' : row.id.startsWith('recipe:') ? 'recipe' : 'display'}
      displayOnlyRow={(row) => row.id.startsWith('history:')}
      onSelectionChange={(ids) => {
        setSelectedIds(ids.filter((id) => id.startsWith('recipe:')).map((id) => id.slice('recipe:'.length)).slice(0, 1));
        setAdditionalIds(ids.filter((id) => id.startsWith('additional:')).map((id) => id.slice('additional:'.length)).slice(0, 1));
      }}
      header={<View style={styles.section}><Text style={styles.title}>{title}</Text><CategoryList data={data} disabled={town.status === 'submitting'} onSelect={setRequestedCategoryId} />{town.status === 'loading' ? <Text accessibilityLiveRegion="polite" style={styles.hint}>선택한 분류를 불러오는 중...</Text> : null}{data.activeJob ? <View accessibilityLiveRegion="polite" style={styles.job}><Text style={styles.label}>{data.activeJob.label}</Text><Text style={styles.warning}>{remaining == null ? '남은 시간 확인 불가' : remaining > 0 ? `${remaining.toLocaleString()}초 후 확인 가능` : '제작 결과를 확인할 수 있습니다.'}</Text>{data.activeJob.completionAvailable ? <ActionButton label="제작 완료" disabled={town.status === 'submitting'} onPress={() => setConfirmation('complete')} /> : remaining === 0 ? <ActionButton label="제작 상태 확인" disabled={town.status === 'loading' || town.status === 'submitting'} onPress={() => { setResponse(null); void town.reload().catch(() => undefined); }} /> : null}</View> : null}</View>}
      footer={footer} emptyMessage="현재 분류에 표시할 품목이 없습니다." />
    <TownConfirmSheet visible={confirmation === 'item'} title={`${title} 확인`}
      message={mode === 'create' && !material ? '추가 소재 없이 제작합니다. 계속할까요?' : '실행 결과는 되돌릴 수 없습니다.'}
      confirmLabel={mode === 'refine' || mode === 'veteran' ? '제련' : mode === 'workbase' ? '작업 시작' : mode === 'claris' ? '교환' : '제작'} destructive submitting={town.status === 'submitting'}
      details={[{ label: '품목', value: selected?.label ?? '미선택' }, ...(needsQuantity ? [{ label: '수량', value: `${quantity || 0}개` }] : []), ...(refineCount != null ? [{ label: '제련 횟수', value: `${refineCount}회` }] : []), ...(mode === 'create' ? [{ label: '추가 소재', value: material?.label ?? '사용 안 함', warning: !material }] : []), { label: '표시 비용', value: selected?.cost == null ? '확인 불가' : `$${selected.cost.toLocaleString()}` }]}
      onCancel={() => setConfirmation(null)} onConfirm={() => request && submit({ kind: 'item', request })} />
    <TownConfirmSheet visible={confirmation === 'complete'} title="작업장 제작 결과 확인" message="자동 확인하지 않고 지금 HOF 제작 완료 action을 한 번 실행합니다." confirmLabel="제작 완료" submitting={town.status === 'submitting'} details={[]} onCancel={() => setConfirmation(null)} onConfirm={() => submit({ kind: 'complete' })} />
  </View>;
}

function buildRequest(mode: CraftingMode, candidateId: string | undefined, categoryCandidateId: string | null, quantity: number, refineCount: number | null, materialId?: string) {
  if (!candidateId || !categoryCandidateId) return null;
  if (mode === 'refine' || mode === 'veteran') return refineCount == null ? null : { candidateId, categoryCandidateId, refineCount } satisfies RefineRequest;
  if (mode === 'create') return { recipeCandidateId: candidateId, categoryCandidateId, quantity, additionalMaterialCandidateId: materialId ?? null } satisfies CreateCraftRequest;
  return { candidateId, categoryCandidateId, quantity } satisfies WorkbaseStartRequest;
}
function toRow(item: CraftingResponse['rows'][number], group: 'recipe'): TownRowResponse { return { id: `${group}:${item.id}`, accessibilityLabel: `${item.label}${item.selectable ? ' 선택' : ' 선택 불가'}`, label: item.label, selectable: item.selectable, detail: [item.detail, item.workSeconds != null ? `개당 제작 시간 ${item.workSeconds.toLocaleString()}초` : null].filter(Boolean).join(' · ') || null, imageUrl: null, price: item.cost, quantity: item.owned }; }
function CategoryList({ data, disabled, onSelect }: { data: CraftingResponse; disabled: boolean; onSelect: (id: string) => void }) { return <View accessibilityRole="radiogroup" style={styles.chips}>{data.categories.map((category) => <Pressable key={category.id} accessibilityLabel={`${category.label} 분류`} accessibilityRole="radio" accessibilityState={{ checked: category.current, disabled }} disabled={disabled} onPress={() => { if (!category.current) onSelect(category.id); }} style={[styles.chip, category.current && styles.chipSelected, disabled && styles.disabled]}><Text style={styles.chipText}>{category.label}</Text></Pressable>)}</View>; }
function QuantityInput({ value, onChange, min, max, valid }: { value: string; onChange: (value: string) => void; min: number; max: number; valid: boolean }) { return <View style={styles.section}><Text style={styles.label}>수량</Text><TextInput accessibilityLabel="제작 수량" keyboardType="number-pad" value={value} onChangeText={onChange} style={[styles.input, !valid && styles.invalid]} />{!valid ? <Text accessibilityRole="alert" style={styles.error}>{min}~{max.toLocaleString()} 사이의 정수를 입력하세요.</Text> : null}</View>; }
function History({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) { return <Pressable accessibilityLabel={`Hall of Pain 기록 ${open ? '접기' : '펼치기'}`} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle}><Text style={styles.history}>Hall of Pain {count.toLocaleString()}건 {open ? '접기' : '펼치기'}</Text></Pressable>; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => Promise<unknown> }) { return <View style={styles.container}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.hint}>{loading ? '제작 시설 정보를 불러오는 중...' : error ?? '제작 시설 정보가 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void reload().catch(() => undefined)} /> : null}</View>; }
function titleFor(mode: CraftingMode) { return ({ workbase: '작업장-재봉틀', claris: '클라리스의 재봉실', refine: '제련공방', create: '제작공방', veteran: '장로대장간' } as const)[mode]; }
function information(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
function identifyApi(api: TownApi): number { const object = api as object; const known = apiKeys.get(object); if (known != null) return known; const next = nextApiKey++; apiKeys.set(object, next); return next; }

const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, label: { color: theme.colors.text, fontWeight: '900' }, hint: { color: theme.colors.textMuted, lineHeight: 20 }, warning: { color: theme.colors.accentAmber, lineHeight: 20 }, error: { color: theme.colors.danger, lineHeight: 20 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }, chip: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: theme.spacing.md }, chipSelected: { borderColor: theme.colors.accentGreen }, chipText: { color: theme.colors.text, fontWeight: '700' }, job: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: theme.spacing.sm, padding: theme.spacing.md }, input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md }, invalid: { borderColor: theme.colors.danger }, button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 48, paddingHorizontal: theme.spacing.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 }, history: { color: theme.colors.accentBlue, fontWeight: '800', paddingVertical: theme.spacing.sm } });
