import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, it } from 'node:test';
import React, { useImperativeHandle, useState, useSyncExternalStore } from 'react';
import type { AlertButton } from 'react-native';
import { CharacterManagementHubModule, type CharacterManagementHubBackend } from '../../main/domain/characterManagementHubModule';
import { makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';
import { makeBattleResource } from '../fixtures/battleResource';
import { makePartyPresetCatalogResource } from '../fixtures/partyPresetCatalog';

// 네이티브 호스트와 외부 포트만 대체하고 실제 목록·상세·허브의 탐색을 검증한다.
const host = (name: string) => React.forwardRef<unknown, Record<string, any>>((props, ref) => {
  useImperativeHandle(ref, () => ({ label: props.accessibilityLabel }));
  return React.createElement(name, { ...props, accessible: props.accessible ?? (name === 'Pressable' ? true : undefined) }, props.children);
});
const View = host('View');
const backHandlers = new Set<() => boolean | null | undefined>();
let restoredOffset: number | null = null;
let focusedLabel: string | undefined;
let confirmation: AlertButton | undefined;
let nativeWindowSize = Infinity;
let restoredIndex: number | null = null;
let indexMeasurementMissing = false;
const list = (name: string) => React.forwardRef<unknown, Record<string, any>>(({ data, renderItem, keyExtractor, ListEmptyComponent, ...props }, ref) => {
  const [start, setStart] = useState(0);
  useImperativeHandle(ref, () => ({
    scrollToOffset: ({ offset }: { offset: number }) => { restoredOffset = offset; if (Number.isFinite(nativeWindowSize)) setStart(Math.floor(offset / 80)); },
    scrollToIndex: ({ index }: { index: number }) => {
      restoredIndex = index;
      if (indexMeasurementMissing) props.onScrollToIndexFailed({ index, averageItemLength: 80 });
      else setStart(index);
    },
  }));
  return React.createElement(name, props, data.length ? data.slice(start, start + nativeWindowSize).map((item: any, index: number) =>
    React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item, index, getIndex: () => index, drag: () => undefined, isActive: false }))) : ListEmptyComponent);
});
const rn = {
  View, Text: host('Text'), TextInput: host('TextInput'), Pressable: host('Pressable'), Image: host('Image'),
  ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'), KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Modal: ({ visible = true, children, ...props }: Record<string, any>) => visible ? React.createElement('Modal', props, children) : null,
  FlatList: list('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (styles: any): any => Array.isArray(styles) ? Object.assign({}, ...styles.filter(Boolean).map(rn.StyleSheet.flatten)) : styles },
  Platform: { OS: 'android', select: (options: any) => options.android ?? options.default },
  Alert: { alert: (_title: string, _message: string, buttons: AlertButton[]) => { confirmation = buttons?.find((button) => button.text === '가져오기'); } },
  BackHandler: { addEventListener: (_name: string, handler: () => boolean) => {
    backHandlers.add(handler);
    return { remove: () => backHandlers.delete(handler) };
  } },
  Keyboard: { dismiss: () => undefined, isVisible: () => false },
  AccessibilityInfo: { setAccessibilityFocus: (node: { label?: string }) => { focusedLabel = node.label; } },
  findNodeHandle: (node: unknown) => node,
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const original = loader._load;
loader._load = (request, parent, isMain) => {
  if (request === 'react-native') return rn;
  if (request === 'react-native-safe-area-context') return { SafeAreaView: View };
  if (request === 'react-native-draggable-flatlist') return { __esModule: true, default: list('ScrollView'), NestableDraggableFlatList: list('ScrollView'), NestableScrollContainer: host('ScrollView') };
  if (request === 'lucide-react-native') return new Proxy({}, { get: () => View });
  for (const name of ['HomeTabScreen', 'BattleTabScreen', 'DataTabScreen', 'SettingsTabScreen', 'TownTabScrollContainer', 'PartyPresetList']) {
    if (request.endsWith('/' + name)) return { [name]: View };
  }
  return original(request, parent, isMain);
};
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { MainScreen } = require('../../main/screens/MainScreen') as typeof import('../../main/screens/MainScreen');
loader._load = original;
afterEach(async () => { await rntl.cleanup(); backHandlers.clear(); restoredOffset = null; focusedLabel = undefined; confirmation = undefined; nativeWindowSize = Infinity; restoredIndex = null; indexMeasurementMissing = false; });

const characters = [makeHofCharacter(1, { name: '소셜', job: 'Social Knight' }), makeHofCharacter(2, { name: '사제', job: 'Cardinal' })];
function detail(id: number) {
  return makeHofCharacterDetail(id, { name: characters.find((character) => character.id === id)?.name ?? '원본', job: id === 1 ? 'Social Knight' : 'Cardinal', detailSyncedAt: new Date().toISOString() });
}

async function openList(backend: Partial<CharacterManagementHubBackend> = {}) {
  const hub = new CharacterManagementHubModule({ loadStoredDetail: async (id) => detail(id), refreshAuthoritativeDetail: async (id) => detail(id), ...backend });
  hub.activate('account-1');
  hub.observeRoster(characters);
  function App() {
    const characterHub = useSyncExternalStore(hub.subscribe, hub.getSnapshot, hub.getSnapshot);
    return React.createElement(MainScreen, {
      session: { loggedIn: true }, status: null, battle: makeBattleResource(), characterHub,
      characterSyncLabel: null, notice: null,
      onSyncCharacterRoster: async () => undefined, onStartCharacterFullSync: async () => undefined,
      onOpenCaptcha: () => undefined, onLogout: () => undefined, onOpenLogin: () => undefined,
      automationController: {} as React.ComponentProps<typeof MainScreen>['automationController'],
      partyPresetCatalog: makePartyPresetCatalogResource({ folders: [], presets: [] }),
    });
  }
  await rntl.render(React.createElement(App));
  await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '캐릭' }));
  return { hub, changeSession: async () => {
    await rntl.act(async () => { hub.activate('account-2'); hub.observeRoster([characters[1]!]); });
    // 실제 앱과 동일하게 로그인 세대가 달라지면 인증된 화면의 React key가 바뀐다.
    await rntl.screen.rerender(React.createElement(App, { key: 'account-2' }));
  } };
}

