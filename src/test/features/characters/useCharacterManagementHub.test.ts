import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, it } from 'node:test';
import { makeHofCharacterDetail } from '../../fixtures/api';
import {
  useCharacterManagementHub,
  type CharacterManagementHubApi,
  type CharacterManagementHubIntegration,
} from '../../../main/features/characters/useCharacterManagementHub';

// Hook 검증에서는 native host를 렌더하지 않는다. RNTL의 플랫폼 import만 제공한다.
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const original = loader._load;
loader._load = (request, parent, isMain) => request === 'react-native'
  ? { StyleSheet: { flatten: (style: unknown) => style } }
  : original(request, parent, isMain);
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
loader._load = original;
afterEach(async () => rntl.cleanup());

const character = makeHofCharacterDetail(1, { revision: '2026-09-09T00:00:00Z' });
const unused = async (): Promise<never> => { throw new Error('호출하면 안 되는 backend 경로'); };
const api: CharacterManagementHubApi = {
  fetchCharacterDetail: async () => character,
  refreshCharacterDetail: async () => character,
  executeCharacterCommand: unused,
  applyCharacterPattern: unused,
  loadSavedCharacterPattern: unused,
  deleteSavedCharacterPattern: unused,
  runManualSequence: unused,
  linkCharacter: unused,
  listCharacters: async () => [character],
  archiveCharacter: unused,
  deleteCharacterPermanently: unused,
  previewCharacterTransfer: unused,
  fetchCurrentCharacterOperation: async () => null,
  fetchCharacterOperation: unused,
  previewCharacterRecovery: unused,
  acceptCharacterRecovery: unused,
};
const idleIntegration: CharacterManagementHubIntegration = {
  reloadRelatedPresets: async () => undefined,
  beginPatternEdit: async () => undefined,
};

it('같은 계정의 연결 콜백 갱신은 목록·선택·진행 중 관측을 버리지 않는다', async () => {
  let oldPauseCalls = 0;
  let latestPauseCalls = 0;
  const account = {};
  const hook = await rntl.renderHook((integration: CharacterManagementHubIntegration = idleIntegration) =>
    useCharacterManagementHub(api, account, integration), {
    initialProps: { ...idleIntegration, beginPatternEdit: async () => { oldPauseCalls += 1; } },
  });
  await rntl.act(() => {
    hook.result.current.observations.beginRosterObservation()([character]);
  });
  await rntl.act(async () => { await hook.result.current.resource.actions.select(character); });
  const pendingObservation = hook.result.current.observations.beginRosterObservation();
  await hook.rerender({ ...idleIntegration, beginPatternEdit: async () => { latestPauseCalls += 1; } });
  assert.deepEqual(hook.result.current.resource.characters.map(({ id }) => id), [character.id]);
  assert.equal(hook.result.current.resource.selectedCharacter?.id, character.id);
  await rntl.act(() => {
    assert.equal(pendingObservation([{ ...character, name: '늦은 최신 목록' }]), true);
  });
  assert.equal(hook.result.current.resource.characters[0]?.name, '늦은 최신 목록');
  await rntl.act(async () => { await hook.result.current.resource.actions.beginPatternEdit?.(); });
  assert.equal(oldPauseCalls, 0);
  assert.equal(latestPauseCalls, 1);
});

it('로그인 계정이 바뀌면 이전 관측과 명령은 새 계정에 적용되지 않는다', async () => {
  let pauses = 0;
  const integration = { ...idleIntegration, beginPatternEdit: async () => { pauses += 1; } };
  const hook = await rntl.renderHook((account = 'first') => useCharacterManagementHub(api, account, integration));
  await rntl.act(() => { hook.result.current.observations.beginRosterObservation()([character]); });
  await rntl.act(async () => { await hook.result.current.resource.actions.select(character); });
  const previousActions = hook.result.current.resource.actions;
  const previousObservation = hook.result.current.observations.beginRosterObservation();
  await hook.rerender('second');
  assert.deepEqual(hook.result.current.resource.characters, []);
  await rntl.act(async () => {
    assert.equal(previousObservation([character]), false);
    await previousActions.beginPatternEdit?.();
  });
  assert.equal(pauses, 0);
});
