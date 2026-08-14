import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';
import type { CharacterManagementActionRequest, CharacterObservedAction } from '../../main/types/api';

const host = (name: string) => React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
  React.createElement(name, { ...props, ref }, props.children as React.ReactNode)
));
const reactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  Alert: { alert: () => undefined },
  FlatList: host('FlatList'),
  Image: host('Image'),
  Modal: host('Modal'),
  Pressable: host('Pressable'),
  ScrollView: host('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: host('Text'),
  TextInput: host('TextInput'),
  View: host('View'),
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => (
  request === 'react-native' ? reactNativeMock : originalLoad(request, parent, isMain)
);
const { CharacterDetail, extractAvailableStatPoints, extractPrimaryStatValues, statGroupLabel } = require('../../main/components/CharacterDetail') as typeof import('../../main/components/CharacterDetail');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CharacterDetail stat allocation', () => {
  it('normalizes the malformed point line and stat group names', () => {
    assert.equal(extractAvailableStatPoints(['Status ?Point : 25']), 25);
    assert.equal(statGroupLabel('upStr'), 'STR');
    assert.equal(statGroupLabel('upLuk'), 'LUK');
    assert.deepEqual(
      extractPrimaryStatValues(['STR : 128 + 95 (Real STR +38)', 'LUK : 10 + 77']),
      { STR: '223', LUK: '87' },
    );
  });

  it('keeps hundreds of server candidates in five compact controls and submits a directly entered value', async () => {
    const requests: CharacterManagementActionRequest[] = [];
    const action = statAction();
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        character: makeHofCharacter(),
        detail: makeHofCharacterDetail(1, { statusLines: ['Status ?Point : 25', 'DEX : 34 + 9'] }),
        isLoading: false,
        errorMessage: null,
        actions: [action],
        onExecuteAction: async (request: CharacterManagementActionRequest) => {
          requests.push(request);
          return { character: makeHofCharacterDetail(), actions: [action], messages: [], characters: [], targetRemoved: false };
        },
      }));
    });

    const statsNavigation = renderer.root.findAllByProps({ accessibilityRole: 'tab' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '능력치').length > 0
    ));
    await act(async () => statsNavigation?.props.onPress());

    const text = renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
    assert.ok(text.includes('STR'));
    assert.ok(text.includes('DEX'));
    assert.ok(text.includes('INT'));
    assert.ok(text.includes('SPD'));
    assert.ok(text.includes('LUK'));
    assert.ok(text.includes('43'));
    assert.ok(text.includes('남음 25 · 배분 0'));
    assert.equal(text.some((value) => /^\+\d+$/.test(value)), false);
    assert.equal(text.includes('Increase Status'), false);
    assert.equal(text.includes('현재 상태'), false);

    assert.equal(renderer.root.findAllByProps({ accessibilityRole: 'radio' }).length, 0);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'TextInput' && node.props.accessibilityRole === 'spinbutton').length, 5);

    const dexInput = renderer.root.find((node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'DEX 배분량');
    await act(async () => dexInput.props.onChangeText('2'));
    const apply = renderer.root.findAllByProps({ accessibilityRole: 'button' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '스탯 적용').length > 0
    ));
    await act(async () => apply?.props.onPress());

    assert.equal(requests.length, 1);
    assert.ok(requests[0].action.selections?.some(({ candidateId }) => candidateId === 'upDex-2'));
  });

  it('shows pattern editing controls immediately without opening a generic accordion', async () => {
    const requests: CharacterManagementActionRequest[] = [];
    const action: CharacterObservedAction = {
      actionId: 'pattern-set',
      source: 'changepattern',
      label: 'Set Pattern',
      candidates: [
        { id: 'judge-always', groupId: 'judge0', label: '항상', selectionType: 'SELECT', minQuantity: 1, maxQuantity: 1, selected: true },
        { id: 'judge-hp', groupId: 'judge0', label: 'HP가 낮을 때', selectionType: 'SELECT', minQuantity: 1, maxQuantity: 1, selected: false },
        { id: 'skill-slash', groupId: 'skill0', label: 'Quick Slash', selectionType: 'SELECT', minQuantity: 1, maxQuantity: 1, selected: true },
      ],
      fields: [{ id: 'quantity0', label: '1번 기준값', value: '0', inputType: 'NUMBER', maxLength: 3 }],
    };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        character: makeHofCharacter(),
        detail: makeHofCharacterDetail(),
        isLoading: false,
        errorMessage: null,
        actions: [action],
        onExecuteAction: async (request: CharacterManagementActionRequest) => {
          requests.push(request);
          return { character: makeHofCharacterDetail(), actions: [action], messages: [], characters: [], targetRemoved: false };
        },
      }));
    });

    const patternTab = renderer.root.findAllByProps({ accessibilityRole: 'tab' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '패턴').length > 0
    ));
    await act(async () => patternTab?.props.onPress());

    assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '1번 행동 조건 선택' }).length > 0);
    assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '1번 실행 스킬 선택' }).length > 0);
    assert.ok(renderer.root.findAllByProps({ accessibilityLabel: '1번 기준값' }).length > 0);

    const conditionSelector = renderer.root.findAllByProps({ accessibilityLabel: '1번 행동 조건 선택' })[0];
    await act(async () => conditionSelector.props.onPress());
    const candidateList = renderer.root.findAll((node) => String(node.type) === 'FlatList').at(-1);
    const hpCandidate = candidateList?.props.data.find((candidate: CharacterObservedAction['candidates'][number]) => candidate.id === 'judge-hp');
    const hpOption = candidateList?.props.renderItem({ item: hpCandidate });
    await act(async () => hpOption.props.onPress());

    const quantity = renderer.root.findAllByProps({ accessibilityLabel: '1번 기준값' })[0];
    await act(async () => quantity.props.onChangeText('35'));
    const apply = renderer.root.findAllByProps({ accessibilityRole: 'button' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '행동 패턴 적용').length > 0
    ));
    await act(async () => apply?.props.onPress());

    assert.equal(requests.length, 1);
    assert.ok(requests[0].action.selections?.some(({ candidateId }) => candidateId === 'judge-hp'));
    assert.ok(requests[0].action.values?.some(({ fieldId, value }) => fieldId === 'quantity0' && value === '35'));
  });
});

function statAction(): CharacterObservedAction {
  const groups = ['upStr', 'upDex', 'upInt', 'upSpd', 'upLuk'];
  return {
    actionId: 'increase-status',
    source: 'status',
    label: 'Increase Status',
    candidates: groups.flatMap((groupId) => Array.from({ length: 237 }, (_, value) => ({
      id: `${groupId}-${value}`,
      groupId,
      label: `+${value}`,
      selectionType: 'SELECT' as const,
      minQuantity: 1,
      maxQuantity: 1,
      selected: value === 0,
    }))),
    fields: [],
  };
}
