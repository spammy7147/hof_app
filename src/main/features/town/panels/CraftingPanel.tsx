import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type {
  ClarisCraftRequest, CreateCraftRequest, CraftingMode, CraftingResponse, RefineRequest,
  TownActionResultResponse, TownRowResponse, WorkbaseStartRequest,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; mode: CraftingMode; resolveCaptcha?: () => Promise<void> };
type Mutation = { kind: 'complete' } | { kind: 'item'; request: WorkbaseStartRequest | ClarisCraftRequest | RefineRequest | CreateCraftRequest };
type LoadedCrafting = { key: string; value: CraftingResponse };

const apiKeys = new WeakMap<object, number>();
let nextApiKey = 1;

export function CraftingPanel({ api, mode, resolveCaptcha }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [additionalIds, setAdditionalIds] = useState<string[]>([]);
  const [quantityText, setQuantityText] = useState('1');
  const [searchQuery, setSearchQuery] = useState('');
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [refineCount, setRefineCount] = useState<number | null>(null);
  const [requestedCategoryId, setRequestedCategoryId] = useState<string | null>(null);
  const [historyScreenOpen, setHistoryScreenOpen] = useState(false);
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
    setResponse(null); setActionResult(null); setSelectedIds([]); setAdditionalIds([]); setQuantityText('1'); setSearchQuery(''); setMaterialPickerOpen(false); setRefineCount(null); setRequestedCategoryId(null); setHistoryScreenOpen(false);
  }, [apiKey, mode]);
  useEffect(() => {
    stagedResponse.current = null;
    setResponse(null); setActionResult(null); setSelectedIds([]); setAdditionalIds([]); setMaterialPickerOpen(false);
  }, [requestedCategoryId]);
  useEffect(() => {
    if (!data) return;
    const live = new Set(data.rows.filter((row) => row.selectable).map((row) => row.id));
    const addLive = new Set(data.additionalMaterials.filter((row) => row.selectable).map((row) => row.id));
    setSelectedIds((current) => current.filter((id) => live.has(id)).slice(0, 1));
    setAdditionalIds((current) => current.filter((id) => addLive.has(id)).slice(0, 1));
    setRefineCount((current) => mode === 'veteran'
      ? data.allowedRefineCounts.includes(1) ? 1 : null
      : current != null && data.allowedRefineCounts.includes(current) ? current : data.allowedRefineCounts[0] ?? null);
    setRemaining(data.activeJob?.remainingSeconds ?? null);
  }, [data, mode]);
  useEffect(() => {
    if (mode !== 'workbase' || remaining == null || remaining <= 0) return;
    const timer = setInterval(() => setRemaining((current) => current == null ? null : Math.max(0, current - 1)), 1_000);
    return () => clearInterval(timer);
  }, [mode, remaining == null || remaining <= 0]);
  useEffect(() => {
    if (!historyScreenOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setHistoryScreenOpen(false); return true; });
    return () => subscription.remove();
  }, [historyScreenOpen]);

  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} />;
  const normalizedQuery = cleanDisplayText(searchQuery).toLocaleLowerCase();
  const visibleItems = town.status === 'loading' ? [] : normalizedQuery
    ? data.rows.filter((item) => `${item.label} ${item.detail ?? ''}`.toLocaleLowerCase().includes(normalizedQuery))
    : data.rows;
  const rows = visibleItems.map((item) => toRow(item, 'recipe'));
  const historyRows = data.history.map((line, index): TownRowResponse => ({ id: `history:${index}`, accessibilityLabel: line, label: line, selectable: false, detail: null, imageUrl: null, price: null, quantity: null }));
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
  };
  const submit = (mutation: Mutation) => {
    void town.submit(mutation).then(finish).catch(() => undefined);
  };
  const resultFooter = <View style={styles.section}>
    {data.warningCode === 'NO_ADDITIONAL_MATERIAL' ? <Text accessibilityRole="alert" style={styles.warning}>추가 소재 없이 제작했습니다.</Text> : null}
    {data.history.length ? <History count={data.history.length} onOpen={() => setHistoryScreenOpen(true)} /> : null}
    {displayedResult ? <TownActionResult result={displayedResult} onRefresh={() => { setResponse(null); setActionResult(null); void town.reload().catch(() => undefined); }} /> : null}
    {town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
  </View>;
  const footer = <View style={styles.section}>
    {needsQuantity ? <QuantityInput value={quantityText} onChange={setQuantityText} min={data.minQuantity} max={data.maxQuantity} valid={quantityValid} /> : null}
    <ActionButton label={mode === 'workbase' ? '작업 시작' : mode === 'claris' ? '교환' : '제작'} disabled={!canSubmit || town.status === 'submitting'} onPress={() => request && submit({ kind: 'item', request })} />
    {resultFooter}
  </View>;
  const createControls = mode === 'create' ? <View accessibilityLabel="제작 설정 고정 영역" style={styles.fixedControls}>
    <MaterialDropdown
      materials={data.additionalMaterials}
      open={materialPickerOpen}
      selectedId={additionalIds[0] ?? null}
      onOpen={() => setMaterialPickerOpen(true)}
      onClose={() => setMaterialPickerOpen(false)}
      onSelect={(id) => { setAdditionalIds(id == null ? [] : [id]); setMaterialPickerOpen(false); }}
    />
    <ActionButton label="제작" disabled={!canSubmit || town.status === 'submitting'} onPress={() => request && submit({ kind: 'item', request })} />
  </View> : null;
  const refineControls = mode === 'refine' || mode === 'veteran' ? <View accessibilityLabel="제련 설정 고정 영역" style={styles.fixedControls}>
    {mode === 'refine'
      ? <RefineCountDropdown counts={data.allowedRefineCounts} disabled={town.status === 'submitting'} selected={refineCount} onSelect={setRefineCount} />
      : <View style={styles.fixedValue}><Text style={styles.label}>제련 횟수</Text><Text style={styles.fixedValueText}>1회 고정</Text></View>}
    <ActionButton label="제련" disabled={!canSubmit || town.status === 'submitting'} onPress={() => request && submit({ kind: 'item', request })} />
  </View> : null;

  if (historyScreenOpen) return <CraftingHistoryScreen rows={historyRows} onBack={() => setHistoryScreenOpen(false)} />;

  if (mode === 'workbase' && data.activeJob) {
    return <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.activeJobScreen}>
        <Text style={styles.title}>{title}</Text>
        <View accessibilityLabel="현재 작업장 작업" accessibilityLiveRegion="polite" style={styles.job}>
          <Text style={styles.jobTitle}>진행 중인 작업</Text>
          <Text style={styles.label}>{data.activeJob.label}</Text>
          <Text style={styles.warning}>{remaining == null ? '남은 시간 확인 불가' : remaining > 0 ? `${remaining.toLocaleString()}초 후 확인 가능` : '제작 결과를 확인할 수 있습니다.'}</Text>
          {data.activeJob.completionAvailable
            ? <ActionButton label="제작 완료" disabled={town.status === 'submitting'} onPress={() => submit({ kind: 'complete' })} />
            : remaining === 0
              ? <ActionButton label="제작 상태 확인" disabled={town.status === 'loading' || town.status === 'submitting'} onPress={() => { setResponse(null); void town.reload().catch(() => undefined); }} />
              : null}
        </View>
        <Text style={styles.hint}>현재 작업이 끝난 뒤 새 작업을 선택할 수 있습니다.</Text>
        {resultFooter}
      </ScrollView>
    </View>;
  }

  return <View style={styles.container}>
    <View style={styles.listArea}><TownItemList rows={rows} selectionMode="single" selectedIds={selectedIds.map((id) => `recipe:${id}`)}
      showSelectionAvailability={mode === 'claris'}
      labelTextStyle={(row) => row.id.startsWith('recipe:') ? styles.itemHeadline : undefined}
      renderSelectedFooter={(row) => mode === 'create' && row.id.startsWith('recipe:')
        ? <QuantityInput value={quantityText} onChange={setQuantityText} min={data.minQuantity} max={data.maxQuantity} valid={quantityValid} compact />
        : null}
      onSelectionChange={(ids) => {
        setSelectedIds(ids.filter((id) => id.startsWith('recipe:')).map((id) => id.slice('recipe:'.length)).slice(0, 1));
      }}
      header={<View style={styles.section}><Text style={styles.title}>{title}</Text><CategoryDropdown data={data} disabled={town.status === 'submitting'} onSelect={setRequestedCategoryId} />{mode === 'create' || mode === 'refine' || mode === 'veteran' ? <CraftingSearch value={searchQuery} onChange={setSearchQuery} resultCount={visibleItems.length} subject={mode === 'create' ? '제작물품' : '제련 아이템'} /> : null}{town.status === 'loading' ? <Text accessibilityLiveRegion="polite" style={styles.hint}>선택한 종류의 제작품을 불러오는 중...</Text> : null}{data.activeJob ? <View accessibilityLiveRegion="polite" style={styles.job}><Text style={styles.label}>{data.activeJob.label}</Text><Text style={styles.warning}>{remaining == null ? '남은 시간 확인 불가' : remaining > 0 ? `${remaining.toLocaleString()}초 후 확인 가능` : '제작 결과를 확인할 수 있습니다.'}</Text>{data.activeJob.completionAvailable ? <ActionButton label="제작 완료" disabled={town.status === 'submitting'} onPress={() => submit({ kind: 'complete' })} /> : remaining === 0 ? <ActionButton label="제작 상태 확인" disabled={town.status === 'loading' || town.status === 'submitting'} onPress={() => { setResponse(null); void town.reload().catch(() => undefined); }} /> : null}</View> : null}</View>}
      footer={mode === 'create' || mode === 'refine' || mode === 'veteran' ? resultFooter : footer} emptyMessage={town.status === 'loading' ? null : normalizedQuery ? '검색 결과가 없습니다.' : '현재 분류에 표시할 품목이 없습니다.'} /></View>
    {createControls}
    {refineControls}
  </View>;
}