async function systemBack() {
  // Android는 네이티브 Modal이 열렸으면 BackHandler 대신 onRequestClose에 전달한다.
  const modal = rntl.screen.container.queryAll((node) => node.type === 'Modal' && !rntl.isHiddenFromAccessibility(node)).at(-1);
  let consumed = false;
  await rntl.act(async () => {
    if (modal) { modal.props.onRequestClose(); consumed = true; }
    else for (const handler of [...backHandlers].reverse()) if (handler()) { consumed = true; break; }
  });
  return consumed;
}

// 실제 좌표·관성 터치는 Android 검증 앱으로 확인한다. 이 검사는 외부 스크롤이
// 고정 탐색 영역을 다시 감싸는 회귀를 실제 MainScreen 조립 경계에서 막는다.
it('상세의 다섯 탭에서 목록 복귀는 본문 스크롤과 독립적으로 동작한다', async () => {
  await openList();
  for (const tab of ['정보', '패턴', '장비', '스킬', '관리']) {
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
    await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: tab }));
    const back = rntl.screen.getByRole('button', { name: '캐릭터 목록으로' });
    for (let parent = back.parent; parent; parent = parent.parent) {
      assert.notEqual(parent.type, 'ScrollView', '목록 복귀 영역은 외부 본문 스크롤에도 포함되면 안 됩니다.');
    }
    await rntl.fireEvent.press(back);
    assert.ok(rntl.screen.getByLabelText('캐릭터 목록'));
  }
});

it('검색한 캐릭터 상세에서 시스템 뒤로가기로 원래 검색 목록에 돌아온다', async () => {
  await openList();
  await rntl.fireEvent.changeText(rntl.screen.getByLabelText('캐릭터 검색'), 'Social');
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
  assert.ok(rntl.screen.getByLabelText('캐릭터 상세 전체 화면'));
  await systemBack();
  assert.ok(rntl.screen.getByRole('tab', { name: '캐릭' }));
  assert.ok(rntl.screen.getByDisplayValue('Social'));
  assert.equal(rntl.screen.queryByText('사제'), null);
});

