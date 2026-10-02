import { prisma } from "@/lib/prisma";
import { deleteFileBytes, deleteFileBytesMany } from "@/lib/storage";

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function trashExpiresAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + TRASH_RETENTION_MS);
}

export function daysLeftInTrash(deletedAt: Date, now = new Date()): number {
  const ms = trashExpiresAt(deletedAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** Collect folder id + all descendant folder ids (including trashed). */
export async function getDescendantIds(
  userId: string,
  rootId: string,
): Promise<string[]> {
  const all = await prisma.folder.findMany({
    where: { userId },
    select: { id: true, parentId: true },
  });
  const childrenOf = new Map<string, string[]>();
  for (const f of all) {
    if (!f.parentId) continue;
    const arr = childrenOf.get(f.parentId) ?? [];
    arr.push(f.id);
    childrenOf.set(f.parentId, arr);
  }
  const result = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of childrenOf.get(cur) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        stack.push(child);
      }
    }
  }
  return [...result];
}

/** Soft-delete a file into the trash. */
export async function softDeleteFile(userId: string, fileId: string) {
  const file = await prisma.file.findFirst({
    where: { id: fileId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!file) return false;
  await prisma.file.update({
    where: { id: fileId },
    data: { deletedAt: new Date() },
  });
  return true;
}

/** Soft-delete a folder and everything inside it. */
export async function softDeleteFolder(userId: string, folderId: string) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!folder) return false;

  const treeIds = await getDescendantIds(userId, folderId);
  const now = new Date();
  await prisma.$transaction([
    prisma.folder.updateMany({
      where: { id: { in: treeIds }, userId, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.file.updateMany({
      where: { folderId: { in: treeIds }, userId, deletedAt: null },
      data: { deletedAt: now },
    }),
  ]);
  return true;
}

/** Hard-delete a file (DB row + bytes on disk). */
export async function permanentlyDeleteFile(userId: string, fileId: string) {
  const file = await prisma.file.findFirst({
    where: { id: fileId, userId },
    select: { id: true },
  });
  if (!file) return false;
  await prisma.file.delete({ where: { id: fileId } });
  await deleteFileBytes(fileId);
  return true;
}

/** Hard-delete a folder tree (and files inside). */
export async function permanentlyDeleteFolder(userId: string, folderId: string) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId },
    select: { id: true },
  });
  if (!folder) return false;
  const treeIds = await getDescendantIds(userId, folderId);
  const files = await prisma.file.findMany({
    where: { userId, folderId: { in: treeIds } },
    select: { id: true },
  });
  // Delete the root; children cascade via the Folder relation.
  await prisma.folder.delete({ where: { id: folderId } });
  await deleteFileBytesMany(files.map((f) => f.id));
  return true;
}

/** Restore a trashed file. If its parent is still in trash, place it at root. */
export async function restoreFile(userId: string, fileId: string) {
  const file = await prisma.file.findFirst({
    where: { id: fileId, userId, deletedAt: { not: null } },
    select: { id: true, folderId: true },
  });
  if (!file) return false;

  let folderId = file.folderId;
  if (folderId) {
    const parent = await prisma.folder.findFirst({
      where: { id: folderId, userId },
      select: { deletedAt: true },
    });
    if (!parent || parent.deletedAt) folderId = null;
  }

  await prisma.file.update({
    where: { id: fileId },
    data: { deletedAt: null, folderId },
  });
  return true;
}

/**
 * Restore a trashed folder and its trashed descendants/files.
 * If the parent is still in trash, the folder is restored to root.
 */
export async function restoreFolder(userId: string, folderId: string) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId, deletedAt: { not: null } },
    select: { id: true, parentId: true },
  });
  if (!folder) return false;

  let parentId = folder.parentId;
  if (parentId) {
    const parent = await prisma.folder.findFirst({
      where: { id: parentId, userId },
      select: { deletedAt: true },
    });
    if (!parent || parent.deletedAt) parentId = null;
  }

  const treeIds = await getDescendantIds(userId, folderId);
  await prisma.$transaction([
    prisma.folder.update({
      where: { id: folderId },
      data: { deletedAt: null, parentId },
    }),
    prisma.folder.updateMany({
      where: {
        id: { in: treeIds.filter((id) => id !== folderId) },
        userId,
        deletedAt: { not: null },
      },
      data: { deletedAt: null },
    }),
    prisma.file.updateMany({
      where: { folderId: { in: treeIds }, userId, deletedAt: { not: null } },
      data: { deletedAt: null },
    }),
  ]);
  return true;
}

/**
 * Permanently remove trash older than 30 days.
 * Cheap when nothing is expired; bulk deletes when there is.
 */
export async function purgeExpiredTrash(userId?: string) {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS);
  const userFilter = userId ? { userId } : {};

  const expiredFileWhere = {
    ...userFilter,
    deletedAt: { not: null, lte: cutoff },
  } as const;

  const fileCount = await prisma.file.count({ where: expiredFileWhere });
  const folderCount = await prisma.folder.count({
    where: { ...userFilter, deletedAt: { not: null, lte: cutoff } },
  });
  if (fileCount === 0 && folderCount === 0) {
    return { files: 0, folders: 0 };
  }

  // Batch file deletes (DB + disk).
  let filesRemoved = 0;
  while (true) {
    const batch = await prisma.file.findMany({
      where: expiredFileWhere,
      select: { id: true },
      take: 200,
    });
    if (batch.length === 0) break;
    const ids = batch.map((f) => f.id);
    await prisma.file.deleteMany({ where: { id: { in: ids } } });
    await deleteFileBytesMany(ids);
    filesRemoved += ids.length;
  }

  // Delete expired folders leaf-first with bulk deleteMany passes.
  let foldersRemoved = 0;
  for (let pass = 0; pass < 50; pass++) {
    const expired = await prisma.folder.findMany({
      where: { ...userFilter, deletedAt: { not: null, lte: cutoff } },
      select: { id: true },
      take: 500,
    });
    if (expired.length === 0) break;

    const expiredIds = expired.map((f) => f.id);
    const childLinks = await prisma.folder.findMany({
      where: { parentId: { in: expiredIds } },
      select: { parentId: true },
    });
    const hasChild = new Set(
      childLinks.map((c) => c.parentId).filter((id): id is string => !!id),
    );
    const leaves = expiredIds.filter((id) => !hasChild.has(id));
    if (leaves.length === 0) {
      // Cycle or non-expired children blocking — force-delete remaining batch.
      const files = await prisma.file.findMany({
        where: { folderId: { in: expiredIds } },
        select: { id: true },
      });
      if (files.length) {
        const ids = files.map((f) => f.id);
        await prisma.file.deleteMany({ where: { id: { in: ids } } });
        await deleteFileBytesMany(ids);
      }
      const res = await prisma.folder.deleteMany({
        where: { id: { in: expiredIds } },
      });
      foldersRemoved += res.count;
      break;
    }

    const files = await prisma.file.findMany({
      where: { folderId: { in: leaves } },
      select: { id: true },
    });
    if (files.length) {
      const ids = files.map((f) => f.id);
      await prisma.file.deleteMany({ where: { id: { in: ids } } });
      await deleteFileBytesMany(ids);
    }
    const res = await prisma.folder.deleteMany({ where: { id: { in: leaves } } });
    foldersRemoved += res.count;
  }

  return { files: filesRemoved, folders: foldersRemoved };
}
