import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { makeHofCharacter } from '../fixtures/api';
import { makeCharacterManagementHubResource } from '../fixtures/characterManagementHub';
import { makeBattleResource } from '../fixtures/battleResource';
import { makePartyPresetCatalogResource } from '../fixtures/partyPresetCatalog';
import type { CharacterOperationJob } from '../../main/types/api';

const host = (name: string) => React.forwardRef<unknown, Record<string, any>>((props, ref) =>
  React.createElement(name, { ...props, ref, accessible: props.accessible ?? (name === 'Pressable' ? true : undefined) }, props.children));
const View = host('View');
const rn = {
  View, Text: host('Text'), TextInput: host('TextInput'), Pressable: host('Pressable'), Image: host('Image'),
  ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'),
  Modal: ({ visible, children, ...props }: Record<string, any>) => visible ? React.createElement('Modal', props, children) : null,
  FlatList: ({ data, renderItem, keyExtractor, ...props }: Record<string, any>) =>
    React.createElement('ScrollView', props, data.map((item: any, index: number) =>
      React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item, index })))),
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (styles: any) => Array.isArray(styles) ? Object.assign({}, ...styles.filter(Boolean)) : styles },
  Platform: { OS: 'web', select: (options: any) => options.web ?? options.default },
  Alert: { alert: () => undefined },
};
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const original = loader._load;
loader._load = (request, parent, isMain) => {
  if (request === 'react-native') return rn;
  if (request === 'react-native-safe-area-context') return { SafeAreaView: View };
  if (request === 'react-native-draggable-flatlist') return { NestableScrollContainer: View };
  if (request === 'lucide-react-native') return new Proxy({}, { get: () => View });
  if (request.endsWith('/PartyPresetList')) return { PartyPresetList: () => React.createElement(FixedBottomAction, null, React.createElement(rn.Text, null, '프리셋 저장')) };
  for (const name of ['HomeTabScreen', 'BattleTabScreen', 'DataTabScreen', 'SettingsTabScreen', 'TownTabScrollContainer', 'CharacterDetail']) {
    if (request.endsWith('/' + name)) return { [name]: View };
  }
  return original(request, parent, isMain);
};
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { MainScreen } = require('../../main/screens/MainScreen') as typeof import('../../main/screens/MainScreen');
const { CharacterSyncControl } = require('../../main/features/characters/CharacterSyncScreen') as typeof import('../../main/features/characters/CharacterSyncScreen');
const { FixedBottomAction } = require('../../main/components/FixedBottomAction') as typeof import('../../main/components/FixedBottomAction');
loader._load = original;
afterEach(async () => rntl.cleanup());

const completed: CharacterOperationJob = {
  id: 5, operationType: 'DEEP_SYNC', targetCharacterId: 1, sourceCharacterId: null,
  status: 'COMPLETED', collectionStatus: 'COMPLETED', recoveryStatus: 'RESTORED',
  deepSync: { characterId: 1, progress: [] }, transfer: null, message: null,
  updatedAt: '2026-09-09T00:00:00Z', finishedAt: '2026-09-09T00:00:00Z',
};

