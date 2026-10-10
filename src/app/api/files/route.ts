import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";
import { deleteFileBytes, saveFileStream } from "@/lib/storage";
import { ensureFolderPaths } from "@/lib/folders";
import { fileBaseName } from "@/lib/fileType";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Self-hosted / Docker: allow long-running multi-GB uploads. */
export const maxDuration = 60 * 60 * 6;

function publicFile<T extends { size: bigint; name: string }>(file: T) {
  return { ...file, name: fileBaseName(file.name), size: Number(file.size) };
}

// List files in a folder (folderId omitted => root), or search with ?q=.
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();

    if (q) {
      const files = await prisma.file.findMany({
        where: {
          userId: user.id,
          deletedAt: null,
          name: { contains: q, mode: "insensitive" },
        },
        select: fileSelect,
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
      const folders = await prisma.folder.findMany({
        where: {
          userId: user.id,
          deletedAt: null,
          name: { contains: q, mode: "insensitive" },
        },
        select: { id: true, name: true, parentId: true, updatedAt: true },
        take: 100,
      });
      return { files: files.map(publicFile), folders, query: q };
    }

    const folderParam = url.searchParams.get("folderId");
    const folderId = folderParam && folderParam !== "root" ? folderParam : null;

    const files = await prisma.file.findMany({
      where: { userId: user.id, folderId, deletedAt: null },
      select: fileSelect,
      orderBy: { name: "asc" },
    });
    return { files: files.map(publicFile) };
  });
}

const fileSelect = {
  id: true,
  name: true,
  mimeType: true,
  size: true,
  folderId: true,
  updatedAt: true,
} as const;

/**
 * Stream a single file upload to disk (constant memory).
 *
 * Body = raw file bytes (not multipart). Metadata via query/headers:
 *   ?folderId=root|<id>  &path=relative/dir
 *   X-File-Name: URL-encoded filename
 *   Content-Type: mime
 *   Content-Length: size (optional but recommended)
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const maxFileSize = Math.max(1, user.maxUploadMb) * 1024 * 1024;

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      throw new ApiError(
        415,
        "Multipart uploads are no longer supported. Send the raw file body instead.",
      );
    }

    if (!req.body) {
      throw new ApiError(400, "Empty upload body.");
    }

    const url = new URL(req.url);
    const folderParam = url.searchParams.get("folderId");
    const folderId =
      folderParam && folderParam !== "root" ? folderParam : null;
    const relPath = (url.searchParams.get("path") ?? "").replace(
      /^\/+|\/+$/g,
      "",
    );

    const rawName = req.headers.get("x-file-name");
    if (!rawName) {
      throw new ApiError(400, "Missing X-File-Name header.");
    }
    let name: string;
    try {
      name = fileBaseName(decodeURIComponent(rawName));
    } catch {
      throw new ApiError(400, "Invalid X-File-Name header.");
    }

    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > maxFileSize) {
      throw new ApiError(
        413,
        `"${name}" is too large (max ${user.maxUploadMb} MB).`,
      );
    }

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

    const mimeType = contentType || "application/octet-stream";

    // Create the row first so we have a stable id to stream into.
    const file = await prisma.file.create({
      data: {
        name,
        mimeType,
        size: BigInt(declared || 0),
        userId: user.id,
        folderId: targetFolderId,
      },
      select: fileSelect,
    });

    try {
      const written = await saveFileStream(file.id, req.body);
      if (written > maxFileSize) {
        await prisma.file.delete({ where: { id: file.id } }).catch(() => {});
        await deleteFileBytes(file.id);
        throw new ApiError(
          413,
          `"${name}" is too large (max ${user.maxUploadMb} MB).`,
        );
      }
      const updated = await prisma.file.update({
        where: { id: file.id },
        data: { size: BigInt(written) },
        select: fileSelect,
      });
      return { files: [publicFile(updated)] };
    } catch (err) {
      await prisma.file.delete({ where: { id: file.id } }).catch(() => {});
      await deleteFileBytes(file.id).catch(() => {});
      throw err;
    }
  });
}