it('조회 중에도 목록 복귀 버튼이 보이고 늦은 응답이 닫은 상세를 다시 열지 않는다', async () => {
  let finish!: (value: ReturnType<typeof detail>) => void;
  const pending = new Promise<ReturnType<typeof detail>>((resolve) => { finish = resolve; });
  await openList({ loadStoredDetail: () => pending });
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
  assert.ok(rntl.screen.getByText('캐릭터 정보를 불러오는 중입니다.'));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '캐릭터 목록으로' }));
  await rntl.act(async () => { finish(detail(1)); await pending; });
  assert.ok(rntl.screen.getByRole('tab', { name: '캐릭' }));
  assert.equal(rntl.screen.queryByLabelText('캐릭터 상세 전체 화면'), null);
});

for (const tab of ['패턴', '관리']) {
  it(`${tab}의 설정 가져오기에서 먼저 원래 탭으로, 다음에는 목록으로 돌아온다`, async () => {
    await openList({
      previewTransfer: async () => ({ sourceCharacterId: 2, targetCharacterId: 1, steps: [], issues: [], executable: true }),
      executeTransfer: async () => { throw new Error('뒤로가기가 가져오기를 실행하면 안 됩니다.'); },
    });
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
    await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: tab }));
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /가져오기/ }));
    assert.ok(rntl.screen.getByLabelText('원본 캐릭터 검색'));
    assert.ok(rntl.screen.getByRole('button', { name: tab === '관리' ? '관리로 돌아가기' : '패턴으로 돌아가기' }));
    await systemBack();
    assert.ok(rntl.screen.getByRole('tab', { name: tab, selected: true }));
    assert.equal(rntl.screen.queryByLabelText('원본 캐릭터 검색'), null);
    await systemBack();
    assert.ok(rntl.screen.getByRole('tab', { name: '캐릭' }));
  });
}

it('목록 복귀 후 탐색하던 스크롤 위치와 선택한 캐릭터의 접근성 초점을 복원한다', async () => {
  await openList();
  await rntl.fireEvent.scroll(rntl.screen.getByLabelText('캐릭터 목록'), { nativeEvent: { contentOffset: { y: 240 } } });
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '캐릭터 목록으로' }));
  assert.equal(restoredOffset, 240);
  assert.match(focusedLabel ?? '', /소셜/);
});

for (const tab of ['정보', '패턴', '장비', '스킬', '관리']) {
  it(`${tab} 상세의 반복 진입과 두 복귀 방식이 목록 검색을 유지하고 다른 화면에 개입하지 않는다`, async () => {
    await openList();
    await rntl.fireEvent.changeText(rntl.screen.getByLabelText('캐릭터 검색'), 'Social');
    for (const mode of ['system', 'button', 'system']) {
      await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
      await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: tab }));
      if (mode === 'system') await systemBack();
      else await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '캐릭터 목록으로' }));
      assert.ok(rntl.screen.getByDisplayValue('Social'));
      assert.equal(rntl.screen.queryByText('사제'), null);
      assert.equal(await systemBack(), false);
    }
    await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '홈' }));
    assert.equal(await systemBack(), false);
    assert.ok(rntl.screen.getByRole('tab', { name: '홈', selected: true }));
  });
}

it('조회 오류에도 복귀 버튼이 있고 시스템 뒤로가기로 목록에 돌아온다', async () => {
  await openList({ loadStoredDetail: async () => { throw new Error('조회 연결 오류'); } });
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
  assert.ok(rntl.screen.getByRole('alert'));
  assert.ok(rntl.screen.getByRole('button', { name: '캐릭터 목록으로' }));
  await systemBack();
  assert.ok(rntl.screen.getByRole('tab', { name: '캐릭' }));
});

