import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";
import { ensureFolderPaths } from "@/lib/folders";
import { fileBaseName } from "@/lib/fileType";
import { UPLOAD_CHUNK_BYTES } from "@/lib/uploadLimit";
import {
  createUploadSession,
  newSessionId,
} from "@/lib/uploadSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start a chunked upload session (JSON body, no file bytes). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const maxFileSize = Math.max(1, user.maxUploadMb) * 1024 * 1024;

    let body: {
      name?: string;
      size?: number;
      mimeType?: string;
      folderId?: string | null;
      path?: string;
    };
    try {
      body = await req.json();
    } catch {
      throw new ApiError(400, "Invalid JSON body.");
    }

    const name = fileBaseName(String(body.name ?? "").trim());
    if (!name) throw new ApiError(400, "Missing file name.");

    const size = Number(body.size);
    if (!Number.isFinite(size) || size < 0 || !Number.isInteger(size)) {
      throw new ApiError(400, "Invalid file size.");
    }
    if (size > maxFileSize) {
      throw new ApiError(
        413,
        `"${name}" is too large (max ${user.maxUploadMb} MB).`,
      );
    }

    const folderParam = body.folderId;
    const folderId =
      folderParam && folderParam !== "root" ? String(folderParam) : null;
    const relPath = String(body.path ?? "").replace(/^\/+|\/+$/g, "");

    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, userId: user.id, deletedAt: null },
        select: { id: true },
      });
      if (!folder) throw new ApiError(404, "Destination folder not found.");
    }

    let targetFolderId = folderId;
    if (relPath) {
      const pathMap = await ensureFolderPaths(user.id, folderId, [relPath]);
      targetFolderId = pathMap.get(relPath) ?? folderId;
    }

    const session = await createUploadSession({
      id: newSessionId(),
      userId: user.id,
      name,
      mimeType: String(body.mimeType || "application/octet-stream"),
      size,
      folderId: targetFolderId,
    });

    return {
      uploadId: session.id,
      chunkSize: UPLOAD_CHUNK_BYTES,
    };
  });
}
