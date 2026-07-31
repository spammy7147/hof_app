import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../styles/theme';
import type { HomeActionRequest, HomeResponse, TownActionResultResponse, TownRowResponse } from '../../../types/api';
import type { TownApi } from '../api/townApi';
import { TownActionResult } from '../components/TownActionResult';
import { TownConfirmSheet } from '../components/TownConfirmSheet';
import { TownItemList } from '../components/TownItemList';
import { TownMutationBusyError, useTownFeature } from '../hooks/useTownFeature';

type Mode = 'home' | 'rest';

export function HomePanel({ api, mode, resolveCaptcha }: { api: TownApi; mode: Mode; resolveCaptcha?: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [response, setResponse] = useState<HomeResponse | null>(null);
  const staged = useRef<HomeResponse | null>(null);
  const path = mode === 'home' ? '/api/town/home' as const : '/api/town/rest' as const;
  const apiKey = identifyApi(api);
  const load = useCallback(() => api.load<HomeResponse>(path), [api, path]);
  const submitAction = useCallback(async (request: HomeActionRequest) => {
    const next = await api.submit<HomeActionRequest, HomeResponse>(mode === 'home' ? '/api/town/home/quests' : '/api/town/rest/restore', request);
    staged.current = next;
    return next.result ?? information(mode === 'home' ? '자택 퀘스트 상태를 갱신했습니다.' : '휴식처 복구 action을 실행했습니다.');
  }, [api, mode]);
  const town = useTownFeature<HomeResponse, HomeActionRequest>({ load, submitAction, resolveCaptcha, featureKey: `home-${apiKey}-${mode}` });
  const data = response ?? town.data;
  useEffect(() => { staged.current = null; setResponse(null); setSelectedId(null); setConfirmation(null); }, [api, mode]);
  useEffect(() => {
    if (selectedId && data && !rowsOf(data).some((row) => row.id === selectedId)) setSelectedId(null);
  }, [data, selectedId]);
  if (!data) return <View style={styles.container}><Text accessibilityRole={town.error ? 'alert' : undefined} style={town.error ? styles.error : styles.hint}>{town.status === 'loading' ? '정보를 불러오는 중...' : town.error ?? '표시할 정보가 없습니다.'}</Text><ActionButton label="다시 시도" disabled={town.status === 'loading'} onPress={() => void town.reload().catch(() => undefined)} /></View>;
  const selectedQuest = data.quests.find((quest) => `quest:${quest.id}` === selectedId);
  const selectedAction = data.actions.find((action) => `action:${action.id}` === selectedId);
  const actionId = selectedQuest?.actionId ?? selectedAction?.id ?? null;
  const label = selectedQuest?.state === 'AVAILABLE' ? '수락' : selectedQuest?.state === 'CLAIMABLE' ? '완료' : selectedAction?.type === 'RESTORE' ? '복구' : null;
  const finish = (result: TownActionResultResponse) => { if (staged.current) setResponse(staged.current); staged.current = null; setSelectedId(null); setConfirmation(null); return result; };
  const submit = () => { if (!confirmation) return; void town.submit({ actionId: confirmation }).then(finish).catch((error: unknown) => { if (!(error instanceof TownMutationBusyError)) setConfirmation(null); }); };
  return <View style={styles.container}>
    <Text style={styles.title}>{mode === 'home' ? '자택 관리' : '휴식처'}</Text>
    {mode === 'rest' ? <Text style={styles.hint}>자동 반복 없이 HOF가 현재 제공하는 복구 action만 한 번 실행합니다.</Text> : <Text style={styles.hint}>자택 퀘스트는 수락 → 조건 달성 → 완료 순서로 표시됩니다.</Text>}
    <TownItemList rows={rowsOf(data)} selectionMode="single" selectedIds={selectedId ? [selectedId] : []} onSelectionChange={(ids) => setSelectedId(ids[0] ?? null)} emptyMessage={mode === 'home' ? '표시할 자택 퀘스트가 없습니다.' : '현재 사용할 수 있는 복구 action이 없습니다.'}
      footer={<View style={styles.footer}>{actionId && label ? <ActionButton label={label} disabled={town.status === 'submitting'} onPress={() => setConfirmation(actionId)} /> : <Text style={styles.hint}>{mode === 'home' ? '수락 또는 완료 가능한 퀘스트를 선택하세요.' : '사용 가능한 복구 action을 선택하세요.'}</Text>}{data.result || town.result ? <TownActionResult result={data.result ?? town.result!} onRefresh={() => { setResponse(null); void town.reload().catch(() => undefined); }} /> : null}{town.error ? <Text accessibilityRole="alert" style={styles.error}>{town.error}</Text> : null}</View>} />
    <TownConfirmSheet visible={confirmation != null} title={`${label ?? 'action'} 확인`} message="HOF에 이 action을 한 번 요청합니다. 자동 반복하지 않습니다." confirmLabel={label ?? '실행'} submitting={town.status === 'submitting'} details={[{ label: mode === 'home' ? '퀘스트' : '복구', value: selectedQuest?.name ?? selectedAction?.label ?? '선택 없음' }]} onCancel={() => setConfirmation(null)} onConfirm={submit} />
  </View>;
}

function rowsOf(data: HomeResponse): TownRowResponse[] { return data.mode === 'HOME' ? data.quests.map((quest) => ({ id: `quest:${quest.id}`, label: quest.name, accessibilityLabel: `${quest.name} ${stateLabel(quest.state)}`, selectable: quest.actionId != null && (quest.state === 'AVAILABLE' || quest.state === 'CLAIMABLE'), detail: [stateLabel(quest.state), quest.mission, quest.reward ? `보상 ${quest.reward}` : null].filter(Boolean).join(' · '), imageUrl: null, price: null, quantity: null })) : data.actions.map((action) => ({ id: `action:${action.id}`, label: action.label, accessibilityLabel: `${action.label} 선택`, selectable: action.type === 'RESTORE', detail: '수동 복구 action', imageUrl: null, price: null, quantity: null })); }
function stateLabel(state: HomeResponse['quests'][number]['state']) { return ({ AVAILABLE: '수락 가능', ACTIVE: '조건 달성 중', CLAIMABLE: '완료 가능', COMPLETED: '완료', WAITING: '대기 중' } as const)[state]; }
function information(message: string): TownActionResultResponse { return { status: 'INFORMATIONAL', messages: [message], items: [], refreshRequired: true }; }
const apiKeys = new WeakMap<object, number>(); let nextApiKey = 1;
function identifyApi(api: TownApi) { const object = api as object; const known = apiKeys.get(object); if (known != null) return known; const next = nextApiKey++; apiKeys.set(object, next); return next; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({ container: { flex: 1, gap: theme.spacing.md }, title: { color: theme.colors.text, fontSize: 20, fontWeight: '900' }, hint: { color: theme.colors.textMuted, lineHeight: 20 }, error: { color: theme.colors.danger, lineHeight: 20 }, footer: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md }, button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentGreen, borderRadius: theme.radius.md }, buttonText: { color: theme.colors.background, fontWeight: '900' }, disabled: { opacity: 0.45 } });
