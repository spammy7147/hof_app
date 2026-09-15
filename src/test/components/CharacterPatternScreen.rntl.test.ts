import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, it } from 'node:test';
import React, { useSyncExternalStore } from 'react';
import type { AlertButton } from 'react-native';
import { CharacterManagementHubModule, type CharacterManagementHubBackend } from '../../main/domain/characterManagementHubModule';
import type { CharacterPatternApplyRequest } from '../../main/types/api';
import { makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';

// 네이티브 호스트와 API 경계만 대체하고 화면과 관리 허브는 실제로 연결한다.
const host = (name: string) => (props: Record<string, any>) => React.createElement(name, {
  ...props, accessible: props.accessible ?? (name === 'Pressable' ? true : undefined),
  accessibilityState: { ...props.accessibilityState, disabled: props.disabled ?? props.accessibilityState?.disabled },
  onPress: props.disabled ? undefined : props.onPress,
}, props.children);
const list = (props: Record<string, any>) => React.createElement('ScrollView', props,
  props.data.map((item: unknown, index: number) => React.createElement(React.Fragment,
    { key: props.keyExtractor(item) }, props.renderItem({ item, index, getIndex: () => index, drag: () => undefined, isActive: false }))));
let confirmation: AlertButton[] = [];
let confirmationMessage = '';
const rn = {
  View: host('View'), Text: host('Text'), TextInput: host('TextInput'), Pressable: host('Pressable'),
  ScrollView: host('ScrollView'), KeyboardAvoidingView: host('KeyboardAvoidingView'), FlatList: list,
  Modal: ({ visible, children, ...props }: Record<string, any>) => visible ? React.createElement('Modal', { ...props, 'aria-modal': true }, children) : null,
  Platform: { OS: 'android' },
  Alert: { alert: (_title: string, message: string, buttons: AlertButton[]) => { confirmation = buttons; confirmationMessage = message; } },
  StyleSheet: { create: <T,>(value: T) => value,
    flatten: (value: any): any => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(rn.StyleSheet.flatten)) : value },
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const original = loader._load;
loader._load = (request, parent, isMain) => request === 'react-native' ? rn
  : request === 'react-native-draggable-flatlist' ? { NestableDraggableFlatList: list }
  : original(request, parent, isMain);
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { CharacterPatternScreen } = require('../../main/features/characters/pattern/CharacterPatternScreen') as typeof import('../../main/features/characters/pattern/CharacterPatternScreen');
loader._load = original;
afterEach(async () => { await rntl.cleanup(); confirmation = []; confirmationMessage = ''; });

function detail(id = 44) {
  return makeHofCharacterDetail(id, {
    detailSyncedAt: new Date().toISOString(),
    actionPatterns: [{ index: 0, judge: '1206', judgeText: 'SP 이하', quantity: '20', quantityText: '20', skill: '3011', skillText: '충전' }],
    patternOptions: [
      { type: 'CONDITION', value: '1206', label: 'SP 이하', category: null },
      { type: 'SKILL', value: '3011', label: '충전', category: null },
    ],
    positionGuard: { positions: [{ value: 'back', checked: true }], selectedPosition: 'back', guardValue: 'never', guardText: '지키지 않는다' },
    patternSlots: [{ slot: '0', label: '빈슬롯', canLoad: false }],
  });
}

async function openPattern(overrides: Partial<CharacterManagementHubBackend> = {}) {
  const hub = new CharacterManagementHubModule({
    loadStoredDetail: async (id) => detail(id),
    refreshAuthoritativeDetail: async (id) => detail(id),
    ...overrides,
  });
  const character = makeHofCharacter(44);
  hub.activate('account-1');
  hub.observeRoster([character]);
  await hub.getSnapshot().actions.select(character);
  function Screen() {
    const resource = useSyncExternalStore(hub.subscribe, hub.getSnapshot, hub.getSnapshot);
    return resource.detail ? React.createElement(CharacterPatternScreen, { characterHub: resource }) : null;
  }
  await rntl.render(React.createElement(Screen));
  return hub;
}

it('저장 거절 이유를 표시하고 서버 재조회로 초안을 지우지 않는다', async () => {
  const requests: CharacterPatternApplyRequest[] = [];
  await openPattern({ applyPattern: async (request) => {
    requests.push(request);
    return { code: 'SKILL_NOT_ALLOWED', message: '현재 사용할 수 없는 스킬이 포함되어 있습니다.' };
  } });
  const user = rntl.userEvent.setup();
  await user.clear(rntl.screen.getByLabelText('1번 기준값'));
  await user.type(rntl.screen.getByLabelText('1번 기준값'), '21');
  await user.press(rntl.screen.getByRole('button', { name: '저장' }));
  await user.press(rntl.screen.getByRole('button', { name: '현재 설정 저장' }));
  assert.ok(await rntl.screen.findByText('현재 사용할 수 없는 스킬이 포함되어 있습니다.'));
  await rntl.fireEvent.press(rntl.screen.getByText('취소'));
  assert.ok(rntl.screen.getByDisplayValue('21'));
  assert.equal(requests.length, 1);
  assert.equal(confirmation.length, 0);
});

it('빈 기준값은 행 번호로 안내하고 서버에 제출하지 않는다', async () => {
  let calls = 0;
  await openPattern({ applyPattern: async () => { calls++; return { revision: 'saved' }; } });
  await rntl.fireEvent.changeText(rntl.screen.getByLabelText('1번 기준값'), '');
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '현재 설정 저장' }));
  assert.ok(rntl.screen.getByText('1번 행 기준값을 정수로 입력해 주세요.'));
  assert.equal(calls, 0);
  await rntl.fireEvent.press(rntl.screen.getByText('취소'));
  assert.ok(rntl.screen.getByDisplayValue(''));
});

