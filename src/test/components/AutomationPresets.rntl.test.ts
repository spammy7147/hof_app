import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, it } from 'node:test';
import React from 'react';
import { AutomationPresetEditor } from '../../main/domain/automationPresetEditor';
import { UnifiedAutomationController } from '../../main/domain/unifiedAutomationController';
import type { AutomationPresetDetailResponse, TypedAutomationAggregateResponse } from '../../main/types/api';
import { makeBattleResource } from '../fixtures/battleResource';
import { makePartyPresetCatalogResource } from '../fixtures/partyPresetCatalog';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name,
  { ...props, accessible: props.accessible ?? (name === 'Pressable' ? true : undefined),
    'aria-disabled': props.disabled }, props.children as React.ReactNode);
const Text = host('Text');
const Pressable = host('Pressable');
let confirmButtons: Array<{ text: string; onPress?: () => void }> = [];
const backHandlers = new Set<() => boolean>();
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const modules = Module as unknown as { _load: Loader };
const original = modules._load;
modules._load = (request, parent, isMain) => {
  if (request === 'react-native') return {
    ActivityIndicator: host('ActivityIndicator'), Pressable, TextInput: host('TextInput'), Text, View: host('View'),
    Modal: host('Modal'), KeyboardAvoidingView: host('KeyboardAvoidingView'), Platform: { OS: 'android' },
    BackHandler: { addEventListener: (_event: string, handler: () => boolean) => {
      backHandlers.add(handler); return { remove: () => backHandlers.delete(handler) };
    } },
    Alert: { alert: (_title: string, _message: string, buttons: typeof confirmButtons) => { confirmButtons = buttons; } },
    StyleSheet: { create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style },
  };
  if (request === 'lucide-react-native') return new Proxy({}, { get: (_target, name) => host(String(name)) });
  if (request === 'react-native-draggable-flatlist') return { NestableScrollContainer: host('ScrollView') };
  if (request.endsWith('/HomeStatusSummary')) return { HomeStatusSummary: () => null };
  if (request.endsWith('/UnifiedAutomationDashboard')) return { UnifiedAutomationDashboard: (props: { onOpenSettings: () => void }) =>
    React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: '설정 열기', onPress: props.onOpenSettings }) };
  if (request.endsWith('/UnifiedAutomationSettings')) return { UnifiedAutomationSettings: (props: {
    entries: TypedAutomationAggregateResponse['entries']; onToggle: (entry: TypedAutomationAggregateResponse['entries'][number]) => void;
    onDetail: (entry: TypedAutomationAggregateResponse['entries'][number]) => void;
  }) => React.createElement(React.Fragment, {}, React.createElement(Text, {}, '자동화 항목'), ...props.entries.map(entry =>
    React.createElement(Pressable, { key: entry.id, accessibilityRole: 'button', accessibilityLabel: entry.type + ' 전환',
      onPress: () => props.onToggle(entry) }))) };
  for (const name of ['QuestAutomationEditor', 'HomeQuestAutomationEditor', 'BattleMapAutomationEditor',
    'AdventureMapAutomationEditor', 'NewAutomationEditor', 'ColosseumAutomationEditor', 'AutomationHistoryScreen']) {
    if (request.endsWith('/' + name)) return { [name]: host(name) };
  }
  return original(request, parent, isMain);
};
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { HomeTabScreen } = require('../../main/screens/HomeTabScreen') as typeof import('../../main/screens/HomeTabScreen');
const { FixedBottomActionHost } = require('../../main/components/FixedBottomAction') as
  typeof import('../../main/components/FixedBottomAction');
modules._load = original;
afterEach(async () => { await rntl.cleanup(); confirmButtons = []; backHandlers.clear(); });

const preset = (id: number, name: string): AutomationPresetDetailResponse => ({ id, name, revision: '0',
  settings: { entries: [{ sourceEntryId: 7, type: 'FISHING', enabled: false, quests: [], battleMaps: [], adventureMaps: [] }] } });

