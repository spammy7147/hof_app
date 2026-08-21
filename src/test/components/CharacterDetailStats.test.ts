import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';
import { makeCharacterManagementHubResource } from '../fixtures/characterManagementHub';
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
const draggableFlatList = (hostName: string) => (props: Record<string, unknown>) => React.createElement(
  hostName,
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
const lucideMock = Object.fromEntries(
  ['ArrowLeft', 'RefreshCw', 'ChevronRight', 'ChevronsDown', 'Copy', 'GraduationCap', 'PackageOpen', 'Pencil', 'Sparkles', 'UserRoundX']
    .map((name) => [name, host(name)]),
);
moduleWithLoader._load = (request, parent, isMain) => (
  request === 'react-native' ? reactNativeMock
    : request === 'react-native-safe-area-context' ? { SafeAreaView: host('SafeAreaView') }
    : request === 'react-native-draggable-flatlist' ? {
      __esModule: true,
      default: draggableFlatList('DraggableFlatList'),
      NestableDraggableFlatList: draggableFlatList('NestableDraggableFlatList'),
    }
      : request === 'lucide-react-native' ? lucideMock
      : originalLoad(request, parent, isMain)
);
const { CharacterDetail, extractAvailableStatPoints, extractPrimaryStatValues, statGroupLabel } = require('../../main/components/CharacterDetail') as typeof import('../../main/components/CharacterDetail');
const { CharacterEquipmentScreen } = require('../../main/features/characters/equipment/CharacterEquipmentScreen') as typeof import('../../main/features/characters/equipment/CharacterEquipmentScreen');
const { CharacterManagementScreen } = require('../../main/features/characters/management/CharacterManagementScreen') as typeof import('../../main/features/characters/management/CharacterManagementScreen');
const { CharacterItemsScreen, buildItemCommand } = require('../../main/features/characters/items/CharacterItemsScreen') as typeof import('../../main/features/characters/items/CharacterItemsScreen');
const { CharacterSkillsScreen } = require('../../main/features/characters/skills/CharacterSkillsScreen') as typeof import('../../main/features/characters/skills/CharacterSkillsScreen');
moduleWithLoader._load = originalLoad;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CharacterDetail stat allocation', () => {
  it('renders pattern conflict and management progress from one hub resource', async () => {
    const character = makeHofCharacter();
    const detail = makeHofCharacterDetail(1, {
      actionPatterns: [{ index: 0, judge: 'always', judgeText: '항상', quantity: '0', quantityText: '', skill: 'attack', skillText: 'Attack' }],
    });
    const characterHub = makeCharacterManagementHubResource({
      selectedCharacter: character,
      detail,
      patternConflict: {
        currentRevision: 'revision-2',
        rowDiffs: [{ rowNumber: 1, before: null, current: null }],
      },
      deepSync: {
        status: 'running',
        progress: { characterId: 1, progress: [] },
        errorMessage: null,
      },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, { characterHub }));
    });
    const openTab = async (label: string) => {
      const tab = renderer.root.findAllByProps({ accessibilityRole: 'tab' }).find((node) => (
        node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0
      ));
      await act(async () => tab?.props.onPress());
    };
    const text = () => renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));

    await openTab('패턴');
    assert.ok(text().includes('서버에서 패턴이 변경되었습니다'));
    assert.ok(text().includes('1행'));

    await openTab('관리');
    assert.ok(text().includes('작업을 시작하고 있습니다.'));
  });

  it('renders transfer preview and progress from the same hub resource', async () => {
    const target = makeHofCharacter(1, { name: '대상' });
    const source = makeHofCharacter(2, { name: '원본' });
    const request = {
      sourceCharacterId: source.id,
      targetCharacterId: target.id,
      transfer: {
        includeCurrentPattern: true,
        savedPatternMappings: [],
        includeStats: false,
        includeSkills: false,
        includeEquipment: false,
      },
    };
    const characterHub = makeCharacterManagementHubResource({
      characters: [target, source],
      selectedCharacter: target,
      detail: makeHofCharacterDetail(target.id, { name: '대상' }),
      transfer: {
        status: 'running',
        sourceCharacter: source,
        targetCharacterId: target.id,
        request,
        preview: {
          sourceCharacterId: source.id,
          targetCharacterId: target.id,
          steps: [{ id: 'current-pattern', dependsOn: [] }],
          issues: [],
          executable: true,
        },
        progress: {
          targetCharacterId: target.id,
          results: [{ stepId: 'current-pattern', status: 'COMPLETED', message: '' }],
          nextStepIndex: 1,
        },
        result: null,
        errorMessage: null,
      },
      actions: {
        previewTransfer: async () => undefined,
        executeTransfer: async () => undefined,
      },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub,
      }));
    });
    const text = renderer.root
      .findAll((node) => String(node.type) === 'Text')
      .map((node) => node.children.join(''));

    assert.ok(text.includes('설정 가져오기'));
    assert.ok(text.includes('현재 패턴·위치·호위를 적용합니다.'));
    assert.ok(text.some((value) => value.includes('완료')));
  });

  it('sends a transfer preview through the hub semantic action', async () => {
    const target = makeHofCharacter(1, { name: '대상' });
    const source = makeHofCharacter(2, { name: '원본' });
    let submitted: unknown = null;
    const characterHub = makeCharacterManagementHubResource({
      characters: [target, source],
      selectedCharacter: target,
      detail: makeHofCharacterDetail(target.id, { name: '대상' }),
      transfer: {
        status: 'idle',
        sourceCharacter: source,
        targetCharacterId: target.id,
        request: null,
        preview: null,
        progress: null,
        result: null,
        errorMessage: null,
      },
      actions: {
        previewTransfer: async (request) => {
          submitted = request;
          return undefined;
        },
        executeTransfer: async () => undefined,
      },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub,
      }));
    });
    const previewButton = renderer.root
      .findAll((node) => String(node.type) === 'Pressable')
      .find((node) => node.findAll((child) => (
        String(child.type) === 'Text'
        && child.children.join('') === '가져오기 확인'
      )).length > 0);

    await act(async () => previewButton?.props.onPress());

    assert.deepEqual(submitted, {
      sourceCharacterId: source.id,
      targetCharacterId: target.id,
      transfer: {
        includeCurrentPattern: true,
        savedPatternMappings: [],
        includeStats: false,
        includeSkills: false,
        includeEquipment: false,
      },
    });
  });

  it('offers a fresh transfer preview instead of a no-op execute after an error', async () => {
    const target = makeHofCharacter(1, { name: '대상' });
    const source = makeHofCharacter(2, { name: '원본' });
    let previews = 0;
    let executions = 0;
    const characterHub = makeCharacterManagementHubResource({
      characters: [target, source],
      selectedCharacter: target,
      detail: makeHofCharacterDetail(target.id, { name: '대상' }),
      transfer: {
        status: 'error',
        sourceCharacter: source,
        targetCharacterId: target.id,
        request: {
          sourceCharacterId: source.id,
          targetCharacterId: target.id,
          transfer: {
            includeCurrentPattern: true,
            savedPatternMappings: [],
            includeStats: false,
            includeSkills: false,
            includeEquipment: false,
          },
        },
        preview: {
          sourceCharacterId: source.id,
          targetCharacterId: target.id,
          steps: [],
          issues: [],
          executable: true,
        },
        progress: null,
        result: null,
        errorMessage: '다시 확인해 주세요.',
      },
      actions: {
        previewTransfer: async () => {
          previews += 1;
          return undefined;
        },
        executeTransfer: async () => {
          executions += 1;
          return undefined;
        },
      },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub,
      }));
    });
    const primaryButton = renderer.root
      .findAll((node) => String(node.type) === 'Pressable')
      .find((node) => node.findAll((child) => (
        String(child.type) === 'Text'
        && child.children.join('') === '다시 확인'
      )).length > 0 && node.props.disabled === false);

    await act(async () => primaryButton?.props.onPress());

    assert.equal(previews, 1);
    assert.equal(executions, 0);
  });

  it('keeps the detail navigator and back action visible with a revalidation warning', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub: hubWithDetail(makeHofCharacterDetail(), {
          warningMessage: '최신 상태를 다시 확인하지 못했습니다.',
        }),
      }));
    });

    assert.ok(renderer.root.findByProps({ accessibilityRole: 'alert' }));
    assert.ok(renderer.root.findByProps({ accessibilityLabel: '캐릭터 목록으로' }));
    assert.ok(renderer.root.findByProps({ accessibilityRole: 'tablist' }));
  });

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
      renderer = create(React.createElement(CharacterSkillsScreen, {
        characterHub: hubWithDetail(detail),
      }));
    });

    const text = () => renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
    assert.ok(text().includes('남은 Skill Point'));
    assert.ok(text().includes('12'));
    assert.ok(text().includes('Parrying'));
    assert.ok(text().includes('Quick Slash'));

    const support = renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === 'Support').length > 0
    ));
    await act(async () => support?.props.onPress());

    assert.ok(text().includes('Parrying'));
    assert.equal(text().includes('Quick Slash'), false);
  });

  it('submits only the selected skill value through the semantic hub action', async () => {
    const learned: string[] = [];
    const detail = makeHofCharacterDetail(1, {
      learnableSkills: [{
        value: 'quick-slash',
        name: 'Quick Slash',
        iconUrl: '',
        category: 'Attack',
        targetText: 'enemy',
        scopeText: 'individual',
        spCost: 5,
        description: '빠른 공격',
      }],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterSkillsScreen, {
        characterHub: hubWithDetail(detail, {
          actions: { learnSkill: async (skillValue) => { learned.push(skillValue); } },
        }),
      }));
    });

    const pressableWithText = (label: string) => renderer.root
      .findAll((node) => String(node.type) === 'Pressable')
      .find((node) => node.findAll((child) => (
        String(child.type) === 'Text' && child.children.join('') === label
      )).length > 0);
    const learnTab = renderer.root.findAll((node) => (
      String(node.type) === 'Pressable' && node.props.accessibilityRole === 'tab'
    )).find((node) => node.findAll((child) => (
      String(child.type) === 'Text' && child.children.join('') === '배우기'
    )).length > 0);
    await act(async () => learnTab?.props.onPress());
    await act(async () => pressableWithText('Quick Slash')?.props.onPress());
    const learnAction = renderer.root.findAll((node) => (
      String(node.type) === 'Pressable' && node.props.accessibilityRole === 'button'
    )).find((node) => node.findAll((child) => (
      String(child.type) === 'Text' && child.children.join('') === '배우기'
    )).length > 0);
    await act(async () => learnAction?.props.onPress());

    assert.deepEqual(learned, ['quick-slash']);
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
    const requests: Array<Partial<Record<'STR' | 'INT' | 'DEX' | 'SPD' | 'LUK', number>>> = [];
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub: hubWithDetail(
          makeHofCharacterDetail(1, { stats: { ...makeHofCharacterDetail().stats, statusPoints: 25, dexReal: 34, dexBonus: 9 } }),
          { actions: { allocateStats: async (amounts) => { requests.push(amounts); } } },
        ),
      }));
    });

    const text = renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
    assert.ok(text.includes('STR'));
    assert.ok(text.includes('DEX'));
    assert.ok(text.includes('INT'));
    assert.ok(text.includes('SPD'));
    assert.ok(text.includes('LUK'));
    assert.ok(text.includes('34 + 9'));
    assert.ok(text.includes('남은 STATUS POINT'));
    assert.ok(text.includes('25'));
    assert.equal(text.some((value) => /^\+\d+$/.test(value)), false);
    assert.equal(text.includes('Increase Status'), false);
    assert.equal(text.includes('현재 상태'), false);

    assert.equal(renderer.root.findAllByProps({ accessibilityRole: 'radio' }).length, 0);
    const statInputs = renderer.root.findAll((node) => String(node.type) === 'TextInput' && node.props.accessibilityRole === 'spinbutton');
    assert.equal(statInputs.length, 5);
    statInputs.forEach((input) => {
      assert.ok(input.props.style.minHeight >= 44, '숫자 글리프가 잘리지 않을 만큼 입력란 높이를 확보한다');
      assert.equal(input.props.style.textAlignVertical, 'center');
      assert.equal(input.props.style.paddingVertical, 0);
    });

    const dexInput = renderer.root.find((node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'DEX 추가 포인트');
    await act(async () => dexInput.props.onChangeText('2'));
    const apply = renderer.root.findAllByProps({ accessibilityRole: 'button' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('').startsWith('스탯 올리기')).length > 0
    ));
    await act(async () => apply?.props.onPress());

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.DEX, 2);
  });

  it('lets the nested character scroller take vertical gestures from numeric inputs', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub: hubWithDetail(makeHofCharacterDetail(1, {
          stats: { ...makeHofCharacterDetail().stats, statusPoints: 25 },
        })),
      }));
    });

    const statInputs = renderer.root.findAll((node) => String(node.type) === 'TextInput' && node.props.accessibilityRole === 'spinbutton');
    assert.equal(statInputs.length, 5);
    statInputs.forEach((input) => {
      assert.equal(input.props.multiline, true);
      assert.equal(input.props.numberOfLines, 1);
    });
  });

  it('uses Android pan mode so the focused field stays above the keyboard throughout the app', () => {
    const appConfig = readFileSync(resolve(process.cwd(), 'app.json'), 'utf8');
    assert.match(appConfig, /"softwareKeyboardLayoutMode"\s*:\s*"pan"/);
  });

  it('does not render a stored faith bar or separator as a status effect before the next sync', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub: hubWithDetail(makeHofCharacterDetail(1, {
          statusEffects: [
            { type: 'EFFECT', name: 'gauge', valueText: '||||||||', description: '', active: null },
            { type: 'EFFECT', name: 'separator', valueText: '________________________________ [SET:작은 짐승들의 잔치]', description: '세트 효과', active: false },
            { type: 'EFFECT', name: 'defence', valueText: '방어숙련 +29%', description: '', active: null },
          ],
        })),
      }));
    });

    const text = renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
    assert.equal(text.includes('||||||||'), false);
    assert.equal(text.some((value) => value.includes('________')), false);
    assert.ok(text.includes('[SET:작은 짐승들의 잔치]'));
    assert.ok(text.includes('방어숙련 +29%'));
  });

  it('renders the pattern requirement formula without unsupported floor glyphs or one-line clipping', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub: hubWithDetail(makeHofCharacterDetail()),
      }));
    });

    const help = renderer.root.findByProps({ accessibilityLabel: '스탯 도움말' });
    await act(async () => help.props.onPress());
    const textNodes = renderer.root.findAll((node) => String(node.type) === 'Text');
    const text = textNodes.map((node) => node.children.join(''));
    assert.ok(text.includes('패턴 요구 수치'));
    assert.ok(text.includes('Real INT + (Real SPD ÷ 5의 정수 몫)'));
    assert.equal(text.some((value) => /[⌊⌋]/.test(value)), false);
    const expression = textNodes.find((node) => node.children.join('') === 'Real INT + (Real SPD ÷ 5의 정수 몫)');
    assert.equal(expression?.props.numberOfLines, undefined);
    assert.ok(expression?.props.style.lineHeight >= 20);
  });

  it('shows pattern editing controls immediately without opening a generic accordion', async () => {
    const requests: CharacterPatternApplyRequest[] = [];
    let pauseRequests = 0;
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub: hubWithDetail(
          makeHofCharacterDetail(1, { actionPatterns: [{ index: 0, judge: 'always', judgeText: '항상', quantity: '0', quantityText: '', skill: 'slash', skillText: 'Quick Slash' }], patternOptions: [{ type: 'CONDITION', value: 'always', label: '항상', category: null }, { type: 'CONDITION', value: '1099', label: 'HP', category: 'HP' }, { type: 'CONDITION', value: 'hp', label: 'HP가 낮을 때', category: null }, { type: 'SKILL', value: 'slash', label: 'Quick Slash', category: null }], positionGuard: { positions: [{ value: 'front', checked: true }], selectedPosition: 'front', guardValue: 'always', guardText: '항상' } }),
          { actions: {
            applyPattern: async (request: CharacterPatternApplyRequest) => {
              requests.push(request);
              return {};
            },
            beginPatternEdit: async () => { pauseRequests += 1; },
          } },
        ),
      }));
    });

    const patternTab = renderer.root.findAllByProps({ accessibilityRole: 'tab' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '패턴').length > 0
    ));
    await act(async () => patternTab?.props.onPress());

    const conditionControl = renderer.root.findAllByProps({ accessibilityLabel: '1번 행동 조건 선택' })[0];
    const quantityControl = renderer.root.findAllByProps({ accessibilityLabel: '1번 기준값' })[0];
    const skillControl = renderer.root.findAllByProps({ accessibilityLabel: '1번 실행 스킬 선택' })[0];
    assert.ok(conditionControl);
    assert.ok(quantityControl);
    assert.ok(skillControl);
    const patternControls = renderer.root.findByProps({ testID: 'pattern-row-controls-1' });
    assert.deepEqual(
      patternControls.findAll((node) => (
        ['Pressable', 'TextInput'].includes(String(node.type))
        && node.props.accessibilityLabel
      ))
        .map((node) => node.props.accessibilityLabel),
      ['1번 행동 조건 선택', '1번 기준값', '1번 실행 스킬 선택'],
    );

    await act(async () => conditionControl.props.onPress());
    const search = renderer.root.findAllByProps({ accessibilityLabel: '검색' })[0];
    await act(async () => search.props.onChangeText('HP'));
    const candidateList = renderer.root.findAll((node) => String(node.type) === 'FlatList').at(-1);
    assert.deepEqual(candidateList?.props.data.map((candidate: { kind: string }) => candidate.kind), ['CATEGORY', 'OPTION']);
    const hpCategory = candidateList?.props.data.find((candidate: { kind: string; label?: string }) => candidate.kind === 'CATEGORY' && candidate.label === 'HP');
    const hpCategoryRow = candidateList?.props.renderItem({ item: hpCategory });
    assert.equal(hpCategoryRow.props.accessibilityRole, 'header');
    assert.equal(hpCategoryRow.props.onPress, undefined);
    const hpCandidate = candidateList?.props.data.find((candidate: { kind: string; option?: { value: string } }) => candidate.kind === 'OPTION' && candidate.option?.value === 'hp');
    const hpOption = candidateList?.props.renderItem({ item: hpCandidate });
    await act(async () => hpOption.props.onPress());

    await act(async () => quantityControl.props.onChangeText('35'));
    const apply = renderer.root.findAllByProps({ accessibilityRole: 'button' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '저장').length > 0
    ));
    await act(async () => apply?.props.onPress());
    const confirm = renderer.root.findAllByProps({ accessibilityRole: 'button' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '현재 설정 저장').length > 0
    ));
    await act(async () => confirm?.props.onPress());

    assert.equal(requests.length, 1);
    assert.equal(requests[0].draft.rows[0].judge, 'hp');
    assert.equal(requests[0].draft.rows[0].quantity, '35');
    assert.equal(requests[0].baseRevision, '2026-08-17T00:00:00Z');
    assert.equal(pauseRequests, 1);
  });

  it('lets the outer character scroller own vertical gestures that start on pattern rows', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub: hubWithDetail(makeHofCharacterDetail(1, {
          actionPatterns: [{ index: 0, judge: 'always', judgeText: '반드시', quantity: '0', quantityText: '', skill: 'attack', skillText: 'Attack' }],
          patternOptions: [{ type: 'CONDITION', value: 'always', label: '반드시', category: null }, { type: 'SKILL', value: 'attack', label: 'Attack', category: null }],
          positionGuard: { positions: [{ value: 'front', checked: true }], selectedPosition: 'front', guardValue: 'always', guardText: '반드시 지킨다' },
        })),
      }));
    });
    const patternTab = renderer.root.findAllByProps({ accessibilityRole: 'tab' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '패턴').length > 0
    ));
    await act(async () => patternTab?.props.onPress());

    assert.equal(renderer.root.findAll((node) => String(node.type) === 'DraggableFlatList').length, 0);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'NestableDraggableFlatList').length, 1);
    const mainScreenSource = readFileSync(resolve(process.cwd(), 'src/main/screens/MainScreen.tsx'), 'utf8');
    assert.match(
      mainScreenSource,
      /function CharacterDetailScroll[\s\S]*?<NestableScrollContainer/,
      '캐릭터 상세 바깥 스크롤도 중첩 드래그 목록과 같은 스크롤 컨테이너를 사용해야 한다',
    );
  });

  it('shows armor candidates when changing the shield slot', async () => {
    const armorCandidate = {
      value: 'shield-2',
      typeCode: 'armor',
      name: 'Rare Gold Shield',
      iconUrl: '',
      description: '희귀한 방패',
      quantity: null,
    };
    const detail = makeHofCharacterDetail(1, {
      equipment: [{ slot: 'shield', part: 'Shield', name: 'Wood Shield', iconUrl: '', description: '', checked: true }],
      equipmentCandidates: [armorCandidate],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterEquipmentScreen, {
        characterHub: hubWithDetail(detail),
      }));
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Shield 장비 변경' }).props.onPress();
    });

    assert.deepEqual(renderer.root.find((node) => String(node.type) === 'FlatList').props.data, [armorCandidate]);
  });

  it('uses the whole equipment card for changes and always shows the full description', async () => {
    const detail = makeHofCharacterDetail(1, {
      equipment: [{
        slot: 'weapon',
        part: 'Weapon',
        name: 'Soulcollector Sword',
        iconUrl: '',
        description: '상대방의 무기를 부러뜨리는 검. 물리 방어 무시가 증가한다.',
        checked: true,
      }],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterEquipmentScreen, {
        characterHub: hubWithDetail(detail),
      }));
    });

    const change = renderer.root.findByProps({ accessibilityLabel: 'Weapon 장비 변경' });
    const description = change.find((node) => (
      String(node.type) === 'Text' && node.children.join('') === '상대방의 무기를 부러뜨리는 검. 물리 방어 무시가 증가한다.'
    ));
    assert.equal(description.props.numberOfLines, undefined);
    assert.equal(renderer.root.findAll((node) => String(node.props.accessibilityLabel).includes('장비 설명')).length, 0);
  });

  it('renders the dedicated equipment skill and management screens from one character API snapshot', async () => {
    const equipmentDescription = 'Atk +96 · 상대방의 무기를 부러뜨리는 검. 물리 방어 무시 +44, 크리티컬 확률과 완전 방어가 증가한다.';
    const detail = makeHofCharacterDetail(1, {
      equipment: [{ slot: 'weapon', part: 'Weapon', name: 'Soulcollector Sword', iconUrl: 'https://hof.test/sword.gif', description: equipmentDescription, checked: true }],
      equipmentCandidates: [{ value: 'w-2', typeCode: 'weapon', name: 'Royal Claymore', iconUrl: 'https://hof.test/claymore.gif', description: 'Atk +110', quantity: null }],
      learnedSkills: [{ value: 'p', name: 'Parrying', iconUrl: '', category: 'Support', targetText: 'self', scopeText: 'individual', spCost: 0, description: '데미지 1회 무효화' }],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub: hubWithDetail(detail),
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
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'ScrollView' && node.props.horizontal === true).length, 0);
    assert.equal(renderer.root.findByProps({ testID: 'equipment-preset-controls' }).props.style.flexDirection, 'row');
    assert.equal(renderer.root.findByProps({ testID: 'equipment-preset-grid' }).props.style.flexDirection, 'row');
    [1, 2].forEach((slot) => {
      assert.notEqual(renderer.root.findByProps({ testID: `equipment-preset-${slot}` }).props.style.flexDirection, 'row');
    });
    ['장비 1 불러오기', '장비 1 저장', '장비 2 불러오기', '장비 2 저장', '전체 장비 해제'].forEach((label) => {
      assert.ok(renderer.root.findAllByProps({ accessibilityRole: 'button', accessibilityLabel: label }).length > 0);
    });
    const fullDescription = renderer.root.find((node) => String(node.type) === 'Text' && node.children.join('') === equipmentDescription);
    assert.equal(fullDescription.props.numberOfLines, undefined);
    assert.equal(renderer.root.findAll((node) => String(node.props.accessibilityLabel).includes('장비 설명')).length, 0);
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'Image' && node.props.source?.uri === 'https://hof.test/sword.gif').length, 1);

    await openTab('스킬');
    assert.ok(text().includes('Parrying'));
    assert.ok(text().includes('데미지 1회 무효화'));

    await openTab('관리');
    assert.ok(text().includes('이름 변경'));
    assert.ok(text().includes('Knockback'));
  });

  it('keeps the accepted prototype hierarchy across all five character tabs', async () => {
    const base = makeHofCharacterDetail();
    const detail = makeHofCharacterDetail(1, {
      name: '소셜',
      stats: {
        ...base.stats,
        hpBase: 100,
        hpBonus: 20,
        spBase: 30,
        spBonus: 5,
        strReal: 10,
        strBonus: 2,
        intReal: 15,
        intBonus: 3,
        dexReal: 20,
        dexBonus: 4,
        spdReal: 25,
        spdBonus: 5,
        lukReal: 6,
        lukBonus: 1,
        statusPoints: 20,
        skillPoints: 7,
      },
      statusEffects: [{ type: 'SET', name: 'night', valueText: '[SET:밤을 사냥하는 자]', description: 'Atk +10%', active: true }],
      faith: { godName: 'Marduk', current: 300, max: 500 },
      patternSlots: [{ slot: '0', label: '빈 슬롯', canLoad: false }],
      actionPatterns: [{ index: 0, judge: 'always', judgeText: '반드시', quantity: '0', quantityText: '0', skill: 'attack', skillText: 'Attack' }],
      patternOptions: [{ type: 'CONDITION', value: 'always', label: '반드시', category: null }, { type: 'SKILL', value: 'attack', label: 'Attack', category: null }],
      positionGuard: { positions: [{ value: 'front', checked: true }, { value: 'back', checked: false }], selectedPosition: 'front', guardValue: 'always', guardText: '반드시 지킨다' },
      equipment: [{ slot: 'weapon', part: 'Weapon', name: 'Sword', iconUrl: '', description: 'Atk +10', checked: true }],
      learnedSkills: [{ value: 'guard', name: 'Guard', iconUrl: '', category: '공용', targetText: 'self', scopeText: 'individual', spCost: 0, description: '받는 피해 감소' }],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub: hubWithDetail(detail, {
          actions: {
            previewTransfer: async () => { throw new Error('not called'); },
            executeTransfer: async () => { throw new Error('not called'); },
          },
        }),
      }));
    });
    const text = () => renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
    const openTab = async (label: string) => {
      const tab = renderer.root.findAllByProps({ accessibilityRole: 'tab' }).find((node) => (
        node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0
      ));
      await act(async () => tab?.props.onPress());
    };

    const statusText = text();
    assert.ok(statusText.indexOf('정보') < statusText.indexOf('소셜'));
    assert.ok(statusText.indexOf('상태 효과') < statusText.indexOf('신앙 · Marduk'));
    assert.ok(statusText.indexOf('신앙 · Marduk') < statusText.indexOf('스탯 배분'));

    await openTab('패턴');
    assert.ok(text().includes('0개 · 빈 슬롯 1개'));
    assert.ok(text().includes('다른 캐릭터\n가져오기'));
    assert.ok(text().includes('전방'));
    assert.ok(text().includes('반드시 지킨다'));

    await openTab('장비');
    assert.ok(text().includes('장비 1'));
    assert.ok(text().includes('장비 2'));
    assert.ok(text().includes('현재 장비'));

    await openTab('스킬');
    assert.ok(text().includes('공용'));
    assert.ok(text().includes('받는 피해 감소'));

    await openTab('관리');
    assert.ok(text().includes('일반 관리'));
    assert.ok(text().includes('설정 도구'));
    assert.ok(text().includes('위험 작업'));
    assert.ok(text().includes('성장·초기화와 기타 아이템을 찾아 사용합니다.'));
  });

  it('offers optional empty-slot storage only after the pattern save flow starts', async () => {
    const requests: CharacterPatternApplyRequest[] = [];
    const detail = makeHofCharacterDetail(1, {
      patternSlots: [{ slot: '0', label: '빈 슬롯', canLoad: false }],
      actionPatterns: [{ index: 0, judge: 'always', judgeText: '반드시', quantity: '0', quantityText: '0', skill: 'attack', skillText: 'Attack' }],
      patternOptions: [{ type: 'CONDITION', value: 'always', label: '반드시', category: null }, { type: 'SKILL', value: 'attack', label: 'Attack', category: null }],
      positionGuard: { positions: [{ value: 'front', checked: true }], selectedPosition: 'front', guardValue: 'always', guardText: '반드시 지킨다' },
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterDetail, {
        characterHub: hubWithDetail(detail, {
          actions: {
            applyPattern: async (request: CharacterPatternApplyRequest) => {
              requests.push(request);
              return {};
            },
          },
        }),
      }));
    });
    const findButton = (label: string) => renderer.root.findAllByProps({ accessibilityRole: 'button' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0
    ));
    const patternTab = renderer.root.findAllByProps({ accessibilityRole: 'tab' }).find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '패턴').length > 0
    ));
    await act(async () => patternTab?.props.onPress());
    await act(async () => findButton('저장')?.props.onPress());

    const optional = renderer.root.findAllByProps({ accessibilityRole: 'checkbox' })[0];
    assert.ok(optional);
    await act(async () => optional.props.onPress());
    const name = renderer.root.findAllByProps({ accessibilityLabel: '패턴 저장 이름' })[0];
    await act(async () => name.props.onChangeText('범용'));
    await act(async () => findButton('저장하고 슬롯에도 보관')?.props.onPress());

    assert.equal(requests.length, 1);
    assert.equal(requests[0].slotAction, 'SAVE_EMPTY');
    assert.equal(requests[0].targetSlotCode, '0');
    assert.equal(requests[0].slotName, '범용');
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
        characterHub: hubWithDetail(detail, {
          actions: {
            applyPattern: async (request: CharacterPatternApplyRequest) => {
              requests.push(request);
              return requests.length === 1
                ? { currentRevision: '2026-08-17T00:01:00Z', rowDiffs: [{ rowNumber: 1, before: request.base.rows[0] ?? null, current: { judge: 'changed', quantity: '1', skill: 'slash' } }] }
                : { revision: '2026-08-17T00:02:00Z' };
            },
          },
        }),
      }));
    });
    const patternTab = renderer.root.findAllByProps({ accessibilityRole: 'tab' }).find((node) => node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '패턴').length > 0);
    await act(async () => patternTab?.props.onPress());
    const slotActionButtons = renderer.root.findAll((node) => {
      const style = node.props.style;
      return String(node.type) === 'Pressable' && (Array.isArray(style) ? style[0] : style)?.width === 64;
    });
    const actionByLabel = (label: string) => slotActionButtons.find((node) => node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0);
    const load = actionByLabel('불러오기');
    const replace = actionByLabel('교체');
    const remove = actionByLabel('삭제');
    const actionWidths = [load, replace, remove].map((action) => {
      const style = action?.props.style;
      return (Array.isArray(style) ? style[0] : style)?.width;
    });
    assert.deepEqual(actionWidths, [64, 64, 64]);
    const patternSource = readFileSync(resolve(process.cwd(), 'src/main/features/characters/pattern/CharacterPatternScreen.tsx'), 'utf8');
    assert.match(patternSource, /slotActions:\s*\{[^}]*gap:\s*8/);
    await act(async () => replace?.props.onPress());
    const overwrite = renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '덮어쓰기').length > 0);
    await act(async () => overwrite?.props.onPress());

    assert.equal(requests.length, 2);
    assert.equal(requests[1].force, true);
    assert.equal(requests[1].slotAction, 'REPLACE');
    assert.equal(requests[1].targetSlotCode, '2');
    assert.equal(requests[1].slotName, '대회랑');
  });

  it('opens the HOF growth item selector before showing the item screen', async () => {
    const commandTypes: string[] = [];
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterManagementScreen, {
        characterHub: hubWithDetail(makeHofCharacterDetail(), {
          actions: {
            executeCommand: async (command: CharacterCommand) => {
              commandTypes.push(command.type);
              return {
                type: 'Completed' as const,
                characterId: command.characterId,
                revision: '2026-08-17T00:01:00Z',
                messages: [],
              };
            },
          },
        }),
      }));
    });

    const itemUse = renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => (
      node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === '아이템 사용').length > 0
    ));
    await act(async () => itemUse?.props.onPress());

    assert.deepEqual(commandTypes, ['PREPARE_ITEMS']);
    assert.equal(renderer.root.findByProps({ testID: 'character-items-modal' }).props.visible, true);
    const text = renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
    assert.ok(text.includes('성장·초기화'));
  });

  it('keeps U Item equipment candidates out of the direct-use management screen', async () => {
    const detail = makeHofCharacterDetail(1, {
      equipmentCandidates: [
        { value: '7510', typeCode: 'resetitem', name: 'Reset Crystal', iconUrl: '', description: '성장 초기화', quantity: 2 },
        { value: 'milk', typeCode: 'useitem', name: 'Milk', iconUrl: '', description: '장착 후 사용하는 아이템', quantity: 5 },
        { value: '8801', typeCode: 'characteritem', name: 'MYpod', iconUrl: '', description: '패턴 저장 슬롯 추가', quantity: 3 },
      ],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterItemsScreen, {
        characterHub: hubWithDetail(detail),
        onBack: () => undefined,
      }));
    });
    const text = () => renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
    const visibleItemNames = () => renderer.root
      .findByProps({ accessibilityLabel: '사용 가능한 아이템' })
      .props.data.map((item: { name: string }) => item.name);
    const pressTab = async (label: string) => {
      const tab = renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => (
        node.findAll((child) => String(child.type) === 'Text' && child.children.join('') === label).length > 0
      ));
      await act(async () => tab?.props.onPress());
    };

    assert.deepEqual(visibleItemNames(), ['Reset Crystal']);

    assert.equal(text().includes('사용 아이템'), false);

    await pressTab('기타 아이템');
    assert.deepEqual(visibleItemNames(), ['MYpod']);

    assert.equal(buildItemCommand(detail, detail.equipmentCandidates![2]).type, 'USE_ITEM');
  });

  it('keeps the item use action outside the scrolling item list', async () => {
    const detail = makeHofCharacterDetail(1, {
      equipmentCandidates: [
        { value: '7510', typeCode: 'resetitem', name: 'Reset Crystal', iconUrl: '', description: '성장 초기화', quantity: 2 },
      ],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterItemsScreen, {
        characterHub: hubWithDetail(detail),
        onBack: () => undefined,
      }));
    });

    const list = renderer.root.findByProps({ accessibilityLabel: '사용 가능한 아이템' });
    const item = list.props.renderItem({ item: list.props.data[0], index: 0 });
    await act(async () => item.props.onPress());

    const footer = renderer.root.findByProps({ testID: 'item-use-footer' });
    assert.equal(footer.parent, list.parent);
    assert.equal(footer.parent?.props.style.flex, 1);
  });

  it('shows use item candidates when changing the U Item equipment slot', async () => {
    const useItemCandidate = {
      value: 'milk',
      typeCode: 'useitem',
      name: 'Milk',
      iconUrl: '',
      description: '장착 후 사용하는 아이템',
      quantity: 5,
    };
    const detail = makeHofCharacterDetail(1, {
      equipment: [{ slot: 'useitem', part: 'U.Item', name: '', iconUrl: '', description: '', checked: true }],
      equipmentCandidates: [useItemCandidate],
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterEquipmentScreen, {
        characterHub: hubWithDetail(detail),
      }));
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'U.Item 장비 변경' }).props.onPress();
    });

    assert.deepEqual(renderer.root.find((node) => String(node.type) === 'FlatList').props.data, [useItemCandidate]);
  });

  it('shows recommended Knockback links first and lets the user open the full roster', async () => {
    const linked: Array<[number, string]> = [];
    const detail = makeHofCharacterDetail();
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(CharacterManagementScreen, {
        characterHub: hubWithDetail(detail, {
          actions: {
            executeCommand: async () => ({
              type: 'IdentityResolutionRequired' as const,
              characterId: detail.id,
              message: '새 캐릭터 연결을 선택해 주세요.',
              candidates: [
                { hofCharacterId: 'recommended', name: '추천 후보', job: 'Knight', level: 60, matchingFields: ['name', 'job', 'level'] },
                { hofCharacterId: 'other', name: '다른 캐릭터', job: 'Mage', level: 42, matchingFields: [] },
              ],
            }),
            linkCharacter: async (hofCharacterId: string) => {
              linked.push([detail.id, hofCharacterId]);
            },
          },
        }),
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

function hubWithDetail(
  detail: ReturnType<typeof makeHofCharacterDetail>,
  overrides: Parameters<typeof makeCharacterManagementHubResource>[0] = {},
) {
  const character = makeHofCharacter(detail.id, { name: detail.name });
  return makeCharacterManagementHubResource({
    characters: [character],
    selectedCharacter: character,
    detail,
    ...overrides,
  });
}
