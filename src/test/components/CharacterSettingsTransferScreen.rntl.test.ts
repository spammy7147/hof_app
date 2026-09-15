import assert from 'node:assert/strict';
import Module from 'node:module';
import { afterEach, describe, it } from 'node:test';
import React, { useSyncExternalStore } from 'react';
import type { AlertButton, FlatListProps } from 'react-native';
import { CharacterManagementHubModule } from '../../main/domain/characterManagementHubModule';
import type { CharacterTransferExecutionResult, HofCharacter } from '../../main/types/api';
import { makeHofCharacter, makeHofCharacterDetail } from '../fixtures/api';
import { makeCharacterManagementHubResource } from '../fixtures/characterManagementHub';

const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name,
  { ...props, accessible: props.accessible ?? (name === 'Pressable' ? true : undefined) }, props.children as React.ReactNode);
let confirmation: AlertButton | undefined;
type Loader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const original = loader._load;
loader._load = (request, parent, isMain) => request === 'react-native' ? {
  View: host('View'), Text: host('Text'), TextInput: host('TextInput'), Pressable: host('Pressable'),
  FlatList: ({ data, renderItem }: FlatListProps<HofCharacter>) => React.createElement('ScrollView', null,
    data && Array.from(data).map((item, index) => React.createElement(React.Fragment, { key: item.id },
      renderItem?.({ item, index, separators: { highlight() {}, unhighlight() {}, updateProps() {} } })))),
  Alert: { alert: (_title: string, _message: string, buttons: AlertButton[]) => { confirmation = buttons.find(item => item.text === '가져오기'); } },
  StyleSheet: { create: <T,>(value: T) => value, flatten: (value: unknown) => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean)) : value },
} : request === 'react-native-draggable-flatlist' ? { NestableScrollContainer: host('ScrollView') } : original(request, parent, isMain);
const rntl = require('@testing-library/react-native/pure') as typeof import('@testing-library/react-native/pure');
const { CharacterSettingsTransferScreen } = require('../../main/features/characters/transfer/CharacterSettingsTransferScreen') as typeof import('../../main/features/characters/transfer/CharacterSettingsTransferScreen');
loader._load = original;
afterEach(async () => { confirmation = undefined; await rntl.cleanup(); });

function Screen({ hub }: { hub: CharacterManagementHubModule }) {
  const resource = useSyncExternalStore(hub.subscribe, hub.getSnapshot, hub.getSnapshot);
  return React.createElement(CharacterSettingsTransferScreen, { characterHub: resource, onBack() {} });
}

