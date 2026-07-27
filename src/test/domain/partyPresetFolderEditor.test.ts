import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { indexPartyPresetCatalog } from '../../main/domain/partyPresetCatalog';
import {
  buildPartyPresetFolderEditorRows,
  planPartyPresetFolderDrop,
} from '../../main/domain/partyPresetFolderEditor';
import type {
  PartyPresetCatalogResponse,
  PartyPresetFolderResponse,
} from '../../main/types/api';

describe('party preset folder editor', () => {
  it('builds one depth-first tree and keeps moved descendants visible', () => {
    const index = makeIndex([
      folder(3, 'other', null, 1),
      folder(2, 'new2', 1, 0),
      folder(1, 'New1', null, 0),
    ]);

    const rows = buildPartyPresetFolderEditorRows(index, new Set([1]));

    assert.deepEqual(rows.map(({ folderId, depth }) => [folderId, depth]), [
      [1, 0],
      [2, 1],
      [3, 0],
    ]);
    assert.deepEqual(rows, [
      { folderId: 1, name: 'New1', depth: 0, parentFolderId: null, expanded: true, hasChildren: true },
      { folderId: 2, name: 'new2', depth: 1, parentFolderId: 1, expanded: false, hasChildren: false },
      { folderId: 3, name: 'other', depth: 0, parentFolderId: null, expanded: false, hasChildren: false },
    ]);
  });

  it('includes children only below expanded ancestors without mutating the expanded set', () => {
    const index = makeIndex([
      folder(1, 'one', null, 0),
      folder(2, 'two', 1, 0),
      folder(3, 'three', 2, 0),
    ]);
    const expanded = Object.freeze(new Set([2]));

    assert.deepEqual(
      buildPartyPresetFolderEditorRows(index, expanded).map(({ folderId }) => folderId),
      [1],
    );
    assert.deepEqual([...expanded], [2]);
  });

  it('plans an inside drop by appending after destination children excluding the moving folder', () => {
    const index = makeIndex([
      folder(1, 'target', null, 0),
      folder(2, 'moving', 1, 0),
      folder(3, 'sibling', 1, 1),
      folder(4, 'other', null, 1),
    ]);

    assert.deepEqual(planPartyPresetFolderDrop(index, 4, 1, 'inside'), {
      parentFolderId: 1,
      displayOrder: 2,
    });
    assert.deepEqual(planPartyPresetFolderDrop(index, 2, 1, 'inside'), {
      parentFolderId: 1,
      displayOrder: 1,
    });
  });

  it('plans before and after drops relative to the target sibling', () => {
    const index = makeIndex([
      folder(1, 'first', null, 0),
      folder(2, 'second', null, 1),
      folder(3, 'moving', 1, 0),
    ]);

    assert.deepEqual(planPartyPresetFolderDrop(index, 3, 2, 'before'), {
      parentFolderId: null,
      displayOrder: 1,
    });
    assert.deepEqual(planPartyPresetFolderDrop(index, 3, 2, 'after'), {
      parentFolderId: null,
      displayOrder: 2,
    });
  });

  it('calculates same-parent reorders after removing the moving folder', () => {
    const index = makeIndex([
      folder(1, 'first', null, 0),
      folder(2, 'second', null, 1),
      folder(3, 'third', null, 2),
      folder(4, 'fourth', null, 3),
    ]);

    assert.deepEqual(planPartyPresetFolderDrop(index, 1, 3, 'after'), {
      parentFolderId: null,
      displayOrder: 2,
    });
    assert.deepEqual(planPartyPresetFolderDrop(index, 4, 2, 'before'), {
      parentFolderId: null,
      displayOrder: 1,
    });
  });

  it('rejects missing targets, missing movers, and self drops', () => {
    const index = makeIndex([folder(1, 'one', null, 0)]);

    assert.equal(planPartyPresetFolderDrop(index, 1, 999, 'inside'), null);
    assert.equal(planPartyPresetFolderDrop(index, 999, 1, 'inside'), null);
    assert.equal(planPartyPresetFolderDrop(index, 1, 1, 'inside'), null);
    assert.equal(planPartyPresetFolderDrop(index, 1, 1, 'before'), null);
  });

  it('rejects drops into descendants for inside and sibling zones', () => {
    const index = makeIndex([
      folder(1, 'parent', null, 0),
      folder(2, 'child', 1, 0),
      folder(3, 'grandchild', 2, 0),
    ]);

    assert.equal(planPartyPresetFolderDrop(index, 1, 2, 'inside'), null);
    assert.equal(planPartyPresetFolderDrop(index, 1, 3, 'before'), null);
    assert.equal(planPartyPresetFolderDrop(index, 1, 3, 'after'), null);
  });

  it('rejects a drop that would create a sixth folder depth', () => {
    const index = makeIndex([
      folder(1, 'one', null, 0),
      folder(2, 'two', 1, 0),
      folder(3, 'three', 2, 0),
      folder(4, 'four', 3, 0),
      folder(5, 'five', 4, 0),
      folder(6, 'moving', null, 1),
    ]);

    assert.equal(planPartyPresetFolderDrop(index, 6, 5, 'inside'), null);
  });
});

function makeIndex(folders: PartyPresetFolderResponse[]) {
  const catalog: PartyPresetCatalogResponse = { folders, presets: [] };
  return indexPartyPresetCatalog(catalog);
}

function folder(
  id: number,
  name: string,
  parentFolderId: number | null,
  displayOrder: number,
): PartyPresetFolderResponse {
  return {
    id,
    name,
    parentFolderId,
    displayOrder,
    createdAt: '2026-07-28T00:00:00Z',
    updatedAt: '2026-07-28T00:00:00Z',
  };
}
