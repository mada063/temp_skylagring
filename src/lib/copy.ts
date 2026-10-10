import { prisma } from "@/lib/prisma";
import { getDescendantIds } from "@/lib/trash";
import {
  copyFileBytes,
  fileExistsOnDisk,
  saveFileBytes,
} from "@/lib/storage";
import { fileBaseName } from "@/lib/fileType";

function nextCopyName(original: string, taken: Set<string>): string {
  const base = fileBaseName(original);
  if (!taken.has(base.toLowerCase())) return base;

  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";

  let n = 1;
  while (true) {
    const candidate = n === 1 ? `${stem} (copy)${ext}` : `${stem} (copy ${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    n++;
  }
}

async function takenNamesInFolder(
  userId: string,
  folderId: string | null,
): Promise<{ files: Set<string>; folders: Set<string> }> {
  const [files, folders] = await Promise.all([
    prisma.file.findMany({
      where: { userId, folderId, deletedAt: null },
      select: { name: true },
    }),
    prisma.folder.findMany({
      where: { userId, parentId: folderId, deletedAt: null },
      select: { name: true },
    }),
  ]);
  return {
    files: new Set(files.map((f) => f.name.toLowerCase())),
    folders: new Set(folders.map((f) => f.name.toLowerCase())),
  };
}

async function duplicateFileBytes(
  sourceId: string,
  destId: string,
): Promise<void> {
  if (await fileExistsOnDisk(sourceId)) {
    await copyFileBytes(sourceId, destId);
    return;
  }
  const data = await prisma.fileData.findUnique({
    where: { fileId: sourceId },
    select: { bytes: true },
  });
  if (data) {
    await saveFileBytes(destId, Buffer.from(data.bytes));
  }
}

async function copyOneFile(
  userId: string,
  fileId: string,
  destFolderId: string | null,
  takenFileNames: Set<string>,
): Promise<string | null> {
  const source = await prisma.file.findFirst({
    where: { id: fileId, userId, deletedAt: null },
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
    },
  });
  if (!source) return null;

  const name = nextCopyName(source.name, takenFileNames);
  takenFileNames.add(name.toLowerCase());

  const created = await prisma.file.create({
    data: {
      name,
      mimeType: source.mimeType,
      size: source.size,
      userId,
      folderId: destFolderId,
    },
    select: { id: true },
  });
  await duplicateFileBytes(source.id, created.id);
  return created.id;
}

/**
 * Recursively copy a folder tree into `destParentId`.
 * Uses exact child names inside the new tree (no "(copy)" on nested items).
 */
async function copyOneFolder(
  userId: string,
  folderId: string,
  destParentId: string | null,
  takenFolderNames: Set<string>,
): Promise<string | null> {
  const source = await prisma.folder.findFirst({
    where: { id: folderId, userId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!source) return null;

  // Never paste a folder into itself or a descendant.
  const tree = await getDescendantIds(userId, source.id);
  if (destParentId && tree.includes(destParentId)) {
    throw new Error(
      `Cannot paste "${source.name}" into itself or a subfolder.`,
    );
  }

  const name = nextCopyName(source.name, takenFolderNames);
  takenFolderNames.add(name.toLowerCase());

  const created = await prisma.folder.create({
    data: { name, parentId: destParentId, userId },
    select: { id: true },
  });

  const [childFiles, childFolders] = await Promise.all([
    prisma.file.findMany({
      where: { folderId: source.id, userId, deletedAt: null },
      select: { id: true },
    }),
    prisma.folder.findMany({
      where: { parentId: source.id, userId, deletedAt: null },
      select: { id: true },
    }),
  ]);

  const nestedTaken = await takenNamesInFolder(userId, created.id);
  for (const file of childFiles) {
    await copyOneFile(userId, file.id, created.id, nestedTaken.files);
  }
  for (const child of childFolders) {
    await copyOneFolder(userId, child.id, created.id, nestedTaken.folders);
  }

  return created.id;
}

export type CopyResult = {
  filesCopied: number;
  foldersCopied: number;
};

/**
 * Copy the given items into `destFolderId` (null = drive root).
 * Nested selections under a copied folder are skipped.
 */
export async function copyItems(
  userId: string,
  fileIds: string[],
  folderIds: string[],
  destFolderId: string | null,
): Promise<CopyResult> {
  if (destFolderId) {
    const dest = await prisma.folder.findFirst({
      where: { id: destFolderId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!dest) throw new Error("Destination folder not found.");
  }

  // Prune folders nested under another selected folder.
  const trees = new Map<string, Set<string>>();
  await Promise.all(
    folderIds.map(async (id) => {
      trees.set(id, new Set(await getDescendantIds(userId, id)));
    }),
  );
  const rootFolderIds = folderIds.filter((id) => {
    for (const [otherId, tree] of trees) {
      if (otherId !== id && tree.has(id)) return false;
    }
    return true;
  });

  const covered = new Set<string>();
  for (const id of rootFolderIds) {
    for (const d of trees.get(id) ?? []) covered.add(d);
  }

  // Skip files that live inside a folder we're already copying.
  const files = fileIds.length
    ? await prisma.file.findMany({
        where: { id: { in: fileIds }, userId, deletedAt: null },
        select: { id: true, folderId: true },
      })
    : [];
  const rootFileIds = files
    .filter((f) => !f.folderId || !covered.has(f.folderId))
    .map((f) => f.id);

  const taken = await takenNamesInFolder(userId, destFolderId);
  let filesCopied = 0;
  let foldersCopied = 0;

  for (const id of rootFileIds) {
    const created = await copyOneFile(userId, id, destFolderId, taken.files);
    if (created) filesCopied++;
  }
  for (const id of rootFolderIds) {
    const created = await copyOneFolder(
      userId,
      id,
      destFolderId,
      taken.folders,
    );
    if (created) foldersCopied++;
  }

  return { filesCopied, foldersCopied };
}
