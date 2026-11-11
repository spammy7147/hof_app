import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useVisibleRefresh } from '../../../hooks/useVisibleRefresh';
import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import { theme } from '../../../styles/theme';
import type { PantheonActionRequest, PantheonActionResponse, PantheonDetailResponse, PantheonStreetResponse, TownActionResultResponse, TownRowResponse } from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; resolveCaptcha?: () => Promise<void> };
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;

export function PantheonPanel({ api, resolveCaptcha }: Props) {
  const apiKey = identifyApi(api);
  const load = useCallback(() => api.load<PantheonStreetResponse>('/api/town/pantheon?view=catalog'), [api]);
  const mutationBusy = useRef(false);
  const [busy, setBusy] = useState(false);
  const onActionState = useCallback((pending: boolean) => { mutationBusy.current = pending; setBusy(pending); }, []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const town = useTownFeature<PantheonStreetResponse>({ load, resolveCaptcha, featureKey: `pantheon-street-${apiKey}`, describeError: toUserFacingErrorMessage });

  if (town.status === 'awaiting-captcha') return <Text style={styles.hint}>HOF 인증을 기다리는 중...</Text>;
  if (!town.data) return <LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} label="신전 거리를" />;
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
  return <View style={styles.container}>
    <TownItemList rows={rows} selectionMode="none"
      header={<View style={styles.section}><Text style={styles.title}>신전 거리</Text><Text style={styles.hint}>신전을 펼쳐 현재 가능한 동작을 확인하세요.</Text></View>}
      renderItemFooter={(row) => {
        const shrine = town.data!.shrines.find((item) => item.id === row.id);
        if (!shrine) return null;
        return <View style={styles.section}>
          <ActionButton label={expanded === shrine.id ? '접기' : '상세 보기'} accessibilityLabel={`${shrine.name} 상세`} disabled={busy} onPress={() => { if (!mutationBusy.current) setExpanded((current) => current === shrine.id ? null : shrine.id); }} />
          {expanded === shrine.id ? <ShrineDetail key={`${apiKey}:${shrine.id}`} api={api} shrineId={shrine.id} name={shrine.name} resolveCaptcha={resolveCaptcha} onActionState={onActionState} /> : null}
        </View>;
      }}
      footer={<View style={styles.section}>{town.result ? <TownActionResult result={town.result} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}</View>}
      emptyMessage="현재 확인할 수 있는 신전이 없습니다." />
  </View>;
}

function ShrineDetail({ api, shrineId, name, resolveCaptcha, onActionState }: Props & { shrineId: string; name: string; onActionState: (pending: boolean) => void }) {
  const path = `/api/town/pantheon/${encodeURIComponent(shrineId)}` as const;
  const load = useCallback(async () => {
    const detail = await api.load<PantheonDetailResponse>(path);
    if (detail.complete === false) throw new Error('신전 상세를 확인하지 못했습니다. 다시 확인해 주세요.');
    return detail;
  }, [api, path]);
  const actionPending = useRef(false);
  const submitAction = async (request: PantheonActionRequest): Promise<PantheonDetailResponse> => {
    actionPending.current = true;
    onActionState(true);
    try {
      const next = await api.submit<PantheonActionRequest, PantheonDetailResponse>(`${path}/actions`, request);
      if (next.complete !== false) return next;
      try { return { ...await load(), result: next.result }; }
      catch { return { ...(town.data ?? next), complete: false, result: next.result ?? info('신전 상세를 다시 확인해 주세요.') }; }
    } finally { actionPending.current = false; onActionState(false); }
  };
  const town = useTownFeature<PantheonDetailResponse, PantheonActionRequest>({
    load, submitAction, resolveCaptcha, featureKey: path, describeError: toUserFacingErrorMessage,
    projectAction: (raw) => {
      const next = raw as PantheonDetailResponse;
      return { data: next, result: next.result ?? info('신전 상태를 갱신했습니다.') };
    },
  });
  useEffect(() => api.subscribeMutations?.(() => {
    if (!actionPending.current) void town.reload().catch(() => undefined);
  }), [api, town.reload]);
  useVisibleRefresh(() => { if (town.status === 'ready') void town.reload().catch(() => undefined); });
  if (town.status === 'awaiting-captcha') return <Text style={styles.hint}>HOF 인증을 기다리는 중...</Text>;
  if (!town.data) return <LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} label="신전 상세를" />;
  return <View style={styles.section}>
    {town.data.description ? <Text style={styles.hint}>{town.data.description}</Text> : null}
    {town.data.actions.length === 0 ? <Text style={styles.hint}>현재 HOF가 제공하는 동작이 없습니다.</Text> : null}
    <View style={styles.actions}>{town.data.actions.map((action) => <ActionButton key={action.id} label={actionButtonLabel(action)} accessibilityLabel={`${name} ${actionButtonLabel(action)}`} disabled={town.status !== 'ready' || town.data!.complete === false} onPress={() => void town.submit({ actionId: action.id }).catch(() => undefined)} />)}</View>
    {town.status === 'loading' ? <Text style={styles.hint}>최신 상세 확인 중...</Text> : null}
    {town.result ? <TownActionResult result={town.result} /> : null}
    {town.data.complete === false ? <ActionButton label="상세 다시 확인" disabled={false} onPress={() => void town.reload().catch(() => undefined)} /> : null}
    {town.error ? <><Text accessibilityRole="alert" style={styles.error}>{town.error}</Text><ActionButton label="상세 다시 확인" disabled={false} onPress={() => void town.reload().catch(() => undefined)} /></> : null}
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
function ActionButton({ label, accessibilityLabel = label, disabled, onPress }: { label: string; accessibilityLabel?: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, pressed && !disabled && styles.pressed, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, reload, label }: { loading: boolean; error: string | null; reload: () => Promise<unknown>; label: string }) { return <View style={styles.section}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.hint}>{loading ? `${label} 불러오는 중...` : error ?? `${label} 표시할 수 없습니다.`}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void reload().catch(() => undefined)} /> : null}</View>; }
function info(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
function identifyApi(api: TownApi) { const key = api as object; const old = apiKeys.get(key); if (old != null) return old; const next = nextApiKey++; apiKeys.set(key, next); return next; }
const ACTION_LABEL = { CHECK_DOCTRINE: '교리 확인', BUY_PRIEST_ITEM: '사제 아이템 구입', DONATE_FIXED: '정액 기부', DONATE_PERCENT: '비율 기부', DONATE_ITEM: '아이템 기부' } as const;
const styles = StyleSheet.create({
  container: { flex: 1, gap: theme.spacing.md },
  section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  title: { color: theme.colors.text, fontSize: theme.fontSize.section, fontWeight: '900' },
  hint: { fontSize: theme.fontSize.body, color: theme.colors.textMuted, lineHeight: theme.lineHeight.body },
  error: { fontSize: theme.fontSize.body, color: theme.colors.danger, lineHeight: theme.lineHeight.body },
  actions: { gap: theme.spacing.sm },
  button: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    justifyContent: 'center',
    minHeight: theme.control.touch,
    minWidth: theme.control.touch,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.lg,
  },
  buttonText: { fontSize: theme.fontSize.body, lineHeight: theme.lineHeight.body, color: theme.colors.text, fontWeight: '700', textAlign: 'center' },
  pressed: { borderColor: theme.colors.borderStrong, opacity: 0.82 },
  disabled: { opacity: 0.45 },
});
