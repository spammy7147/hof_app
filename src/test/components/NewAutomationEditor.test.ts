import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type {
  BattleMapResponse,
  PartyPresetCatalogResponse,
  RaidPubResponse,
  TypedAutomationEntryResponse,
} from '../../main/types/api';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  React.useImperativeHandle(ref, () => ({}), []);
  return React.createElement(name, props, props.children as React.ReactNode);
});
const modal = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  props.visible ? React.createElement('Modal', { ...props, ref }, props.children as React.ReactNode) : null
));
const reactNativeMock = {
  AccessibilityInfo: { setAccessibilityFocus: () => undefined },
  ActivityIndicator: host('ActivityIndicator'),
  FlatList: host('FlatList'),
  findNodeHandle: (node: unknown) => node,
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  Modal: modal,
  Platform: { OS: 'ios' },
  Pressable: host('Pressable'),
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Switch: host('Switch'),
  Text: host('Text'),
  TextInput: host('TextInput'),
  View: host('View'),
};
const iconsMock = new Proxy({}, { get: (_target, property) => host(String(property)) });
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return reactNativeMock;
  if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }) };
  if (request === 'lucide-react-native') return iconsMock;
  if (request === 'react-native-draggable-flatlist') return {
    NestableScrollContainer: (props: Record<string, unknown>) => React.createElement(
      'NestableScrollContainer', props, props.children as React.ReactNode,
    ),
  };
  return originalLoad(request, parent, isMain);
};
const { NewAutomationEditor } = require(
  '../../main/features/automation/components/NewAutomationEditor',
) as typeof import('../../main/features/automation/components/NewAutomationEditor');
moduleWithLoader._load = originalLoad;

describe('NewAutomationEditor', () => {
  it('shows observed fishing battle maps with an independent preset picker', async () => {
    const renderer = await renderEditor({
      entry: entry('FISHING', {
        fishingMaps: [{ categoryId: 'battle_map', mapCode: 'fish-1', executionOrder: 0, presetMode: 'PRIMARY', partyPresetId: null }],
      }),
      maps: [map('battle_map', 'fish-1', '거대 잉어', '낚시터 전투')],
    });

    assert.equal(hasText(renderer.root, '1. 거대 잉어'), true);
    const trigger = renderer.root.findByProps({ accessibilityLabel: '거대 잉어 프리셋 선택 열기' });
    assert.equal(hasText(trigger, '대표 · 기본 파티'), true);
  });

  it('hydrates union codes with map names and uses the shared preset picker trigger', async () => {
    const renderer = await renderEditor({
      entry: entry('UNION', {
        unionMaps: [{ categoryId: 'union', mapCode: '0003', executionOrder: 0, presetMode: 'PRIMARY', partyPresetId: null }],
      }),
      maps: [map('union', '0003', '0003'), map('union', '0004', '0004')],
    });

    assert.equal(hasText(renderer.root, '1. 도적소탕'), true);
    assert.equal(hasText(renderer.root, '1. 0003'), false);
    const trigger = renderer.root.findByProps({ accessibilityLabel: '도적소탕 프리셋 선택 열기' });
    assert.equal(hasText(trigger, '대표 · 기본 파티'), true);
  });

  it('offers every observed union map even when it is not currently available', async () => {
    const renderer = await renderEditor({
      entry: entry('UNION'),
      maps: [
        map('union', '0003', '0003'),
        { ...map('union', '0004', '0004'), enabled: false },
      ],
    });

    assert.equal(hasText(renderer.root, '전체 유니온 맵'), true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '도적소탕 추가' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '사막의 살인적 추가' }));
  });

  it('loads selectable raids from the raid pub instead of the battle map catalog', async () => {
    const raidPub: RaidPubResponse = {
      raids: [{
        id: 'RaidGoblin', name: '고블린 전투 마차', playable: true, difficulty: null, maxPartySize: null,
        rewardDamage: null, status: 'RECRUITING', statusText: null, waitSeconds: null, applicants: [],
        joined: false, actions: ['REGISTER'], battleTarget: null,
      }],
      applied: false, applyWait: false, applyWaitSeconds: null, myStatus: null, globalActions: [], result: null,
    };
    const renderer = await renderEditor({ entry: entry('RAID'), maps: [], raidPub });

    assert.equal(hasText(renderer.root, '고블린 전투 마차'), true);
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '고블린 전투 마차 레이드 추가' }));
  });
});

async function renderEditor({
  entry: value,
  maps,
  raidPub = emptyRaidPub(),
}: {
  entry: TypedAutomationEntryResponse;
  maps: BattleMapResponse[];
  raidPub?: RaidPubResponse;
}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(NewAutomationEditor, {
      entry: value,
      mutationMessage: null,
      onBack: () => undefined,
      onLoadBattleMaps: async () => maps,
      onLoadRaidTargets: async () => raidPub,
      onSave: async () => true,
      partyPresetCatalog: { catalog: presets(), loading: false, error: null, retry: () => undefined },
      saving: false,
    } as React.ComponentProps<typeof NewAutomationEditor>));
    await Promise.resolve();
  });
  return renderer;
}

function entry(type: 'FISHING' | 'UNION' | 'RAID', overrides: Partial<TypedAutomationEntryResponse> = {}): TypedAutomationEntryResponse {
  return {
    id: type === 'UNION' ? 5 : 4,
    type,
    enabled: false,
    priority: 3,
    ready: true,
    warnings: [],
    quests: [],
    battleMaps: [],
    battleMapProgress: [],
    adventureMaps: [],
    unionMaps: [],
    raidTargets: [],
    ...overrides,
  };
}

function map(categoryId: string, mapCode: string, name: string, groupName: string | null = null): BattleMapResponse {
  return {
    categoryId, mapCode, name, groupName, groupOrder: 0, mapOrder: 0, recommendedLevel: null,
    availableCount: null, attemptCount: null, winCount: null, cooldownRemainingText: null,
    cooldownRemainingSeconds: null, keyMode: 'NOT_REQUIRED', keyCount: null, requiredTime: null,
    supportsThreeBattles: false, enabled: true, resolved: true, iconUrl: null, rawHref: '',
  };
}

function presets(): PartyPresetCatalogResponse {
  return {
    folders: [],
    presets: [{
      id: 9, accountId: 1, name: '기본 파티', displayOrder: 0, isPrimary: true, members: [],
      createdAt: '', updatedAt: '', folderId: null,
    }],
  };
}

function emptyRaidPub(): RaidPubResponse {
  return { raids: [], applied: false, applyWait: false, applyWaitSeconds: null, myStatus: null, globalActions: [], result: null };
}

function hasText(root: ReactTestInstance, expected: string): boolean {
  return root.findAll((node) => (node.type as unknown) === 'Text' && flattenText(node.props.children) === expected).length > 0;
}

function flattenText(value: unknown): string {
  if (Array.isArray(value)) return value.map(flattenText).join('');
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