describe('캐릭터 동기화 화면', () => {
  it('완료 카드는 동기화 화면에서만 보이고 닫으면 목록 검색을 유지한다', async () => {
    let starts = 0;
    let checks = 0;
    const props = {
      session: { loggedIn: true }, status: null, battle: makeBattleResource(),
      characterHub: makeCharacterManagementHubResource({
        characters: [makeHofCharacter(1, { name: '소셜' }), makeHofCharacter(2, { name: '사제' })],
        deepSync: { status: 'completed', progress: null, errorMessage: null, job: completed },
        actions: { checkRecovery: async () => { checks += 1; } },
      }),
      characterSyncLabel: null, notice: null,
      onSyncCharacterRoster: async () => { starts += 1; },
      onStartCharacterFullSync: async () => { starts += 1; },
      onOpenCaptcha: () => undefined, onLogout: () => undefined, onOpenLogin: () => undefined,
      automationController: {} as React.ComponentProps<typeof MainScreen>['automationController'],
      partyPresetCatalog: makePartyPresetCatalogResource({ folders: [], presets: [] }),
    };
    await rntl.render(React.createElement(MainScreen, props));
    await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '캐릭' }));
    assert.ok(rntl.screen.queryByText('전체 설정 동기화 #5 · 소셜') === null);
    await rntl.fireEvent.changeText(rntl.screen.getByLabelText('캐릭터 검색'), '소셜');
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '동기화' }));
    assert.ok(rntl.screen.getByText('전체 설정 동기화 #5 · 소셜'));
    assert.equal(starts, 0);
    assert.equal(checks, 1);
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '동기화 화면 닫기' }));
    assert.ok(rntl.screen.queryByText('전체 설정 동기화 #5 · 소셜') === null);
    assert.ok(rntl.screen.getByDisplayValue('소셜'));
    assert.equal(rntl.screen.queryByText('사제'), null);
    await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '홈' }));
    await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '캐릭' }));
    assert.ok(rntl.screen.getByDisplayValue('소셜'));
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '동기화' }));
    assert.ok(rntl.screen.getByText('전체 설정 동기화 #5 · 소셜'));
    assert.equal(starts, 0);
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '동기화 화면 닫기' }));
    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '프리셋' }));
    assert.ok(rntl.screen.getByText('프리셋 저장'));
    await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '홈' }));
    assert.ok(rntl.screen.queryByText('프리셋 저장') === null);
    await rntl.fireEvent.press(rntl.screen.getByRole('tab', { name: '캐릭' }));
    assert.ok(rntl.screen.getByText('프리셋 저장'));
  });
});

for (const [name, job, label] of [
  ['수집 진행', { ...completed, status: 'RUNNING', collectionStatus: 'INCOMPLETE', recoveryStatus: 'REQUIRED' }, '진행 중'],
  ['복원 진행', { ...completed, status: 'RUNNING', collectionStatus: 'FAILED', recoveryStatus: 'RESTORING' }, '진행 중'],
  ['복구 필요', { ...completed, status: 'FAILED', collectionStatus: 'FAILED', recoveryStatus: 'REQUIRED' }, '복구 필요'],
  ['원본 없음', { ...completed, status: 'FAILED', recoveryStatus: 'UNAVAILABLE' }, '복구 필요'],
  ['수집 실패·복원 완료', { ...completed, status: 'FAILED', collectionStatus: 'FAILED' }, '확인 필요'],
  ['현재 상태 수락', { ...completed, status: 'STOPPED', collectionStatus: 'FAILED', recoveryStatus: 'ACCEPTED' }, ''],
] as const) {
  it(`${name} 상태를 카드 없이 작은 진입점에 표시한다`, async () => {
    await rntl.render(React.createElement(CharacterSyncControl, { characterHub: makeCharacterManagementHubResource({
      deepSync: { status: 'idle', progress: null, errorMessage: null, job },
    }) }));
    assert.ok(rntl.screen.getByRole('button', { name: label ? `동기화 · ${label}` : '동기화' }));
    assert.ok(rntl.screen.queryByText(/전체 설정 동기화 #/) === null);
  });
}

it('대상 캐릭터의 동기화는 실행 버튼을 누를 때만 시작하고 화면 닫기는 작업을 중지하지 않는다', async () => {
  let starts = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const hub = makeCharacterManagementHubResource({ selectedCharacter: makeHofCharacter(1, { name: '소셜' }),
    actions: { deepSync: async () => { starts += 1; await pending; } },
  });
  await rntl.render(React.createElement(CharacterSyncControl, { characterHub: hub }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '동기화' }));
  assert.equal(starts, 0);
  assert.ok(rntl.screen.getByText('소셜'));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '전체 설정 동기화' }));
  assert.equal(starts, 1);
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '동기화 화면 닫기' }));
  await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '동기화' }));
  assert.equal(starts, 1);
  await rntl.act(async () => { finish(); await pending; });
});
