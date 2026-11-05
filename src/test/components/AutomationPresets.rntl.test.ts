import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, it } from 'node:test';
import React from 'react';
import { AutomationPresetEditor } from '../../main/domain/automationPresetEditor';
import type { AutomationPresetDetailResponse, TypedAutomationAggregateResponse } from '../../main/types/api';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name,
  { ...props, accessible: props.accessible ?? (name === 'Pressable' ? true : undefined),
    'aria-disabled': props.disabled }, props.children as React.ReactNode);
let confirmButtons: Array<{ text: string; onPress?: () => void }> = [];
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const modules = Module as unknown as { _load: Loader };
const original = modules._load;
modules._load = (request, parent, isMain) => {
  if (request === 'react-native') return {
    ActivityIndicator: host('ActivityIndicator'), Pressable: host('Pressable'), TextInput: host('TextInput'),
    Text: host('Text'), View: host('View'), Alert: { alert: (_title: string, _message: string, buttons: typeof confirmButtons) => { confirmButtons = buttons; } },
    StyleSheet: { create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style },
  };
  if (request === 'lucide-react-native') return new Proxy({}, { get: (_target, name) => host(String(name)) });
  return original(request, parent, isMain);
};
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { AutomationPresets } = require('../../main/features/automation/components/AutomationPresets') as
  typeof import('../../main/features/automation/components/AutomationPresets');
const { FixedBottomActionHost } = require('../../main/components/FixedBottomAction') as
  typeof import('../../main/components/FixedBottomAction');
modules._load = original;
afterEach(async () => { await rntl.cleanup(); confirmButtons = []; });

it('새 프리셋 저장 후 목록에서 구성을 다시 불러오고 실행 설정은 유지한다', async () => {
  const current: TypedAutomationAggregateResponse = { entries: [{ id: 7, type: 'FISHING', priority: 0,
    enabled: false, ready: true, warnings: [], quests: [], battleMaps: [], adventureMaps: [], battleMapProgress: [] }],
    runtime: { lifecycle: 'STOPPED', stopReason: null, nextAttemptAt: null, warnings: [], lastError: null,
      currentAction: null, dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null } } };
  const records = new Map<number, AutomationPresetDetailResponse>();
  let applied = 0;
  const editor = new AutomationPresetEditor({ fetchCurrent: async () => current, list: async () => [],
    get: async id => structuredClone(records.get(id)!), getApplied: async () => null,
    save: async (request, id) => {
      const record = { ...request, id: id ?? 1, revision: '1' };
      records.set(record.id, structuredClone(record));
      return record;
    },
    apply: async () => { applied++; return { automation: current, preset: records.get(1)! }; },
    remove: async () => [], fetchQuests: async () => [],
  });
  await editor.initialize();
  await rntl.render(React.createElement(AutomationPresets, { editor, lifecycle: 'STOPPED', onRefresh: () => undefined, onPause: () => undefined }),
    { wrapper: FixedBottomActionHost });
  const user = rntl.userEvent.setup();
  assert.ok(rntl.screen.getByRole('button', { name: '저장한 프리셋 불러오기', disabled: true }));
  assert.ok(rntl.screen.getByText('아직 저장한 프리셋이 없어요'));
  assert.ok(rntl.screen.getByRole('button', { name: '새 프리셋 저장', disabled: true }));
  await user.type(rntl.screen.getByLabelText('자동화 프리셋 이름'), '낚시');
  await rntl.act(() => editor.draft.saveFishingSettings({ enabled: true, maps: [] }));
  await user.press(rntl.screen.getByRole('button', { name: '새 프리셋 저장' }));
  assert.equal(records.get(1)?.settings.entries[0]?.enabled, true);
  assert.ok(rntl.screen.getByRole('button', { name: '변경사항 저장' }));
  assert.ok(rntl.screen.getByText('편집 중인 프리셋: 낚시'));
  await user.press(rntl.screen.getByRole('button', { name: '현재 설정으로 새 프리셋 만들기' }));
  assert.equal(editor.getSnapshot().selectedId, null);
  assert.equal(editor.draft.getSnapshot().aggregate?.entries[0]?.enabled, false);
  await user.press(rntl.screen.getByRole('button', { name: '저장한 프리셋 불러오기' }));
  await user.press(rntl.screen.getByRole('button', { name: '낚시 프리셋 불러오기' }));
  assert.ok(rntl.screen.getByDisplayValue('낚시'));
  assert.equal(editor.draft.getSnapshot().aggregate?.entries[0]?.enabled, true);
  assert.equal(editor.getSnapshot().dirty, false);
  assert.equal(current.entries[0]?.enabled, false);
  assert.equal(applied, 0);
  assert.ok(rntl.screen.getByText('저장·불러오기는 실행 설정을 바꾸지 않아요.'));
});


