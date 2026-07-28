import {
  canMovePartyPresetFolder,
  type PartyPresetCatalogIndex,
} from './partyPresetCatalog';

export type PartyPresetFolderEditorRow = {
  folderId: number;
  name: string;
  depth: number;
  parentFolderId: number | null;
  expanded: boolean;
  hasChildren: boolean;
};

export type PartyPresetFolderDropZone = 'before' | 'inside' | 'after';

export type PartyPresetFolderDropPlan = {
  parentFolderId: number | null;
  displayOrder: number;
};

export function buildPartyPresetFolderEditorRows(
  index: PartyPresetCatalogIndex,
  expandedFolderIds: ReadonlySet<number>,
): PartyPresetFolderEditorRow[] {
  const rows: PartyPresetFolderEditorRow[] = [];
  const visited = new Set<number>();

  function appendChildren(parentFolderId: number | null, depth: number): void {
    for (const folderId of index.childFolderIdsByParent.get(parentFolderId) ?? []) {
      if (visited.has(folderId)) continue;
      const folder = index.foldersById.get(folderId);
      if (folder == null) continue;
      visited.add(folderId);

      const childIds = index.childFolderIdsByParent.get(folderId) ?? [];
      const expanded = expandedFolderIds.has(folderId);
      rows.push({
        folderId,
        name: folder.name,
        depth,
        parentFolderId,
        expanded,
        hasChildren: childIds.length > 0,
      });

      if (expanded) appendChildren(folderId, depth + 1);
    }
  }

  appendChildren(null, 0);
  return rows;
}

export function planPartyPresetFolderDrop(
  index: PartyPresetCatalogIndex,
  movingFolderId: number,
  targetFolderId: number,
  zone: PartyPresetFolderDropZone,
): PartyPresetFolderDropPlan | null {
  const target = index.foldersById.get(targetFolderId);
  if (target == null || movingFolderId === targetFolderId) return null;

  const parentFolderId = zone === 'inside' ? targetFolderId : target.parentFolderId;
  if (!canMovePartyPresetFolder(index, movingFolderId, parentFolderId)) return null;

  const destinationFolderIds = (index.childFolderIdsByParent.get(parentFolderId) ?? [])
    .filter((folderId) => folderId !== movingFolderId);

  if (zone === 'inside') {
    return { parentFolderId, displayOrder: destinationFolderIds.length };
  }

  const targetIndex = destinationFolderIds.indexOf(targetFolderId);
  if (targetIndex < 0) return null;
  return {
    parentFolderId,
    displayOrder: targetIndex + (zone === 'after' ? 1 : 0),
  };
}
