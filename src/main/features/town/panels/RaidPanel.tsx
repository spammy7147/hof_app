import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { toUserFacingErrorMessage } from '../../../domain/userFacingErrors';
import { theme } from '../../../styles/theme';
import type { FishingBattleTarget, RaidAction, RaidPubActionRequest, RaidPubResponse, TownActionResultResponse, TownRowResponse } from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownItemList } from '../components/TownItemList';
import { useTownFeature } from '../hooks/useTownFeature';

type Props = { api: TownApi; resolveCaptcha?: () => Promise<void>; onOpenBattle?: (target: FishingBattleTarget) => void };
type ScopedResponse = { apiKey: number; data: RaidPubResponse } | null;
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;
const GLOBAL_ACTIONS = ['REFRESH', 'REWARD', 'WAIT_RESET'] as const satisfies readonly RaidAction[];
const RAID_ACTIONS = ['REGISTER', 'LEAVE', 'START', 'RESET'] as const satisfies readonly RaidAction[];

export function RaidPanel({ api, resolveCaptcha, onOpenBattle }: Props) {
  const apiKey = identifyApi(api);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [responseState, setResponseState] = useState<ScopedResponse>(null);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const staged = useRef<RaidPubResponse | null>(null);
  const responseSequence = useRef(0);
  const registerBlockedRef = useRef(false);
  const zeroReloaded = useRef(false);
  const activeApi = useRef(api); activeApi.current = api;
  const load = useCallback(() => api.load<RaidPubResponse>('/api/town/raid'), [api]);
  const submitAction = useCallback(async (request: RaidPubActionRequest) => {
    const next = await api.submit<RaidPubActionRequest, RaidPubResponse>('/api/town/raid/actions', request);
    if (activeApi.current === api) staged.current = next;
    return next.result ?? info('전투 정보실 상태를 갱신했습니다.');
  }, [api]);
  const town = useTownFeature<RaidPubResponse, RaidPubActionRequest>({ load, submitAction, resolveCaptcha, featureKey: `raidpub-${apiKey}`, describeError: toUserFacingErrorMessage });
  const response = responseState?.apiKey === apiKey ? responseState.data : null;
  const data = response ?? town.data;

  useEffect(() => { responseSequence.current += 1; setResponseState(null); setSelectedId(null); staged.current = null; }, [api]);
  useEffect(() => {
    if (!data) return;
    setLoadedAt(Date.now()); setNow(Date.now()); zeroReloaded.current = false;
    setSelectedId((current) => current && data.raids.some((raid) => raid.id === current) ? current : data.raids.find((raid) => raid.joined)?.id ?? data.raids[0]?.id ?? null);
  }, [data]);

  const hasCountdown = Boolean(data && (positive(data.applyWaitSeconds) || data.raids.some((raid) => positive(raid.waitSeconds))));
  useEffect(() => {
    if (!hasCountdown) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [hasCountdown, data]);
  const elapsed = Math.max(0, Math.floor((now - loadedAt) / 1_000));
  const reachedZero = Boolean(data && [data.applyWaitSeconds, ...data.raids.map((raid) => raid.waitSeconds)]
    .some((seconds) => positive(seconds) && Math.max(0, seconds! - elapsed) === 0));
  const busy = town.status === 'loading' || town.status === 'submitting';
  useEffect(() => {
    if (!reachedZero || busy || zeroReloaded.current) return;
    zeroReloaded.current = true;
    const sequence = ++responseSequence.current;
    void town.reload().then((next) => {
      if (activeApi.current === api && responseSequence.current === sequence) setResponseState({ apiKey, data: next });
    }).catch(() => undefined);
  }, [api, apiKey, busy, reachedZero, town.reload]);

  if (!data) return <LoadState loading={town.status === 'loading'} error={town.error} reload={town.reload} />;
  const selected = data.raids.find((raid) => raid.id === selectedId) ?? null;
  const remaining = (seconds: number | null) => seconds == null ? null : Math.max(0, seconds - elapsed);
  const applyWaitRemaining = remaining(data.applyWaitSeconds);
  const registerBlocked = data.applyWait || (applyWaitRemaining != null && applyWaitRemaining > 0);
  registerBlockedRef.current = registerBlocked;
  const applyWaitMessage = data.applyWait
    ? applyWaitRemaining == null
      ? '레이드 신청 대기 중입니다. 남은 시간은 HOF에서 확인할 수 없습니다.'
      : applyWaitRemaining > 0
        ? `신청 가능까지 ${formatDuration(applyWaitRemaining)}`
        : '레이드 신청 대기 상태를 갱신하고 있습니다.'
    : applyWaitRemaining == null ? null : `신청 가능까지 ${formatDuration(applyWaitRemaining)}`;
  const rows = data.raids.map((raid): TownRowResponse => {
    const wait = remaining(raid.waitSeconds);
    const detail = [raid.difficulty, raid.maxPartySize == null ? null : `${raid.applicants.length}/${raid.maxPartySize}명`, raid.rewardDamage ? `특별 보상 ${raid.rewardDamage}` : null,
      wait != null ? (wait > 0 ? `${formatDuration(wait)} 후 출발` : '출발 가능') : raid.statusText,
      raid.applicants.length ? `신청자 ${raid.applicants.join(', ')}` : '신청자 없음'].filter(Boolean).join(' · ');
    return { id: raid.id, label: raid.name, accessibilityLabel: `${raid.name}${raid.joined ? ' 내가 참가 중' : ''}${raid.playable && !busy ? ' 선택' : ' 선택 불가'}`, detail, imageUrl: null, price: null, quantity: null, selectable: raid.playable && !busy };
  });
  const perform = (action: RaidAction, raidId: string | null) => {
    if (action === 'REGISTER' && registerBlockedRef.current) return;
    const request = { action, raidId };
    const submissionApi = api; staged.current = null;
    responseSequence.current += 1;
    void town.submit(request).then(() => {
      if (activeApi.current !== submissionApi) return;
      responseSequence.current += 1;
      if (staged.current) setResponseState({ apiKey, data: staged.current });
      staged.current = null;
    }).catch(() => undefined);
  };
  const refresh = () => {
    const sequence = ++responseSequence.current;
    void town.reload().then((next) => {
      if (activeApi.current === api && responseSequence.current === sequence) setResponseState({ apiKey, data: next });
    }).catch(() => undefined);
  };
  const battleTarget = selected?.joined
    && selected.battleTarget?.categoryId === 'raid'
    && selected.battleTarget.mapCode.trim().length > 0
    ? selected.battleTarget
    : null;

  return <View style={styles.container}>
    <TownItemList rows={rows} selectionMode="single" selectedIds={selectedId ? [selectedId] : []} onSelectionChange={(ids) => setSelectedId(ids[0] ?? null)}
      header={<View style={styles.section}><Text style={styles.title}>전투 정보실</Text><Text style={styles.hint}>레이드 모집 상태를 확인하고 기존 RAID 전투 화면으로 연결합니다.</Text>
        {data.myStatus ? <Text accessibilityLiveRegion="polite" style={styles.status}>{data.myStatus}</Text> : null}
        {applyWaitMessage ? <Text accessibilityLiveRegion="polite" style={styles.wait}>{applyWaitMessage}</Text> : null}
        <View style={styles.actions}>{GLOBAL_ACTIONS.map((action) => <ActionButton key={action} label={ACTION_LABEL[action]}
          disabled={busy || !data.globalActions.includes(action)} onPress={action === 'REFRESH' ? refresh : () => perform(action, null)} />)}</View>
      </View>}
      footer={<View style={styles.section}>
        {selected ? <><Text style={styles.selectedTitle}>{selected.name}</Text><View style={styles.actions}>
          {RAID_ACTIONS.map((action) => <ActionButton key={action} label={ACTION_LABEL[action]}
            disabled={busy || !selected.actions.includes(action) || action === 'REGISTER' && registerBlocked}
            onPress={() => perform(action, selected.id)} />)}
        </View>{battleTarget && onOpenBattle ? <ActionButton label="RAID 전투 화면 열기" disabled={busy} onPress={() => onOpenBattle(battleTarget)} /> : null}</> : null}
        {data.result ? <TownActionResult result={data.result} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}
      </View>} emptyMessage="현재 표시할 레이드가 없습니다." />
  </View>;
}

function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function LoadState({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => Promise<unknown> }) { return <View style={styles.container}><Text accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.hint}>{loading ? '전투 정보실을 불러오는 중...' : error ?? '전투 정보실 정보가 없습니다.'}</Text>{!loading ? <ActionButton label="다시 시도" disabled={false} onPress={() => void reload().catch(() => undefined)} /> : null}</View>; }
function positive(value: number | null): value is number { return value != null && value > 0; }
function formatDuration(seconds: number) { const safe = Math.max(0, seconds); const hour = Math.floor(safe / 3600); const minute = Math.floor((safe % 3600) / 60); const second = safe % 60; return [hour ? `${hour}시간` : '', minute ? `${minute}분` : '', !hour || (!minute && second) ? `${second}초` : ''].filter(Boolean).join(' '); }
function info(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
function identifyApi(api: TownApi) { const key = api as object; const old = apiKeys.get(key); if (old != null) return old; const next = nextApiKey++; apiKeys.set(key, next); return next; }
const ACTION_LABEL: Record<RaidAction, string> = { REGISTER: '등록', LEAVE: '나오기', START: '전투 시작', RESET: '리셋', REWARD: '보상 확인', WAIT_RESET: '대기 리셋', REFRESH: '갱신' };
const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, section: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, hint: { color: theme.colors.textMuted, lineHeight: 20 }, status: { color: theme.colors.accentGreen, fontWeight: '800' }, wait: { color: theme.colors.accentAmber, fontWeight: '800' }, error: { color: theme.colors.danger, lineHeight: 20 }, selectedTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '900' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }, button: { alignItems: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: 46, minWidth: 110, paddingHorizontal: theme.spacing.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 } });