it('상단에서 전체 구성을 선택하고 공통 저장·적용을 구분한다', async () => {
  const current: TypedAutomationAggregateResponse = { entries: [], runtime: { lifecycle: 'RUNNING', stopReason: null,
    nextAttemptAt: null, warnings: [], lastError: null, currentAction: null,
    dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null } } };
  let record: AutomationPresetDetailResponse = { id: 1, name: '일상', revision: '0', settings: { entries: [{
    sourceEntryId: 0, type: 'FISHING', enabled: false, quests: [], battleMaps: [], adventureMaps: [],
  }] } };
  const saved: unknown[] = [];
  let applied = 0;
  let paused = 0;
  const editor = new AutomationPresetEditor({
    fetchCurrent: async () => current,
    list: async () => [{ id: 1, name: '일상', entryCount: 1, updatedAt: '' }],
    get: async () => record, getApplied: async () => null,
    save: async request => { saved.push(request); record = { id: 1, ...request, revision: '1' }; return record; },
    apply: async () => { applied++; return { automation: current, preset: record }; },
    remove: async () => [], fetchQuests: async () => [],
  });
  await editor.initialize();
  const props = { editor, lifecycle: 'RUNNING' as const, onPause: () => { paused++; }, onRefresh: () => undefined };
  const user = rntl.userEvent.setup();
  await rntl.render(React.createElement(AutomationPresets, props), { wrapper: FixedBottomActionHost });
  const footer = rntl.within(rntl.screen.getByLabelText('고정 하단 작업'));
  assert.ok(footer.getByRole('button', { name: '새 프리셋 저장', disabled: true }));
  assert.ok(footer.getByRole('button', { name: '자동화에 전체 적용', disabled: true }));
  await user.press(rntl.screen.getByRole('button', { name: '저장한 프리셋 불러오기' }));
  await user.press(rntl.screen.getByRole('button', { name: '일상 프리셋 불러오기' }));
  assert.ok(rntl.screen.getByDisplayValue('일상'));
  await user.clear(rntl.screen.getByLabelText('자동화 프리셋 이름'));
  await user.type(rntl.screen.getByLabelText('자동화 프리셋 이름'), '일상 수정');
  await user.press(rntl.screen.getByRole('button', { name: '변경사항 저장' }));
  assert.equal(saved.length, 1);
  assert.equal(applied, 0);
  assert.equal(editor.getSnapshot().dirty, false);
  assert.ok(rntl.screen.getByRole('button', { name: '자동화에 전체 적용', disabled: true }));
  await user.press(rntl.screen.getByRole('button', { name: '자동화 일시정지' }));
  assert.equal(paused, 1);
  await rntl.screen.rerender(React.createElement(AutomationPresets, { ...props, lifecycle: 'PAUSED' }));
  await user.press(rntl.screen.getByRole('button', { name: '자동화에 전체 적용' }));
  assert.equal(applied, 0);
  await rntl.act(() => confirmButtons.find(({ text }) => text === '적용')?.onPress?.());
  assert.equal(applied, 1);
  await rntl.screen.rerender(React.createElement('Text', {}, '다른 화면'));
  assert.equal(rntl.screen.queryByLabelText('고정 하단 작업'), null);
});