function buildRequest(mode: CraftingMode, candidateId: string | undefined, categoryCandidateId: string | null, quantity: number, refineCount: number | null, materialId?: string) {
  if (!candidateId || !categoryCandidateId) return null;
  if (mode === 'refine' || mode === 'veteran') return refineCount == null ? null : { candidateId, categoryCandidateId, refineCount } satisfies RefineRequest;
  if (mode === 'create') return { recipeCandidateId: candidateId, categoryCandidateId, quantity, additionalMaterialCandidateId: materialId ?? null } satisfies CreateCraftRequest;
  return { candidateId, categoryCandidateId, quantity } satisfies WorkbaseStartRequest;
}
function toRow(item: CraftingResponse['rows'][number], group: 'recipe'): TownRowResponse {
  const presentation = presentCraftingItem(item.label, item.detail, item.owned);
  return {
    id: `${group}:${item.id}`,
    accessibilityLabel: `${item.label}${item.selectable ? ' 선택' : ' 선택 불가'}`,
    label: presentation.label,
    selectable: item.selectable,
    detail: [presentation.detail, item.workSeconds != null ? `개당 제작 시간 ${item.workSeconds.toLocaleString()}초` : null].filter(Boolean).join(' · ') || null,
    imageUrl: null,
    price: item.cost,
    quantity: null,
  };
}