it('부분 반영과 다음 단계를 알리고 현재 상태 확인 후에도 초안을 보존한다', async () => {
  let calls = 0;
  const hub = await openPattern({ applyPattern: async () => {
    calls++;
    return { type: 'PartiallyApplied', completedSteps: 1, nextStep: 'POSITION_GUARD', message: '행동 패턴만 저장됐습니다.' };
  } });
  await rntl.fireEvent.changeText(rntl.screen.getByLabelText('1번 기준값'), '21');
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '현재 설정 저장' }));
  assert.ok(rntl.screen.getByText('행동 패턴만 저장됐습니다.'));
  assert.ok(rntl.screen.getByText('다음 단계: 위치·호위 저장'));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '현재 서버 상태 다시 확인' }));
  assert.ok(rntl.screen.getByText('마지막으로 확인한 서버 설정'));
  assert.equal(hub.getSnapshot().detail?.actionPatterns[0]?.quantity, '20');
  await rntl.fireEvent.press(rntl.screen.getByText('취소'));
  assert.ok(rntl.screen.getByDisplayValue('21'));
  assert.equal(calls, 1);
});

it('정상 저장은 첫 슬롯 코드와 이름을 보내고 완료 후 서버 값을 표시한다', async () => {
  let stored = detail();
  const requests: CharacterPatternApplyRequest[] = [];
  await openPattern({
    loadStoredDetail: async () => structuredClone(stored),
    applyPattern: async (request) => {
      requests.push(request);
      stored = { ...stored, actionPatterns: [{ ...stored.actionPatterns[0]!, quantity: '21' }],
        patternSlots: [{ slot: '0', label: '시험', canLoad: true }] };
      return { type: 'Completed', revision: 'saved', messages: ['현재 설정과 저장 패턴을 저장했습니다.'] };
    },
  });
  await rntl.fireEvent.changeText(rntl.screen.getByLabelText('1번 기준값'), '21');
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('checkbox'));
  await rntl.fireEvent.changeText(rntl.screen.getByLabelText('패턴 저장 이름'), '시험');
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장하고 슬롯에도 보관' }));
  assert.ok(rntl.screen.getByText('현재 설정과 저장 패턴을 저장했습니다.'));
  assert.ok(rntl.screen.getByDisplayValue('21'));
  assert.equal(requests[0]?.targetSlotCode, '0');
  assert.equal(requests[0]?.slotName, '시험');
  assert.equal(requests[0]?.slotAction, 'SAVE_EMPTY');
});

it('슬롯 보관 실패 후 저장 이름과 선택을 유지한다', async () => {
  await openPattern({ applyPattern: async () => ({ type: 'Rejected', code: 'SLOT_NOT_EMPTY', message: '선택한 슬롯이 변경되었습니다.' }) });
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /저장 패턴/ }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장' }));
  await rntl.fireEvent.changeText(rntl.screen.getByLabelText('패턴 저장 이름'), '시험');
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장' }));
  assert.ok(rntl.screen.getByText('선택한 슬롯이 변경되었습니다.'));
  assert.ok(rntl.screen.getByDisplayValue('시험'));
});

