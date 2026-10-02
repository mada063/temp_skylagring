import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function folderKey(parentId: string | null, name: string): string {
  return `${parentId ?? ""}\0${name}`;
}

/**
 * Find or create a child folder under `parentId` (null = drive root).
 * Safe under concurrent uploads: on a unique-constraint race, re-reads the winner.
 * Optional `cache` avoids repeat DB lookups within one ensure-tree call.
 */
export async function ensureChildFolder(
  userId: string,
  parentId: string | null,
  name: string,
  cache?: Map<string, string>,
): Promise<string> {
  const key = folderKey(parentId, name);
  const cached = cache?.get(key);
  if (cached) return cached;

  const existing = await prisma.folder.findFirst({
    where: { userId, parentId, name, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    cache?.set(key, existing.id);
    return existing.id;
  }

  try {
    const created = await prisma.folder.create({
      data: { userId, parentId, name },
      select: { id: true },
    });
    cache?.set(key, created.id);
    return created.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const again = await prisma.folder.findFirst({
        where: { userId, parentId, name, deletedAt: null },
        select: { id: true },
      });
      if (again) {
        cache?.set(key, again.id);
        return again.id;
      }
    }
    throw err;
  }
}

/**
 * Ensure every relative path under `baseFolderId` exists (e.g. "a/b/c").
 * Prefetches existing folders, then creates missing ones level-by-level in parallel.
 */
export async function ensureFolderPaths(
  userId: string,
  baseFolderId: string | null,
  paths: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  result.set("", baseFolderId);

  const normalized = [
    ...new Set(
      paths
        .map((p) => p.replace(/^\/+|\/+$/g, ""))
        .filter(Boolean),
    ),
  ];
  if (normalized.length === 0) return result;

  // One query up front instead of find-per-segment.
  const existing = await prisma.folder.findMany({
    where: { userId, deletedAt: null },
    select: { id: true, name: true, parentId: true },
  });
  const cache = new Map<string, string>();
  for (const f of existing) {
    cache.set(folderKey(f.parentId, f.name), f.id);
  }

  // Group unique path prefixes by depth so siblings can be created in parallel.
  const byDepth = new Map<number, Set<string>>();
  for (const path of normalized) {
    const segments = path.split("/");
    let built = "";
    for (let i = 0; i < segments.length; i++) {
      built = built ? `${built}/${segments[i]}` : segments[i];
      const depth = i + 1;
      let set = byDepth.get(depth);
      if (!set) {
        set = new Set();
        byDepth.set(depth, set);
      }
      set.add(built);
    }
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  for (const depth of depths) {
    const prefixes = [...(byDepth.get(depth) ?? [])];
    await Promise.all(
      prefixes.map(async (prefix) => {
        if (result.has(prefix)) return;
        const segments = prefix.split("/");
        const name = segments[segments.length - 1]!;
        const parentPath = segments.slice(0, -1).join("/");
        const parentId =
          parentPath === ""
            ? baseFolderId
            : (result.get(parentPath) ?? null);
        const id = await ensureChildFolder(userId, parentId, name, cache);
        result.set(prefix, id);
      }),
    );
  }

  return result;
}
