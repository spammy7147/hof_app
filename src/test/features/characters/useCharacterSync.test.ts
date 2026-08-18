import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useCharacterSync } from '../../../main/features/characters/useCharacterSync';
import type { BackendApiClient } from '../../../main/services/backendApi';
import type { HofCharacter, HofObservedStatusResponse } from '../../../main/types/api';
import { makeHofCharacter } from '../../fixtures/api';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useCharacterSync roster observation', () => {
  it('reloads characters only for a newer observed home roster', async () => {
    let sync!: ReturnType<typeof useCharacterSync>;
    let publishStatus: ((status: HofObservedStatusResponse) => void) | null = null;
    let listCalls = 0;
    const rosters: HofCharacter[][] = [
      [makeHofCharacter(1, { name: '첫 목록' })],
      [makeHofCharacter(2, { name: '다음 목록' })],
    ];
    const api = {
      subscribeHofStatus(listener: (status: HofObservedStatusResponse) => void) {
        publishStatus = listener;
        return () => { publishStatus = null; };
      },
      async listCharacters() {
        const result = rosters[listCalls] ?? rosters.at(-1) ?? [];
        listCalls += 1;
        return result;
      },
    } as unknown as BackendApiClient;
    const Harness = () => {
      sync = useCharacterSync({ api, describeError: String, onNotice: () => undefined });
      return null;
    };
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(React.createElement(Harness)); });

    await act(async () => {
      publishStatus?.(observedStatus('2026-08-18T07:00:00Z'));
      await Promise.resolve();
    });
    assert.equal(listCalls, 1);
    assert.equal(sync.characters[0]?.name, '첫 목록');

    await act(async () => {
      publishStatus?.(observedStatus('2026-08-18T07:00:00Z'));
      publishStatus?.(observedStatus('2026-08-18T06:59:59Z'));
      await Promise.resolve();
    });
    assert.equal(listCalls, 1);

    await act(async () => {
      publishStatus?.(observedStatus('2026-08-18T07:00:01Z'));
      await Promise.resolve();
    });
    assert.equal(listCalls, 2);
    assert.equal(sync.characters[0]?.name, '다음 목록');
    await act(async () => { renderer.unmount(); });
  });
});

function observedStatus(characterRosterObservedAt: string): HofObservedStatusResponse {
  return {
    playerName: '사용자',
    funds: 100,
    timeCurrent: 10,
    timeMax: 20,
    work: 'Nothing',
    auction: 'Nothing',
    observedAt: characterRosterObservedAt,
    characterRosterObservedAt,
  };
}
