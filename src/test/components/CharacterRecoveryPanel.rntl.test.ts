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
  it('일부 슬롯을 수집하는 동안에는 현재 수집 단계를 표시한다', async () => {
    const collecting: CharacterOperationJob = {
      ...job, status: 'RUNNING', collectionStatus: 'INCOMPLETE', recoveryStatus: 'REQUIRED', message: null,
      deepSync: { characterId: 7, progress: [{ phase: 'SAVED_PATTERN', completedSteps: 3, totalSteps: 11, patternSlotCode: '1', equipmentSlotNumber: null }] },
    };
    await rntl.render(React.createElement(Screen, { hub: makeHub({ loadCurrentOperation: async () => collecting }) }));
    assert.ok(await rntl.screen.findByText('저장 패턴 수집 · 3/11'));
    assert.equal(rntl.screen.queryByText('시작 전 설정 복원 중'), null);
    assert.ok(rntl.screen.queryByText('원본 복구: 복구 필요') === null);
    assert.ok(rntl.screen.queryByRole('button', { name: '보존된 원본으로 복구 재시도' }) === null);
  });

  it('수집과 복구가 완료되면 완료 요약만 표시한다', async () => {
    const completed: CharacterOperationJob = {
      ...job, status: 'COMPLETED', collectionStatus: 'COMPLETED', recoveryStatus: 'RESTORED', message: null,
      deepSync: { characterId: 7, progress: [{ phase: 'COMPLETED', completedSteps: 11, totalSteps: 11, patternSlotCode: null, equipmentSlotNumber: null }] },
    };
    await rntl.render(React.createElement(Screen, { hub: makeHub({ loadCurrentOperation: async () => completed }) }));
    assert.ok(await rntl.screen.findByText('전체 설정 동기화를 완료했고 시작 전 설정으로 복원했습니다.'));
    assert.equal(rntl.screen.queryByText(/11\/11/), null);
    assert.equal(rntl.screen.queryByRole('alert'), null);
  });

  it('복구 재시도는 이전 수집 진행과 분리해 복원 중으로 표시한다', async () => {
    const restoring: CharacterOperationJob = {
      ...job, status: 'RUNNING', collectionStatus: 'FAILED', recoveryStatus: 'RESTORING',
      deepSync: { characterId: 7, progress: [
        { phase: 'EQUIPMENT_PRESET', completedSteps: 9, totalSteps: 11, patternSlotCode: null, equipmentSlotNumber: 1 },
        { phase: 'CURRENT', completedSteps: 1, totalSteps: 11, patternSlotCode: null, equipmentSlotNumber: null },
      ] },
    };
    await rntl.render(React.createElement(Screen, { hub: makeHub({ loadCurrentOperation: async () => restoring }) }));
    assert.ok(await rntl.screen.findByText('시작 전 설정 복원 중'));
    assert.equal(rntl.screen.queryByText(/\d+\/11/), null);
  });

  it('복구 완료 뒤 새로 발생한 조회 오류는 계속 알린다', async () => {
    let requests = 0;
    const hub = makeHub({ loadCurrentOperation: async () => {
      if (++requests > 1) throw new Error('네트워크 연결을 확인해 주세요.');
      return { ...job, recoveryStatus: 'RESTORED', collectionStatus: 'FAILED', message: '이전 수집 실패' };
    } });
    await rntl.render(React.createElement(Screen, { hub }));
    await rntl.screen.findByText('원본 복구: 복원 완료');
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '작업 상태 다시 확인' }));
    assert.ok(rntl.screen.getByRole('alert'));
    assert.ok(rntl.screen.getByText('네트워크 연결을 확인해 주세요.'));
  });

  it('복구된 실패 이력은 최종 결과와 과거 사유로 표시하고 진행 분수를 숨긴다', async () => {
    const reason = '원본 서버의 설정이 예상한 작업 상태와 다릅니다. 외부 변경 가능성이 있어 자동 복원을 중단했습니다.';
    const restored: CharacterOperationJob = {
      ...job, operationType: 'DEEP_SYNC', recoveryStatus: 'RESTORED', collectionStatus: 'FAILED',
      message: reason, collectionMessage: reason,
      deepSync: { characterId: 7, progress: [
        { phase: 'EQUIPMENT_PRESET', completedSteps: 9, totalSteps: 11, patternSlotCode: null, equipmentSlotNumber: 1 },
        { phase: 'CURRENT', completedSteps: 1, totalSteps: 11, patternSlotCode: null, equipmentSlotNumber: null },
        { phase: 'RESTORE', completedSteps: 2, totalSteps: 11, patternSlotCode: null, equipmentSlotNumber: null },
      ] },
    };
    const hub = makeHub({ loadCurrentOperation: async () => restored });
    await rntl.render(React.createElement(Screen, { hub }));

    assert.ok(await rntl.screen.findByText('설정 수집을 완료하지 못했지만 시작 전 설정으로 복원했습니다.'));
    assert.ok(rntl.screen.getByText(`이전 수집 실패 사유: ${reason}`));
    assert.equal(rntl.screen.queryByRole('alert'), null);
    assert.equal(rntl.screen.queryByText(/\d+\/11/), null);
    assert.equal(rntl.screen.queryByRole('button', { name: '보존된 원본으로 복구 재시도' }), null);
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '작업 상태 다시 확인' }));
    assert.equal(rntl.screen.queryByRole('alert'), null);
  });

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