async function setup(initial: AutomationPresetDetailResponse[] = [], lifecycle: TypedAutomationAggregateResponse['runtime']['lifecycle'] = 'STOPPED', enabled = false) {
  const current: TypedAutomationAggregateResponse = { entries: [{ id: 7, type: initial[0]?.settings.entries[0]?.type ?? 'FISHING', priority: 0,
    enabled, ready: true, warnings: [], quests: [], battleMaps: [], adventureMaps: [], battleMapProgress: [] }],
    runtime: { lifecycle, stopReason: null, nextAttemptAt: null, warnings: [], lastError: null,
      currentAction: null, dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null } } };
  const records = new Map(initial.map(record => [record.id, structuredClone(record)]));
  let applied = 0;
  let paused = 0;
  let failSave = false;
  let failGet = false;
  const unexpected = async (): Promise<TypedAutomationAggregateResponse> => { throw new Error('실행 설정을 직접 바꾸면 안 됩니다.'); };
  const live = new UnifiedAutomationController({ fetch: async () => structuredClone(current), create: unexpected,
    delete: unexpected, reorder: unexpected, updateQuest: unexpected, updateBattle: unexpected, updateAdventure: unexpected,
    fetchQuests: async () => [], changeState: async action => {
      assert.equal(action, 'pause'); paused++; current.runtime.lifecycle = 'PAUSED'; return structuredClone(current);
    } });
  const editor: AutomationPresetEditor = new AutomationPresetEditor({ fetchCurrent: async () => structuredClone(current),
    list: async () => [...records.values()].map(record => ({ id: record.id, name: record.name, entryCount: record.settings.entries.length, updatedAt: '' })),
    get: async id => { if (failGet) throw new Error('불러오기 실패'); return structuredClone(records.get(id)!); },
    getApplied: async () => null, fetchQuests: async () => [],
    save: async (request, id) => {
      if (failSave) throw new Error('저장 실패');
      const record = { ...structuredClone(request), id: id ?? Math.max(0, ...records.keys()) + 1, revision: '1' };
      records.set(record.id, record); return structuredClone(record);
    },
    apply: async id => {
      applied++;
      const record = records.get(id)!;
      current.entries = current.entries.map(entry => ({ ...entry,
        enabled: record.settings.entries.find(saved => saved.sourceEntryId === entry.id)?.enabled ?? entry.enabled }));
      return { automation: structuredClone(current), preset: record };
    },
    remove: async id => { records.delete(id); return [...records.values()].map(record => ({ id: record.id, name: record.name, entryCount: record.settings.entries.length, updatedAt: '' })); },
    onApplied: async () => { await live.load(); },
  });
  live.presetEditor = editor;
  await live.load();
  await rntl.render(React.createElement(HomeTabScreen, { authenticated: true, status: null,
    automationController: live, battle: makeBattleResource(), partyPresetCatalog: makePartyPresetCatalogResource({ folders: [], presets: [] }),
    onOpenCaptcha: () => undefined, onOpenAppSettings: () => undefined }), { wrapper: FixedBottomActionHost });
  const user = rntl.userEvent.setup();
  await user.press(rntl.screen.getByRole('button', { name: '설정 열기' }));
  return { editor, user, records, current, applied: () => applied, paused: () => paused,
    failSave: () => { failSave = true; }, failGet: () => { failGet = true; } };
}

it('목록에서는 기본 카드만 보이고 프리셋에 들어가 항목을 편집·저장한 뒤 다시 연다', async () => {
  const { editor, user, records, current, applied } = await setup();
  assert.ok(rntl.screen.getByRole('button', { name: '기본 프리셋 설정' }));
  assert.equal(rntl.screen.queryByLabelText('자동화 프리셋 이름'), null);
  assert.equal(rntl.screen.queryByText('자동화 항목'), null);
  assert.equal(rntl.screen.queryByLabelText('고정 하단 작업'), null);
  await user.press(rntl.screen.getByRole('button', { name: '기본 프리셋 설정' }));
  assert.ok(rntl.screen.getByDisplayValue('기본'));
  assert.ok(rntl.screen.getByText('자동화 항목'));
  assert.equal(rntl.screen.queryByText('내 프리셋'), null);
  await user.press(rntl.screen.getByRole('button', { name: 'FISHING 전환' }));
  await user.press(rntl.screen.getByRole('button', { name: '새 프리셋 저장' }));
  assert.equal(records.get(1)?.settings.entries[0]?.enabled, true);
  await user.press(rntl.screen.getByRole('button', { name: '프리셋 목록으로' }));
  assert.equal(rntl.screen.queryByLabelText('고정 하단 작업'), null);
  await user.press(rntl.screen.getByRole('button', { name: '기본 프리셋 설정' }));
  assert.equal(editor.draft.getSnapshot().aggregate?.entries[0]?.enabled, true);
  assert.equal(current.entries[0]?.enabled, false);
  assert.equal(applied(), 0);
});

