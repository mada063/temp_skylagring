import { requireUser } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";
import { copyItems } from "@/lib/copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));

    const fileIds = Array.isArray(body.fileIds)
      ? [...new Set(body.fileIds.map(String))].filter(Boolean)
      : [];
    const folderIds = Array.isArray(body.folderIds)
      ? [...new Set(body.folderIds.map(String))].filter(Boolean)
      : [];
    const destParam = body.folderId;
    const destFolderId =
      destParam && destParam !== "root" ? String(destParam) : null;

    if (fileIds.length === 0 && folderIds.length === 0) {
      throw new ApiError(400, "Nothing to copy.");
    }

    try {
      const result = await copyItems(
        user.id,
        fileIds,
        folderIds,
        destFolderId,
      );
      if (result.filesCopied === 0 && result.foldersCopied === 0) {
        throw new ApiError(404, "Nothing to copy was found.");
      }
      return result;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const message =
        err instanceof Error ? err.message : "Copy failed.";
      if (message.startsWith("Cannot paste")) {
        throw new ApiError(400, message);
      }
      if (message === "Destination folder not found.") {
        throw new ApiError(404, message);
      }
      throw err;
    }
  });
}