for (const action of ['불러오기', '삭제'] as const) {
  it(`${action} 거절 이유를 표시하고 편집 내용을 유지한다`, async () => {
    const stored = { ...detail(), patternSlots: [{ slot: '0', label: '시험', canLoad: true }] };
    const reject = async () => ({ type: 'Rejected' as const, code: 'SLOT_NOT_FOUND', message: '저장 슬롯이 없습니다.' });
    await openPattern({ loadStoredDetail: async () => structuredClone(stored), loadSavedPattern: reject, deleteSavedPattern: reject });
    await rntl.fireEvent.changeText(rntl.screen.getByLabelText('1번 기준값'), '21');
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /저장 패턴/ }));
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: action }));
    if (action === '불러오기') await rntl.act(async () => { confirmation.find((button) => button.text === action)?.onPress?.(); });
    assert.ok(rntl.screen.getByText('저장 슬롯이 없습니다.'));
    assert.ok(rntl.screen.getByDisplayValue('21'));
  });
}

it('새 상세 객체를 읽어도 편집 기준을 유지하고 충돌은 명시적으로 덮어쓴다', async () => {
  let stored = detail();
  const requests: CharacterPatternApplyRequest[] = [];
  const hub = await openPattern({
    loadStoredDetail: async () => structuredClone(stored),
    applyPattern: async (request) => {
      requests.push(request);
      if (!request.force) return { type: 'Conflict', currentRevision: 'other', rowDiffs: [{ rowNumber: 1, before: request.base.rows[0]!, current: { judge: '1206', quantity: '22', skill: '3011' } }] };
      stored = { ...stored, actionPatterns: [{ ...stored.actionPatterns[0]!, quantity: '21' }] };
      return { type: 'Completed', revision: 'saved' };
    },
  });
  await rntl.fireEvent.changeText(rntl.screen.getByLabelText('1번 기준값'), '21');
  stored = { ...stored, actionPatterns: [{ ...stored.actionPatterns[0]!, quantity: '22' }] };
  await rntl.act(() => hub.getSnapshot().actions.reloadStored());
  assert.ok(rntl.screen.getByDisplayValue('21'));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '현재 설정 저장' }));
  assert.ok(rntl.screen.getByText('서버에서 패턴이 변경되었습니다'));
  assert.equal(requests[0]?.base.rows[0]?.quantity, '20');
  assert.equal(requests.length, 1);
  await rntl.fireEvent.press(rntl.screen.getByText('덮어쓰기'));
  assert.equal(requests[1]?.force, true);
  assert.ok(rntl.screen.getByDisplayValue('21'));
  assert.ok(rntl.screen.getByText('현재 설정을 저장했습니다.'));
});

it('응답을 받지 못하면 재확인을 안내하고 초안과 슬롯 이름을 보존한다', async () => {
  let calls = 0;
  await openPattern({ applyPattern: async () => { calls++; throw new Error('연결이 끊겼습니다.'); } });
  await rntl.fireEvent.changeText(rntl.screen.getByLabelText('1번 기준값'), '21');
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('checkbox'));
  await rntl.fireEvent.changeText(rntl.screen.getByLabelText('패턴 저장 이름'), '시험');
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장하고 슬롯에도 보관' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '현재 서버 상태 다시 확인' }));
  assert.ok(rntl.screen.getByDisplayValue('시험'));
  await rntl.fireEvent.press(rntl.screen.getByText('취소'));
  assert.ok(rntl.screen.getByDisplayValue('21'));
  assert.equal(calls, 1);
});

it('지연된 저장 중 재제출하지 않고 계정 전환 뒤 응답을 버린다', async () => {
  let finish!: (result: { type: 'Completed'; revision: string }) => void;
  let calls = 0;
  const response = new Promise<{ type: 'Completed'; revision: string }>((resolve) => { finish = resolve; });
  const hub = await openPattern({ applyPattern: () => { calls++; return response; } });
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '현재 설정 저장' }));
  assert.ok(rntl.screen.getByText('패턴 변경을 처리하고 있습니다.'));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '현재 설정 저장', disabled: true }));
  await rntl.act(async () => {
    hub.activate('account-2');
    finish({ type: 'Completed', revision: 'old-save' });
    await response;
  });
  assert.equal(calls, 1);
  assert.equal(hub.getSnapshot().patternOperation.result, null);
  assert.equal(hub.getSnapshot().detail, null);
});

