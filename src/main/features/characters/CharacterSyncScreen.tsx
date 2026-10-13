import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CharacterManagementHubResource } from '../../domain/characterManagementHubModule';
import { operationNeedsAttention } from '../../domain/characterManagementHubModule';
import type { CharacterSyncJobResponse } from '../../types/api';
import { theme } from '../../styles/theme';
import { toUserFacingErrorMessage } from '../../domain/userFacingErrors';
import { characterSyncTitle } from '../../domain/characterSyncJobs';
import { CharacterRecoveryPanel } from './management/CharacterRecoveryPanel';

export type CharacterSyncControls = {
  characterSyncLabel?: string | null;
  characterSyncJob?: CharacterSyncJobResponse | null;
  characterSyncError?: string | null;
  characterRosterResult?: string | null;
  characterRosterError?: string | null;
  onSyncCharacterRoster?: () => Promise<void>;
  onStartCharacterFullSync?: () => Promise<void>;
  onStartCharacterDeepSync?: () => Promise<void>;
  onStopCharacterSync?: () => Promise<void>;
  onResumeCharacterSync?: () => Promise<void>;
  onCheckCharacterSync?: () => Promise<void>;
};

/** 화면 표시만 소유한다. 닫아도 계정의 동기화·복구 실행과 배경 화면은 유지한다. */
export function CharacterSyncControl({ characterHub, ...sync }: CharacterSyncControls & {
  characterHub: CharacterManagementHubResource;
}) {
  const [open, setOpen] = useState(false);
  const state = characterHub.deepSync;
  const job = state.job;
  const fullJob = sync.characterSyncJob;
  const executing = job?.status === 'RUNNING' || job?.status === 'PENDING';
  const recoveryRequired = !executing && operationNeedsAttention(job);
  const failed = Boolean(fullJob?.failedCharacterIds.length) || sync.characterRosterError || sync.characterSyncError || state.errorMessage || fullJob?.status === 'failed'
    || (!executing && job?.recoveryStatus !== 'ACCEPTED'
      && (job?.status === 'FAILED' || job?.collectionStatus === 'INCOMPLETE' || job?.collectionStatus === 'FAILED'));
  const running = executing || state.status === 'running' || state.recoveryBusy
    || sync.characterSyncLabel || fullJob?.status === 'running' || fullJob?.status === 'pending';
  const stopped = fullJob?.status === 'stopped' || (job?.status === 'STOPPED' && job.recoveryStatus !== 'ACCEPTED');
  const indicator = recoveryRequired || failed ? '!' : running ? '↻' : stopped ? 'Ⅱ' : '';
  const description = recoveryRequired ? '복구 필요' : failed ? '확인 필요' : running ? '진행 중' : stopped ? '중지됨' : '';
  const target = characterHub.selectedCharacter;
  const busy = Boolean(sync.characterSyncLabel) || fullJob?.status === 'running' || fullJob?.status === 'pending';
  const deepBusy = state.status === 'running' || state.recoveryBusy || operationNeedsAttention(job);
  const completedCharacterName = characterHub.characters.find((item) => item.id === job?.targetCharacterId)?.name;
  const fullNeedsDetail = Boolean(fullJob && (fullJob.status !== 'completed' || fullJob.failedCharacterIds.length > 0))
    || Boolean(sync.characterSyncLabel || sync.characterSyncError);
  const deepNeedsDetail = Boolean(executing || recoveryRequired || state.errorMessage || state.recoveryBusy
    || state.status === 'running' || (job && job.status !== 'COMPLETED' && job.recoveryStatus !== 'ACCEPTED'));
  // 전체 작업의 자식이 바뀌는 동안에도 복구가 필요한 현재 작업을 놓치지 않는다.
  useEffect(() => {
    if (!open || fullJob?.syncMode !== 'DEEP') return;
    void characterHub.actions.checkRecovery?.();
  }, [open, fullJob?.jobId, fullJob?.syncedCount, fullJob?.status, fullJob?.syncMode]);
  const close = () => {
    characterHub.actions.dismissRecoveryPreview?.();
    setOpen(false);
  };

  return <>
    <Pressable accessible accessibilityRole="button"
      accessibilityLabel={description ? `동기화 · ${description}` : '동기화'}
      onPress={() => {
        setOpen(true);
        void characterHub.actions.checkRecovery?.();
        void sync.onCheckCharacterSync?.();
      }} style={styles.trigger}>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.triggerText}>동기화</Text>
      <Text accessible={false} style={[styles.indicator, (recoveryRequired || Boolean(failed)) && styles.warning]}>{indicator}</Text>
    </Pressable>
    {open && <Modal visible animationType="slide" onRequestClose={() => {
      if (state.preview) characterHub.actions.dismissRecoveryPreview?.();
      else close();
    }}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
        <View style={styles.header}>
          <Pressable accessible accessibilityRole="button" accessibilityLabel="동기화 화면 닫기" onPress={close} style={styles.back}>
            <Text style={styles.triggerText}>뒤로</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>동기화</Text>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {target ? <View style={styles.card}>
            <Text style={styles.title}>{target.name}</Text>
            <Text style={styles.text}>현재 설정과 저장 패턴·장비 저장 1·2를 수집하고 시작 전 설정으로 복원합니다.</Text>
            <SyncAction label="전체 설정 동기화" disabled={Boolean(deepBusy || busy)} action={characterHub.actions.deepSync} />
          </View> : <View style={styles.card}>
            <Text style={styles.title}>전체 캐릭터</Text>
            <Text style={styles.text}>목록 동기화는 캐릭터 목록을, 전체 상세 동기화는 각 캐릭터의 상세 정보를 갱신합니다.</Text>
            <SyncAction label="목록 동기화" disabled={Boolean(busy || deepBusy || fullJob?.status === 'stopped')} action={sync.onSyncCharacterRoster} />
            <SyncAction label="전체 상세 동기화" disabled={Boolean(busy || deepBusy || fullJob?.status === 'stopped')} action={sync.onStartCharacterFullSync} />
            <Text style={styles.text}>전체 설정 동기화는 모든 캐릭터의 저장 패턴과 장비 저장까지 수집한 뒤 각 캐릭터의 시작 전 설정을 복원합니다.</Text>
            <SyncAction label="전체 캐릭터 설정 동기화" disabled={Boolean(busy || deepBusy || fullJob?.status === 'stopped')} action={sync.onStartCharacterDeepSync} />
            {sync.characterRosterResult && <Text style={styles.text}>{sync.characterRosterResult}</Text>}
            {sync.characterRosterError && <Text accessibilityRole="alert" style={styles.warning}>{sync.characterRosterError}</Text>}
          </View>}
          {fullNeedsDetail && <View style={styles.card}>
            <Text style={styles.title}>동기화 진행 상황</Text>
            {sync.characterSyncLabel && <Text style={styles.text}>{sync.characterSyncLabel}</Text>}
            {fullJob && <>
              <Text style={styles.text}>{`${characterSyncTitle(fullJob.syncMode)} · ${fullSyncLabels[fullJob.status]}`}</Text>
              <Text style={styles.text}>{`${fullJob.syncedCount}/${fullJob.rosterCount}`}</Text>
              {fullJob.failedCharacterIds.length > 0 && <Text style={styles.warning}>{`수집 실패 ${fullJob.failedCharacterIds.length}명`}</Text>}
              {fullJob.message && <Text style={styles.text}>{fullJob.message}</Text>}
              {busy && <SyncAction label="현재 캐릭터 후 중지" action={sync.onStopCharacterSync} />}
              {fullJob.status === 'stopped' && <SyncAction label="이어하기" action={sync.onResumeCharacterSync} />}
            </>}
            {sync.characterSyncError && <Text accessibilityRole="alert" style={styles.warning}>{sync.characterSyncError}</Text>}
            <SyncAction label="동기화 상태 다시 확인" action={sync.onCheckCharacterSync} />
          </View>}
          {fullJob?.status === 'completed' && !fullNeedsDetail && <Text style={styles.note}>
            {`${characterSyncTitle(fullJob.syncMode)} 완료 · ${fullJob.syncedCount}/${fullJob.rosterCount}`}
          </Text>}
          {!job && state.status === 'running' && <Text style={styles.text}>전체 설정 동기화를 시작하고 있습니다.</Text>}
          {deepNeedsDetail && <CharacterRecoveryPanel characterHub={characterHub} />}
          {!deepNeedsDetail && job?.status === 'COMPLETED' && !busy && <Text style={styles.note}>
            {`최근 캐릭터 설정 동기화 완료${completedCharacterName ? ` · ${completedCharacterName}` : ''} · 원래 설정 복원됨`}
          </Text>}
          <Text style={styles.note}>화면을 닫아도 진행 중인 동기화와 원본 복구는 계속됩니다.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>}
  </>;
}

