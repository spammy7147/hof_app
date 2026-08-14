import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import { toRunBattleRequest, type BattlePartyMember } from '../../../domain/battleParty';
import type { PartyPresetCatalogResource } from '../../../domain/partyPresetCatalogLoader';
import { BattleRunPanel } from '../../battle/components/BattleRunPanel';
import type {
  BattleResultResponse,
  FishingAction,
  FishingBattleTarget,
  FishingExchangeRequest,
  FishingExchangeResponse,
  FishingResponse,
  HofCharacter,
  RunBattleRequest,
  TownActionResultResponse,
} from '../../../types/api';
import { normalizeTownRow, type TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type FishingPanelProps = {
  api: TownApi;
  mode?: 'fishing' | 'exchange';
  resolveCaptcha?: () => Promise<void>;
  characters?: HofCharacter[];
  partyPresetCatalog?: PartyPresetCatalogResource;
  onRunBattle?: (request: RunBattleRequest) => Promise<BattleResultResponse>;
  onNavigateMode?: (mode: 'fishing' | 'exchange') => void;
};

export function FishingPanel({ api, mode = 'fishing', resolveCaptcha, characters, partyPresetCatalog, onRunBattle, onNavigateMode }: FishingPanelProps) {
  return mode === 'exchange'
    ? <FishingExchangePanel api={api} onNavigateMode={onNavigateMode} resolveCaptcha={resolveCaptcha} />
    : <FishingLoopPanel api={api} characters={characters} partyPresetCatalog={partyPresetCatalog} onNavigateMode={onNavigateMode} onRunBattle={onRunBattle} resolveCaptcha={resolveCaptcha} />;
}

function FishingLoopPanel({ api, resolveCaptcha, characters, partyPresetCatalog, onRunBattle, onNavigateMode }: Omit<FishingPanelProps, 'mode'>) {
  const [actionState, setActionState] = useState<FishingResponse | null>(null);
  const load = useCallback(() => api.load<FishingResponse>('/api/town/fishing'), [api]);
  const submitAction = useCallback(async (action: FishingAction): Promise<TownActionResultResponse> => {
    const response = await api.submit<undefined, FishingResponse>(`/api/town/fishing/actions/${action}`, undefined);
    setActionState(response);
    return response.result ?? informational(action === 'CATCH' ? '낚시 결과를 갱신했습니다.' : '낚시 상태를 갱신했습니다.');
  }, [api]);
  const town = useTownFeature({
    load,
    submitAction,
    resolveCaptcha,
    featureKey: 'fishing',
  });
  const state = actionState ?? town.data;

  if (!state && town.status === 'loading') return <Text style={styles.muted}>낚시터를 불러오는 중...</Text>;
  if (!state) return <ErrorState message={town.error} onRetry={town.reload} />;

  const primary = state.primaryAction === 'CATCH' ? 'CATCH' : state.primaryAction === 'START' ? 'START' : null;
  return (
    <View style={styles.container}>
      {state.notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text> : null}
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>남은 낚시 횟수</Text>
        <Text style={styles.remainingCasts}>{value(state.remainingCasts, '회')}</Text>
        <Text style={styles.summaryLabel}>현재 물고기 상태</Text>
        <Text style={styles.waterStatus}>{fishingStatus(state.waterStatus)}</Text>
        <Text style={styles.baitStatus}>미끼 경단 {value(state.baitCount, '개')} · 빛나는 미끼 {value(state.shiningBaitCount, '개')}</Text>
        {state.escapeSeconds !== null ? <Text style={styles.warning}>도망까지 {state.escapeSeconds}초</Text> : null}
        {state.combo !== null ? <Text style={styles.notice}>현재 {state.combo} 콤보</Text> : null}
      </View>

      {state.blockedByBattle ? (
        <FishingBattlePanel
          characters={characters}
          partyPresetCatalog={partyPresetCatalog}
          target={state.battleTarget}
          onRefresh={() => { setActionState(null); void town.reload(); }}
          onRunBattle={onRunBattle}
        />
      ) : primary ? (
        <Pressable
          accessibilityLabel={primary === 'START' ? '낚시를 시작한다' : '낚는다'}
          accessibilityRole="button"
          disabled={town.status === 'submitting'}
          onPress={() => { void town.submit(primary).catch(() => undefined); }}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        ><Text style={styles.primaryText}>{primary === 'START' ? '낚시를 시작한다' : '낚는다'}</Text></Pressable>
      ) : null}

      {!state.blockedByBattle ? (
        <View style={styles.secondaryActions}>
          <SecondaryAction action="STATUS" enabled={state.availableActions.includes('STATUS')} label="상태를 본다" onPress={town.submit} />
          <SecondaryAction action="FILTER" enabled={state.availableActions.includes('FILTER')} label="거른다" onPress={town.submit} />
        </View>
      ) : null}
      {state.lastOutcome === 'ESCAPED' ? <Text style={styles.muted}>물고기가 도망쳤습니다. 다음 낚시를 시작할 수 있습니다.</Text> : null}
      {town.error ? <Text style={styles.error}>{town.error}</Text> : null}
      <NavigateButton label="낚시 교환소로 이동" onPress={() => onNavigateMode?.('exchange')} />
    </View>
  );
}

function FishingBattlePanel({ characters, partyPresetCatalog, target, onRefresh, onRunBattle }: {
  characters?: HofCharacter[];
  partyPresetCatalog?: PartyPresetCatalogResource;
  target: FishingBattleTarget | null;
  onRefresh: () => void;
  onRunBattle?: (request: RunBattleRequest) => Promise<BattleResultResponse>;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BattleResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [target?.categoryId, target?.mapCode]);

  const run = useCallback(async (party: BattlePartyMember[], battleCount: 1 | 3) => {
    if (!target || !characters || !onRunBattle) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await onRunBattle(toRunBattleRequest({
        categoryId: target.categoryId,
        mapCode: target.mapCode,
        party,
        characters,
        battleCount,
      })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '낚시 전투를 진행하지 못했습니다.');
    } finally {
      setRunning(false);
    }
  }, [characters, onRunBattle, target]);

  return (
    <View style={styles.battleCard}>
      <Text style={styles.warning}>낚시터에 나타난 몬스터를 처치해야 낚시를 계속할 수 있습니다.</Text>
      {target ? <Text style={styles.battleMapName}>{target.name ?? '낚시 전투'}</Text> : null}
      {target && characters && partyPresetCatalog && onRunBattle ? (
        <BattleRunPanel
          allowedBattleCounts={[1]}
          characters={characters}
          partyPresetCatalog={partyPresetCatalog}
          isRunning={running}
          result={result}
          errorMessage={error}
          onRunBattle={(party, battleCount) => { void run(party, battleCount); }}
        />
      ) : (
        <Text style={styles.muted}>현재 출현한 낚시 전투 맵을 확인하는 중입니다.</Text>
      )}
      <Pressable accessibilityLabel="낚시 상태 새로고침" accessibilityRole="button" onPress={onRefresh} style={styles.battleButton}>
        <Text style={styles.buttonText}>낚시 상태 새로고침</Text>
      </Pressable>
    </View>
  );
}