function presentCraftingItem(label: string, detail: string | null, owned: number | null): { label: string; detail: string | null } {
  const normalizedLabel = cleanDisplayText(label);
  const [headline, ...optionParts] = normalizedLabel.split(/\s*\/\s*/);
  // 제작 재료 끝의 `x4`를 제작품 보유 수량으로 오인하지 않도록 수량은 첫 `/` 앞에서만 해석한다.
  const quantityMatch = headline.match(/^(.*?)\s+([x×]\s*[\d,]+)$/i);
  const titleWithType = quantityMatch?.[1]?.trim() || headline;
  const quantity = quantityMatch?.[2]?.replace(/\s+/g, '') ?? (owned == null ? null : `x${owned.toLocaleString()}`);
  const typeMatch = titleWithType.match(/^(.*?)\s+(\([^()]+\))$/);
  const itemName = typeMatch?.[1]?.trim() || titleWithType;
  const type = typeMatch?.[2]?.trim() ?? null;
  const labelRemainder = optionParts.map((part) => part.trim()).filter(Boolean).join(' · ') || null;
  const normalizedDetail = cleanDisplayText(detail ?? '').replace(/^[$￦]\s*[\d,]+\s*/, '').trim();
  const distinctDetail = normalizedDetail && normalizedDetail !== normalizedLabel ? normalizedDetail : null;
  return {
    label: [itemName, quantity].filter(Boolean).join(' '),
    detail: [type, labelRemainder, distinctDetail].filter(Boolean).join(' · ') || null,
  };
}

