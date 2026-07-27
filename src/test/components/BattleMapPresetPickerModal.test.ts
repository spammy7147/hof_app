import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

import type { PartyPresetResponse } from '../../main/types/api';

const commonPickerCalls: Record<string, unknown>[] = [];
const commonPickerMock = (props: Record<string, unknown>) => {
  commonPickerCalls.push(props);
  return React.createElement('PartyPresetPickerModal', props);
};
const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const reactNativeMock = {
  AccessibilityInfo: { setAccessibilityFocus: () => undefined },
  FlatList: host('FlatList'), Modal: host('Modal'), Pressable: host('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles }, Text: host('Text'),
  TextInput: host('TextInput'), View: host('View'), findNodeHandle: () => 1,
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request.endsWith('/components/PartyPresetPickerModal')) return { PartyPresetPickerModal: commonPickerMock };
  return originalLoad(request, parent, isMain);
};
const { BattleMapPresetPickerModal } = require(
  '../../main/features/automation/components/BattleMapPresetPickerModal',
) as typeof import('../../main/features/automation/components/BattleMapPresetPickerModal');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BattleMapPresetPickerModal', () => {
  it('is a translation adapter that injects the primary choice and preserves nullable callbacks', async () => {
    commonPickerCalls.length = 0;
    const selected: Array<number | null> = [];
    await act(async () => {
      create(React.createElement(BattleMapPresetPickerModal, {
        disabled: false, mapName: '화염 동굴', onClose: () => undefined,
        onSelect: (presetId: number | null) => selected.push(presetId), presets: PRESETS,
        selectedPresetId: null, selectedPresetMode: 'PRIMARY', visible: true,
      }));
    });

    assert.equal(commonPickerCalls.length, 1);
    const modal = commonPickerCalls[0]!;
    assert.equal(modal.title, '화염 동굴 프리셋 선택');
    assert.deepEqual(modal.catalog, { folders: [], presets: PRESETS });
    const primary = (modal.syntheticOptions as Array<Record<string, unknown>>)[0]!;
    assert.equal(primary.label, '대표 · 대표 파티');
    assert.equal(primary.selected, true);
    await act(async () => (primary.onSelect as () => void)());
    await act(async () => (modal.onSelectPreset as (preset: PartyPresetResponse) => void)(PRESETS[1]!));
    assert.deepEqual(selected, [null, 2]);
  });

  it('labels a missing primary preset without owning an independent flat list', async () => {
    commonPickerCalls.length = 0;
    await act(async () => {
      create(React.createElement(BattleMapPresetPickerModal, {
        disabled: true, mapName: '', onClose: () => undefined, onSelect: () => undefined,
        presets: [], selectedPresetId: null, selectedPresetMode: 'PRIMARY', visible: true,
      }));
    });
    const modal = commonPickerCalls[0]!;
    assert.equal((modal.syntheticOptions as Array<Record<string, unknown>>)[0]?.label, '대표 프리셋 없음');
    assert.equal(modal.disabled, true);
  });
});

const PRESETS: PartyPresetResponse[] = [
  { id: 1, accountId: 1, name: '대표 파티', folderId: null, isPrimary: true, displayOrder: 0, members: [], createdAt: '', updatedAt: '' },
  { id: 2, accountId: 1, name: '공략 파티', folderId: null, isPrimary: false, displayOrder: 1, members: [], createdAt: '', updatedAt: '' },
];
