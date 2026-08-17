import assert from 'node:assert/strict';
import Module from 'node:module';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';
import type { CharacterCommand, CharacterPatternApplyRequest } from '../../main/types/api';

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
const draggableFlatList = (props: Record<string, unknown>) => React.createElement(
  'DraggableFlatList',
  props,
  (props.data as unknown[]).map((item, index) => React.createElement(
    React.Fragment,
    { key: (props.keyExtractor as (value: unknown) => string)(item) },
    (props.renderItem as (value: { item: unknown; getIndex: () => number; drag: () => void; isActive: boolean }) => React.ReactNode)({ item, getIndex: () => index, drag: () => undefined, isActive: false }),
  )),
);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => (
  request === 'react-native' ? reactNativeMock
    : request === 'react-native-draggable-flatlist' ? { __esModule: true, default: draggableFlatList }
      : originalLoad(request, parent, isMain)
);
const { CharacterDetail, extractAvailableStatPoints, extractPrimaryStatValues, statGroupLabel } = require('../../main/components/CharacterDetail') as typeof import('../../main/components/CharacterDetail');
const { CharacterManagementScreen } = require('../../main/features/characters/management/CharacterManagementScreen') as typeof import('../../main/features/characters/management/CharacterManagementScreen');
const { CharacterSkillsScreen } = require('../../main/features/characters/skills/CharacterSkillsScreen') as typeof import('../../main/features/characters/skills/CharacterSkillsScreen');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CharacterDetail stat allocation', () => {
  it('keeps remaining skill points with the content and filters the compact skill list by category', async () => {
    const detail = makeHofCharacterDetail(1, {
      stats: { ...makeHofCharacterDetail().stats, skillPoints: 12 },
      learnedSkills: [
        { value: 'a', name: 'Parrying', iconUrl: '', category: 'Support', targetText: 'self', scopeText: 'individual', spCost: 0, description: '데미지 1회 무효화' },
        { value: 'b', name: 'Quick Slash', iconUrl: '', category: 'Attack', targetText: 'enemy', scopeText: 'individual', spCost: 5, description: '빠른 공격' },
      ],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterSkillsScreen, { detail }));
    });

    const text = () => renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
    assert.ok(text().includes('남은 Skill Point'));
    assert.ok(text().includes('12'));
    assert.ok(text().includes('Parrying'));
    assert.ok(text().includes('Quick Slash'));

    const category = renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '전체 분류').length > 0
    ));
    await act(async () => category?.props.onPress());
    const picker = renderer.root.findAll((node) => String(node.type) === 'FlatList').at(-1);
    const support = picker?.props.renderItem({ item: 'Support' });
    await act(async () => support.props.onPress());

    assert.ok(text().includes('Parrying'));
    assert.equal(text().includes('Quick Slash'), false);
  });

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
    const requests: CharacterCommand[] = [];
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        character: makeHofCharacter(),
        detail: makeHofCharacterDetail(1, { stats: { ...makeHofCharacterDetail().stats, statusPoints: 25, dexReal: 34, dexBonus: 9 } }),
        isLoading: false,
        errorMessage: null,
        onCommand: async (request: CharacterCommand) => {
          requests.push(request);
        },
      }));
    });

    const text = renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
    assert.ok(text.includes('STR'));
    assert.ok(text.includes('DEX'));
    assert.ok(text.includes('INT'));
    assert.ok(text.includes('SPD'));
    assert.ok(text.includes('LUK'));
    assert.ok(text.includes('34 + 9'));
    assert.ok(text.includes('Status Point 25'));
    assert.equal(text.some((value) => /^\+\d+$/.test(value)), false);
    assert.equal(text.includes('Increase Status'), false);
    assert.equal(text.includes('현재 상태'), false);

    assert.equal(renderer.root.findAllByProps({ accessibilityRole: 'radio' }).length, 0);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'TextInput' && node.props.accessibilityRole === 'spinbutton').length, 5);

    const dexInput = renderer.root.find((node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'DEX 추가 포인트');
    await act(async () => dexInput.props.onChangeText('2'));
    const apply = renderer.root.findAllByProps({ accessibilityRole: 'button' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '적용').length > 0
    ));
    await act(async () => apply?.props.onPress());

    assert.equal(requests.length, 1);
    assert.equal(requests[0].type, 'ALLOCATE_STATS');
    assert.equal(requests[0].type === 'ALLOCATE_STATS' ? requests[0].amounts.DEX : null, 2);
  });

  it('shows pattern editing controls immediately without opening a generic accordion', async () => {
    const requests: CharacterPatternApplyRequest[] = [];
    let pauseRequests = 0;
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        character: makeHofCharacter(),
        detail: makeHofCharacterDetail(1, { actionPatterns: [{ index: 0, judge: 'always', judgeText: '항상', quantity: '0', quantityText: '', skill: 'slash', skillText: 'Quick Slash' }], patternOptions: [{ type: 'CONDITION', value: 'always', label: '항상', category: null }, { type: 'CONDITION', value: 'hp', label: 'HP가 낮을 때', category: 'HP' }, { type: 'SKILL', value: 'slash', label: 'Quick Slash', category: null }], positionGuard: { positions: [{ value: 'front', checked: true }], selectedPosition: 'front', guardValue: 'always', guardText: '항상' } }),
        isLoading: false,
        errorMessage: null,
        onApplyPattern: async (request: CharacterPatternApplyRequest) => {
          requests.push(request);
          return {};
        },
        onBeginPatternEdit: async () => { pauseRequests += 1; },
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
    const hpCandidate = candidateList?.props.data.find((candidate: { value: string }) => candidate.value === 'hp');
    const hpOption = candidateList?.props.renderItem({ item: hpCandidate });
    await act(async () => hpOption.props.onPress());

    const quantity = renderer.root.findAllByProps({ accessibilityLabel: '1번 기준값' })[0];
    await act(async () => quantity.props.onChangeText('35'));
    const apply = renderer.root.findAllByProps({ accessibilityRole: 'button' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '저장').length > 0
    ));
    await act(async () => apply?.props.onPress());

    assert.equal(requests.length, 1);
    assert.equal(requests[0].draft.rows[0].judge, 'hp');
    assert.equal(requests[0].draft.rows[0].quantity, '35');
    assert.equal(requests[0].baseRevision, '2026-08-17T00:00:00Z');
    assert.equal(pauseRequests, 1);
  });

  it('renders the dedicated equipment skill and management screens from one character API snapshot', async () => {
    const detail = makeHofCharacterDetail(1, {
      equipment: [{ slot: 'weapon', part: 'Weapon', name: 'Soulcollector Sword', iconUrl: 'https://hof.test/sword.gif', description: 'Atk +96', checked: true }],
      equipmentCandidates: [{ value: 'w-2', typeCode: 'weapon', name: 'Royal Claymore', iconUrl: 'https://hof.test/claymore.gif', description: 'Atk +110', quantity: null }],
      learnedSkills: [{ value: 'p', name: 'Parrying', iconUrl: '', category: 'Support', targetText: 'self', scopeText: 'individual', spCost: 0, description: '데미지 1회 무효화' }],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        character: makeHofCharacter(), detail, isLoading: false, errorMessage: null,
      }));
    });
    const openTab = async (label: string) => {
      const tab = renderer.root.findAllByProps({ accessibilityRole: 'tab' }).find((node) => (
        node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0
      ));
      await act(async () => tab?.props.onPress());
    };
    const text = () => renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));

    await openTab('장비');
    assert.ok(text().includes('Soulcollector Sword'));
    assert.ok(text().includes('전체 해제'));
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'Image' && node.props.source?.uri === 'https://hof.test/sword.gif').length, 1);

    await openTab('스킬');
    assert.ok(text().includes('Parrying'));
    assert.ok(text().includes('데미지 1회 무효화'));

    await openTab('관리');
    assert.ok(text().includes('이름 변경'));
    assert.ok(text().includes('Knockback'));
  });

  it('keeps the requested slot replacement when the user confirms a pattern conflict', async () => {
    const requests: CharacterPatternApplyRequest[] = [];
    const detail = makeHofCharacterDetail(1, {
      actionPatterns: [{ index: 0, judge: 'always', judgeText: '항상', quantity: '0', quantityText: '', skill: 'slash', skillText: 'Quick Slash' }],
      patternOptions: [{ type: 'CONDITION', value: 'always', label: '항상', category: null }, { type: 'SKILL', value: 'slash', label: 'Quick Slash', category: null }],
      patternSlots: [{ slot: '2', label: '대회랑', canLoad: true }],
      positionGuard: { positions: [{ value: 'front', checked: true }], selectedPosition: 'front', guardValue: 'always', guardText: '항상' },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        character: makeHofCharacter(), detail, isLoading: false, errorMessage: null,
        onApplyPattern: async (request: CharacterPatternApplyRequest) => {
          requests.push(request);
          return requests.length === 1
            ? { currentRevision: '2026-08-17T00:01:00Z', rowDiffs: [{ rowNumber: 1, before: request.base.rows[0] ?? null, current: { judge: 'changed', quantity: '1', skill: 'slash' } }] }
            : { revision: '2026-08-17T00:02:00Z' };
        },
      }));
    });
    const patternTab = renderer.root.findAllByProps({ accessibilityRole: 'tab' }).find((node) => node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '패턴').length > 0);
    await act(async () => patternTab?.props.onPress());
    const replace = renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '교체').length > 0);
    await act(async () => replace?.props.onPress());
    const overwrite = renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '덮어쓰기').length > 0);
    await act(async () => overwrite?.props.onPress());

    assert.equal(requests.length, 2);
    assert.equal(requests[1].force, true);
    assert.equal(requests[1].slotAction, 'REPLACE');
    assert.equal(requests[1].targetSlotCode, '2');
    assert.equal(requests[1].slotName, '대회랑');
  });

  it('shows recommended Knockback links first and lets the user open the full roster', async () => {
    const linked: Array<[number, string]> = [];
    const detail = makeHofCharacterDetail();
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterManagementScreen, {
        detail,
        characters: [makeHofCharacter()],
        onCommand: async () => ({
          type: 'IdentityResolutionRequired' as const,
          characterId: detail.id,
          message: '새 캐릭터 연결을 선택해 주세요.',
          candidates: [
            { hofCharacterId: 'recommended', name: '추천 후보', job: 'Knight', level: 60, matchingFields: ['name', 'job', 'level'] },
            { hofCharacterId: 'other', name: '다른 캐릭터', job: 'Mage', level: 42, matchingFields: [] },
          ],
        }),
        onLinkCharacter: async (characterId: number, hofCharacterId: string) => {
          linked.push([characterId, hofCharacterId]);
        },
      }));
    });

    const pray = renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '기도').length > 0
    ));
    await act(async () => pray?.props.onPress());
    const textBefore = renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
    assert.ok(textBefore.includes('추천 후보'));
    assert.equal(textBefore.includes('다른 캐릭터'), false);

    const showAll = renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '전체 캐릭터 보기').length > 0
    ));
    await act(async () => showAll?.props.onPress());
    const other = renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '다른 캐릭터').length > 0
    ));
    await act(async () => other?.props.onPress());
    assert.deepEqual(linked, [[detail.id, 'other']]);
  });
});
