import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type {
  OrbExchangeRequest,
  OrbExchangeResponse,
  StashOpenRequest,
  StashResponse,
  TownActionResultResponse,
  TownRowResponse,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; mode: 'stash' | 'orbs'; resolveCaptcha?: () => Promise<void> };

export function RewardPanel(props: Props) {
  return props.mode === 'stash' ? <StashPanel {...props} /> : <OrbPanel {...props} />;
}

function StashPanel({ api, resolveCaptcha }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [response, setResponse] = useState<StashResponse | null>(null);
  const stagedResponse = useRef<StashResponse | null>(null);
  const load = useCallback(() => api.load<StashResponse>('/api/town/rewards/stash'), [api]);
  const submitAction = useCallback(async (request: StashOpenRequest) => {
    const next = await api.submit<StashOpenRequest, StashResponse>('/api/town/rewards/stash/open', request);
    stagedResponse.current = next;
    return next.result ?? information('상자 목록을 갱신했습니다.');
  }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: 'reward-stash' });
  const data = response ?? town.data;
  useEffect(() => {
    if (!data) return;
    const live = new Set(data.boxes.filter((box) => box.selectable).map((box) => box.id));
    setSelectedIds((current) => current.filter((id) => live.has(id)).slice(0, 1));
  }, [data]);
  const rows = useMemo<TownRowResponse[]>(() => data?.boxes.map((box) => ({
    id: box.id,
    label: box.label,
    selectable: box.selectable,
    detail: box.detail,
    imageUrl: null,
    price: box.cost,
    quantity: box.owned,
  })) ?? [], [data]);
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} />;
  const selected = data.boxes.find((box) => box.id === selectedIds[0]);
  const refresh = async () => { await town.reload(); setResponse(null); };
  const result = response ? response.result ?? town.result : null;
  return (
    <View style={styles.container}>
      <View style={styles.list}>
        <TownItemList
          rows={rows}
          selectionMode="single"
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          header={<Text style={styles.hint}>계정에서 현재 개봉할 수 있는 상자 1개를 선택하세요.</Text>}
          footer={result || town.error ? <View style={styles.section}>
            {result ? <TownActionResult result={result} onRefresh={() => void refresh().catch(() => undefined)} /> : null}
            {town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
          </View> : null}
        />
      </View>
      <View accessibilityLabel="상자 열기 작업" style={styles.stashActionBar}>
        <Text style={styles.label}>개봉 방식</Text>
        <View style={[styles.actionGrid, styles.stashActionGrid]}>
          {data.actions.map((action) => (
            <ActionButton compact key={action.action} label={action.label} disabled={!selected || town.status === 'submitting'} onPress={() => {
              if (!selected) return;
              void town.submit({ boxCandidateId: selected.id, action: action.action }).then(() => {
                if (stagedResponse.current) setResponse(stagedResponse.current);
                stagedResponse.current = null;
              }).catch(() => undefined);
            }} />
          ))}
        </View>
        {data.actions.length === 0 ? <Text accessibilityRole="alert" style={styles.error}>현재 HOF 개봉 버튼을 안전하게 확인하지 못했습니다.</Text> : null}
      </View>
    </View>
  );
}

