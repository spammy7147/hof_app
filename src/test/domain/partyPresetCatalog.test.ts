import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canMovePartyPresetFolder,
  getPartyPresetFolderPath,
  indexPartyPresetCatalog,
  searchPartyPresetCatalog,
} from '../../main/domain/partyPresetCatalog';
import type {
  PartyPresetCatalogResponse,
  PartyPresetFolderResponse,
  PartyPresetResponse,
} from '../../main/types/api';

describe('party preset catalog projection', () => {
  it('sorts copied root, child, and preset collections by display order then id', () => {
    const catalog = makeCatalog(
      [folder(4, 'child-b', 1, 0), folder(2, 'root-b', null, 0), folder(3, 'child-a', 1, 0), folder(1, 'root-a', null, 0)],
      [preset(4, 'child-b', 1, 0), preset(2, 'unassigned-b', null, 0), preset(3, 'child-a', 1, 0), preset(1, 'unassigned-a', null, 0)],
    );
    const originalFolderIds = catalog.folders.map(({ id }) => id);
    const originalPresetIds = catalog.presets.map(({ id }) => id);

    const index = indexPartyPresetCatalog(catalog);

    assert.deepEqual(index.childFolderIdsByParent.get(null), [1, 2]);
    assert.deepEqual(index.childFolderIdsByParent.get(1), [3, 4]);
    assert.deepEqual(index.presetIdsByFolder.get(null), [1, 2]);
    assert.deepEqual(index.presetIdsByFolder.get(1), [3, 4]);
    assert.deepEqual(catalog.folders.map(({ id }) => id), originalFolderIds);
    assert.deepEqual(catalog.presets.map(({ id }) => id), originalPresetIds);
  });

  it('resolves a complete five-level breadcrumb and the virtual unassigned path', () => {
    const index = indexPartyPresetCatalog(makeCatalog([
      folder(1, '전투', null, 0),
      folder(2, '레이드', 1, 0),
      folder(3, '속성', 2, 0),
      folder(4, '화속성', 3, 0),
      folder(5, '고난도', 4, 0),
    ]));

    assert.equal(getPartyPresetFolderPath(index, 5), '전투 › 레이드 › 속성 › 화속성 › 고난도');
    assert.equal(getPartyPresetFolderPath(index, null), '미지정');
  });

  it('places orphaned and cyclic folders and their presets in root-safe buckets', () => {
    const index = indexPartyPresetCatalog(makeCatalog(
      [folder(1, 'valid', null, 0), folder(2, 'orphan', 99, 0), folder(3, 'cycle-a', 4, 0), folder(4, 'cycle-b', 3, 0)],
      [preset(1, 'valid preset', 1, 0), preset(2, 'orphan preset', 99, 0), preset(3, 'cycle preset', 3, 0)],
    ));

    assert.deepEqual(index.childFolderIdsByParent.get(null), [1, 2, 3, 4]);
    assert.equal(index.childFolderIdsByParent.get(99), undefined);
    assert.equal(index.childFolderIdsByParent.get(3), undefined);
    assert.deepEqual(index.presetIdsByFolder.get(null), [2, 3]);
    assert.deepEqual(index.presetIdsByFolder.get(1), [1]);
    assert.equal(getPartyPresetFolderPath(index, 3), 'cycle-a');
  });

  it('searches preset names globally and returns flat results with their paths', () => {
    const index = indexPartyPresetCatalog(makeCatalog(
      [folder(1, '전투', null, 0), folder(2, '레이드', 1, 0)],
      [preset(1, '화속성 TEAM', 2, 2), preset(2, 'team 미지정', null, 1), preset(3, 'other', 2, 0)],
    ));

    assert.deepEqual(searchPartyPresetCatalog(index, '  team  '), [
      { preset: preset(2, 'team 미지정', null, 1), path: '미지정', depth: 0 },
      { preset: preset(1, '화속성 TEAM', 2, 2), path: '전투 › 레이드', depth: 0 },
    ]);
    assert.deepEqual(searchPartyPresetCatalog(index, '레이드'), []);
    assert.deepEqual(searchPartyPresetCatalog(index, '   '), []);
  });

  it('rejects self, descendant, missing, malformed, and over-depth folder moves', () => {
    const index = indexPartyPresetCatalog(makeCatalog([
      folder(1, 'one', null, 0),
      folder(2, 'two', 1, 0),
      folder(3, 'three', 2, 0),
      folder(4, 'four', 3, 0),
      folder(5, 'five', 4, 0),
      folder(6, 'subtree-root', null, 1),
      folder(7, 'subtree-child', 6, 0),
      folder(8, 'orphan', 99, 0),
    ]));

    assert.equal(canMovePartyPresetFolder(index, 1, 1), false);
    assert.equal(canMovePartyPresetFolder(index, 1, 3), false);
    assert.equal(canMovePartyPresetFolder(index, 999, null), false);
    assert.equal(canMovePartyPresetFolder(index, 6, 999), false);
    assert.equal(canMovePartyPresetFolder(index, 8, null), false);
    assert.equal(canMovePartyPresetFolder(index, 6, 4), false);
    assert.equal(canMovePartyPresetFolder(index, 6, 3), true);
    assert.equal(canMovePartyPresetFolder(index, 5, null), true);
  });
});

function makeCatalog(
  folders: PartyPresetFolderResponse[] = [],
  presets: PartyPresetResponse[] = [],
): PartyPresetCatalogResponse {
  return { folders, presets };
}

function folder(
  id: number,
  name: string,
  parentFolderId: number | null,
  displayOrder: number,
): PartyPresetFolderResponse {
  return { id, name, parentFolderId, displayOrder, createdAt: '2026-07-27', updatedAt: '2026-07-27' };
}

function preset(
  id: number,
  name: string,
  folderId: number | null,
  displayOrder: number,
): PartyPresetResponse {
  return {
    id,
    accountId: 1,
    name,
    displayOrder,
    isPrimary: false,
    members: [],
    createdAt: '2026-07-27',
    updatedAt: '2026-07-27',
    folderId,
  };
}