function SyncAction({ label, action, disabled = false }: {
  label: string;
  action?: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!action) return null;
  return <><Pressable accessible accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: disabled || submitting }} disabled={disabled || submitting}
    onPress={() => {
      if (disabled || submitting) return;
      setSubmitting(true);
      setError(null);
      void action().catch((cause: unknown) => setError(toUserFacingErrorMessage(cause))).finally(() => setSubmitting(false));
    }} style={[styles.action, (disabled || submitting) && styles.disabled]}>
    <Text style={styles.actionText}>{label}</Text>
  </Pressable>{error && <Text accessibilityRole="alert" style={styles.warning}>{error}</Text>}</>;
}

const fullSyncLabels = { pending: '준비 중', running: '진행 중', stopped: '중지됨', completed: '완료', failed: '실패' };
const styles = StyleSheet.create({
  trigger: { width: 104, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: theme.colors.surfaceAlt },
  triggerText: { color: theme.colors.text, fontWeight: '800', fontSize: 14 },
  indicator: { width: 20, textAlign: 'center', color: theme.colors.accentGreen, fontWeight: '900', fontSize: 17 },
  warning: { color: theme.colors.accentAmber },
  screen: { flex: 1, backgroundColor: theme.colors.background },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  back: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '800' },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  card: { backgroundColor: theme.colors.surface, padding: 16, gap: 12, borderRadius: 10 },
  text: { color: theme.colors.text, fontSize: 14, lineHeight: 21 },
  note: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 20 },
  action: { minHeight: 44, padding: 12, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt },
  actionText: { color: theme.colors.accentBlue, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
