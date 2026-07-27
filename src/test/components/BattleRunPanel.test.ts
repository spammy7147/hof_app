import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
const moduleWithLoader = Module as unknown as { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return { StyleSheet: { create: <T,>(value: T) => value }, Text: host('Text'), View: host('View') };
  if (request.endsWith('/BattlePartySelector')) return { BattlePartySelector: host('BattlePartySelector') };
  if (request.endsWith('/PrimaryButton')) return { PrimaryButton: host('PrimaryButton') };
  if (request.endsWith('/BattlePartyPresetPicker')) return { BattlePartyPresetPicker: host('BattlePartyPresetPicker') };
  return originalLoad(request, parent, isMain);
};
const { BattleRunPanel } = require('../../main/features/battle/components/BattleRunPanel') as typeof import('../../main/features/battle/components/BattleRunPanel');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BattleRunPanel party preset catalog', () => {
  it('passes the shared folder catalog through the thin battle picker adapter', async () => {
    const catalog = { folders: [{ id: 1, name: '전투', parentFolderId: null, displayOrder: 0, createdAt: '', updatedAt: '' }], presets: [] };
    const resource = { catalog, loading: false, error: null, retry: () => undefined };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(BattleRunPanel, {
        characters: [], partyPresetCatalog: resource, isRunning: false, result: null, errorMessage: null,
        onRunBattle: () => undefined,
      }));
    });
    const picker = renderer.root.find((node) => String(node.type) === 'BattlePartyPresetPicker');
    assert.equal(picker.props.catalog, catalog);
    assert.equal(picker.props.presets, undefined);
  });
});