it('숨겨진 캐릭터 상세는 현재 메인 탭의 시스템 뒤로가기를 소비하지 않는다', async () => {
  const { hub } = await openList();
  await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '홈' }));
  await rntl.act(async () => { await hub.getSnapshot().actions.select(characters[0]!); });
  assert.equal(await systemBack(), false);
  assert.ok(rntl.screen.getByRole('tab', { name: '홈', selected: true }));
  await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '캐릭' }));
  assert.ok(rntl.screen.getByRole('button', { name: '캐릭터 목록으로' }));
  await systemBack();
  assert.ok(rntl.screen.getByRole('tab', { name: '캐릭' }));
});

for (const [tab, opener, contents] of [
  ['정보', /스탯 도움말/, /스탯 역할/],
  ['패턴', /저장 패턴/, /저장 패턴/],
  ['관리', /이름 변경/, /반각/],
]) {
  it(`${tab}의 팝업만 닫은 후 상세를 유지한다`, async () => {
    await openList();
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
    await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: tab }));
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: opener }));
    assert.ok(rntl.screen.getAllByText(contents).length > 0);
    await systemBack();
    assert.ok(rntl.screen.getByRole('tab', { name: tab, selected: true }));
    await systemBack();
    assert.ok(rntl.screen.getByRole('tab', { name: '캐릭' }));
  });
}

it('선택 기록이 목록에서 제거되면 남아 있는 캐릭터 구분으로 초점을 돌린다', async () => {
  const { hub } = await openList();
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
  await rntl.act(async () => { hub.observeRoster([characters[1]!]); });
  assert.ok(rntl.screen.getByRole('button', { name: /사제/ }));
  assert.equal(focusedLabel, '캐릭터');
});

it('모든 캐릭터가 사라져도 빈 목록 안내로 초점을 돌린다', async () => {
  const { hub } = await openList();
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
  await rntl.act(async () => { hub.observeRoster([]); });
  assert.ok(rntl.screen.getByText('캐릭터 0명'));
  assert.equal(focusedLabel, '캐릭터 0명');
});

it('다른 로그인 세대에는 이전 검색과 늦은 상세 응답이 나타나지 않는다', async () => {
  let finish!: (value: ReturnType<typeof detail>) => void;
  const pending = new Promise<ReturnType<typeof detail>>((resolve) => { finish = resolve; });
  const { changeSession } = await openList({ loadStoredDetail: () => pending });
  await rntl.fireEvent.changeText(rntl.screen.getByLabelText('캐릭터 검색'), 'Social');
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
  await changeSession();
  await rntl.act(async () => { finish(detail(1)); await pending; });
  await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '캐릭' }));
  assert.ok(rntl.screen.getByRole('button', { name: /사제/ }));
  assert.equal(rntl.screen.queryByDisplayValue('Social'), null);
  assert.equal(rntl.screen.queryByLabelText('캐릭터 상세 전체 화면'), null);
});

for (const [lifecycle, label] of [['MISSING', '사라짐'], ['ARCHIVED', '보관함']] as const) {
  it(`${label}에서 설정 복사를 열고 목록으로 돌아오면 원본의 구분과 검색을 유지한다`, async () => {
    const { hub } = await openList({ previewTransfer: async () => ({ sourceCharacterId: 3, targetCharacterId: 1, steps: [], issues: [], executable: true }),
      executeTransfer: async () => { throw new Error('탐색만으로 실행하면 안 됩니다.'); } });
    await rntl.act(async () => { hub.observeRoster([...characters, makeHofCharacter(3, { name: '보존 원본', lifecycle })]); });
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: label }));
    await rntl.fireEvent.changeText(rntl.screen.getByLabelText('캐릭터 검색'), '보존');
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '설정 복사' }));
    await rntl.fireEvent.press(rntl.screen.getByText('소셜'));
    assert.ok(rntl.screen.getByLabelText('원본 캐릭터 검색'));
    assert.ok(rntl.screen.getByRole('button', { name: '관리로 돌아가기' }));
    await systemBack();
    assert.ok(rntl.screen.getByRole('tab', { name: '관리', selected: true }));
    await systemBack();
    assert.ok(rntl.screen.getByRole('button', { name: label, selected: true }));
    assert.ok(rntl.screen.getByDisplayValue('보존'));
    assert.match(focusedLabel ?? '', /보존 원본/);
  });
}

