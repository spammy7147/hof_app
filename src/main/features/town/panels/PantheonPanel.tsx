import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
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
type ShrineSelection = { apiKey: number; shrineId: string } | null;
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;

export function PantheonPanel({ api, resolveCaptcha }: Props) {
  const apiKey = identifyApi(api);
  const [selection, setSelection] = useState<ShrineSelection>(null);
  const selected = selection?.apiKey === apiKey ? selection.shrineId : null;
  const load = useCallback(() => api.load<PantheonStreetResponse>('/api/town/pantheon'), [api]);
  const town = useTownFeature<PantheonStreetResponse>({ load, resolveCaptcha, featureKey: `pantheon-street-${apiKey}`, describeError: toUserFacingErrorMessage });
  useEffect(() => setSelection(null), [api]);

  if (selected) return <PantheonDetail key={`${apiKey}-${selected}`} api={api} apiKey={apiKey} shrineId={selected} resolveCaptcha={resolveCaptcha} onBack={() => setSelection(null)} />;
  if (!town.data) return <LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} label="신전 거리를" />;
  const rows = town.data.shrines.map((shrine): TownRowResponse => ({
    id: shrine.id,
    label: shrine.name,
    accessibilityLabel: `${shrine.name}${shrine.alias ? ` ${shrine.alias}` : ''} 상세 보기`,
    detail: [shrine.alias, shrine.color ? `HOF 표시 색상 ${shrine.color}` : null].filter(Boolean).join(' · '),
    imageUrl: shrine.imageUrl,
    price: null,
    quantity: null,
    selectable: true,
  }));
  return <View style={styles.container}>
    <TownItemList rows={rows} selectionMode="single" selectedIds={[]} onSelectionChange={(ids) => setSelection(ids[0] ? { apiKey, shrineId: ids[0] } : null)}
      header={<View style={styles.section}><Text style={styles.title}>신전 거리</Text><Text style={styles.hint}>신전을 선택하면 HOF에서 현재 제공하는 정보와 동작만 표시합니다. 색상은 보조 정보입니다.</Text></View>}
      footer={town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
      emptyMessage="현재 확인할 수 있는 신전이 없습니다." />
  </View>;
}