it('실행 중에도 프리셋을 편집·저장하고 항목 구성 전체 교체는 일시정지 후 적용한다', async () => {
  const { editor, user, records, applied, paused } = await setup([preset(1, '일상')], 'RUNNING');
  await user.press(rntl.screen.getByRole('button', { name: '일상 프리셋 설정' }));
  await rntl.act(() => editor.draft.createEntry('COLOSSEUM'));
  const footer = rntl.within(rntl.screen.getByLabelText('고정 하단 작업'));
  assert.ok(footer.getByRole('button', { name: '자동화에 전체 적용', disabled: true }));
  await user.clear(rntl.screen.getByLabelText('자동화 프리셋 이름'));
  await user.type(rntl.screen.getByLabelText('자동화 프리셋 이름'), '일상 수정');
  await user.press(footer.getByRole('button', { name: '변경사항 저장' }));
  assert.equal(records.get(1)?.name, '일상 수정');
  assert.equal(applied(), 0);
  await user.press(footer.getByRole('button', { name: '자동화 일시정지' }));
  assert.equal(paused(), 1);
  await user.press(footer.getByRole('button', { name: '자동화에 전체 적용' }));
  assert.equal(applied(), 0);
  await rntl.act(() => confirmButtons.find(({ text }) => text === '적용')?.onPress?.());
  assert.equal(applied(), 1);
});

it('목록으로 돌아갈 때 취소·저장 실패는 초안을 유지하고 버리면 저장본을 보존한다', async () => {
  const { user, editor, records, failSave } = await setup([preset(1, '일상'), preset(2, '휴식')]);
  await user.press(rntl.screen.getByRole('button', { name: '일상 프리셋 설정' }));
  await user.type(rntl.screen.getByLabelText('자동화 프리셋 이름'), ' 수정');
  await user.press(rntl.screen.getByRole('button', { name: '프리셋 목록으로' }));
  await rntl.act(() => confirmButtons.find(({ text }) => text === '취소')?.onPress?.());
  assert.ok(rntl.screen.getByDisplayValue('일상 수정'));
  failSave();
  await user.press(rntl.screen.getByRole('button', { name: '프리셋 목록으로' }));
  await rntl.act(() => confirmButtons.find(({ text }) => text === '저장 후 이동')?.onPress?.());
  assert.ok(rntl.screen.getByDisplayValue('일상 수정'));
  assert.equal(editor.getSnapshot().dirty, true);
  await user.press(rntl.screen.getByRole('button', { name: '프리셋 목록으로' }));
  await rntl.act(() => confirmButtons.find(({ text }) => text === '버리고 이동')?.onPress?.());
  assert.ok(rntl.screen.getByRole('button', { name: '휴식 프리셋 설정' }));
  assert.equal(records.get(1)?.name, '일상');
  assert.equal(rntl.screen.queryByLabelText('자동화 프리셋 이름'), null);
});

it('기기 뒤로가기도 저장 후 목록으로 이동하고 목록에서 다시 누르면 대시보드로 간다', async () => {
  const { user, records } = await setup([preset(1, '일상')]);
  await user.press(rntl.screen.getByRole('button', { name: '일상 프리셋 설정' }));
  await user.type(rntl.screen.getByLabelText('자동화 프리셋 이름'), ' 수정');
  await rntl.act(() => [...backHandlers].at(-1)?.());
  await rntl.act(() => confirmButtons.find(({ text }) => text === '저장 후 이동')?.onPress?.());
  assert.equal(records.get(1)?.name, '일상 수정');
  assert.ok(rntl.screen.getByRole('button', { name: '일상 수정 프리셋 설정' }));
  await rntl.act(() => [...backHandlers].at(-1)?.());
  assert.ok(rntl.screen.getByRole('button', { name: '설정 열기' }));
});

it('선택한 프리셋을 삭제하면 목록으로 돌아가고 현재 실행 설정은 보존한다', async () => {
  const { user, records, current } = await setup([preset(1, '일상')]);
  await user.press(rntl.screen.getByRole('button', { name: '일상 프리셋 설정' }));
  await user.press(rntl.screen.getByRole('button', { name: '선택한 자동화 프리셋 삭제' }));
  await rntl.act(() => confirmButtons.find(({ text }) => text === '삭제')?.onPress?.());
  assert.equal(records.size, 0);
  assert.ok(rntl.screen.getByRole('button', { name: '기본 프리셋 설정' }));
  assert.equal(rntl.screen.queryByLabelText('고정 하단 작업'), null);
  assert.equal(current.entries.length, 1);
});

