import { makeBattleResource } from '../fixtures/battleResource';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { TypedAutomationAggregateResponse } from '../../main/types/api';
import { makePartyPresetCatalogResource } from '../fixtures/partyPresetCatalog';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement(name, { ...props, ref }, props.children as React.ReactNode)
));
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  View: host('View'),
};
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
const dashboardMock = (props: Record<string, unknown>) => React.createElement(
  'Pressable',
  { accessibilityLabel: '설정 열기', onPress: props.onOpenSettings },
);
const settingsMock = () => React.createElement('UnifiedAutomationSettings');
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') return iconsMock;
  if (request === 'react-native-draggable-flatlist') return { NestableScrollContainer: host('NestableScrollContainer') };
  if (request.endsWith('/HomeStatusSummary')) return { HomeStatusSummary: host('HomeStatusSummary') };
  if (request.endsWith('/UnifiedAutomationDashboard')) return { UnifiedAutomationDashboard: dashboardMock };
  if (request.endsWith('/UnifiedAutomationSettings')) return { UnifiedAutomationSettings: settingsMock };
  if (request.endsWith('/QuestAutomationEditor')) return { QuestAutomationEditor: host('QuestAutomationEditor') };
  if (request.endsWith('/BattleMapAutomationEditor')) return { BattleMapAutomationEditor: host('BattleMapAutomationEditor') };
  if (request.endsWith('/AdventureMapAutomationEditor')) return { AdventureMapAutomationEditor: host('AdventureMapAutomationEditor') };
  if (request.endsWith('/NewAutomationEditor')) return { NewAutomationEditor: host('NewAutomationEditor') };
  return originalLoad(request, parent, isMain);
};
const { HomeTabScreen } = require('../../main/screens/HomeTabScreen') as typeof import('../../main/screens/HomeTabScreen');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

describe('HomeTabScreen dashboard polling', () => {
  it('publishes the latest status observation from an automation aggregate', async () => {
    fakeTimeouts();
    const observed = {
      playerName: '공민이',
      funds: 331_708_318,
      timeCurrent: 5900,
      timeMax: 6000,
      work: 'Nothing',
      auction: 'Nothing',
      observedAt: '2026-07-24T10:00:01Z',
    };
    const received: unknown[] = [];
    const controller = controllerStub(async () => undefined, undefined, observed);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(HomeTabScreen, {
        ...props(controller),
        onStatusObserved: (status: unknown) => received.push(status),
      }));
    });

    assert.deepEqual(received, [observed]);
    assert.deepEqual(
      renderer.root.find((node) => String(node.type) === 'HomeStatusSummary').props.status,
      observed,
    );
    await act(async () => { renderer.unmount(); });
  });

  it('refreshes every three seconds without overlapping and stops outside the dashboard', async () => {
    const timers = fakeTimeouts();
    const first = deferred<void>();
    const second = deferred<void>();
    const loads = [first, second];
    let calls = 0;
    const controller = controllerStub(async () => {
      const pending = loads[calls++];
      if (pending) await pending.promise;
    });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(HomeTabScreen, props(controller))); });

    assert.equal(calls, 1);
    assert.equal(timers.pendingCount(), 0);
    await act(async () => { timers.runAll(); });
    assert.equal(calls, 1);

    await act(async () => { first.resolve(); await first.promise; });
    assert.deepEqual(timers.delays(), [3_000]);
    await act(async () => { timers.runNext(); });
    assert.equal(calls, 2);
    assert.equal(timers.pendingCount(), 0);
    await act(async () => { timers.runAll(); });
    assert.equal(calls, 2);

    await act(async () => { second.resolve(); await second.promise; });
    assert.equal(timers.pendingCount(), 1);
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '설정 열기' }).props.onPress(); });
    assert.equal(timers.pendingCount(), 0);
    await act(async () => { timers.runAll(); });
    assert.equal(calls, 2);
  });

  it('cancels pending refreshes on logout and unmount, including while a load is in flight', async () => {
    const timers = fakeTimeouts();
    const pending = deferred<void>();
    let calls = 0;
    let resets = 0;
    const controller = controllerStub(async () => { calls += 1; await pending.promise; }, () => { resets += 1; });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(HomeTabScreen, props(controller))); });
    assert.equal(calls, 1);

    await act(async () => {
      renderer.update(React.createElement(HomeTabScreen, { ...props(controller), authenticated: false }));
    });
    assert.equal(resets, 1);
    await act(async () => { pending.resolve(); await pending.promise; });
    assert.equal(timers.pendingCount(), 0);
    await act(async () => { renderer.unmount(); });
    await act(async () => { timers.runAll(); });
    assert.equal(calls, 1);
  });
});

function controllerStub(
  load: () => Promise<void>,
  reset = () => undefined,
  hofStatus?: TypedAutomationAggregateResponse['hofStatus'],
) {
  const aggregate: TypedAutomationAggregateResponse = {
    entries: [],
    runtime: {
      lifecycle: 'RUNNING',
      stopReason: null,
      nextAttemptAt: null,
      warnings: [],
      lastError: null,
      currentAction: null,
      dailyRefresh: { status: 'PENDING', refreshDate: null, refreshedAt: null },
    },
    hofStatus,
  };
  const snapshot = {
    aggregate,
    loading: false,
    actionSaving: false,
    savingEntryIds: [],
    savingTypes: [],
    reordering: false,
    error: null,
    message: null,
  };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    load,
    reset,
    clearMessage: () => undefined,
    showMessage: () => undefined,
    isEntryBusy: () => false,
    changeState: async () => undefined,
  } as never;
}

function props(automationController: never) {
  return {
    authenticated: true,
    status: null,
    automationController,
    battle: makeBattleResource(),
    partyPresetCatalog: makePartyPresetCatalogResource({ folders: [], presets: [] }),
    onOpenCaptcha: () => undefined,
    onOpenAppSettings: () => undefined,
    onStatusObserved: () => undefined,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve: (value?: T) => resolve(value as T) };
}

function fakeTimeouts() {
  let nextId = 1;
  const pending = new Map<number, { callback: () => void; delay: number }>();
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
    const id = nextId++;
    pending.set(id, { callback: callback as () => void, delay: delay ?? 0 });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    pending.delete(id as unknown as number);
  }) as typeof clearTimeout;
  return {
    delays: () => [...pending.values()].map(({ delay }) => delay),
    pendingCount: () => pending.size,
    runNext: () => {
      const first = pending.entries().next().value as [number, { callback: () => void }] | undefined;
      if (!first) return;
      pending.delete(first[0]);
      first[1].callback();
    },
    runAll: () => {
      const callbacks = [...pending.values()].map(({ callback }) => callback);
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}