it('동기화의 원본 복구 미리보기부터 한 단계씩 닫고 수락이나 자동화 중지를 요청하지 않는다', async () => {
  const job = { id: 5, operationType: 'DEEP_SYNC' as const, targetCharacterId: 1, sourceCharacterId: null,
    status: 'FAILED' as const, collectionStatus: 'FAILED' as const, recoveryStatus: 'UNAVAILABLE' as const,
    deepSync: { characterId: 1, progress: [] }, transfer: null, message: null, updatedAt: '2026-09-13T00:00:00Z', finishedAt: null };
  await openList({ loadCurrentOperation: async () => job,
    previewRecovery: async () => ({ jobId: 5, characterId: 1, confirmationToken: 'fixture', observedAt: '', expiresAt: '',
      hofCharacterId: '1', name: '관측 원본', patterns: [], equipment: [], positionGuard: { positions: [], selectedPosition: '', guardValue: '', guardText: '' } }),
    acceptRecovery: async () => { throw new Error('뒤로가기가 복구를 수락하면 안 됩니다.'); },
  });
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
  await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '관리' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '동기화 · 복구 필요' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '원본 서버의 현재 상태 확인' }));
  assert.ok(rntl.screen.getByRole('header', { name: '현재 서버 설정 확인' }));
  await systemBack();
  assert.equal(rntl.screen.queryByRole('header', { name: '현재 서버 설정 확인' }), null);
  assert.ok(rntl.screen.getByRole('button', { name: '동기화 화면 닫기' }));
  await systemBack();
  assert.ok(rntl.screen.getByRole('tab', { name: '관리', selected: true }));
  await systemBack();
  assert.ok(rntl.screen.getByRole('tab', { name: '캐릭' }));
});

it('실행 중 가져오기에서 돌아갔다 다시 열어도 동일한 작업의 완료 결과를 보여준다', async () => {
  let submissions = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  await openList({
    previewTransfer: async () => ({ sourceCharacterId: 2, targetCharacterId: 1, steps: [], issues: [], executable: true, confirmationToken: 'fixture' }),
    executeTransfer: async () => { submissions += 1; await pending; return { targetCharacterId: 1, results: [], nextStepIndex: 0, outcome: 'COMPLETED', finalSettingsConfirmed: true }; },
  });
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
  await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '관리' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /설정 가져오기/ }));
  await rntl.fireEvent.press(rntl.screen.getByText('사제'));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '가져오기 확인' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '가져오기' }));
  await rntl.act(async () => { void confirmation!.onPress!(); });
  await systemBack();
  assert.ok(rntl.screen.getByRole('tab', { name: '관리', selected: true }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /설정 가져오기/ }));
  await rntl.act(async () => { finish(); await pending; });
  assert.ok(rntl.screen.getByText('설정 가져오기를 완료했습니다.'));
  assert.equal(submissions, 1);
});

for (const mode of ['가상화 영역 밖', '마운트된 행', '길이 측정 전']) {
it(`상세 중 순서가 바뀐 캐릭터를 다시 표시한 뒤 초점을 복원한다: ${mode}`, async () => {
  nativeWindowSize = mode === '마운트된 행' ? Infinity : 5;
  indexMeasurementMissing = mode === '길이 측정 전';
  const { hub } = await openList();
  const others = Array.from({ length: 35 }, (_, index) => makeHofCharacter(index + 10));
  await rntl.act(async () => { hub.observeRoster([...characters, ...others]); });
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: /소셜/ }));
  await rntl.act(async () => { hub.observeRoster([{ ...characters[0]!, rosterOrder: 100 }, characters[1]!, ...others]); });
  await systemBack();
  assert.ok(rntl.screen.getByRole('button', { name: /소셜/ }));
  assert.match(focusedLabel ?? '', /소셜/);
  assert.equal(restoredIndex, 36);
});
}