describe('설정 가져오기 실행 결과', () => {
  it('변경된 단계가 보인 뒤 새 확인창에서 확인해야 다시 실행한다', async () => {
    const tokens: string[] = [];
    const user = rntl.userEvent.setup();
    const hub = new CharacterManagementHubModule({
      loadStoredDetail: async id => makeHofCharacterDetail(id, { detailSyncedAt: new Date().toISOString(),
        patternOptions: [
          { type: 'CONDITION', value: '0', label: '항상', category: null },
          { type: 'SKILL', value: '1', label: '공격', category: null },
          { type: 'SKILL', value: '2', label: '방어', category: null },
        ],
        learnableSkills: [{ value: 'heal', name: '회복', iconUrl: '', category: '' }],
      }),
      refreshAuthoritativeDetail: async id => makeHofCharacterDetail(id),
      previewTransfer: async () => ({ sourceCharacterId: 2, targetCharacterId: 1,
        steps: [{ id: 'current-pattern', dependsOn: [],
          setting: { rows: [{ judge: '0', quantity: '0', skill: '1' }], position: 'front', guard: 'never' } }],
        issues: [], executable: true, confirmationToken: 'before' }),
      executeTransfer: async request => {
        tokens.push(request.confirmationToken);
        return tokens.length === 1 ? {
          targetCharacterId: 1, results: [], nextStepIndex: 0, outcome: 'PREVIEW_CHANGED',
          message: '변경된 미리보기를 다시 확인해 주세요.',
          preview: { sourceCharacterId: 2, targetCharacterId: 1, executable: true, confirmationToken: 'after', issues: [],
            steps: [
              { id: 'current-pattern', dependsOn: [],
                setting: { rows: [{ judge: '0', quantity: '25', skill: '2' }], position: 'back', guard: 'always' } },
              { id: 'saved-pattern:0:1', dependsOn: [], sourceSlot: '0', targetSlot: '1', name: '새 패턴', replacesExisting: true },
              { id: 'stats', dependsOn: [], amounts: { STR: 3, INT: 2 } },
              { id: 'skill:heal', dependsOn: [], skillValue: 'heal' },
              { id: 'equipment-current:item:0', dependsOn: [], equipmentPart: '무기', itemValue: 'weapon-2',
                identity: { slot: '', part: '무기', name: '강철검', iconUrl: '', description: '공격력 +5', checked: false } },
              { id: 'equipment-preset:2:clear', type: 'REMOVE_ALL_EQUIPMENT', dependsOn: [] },
              { id: 'equipment-preset:2:save', dependsOn: [], slotNumber: 2 },
            ] },
        } : { targetCharacterId: 1, results: [], nextStepIndex: 0, outcome: 'COMPLETED', finalSettingsConfirmed: true };
      },
    });
    const target = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([target, makeHofCharacter(2)]);
    await hub.getSnapshot().actions.select(target);
    await hub.getSnapshot().actions.previewTransfer?.({ sourceCharacterId: 2, targetCharacterId: 1,
      transfer: { includeCurrentPattern: true, savedPatternMappings: [], includeStats: false, includeSkills: false, includeEquipment: false } });
    await rntl.render(React.createElement(Screen, { hub }));
    assert.ok(rntl.screen.getByText('1. 항상 0 → 공격'));
    await user.press(rntl.screen.getByRole('button', { name: '가져오기' }));
    const oldConfirmation = confirmation!.onPress!;
    await rntl.act(async () => { await oldConfirmation(); });

    assert.ok(rntl.screen.getByText('변경된 미리보기를 다시 확인해 주세요.'));
    assert.ok(rntl.screen.getByText('저장 패턴 새 패턴 → 대상 슬롯 1 교체'));
    assert.ok(rntl.screen.getByText('1. 항상 25 → 방어'));
    assert.equal(rntl.screen.queryByText('1. 항상 0 → 공격'), null);
    assert.ok(rntl.screen.getByText('위치 · 후열 / 호위 · always'));
    assert.ok(rntl.screen.getByText('스탯 배분 · STR +3 · INT +2'));
    assert.ok(rntl.screen.getByText('스킬 습득 · 회복 (heal)'));
    assert.ok(rntl.screen.getByText('무기 · 강철검'));
    assert.ok(rntl.screen.getByText('공격력 +5'));
    assert.ok(rntl.screen.getByText('현재 장비를 모두 해제합니다.'));
    assert.ok(rntl.screen.getByText('장비 설정을 슬롯 2에 저장합니다.'));
    assert.equal(rntl.screen.queryByText('설정 가져오기를 완료했습니다.'), null);
    await rntl.act(async () => { await oldConfirmation(); });
    assert.deepEqual(tokens, ['before']);
    await user.press(rntl.screen.getByRole('button', { name: '가져오기' }));
    await rntl.act(async () => { await confirmation!.onPress!(); });
    assert.deepEqual(tokens, ['before', 'after']);
    assert.ok(rntl.screen.getByText('설정 가져오기를 완료했습니다.'));
    await rntl.screen.unmount();
    hub.deactivate();
  });

  it('부분 반영 뒤 대상 정보를 갱신하고 실제 현재 설정과 미완료 요약을 표시한다', async () => {
    const result = {
      targetCharacterId: 1,
      results: [
        { stepId: 'saved-pattern:0', status: 'COMPLETED' as const, message: '' },
        { stepId: 'current-pattern', status: 'FAILED' as const, message: '마지막 패턴 적용이 거절됐습니다.' },
      ],
      nextStepIndex: 1,
      outcome: 'PARTIALLY_APPLIED' as const,
      finalSettingsConfirmed: false,
      currentSettings: { pattern: { rows: [{ judge: '0', quantity: '0', skill: '2' }], position: 'front', guard: 'never' }, equipment: null },
      message: '현재 캐릭터 설정이 가져오기 계획과 다릅니다. 현재 설정을 확인해 주세요.',
    };
    const refreshes: number[] = [];
    let presetReloads = 0;
    const hub = new CharacterManagementHubModule({
      loadStoredDetail: async id => makeHofCharacterDetail(id, { detailSyncedAt: new Date().toISOString() }),
      refreshAuthoritativeDetail: async id => {
        refreshes.push(id);
        return makeHofCharacterDetail(id, { revision: 'after-transfer' });
      },
      previewTransfer: async () => ({ sourceCharacterId: 2, targetCharacterId: 1, steps: [], issues: [], executable: true, confirmationToken: 'fixture-preview' }),
      executeTransfer: async (_request, onProgress) => {
        onProgress({ targetCharacterId: 1, results: result.results.slice(0, 1), nextStepIndex: 1 });
        return result;
      },
      reloadRelatedPresets: async () => { presetReloads += 1; },
    });
    const target = makeHofCharacter(1);
    hub.activate('account-1');
    hub.observeRoster([target, makeHofCharacter(2)]);
    await hub.getSnapshot().actions.select(target);
    await hub.getSnapshot().actions.previewTransfer?.({ sourceCharacterId: 2, targetCharacterId: 1,
      transfer: { includeCurrentPattern: true, savedPatternMappings: [], includeStats: false, includeSkills: false, includeEquipment: false } });
    await rntl.render(React.createElement(Screen, { hub }));

    await rntl.fireEvent.press(rntl.screen.getByRole('button', { name: '가져오기' }));
    assert.ok(confirmation?.onPress);
    await rntl.act(async () => { await confirmation!.onPress!(); });

    assert.ok(rntl.screen.getByText('일부 항목을 완료하지 못했습니다.'));
    assert.ok(rntl.screen.getByText(result.message));
    assert.ok(rntl.screen.getByText('확인된 현재 캐릭터 설정'));
    assert.ok(rntl.screen.getByText('1. 0 0 → 2'));
    assert.ok(rntl.screen.getByText(/마지막 패턴 적용이 거절됐습니다/));
    assert.equal(rntl.screen.queryByText('설정 가져오기를 완료했습니다.'), null);
    assert.deepEqual(refreshes, [1]);
    assert.equal(presetReloads, 1);
    assert.equal(hub.getSnapshot().detail?.revision, 'after-transfer');
    assert.equal(hub.getSnapshot().transfer.result, result satisfies CharacterTransferExecutionResult);
    await rntl.screen.unmount();
    hub.deactivate();
  });

  it('최종 관측 정보가 없는 구형 결과는 완료로 추정하지 않고 확인이 필요함을 표시한다', async () => {
    const result: CharacterTransferExecutionResult = {
      targetCharacterId: 1, results: [{ stepId: 'current-pattern', status: 'COMPLETED', message: '' }], nextStepIndex: 1,
    };
    const resource = makeCharacterManagementHubResource({ detail: makeHofCharacterDetail(1) });
    resource.transfer = { ...resource.transfer, status: 'completed', result };
    await rntl.render(React.createElement(CharacterSettingsTransferScreen, { characterHub: resource, onBack() {} }));

    assert.ok(rntl.screen.getByText('이전 작업에는 최종 확인 정보가 없습니다. 현재 캐릭터 설정을 확인해 주세요.'));
    assert.equal(rntl.screen.queryByText('설정 가져오기를 완료했습니다.'), null);
    assert.equal(rntl.screen.queryByText('확인된 현재 캐릭터 설정'), null);

    await rntl.screen.rerender(React.createElement(CharacterSettingsTransferScreen, {
      characterHub: { ...resource, transfer: { ...resource.transfer, status: 'running', result: null, progress: result } }, onBack() {},
    }));
    assert.equal(rntl.screen.queryByText(/이전 작업에는 최종 확인 정보가 없습니다/), null);
  });

  for (const outcome of ['COMPLETED', 'RECHECK_REQUIRED'] as const) {
    it(`${outcome} 결과는 최종 관측 유무에 맞춰 요약과 현재 설정을 표시한다`, async () => {
      const result: CharacterTransferExecutionResult = {
        targetCharacterId: 1, results: [{ stepId: 'current-pattern', status: 'COMPLETED', message: '' }], nextStepIndex: 1,
        outcome, finalSettingsConfirmed: outcome === 'COMPLETED',
        currentSettings: outcome === 'COMPLETED'
          ? { pattern: { rows: [{ judge: '0', quantity: '0', skill: '2' }], position: 'front', guard: 'never' }, equipment: [] }
          : null,
      };
      const resource = makeCharacterManagementHubResource({ detail: makeHofCharacterDetail(1, {
        patternOptions: [{ type: 'CONDITION', value: '0', label: '항상', category: null }, { type: 'SKILL', value: '2', label: '방어', category: null }],
        positionGuard: { positions: [], selectedPosition: 'front', guardValue: 'never', guardText: '호위 안 함' },
      }) });
      resource.transfer = { ...resource.transfer, status: 'completed', result };
      await rntl.render(React.createElement(CharacterSettingsTransferScreen, { characterHub: resource, onBack() {} }));

      if (outcome === 'COMPLETED') {
        assert.ok(rntl.screen.getByText('설정 가져오기를 완료했습니다.'));
        assert.ok(rntl.screen.getByText('1. 항상 0 → 방어'));
        assert.ok(rntl.screen.getByText('위치 · 전열 / 호위 · 호위 안 함'));
        assert.ok(rntl.screen.getByText('장비 · 장착 장비 없음'));
        assert.equal(rntl.screen.queryByRole('alert'), null);
      } else {
        assert.ok(rntl.screen.getByRole('alert', { name: '현재 캐릭터 설정을 다시 확인해야 합니다.' }));
        assert.equal(rntl.screen.queryByText('설정 가져오기를 완료했습니다.'), null);
        assert.equal(rntl.screen.queryByText('확인된 현재 캐릭터 설정'), null);
      }
    });
  }
});
