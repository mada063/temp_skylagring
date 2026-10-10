import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getDescendantIds } from "@/lib/trash";
import {
  appendStoredFile,
  buildZipOnDisk,
  sanitizeZipSegment,
  uniqueZipName,
  zipResponse,
} from "@/lib/zipArchive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Relative path of each folder under a zip root folder name. */
function folderPathsUnder(
  rootId: string,
  rootName: string,
  folders: { id: string; name: string; parentId: string | null }[],
): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map<string, string>();
  paths.set(rootId, sanitizeZipSegment(rootName));

  for (const folder of folders) {
    if (folder.id === rootId) continue;
    const parts: string[] = [];
    let cur: (typeof folder) | undefined = folder;
    while (cur && cur.id !== rootId) {
      parts.unshift(sanitizeZipSegment(cur.name));
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    paths.set(folder.id, [sanitizeZipSegment(rootName), ...parts].join("/"));
  }
  return paths;
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const fileIds = Array.isArray(body.fileIds)
    ? [...new Set(body.fileIds.map(String))].filter(Boolean)
    : [];
  const folderIds = Array.isArray(body.folderIds)
    ? [...new Set(body.folderIds.map(String))].filter(Boolean)
    : [];

  if (fileIds.length === 0 && folderIds.length === 0) {
    return new Response("Nothing to download", { status: 400 });
  }

  const [files, folders] = await Promise.all([
    fileIds.length
      ? prisma.file.findMany({
          where: {
            id: { in: fileIds },
            userId: user.id,
            deletedAt: null,
          },
          select: { id: true, name: true, folderId: true },
        })
      : Promise.resolve([]),
    folderIds.length
      ? prisma.folder.findMany({
          where: {
            id: { in: folderIds },
            userId: user.id,
            deletedAt: null,
          },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  if (files.length === 0 && folders.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  // Drop folders nested under another selected folder, and files that already
  // live inside a selected folder tree (they'd be duplicated in the zip).
  const selectedFolderTrees = new Map<string, Set<string>>();
  await Promise.all(
    folders.map(async (f) => {
      selectedFolderTrees.set(f.id, new Set(await getDescendantIds(user.id, f.id)));
    }),
  );

  const rootFolders = folders.filter((f) => {
    for (const [otherId, tree] of selectedFolderTrees) {
      if (otherId !== f.id && tree.has(f.id)) return false;
    }
    return true;
  });

  const coveredFolderIds = new Set<string>();
  for (const f of rootFolders) {
    for (const id of selectedFolderTrees.get(f.id) ?? []) {
      coveredFolderIds.add(id);
    }
  }

  const rootFiles = files.filter(
    (f) => !f.folderId || !coveredFolderIds.has(f.folderId),
  );

  try {
    const built = await buildZipOnDisk(async (archive) => {
      const usedRoot = new Set<string>();

      for (const file of rootFiles) {
        const entryName = uniqueZipName(usedRoot, file.name);
        await appendStoredFile(archive, file.id, entryName);
      }

      for (const root of rootFolders) {
        const rootName = uniqueZipName(usedRoot, root.name);
        const treeIds = [
          ...(selectedFolderTrees.get(root.id) ?? [root.id]),
        ];
        const treeFolders = await prisma.folder.findMany({
          where: { id: { in: treeIds }, userId: user.id, deletedAt: null },
          select: { id: true, name: true, parentId: true },
        });
        // Remap paths so the root uses the uniquified name.
        const paths = folderPathsUnder(root.id, rootName, treeFolders);

        const treeFiles = await prisma.file.findMany({
          where: {
            folderId: { in: treeIds },
            userId: user.id,
            deletedAt: null,
          },
          select: { id: true, name: true, folderId: true },
        });

        const foldersWithFiles = new Set(
          treeFiles
            .map((f) => f.folderId)
            .filter((id): id is string => Boolean(id)),
        );
        const foldersWithChildren = new Set(
          treeFolders
            .map((f) => f.parentId)
            .filter((id): id is string => Boolean(id)),
        );
        for (const folder of treeFolders) {
          const dir = paths.get(folder.id);
          if (!dir) continue;
          if (
            foldersWithFiles.has(folder.id) ||
            foldersWithChildren.has(folder.id)
          ) {
            continue;
          }
          archive.append(Buffer.alloc(0), { name: `${dir}/` });
        }

        for (const file of treeFiles) {
          if (!file.folderId) continue;
          const dir = paths.get(file.folderId);
          if (!dir) continue;
          await appendStoredFile(
            archive,
            file.id,
            `${dir}/${sanitizeZipSegment(file.name)}`,
          );
        }
      }
    });

    const count = rootFiles.length + rootFolders.length;
    const filename =
      count === 1 && rootFolders.length === 1
        ? `${sanitizeZipSegment(rootFolders[0].name)}.zip`
        : count === 1 && rootFiles.length === 1
          ? `${sanitizeZipSegment(rootFiles[0].name)}.zip`
          : `download-${count}-items.zip`;

    return zipResponse(built, filename);
  } catch (err) {
    console.error("bulk zip failed", err);
    return new Response("Failed to build zip", { status: 500 });
  }
}
