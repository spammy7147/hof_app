import { UnifiedAutomationController, type UnifiedAutomationControllerApi } from './unifiedAutomationController';
import { canAddAutomationType } from './typedAutomation';
import { toUserFacingErrorMessage } from './userFacingErrors';
import type {
  AppliedAutomationPresetResponse, AutomationPresetApplyResponse, AutomationPresetDetailResponse, AutomationPresetResponse,
  AutomationPresetSettings, AutomationType, QuestSnapshot, SaveAutomationPresetRequest,
  TypedAutomationAggregateResponse, TypedAutomationEntryResponse,
} from '../types/api';

export type AutomationPresetEditorApi = {
  fetchCurrent: () => Promise<TypedAutomationAggregateResponse>;
  list: () => Promise<AutomationPresetResponse[]>;
  get: (id: number) => Promise<AutomationPresetDetailResponse>;
  getApplied: () => Promise<AppliedAutomationPresetResponse | null>;
  save: (request: SaveAutomationPresetRequest, id?: number) => Promise<AutomationPresetDetailResponse>;
  remove: (id: number) => Promise<AutomationPresetResponse[]>;
  apply: (id: number, revision: string) => Promise<AutomationPresetApplyResponse>;
  fetchQuests: () => Promise<QuestSnapshot[]>;
  onApplied?: () => Promise<void>;
};

type EditorSnapshot = {
  loaded: boolean; busy: boolean; dirty: boolean; name: string; selectedId: number | null;
  revision: string | null; presets: AutomationPresetResponse[];
  applied: AppliedAutomationPresetResponse | null; error: string | null; message: string | null;
};
const initial = (): EditorSnapshot => ({ loaded: false, busy: false, dirty: false, name: '', selectedId: null,
  revision: null, presets: [], applied: null, error: null, message: null });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const emptyAggregate = (): TypedAutomationAggregateResponse => ({ entries: [], runtime: { lifecycle: 'STOPPED',
  stopReason: null, nextAttemptAt: null, warnings: [], lastError: null, currentAction: null,
  dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null } } });

export function automationPresetSettings(entries: readonly TypedAutomationEntryResponse[]): AutomationPresetSettings {
  return { entries: entries.map(entry => ({ sourceEntryId: Math.max(0, entry.id), type: entry.type,
    enabled: entry.enabled, displayName: entry.displayName?.trim() || null, minimumRemainingTime: entry.minimumRemainingTime ?? null,
    quests: clone(entry.quests), homeQuests: clone(entry.homeQuests ?? []), battleMaps: clone(entry.battleMaps),
    adventureMaps: clone(entry.adventureMaps).map(map => ({ ...map, displayName: null })),
    fishingMaps: clone(entry.fishingMaps ?? []).map(map => ({ ...map, displayName: null })),
    unionMaps: clone(entry.unionMaps ?? []).map(map => ({ ...map, displayName: null })), raidTargets: clone(entry.raidTargets ?? []) })) };
}

/** 저장·적용 경계를 분리하고 기존 편집 화면은 메모리의 구성만 변경한다. */
export class AutomationPresetEditor {
  readonly draft: UnifiedAutomationController;
  private snapshot = initial();
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private local = emptyAggregate();
  private current = emptyAggregate();
  private baseline: { settings: AutomationPresetSettings; name: string; id: number | null; revision: string | null } | null = null;
  private replacing = false;

  constructor(private readonly api: AutomationPresetEditorApi) {
    this.draft = new UnifiedAutomationController(this.draftApi());
    this.draft.subscribe(() => {
      const aggregate = this.draft.getSnapshot().aggregate;
      if (!aggregate || !this.baseline || this.replacing) return;
      const dirty = this.snapshot.name !== this.baseline.name
        || JSON.stringify(automationPresetSettings(aggregate.entries)) !== JSON.stringify(this.baseline.settings);
      if (dirty !== this.snapshot.dirty) this.patch({ dirty });
    });
  }

  getSnapshot = (): EditorSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  reset(): void {
    this.generation++;
    this.baseline = null;
    this.replacing = false;
    this.local = this.current = emptyAggregate();
    this.draft.reset();
    this.snapshot = initial();
    this.listeners.forEach(listener => listener());
  }

