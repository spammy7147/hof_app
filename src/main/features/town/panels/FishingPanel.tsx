import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type {
  FishingAction,
  FishingBattleTarget,
  FishingExchangeRequest,
  FishingExchangeResponse,
  FishingResponse,
  TownActionResultResponse,
} from '../../../types/api';
import { normalizeTownRow, type TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type FishingPanelProps = {
  api: TownApi;
  mode?: 'fishing' | 'exchange';
  resolveCaptcha?: () => Promise<void>;
  onOpenBattle?: (target: FishingBattleTarget) => void;
  onNavigateMode?: (mode: 'fishing' | 'exchange') => void;
};

export function FishingPanel({ api, mode = 'fishing', resolveCaptcha, onOpenBattle, onNavigateMode }: FishingPanelProps) {
  return mode === 'exchange'
    ? <FishingExchangePanel api={api} onNavigateMode={onNavigateMode} resolveCaptcha={resolveCaptcha} />
    : <FishingLoopPanel api={api} onNavigateMode={onNavigateMode} onOpenBattle={onOpenBattle} resolveCaptcha={resolveCaptcha} />;
}

function FishingLoopPanel({ api, resolveCaptcha, onOpenBattle, onNavigateMode }: Omit<FishingPanelProps, 'mode'>) {
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
        <View style={styles.battleCard}>
          <Text style={styles.warning}>낚시 전투를 끝내기 전에는 낚시할 수 없습니다.</Text>
          <Pressable
            accessibilityLabel="낚시 전투로 이동"
            accessibilityRole="button"
            disabled={!state.battleTarget}
            onPress={() => state.battleTarget && onOpenBattle?.(state.battleTarget)}
            style={styles.battleButton}
          ><Text style={styles.buttonText}>전투로 이동</Text></Pressable>
        </View>
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
      {state.catches.length > 0 ? (
        <View accessibilityLabel="낚시 획득 결과" style={styles.catchList}>
          <Text style={styles.heading}>획득한 물고기</Text>
          {state.catches.map((caught, index) => (
            <View key={`${caught.name}-${index}`} style={styles.catchCard}>
              <Text style={styles.heading}>{caught.name} × {caught.quantity}</Text>
              <Text style={styles.info}>남은 사용 횟수 {caught.remainingUses === null ? '확인 불가' : `${caught.remainingUses}회`}</Text>
              <Text style={styles.info}>효과 {caught.effect ?? '확인 불가'}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {state.result ? <TownActionResult onRefresh={() => { setActionState(null); void town.reload(); }} result={state.result} /> : null}
      {town.error ? <Text style={styles.error}>{town.error}</Text> : null}
      <NavigateButton label="낚시 교환소로 이동" onPress={() => onNavigateMode?.('exchange')} />
    </View>
  );
}

function FishingExchangePanel({ api, resolveCaptcha, onNavigateMode }: Pick<FishingPanelProps, 'api' | 'resolveCaptcha' | 'onNavigateMode'>) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState('1');
  const [confirming, setConfirming] = useState(false);
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
    setConfirming(false);
    return response.result ?? informational('교환 결과를 갱신했습니다.');
  }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: `fishing-exchange-${categoryId ?? 'default'}` });
  const data = actionResponse ?? town.data;
  useEffect(() => {
    if (!data) return;
    setSelectedIds((current) => current.filter((id) => data.items.some((item) => item.id === id && item.selectable)).slice(0, 1));
    setConfirming(false);
  }, [data]);
  useEffect(() => {
    setSelectedIds([]);
    setActionResponse(null);
    setConfirming(false);
  }, [api, categoryId]);
  if (!data && town.status === 'loading') return <Text style={styles.muted}>낚시 교환소를 불러오는 중...</Text>;
  if (!data) return <ErrorState message={town.error} onRetry={town.reload} />;
  const selected = selectedIds[0];
  const selectedItem = data.items.find((item) => item.id === selected);
  const quantityValid = /^[1-9]\d*$/.test(quantity) && Number.isSafeInteger(Number(quantity));
  const parsedQuantity = quantityValid ? Number(quantity) : null;
  const quantityError = quantityValid ? null : '수량은 1 이상의 10진 정수로 입력하세요.';
  const canExchange = Boolean(selected && data.currentCategoryId && quantityValid && town.status !== 'submitting');
  return (
    <View style={styles.container}>
      <View accessibilityRole="radiogroup" style={styles.categoryList}>
        {data.categories.map((category) => (
          <Pressable
            key={category.id}
            accessibilityLabel={`${category.label} 분류`}
            accessibilityRole="radio"
            accessibilityState={{ checked: category.current, disabled: town.status === 'submitting' }}
            disabled={town.status === 'submitting'}
            onPress={() => { if (!category.current) setCategoryId(category.id); }}
            style={[styles.categoryChip, category.current && styles.categoryChipSelected]}
          ><Text style={styles.categoryText}>{category.label}</Text></Pressable>
        ))}
      </View>
      <TownItemList rows={data.items} selectedIds={selectedIds} selectionMode="single" onSelectionChange={setSelectedIds} />
      <TextInput accessibilityLabel="교환 수량" keyboardType="number-pad" onChangeText={setQuantity} style={styles.quantityInput} value={quantity} />
      {quantityError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{quantityError}</Text> : null}
      <Pressable
        accessibilityLabel="선택한 낚시 품목 교환"
        accessibilityRole="button"
        disabled={!canExchange}
        onPress={() => canExchange && setConfirming(true)}
        style={[styles.primaryButton, !canExchange && styles.disabled]}
      ><Text style={styles.primaryText}>교환</Text></Pressable>
      {data.result ? <TownActionResult result={data.result} /> : null}
      {town.error ? <Text style={styles.error}>{town.error}</Text> : null}
      <NavigateButton label="낚시터로 이동" onPress={() => onNavigateMode?.('fishing')} />
      <TownConfirmSheet
        confirmLabel="교환"
        details={selectedItem ? [
          { label: '품목', value: selectedItem.label },
          { label: '수량', value: `${parsedQuantity ?? 0}개` },
          ...(selectedItem.price !== null && parsedQuantity !== null ? [{ label: '비용', value: `$${(selectedItem.price * parsedQuantity).toLocaleString()}` }] : []),
          ...(selectedItem.materials.length ? [{ label: '재료', value: selectedItem.materials.join(', ') }] : []),
        ] : []}
        message="선택한 낚시 품목을 교환합니다."
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          if (!selected || parsedQuantity === null) return;
          if (!data.currentCategoryId) return;
          void town.submit({ candidateId: selected, categoryCandidateId: data.currentCategoryId, quantity: parsedQuantity }).catch(() => undefined);
        }}
        submitting={town.status === 'submitting'}
        title="교환 확인"
        visible={confirming && selectedItem != null && quantityValid}
      />
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
  const items = value.items.filter(isRecord).map((item) => ({
    ...normalizeTownRow(item),
    materials: Array.isArray(item.materials)
      ? item.materials.filter((material): material is string => typeof material === 'string').map((material) => material.trim()).filter(Boolean)
      : [],
  })).filter((item) => item.id.length > 0);
  return {
    categories,
    currentCategoryId: typeof value.currentCategoryId === 'string' ? value.currentCategoryId : null,
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
  battleCard: { borderColor: theme.colors.accentAmber, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  battleButton: { alignItems: 'center', backgroundColor: theme.colors.accentAmber, borderRadius: theme.radius.sm, minHeight: 44, justifyContent: 'center' },
  buttonText: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  catchList: { gap: theme.spacing.sm },
  catchCard: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, gap: theme.spacing.xs, padding: theme.spacing.md },
  categoryList: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  categoryChip: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  categoryChipSelected: { borderColor: theme.colors.accentGreen, borderWidth: 2 },
  categoryText: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  quantityInput: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.text, minHeight: 44, paddingHorizontal: theme.spacing.md },
});
