import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";
import {
  daysLeftInTrash,
  permanentlyDeleteFile,
  permanentlyDeleteFolder,
  purgeExpiredTrash,
  restoreFile,
  restoreFolder,
} from "@/lib/trash";
import { fileBaseName } from "@/lib/fileType";

const TRASH_LIST_LIMIT = 500;

function publicFile<T extends { size: bigint; name: string; deletedAt: Date | null }>(
  file: T,
) {
  return {
    ...file,
    name: fileBaseName(file.name),
    size: Number(file.size),
    deletedAt: file.deletedAt?.toISOString() ?? null,
    daysLeft: file.deletedAt ? daysLeftInTrash(file.deletedAt) : 0,
  };
}

/**
 * List top-level trash items only (not every nested file inside a trashed folder).
 * Runs a cheap expired-purge first.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    await purgeExpiredTrash(user.id);

    // Only items whose parent is not also in the trash — so deleting a folder
    // with 10k files shows 1 folder row, not 10k file rows.
    const [files, folders] = await Promise.all([
      prisma.file.findMany({
        where: {
          userId: user.id,
          deletedAt: { not: null },
          OR: [{ folderId: null }, { folder: { deletedAt: null } }],
        },
        select: {
          id: true,
          name: true,
          mimeType: true,
          size: true,
          folderId: true,
          deletedAt: true,
        },
        orderBy: { deletedAt: "desc" },
        take: TRASH_LIST_LIMIT,
      }),
      prisma.folder.findMany({
        where: {
          userId: user.id,
          deletedAt: { not: null },
          OR: [{ parentId: null }, { parent: { deletedAt: null } }],
        },
        select: {
          id: true,
          name: true,
          parentId: true,
          deletedAt: true,
          _count: {
            select: {
              files: { where: { deletedAt: { not: null } } },
              children: { where: { deletedAt: { not: null } } },
            },
          },
        },
        orderBy: { deletedAt: "desc" },
        take: TRASH_LIST_LIMIT,
      }),
    ]);

    return {
      files: files.map(publicFile),
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        deletedAt: f.deletedAt?.toISOString() ?? null,
        daysLeft: f.deletedAt ? daysLeftInTrash(f.deletedAt) : 0,
        itemCount: f._count.files + f._count.children,
      })),
    };
  });
}

/**
 * Body actions:
 * - { action: "restore", kind: "file"|"folder", id }
 * - { action: "purge", kind: "file"|"folder", id }
 * - { action: "empty" }
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "empty") {
      // Only top-level trash roots — permanentlyDeleteFolder cascades the rest.
      const [files, folders] = await Promise.all([
        prisma.file.findMany({
          where: {
            userId: user.id,
            deletedAt: { not: null },
            OR: [{ folderId: null }, { folder: { deletedAt: null } }],
          },
          select: { id: true },
        }),
        prisma.folder.findMany({
          where: {
            userId: user.id,
            deletedAt: { not: null },
            OR: [{ parentId: null }, { parent: { deletedAt: null } }],
          },
          select: { id: true },
        }),
      ]);
      for (const f of files) await permanentlyDeleteFile(user.id, f.id);
      for (const f of folders) await permanentlyDeleteFolder(user.id, f.id);
      return { ok: true };
    }

    const kind = String(body.kind ?? "");
    const id = String(body.id ?? "");
    if (!id || (kind !== "file" && kind !== "folder")) {
      throw new ApiError(400, "Invalid request.");
    }

    if (action === "restore") {
      const ok =
        kind === "file"
          ? await restoreFile(user.id, id)
          : await restoreFolder(user.id, id);
      if (!ok) throw new ApiError(404, "Not found in trash.");
      return { ok: true };
    }

    if (action === "purge") {
      const ok =
        kind === "file"
          ? await permanentlyDeleteFile(user.id, id)
          : await permanentlyDeleteFolder(user.id, id);
      if (!ok) throw new ApiError(404, "Not found in trash.");
      return { ok: true };
    }

    throw new ApiError(400, "Unknown action.");
  });
}
