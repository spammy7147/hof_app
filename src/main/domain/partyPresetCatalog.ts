import type {
  PartyPresetCatalogResponse,
  PartyPresetFolderResponse,
  PartyPresetResponse,
} from '../types/api';
import { normalizePartyPresetSearchText } from './partyPresets';

const MAX_FOLDER_DEPTH = 5;
const UNASSIGNED_PATH = '미지정';

export type PartyPresetCatalogIndex = {
  foldersById: ReadonlyMap<number, PartyPresetFolderResponse>;
  childFolderIdsByParent: ReadonlyMap<number | null, readonly number[]>;
  presetIdsByFolder: ReadonlyMap<number | null, readonly number[]>;
  presetsById: ReadonlyMap<number, PartyPresetResponse>;
};

export type PartyPresetSearchResult = {
  preset: PartyPresetResponse;
  path: string;
  depth: 0;
};

/** API 응답을 변경하지 않고 안전하게 탐색할 수 있는 정렬된 인덱스로 투영한다. */
export function indexPartyPresetCatalog(
  catalog: PartyPresetCatalogResponse,
): PartyPresetCatalogIndex {
  const sortedFolders = [...catalog.folders].sort(compareOrderedRecords);
  const foldersById = uniqueById(sortedFolders);
  const validFolderIds = new Set<number>();

  for (const folderId of foldersById.keys()) {
    if (resolveFolderIds(foldersById, folderId) != null) validFolderIds.add(folderId);
  }

  const childFolderIdsByParent = new Map<number | null, number[]>();
  for (const folder of foldersById.values()) {
    const parentId = validFolderIds.has(folder.id) ? folder.parentFolderId : null;
    appendToBucket(childFolderIdsByParent, parentId, folder.id);
  }

  const sortedPresets = [...catalog.presets].sort(compareOrderedRecords);
  const presetsById = uniqueById(sortedPresets);
  const presetIdsByFolder = new Map<number | null, number[]>();
  for (const preset of presetsById.values()) {
    const folderId = preset.folderId != null && validFolderIds.has(preset.folderId)
      ? preset.folderId
      : null;
    appendToBucket(presetIdsByFolder, folderId, preset.id);
  }

  const index: PartyPresetCatalogIndex = {
    foldersById,
    childFolderIdsByParent,
    presetIdsByFolder,
    presetsById,
  };
  return index;
}

/** 폴더의 전체 경로를 반환하며, 잘못된 관계는 안전한 루트 경로로 표시한다. */
export function getPartyPresetFolderPath(
  index: PartyPresetCatalogIndex,
  folderId: number | null,
): string {
  if (folderId == null) return UNASSIGNED_PATH;
  const folder = index.foldersById.get(folderId);
  if (folder == null) return UNASSIGNED_PATH;

  const folderIds = resolveFolderIds(index.foldersById, folderId);
  if (folderIds == null) return folder.name;
  return folderIds
    .map((id) => index.foldersById.get(id)?.name)
    .filter((name): name is string => name != null)
    .join(' › ');
}

/** 현재 폴더와 무관하게 프리셋 이름만 검색한 평면 결과를 반환한다. */
export function searchPartyPresetCatalog(
  index: PartyPresetCatalogIndex,
  query: string,
): PartyPresetSearchResult[] {
  const normalizedQuery = normalizePartyPresetSearchText(query);
  if (normalizedQuery.length === 0) return [];

  return [...index.presetsById.values()].flatMap((preset) => (
    normalizePartyPresetSearchText(preset.name).includes(normalizedQuery)
      ? [{ preset, path: getPartyPresetFolderPath(index, effectiveFolderId(index, preset)), depth: 0 as const }]
      : []
  ));
}

/** 이동 대상, 순환, 그리고 이동 후 최대 5단계 제한을 클라이언트에서도 미리 검증한다. */
export function canMovePartyPresetFolder(
  index: PartyPresetCatalogIndex,
  folderId: number,
  parentFolderId: number | null,
): boolean {
  if (resolveFolderIds(index.foldersById, folderId) == null) return false;
  if (folderId === parentFolderId) return false;

  const parentPath = parentFolderId == null
    ? []
    : resolveFolderIds(index.foldersById, parentFolderId);
  if (parentPath == null || parentPath.includes(folderId)) return false;

  return parentPath.length + subtreeHeight(index, folderId) <= MAX_FOLDER_DEPTH;
}

function effectiveFolderId(
  index: PartyPresetCatalogIndex,
  preset: PartyPresetResponse,
): number | null {
  return preset.folderId != null && resolveFolderIds(index.foldersById, preset.folderId) != null
    ? preset.folderId
    : null;
}

function subtreeHeight(index: PartyPresetCatalogIndex, rootFolderId: number): number {
  let greatestHeight = 1;
  const pending: Array<{ folderId: number; height: number }> = [{ folderId: rootFolderId, height: 1 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current == null) break;
    greatestHeight = Math.max(greatestHeight, current.height);
    for (const childId of index.childFolderIdsByParent.get(current.folderId) ?? []) {
      pending.push({ folderId: childId, height: current.height + 1 });
    }
  }
  return greatestHeight;
}

function resolveFolderIds(
  foldersById: ReadonlyMap<number, PartyPresetFolderResponse>,
  folderId: number,
): number[] | null {
  const reversedPath: number[] = [];
  const visited = new Set<number>();
  let currentId: number | null = folderId;

  while (currentId != null) {
    if (visited.has(currentId)) return null;
    const current = foldersById.get(currentId);
    if (current == null) return null;
    visited.add(currentId);
    reversedPath.push(currentId);
    if (reversedPath.length > MAX_FOLDER_DEPTH) return null;
    currentId = current.parentFolderId;
  }

  return reversedPath.reverse();
}

function compareOrderedRecords(
  left: { displayOrder: number; id: number },
  right: { displayOrder: number; id: number },
): number {
  return left.displayOrder - right.displayOrder || left.id - right.id;
}

function uniqueById<T extends { id: number }>(records: readonly T[]): Map<number, T> {
  const result = new Map<number, T>();
  for (const record of records) {
    if (!result.has(record.id)) result.set(record.id, record);
  }
  return result;
}

function appendToBucket<K, V>(buckets: Map<K, V[]>, key: K, value: V): void {
  const bucket = buckets.get(key);
  if (bucket == null) buckets.set(key, [value]);
  else bucket.push(value);
}