function cleanDisplayText(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function CategoryDropdown({ data, disabled, onSelect }: { data: CraftingResponse; disabled: boolean; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = data.categories.find((category) => category.id === data.currentCategoryId)
    ?? data.categories.find((category) => category.current)
    ?? null;
  const close = () => setOpen(false);
  return <View style={styles.materialField}>
    <Text style={styles.label}>종류</Text>
    <Pressable accessibilityLabel="제작 종류 선택" accessibilityRole="button" accessibilityState={{ disabled, expanded: open }} disabled={disabled} onPress={() => setOpen(true)} style={({ pressed }) => [styles.dropdown, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text numberOfLines={1} style={[styles.dropdownText, !selected && styles.dropdownPlaceholder]}>{selected?.label ?? '종류를 선택하세요'}</Text>
      <Text style={styles.chevron}>⌄</Text>
    </Pressable>
    <Modal animationType="fade" onRequestClose={close} transparent visible={open}>
      <View accessibilityViewIsModal style={styles.modalRoot}>
        <Pressable accessibilityLabel="제작 종류 선택 닫기" accessibilityRole="button" onPress={close} style={styles.modalBackdrop} />
        <View style={styles.dropdownSheet}>
          <View style={styles.dropdownHeader}>
            <Text style={styles.dropdownTitle}>제작 종류 선택</Text>
            <Pressable accessibilityLabel="제작 종류 선택 닫기" accessibilityRole="button" onPress={close} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable>
          </View>
          <ScrollView accessibilityRole="radiogroup" keyboardShouldPersistTaps="handled" style={styles.materialOptions}>
            {data.categories.map((category) => <CategoryOption key={category.id} checked={category.id === selected?.id} label={category.label} onPress={() => { close(); if (category.id !== selected?.id) onSelect(category.id); }} />)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}
function CategoryOption({ checked, label, accessibilityLabel = `${label} 분류`, onPress }: { checked: boolean; label: string; accessibilityLabel?: string; onPress: () => void }) {
  return <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="radio" accessibilityState={{ checked }} onPress={onPress} style={[styles.materialOption, checked && styles.materialOptionSelected]}>
    <View style={[styles.radio, checked && styles.radioSelected]}>{checked ? <View style={styles.radioDot} /> : null}</View>
    <Text style={styles.optionLabel}>{label}</Text>
  </Pressable>;
}
function CraftingSearch({ value, onChange, resultCount, subject }: { value: string; onChange: (value: string) => void; resultCount: number; subject: string }) {
  return <View>
    <View style={styles.searchField}>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.searchIcon}>⌕</Text>
      <TextInput accessibilityLabel={`${subject} 검색`} autoCapitalize="none" autoCorrect={false} onChangeText={onChange} placeholder={`${subject} 검색`} placeholderTextColor={theme.colors.textMuted} returnKeyType="search" style={styles.searchInput} value={value} />
      {value ? <Pressable accessibilityLabel={`${subject} 검색어 지우기`} accessibilityRole="button" onPress={() => onChange('')} style={styles.clearButton}><Text style={styles.clearText}>×</Text></Pressable> : null}
    </View>
    {value ? <Text accessibilityLiveRegion="polite" style={styles.searchResult}>{resultCount.toLocaleString()}개 검색됨</Text> : null}
  </View>;
}
function RefineCountDropdown({ counts, disabled, selected, onSelect }: { counts: number[]; disabled: boolean; selected: number | null; onSelect: (count: number) => void }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <View style={styles.materialField}>
    <Text style={styles.label}>제련 횟수</Text>
    <Pressable accessibilityLabel="제련 횟수 선택" accessibilityRole="button" accessibilityState={{ disabled, expanded: open }} disabled={disabled || counts.length === 0} onPress={() => setOpen(true)} style={({ pressed }) => [styles.dropdown, (disabled || counts.length === 0) && styles.disabled, pressed && styles.pressed]}>
      <Text numberOfLines={1} style={[styles.dropdownText, selected == null && styles.dropdownPlaceholder]}>{selected == null ? '횟수를 선택하세요' : `${selected.toLocaleString()}회`}</Text>
      <Text style={styles.chevron}>⌄</Text>
    </Pressable>
    <Modal animationType="fade" onRequestClose={close} transparent visible={open}>
      <View accessibilityViewIsModal style={styles.modalRoot}>
        <Pressable accessibilityLabel="제련 횟수 선택 닫기" accessibilityRole="button" onPress={close} style={styles.modalBackdrop} />
        <View style={styles.dropdownSheet}>
          <View style={styles.dropdownHeader}>
            <Text style={styles.dropdownTitle}>제련 횟수 선택</Text>
            <Pressable accessibilityLabel="제련 횟수 선택 닫기" accessibilityRole="button" onPress={close} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable>
          </View>
          <ScrollView accessibilityRole="radiogroup" keyboardShouldPersistTaps="handled" style={styles.materialOptions}>
            {counts.map((count) => <CategoryOption key={count} checked={count === selected} label={`${count.toLocaleString()}회`} accessibilityLabel={`제련 ${count.toLocaleString()}회`} onPress={() => { onSelect(count); close(); }} />)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}
function MaterialDropdown({ materials, open, selectedId, onOpen, onClose, onSelect }: {
  materials: CraftingResponse['additionalMaterials'];
  open: boolean;
  selectedId: string | null;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (id: string | null) => void;
}) {
  const selected = materials.find((item) => item.id === selectedId);
  return <View style={styles.materialField}>
    <Text style={styles.label}>추가 소재</Text>
    <Pressable accessibilityLabel="추가 소재 선택" accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onOpen} style={({ pressed }) => [styles.dropdown, pressed && styles.pressed]}>
      <View style={styles.dropdownContent}>
        <Text numberOfLines={1} style={[styles.dropdownText, !selected && styles.dropdownPlaceholder]}>{selected?.label ?? '사용 안 함'}</Text>
        {selected?.owned != null ? <Text style={styles.materialOwned}>보유 {selected.owned.toLocaleString()}</Text> : null}
      </View>
      <Text style={styles.chevron}>⌄</Text>
    </Pressable>
    {!materials.some((item) => item.selectable) ? <Text style={styles.hint}>선택 가능한 추가 소재가 없습니다.</Text> : null}
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
      <View accessibilityViewIsModal style={styles.modalRoot}>
        <Pressable accessibilityLabel="추가 소재 선택 닫기" accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop} />
        <View style={styles.dropdownSheet}>
          <View style={styles.dropdownHeader}>
            <Text style={styles.dropdownTitle}>추가 소재 선택</Text>
            <Pressable accessibilityLabel="추가 소재 선택 닫기" accessibilityRole="button" onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.materialOptions}>
            <MaterialOption checked={selectedId == null} label="사용 안 함" detail="추가 소재 없이 제작" onPress={() => onSelect(null)} />
            {materials.map((item) => <MaterialOption key={item.id} checked={selectedId === item.id} disabled={!item.selectable} label={item.label} detail={[item.detail, item.owned != null ? `보유 ${item.owned.toLocaleString()}` : null].filter(Boolean).join(' · ')} onPress={() => onSelect(item.id)} />)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}
function MaterialOption({ checked, disabled = false, label, detail, onPress }: { checked: boolean; disabled?: boolean; label: string; detail: string; onPress: () => void }) {
  return <Pressable accessibilityLabel={`${label} 추가 소재 선택`} accessibilityRole="radio" accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={[styles.materialOption, checked && styles.materialOptionSelected, disabled && styles.disabled]}>
    <View style={[styles.radio, checked && styles.radioSelected]}>{checked ? <View style={styles.radioDot} /> : null}</View>
    <View style={styles.materialOptionText}><Text style={styles.optionLabel}>{label}</Text>{detail ? <Text style={styles.optionDetail}>{detail}</Text> : null}</View>
  </Pressable>;
}
function QuantityInput({ value, onChange, min, max, valid, compact = false }: { value: string; onChange: (value: string) => void; min: number; max: number; valid: boolean; compact?: boolean }) { return <View style={compact ? styles.compactSection : styles.section}><Text style={styles.label}>수량</Text><TextInput accessibilityLabel="제작 수량" keyboardType="number-pad" value={value} onChangeText={onChange} style={[styles.input, !valid && styles.invalid]} />{!valid ? <Text accessibilityRole="alert" style={styles.error}>{min}~{max.toLocaleString()} 사이의 정수를 입력하세요.</Text> : null}</View>; }
function CraftingHistoryScreen({ rows, onBack }: { rows: TownRowResponse[]; onBack: () => void }) { return <View style={styles.container}><TownItemList rows={rows} selectionMode="none" header={<View style={styles.historyHeader}><Text accessibilityRole="header" style={styles.title}>Hall of Pain 기록</Text><Text style={styles.hint}>최근 제련 결과 {rows.length.toLocaleString()}건을 확인합니다.</Text><ActionButton label="제작 화면으로 돌아가기" disabled={false} onPress={onBack} /></View>} emptyMessage="저장된 Hall of Pain 기록이 없습니다." /></View>; }
function History({ count, onOpen }: { count: number; onOpen: () => void }) { return <Pressable accessibilityLabel="Hall of Pain 기록 보기" accessibilityRole="button" onPress={onOpen}><Text style={styles.history}>Hall of Pain {count.toLocaleString()}건 보기</Text></Pressable>; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => Promise<unknown> }) { return <View style={styles.container}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.hint}>{loading ? '제작 시설 정보를 불러오는 중...' : error ?? '제작 시설 정보가 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void reload().catch(() => undefined)} /> : null}</View>; }
function titleFor(mode: CraftingMode) { return ({ workbase: '작업장-재봉틀', claris: '클라리스의 재봉실', refine: '제련공방', create: '제작공방', veteran: '장로대장간' } as const)[mode]; }
function information(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
function identifyApi(api: TownApi): number { const object = api as object; const known = apiKeys.get(object); if (known != null) return known; const next = nextApiKey++; apiKeys.set(object, next); return next; }

const styles = StyleSheet.create({
  container: { flex: 1, gap: theme.spacing.sm },
  listArea: { flex: 1, minHeight: 0 },
  section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  compactSection: { gap: theme.spacing.xs },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  itemHeadline: { color: theme.colors.text, fontSize: 17, fontWeight: '900' },
  label: { color: theme.colors.text, fontWeight: '900' },
  hint: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  warning: { color: theme.colors.accentAmber, lineHeight: 20 },
  error: { color: theme.colors.danger, lineHeight: 20 },
  fixedValue: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: theme.spacing.md },
  fixedValueText: { color: theme.colors.accentGreen, fontWeight: '900' },
  job: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: theme.spacing.sm, padding: theme.spacing.md },
  jobTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  activeJobScreen: { gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
  input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md },
  invalid: { borderColor: theme.colors.danger },
  button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 48, paddingHorizontal: theme.spacing.md },
  buttonText: { color: theme.colors.background, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  history: { color: theme.colors.accentBlue, fontWeight: '800', paddingVertical: theme.spacing.sm },
  historyHeader: { gap: theme.spacing.sm, paddingBottom: theme.spacing.md },
  fixedControls: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  searchField: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', minHeight: 46, paddingHorizontal: theme.spacing.md },
  searchIcon: { color: theme.colors.textMuted, fontSize: 20 },
  searchInput: { color: theme.colors.text, flex: 1, fontSize: 14, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  clearButton: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  clearText: { color: theme.colors.textMuted, fontSize: 24 },
  searchResult: { color: theme.colors.textMuted, fontSize: 12, paddingTop: theme.spacing.xs, textAlign: 'right' },
  materialField: { gap: theme.spacing.xs },
  dropdown: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', minHeight: 46, paddingHorizontal: theme.spacing.md },
  dropdownContent: { flex: 1 },
  dropdownText: { color: theme.colors.text, fontWeight: '700' },
  dropdownPlaceholder: { color: theme.colors.textMuted },
  materialOwned: { color: theme.colors.accentAmber, fontSize: 11, paddingTop: 2 },
  chevron: { color: theme.colors.textMuted, fontSize: 22, marginLeft: theme.spacing.sm },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { backgroundColor: theme.colors.overlay, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  dropdownSheet: { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderTopLeftRadius: theme.radius.md, borderTopRightRadius: theme.radius.md, borderWidth: 1, maxHeight: '70%', padding: theme.spacing.lg },
  dropdownHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: theme.spacing.md },
  dropdownTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  closeButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  closeText: { color: theme.colors.textMuted, fontSize: 26 },
  materialOptions: { flexGrow: 0 },
  materialOption: { alignItems: 'center', borderBottomColor: theme.colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 62, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  materialOptionSelected: { backgroundColor: theme.colors.surfaceAlt },
  materialOptionText: { flex: 1, gap: 2 },
  optionLabel: { color: theme.colors.text, fontWeight: '800' },
  optionDetail: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  radio: { alignItems: 'center', borderColor: theme.colors.borderStrong, borderRadius: 10, borderWidth: 2, height: 20, justifyContent: 'center', width: 20 },
  radioSelected: { borderColor: theme.colors.accentGreen },
  radioDot: { backgroundColor: theme.colors.accentGreen, borderRadius: 5, height: 10, width: 10 },
});
