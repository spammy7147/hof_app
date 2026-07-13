import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_MAIN_TAB_ID, MAIN_TABS, getMainTab } from '../../main/domain/mainTabs';

describe('main tab navigation model', () => {
  it('keeps the game-style bottom tab order stable', () => {
    assert.deepEqual(
      MAIN_TABS.map((tab) => tab.id),
      ['home', 'battle', 'characters', 'town', 'data', 'settings'],
    );
  });

  it('uses home as the default landing tab and resolves labels', () => {
    assert.equal(DEFAULT_MAIN_TAB_ID, 'home');
    assert.equal(getMainTab('characters')?.label, '캐릭');
    assert.equal(getMainTab('missing'), undefined);
  });
});
