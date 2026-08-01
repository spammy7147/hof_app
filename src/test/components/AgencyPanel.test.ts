import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { RecruitmentResponse } from '../../main/types/api';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const mock = {
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: (props: Record<string, unknown>) => React.createElement(
    'FlatList',
    props,
    props.ListHeaderComponent as React.ReactNode,
    (props.data as Array<{ id: string }>).map((item) => React.createElement(
      React.Fragment,
      { key: item.id },
      (props.renderItem as (info: { item: { id: string } }) => React.ReactNode)({ item }),
    )),
    props.ListFooterComponent as React.ReactNode,
  ),
  Modal: host('Modal'),
  Pressable: host('Pressable'),
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(value: T) => value },
  Text: host('Text'),
  TextInput: host('TextInput'),
  View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => request === 'react-native'
  ? mock
  : request === 'react-native-safe-area-context'
    ? { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }
    : request === 'expo-image'
      ? { Image: host('Image') }
      : originalLoad(request, parent, isMain);
const { AgencyPanel } = require('../../main/features/town/panels/AgencyPanel') as typeof import('../../main/features/town/panels/AgencyPanel');
const { BackendApiError } = require('../../main/services/backendApi') as typeof import('../../main/services/backendApi');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | null = null;

afterEach(async () => {
  if (mounted) await act(async () => mounted?.unmount());
  mounted = null;
});