  async initialize(): Promise<boolean> {
    if (this.snapshot.loaded) return true;
    if (this.snapshot.busy) return false;
    return this.operation(async generation => {
      const [current, presets, applied] = await Promise.all([this.api.fetchCurrent(), this.api.list(), this.api.getApplied()]);
      if (generation !== this.generation) return;
      this.current = clone(current);
      await this.replaceDraft(automationPresetSettings(current.entries), '', null, null);
      if (generation === this.generation) this.patch({ loaded: true, presets, applied });
    });
  }

  /** 최초 초기화가 이미 만든 초안을 같은 진입에서 다시 받지 않는다. 이후 진입은 새 구성을 읽는다. */
  async beginCurrentEdit(): Promise<boolean> {
    return this.snapshot.loaded ? this.select(null) : this.initialize();
  }

  setName(name: string): void {
    if (this.snapshot.busy) return;
    this.patch({ name, dirty: name !== this.baseline?.name
      || JSON.stringify(automationPresetSettings(this.draft.getSnapshot().aggregate?.entries ?? [])) !== JSON.stringify(this.baseline?.settings) });
  }

  async select(id: number | null): Promise<boolean> {
    if (this.snapshot.dirty || this.snapshot.busy) return false;
    return this.operation(async generation => {
      if (id == null) {
        const current = await this.api.fetchCurrent();
        if (generation !== this.generation) return;
        this.current = clone(current);
        await this.replaceDraft(automationPresetSettings(current.entries), '', null, null);
      } else {
        const detail = await this.api.get(id);
        if (generation !== this.generation) return;
        await this.replaceDraft(detail.settings, detail.name, detail.id, detail.revision);
      }
    });
  }

  async discard(): Promise<void> {
    if (this.baseline && !this.snapshot.busy) {
      const baseline = this.baseline;
      await this.replaceDraft(baseline.settings, baseline.name, baseline.id, baseline.revision);
    }
  }

  canApplyWhileRunning(): boolean {
    const entries = this.draft.getSnapshot().aggregate?.entries;
    const withoutEnabled = (items: readonly TypedAutomationEntryResponse[]) =>
      automationPresetSettings(items).entries.map(entry => ({ ...entry, enabled: false }));
    return this.snapshot.loaded && entries != null
      && JSON.stringify(withoutEnabled(entries)) === JSON.stringify(withoutEnabled(this.current.entries));
  }

  async save(asNew = false, newName = this.snapshot.name): Promise<boolean> {
    const name = newName.trim();
    if (!name || name.length > 100) { this.patch({ error: '프리셋 이름은 1~100자로 입력해 주세요.' }); return false; }
    if (this.snapshot.presets.some(preset => preset.name === name && (asNew || preset.id !== this.snapshot.selectedId))) {
      this.patch({ error: '같은 이름의 프리셋이 있어요. 다른 이름을 입력해 주세요.' }); return false;
    }
    return this.operation(async generation => {
      const id = asNew ? undefined : this.snapshot.selectedId ?? undefined;
      const settings = automationPresetSettings(this.draft.getSnapshot().aggregate?.entries ?? []);
      const detail = await this.api.save({ name, settings, ...(id == null ? {} : { revision: this.snapshot.revision! }) }, id);
      if (generation !== this.generation) return;
      await this.replaceDraft(detail.settings, detail.name, detail.id, detail.revision);
      if (generation !== this.generation) return;
      const summary = { id: detail.id, name: detail.name, entryCount: detail.settings.entries.length, updatedAt: detail.updatedAt ?? '' };
      const presets = this.snapshot.presets.some(p => p.id === detail.id)
        ? this.snapshot.presets.map(p => p.id === detail.id ? summary : p) : [...this.snapshot.presets, summary];
      this.patch({ presets, message: '프리셋 전체를 저장했어요. 자동화에 적용하면 실행 설정이 바뀌어요.' });
      try {
        const applied = await this.api.getApplied();
        if (generation === this.generation) this.patch({ applied });
      } catch {
        if (generation === this.generation) this.patch({ message: '전체 저장은 완료했어요. 현재 적용 상태는 새로고침해 주세요.' });
      }
    });
  }

