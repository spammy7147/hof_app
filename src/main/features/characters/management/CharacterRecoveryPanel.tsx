import type { CharacterManagementHubResource } from '../../../domain/characterManagementHubModule';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../../styles/theme';
import type { CharacterOperationJob } from '../../../types/api';

export function CharacterRecoveryPanel({ characterHub }: { characterHub: CharacterManagementHubResource }) {
  const state = characterHub.deepSync;
  const job = state.job;
  const actions = characterHub.actions;
  if (!job && !state.errorMessage) return null;
  const busy = state.recoveryBusy || state.status === 'running';
  const executing = job?.status === 'RUNNING' || job?.status === 'PENDING';
  const restored = job?.recoveryStatus === 'RESTORED';
  const collectionIncomplete = job?.collectionStatus === 'FAILED' || job?.collectionStatus === 'INCOMPLETE';
  const collectionMessage = job?.collectionMessage || (collectionIncomplete ? job?.message : null);
  const errorMessage = restored && (state.errorMessage === job?.message || state.errorMessage === collectionMessage)
    ? null : state.errorMessage;
  const lastStep = job?.deepSync?.progress.at(-1);
  const restoring = job?.recoveryStatus === 'RESTORING' || (executing && job?.collectionStatus === 'FAILED');
  const needsReview = !executing && job && ['REQUIRED', 'RESTORING', 'UNAVAILABLE'].includes(job.recoveryStatus ?? '');
  const canRetry = needsReview && job.recoveryStatus !== 'UNAVAILABLE' && job.canRetryRecovery !== false;
  const preview = state.preview?.jobId === job?.id ? state.preview : null;
  const characterName = characterHub.characters.find((character) => character.id === job?.targetCharacterId)?.name;
  const button = (label: string, action: (() => Promise<void>) | undefined, disabled = false) => action && (
    <Pressable accessible accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(busy || disabled) }} disabled={Boolean(busy || disabled)}
      onPress={() => void action()} style={[styles.button, (busy || disabled) && styles.disabled]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.card}>
      <Text style={styles.title}>전체 설정 동기화{job ? ` #${job.id}${characterName ? ` · ${characterName}` : ''}` : ''}</Text>
      {job && <>
        <Text style={styles.text}>{`수집: ${collectionLabel(job)}`}</Text>
        <Text style={styles.text}>{`원본 복구: ${recoveryLabel(job)}`}</Text>
        {restored && job.collectionStatus === 'COMPLETED' && <Text style={styles.text}>
          전체 설정 동기화를 완료했고 시작 전 설정으로 복원했습니다.
        </Text>}
        {restored && collectionIncomplete && <Text style={styles.text}>
          설정 수집을 완료하지 못했지만 시작 전 설정으로 복원했습니다.
        </Text>}
        {executing && <Text style={styles.note}>서버에서 작업을 진행 중입니다. 아래 버튼으로 최신 상태를 확인할 수 있습니다.</Text>}
        {job.recoveryStatus === 'ACCEPTED' && <Text style={styles.note}>확인한 현재 상태로 작업을 종료했습니다. 자동화는 자동 재개하지 않았습니다.</Text>}
        {collectionMessage && (restored || collectionMessage !== errorMessage) && <Text style={styles.note}>
          {restored ? `이전 수집 실패 사유: ${collectionMessage}` : collectionMessage}
        </Text>}
        {executing && <Text style={styles.note}>
          {restoring ? '시작 전 설정 복원 중' : lastStep?.phase === 'RESTORE' ? '시작 전 설정 복원 확인'
            : lastStep ? `${phaseLabels[lastStep.phase]} · ${lastStep.completedSteps}/${lastStep.totalSteps}` : '작업 시작 중'}
        </Text>}
      </>}
      {errorMessage && <Text accessibilityRole="alert" style={styles.error}>{errorMessage}</Text>}
      {button('작업 상태 다시 확인', actions.checkRecovery)}
      {canRetry && button('보존된 원본으로 복구 재시도', actions.retryRecovery, executing)}
      {needsReview && button('원본 서버의 현재 상태 확인', actions.previewRecovery, executing)}
      {preview && <Modal visible transparent animationType="slide" onRequestClose={actions.dismissRecoveryPreview}>
        <View style={styles.overlay}>
          <View accessibilityViewIsModal style={styles.sheet}>
            <ScrollView contentContainerStyle={styles.previewContent}>
              <Text accessibilityRole="header" style={styles.title}>현재 서버 설정 확인</Text>
              <Text style={styles.text}>{preview.name}</Text>
              <Text style={styles.note}>작업 #{preview.jobId} · {new Date(preview.observedAt).toLocaleString()} 관측</Text>
              <Text style={styles.text}>장비</Text>
              {preview.equipment.length === 0 ? <Text style={styles.note}>장착 장비 없음</Text>
                : preview.equipment.map((item, index) => <Text key={`${item.slot}-${index}`} style={styles.note}>{item.name}</Text>)}
              <Text style={styles.text}>행동 패턴</Text>
              {preview.patterns.map((row) => <Text key={row.index} style={styles.note}>
                {row.index + 1}. {row.judgeText || row.judge} {row.quantityText || row.quantity} → {row.skillText || row.skill}
              </Text>)}
              <Text style={styles.text}>위치 · {positionLabel(preview.positionGuard.selectedPosition)} / 호위 · {preview.positionGuard.guardText || preview.positionGuard.guardValue}</Text>
              <Text style={styles.note}>이 설정을 현재 상태로 수락해 작업을 종료합니다. 최초 설정의 복원 성공으로 기록하지 않으며 자동화를 정지합니다. 수락 시 서버 상태를 다시 확인합니다.</Text>
              {button('이 상태로 종료하고 자동화 정지', actions.acceptRecovery)}
              <Pressable accessible accessibilityRole="button" accessibilityLabel="현재 상태 수락 취소"
                disabled={Boolean(busy)} accessibilityState={{ disabled: Boolean(busy) }}
                style={styles.button} onPress={actions.dismissRecoveryPreview}>
                <Text style={styles.buttonText}>취소</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>}
    </View>
  );
}

