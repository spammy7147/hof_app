import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AutomationPresetEditor } from '../../main/domain/automationPresetEditor';
import type { AutomationPresetDetailResponse, TypedAutomationAggregateResponse } from '../../main/types/api';

it('프리셋 전체를 편집·저장·다시 선택해도 다른 프리셋과 실행 중 구성이 바뀌지 않는다', async () => {
  const current: TypedAutomationAggregateResponse = { entries: [], runtime: { lifecycle: 'RUNNING', stopReason: null,
    nextAttemptAt: null, warnings: [], lastError: null, currentAction: null,
    dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null } } };
  const records = new Map<number, AutomationPresetDetailResponse>([
    [1, { id: 1, name: '일상', revision: '0', settings: { entries: [{ sourceEntryId: 0, type: 'FISHING' as const, enabled: false,
      quests: [], homeQuests: [], battleMaps: [], adventureMaps: [], fishingMaps: [], unionMaps: [], raidTargets: [] }] } }],
    [2, { id: 2, name: '휴식', revision: '0', settings: { entries: [] } }],
  ]);
  const editor = new AutomationPresetEditor({
    fetchCurrent: async () => structuredClone(current),
    list: async () => [...records.values()].map(p => ({ id: p.id, name: p.name, entryCount: p.settings.entries.length, updatedAt: '' })),
    get: async id => structuredClone(records.get(id)!),
    getApplied: async () => null,
    save: async (request, id) => {
      const result = { id: id ?? 3, name: request.name, revision: '1', settings: structuredClone(request.settings) };
      records.set(result.id, result);
      return result;
    },
    remove: async () => [], apply: async () => ({ automation: current, preset: records.get(1)! }), fetchQuests: async () => [],
  });
  await editor.initialize();
  await editor.select(1);
  await editor.draft.saveFishingSettings({ enabled: true, maps: [] });
  await editor.draft.createEntry('COLOSSEUM');
  assert.equal(editor.getSnapshot().dirty, true);
  assert.equal(await editor.save(), true);
  await editor.select(2);
  assert.deepEqual(editor.draft.getSnapshot().aggregate?.entries, []);
  await editor.select(1);
  assert.deepEqual(editor.draft.getSnapshot().aggregate?.entries.map(({ type, enabled }) => [type, enabled]), [
    ['FISHING', true], ['COLOSSEUM', false],
  ]);
  assert.equal(current.runtime.lifecycle, 'RUNNING');
  assert.deepEqual(current.entries, []);
});

it('초안 저장이 실패하면 적용하지 않고 유지하며 저장 성공 뒤 확인한 버전만 적용한다', async () => {
  let fail = true;
  let applied = 0;
  const saved: AutomationPresetDetailResponse = { id: 1, name: '낚시', revision: '0', settings: { entries: [] } };
  const current: TypedAutomationAggregateResponse = { entries: [], runtime: { lifecycle: 'PAUSED', stopReason: null,
    nextAttemptAt: null, warnings: [], lastError: null, currentAction: null,
    dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null } } };
  const editor = new AutomationPresetEditor({
    fetchCurrent: async () => current, list: async () => [], get: async () => structuredClone(saved), getApplied: async () => null,
    save: async request => {
      if (fail) throw new Error('저장 실패');
      return { ...saved, revision: '1', name: request.name, settings: request.settings };
    },
    apply: async (id, revision) => {
      assert.equal(id, 1); assert.equal(revision, '1'); applied++;
      return { automation: current, preset: { ...saved, name: '바뀐 구성', revision: '2' } };
    }, remove: async () => [], fetchQuests: async () => [],
  });
  await editor.initialize();
  await editor.select(1);
  editor.setName('바뀐 구성');
  assert.equal(await editor.apply(), false);
  assert.equal(applied, 0);
  assert.equal(editor.getSnapshot().dirty, true);
  assert.equal(editor.getSnapshot().name, '바뀐 구성');
  fail = false;
  assert.equal(await editor.apply(), true);
  assert.equal(applied, 1);
  assert.equal(editor.getSnapshot().revision, '2');
  assert.equal(editor.getSnapshot().applied?.matchesCurrent, true);
});