  async apply(): Promise<boolean> {
    if ((this.snapshot.dirty || this.snapshot.selectedId == null) && !await this.save()) return false;
    return this.operation(async generation => {
      const response = await this.api.apply(this.snapshot.selectedId!, this.snapshot.revision!);
      if (generation !== this.generation) return;
      this.current = clone(response.automation);
      await this.replaceDraft(response.preset.settings, response.preset.name, response.preset.id, response.preset.revision);
      if (generation !== this.generation) return;
      this.patch({ applied: { id: response.preset.id, name: response.preset.name, revision: response.preset.revision,
        matchesCurrent: true }, message: response.automation.runtime.lifecycle === 'RUNNING'
          ? '변경사항을 실행 중인 자동화에 반영했어요.' : '프리셋 전체를 적용했어요. 자동화를 시작하거나 재개해 주세요.' });
      try { await this.api.onApplied?.(); }
      catch { if (generation === this.generation) this.patch({ message: '프리셋은 적용됐어요. 실행 상태를 새로고침해 주세요.' }); }
    });
  }

  async refresh(): Promise<boolean> {
    return this.operation(async generation => {
      const [presets, applied] = await Promise.all([this.api.list(), this.api.getApplied()]);
      if (generation === this.generation) this.patch({ presets, applied });
    });
  }

  async remove(deletedId = this.snapshot.selectedId): Promise<boolean> {
    if (deletedId == null) return false;
    return this.operation(async generation => {
      const presets = await this.api.remove(deletedId);
      if (generation !== this.generation) return;
      const applied = this.snapshot.applied?.id === deletedId ? null : this.snapshot.applied;
      if (this.snapshot.selectedId === deletedId) {
        await this.replaceDraft(automationPresetSettings(this.current.entries), '', null, null);
      }
      if (generation === this.generation) this.patch({ presets, applied, message: '저장한 프리셋을 삭제했어요. 현재 실행 설정은 유지돼요.' });
    });
  }

  private async replaceDraft(settings: AutomationPresetSettings, name: string, id: number | null, revision: string | null): Promise<void> {
    const generation = this.generation;
    this.replacing = true;
    try {
      this.baseline = { settings: clone(settings), name, id, revision };
      this.local = { ...clone(this.current), entries: settings.entries.map((entry, priority) => ({ ...clone(entry),
        id: entry.sourceEntryId || -(priority + 1), priority, settingsRevision: '0', ready: true, warnings: [],
        battleMapProgress: [], quests: entry.quests ?? [], battleMaps: entry.battleMaps ?? [], adventureMaps: entry.adventureMaps ?? [] })) };
      // 서버 표시용 선택 필드는 편집 초안의 내용 비교에서 제외한다.
      this.baseline.settings = automationPresetSettings(this.local.entries);
      this.draft.reset();
      await this.draft.load();
      if (generation === this.generation) this.patch({ name, selectedId: id, revision, dirty: false });
    } finally { if (generation === this.generation) this.replacing = false; }
  }

  private async operation(action: (generation: number) => Promise<void>): Promise<boolean> {
    const child = this.draft.getSnapshot();
    if (this.snapshot.busy || child.reordering || child.savingEntryIds.length || child.savingTypes.length) return false;
    const generation = this.generation;
    this.patch({ busy: true, error: null, message: null });
    try { await action(generation); return generation === this.generation; }
    catch (error) { if (generation === this.generation) this.patch({ error: toUserFacingErrorMessage(error) }); return false; }
    finally { if (generation === this.generation) this.patch({ busy: false }); }
  }

  private patch(patch: Partial<EditorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }

