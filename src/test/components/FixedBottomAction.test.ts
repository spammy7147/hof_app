import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { makeHofCharacterDetail } from '../fixtures/api';
import { makeCharacterManagementHubResource } from '../fixtures/characterManagementHub';

const host = (name: string) => (props: Record<string, unknown>) =>
  React.createElement(name, props, props.children as React.ReactNode);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const moduleWithLoader = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = (request, parent, isMain) => {
  if (request === 'react-native') return {
    Image: host('Image'), ScrollView: host('ScrollView'), TextInput: host('TextInput'),
    Text: host('Text'), View: host('View'),
    Pressable: (props: Record<string, unknown>) => React.createElement('Pressable', {
      ...props, accessible: true, onPress: props.disabled ? undefined : props.onPress,
    }, props.children as React.ReactNode),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style,
    },
  };
  return originalLoad(request, parent, isMain);
};
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { FixedBottomActionHost, FixedBottomAction } = require('../../main/components/FixedBottomAction') as
  typeof import('../../main/components/FixedBottomAction');
const { CharacterSkillsScreen } = require('../../main/features/characters/skills/CharacterSkillsScreen') as
  typeof import('../../main/features/characters/skills/CharacterSkillsScreen');
moduleWithLoader._load = originalLoad;
afterEach(async () => rntl.cleanup());

function skills(learned: string[]) {
  return React.createElement(CharacterSkillsScreen, {
    characterHub: makeCharacterManagementHubResource({
      detail: makeHofCharacterDetail(1, {
        stats: { ...makeHofCharacterDetail().stats, skillPoints: 12 },
        learnableSkills: [{ value: 'quick-slash', name: 'Quick Slash', iconUrl: '', category: 'Attack',
          targetText: 'enemy', scopeText: 'individual', spCost: 5, description: '빠른 공격' }],
      }),
      actions: { learnSkill: async (value) => { learned.push(value); } },
    }),
  });
}

describe('fixed bottom actions through skill selection', () => {
  it('선택한 스킬만 하단에 표시하고 제출하며 선택 해제 후 작업을 제거한다', async () => {
    const learned: string[] = [];
    const user = rntl.userEvent.setup();
    await rntl.render(React.createElement(FixedBottomActionHost, null, skills(learned)));
    assert.equal(rntl.screen.queryByLabelText('고정 하단 작업'), null);
    await user.press(rntl.screen.getByRole('tab', { name: '배우기' }));
    await user.press(rntl.screen.getByRole('button', { name: /Quick Slash/ }));
    const bar = rntl.screen.getByLabelText('고정 하단 작업');
    assert.ok(rntl.within(bar).getByText('선택한 스킬'));
    assert.equal(rntl.within(bar).queryByText('남은 Skill Point'), null);
    assert.ok(rntl.screen.getByText('12'));
    await user.press(rntl.within(bar).getByRole('button', { name: '배우기' }));
    assert.deepEqual(learned, ['quick-slash']);
    await user.press(rntl.screen.getByRole('button', { name: '전체' }));
    assert.equal(rntl.screen.queryByLabelText('고정 하단 작업'), null);
    await user.press(rntl.screen.getByRole('button', { name: /Quick Slash/ }));
    await user.press(rntl.screen.getByRole('tab', { name: '보유 스킬' }));
    assert.equal(rntl.screen.queryByRole('button', { name: '배우기' }), null);
    assert.equal(rntl.screen.queryByLabelText('고정 하단 작업'), null);
  });

  it('화면 교체 시 이전 선택 작업을 지우고 현재 화면의 작업만 남긴다', async () => {
    const user = rntl.userEvent.setup();
    await rntl.render(React.createElement(FixedBottomActionHost, null, skills([])));
    await user.press(rntl.screen.getByRole('tab', { name: '배우기' }));
    await user.press(rntl.screen.getByRole('button', { name: /Quick Slash/ }));
    await rntl.screen.rerender(React.createElement(FixedBottomActionHost, null,
      React.createElement(FixedBottomAction, null, React.createElement('Text', null, '다음 화면 작업'))));
    assert.equal(rntl.screen.queryByText('Quick Slash'), null);
    assert.equal(rntl.screen.queryByRole('button', { name: '배우기' }), null);
    assert.ok(rntl.within(rntl.screen.getByLabelText('고정 하단 작업')).getByText('다음 화면 작업'));
    await rntl.screen.rerender(React.createElement(FixedBottomActionHost, null, skills([])));
    assert.equal(rntl.screen.queryByText('다음 화면 작업'), null);
    assert.equal(rntl.screen.queryByLabelText('고정 하단 작업'), null);
  });
});