for (const succeeds of [true, false]) {
  it(`편집 중 슬롯에서 저장 화면으로 이동하고 ${succeeds ? '완료 후에만 슬롯으로 돌아온다' : '거절되면 입력 화면을 유지한다'}`, async () => {
    let stored = detail();
    const requests: CharacterPatternApplyRequest[] = [];
    await openPattern({ loadStoredDetail: async () => structuredClone(stored), applyPattern: async (request) => {
      requests.push(request);
      if (!succeeds) return { type: 'Rejected', code: 'INVALID', message: '저장 거절입니다.' };
      stored = { ...stored, actionPatterns: [{ ...stored.actionPatterns[0]!, quantity: '21' }] };
      return { type: 'Completed', revision: 'saved' };
    } });
    await rntl.fireEvent.changeText(rntl.screen.getByLabelText('1번 기준값'), '21');
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /저장 패턴/ }));
    assert.ok(rntl.screen.getByText('편집한 내용이 있습니다. 슬롯에 보관하거나 교체하려면 현재 설정을 먼저 저장해 주세요.'));
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '현재 설정 저장으로 이동' }));
    assert.equal(requests.length, 0);
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '현재 설정 저장' }));
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.slotAction, 'NONE');
    if (succeeds) {
      assert.ok(rntl.screen.getByText('저장 패턴'));
      assert.ok(rntl.screen.getByText('현재 설정을 저장했습니다.'));
      await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장' }));
      assert.ok(rntl.screen.getByLabelText('패턴 저장 이름'));
    } else {
      assert.ok(rntl.screen.getByText('저장 거절입니다.'));
      assert.ok(rntl.screen.getByRole('button', { name: '현재 설정 저장' }));
    }
  });
}

it('기존 슬롯 교체는 삭제 후 같은 이름으로 저장함을 확인받고 선택한 슬롯만 요청한다', async () => {
  const stored = { ...detail(), patternSlots: [{ slot: '0', label: '시험', canLoad: true }, { slot: '1', label: '4탑', canLoad: true }] };
  const requests: CharacterPatternApplyRequest[] = [];
  await openPattern({ loadStoredDetail: async () => structuredClone(stored), applyPattern: async (request) => {
    requests.push(request);
    return { type: 'Completed', revision: 'saved', messages: ['저장 패턴을 교체했습니다.'] };
  } });
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /저장 패턴/ }));
  await rntl.fireEvent.press(rntl.screen.getAllByRole('button', { name: '교체' })[0]!);
  assert.equal(requests.length, 0);
  assert.match(confirmationMessage, /삭제한 뒤 현재 서버 설정을 같은 이름으로/);
  await rntl.act(async () => { await confirmation.find((button) => button.text === '교체')?.onPress?.(); });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.slotAction, 'REPLACE');
  assert.equal(requests[0]?.targetSlotCode, '0');
  assert.equal(requests[0]?.slotName, '시험');
  assert.ok(rntl.screen.getByText('저장 패턴을 교체했습니다.'));
});

it('저장 후 상세 조회가 새 조회에 밀리면 이전 상세로 초안을 확정하지 않는다', async () => {
  let finishStored!: (value: ReturnType<typeof detail>) => void;
  let finishRefresh!: (value: ReturnType<typeof detail>) => void;
  const delayedStored = new Promise<ReturnType<typeof detail>>((resolve) => { finishStored = resolve; });
  const delayedRefresh = new Promise<ReturnType<typeof detail>>((resolve) => { finishRefresh = resolve; });
  let loads = 0;
  const hub = await openPattern({
    loadStoredDetail: async () => ++loads === 1 ? detail() : delayedStored,
    refreshAuthoritativeDetail: () => delayedRefresh,
    applyPattern: async () => ({ type: 'Completed', revision: 'saved' }),
  });
  await rntl.fireEvent.changeText(rntl.screen.getByLabelText('1번 기준값'), '21');
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '저장' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '현재 설정 저장' }));
  let refresh!: Promise<void>;
  await rntl.act(async () => {
    refresh = hub.getSnapshot().actions.refresh();
    finishStored(detail());
    await delayedStored;
  });
  assert.equal(hub.getSnapshot().patternOperation.result?.type, 'RefreshRequired');
  await rntl.fireEvent.press(rntl.screen.getByText('취소'));
  assert.ok(rntl.screen.getByDisplayValue('21'));
  await rntl.act(async () => { finishRefresh(detail()); await refresh; });
  assert.ok(rntl.screen.getByDisplayValue('21'));
});