it('저장본을 불러오지 못하면 목록에 머물고 10개를 저장하면 새로 만들기를 막는다', async () => {
  const { user, failGet } = await setup(Array.from({ length: 10 }, (_, i) => preset(i + 1, '프리셋 ' + (i + 1))));
  assert.ok(rntl.screen.getByRole('button', { name: '현재 설정으로 새 프리셋 만들기', disabled: true }));
  failGet();
  await user.press(rntl.screen.getByRole('button', { name: '프리셋 1 프리셋 설정' }));
  assert.equal(rntl.screen.queryByLabelText('자동화 프리셋 이름'), null);
  assert.ok(rntl.screen.getByRole('alert'));
});

it('일시정지 마무리 중에는 적용을 막고 상태를 새로 확인해도 편집 초안은 유지한다', async () => {
  const { user, current, editor } = await setup([preset(1, '일상')], 'DRAINING');
  await user.press(rntl.screen.getByRole('button', { name: '일상 프리셋 설정' }));
  assert.ok(rntl.screen.getByRole('button', { name: '자동화에 전체 적용', disabled: true }));
  await user.type(rntl.screen.getByLabelText('자동화 프리셋 이름'), ' 수정');
  current.runtime.lifecycle = 'PAUSED';
  await user.press(rntl.screen.getByRole('button', { name: '자동화 실행 상태 새로고침' }));
  assert.ok(rntl.screen.getByRole('button', { name: '자동화에 전체 적용', disabled: false }));
  assert.ok(rntl.screen.getByDisplayValue('일상 수정'));
  assert.equal(editor.getSnapshot().dirty, true);
});

it('저장본을 열지 않고 목록에서 바로 삭제할 수 있다', async () => {
  const { user, records, failGet } = await setup([preset(1, '기본1'), preset(2, '기본2')], 'RUNNING');
  failGet();
  await user.press(rntl.screen.getByRole('button', { name: '기본1 프리셋 삭제' }));
  await rntl.act(() => confirmButtons.find(({ text }) => text === '삭제')?.onPress?.());
  assert.equal(records.has(1), false);
  assert.ok(rntl.screen.getByRole('button', { name: '기본2 프리셋 설정' }));
  assert.equal(rntl.screen.queryByLabelText('자동화 프리셋 이름'), null);
});

it('다른 이름으로 저장은 별도 이름을 받아 원본 프리셋을 보존한다', async () => {
  const { user, records } = await setup([preset(1, '기본1')], 'RUNNING');
  await user.press(rntl.screen.getByRole('button', { name: '기본1 프리셋 설정' }));
  await user.press(rntl.screen.getByRole('button', { name: '다른 이름으로 프리셋 전체 저장' }));
  assert.ok(rntl.screen.getByLabelText('새 프리셋 이름'));
  await user.type(rntl.screen.getByLabelText('새 프리셋 이름'), '기본2');
  await user.press(rntl.screen.getByRole('button', { name: '새 이름으로 저장' }));
  assert.equal(records.get(1)?.name, '기본1');
  assert.equal(records.get(2)?.name, '기본2');
});

it('항목을 끈 구성을 새 이름으로 저장하고 실행 중에 일시정지 없이 반영한다', async () => {
  const basic = preset(1, '기본1');
  basic.settings.entries[0]!.type = 'COLOSSEUM';
  basic.settings.entries[0]!.enabled = true;
  const { user, current, records, paused, applied } = await setup([basic], 'RUNNING', true);
  await user.press(rntl.screen.getByRole('button', { name: '기본1 프리셋 설정' }));
  await user.press(rntl.screen.getByRole('button', { name: 'COLOSSEUM 전환' }));
  await user.press(rntl.screen.getByRole('button', { name: '다른 이름으로 프리셋 전체 저장' }));
  await user.type(rntl.screen.getByLabelText('새 프리셋 이름'), '기본2');
  await user.press(rntl.screen.getByRole('button', { name: '새 이름으로 저장' }));
  assert.equal(records.get(1)?.settings.entries[0]?.enabled, true);
  assert.equal(records.get(2)?.settings.entries[0]?.enabled, false);
  assert.equal(current.entries[0]?.enabled, true);
  assert.equal(rntl.screen.queryByRole('button', { name: '자동화 일시정지' }), null);
  await user.press(rntl.screen.getByRole('button', { name: '자동화에 전체 적용', disabled: false }));
  await rntl.act(() => confirmButtons.find(({ text }) => text === '적용')?.onPress?.());
  assert.equal(paused(), 0);
  assert.equal(applied(), 1);
  assert.equal(current.runtime.lifecycle, 'RUNNING');
  assert.equal(current.entries[0]?.enabled, false);
});
