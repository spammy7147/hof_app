import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, it } from 'node:test';
import React from 'react';
import type { ColosseumBattleResponse, TypedAutomationEntryResponse } from '../../main/types/api';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name,
  { ...props, accessible: props.accessible ?? (name === 'Pressable' ? true : undefined) }, props.children as React.ReactNode);
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const modules = Module as unknown as { _load: Loader };
const original = modules._load;
modules._load = (request, parent, isMain) => {
  if (request === 'react-native') return {
    ActivityIndicator: host('ActivityIndicator'), Pressable: host('Pressable'), ScrollView: host('ScrollView'),
    Switch: host('Switch'), Text: host('Text'), View: host('View'),
    StyleSheet: { create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style },
  };
  return original(request, parent, isMain);
};
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { ColosseumAutomationEditor } = require('../../main/features/automation/components/ColosseumAutomationEditor') as
  typeof import('../../main/features/automation/components/ColosseumAutomationEditor');
modules._load = original;
afterEach(async () => rntl.cleanup());

it('마을의 저장 팀을 조회하고 새로고침하며 활성 여부만 저장한다', async () => {
  const entry: TypedAutomationEntryResponse = { id: 8, type: 'COLOSSEUM', priority: 0, enabled: true, ready: true,
    warnings: [], quests: [], battleMaps: [], battleMapProgress: [], adventureMaps: [] };
  const team: ColosseumBattleResponse = { fighters: [], selectedTeam: [], minTeamSize: 5, maxTeamSize: 5,
    topRankings: [], nearRankings: [], teamSaveAvailable: true, challengeAvailable: false,
    challengeNotice: null, battleResult: null, result: null };
  let reads = 0;
  let closed = false;
  const saved: unknown[] = [];
  const user = rntl.userEvent.setup();
  await rntl.render(React.createElement(ColosseumAutomationEditor, {
    entry, saving: false, mutationMessage: null, loadColosseum: async () => {
      reads++;
      return reads === 1 ? team : { ...team, selectedTeam: ['1', '2', '3', '4', '5'] };
    },
    onSave: async (request) => { saved.push(request); return true; },
    onDelete: async () => true, onBack: () => { closed = true; },
  }));
  assert.ok(await rntl.screen.findByText('마을에서 출전할 5명을 먼저 저장해 주세요.'));
  await user.press(rntl.screen.getByRole('button', { name: '콜로세움 팀 새로고침' }));
  assert.ok(await rntl.screen.findByText('5/5명'));
  assert.equal(rntl.screen.queryByText('마을에서 출전할 5명을 먼저 저장해 주세요.'), null);
  await user.press(rntl.screen.getByRole('button', { name: '콜로세움 자동화 저장' }));
  assert.deepEqual(saved, [{ enabled: true }]);
  assert.equal(reads, 2);
  await user.press(rntl.screen.getByRole('button', { name: '콜로세움 자동화 삭제' }));
  assert.equal(closed, true);
});