it('현재 적용 구성과 편집 중인 프리셋·저장 상태를 구분하고 실행 마무리 중에는 적용을 막는다', async () => {
  const current: TypedAutomationAggregateResponse = { entries: [], runtime: { lifecycle: 'DRAINING', stopReason: null,
    nextAttemptAt: null, warnings: [], lastError: null, currentAction: null,
    dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null } } };
  const editor = new AutomationPresetEditor({ fetchCurrent: async () => current,
    list: async () => [{ id: 2, name: '사냥', entryCount: 0, updatedAt: '' }],
    get: async () => ({ id: 2, name: '사냥', revision: '0', settings: { entries: [] } }),
    getApplied: async () => ({ id: 1, name: '일상', revision: '0', matchesCurrent: false }),
    fetchQuests: async () => [], remove: async () => [],
    save: async () => { throw new Error('저장하지 않음'); }, apply: async () => { throw new Error('적용하지 않음'); },
  });
  await editor.initialize(); await editor.select(2);
  await rntl.render(React.createElement(AutomationPresets, { editor, lifecycle: 'DRAINING', onRefresh: () => undefined, onPause: () => undefined }),
    { wrapper: FixedBottomActionHost });
  assert.ok(rntl.screen.getByText('일상'));
  assert.ok(rntl.screen.getByText('적용 후 설정이 변경되어 저장본과 달라요.'));
  assert.ok(rntl.screen.getByDisplayValue('사냥'));
  assert.ok(rntl.screen.getByText('저장됨'));
  assert.ok(rntl.screen.getByRole('button', { name: '자동화에 전체 적용', disabled: true }));
  assert.equal(rntl.screen.queryByRole('button', { name: '자동화 일시정지' }), null);
  await rntl.userEvent.setup().type(rntl.screen.getByLabelText('자동화 프리셋 이름'), ' 수정');
  assert.ok(rntl.screen.getByText('저장하지 않은 변경사항'));
  assert.ok(rntl.screen.getByText('저장하고 적용'));
  assert.equal(editor.getSnapshot().applied?.name, '일상');
});

it('프리셋 전환에서 취소·저장 실패는 초안을 유지하고 버리기를 선택하면 이동한다', async () => {
  const current: TypedAutomationAggregateResponse = { entries: [], runtime: { lifecycle: 'STOPPED', stopReason: null,
    nextAttemptAt: null, warnings: [], lastError: null, currentAction: null,
    dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null } } };
  const editor = new AutomationPresetEditor({ fetchCurrent: async () => current,
    list: async () => [{ id: 1, name: '일상', entryCount: 0, updatedAt: '' }, { id: 2, name: '휴식', entryCount: 0, updatedAt: '' }],
    get: async id => ({ id, name: id === 1 ? '일상' : '휴식', revision: '0', settings: { entries: [] } }),
    getApplied: async () => null, fetchQuests: async () => [], remove: async () => [],
    save: async () => { throw new Error('저장 실패'); }, apply: async () => { throw new Error('적용하지 않음'); },
  });
  await editor.initialize(); await editor.select(1);
  const user = rntl.userEvent.setup();
  await rntl.render(React.createElement(AutomationPresets, { editor, lifecycle: 'STOPPED', onRefresh: () => undefined, onPause: () => undefined }));
  await user.clear(rntl.screen.getByLabelText('자동화 프리셋 이름'));
  await user.type(rntl.screen.getByLabelText('자동화 프리셋 이름'), '편집 중');
  await user.press(rntl.screen.getByRole('button', { name: '저장한 프리셋 불러오기' }));
  await user.press(rntl.screen.getByRole('button', { name: '휴식 프리셋 불러오기' }));
  await rntl.act(() => confirmButtons.find(({ text }) => text === '취소')?.onPress?.());
  assert.ok(rntl.screen.getByDisplayValue('편집 중'));
  await user.press(rntl.screen.getByRole('button', { name: '휴식 프리셋 불러오기' }));
  await rntl.act(() => confirmButtons.find(({ text }) => text === '저장 후 이동')?.onPress?.());
  assert.equal(editor.getSnapshot().selectedId, 1);
  assert.equal(editor.getSnapshot().dirty, true);
  await user.press(rntl.screen.getByRole('button', { name: '휴식 프리셋 불러오기' }));
  await rntl.act(() => confirmButtons.find(({ text }) => text === '버리고 이동')?.onPress?.());
  assert.ok(rntl.screen.getByDisplayValue('휴식'));
  assert.equal(editor.getSnapshot().dirty, false);
});
