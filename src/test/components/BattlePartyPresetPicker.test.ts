import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

import type { PartyPresetResponse } from '../../main/types/api';

const focusCalls: number[] = [];
let nativeHandle = 11;
const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({ name }), [name]);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const reactNativeMock = {
  AccessibilityInfo: { setAccessibilityFocus: (handle: number) => focusCalls.push(handle) },
  ActivityIndicator: host('ActivityIndicator'),
  findNodeHandle: (node: unknown) => node == null ? null : nativeHandle,
  Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  View: host('View'),
};
const commonPickerCalls: Record<string, unknown>[] = [];
const commonPickerMock = (props: Record<string, unknown>) => {
  commonPickerCalls.push(props);
  return React.createElement('PartyPresetPickerModal', props);
};
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'lucide-react-native') return iconsMock;
  if (request.endsWith('/components/PartyPresetPickerModal')) return { PartyPresetPickerModal: commonPickerMock };
  return originalLoad(request, parent, isMain);
};
const { BattlePartyPresetPicker } = require(
  '../../main/features/battle/components/BattlePartyPresetPicker',
) as typeof import('../../main/features/battle/components/BattlePartyPresetPicker');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BattlePartyPresetPicker', () => {
  it('keeps the collapsed field and injects direct selection into the shared modal', async () => {
    commonPickerCalls.length = 0;
    const events: string[] = [];
    const renderer = await renderPicker({
      selectedMode: 'direct',
      onSelectDirect: () => events.push('direct'),
      onSelectPreset: (preset: PartyPresetResponse) => events.push(`preset:${preset.id}`),
    });

    const field = renderer.root.findByProps({ accessibilityLabel: '전투 파티 프리셋 선택' });
    assert.deepEqual(field.props.accessibilityState, { expanded: false, disabled: false });
    await act(async () => field.props.onPress());
    const modal = commonPickerCalls.at(-1)!;
    assert.equal(modal.visible, true);
    assert.equal(modal.catalog, CATALOG);
    assert.deepEqual(modal.initialExpandedFolderIds, [null]);
    const direct = (modal.syntheticOptions as Array<Record<string, unknown>>)[0]!;
    assert.equal(direct.label, '캐릭터 직접 선택');
    assert.equal(direct.selected, true);
    await act(async () => (direct.onSelect as () => void)());
    assert.deepEqual(events, ['direct']);
    assert.equal(commonPickerCalls.at(-1)?.visible, false);
    await act(async () => renderer.unmount());
  });

  it('preserves loading, error, retry, and explicit preset callback semantics', async () => {
    let retries = 0;
    const selected: number[] = [];
    const renderer = await renderPicker({
      errorMessage: '불러오기 실패',
      onRetry: () => { retries += 1; },
      onSelectPreset: (preset: PartyPresetResponse) => selected.push(preset.id),
    });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '프리셋 다시 시도' }).props.onPress());
    assert.equal(retries, 1);
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 파티 프리셋 선택' }).props.onPress());
    await act(async () => (commonPickerCalls.at(-1)?.onSelectPreset as (preset: PartyPresetResponse) => void)(PRESETS[0]!));
    assert.deepEqual(selected, [1]);
    await act(async () => renderer.unmount());

    const loading = await renderPicker({ loading: true });
    assert.equal(loading.root.findByProps({ accessibilityLabel: '전투 파티 프리셋 선택' }).props.disabled, true);
    assert.ok(loading.root.findByProps({ accessibilityLabel: '프리셋을 불러오는 중' }));
    await act(async () => loading.unmount());
  });

  it('restores the live trigger after close, direct selection, and preset selection', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    focusCalls.length = 0;
    nativeHandle = 11;
    const renderer = await renderPicker();

    await openPicker(renderer);
    await act(async () => (commonPickerCalls.at(-1)?.onClose as () => void)());
    await act(async () => { context.mock.timers.tick(280); });
    assert.deepEqual(focusCalls, [11]);

    await openPicker(renderer);
    const direct = (commonPickerCalls.at(-1)?.syntheticOptions as Array<Record<string, unknown>>)[0]!;
    await act(async () => (direct.onSelect as () => void)());
    await act(async () => { context.mock.timers.tick(280); });
    assert.deepEqual(focusCalls, [11, 11]);

    await openPicker(renderer);
    await act(async () => (commonPickerCalls.at(-1)?.onSelectPreset as (preset: PartyPresetResponse) => void)(PRESETS[0]!));
    await act(async () => { context.mock.timers.tick(280); });
    assert.deepEqual(focusCalls, [11, 11, 11]);
  });

  it('skips delayed restoration after reopen, unmount, or a native handle replacement', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    focusCalls.length = 0;
    nativeHandle = 11;
    const renderer = await renderPicker();

    await openPicker(renderer);
    await act(async () => (commonPickerCalls.at(-1)?.onClose as () => void)());
    nativeHandle = 12;
    await act(async () => { context.mock.timers.tick(280); });
    assert.deepEqual(focusCalls, []);

    nativeHandle = 13;
    await openPicker(renderer);
    await act(async () => (commonPickerCalls.at(-1)?.onClose as () => void)());
    await openPicker(renderer);
    await act(async () => { context.mock.timers.tick(280); });
    assert.deepEqual(focusCalls, []);

    await act(async () => (commonPickerCalls.at(-1)?.onClose as () => void)());
    await act(async () => renderer.unmount());
    await act(async () => { context.mock.timers.tick(280); });
    assert.deepEqual(focusCalls, []);
  });
});

async function openPicker(renderer: ReturnType<typeof create>) {
  await act(async () => renderer.root.findByProps({ accessibilityLabel: '전투 파티 프리셋 선택' }).props.onPress());
}

async function renderPicker(overrides: Record<string, unknown> = {}) {
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(BattlePartyPresetPicker, {
      characters: [], catalog: CATALOG, loading: false, errorMessage: null,
      selectedMode: null, selectedPresetId: null, onRetry: () => undefined,
      onSelectDirect: () => undefined, onSelectPreset: () => undefined, ...overrides,
    }));
  });
  return renderer;
}

const PRESETS: PartyPresetResponse[] = [{ id: 1, accountId: 1, name: '레이드', folderId: null, isPrimary: false, displayOrder: 0, members: [], createdAt: '', updatedAt: '' }];
const CATALOG = {
  folders: [{ id: 10, name: '전투', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' }],
  presets: PRESETS,
};