function PantheonDetail({ api, apiKey, shrineId, resolveCaptcha, onBack }: { api: TownApi; apiKey: number; shrineId: string; resolveCaptcha?: () => Promise<void>; onBack: () => void }) {
  const [confirm, setConfirm] = useState<PantheonActionResponse | null>(null);
  const [response, setResponse] = useState<PantheonDetailResponse | null>(null);
  const staged = useRef<PantheonDetailResponse | null>(null);
  const activeApi = useRef(api); activeApi.current = api;
  const load = useCallback(() => api.load<PantheonDetailResponse>(`/api/town/pantheon/${encodeURIComponent(shrineId)}`), [api, shrineId]);
  const submitAction = useCallback(async (request: PantheonActionRequest) => {
    const next = await api.submit<PantheonActionRequest, PantheonDetailResponse>(`/api/town/pantheon/${encodeURIComponent(shrineId)}/actions`, request);
    if (activeApi.current === api) staged.current = next;
    return next.result ?? info('신전 상태를 갱신했습니다.');
  }, [api, shrineId]);
  const town = useTownFeature<PantheonDetailResponse, PantheonActionRequest>({ load, submitAction, resolveCaptcha, featureKey: `pantheon-detail-${apiKey}-${shrineId}`, describeError: toUserFacingErrorMessage });
  const data = response ?? town.data;
  const busy = town.status === 'loading' || town.status === 'submitting';
  useEffect(() => { setConfirm(null); setResponse(null); staged.current = null; }, [api, shrineId]);
  if (!data) return <View style={styles.container}><BackButton onPress={onBack} /><LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} label="신전 상세를" /></View>;

  const perform = () => {
    if (!confirm) return;
    const submissionApi = api; staged.current = null;
    void town.submit({ actionId: confirm.id }).then(() => {
      if (activeApi.current !== submissionApi) return;
      if (staged.current) setResponse(staged.current);
      staged.current = null; setConfirm(null);
    }).catch((error: unknown) => { if (!(error instanceof TownMutationBusyError) && activeApi.current === submissionApi) setConfirm(null); });
  };
  const details = confirm ? confirmDetails(confirm) : [];
  return <View style={styles.container}>
    <TownItemList rows={[]} header={<View style={styles.section}>
      <BackButton onPress={onBack} />
      <Text style={styles.title}>{data.name}</Text>
      {data.alias ? <Text style={styles.alias}>{data.alias}</Text> : null}
      {data.imageUrl ? <Image accessible={false} source={{ uri: data.imageUrl }} style={styles.heroImage} contentFit="cover" /> : null}
      {data.description ? <Text style={styles.description}>{data.description}</Text> : null}
      <Meta label="섬기는 신" value={data.deity} />
      <Meta label="성향" value={data.alignment} />
      <Meta label="영역" value={data.domains.join(' / ') || null} />
      <Meta label="관계" value={data.relation} />
      <Meta label="현재 작업" value={data.currentJob} />
      <Text style={styles.actionTitle}>현재 가능한 동작</Text>
      <View style={styles.actions}>{data.actions.map((action) => <ActionButton key={action.id} label={ACTION_LABEL[action.type]} accessibilityLabel={`${ACTION_LABEL[action.type]}${summary(action) ? ` ${summary(action)}` : ''}`} disabled={busy} onPress={() => setConfirm(action)} />)}</View>
      {data.actions.length === 0 ? <Text style={styles.hint}>현재 HOF가 제공하는 동작이 없습니다.</Text> : null}
    </View>} footer={<View style={styles.section}>{data.result ? <TownActionResult result={data.result} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}</View>} emptyMessage={null} />
    <TownConfirmSheet visible={confirm != null} title={`${confirm ? ACTION_LABEL[confirm.type] : ''} 확인`} message="HOF 서버에 이 동작을 한 번 요청합니다." confirmLabel={confirm ? ACTION_LABEL[confirm.type] : '실행'} destructive={confirm?.type !== 'CHECK_DOCTRINE'} submitting={town.status === 'submitting'} details={details} onCancel={() => setConfirm(null)} onConfirm={perform} />
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
function Meta({ label, value }: { label: string; value: string | null }) { return value ? <View style={styles.metaRow}><Text style={styles.metaLabel}>{label}</Text><Text style={styles.metaValue}>{value}</Text></View> : null; }
function BackButton({ onPress }: { onPress: () => void }) { return <ActionButton label="신전 목록으로" accessibilityLabel="신전 목록으로 돌아가기" disabled={false} onPress={onPress} />; }
function ActionButton({ label, accessibilityLabel = label, disabled, onPress }: { label: string; accessibilityLabel?: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, reload, label }: { loading: boolean; error: string | null; reload: () => Promise<unknown>; label: string }) { return <View style={styles.section}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.hint}>{loading ? `${label} 불러오는 중...` : error ?? `${label} 표시할 수 없습니다.`}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void reload().catch(() => undefined)} /> : null}</View>; }
function info(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
function identifyApi(api: TownApi) { const key = api as object; const old = apiKeys.get(key); if (old != null) return old; const next = nextApiKey++; apiKeys.set(key, next); return next; }
const ACTION_LABEL = { CHECK_DOCTRINE: '교리 확인', BUY_PRIEST_ITEM: '사제 아이템 구입', DONATE_FIXED: '정액 기부', DONATE_PERCENT: '비율 기부', DONATE_ITEM: '아이템 기부' } as const;
const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, alias: { color: theme.colors.textMuted, fontWeight: '700' }, heroImage: { borderRadius: theme.radius.md, height: 180, width: '100%' }, hint: { color: theme.colors.textMuted, lineHeight: 20 }, description: { color: theme.colors.text, lineHeight: 21 }, error: { color: theme.colors.danger, lineHeight: 20 }, metaRow: { flexDirection: 'row', gap: theme.spacing.sm }, metaLabel: { color: theme.colors.textMuted, fontWeight: '700', minWidth: 72 }, metaValue: { color: theme.colors.text, flex: 1 }, actionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '900', marginTop: theme.spacing.sm }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }, button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 46, minWidth: 110, paddingHorizontal: theme.spacing.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 } });