  private draftApi(): UnifiedAutomationControllerApi {
    const mutate = async (change: (entries: TypedAutomationEntryResponse[]) => TypedAutomationEntryResponse[]) => {
      if (this.snapshot.busy) throw new Error('프리셋을 처리하고 있어요. 완료 후 다시 편집해 주세요.');
      this.local = { ...this.local, entries: change(clone(this.local.entries)).map((entry, priority) => ({ ...entry, priority })) };
      return clone(this.local);
    };
    const update = (type: AutomationType, patch: Partial<TypedAutomationEntryResponse>, id?: number) => mutate(entries => entries.map(entry =>
      (id == null ? entry.type === type : entry.id === id) ? { ...entry, ...patch } : entry));
    return {
      fetch: async () => clone(this.local),
      create: ({ type }) => mutate(entries => {
        if (!canAddAutomationType(entries, type)) throw new Error('추가할 수 없는 자동화 유형입니다.');
        return [...entries, { id: Math.min(0, ...entries.map(e => e.id)) - 1, type, priority: entries.length,
          enabled: false, ready: true, warnings: [], settingsRevision: '0', quests: [], battleMaps: [], adventureMaps: [], battleMapProgress: [] }];
      }),
      delete: id => mutate(entries => entries.filter(e => e.id !== id)),
      reorder: ids => mutate(entries => ids.map(id => entries.find(e => e.id === id)!)),
      moveMap: (targetId, request) => mutate(entries => {
        const source = entries.find(e => e.id === request.sourceEntryId);
        const target = entries.find(e => e.id === targetId);
        if (!source || !target || source.type !== target.type) throw new Error('같은 유형의 맵 묶음만 이동할 수 있어요.');
        const transfer = <T extends { categoryId: string; mapCode: string; executionOrder: number }>(from: T[], to: T[]) => {
          const match = (map: T) => map.categoryId === request.categoryId && map.mapCode === request.mapCode;
          const moved = from.find(match);
          if (!moved || to.some(match) || !Number.isInteger(request.targetExecutionOrder) || request.targetExecutionOrder < 0) {
            throw new Error('이동할 맵과 대상 위치를 확인해 주세요.');
          }
          const next = [...to];
          next.splice(Math.min(next.length, request.targetExecutionOrder), 0, moved);
          return [from.filter(map => !match(map)), next].map(maps => maps.map((map, executionOrder) => ({ ...map, executionOrder })));
        };
        if (source.type === 'BATTLE_MAP') {
          const [from, to] = transfer(source.battleMaps, target.battleMaps);
          return entries.map(e => e.id === source.id ? { ...e, battleMaps: from!, enabled: e.enabled && from!.length > 0 }
            : e.id === target.id ? { ...e, battleMaps: to! } : e);
        }
        if (source.type === 'ADVENTURE_MAP') {
          const [from, to] = transfer(source.adventureMaps, target.adventureMaps);
          return entries.map(e => e.id === source.id ? { ...e, adventureMaps: from!, enabled: e.enabled && from!.length > 0 }
            : e.id === target.id ? { ...e, adventureMaps: to! } : e);
        }
        throw new Error('맵 묶음만 이동할 수 있어요.');
      }),
      updateQuest: request => update('QUEST', request),
      updateHomeQuest: request => update('HOME_QUEST', { enabled: request.enabled, homeQuests: request.quests }),
      updateColosseum: request => update('COLOSSEUM', request),
      updateBattle: request => update('BATTLE_MAP', { enabled: request.enabled, battleMaps: request.maps, minimumRemainingTime: request.minimumRemainingTime ?? null }),
      updateAdventure: request => update('ADVENTURE_MAP', { enabled: request.enabled, adventureMaps: request.maps }),
      updateBattleGroup: (id, request) => update('BATTLE_MAP', { enabled: request.enabled, displayName: request.displayName,
        minimumRemainingTime: request.minimumRemainingTime ?? null, battleMaps: request.maps }, id),
      updateAdventureGroup: (id, request) => update('ADVENTURE_MAP', { enabled: request.enabled, displayName: request.displayName, adventureMaps: request.maps }, id),
      updateFishing: request => update('FISHING', { enabled: request.enabled, fishingMaps: request.maps }),
      updateUnion: request => update('UNION', { enabled: request.enabled, unionMaps: request.maps }),
      updateRaid: request => update('RAID', { enabled: request.enabled, raidTargets: request.targets }),
      fetchQuests: () => this.api.fetchQuests(),
      changeState: async () => { throw new Error('프리셋 편집은 자동화 실행 상태를 바꾸지 않습니다.'); },
    };
  }
}
