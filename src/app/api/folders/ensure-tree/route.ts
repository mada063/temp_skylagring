import { requireUser } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ensureFolderPaths } from "@/lib/folders";

/**
 * Pre-create a folder tree under a destination so parallel file uploads can
 * reuse the same folders instead of racing to create duplicates.
 *
 * Body: { folderId?: string | null, paths: string[] }
 * Returns: { folders: Record<path, id> }
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const folderParam = body.folderId ? String(body.folderId) : null;
    const baseFolderId =
      folderParam && folderParam !== "root" ? folderParam : null;
    const paths = Array.isArray(body.paths)
      ? body.paths.map((p: unknown) => String(p ?? ""))
      : [];

    if (baseFolderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: baseFolderId, userId: user.id, deletedAt: null },
        select: { id: true },
      });
      if (!folder) throw new ApiError(404, "Destination folder not found.");
    }

    const map = await ensureFolderPaths(user.id, baseFolderId, paths);
    const folders: Record<string, string | null> = {};
    for (const [path, id] of map) {
      folders[path] = id;
    }
    return { folders };
  });
}