describe('AgencyPanel', () => {
  it('완료 가능 탭과 카드별 버튼을 제공하고 확인 뒤 완료를 한 번 요청한다', async () => {
    const calls: unknown[] = [];
    const data = [
      quest('a', '진행 퀘스트', 'ACTIVE', 'ACTIVE', null),
      quest('b', '완료 퀘스트', 'CLAIMABLE', 'ACTIVE', 'R610'),
      quest('c', '받을 퀘스트', 'AVAILABLE', 'AVAILABLE', '351'),
      quest('d', '대기 퀘스트', 'UNAVAILABLE', 'WAITING', null),
    ];
    await render(React.createElement(AgencyPanel, { api: {
      loadQuests: async () => data,
      acceptQuest: async (actionNo: string) => { calls.push({ actionNo, action: 'accept' }); return data; },
      claimQuest: async (actionNo: string) => { calls.push({ actionNo, action: 'claim' }); return data; },
    } as never }));

    assert.match(text(), /진행 중 1/);
    assert.match(text(), /완료 가능 1/);
    await pressText('완료 가능 1');
    assert.doesNotMatch(text(), /진행 퀘스트/);
    await press('완료 퀘스트 완료');
    assert.equal(calls.length, 0);
    await pressLast('완료');
    assert.deepEqual(calls, [{ actionNo: 'R610', action: 'claim' }]);
    await pressText('수락 가능 1');
    assert.match(text(), /받을 퀘스트/);
    await press('받을 퀘스트 수락');
    await pressLast('수락');
    assert.deepEqual(calls, [{ actionNo: 'R610', action: 'claim' }, { actionNo: '351', action: 'accept' }]);
  });

  it('확인창을 연 뒤 선택 callback이 바뀌어도 퀘스트 확인 대상과 POST 대상을 고정한다', async () => {
    const calls: string[] = [];
    const data = [
      quest('a', '첫 퀘스트', 'CLAIMABLE', 'ACTIVE', 'A'),
      quest('b', '둘째 퀘스트', 'CLAIMABLE', 'ACTIVE', 'B'),
    ];
    await render(React.createElement(AgencyPanel, { api: {
      loadQuests: async () => data,
      acceptQuest: async () => data,
      claimQuest: async (actionNo: string) => { calls.push(actionNo); return data; },
    } as never }));

    await pressText('완료 가능 2');
    await press('첫 퀘스트 완료');
    await press('둘째 퀘스트 완료');
    assert.match(confirmText(), /첫 퀘스트/);
    assert.doesNotMatch(confirmText(), /둘째 퀘스트/);
    await pressLast('완료');
    assert.deepEqual(calls, ['A']);
  });

  it('직업 이름 성별과 가격을 snapshot으로 확인하고 모집을 한 번 요청한다', async () => {
    const calls: unknown[] = [];
    const data = recruitment();
    const api = {
      load: async () => data,
      submit: async (_path: string, request: unknown) => {
        calls.push(request);
        return { ...data, currentCharacters: 30, result: success('모집했습니다.') };
      },
    };
    await render(React.createElement(AgencyPanel, { api: api as never, mode: 'recruitment' }));

    assert.match(text(), /현재 29 \/ 최대 45/);
    assert.equal(hosts('FlatList')[0].props.keyboardShouldPersistTaps, 'handled');
    await press('Monk 선택');
    await changeText('새 캐릭터 이름', ' 새동료 ');
    await press('여성 선택');
    await press('모집하기');
    assert.equal(calls.length, 0);
    assert.match(confirmText(), /Monk/);
    assert.match(confirmText(), /새동료/);
    assert.match(confirmText(), /여성/);
    assert.match(confirmText(), /\$10,000/);

    await press('Warrior 선택');
    await changeText('새 캐릭터 이름', '다른이름');
    await press('남성 선택');
    await pressLast('모집');
    assert.deepEqual(calls, [{ jobId: 'job-2', name: '새동료', genderId: 'gender-f' }]);
    assert.match(text(), /현재 30 \/ 최대 45/);
    assert.equal(input('새 캐릭터 이름').props.value, '');
  });

  it('이름 경계를 설명하고 정원·폼 상태에 따라 모집을 차단한다', async () => {
    const data = { ...recruitment(), nameMinLength: 2, nameMaxLength: 4 };
    await render(React.createElement(AgencyPanel, { api: { load: async () => data } as never, mode: 'recruitment' }));
    await press('Monk 선택');
    await press('여성 선택');

    await changeText('새 캐릭터 이름', ' ');
    assert.equal(button('모집하기').props.accessibilityState.disabled, true);
    assert.match(text(), /2~4칸으로 입력/);
    await changeText('새 캐릭터 이름', 'AB');
    assert.equal(button('모집하기').props.accessibilityState.disabled, false);
    assert.match(text(), /이름 2\/4칸/);

    const full = { ...data, currentCharacters: 45 };
    await update(React.createElement(AgencyPanel, { api: { load: async () => full } as never, mode: 'recruitment' }));
    assert.match(text(), /캐릭터 정원이 가득 찼습니다/);
    assert.equal(button('모집하기').props.accessibilityState.disabled, true);
  });

  it('HOF와 동일하게 ASCII 1칸·비ASCII 2칸으로 계산하고 보이지 않는 문자를 거부한다', async () => {
    const data = recruitment();
    await render(React.createElement(AgencyPanel, { api: { load: async () => data } as never, mode: 'recruitment' }));
    await press('Monk 선택');
    await press('여성 선택');

    await changeText('새 캐릭터 이름', '가나다라마바사아');
    assert.equal(button('모집하기').props.accessibilityState.disabled, false);
    assert.match(text(), /이름 16\/16칸/);
    await changeText('새 캐릭터 이름', '가나다라마바사아자');
    assert.equal(button('모집하기').props.accessibilityState.disabled, true);
    assert.match(text(), /영문·숫자 1칸, 한글·일본어 등은 2칸/);
    await changeText('새 캐릭터 이름', '새\u200B동료');
    assert.equal(button('모집하기').props.accessibilityState.disabled, true);
  });

  it('중복 확인은 한 POST로 막고 실패하면 모집 draft를 보존한다', async () => {
    const data = recruitment();
    const pending = deferred<RecruitmentResponse>();
    let calls = 0;
    const api = {
      load: async () => data,
      submit: async () => { calls += 1; return pending.promise; },
    };
    await render(React.createElement(AgencyPanel, { api: api as never, mode: 'recruitment' }));
    await prepareRecruitment('동료');
    await press('모집하기');
    const confirm = pressableWithText('모집');
    await act(async () => { confirm.props.onPress(); confirm.props.onPress(); });
    await flush();
    assert.equal(calls, 1);
    pending.reject(new Error('모집 실패'));
    await flush();

    assert.equal(input('새 캐릭터 이름').props.value, '동료');
    assert.equal(button('Monk 선택').props.accessibilityState.checked, true);
    assert.equal(button('여성 선택').props.accessibilityState.checked, true);
    assert.match(text(), /모집 실패/);
  });

  it('CAPTCHA 해결 뒤 같은 모집 snapshot만 한 번 재시도한다', async () => {
    const data = recruitment();
    const requests: unknown[] = [];
    let resolves = 0;
    const api = {
      load: async () => data,
      submit: async (_path: string, request: unknown) => {
        requests.push(request);
        if (requests.length === 1) throw new BackendApiError(409, 'CAPTCHA_REQUIRED', '인증 필요');
        return { ...data, currentCharacters: 30, result: success('모집했습니다.') };
      },
    };
    await render(React.createElement(AgencyPanel, {
      api: api as never,
      mode: 'recruitment',
      resolveCaptcha: async () => { resolves += 1; },
    }));
    await prepareRecruitment('캡차동료');
    await press('모집하기');
    await pressLast('모집');
    await flush();

    assert.equal(resolves, 1);
    assert.deepEqual(requests, [
      { jobId: 'job-2', name: '캡차동료', genderId: 'gender-f' },
      { jobId: 'job-2', name: '캡차동료', genderId: 'gender-f' },
    ]);
  });

  it('계정 API 변경 시 이전 모집 응답과 늦은 완료를 새 계정에 노출하지 않는다', async () => {
    const oldMutation = deferred<RecruitmentResponse>();
    const newMutation = deferred<RecruitmentResponse>();
    const oldData = { ...recruitment(), currentCharacters: 3, capacity: 10 };
    const newData = { ...recruitment(), currentCharacters: 7, capacity: 20 };
    const oldApi = { load: async () => oldData, submit: async () => oldMutation.promise };
    const newApi = { load: async () => newData, submit: async () => newMutation.promise };
    await render(React.createElement(AgencyPanel, { api: oldApi as never, mode: 'recruitment' }));
    await prepareRecruitment('이전계정');
    await press('모집하기');
    await pressLast('모집');

    await update(React.createElement(AgencyPanel, { api: newApi as never, mode: 'recruitment' }));
    await flush();
    assert.match(text(), /현재 7 \/ 최대 20/);
    assert.doesNotMatch(text(), /이전계정/);
    await prepareRecruitment('새계정');
    await press('모집하기');
    await pressLast('모집');

    newMutation.resolve({ ...newData, currentCharacters: 8, result: success('새 계정 모집') });
    oldMutation.resolve({ ...oldData, currentCharacters: 4, result: success('이전 계정 모집') });
    await flush();
    assert.match(text(), /현재 8 \/ 최대 20/);
    assert.match(text(), /새 계정 모집/);
    assert.doesNotMatch(text(), /이전 계정 모집/);
  });
});