function OrbPanel({ api, resolveCaptcha }: Props) {
  const [response, setResponse] = useState<OrbExchangeResponse | null>(null);
  const stagedResponse = useRef<OrbExchangeResponse | null>(null);
  const load = useCallback(() => api.load<OrbExchangeResponse>('/api/town/rewards/orbs'), [api]);
  const submitAction = useCallback(async (request: OrbExchangeRequest) => {
    const next = await api.submit<OrbExchangeRequest, OrbExchangeResponse>('/api/town/rewards/orbs/exchange', request);
    stagedResponse.current = next;
    return next.result ?? information('오브 교환 결과를 갱신했습니다.');
  }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: 'reward-orbs' });
  const data = response ?? town.data;
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} />;
  const rows: TownRowResponse[] = data.rewards.map((reward) => ({
    id: reward.key,
    label: cleanOrbRewardLabel(reward.label),
    selectable: false,
    detail: reward.unlimited
      ? '현재 남은 수량: 무제한'
      : reward.remaining == null ? '현재 남은 수량: 확인 불가' : `현재 남은 수량: ${reward.remaining.toLocaleString()}개`,
    imageUrl: null,
    price: null,
    quantity: null,
  }));
  const refresh = async () => { await town.reload(); setResponse(null); };
  return (
    <View style={styles.container}>
      <View style={styles.list}>
        <TownItemList
          rows={rows}
          selectionMode="none"
          header={<View style={styles.section}>
            <Text style={styles.label}>{data.rewardMonth ?? '현재 보상 목록'}</Text>
            <OrbCount label="Red Orb" value={data.displayedOrbs.red} />
            <OrbCount label="Blue Orb" value={data.displayedOrbs.blue} />
            <OrbCount label="Green Orb" value={data.displayedOrbs.green} />
            {data.orbCountsEstimated ? <Text accessibilityRole="alert" style={styles.estimated}>교환 직후 수량은 직전 확인값에서 성공 1회당 색상별 1,000개를 뺀 계산값입니다. 새로고침하면 HOF 실제 수량으로 교체됩니다.</Text> : null}
            {data.remainingRewards != null ? <Text style={styles.hint}>뽑을 수 있는 한정 상품 {data.remainingRewards.toLocaleString()}개</Text> : null}
          </View>}
          footer={<View style={styles.section}>
            {data.outcomes.length ? <View accessibilityLiveRegion="polite" style={styles.outcomes}><Text style={styles.label}>최근 교환 결과</Text>{data.outcomes.map((outcome, index) => <Text key={`${outcome.text}-${index}`} style={outcome.success ? styles.success : styles.error}>{outcome.success ? '획득' : '실패'} · {outcome.text}{outcome.quantity > 1 ? ` ×${outcome.quantity}` : ''}{outcome.inferred ? ' (수량 변화로 추론)' : ''}</Text>)}</View> : null}
            {data.result ?? town.result ? <TownActionResult result={(data.result ?? town.result)!} onRefresh={() => void refresh().catch(() => undefined)} /> : null}
            {town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
          </View>}
        />
      </View>
      <View accessibilityLabel="오브 교환 작업" style={styles.orbActionBar}>
        <View style={[styles.actionGrid, styles.orbActionGrid]}>
          {data.actions.map((action) => <ActionButton compact key={action.action} label={action.label} disabled={town.status === 'submitting'} onPress={() => {
            void town.submit({ action: action.action }).then(() => {
              if (stagedResponse.current) setResponse(stagedResponse.current);
              stagedResponse.current = null;
            }).catch(() => undefined);
          }} />)}
        </View>
        {data.actions.length === 0 ? <Text accessibilityRole="alert" style={styles.error}>현재 HOF 오브 교환 버튼을 안전하게 확인하지 못했습니다.</Text> : null}
      </View>
    </View>
  );
}

function OrbCount({ label, value }: { label: string; value: number | null }) { return <View style={styles.countRow}><Text style={styles.hint}>{label}</Text><Text style={styles.count}>{value == null ? '확인 불가' : `${value.toLocaleString()}개`}</Text></View>; }
function cleanOrbRewardLabel(label: string) { return label.replace(/^[\s\-_―—–━─]+|[\s\-_―—–━─]+$/g, '').trim(); }
function ActionButton({ label, disabled, onPress, compact = false }: { label: string; disabled: boolean; onPress: () => void; compact?: boolean }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, compact && styles.compactButton, disabled && styles.disabled]}><Text adjustsFontSizeToFit={compact} minimumFontScale={0.75} numberOfLines={compact ? 1 : undefined} style={[styles.buttonText, compact && styles.compactButtonText]}>{label}</Text></Pressable>; }
function LoadState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => Promise<unknown> }) { return <View style={styles.container}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.hint}>{loading ? '보상 시설 정보를 불러오는 중...' : error ?? '보상 시설 정보가 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void reload().catch(() => undefined)} /> : null}</View>; }
function information(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }

const styles = StyleSheet.create({
  container: { flex: 1, gap: theme.spacing.md },
  list: { flex: 1, minHeight: 0 },
  section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  stashActionBar: { borderTopColor: theme.colors.border, borderTopWidth: 1, gap: theme.spacing.xs, paddingTop: theme.spacing.sm },
  stashActionGrid: { flexWrap: 'nowrap', gap: theme.spacing.xs },
  orbActionBar: { backgroundColor: theme.colors.background, borderTopColor: theme.colors.border, borderTopWidth: 1, gap: theme.spacing.xs, paddingTop: theme.spacing.sm },
  orbActionGrid: { flexWrap: 'nowrap', gap: theme.spacing.xs },
  button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.sm, justifyContent: 'center', minHeight: 48, minWidth: 112, paddingHorizontal: theme.spacing.md },
  compactButton: { flex: 1, minHeight: 44, minWidth: 0, paddingHorizontal: theme.spacing.xs },
  buttonText: { color: theme.colors.background, fontWeight: '900' },
  compactButtonText: { fontSize: 12, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  hint: { color: theme.colors.textMuted, lineHeight: 20 },
  label: { color: theme.colors.text, fontWeight: '900' },
  countRow: { flexDirection: 'row', justifyContent: 'space-between' },
  count: { color: theme.colors.text, fontWeight: '800' },
  estimated: { color: theme.colors.accentAmber, lineHeight: 20 },
  outcomes: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, gap: theme.spacing.xs, padding: theme.spacing.md },
  success: { color: theme.colors.accentGreen, lineHeight: 20 },
  error: { color: theme.colors.danger, lineHeight: 20 },
});
