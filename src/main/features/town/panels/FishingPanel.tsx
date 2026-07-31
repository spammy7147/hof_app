import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type {
  FishingAction,
  FishingExchangeRequest,
  FishingExchangeResponse,
  FishingResponse,
  TownActionResultResponse,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type FishingPanelProps = {
  api: TownApi;
  mode?: 'fishing' | 'exchange';
  resolveCaptcha?: () => Promise<void>;
  onOpenBattle?: (battleLink: string) => void;
};

export function FishingPanel({ api, mode = 'fishing', resolveCaptcha, onOpenBattle }: FishingPanelProps) {
  return mode === 'exchange'
    ? <FishingExchangePanel api={api} resolveCaptcha={resolveCaptcha} />
    : <FishingLoopPanel api={api} onOpenBattle={onOpenBattle} resolveCaptcha={resolveCaptcha} />;
}

function FishingLoopPanel({ api, resolveCaptcha, onOpenBattle }: Omit<FishingPanelProps, 'mode'>) {
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
        <Text style={styles.heading}>{state.locationName}</Text>
        <Text style={styles.info}>남은 낚시 횟수 {value(state.remainingCasts, '회')}</Text>
        <Text style={styles.info}>{state.waterStatus ?? '물의 상태를 확인할 수 없습니다.'}</Text>
        <Text style={styles.info}>미끼 경단 {value(state.baitCount, '개')} · 빛나는 미끼 {value(state.shiningBaitCount, '개')}</Text>
        {state.escapeSeconds !== null ? <Text style={styles.warning}>도망까지 {state.escapeSeconds}초</Text> : null}
        {state.combo !== null ? <Text style={styles.notice}>현재 {state.combo} 콤보</Text> : null}
      </View>

      {state.blockedByBattle ? (
        <View style={styles.battleCard}>
          <Text style={styles.warning}>낚시 전투를 끝내기 전에는 낚시할 수 없습니다.</Text>
          <Pressable
            accessibilityLabel="낚시 전투로 이동"
            accessibilityRole="button"
            onPress={() => state.battleLink && onOpenBattle?.(state.battleLink)}
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
      {state.result ? <TownActionResult onRefresh={() => { setActionState(null); void town.reload(); }} result={state.result} /> : null}
      {town.error ? <Text style={styles.error}>{town.error}</Text> : null}
    </View>
  );
}

function FishingExchangePanel({ api, resolveCaptcha }: Pick<FishingPanelProps, 'api' | 'resolveCaptcha'>) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionResponse, setActionResponse] = useState<FishingExchangeResponse | null>(null);
  const load = useCallback(() => api.load<FishingExchangeResponse>('/api/town/fishing-exchange'), [api]);
  const submitAction = useCallback(async (request: FishingExchangeRequest): Promise<TownActionResultResponse> => {
    const response = await api.submit<FishingExchangeRequest, FishingExchangeResponse>('/api/town/fishing-exchange', request);
    setActionResponse(response);
    return response.result ?? informational('교환 결과를 갱신했습니다.');
  }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: 'fishing-exchange' });
  const data = actionResponse ?? town.data;
  if (!data && town.status === 'loading') return <Text style={styles.muted}>낚시 교환소를 불러오는 중...</Text>;
  if (!data) return <ErrorState message={town.error} onRetry={town.reload} />;
  const selected = selectedIds[0];
  return (
    <View style={styles.container}>
      <TownItemList rows={data.items} selectedIds={selectedIds} selectionMode="single" onSelectionChange={setSelectedIds} />
      <Pressable
        accessibilityLabel="선택한 낚시 품목 교환"
        accessibilityRole="button"
        disabled={!selected || town.status === 'submitting'}
        onPress={() => selected && void town.submit({ candidateId: selected, quantity: 1 }).catch(() => undefined)}
        style={[styles.primaryButton, !selected && styles.disabled]}
      ><Text style={styles.primaryText}>교환</Text></Pressable>
      {data.result ? <TownActionResult result={data.result} /> : null}
      {town.error ? <Text style={styles.error}>{town.error}</Text> : null}
    </View>
  );
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
function value(input: number | null, suffix: string) { return input === null ? '확인 불가' : `${input}${suffix}`; }

const styles = StyleSheet.create({
  container: { gap: theme.spacing.md },
  summary: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, gap: theme.spacing.xs, padding: theme.spacing.md },
  heading: { color: theme.colors.text, fontSize: 17, fontWeight: '900' },
  info: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19 },
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
});