function collectionLabel(job: CharacterOperationJob): string {
  const status = job.collectionStatus ?? (job.status === 'COMPLETED' ? 'COMPLETED' : 'UNKNOWN');
  return { NOT_STARTED: '시작 전', INCOMPLETE: '일부 저장됨', COMPLETED: '완료', FAILED: '실패', UNKNOWN: '확인 필요' }[status];
}

function recoveryLabel(job: CharacterOperationJob): string {
  if ((job.status === 'RUNNING' || job.status === 'PENDING') && job.recoveryStatus === 'REQUIRED') {
    return '수집 후 시작 전 설정으로 복원 예정';
  }
  return job.recoveryStatus ? {
    NOT_STARTED: '원격 변경 전', REQUIRED: '복구 필요', RESTORING: '복원 중 · 아직 확인되지 않음',
    RESTORED: '복원 완료', UNAVAILABLE: '원본 없음 · 현재 상태 확인 필요', ACCEPTED: '현재 상태 수락',
  }[job.recoveryStatus] : '확인 정보 없음';
}

function positionLabel(value: string): string {
  return ({ front: '전열', back: '후열' } as Record<string, string>)[value] ?? value;
}

const phaseLabels = { CURRENT: '현재 설정 확인', SAVED_PATTERN: '저장 패턴 수집', EQUIPMENT_PRESET: '장비 저장 수집', RESTORE: '원본 복원 확인', COMPLETED: '전체 작업 완료' };
const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  title: { color: theme.colors.text, fontWeight: '700', fontSize: 16 },
  text: { color: theme.colors.text, fontSize: 14 },
  note: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 20 },
  error: { color: theme.colors.danger, fontSize: 13, lineHeight: 20 },
  button: { borderRadius: 6, padding: 12, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
  buttonText: { color: theme.colors.accentBlue, textAlign: 'center', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  overlay: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: theme.colors.overlay },
  sheet: { maxHeight: '90%', borderRadius: 8, backgroundColor: theme.colors.surface },
  previewContent: { padding: 20, gap: 12 },
});
