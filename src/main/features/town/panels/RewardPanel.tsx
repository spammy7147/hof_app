import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type {
  OrbExchangeAction,
  OrbExchangeRequest,
  OrbExchangeResponse,
  StashOpenAction,
  StashOpenRequest,
  StashResponse,
  TownActionResultResponse,
  TownRowResponse,
} from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; mode: 'stash' | 'orbs'; resolveCaptcha?: () => Promise<void> };

export function RewardPanel(props: Props) {
  return props.mode === 'stash' ? <StashPanel {...props} /> : <OrbPanel {...props} />;
}

function StashPanel({ api, resolveCaptcha }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<{ action: StashOpenAction; label: string } | null>(null);
  const [response, setResponse] = useState<StashResponse | null>(null);
  const load = useCallback(() => api.load<StashResponse>('/api/town/rewards/stash'), [api]);
  const submitAction = useCallback(async (request: StashOpenRequest) => {
    const next = await api.submit<StashOpenRequest, StashResponse>('/api/town/rewards/stash/open', request);
    setResponse(next);
    setPendingAction(null);
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
  return (
    <View style={styles.container}>
      <TownItemList
        rows={rows}
        selectionMode="single"
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        header={<Text style={styles.hint}>계정에서 현재 개봉할 수 있는 상자 1개를 선택하세요.</Text>}
        footer={<View style={styles.section}>
          <Text style={styles.label}>개봉 방식</Text>
          <View style={styles.actionGrid}>
            {data.actions.map((action) => (
              <ActionButton key={action.action} label={action.label} disabled={!selected || town.status === 'submitting'} onPress={() => setPendingAction(action)} />
            ))}
          </View>
          {data.actions.length === 0 ? <Text accessibilityRole="alert" style={styles.error}>현재 HOF 개봉 버튼을 안전하게 확인하지 못했습니다.</Text> : null}
          {data.result ?? town.result ? <TownActionResult result={(data.result ?? town.result)!} onRefresh={() => void refresh().catch(() => undefined)} /> : null}
          {town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
        </View>}
      />
      <TownConfirmSheet
        visible={pendingAction != null}
        title="상자 열기 확인"
        message="개봉 결과는 되돌릴 수 없습니다."
        confirmLabel="열기"
        destructive
        submitting={town.status === 'submitting'}
        details={[{ label: '상자', value: selected?.label ?? '미선택' }, { label: '개봉 방식', value: pendingAction?.label ?? '미선택' }]}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => selected && pendingAction && void town.submit({ boxCandidateId: selected.id, action: pendingAction.action }).catch(() => setPendingAction(null))}
      />
    </View>
  );
}

function OrbPanel({ api, resolveCaptcha }: Props) {
  const [pendingAction, setPendingAction] = useState<{ action: OrbExchangeAction; label: string; repetitions: 1 | 5 } | null>(null);
  const [response, setResponse] = useState<OrbExchangeResponse | null>(null);
  const load = useCallback(() => api.load<OrbExchangeResponse>('/api/town/rewards/orbs'), [api]);
  const submitAction = useCallback(async (request: OrbExchangeRequest) => {
    const next = await api.submit<OrbExchangeRequest, OrbExchangeResponse>('/api/town/rewards/orbs/exchange', request);
    setResponse(next);
    setPendingAction(null);
    return next.result ?? information('오브 교환 결과를 갱신했습니다.');
  }, [api]);
  const town = useTownFeature({ load, submitAction, resolveCaptcha, featureKey: 'reward-orbs' });
  const data = response ?? town.data;
  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} />;
  const rows: TownRowResponse[] = data.rewards.map((reward) => ({
    id: reward.key,
    label: reward.label,
    selectable: false,
    detail: reward.unlimited ? '남은 수량 무제한' : `현재 남은 수량 ${reward.remaining?.toLocaleString() ?? '확인 불가'}개`,
    imageUrl: null,
    price: null,
    quantity: reward.remaining,
  }));
  const refresh = async () => { await town.reload(); setResponse(null); };
  return (
    <View style={styles.container}>
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
          <View style={styles.actionGrid}>
            {data.actions.map((action) => <ActionButton key={action.action} label={action.label} disabled={town.status === 'submitting'} onPress={() => setPendingAction(action)} />)}
          </View>
          <Text style={styles.hint}>보유 오브가 부족해 보여도 HOF 응답을 확인하기 위해 교환 버튼은 사용할 수 있습니다.</Text>
          {data.outcomes.length ? <View accessibilityLiveRegion="polite" style={styles.outcomes}><Text style={styles.label}>최근 교환 결과</Text>{data.outcomes.map((outcome, index) => <Text key={`${outcome.text}-${index}`} style={outcome.success ? styles.success : styles.error}>{outcome.success ? '획득' : '실패'} · {outcome.text}{outcome.quantity > 1 ? ` ×${outcome.quantity}` : ''}{outcome.inferred ? ' (수량 변화로 추론)' : ''}</Text>)}</View> : null}
          {data.result ?? town.result ? <TownActionResult result={(data.result ?? town.result)!} onRefresh={() => void refresh().catch(() => undefined)} /> : null}
          {town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
        </View>}
      />
      <TownConfirmSheet
        visible={pendingAction != null}
        title="오브 교환 확인"
        message="교환 결과에 따라 실제 성공 횟수만큼 오브가 소비됩니다."
        confirmLabel="교환"
        destructive
        submitting={town.status === 'submitting'}
        details={[{ label: '교환 횟수', value: `${pendingAction?.repetitions ?? 0}회` }, { label: '필요 오브', value: `색상별 ${((pendingAction?.repetitions ?? 0) * 1_000).toLocaleString()}개` }]}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => pendingAction && void town.submit({ action: pendingAction.action }).catch(() => setPendingAction(null))}
      />
    </View>
  );
}

function OrbCount({ label, value }: { label: string; value: number | null }) { return <View style={styles.countRow}><Text style={styles.hint}>{label}</Text><Text style={styles.count}>{value == null ? '확인 불가' : `${value.toLocaleString()}개`}</Text></View>; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => Promise<unknown> }) { return <View style={styles.container}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.hint}>{loading ? '보상 시설 정보를 불러오는 중...' : error ?? '보상 시설 정보가 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void reload().catch(() => undefined)} /> : null}</View>; }
function information(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }

const styles = StyleSheet.create({
  container: { flex: 1, gap: theme.spacing.md },
  section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.sm, justifyContent: 'center', minHeight: 48, minWidth: 112, paddingHorizontal: theme.spacing.md },
  buttonText: { color: theme.colors.background, fontWeight: '900' },
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
