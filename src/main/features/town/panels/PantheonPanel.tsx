import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import { theme } from '../../../styles/theme';
import type { PantheonActionRequest, PantheonActionResponse, PantheonDetailResponse, PantheonStreetResponse, TownActionResultResponse, TownRowResponse } from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { TownMutationBusyError, useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; resolveCaptcha?: () => Promise<void> };
type CardActionRequest = { shrineId: string; actionId: string };
type PendingAction = { shrineId: string; shrineName: string; action: PantheonActionResponse };
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;

export function PantheonPanel({ api, resolveCaptcha }: Props) {
  const apiKey = identifyApi(api);
  const [confirm, setConfirm] = useState<PendingAction | null>(null);
  const load = useCallback(() => api.load<PantheonStreetResponse>('/api/town/pantheon'), [api]);
  const submitAction = useCallback(async ({ shrineId, actionId }: CardActionRequest) => {
    const next = await api.submit<PantheonActionRequest, PantheonDetailResponse>(`/api/town/pantheon/${encodeURIComponent(shrineId)}/actions`, { actionId });
    return next.result ?? info('신전 상태를 갱신했습니다.');
  }, [api]);
  const town = useTownFeature<PantheonStreetResponse, CardActionRequest>({ load, submitAction, resolveCaptcha, featureKey: `pantheon-street-${apiKey}`, describeError: toUserFacingErrorMessage });
  useEffect(() => setConfirm(null), [api]);

  if (!town.data) return <LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} label="신전 거리를" />;
  const busy = town.status === 'loading' || town.status === 'submitting';
  const rows = town.data.shrines.map((shrine): TownRowResponse => ({
    id: shrine.id,
    label: shrine.name,
    accessibilityLabel: `${shrine.name}${shrine.alias ? ` ${shrine.alias}` : ''}`,
    detail: [shrine.alias, shrine.color ? `HOF 표시 색상 ${shrine.color}` : null].filter(Boolean).join(' · '),
    imageUrl: shrine.imageUrl,
    price: null,
    quantity: null,
    selectable: false,
  }));
  const perform = () => {
    if (!confirm) return;
    const pending = confirm;
    void town.submit({ shrineId: pending.shrineId, actionId: pending.action.id })
      .then(() => setConfirm((current) => current === pending ? null : current))
      .catch((error: unknown) => { if (!(error instanceof TownMutationBusyError)) setConfirm((current) => current === pending ? null : current); });
  };
  const details = confirm ? confirmDetails(confirm.action) : [];
  return <View style={styles.container}>
    <TownItemList rows={rows} selectionMode="none"
      header={<View style={styles.section}><Text style={styles.title}>신전 거리</Text><Text style={styles.hint}>각 신전에서 현재 가능한 동작을 바로 선택할 수 있습니다.</Text></View>}
      renderItemFooter={(row) => {
        const shrine = town.data!.shrines.find((item) => item.id === row.id);
        if (!shrine || shrine.actions.length === 0) return <Text style={styles.hint}>현재 HOF가 제공하는 동작이 없습니다.</Text>;
        return <View style={styles.actions}>{shrine.actions.map((action) => <ActionButton key={action.id} label={actionButtonLabel(action)} accessibilityLabel={`${shrine.name} ${actionButtonLabel(action)}`} disabled={busy} onPress={() => setConfirm({ shrineId: shrine.id, shrineName: shrine.name, action })} />)}</View>;
      }}
      footer={<View style={styles.section}>{town.result ? <TownActionResult result={town.result} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}</View>}
      emptyMessage="현재 확인할 수 있는 신전이 없습니다." />
    <TownConfirmSheet visible={confirm != null} title={`${confirm?.shrineName ?? ''} · ${confirm ? ACTION_LABEL[confirm.action.type] : ''}`} message="HOF 서버에 이 동작을 한 번 요청합니다." confirmLabel={confirm ? ACTION_LABEL[confirm.action.type] : '실행'} destructive={confirm?.action.type !== 'CHECK_DOCTRINE'} submitting={town.status === 'submitting'} details={details} onCancel={() => setConfirm(null)} onConfirm={perform} />
  </View>;
}

function confirmDetails(action: PantheonActionResponse) {
  const details = [{ label: '동작', value: action.label }];
  if (action.costFunds != null) details.push({ label: '비용', value: `${action.costFunds.toLocaleString()} Funds` });
  if (action.fundsPercent != null) details.push({ label: '기부 비율', value: `보유 Funds의 ${action.fundsPercent}%` });
  if (action.itemName) details.push({ label: '기부 아이템', value: `${action.itemName}${action.itemQuantity ? ` ×${action.itemQuantity}` : ''}` });
  return details;
}
function summary(action: PantheonActionResponse) { return confirmDetails(action).slice(1).map((item) => item.value).join(', '); }
function actionButtonLabel(action: PantheonActionResponse) { const detail = summary(action); return `${ACTION_LABEL[action.type]}${detail ? ` · ${detail}` : ''}`; }
function ActionButton({ label, accessibilityLabel = label, disabled, onPress }: { label: string; accessibilityLabel?: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, reload, label }: { loading: boolean; error: string | null; reload: () => Promise<unknown>; label: string }) { return <View style={styles.section}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.hint}>{loading ? `${label} 불러오는 중...` : error ?? `${label} 표시할 수 없습니다.`}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void reload().catch(() => undefined)} /> : null}</View>; }
function info(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
function identifyApi(api: TownApi) { const key = api as object; const old = apiKeys.get(key); if (old != null) return old; const next = nextApiKey++; apiKeys.set(key, next); return next; }
const ACTION_LABEL = { CHECK_DOCTRINE: '교리 확인', BUY_PRIEST_ITEM: '사제 아이템 구입', DONATE_FIXED: '정액 기부', DONATE_PERCENT: '비율 기부', DONATE_ITEM: '아이템 기부' } as const;
const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, hint: { color: theme.colors.textMuted, lineHeight: 20 }, error: { color: theme.colors.danger, lineHeight: 20 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }, button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, flexGrow: 1, justifyContent: 'center', minHeight: 46, minWidth: 110, paddingHorizontal: theme.spacing.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 } });
