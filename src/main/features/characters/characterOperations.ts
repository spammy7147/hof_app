import type { ManualSequenceApi, ManualSequenceRequests } from '../../services/backendApi';
import type {
  CharacterDeepSyncResponse,
  CharacterOperationJob,
  CharacterTransferExecutionResult,
  CharacterTransferPreviewRequest,
  HofCharacter,
} from '../../types/api';

/** 작업 상태·진행도·완료 결과는 캐릭터 기능이 해석한다. */
export function deepSyncCharacter(
  api: ManualSequenceApi,
  characterId: number,
  onProgress?: (progress: CharacterDeepSyncResponse) => void,
): Promise<CharacterDeepSyncResponse> {
  return api.runManualSequence(async (requests) => {
    const started = await requests.startDeepSync(characterId);
    const completed = await pollCharacterOperation(requests, started, (job) => {
      if (job.deepSync) onProgress?.(job.deepSync);
    });
    if (!completed.deepSync) throw new Error('전체 설정 동기화 결과를 확인하지 못했습니다.');
    return completed.deepSync;
  });
}

export function restoreCharacter(
  api: ManualSequenceApi,
  characterId: number,
  onProgress?: (progress: CharacterDeepSyncResponse) => void,
): Promise<HofCharacter[]> {
  return api.runManualSequence(async (requests) => {
    const started = await requests.startRestore(characterId);
    await pollCharacterOperation(requests, started, (job) => {
      if (job.deepSync) onProgress?.(job.deepSync);
    });
    return requests.listCharacters();
  });
}

export function executeCharacterTransfer(
  api: ManualSequenceApi,
  request: CharacterTransferPreviewRequest,
  completedStepIds: string[] = [],
  onProgress?: (progress: CharacterTransferExecutionResult) => void,
): Promise<CharacterTransferExecutionResult> {
  return api.runManualSequence(async (requests) => {
    const started = await requests.startTransfer(request, completedStepIds);
    const completed = await pollCharacterOperation(requests, started, (job) => {
      if (job.transfer) onProgress?.(job.transfer);
    });
    if (!completed.transfer) throw new Error('설정 가져오기 결과를 확인하지 못했습니다.');
    return completed.transfer;
  });
}

async function pollCharacterOperation(
  requests: ManualSequenceRequests,
  initial: CharacterOperationJob,
  onProgress: (job: CharacterOperationJob) => void,
): Promise<CharacterOperationJob> {
  let current = initial;
  for (;;) {
    requests.assertCurrent();
    onProgress(current);
    requests.assertCurrent();
    if (current.status === 'COMPLETED') return current;
    if (current.status === 'FAILED' || current.status === 'STOPPED') {
      throw new Error(current.message || '캐릭터 작업을 완료하지 못했습니다.');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    current = await requests.fetchOperation(current.id);
  }
}