it('같은 초안의 맵 묶음 사이 이동은 원본을 비우고 대상의 실행 순서에 넣는다', async () => {
  const current: TypedAutomationAggregateResponse = { entries: [], runtime: { lifecycle: 'STOPPED', stopReason: null,
    nextAttemptAt: null, warnings: [], lastError: null, currentAction: null,
    dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null } } };
  const editor = new AutomationPresetEditor({ fetchCurrent: async () => current, list: async () => [],
    getApplied: async () => null, fetchQuests: async () => [], remove: async () => [],
    get: async () => { throw new Error('없음'); }, save: async () => { throw new Error('저장하지 않음'); },
    apply: async () => { throw new Error('적용하지 않음'); } });
  await editor.initialize();
  await editor.draft.createEntry('BATTLE_MAP');
  await editor.draft.createEntry('BATTLE_MAP');
  const [source, target] = editor.draft.getSnapshot().aggregate!.entries;
  await editor.draft.saveBattleMapGroup(source!.id, { settingsRevision: '0', displayName: '상위', enabled: true,
    maps: [{ categoryId: 'battle_map', mapCode: 'map-a', dailyTargetCount: 3, executionOrder: 0, presetMode: 'PRIMARY', partyPresetId: null }] });
  assert.equal(await editor.draft.moveMapBetweenGroups(target!.id, { sourceEntryId: source!.id, sourceSettingsRevision: '0',
    targetSettingsRevision: '0', categoryId: 'battle_map', mapCode: 'map-a', targetExecutionOrder: 0 }), true);
  const entries = editor.draft.getSnapshot().aggregate!.entries;
  assert.deepEqual(entries[0]!.battleMaps, []);
  assert.equal(entries[0]!.enabled, false);
  assert.equal(entries[1]!.battleMaps[0]!.mapCode, 'map-a');
  assert.deepEqual(current.entries, []);
});

it('계정 전환 뒤 도착한 이전 프리셋 응답이 새 초안을 만들지 않는다', async () => {
  let finish!: (detail: AutomationPresetDetailResponse) => void;
  const response = new Promise<AutomationPresetDetailResponse>(resolve => { finish = resolve; });
  const current: TypedAutomationAggregateResponse = { entries: [], runtime: { lifecycle: 'STOPPED', stopReason: null,
    nextAttemptAt: null, warnings: [], lastError: null, currentAction: null,
    dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null } } };
  const editor = new AutomationPresetEditor({ fetchCurrent: async () => current, list: async () => [], get: () => response,
    getApplied: async () => null, fetchQuests: async () => [], remove: async () => [],
    save: async () => { throw new Error('저장하지 않음'); }, apply: async () => { throw new Error('적용하지 않음'); } });
  await editor.initialize();
  const selecting = editor.select(1);
  editor.reset();
  finish({ id: 1, name: '이전 계정', revision: '0', settings: { entries: [] } });
  assert.equal(await selecting, false);
  assert.equal(editor.getSnapshot().loaded, false);
  assert.equal(editor.getSnapshot().selectedId, null);
  assert.equal(editor.draft.getSnapshot().aggregate, null);
});

it('같은 최초 편집 진입은 현재 구성을 한 번만 읽고 다음 편집은 다시 확인한다', async () => {
  let reads = 0;
  const current: TypedAutomationAggregateResponse = { entries: [], runtime: { lifecycle: 'STOPPED', stopReason: null,
    nextAttemptAt: null, warnings: [], lastError: null, currentAction: null,
    dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null } } };
  const editor = new AutomationPresetEditor({ fetchCurrent: async () => { reads++; return current; },
    list: async () => [], getApplied: async () => null, fetchQuests: async () => [], remove: async () => [],
    get: async () => { throw new Error('unused'); }, save: async () => { throw new Error('unused'); },
    apply: async () => { throw new Error('unused'); } });
  assert.equal(await editor.beginCurrentEdit(), true);
  assert.equal(reads, 1);
  assert.equal(await editor.beginCurrentEdit(), true);
  assert.equal(reads, 2);
});