function quest(questKey: string, name: string, state: string, section: string, actionNo: string | null) {
  return { questKey, displayCode: questKey, name, state, section, sourceOrder: 0, missions: [], actionNo, rewards: [] };
}

function recruitment(): RecruitmentResponse {
  return {
    currentCharacters: 29,
    capacity: 45,
    jobs: [
      { id: 'job-1', name: 'Warrior', price: 2_000, imageUrl: 'https://sic.zerosic.com/warrior.png' },
      { id: 'job-2', name: 'Monk', price: 10_000, imageUrl: null },
    ],
    genders: [{ id: 'gender-m', label: '남성' }, { id: 'gender-f', label: '여성' }],
    nameMinLength: 1,
    nameMaxLength: 16,
    recruitmentAvailable: true,
    result: null,
  };
}

function success(message: string) {
  return { status: 'SUCCESS' as const, messages: [message], items: [], refreshRequired: true };
}

async function prepareRecruitment(name: string) {
  await press('Monk 선택');
  await changeText('새 캐릭터 이름', name);
  await press('여성 선택');
}

async function render(node: React.ReactElement) {
  await act(async () => { mounted = create(node); });
  await flush();
}

async function update(node: React.ReactElement) {
  await act(async () => { mounted?.update(node); });
  await flush();
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

function text() {
  return hosts('Text').map((node) => node.children.join('')).join(' ');
}

function hosts(name: string) {
  return mounted!.root.findAll((node) => String(node.type) === name);
}

function input(label: string) {
  return mounted!.root.find((node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === label);
}

function button(label: string) {
  return mounted!.root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label);
}

function confirmText() {
  const sheet = mounted!.root.findByProps({ testID: 'town-confirm-sheet' });
  return sheet.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join('')).join(' ');
}

async function press(label: string) {
  const node = mounted!.root.find((candidate) => candidate.props.accessibilityLabel === label);
  await act(async () => node.props.onPress());
  await flush();
}

async function changeText(label: string, value: string) {
  await act(async () => input(label).props.onChangeText(value));
}

async function pressText(label: string) {
  const node = mounted!.root.find((candidate) => String(candidate.type) === 'Pressable'
    && candidate.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0);
  await act(async () => node.props.onPress());
  await flush();
}

async function pressLast(label: string) {
  const nodes = mounted!.root.findAll((candidate) => String(candidate.type) === 'Pressable'
    && candidate.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0);
  await act(async () => nodes.at(-1)!.props.onPress());
  await flush();
}

function pressableWithText(label: string): ReactTestInstance {
  const nodes = mounted!.root.findAll((candidate) => String(candidate.type) === 'Pressable'
    && candidate.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0);
  return nodes.at(-1)!;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
