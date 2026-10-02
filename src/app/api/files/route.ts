import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";
import { saveFileBytes } from "@/lib/storage";
import { ensureFolderPaths } from "@/lib/folders";
import { fileBaseName } from "@/lib/fileType";

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

// Upload one or more files (multipart/form-data).
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const maxFileSize = Math.max(1, user.maxUploadMb) * 1024 * 1024;
    const form = await req.formData();

    const folderParam = form.get("folderId");
    const folderId =
      folderParam && folderParam !== "root" ? String(folderParam) : null;

    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, userId: user.id, deletedAt: null },
        select: { id: true },
      });
      if (!folder) throw new ApiError(404, "Destination folder not found.");
    }

    const uploads = form.getAll("file").filter((f): f is File => f instanceof File);
    if (uploads.length === 0) throw new ApiError(400, "No files provided.");

    // Optional per-file relative directory paths (for dropped folders).
    const paths = form.getAll("path").map((p) => String(p ?? ""));

    // Build the folder tree once for this request (race-safe vs other requests).
    const pathMap = await ensureFolderPaths(
      user.id,
      folderId,
      paths.map((p) => p.replace(/^\/+|\/+$/g, "")),
    );

    const created = [];
    for (let i = 0; i < uploads.length; i++) {
      const upload = uploads[i];
      if (upload.size > maxFileSize) {
        throw new ApiError(
          413,
          `"${upload.name}" is too large (max ${user.maxUploadMb} MB).`,
        );
      }
      const dir = (paths[i] ?? "").replace(/^\/+|\/+$/g, "");
      const targetFolderId = pathMap.has(dir) ? pathMap.get(dir)! : folderId;

      const bytes = Buffer.from(await upload.arrayBuffer());
      const file = await prisma.file.create({
        data: {
          name: fileBaseName(upload.name),
          mimeType: upload.type || "application/octet-stream",
          size: BigInt(upload.size),
          userId: user.id,
          folderId: targetFolderId,
        },
        select: fileSelect,
      });
      await saveFileBytes(file.id, bytes);
      created.push(publicFile(file));
    }

    return { files: created };
  });
}
