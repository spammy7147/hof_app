import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React, { useSyncExternalStore } from 'react';
import { CharacterManagementHubModule, type CharacterManagementHubBackend } from '../../main/domain/characterManagementHubModule';
import type { CharacterOperationJob, CharacterRecoveryPreview } from '../../main/types/api';
import { makeHofCharacterDetail } from '../fixtures/api';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const original = loader._load;
loader._load = (request, parent, isMain) => request === 'react-native' ? {
  View: host('View'), Text: host('Text'), Pressable: host('Pressable'), Modal: host('Modal'), ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(value: T) => value, flatten: (value: unknown) => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean)) : value },
} : original(request, parent, isMain);
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { CharacterRecoveryPanel } = require('../../main/features/characters/management/CharacterRecoveryPanel') as typeof import('../../main/features/characters/management/CharacterRecoveryPanel');
loader._load = original;
afterEach(async () => rntl.cleanup());

function Screen({ hub }: { hub: CharacterManagementHubModule }) {
  const resource = useSyncExternalStore(hub.subscribe, hub.getSnapshot, hub.getSnapshot);
  return React.createElement(CharacterRecoveryPanel, { characterHub: resource });
}

function makeHub(overrides: Partial<CharacterManagementHubBackend>) {
  const hub = new CharacterManagementHubModule({
    loadStoredDetail: async (id) => makeHofCharacterDetail(id),
    refreshAuthoritativeDetail: async (id) => makeHofCharacterDetail(id),
    ...overrides,
  });
  hub.activate('account-1');
  return hub;
}

const job: CharacterOperationJob = {
  id: 91, operationType: 'RESTORE', targetCharacterId: 7, sourceCharacterId: null, status: 'FAILED', recoveryStatus: 'UNAVAILABLE',
  collectionStatus: 'UNKNOWN', canRetryRecovery: false,
  deepSync: { characterId: 7, progress: [] }, transfer: null, message: '복원 원본이 없습니다.',
  updatedAt: '2026-09-07T00:00:00Z', finishedAt: '2026-09-07T00:00:00Z',
};
const preview: CharacterRecoveryPreview = {
  jobId: 91, characterId: 7, confirmationToken: 'preview-token', observedAt: '2026-09-07T00:01:00Z', expiresAt: '2026-09-07T00:06:00Z',
  name: '원본 서버 캐릭터', hofCharacterId: '10',
  patterns: [{ index: 0, judge: '0', judgeText: '항상', quantity: '0', quantityText: '', skill: '9564', skillText: '장비 스킬' }],
  equipment: [{ slot: 'weapon', part: 'Weapon', name: '복원 검', iconUrl: '', description: '', checked: false }],
  positionGuard: { positions: [], selectedPosition: 'front', guardValue: '1', guardText: '호위' },
};

describe('캐릭터 복구 화면', () => {
  it('보관함만 있는 계정에서도 원본 부재를 알리고 최신 상태를 확인한 후 명시적으로 종료한다', async () => {
    const calls: unknown[] = [];
    const hub = makeHub({
      loadCurrentOperation: async () => job,
      previewRecovery: async (id) => { calls.push(['preview', id]); return preview; },
      acceptRecovery: async (id, token) => { calls.push(['accept', id, token]); return { ...job, status: 'STOPPED', recoveryStatus: 'ACCEPTED' }; },
    });
    await rntl.render(React.createElement(Screen, { hub }));
    await rntl.screen.findByText('원본 복구: 원본 없음 · 현재 상태 확인 필요');
    assert.equal(rntl.screen.queryByRole('button', { name: '보존된 원본으로 복구 재시도' }), null);
    assert.equal(rntl.screen.queryByRole('button', { name: '이 상태로 종료하고 자동화 정지' }), null);
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '원본 서버의 현재 상태 확인' }));
    assert.ok(rntl.screen.getByText('원본 서버 캐릭터'));
    assert.ok(rntl.screen.getByText('복원 검'));
    assert.ok(rntl.screen.getByText(/항상.*장비 스킬/));
    assert.deepEqual(calls, [['preview', 91]]);
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '이 상태로 종료하고 자동화 정지' }));
    assert.deepEqual(calls, [['preview', 91], ['accept', 91, 'preview-token']]);
    assert.ok(rntl.screen.getByText('원본 복구: 현재 상태 수락'));
    assert.equal(rntl.screen.queryByRole('button', { name: '이 상태로 종료하고 자동화 정지' }), null);
  });

  it('수집 실패와 원본 복원 완료를 구분하고 같은 복구를 다시 제안하지 않는다', async () => {
    const failed = { ...job, recoveryStatus: 'REQUIRED' as const, canRetryRecovery: true, collectionStatus: 'FAILED' as const };
    const hub = makeHub({
      loadCurrentOperation: async () => failed,
      retryRecovery: async (id, onJob) => {
        assert.equal(id, job.id);
        onJob({ ...failed, recoveryStatus: 'RESTORED', canRetryRecovery: false });
        throw new Error('저장 슬롯 수집 실패');
      },
    });
    await rntl.render(React.createElement(Screen, { hub }));
    const button = await rntl.screen.findByRole('button', { name: '보존된 원본으로 복구 재시도' });
    await rntl.fireEvent.press(button);
    assert.ok(rntl.screen.getByText('수집: 실패'));
    assert.ok(rntl.screen.getByText('원본 복구: 복원 완료'));
    assert.equal(rntl.screen.queryByRole('button', { name: '보존된 원본으로 복구 재시도' }), null);
    assert.ok(rntl.screen.getByRole('button', { name: '작업 상태 다시 확인' }));
  });
});