function FishingExchangePanel({ api, resolveCaptcha, onNavigateMode }: Pick<FishingPanelProps, 'api' | 'resolveCaptcha' | 'onNavigateMode'>) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState('1');
  const [actionResponse, setActionResponse] = useState<FishingExchangeResponse | null>(null);
  const path = categoryId == null
    ? '/api/town/fishing-exchange' as const
    : `/api/town/fishing-exchange?categoryCandidateId=${encodeURIComponent(categoryId)}` as const;
  const load = useCallback(async () => normalizeFishingExchangeResponse(await api.load<unknown>(path)), [api, path]);
  const submitAction = useCallback(async (request: FishingExchangeRequest): Promise<TownActionResultResponse> => {
    const response = normalizeFishingExchangeResponse(
      await api.submit<FishingExchangeRequest, unknown>('/api/town/fishing-exchange', request),
    );
    setActionResponse(response);
    setSelectedIds((current) => current.filter((id) => response.items.some((item) => item.id === id && item.selectable)).slice(0, 1));
    return response.result ?? informational('교환 결과를 갱신했습니다.');
  }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: `fishing-exchange-${categoryId ?? 'default'}` });
  const data = actionResponse ?? town.data;
  useEffect(() => {
    if (!data) return;
    setSelectedIds((current) => current.filter((id) => data.items.some((item) => item.id === id && item.selectable)).slice(0, 1));
  }, [data]);
  useEffect(() => {
    setSelectedIds([]);
    setActionResponse(null);
    setCategoryDropdownOpen(false);
  }, [api, categoryId]);
  if (!data && town.status === 'loading') return <Text style={styles.muted}>낚시 교환소를 불러오는 중...</Text>;
  if (!data) return <ErrorState message={town.error} onRetry={town.reload} />;
  const selected = selectedIds[0];
  const quantityValid = /^[1-9]\d*$/.test(quantity) && Number.isSafeInteger(Number(quantity));
  const parsedQuantity = quantityValid ? Number(quantity) : null;
  const quantityError = quantityValid ? null : '수량은 1 이상의 10진 정수로 입력하세요.';
  const canExchange = Boolean(selected && data.currentCategoryId && quantityValid && town.status !== 'submitting');
  const selectedItem = data.items.find((item) => item.id === selected) ?? null;
  const currentCategory = data.categories.find((category) => category.current)
    ?? data.categories.find((category) => category.id === data.currentCategoryId)
    ?? null;
  const materialsByItemId = new Map(data.items.map((item) => [item.id, item.materials]));
  return (
    <View accessibilityLabel="낚시 교환소 화면" style={styles.exchangeScreen}>
      <View style={styles.categoryDropdown}>
        <Text style={styles.summaryLabel}>교환 품목 분류</Text>
        <Pressable
          accessibilityLabel="교환 품목 분류 선택"
          accessibilityRole="button"
          accessibilityState={{ expanded: categoryDropdownOpen, disabled: data.categories.length === 0 || town.status === 'submitting' }}
          disabled={data.categories.length === 0 || town.status === 'submitting'}
          onPress={() => setCategoryDropdownOpen(true)}
          style={[styles.categoryDropdownButton, data.categories.length === 0 && styles.disabled]}
        >
          <Text style={styles.categoryDropdownText}>{currentCategory?.label ?? '분류를 불러오지 못했습니다.'}</Text>
          <Text style={styles.categoryDropdownArrow}>{categoryDropdownOpen ? '▲' : '▼'}</Text>
        </Pressable>
        <Modal animationType="fade" onRequestClose={() => setCategoryDropdownOpen(false)} transparent visible={categoryDropdownOpen}>
          <View accessibilityViewIsModal style={styles.categoryModalRoot}>
            <Pressable accessibilityLabel="교환 품목 분류 선택 닫기" accessibilityRole="button" onPress={() => setCategoryDropdownOpen(false)} style={styles.categoryModalBackdrop} />
            <View style={styles.categoryDropdownSheet}>
              <View style={styles.categoryDropdownHeader}>
                <Text style={styles.categoryDropdownTitle}>교환 품목 분류</Text>
                <Pressable accessibilityLabel="교환 품목 분류 선택 닫기" accessibilityRole="button" onPress={() => setCategoryDropdownOpen(false)} style={styles.categoryCloseButton}>
                  <Text style={styles.categoryCloseText}>×</Text>
                </Pressable>
              </View>
              <ScrollView accessibilityRole="menu" keyboardShouldPersistTaps="handled" style={styles.categoryDropdownMenu}>
                {data.categories.map((category) => (
                  <Pressable
                    key={category.id}
                    accessibilityLabel={`${category.label} 분류`}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: category.current, disabled: town.status === 'submitting' }}
                    disabled={town.status === 'submitting'}
                    onPress={() => {
                      setCategoryDropdownOpen(false);
                      if (!category.current) setCategoryId(category.id);
                    }}
                    style={[styles.categoryDropdownOption, category.current && styles.categoryDropdownOptionSelected]}
                  ><Text style={styles.categoryText}>{category.label}</Text></Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
      <TownItemList
        footer={<View style={styles.exchangeListFooter}>
          {data.result ? <TownActionResult result={data.result} /> : null}
          {town.error ? <Text style={styles.error}>{town.error}</Text> : null}
          <NavigateButton label="낚시터로 이동" onPress={() => onNavigateMode?.('fishing')} />
        </View>}
        onSelectionChange={setSelectedIds}
        renderItemFooter={(item) => {
          const materials = materialsByItemId.get(item.id) ?? [];
          const itemSelected = item.id === selected;
          if (materials.length === 0 && !itemSelected) return null;
          return (
            <View style={styles.exchangeItemFooter}>
              {materials.length > 0 ? (
                <Pressable
                  accessibilityLabel={`${item.label} 교환 재료`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: itemSelected, disabled: !item.selectable || town.status === 'submitting' }}
                  disabled={!item.selectable || town.status === 'submitting'}
                  onPress={() => setSelectedIds([item.id])}
                  style={({ pressed }) => [styles.exchangeMaterials, pressed && styles.pressed]}
                >
                  <Text style={styles.exchangeMaterialsTitle}>교환 재료</Text>
                  {materials.map((material) => <Text key={material} style={styles.exchangeMaterial}>{material}</Text>)}
                </Pressable>
              ) : null}
              {itemSelected ? (
                <View style={styles.exchangeQuantityField}>
                  <Text style={styles.exchangeMaterialsTitle}>교환 수량</Text>
                  <TextInput
                    accessibilityLabel="교환 수량"
                    keyboardType="number-pad"
                    onChangeText={setQuantity}
                    style={styles.quantityInput}
                    value={quantity}
                  />
                  {quantityError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{quantityError}</Text> : null}
                </View>
              ) : null}
            </View>
          );
        }}
        rows={data.items}
        selectionDisabled={town.status === 'submitting'}
        selectedIds={selectedIds}
        selectionMode="single"
        showSelectionAvailability
        style={styles.exchangeList}
      />
      <View accessibilityLabel="낚시 교환 작업" style={styles.exchangeActionBar}>
        <Text numberOfLines={1} style={styles.exchangeSelection}>
          {selectedItem ? `선택: ${selectedItem.label}` : '교환할 품목을 선택하세요.'}
        </Text>
        <Pressable
          accessibilityLabel="선택한 낚시 품목 교환"
          accessibilityRole="button"
          disabled={!canExchange}
          onPress={() => {
            if (!canExchange || !selected || parsedQuantity === null || !data.currentCategoryId) return;
            void town.submit({ candidateId: selected, categoryCandidateId: data.currentCategoryId, quantity: parsedQuantity }).catch(() => undefined);
          }}
          style={[styles.exchangeButton, !canExchange && styles.disabled]}
        ><Text style={styles.primaryText}>교환</Text></Pressable>
      </View>
    </View>
  );
}

function NavigateButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={styles.secondaryButton}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

function SecondaryAction({ action, enabled, label, onPress }: {
  action: FishingAction;
  enabled: boolean;
  label: string;
  onPress: (action: FishingAction) => Promise<unknown>;
}) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={!enabled} onPress={() => void onPress(action).catch(() => undefined)} style={[styles.secondaryButton, !enabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => Promise<unknown> }) {
  return <View style={styles.container}><Text style={styles.error}>{message ?? '낚시 정보를 불러오지 못했습니다.'}</Text><Pressable accessibilityLabel="낚시 정보 다시 불러오기" onPress={() => void onRetry().catch(() => undefined)} style={styles.secondaryButton}><Text style={styles.buttonText}>다시 시도</Text></Pressable></View>;
}

function informational(message: string): TownActionResultResponse {
  return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true };
}

function fishingStatus(status: string | null): string {
  if (!status) return '물고기 움직임을 확인할 수 없습니다.';
  const cleaned = status.replace(/^\s*[（(]?\s*오늘의 남은 낚시 횟수\s*[:：]?\s*\d+회\s*[）)]?\s*/, '').trim();
  return cleaned || '물고기 움직임을 확인할 수 없습니다.';
}

function normalizeFishingExchangeResponse(value: unknown): FishingExchangeResponse {
  if (!isRecord(value) || !Array.isArray(value.categories) || !Array.isArray(value.items)) {
    throw new Error('낚시 교환소 응답 형식을 확인할 수 없습니다.');
  }
  const categories = value.categories.filter(isRecord).map((category) => ({
    id: typeof category.id === 'string' ? category.id.trim() : '',
    label: typeof category.label === 'string' ? category.label.trim() : '',
    current: category.current === true,
  })).filter((category) => category.id.length > 0 && category.label.length > 0);
  const currentCategoryId = typeof value.currentCategoryId === 'string' ? value.currentCategoryId.trim() : '';
  const currentCategories = categories.filter((category) => category.current);
  if (categories.length === 0 || currentCategoryId.length === 0 || currentCategories.length !== 1 || currentCategories[0]?.id !== currentCategoryId) {
    throw new Error('낚시 교환소 응답 형식을 확인할 수 없습니다.');
  }
  const items = value.items.filter(isRecord).map((item) => ({
    ...normalizeTownRow(item),
    materials: Array.isArray(item.materials)
      ? item.materials.filter((material): material is string => typeof material === 'string').map((material) => material.trim()).filter(Boolean)
      : [],
  })).filter((item) => item.id.length > 0);
  return {
    categories,
    currentCategoryId,
    items,
    result: isRecord(value.result) ? value.result as TownActionResultResponse : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function value(input: number | null, suffix: string) { return input === null ? '확인 불가' : `${input}${suffix}`; }

const styles = StyleSheet.create({
  container: { gap: theme.spacing.md },
  exchangeScreen: { flex: 1, gap: theme.spacing.sm, minHeight: 0 },
  exchangeList: { flex: 1, minHeight: 0 },
  exchangeListFooter: { gap: theme.spacing.md, paddingBottom: theme.spacing.sm },
  exchangeItemFooter: { gap: theme.spacing.sm },
  exchangeMaterials: { gap: theme.spacing.xs },
  exchangeMaterialsTitle: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800' },
  exchangeMaterial: { color: theme.colors.text, fontSize: 13, lineHeight: 18 },
  exchangeActionBar: { backgroundColor: theme.colors.background, borderTopColor: theme.colors.borderStrong, borderTopWidth: 1, gap: theme.spacing.xs, paddingTop: theme.spacing.sm },
  exchangeSelection: { color: theme.colors.textMuted, fontSize: 12 },
  exchangeButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.sm, justifyContent: 'center', minHeight: 48, paddingHorizontal: theme.spacing.lg, width: '100%' },
  exchangeQuantityField: { gap: theme.spacing.xs },
  summary: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: theme.spacing.xs, padding: theme.spacing.md },
  heading: { color: theme.colors.text, fontSize: 17, fontWeight: '900' },
  info: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19 },
  summaryLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  remainingCasts: { color: theme.colors.text, fontSize: 24, fontWeight: '900' },
  waterStatus: { color: theme.colors.text, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  baitStatus: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: theme.spacing.xs },
  notice: { color: theme.colors.accentGreen, fontSize: 14, fontWeight: '800' },
  warning: { color: theme.colors.accentAmber, fontSize: 14, fontWeight: '800' },
  muted: { color: theme.colors.textMuted, fontSize: 13 },
  error: { color: theme.colors.danger, fontSize: 13 },
  primaryButton: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, minHeight: 52, justifyContent: 'center', padding: theme.spacing.md },
  primaryText: { color: theme.colors.background, fontSize: 16, fontWeight: '900' },
  secondaryActions: { flexDirection: 'row', gap: theme.spacing.sm },
  secondaryButton: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, flex: 1, minHeight: 44, justifyContent: 'center', padding: theme.spacing.sm },
  battleCard: { borderColor: theme.colors.danger, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  battleMapName: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  battleButton: { alignItems: 'center', backgroundColor: theme.colors.accentAmber, borderRadius: theme.radius.sm, minHeight: 44, justifyContent: 'center' },
  buttonText: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  catchList: { gap: theme.spacing.sm },
  catchCard: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, gap: theme.spacing.xs, padding: theme.spacing.md },
  categoryDropdown: { gap: theme.spacing.xs },
  categoryDropdownButton: { alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: theme.spacing.md },
  categoryDropdownText: { color: theme.colors.text, flex: 1, fontSize: 15, fontWeight: '800' },
  categoryDropdownArrow: { color: theme.colors.textMuted, fontSize: 12, marginLeft: theme.spacing.sm },
  categoryModalRoot: { flex: 1, justifyContent: 'flex-end' },
  categoryModalBackdrop: { backgroundColor: theme.colors.overlay, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  categoryDropdownSheet: { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderStrong, borderTopLeftRadius: theme.radius.md, borderTopRightRadius: theme.radius.md, borderWidth: 1, maxHeight: '70%', padding: theme.spacing.lg },
  categoryDropdownHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: theme.spacing.md },
  categoryDropdownTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  categoryCloseButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  categoryCloseText: { color: theme.colors.textMuted, fontSize: 26 },
  categoryDropdownMenu: { flexGrow: 0 },
  categoryDropdownOption: { borderBottomColor: theme.colors.borderStrong, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.md },
  categoryDropdownOptionSelected: { backgroundColor: theme.colors.surface },
  categoryText: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  quantityInput: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md, width: '100%' },
});
