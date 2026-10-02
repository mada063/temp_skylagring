import { createWriteStream, createReadStream } from "fs";
import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import archiver from "archiver";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getDescendantIds } from "@/lib/trash";
import { fileExistsOnDisk, openFileStream } from "@/lib/storage";
import { fileBaseName } from "@/lib/fileType";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

function sanitizeSegment(name: string): string {
  const cleaned = fileBaseName(name).replace(/[/\\]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") return "_";
  return cleaned;
}

/** Relative path of each folder under the zip root (folder name itself). */
function folderPaths(
  rootId: string,
  rootName: string,
  folders: { id: string; name: string; parentId: string | null }[],
): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map<string, string>();
  paths.set(rootId, sanitizeSegment(rootName));

  for (const folder of folders) {
    if (folder.id === rootId) continue;
    const parts: string[] = [];
    let cur: (typeof folder) | undefined = folder;
    while (cur && cur.id !== rootId) {
      parts.unshift(sanitizeSegment(cur.name));
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    paths.set(folder.id, [sanitizeSegment(rootName), ...parts].join("/"));
  }
  return paths;
}

export async function GET(_req: Request, { params }: Params) {
  const user = await requireUser().catch(() => null);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const root = await prisma.folder.findFirst({
    where: { id: params.id, userId: user.id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!root) {
    return new Response("Not found", { status: 404 });
  }

  const treeIds = await getDescendantIds(user.id, root.id);
  const folders = await prisma.folder.findMany({
    where: { id: { in: treeIds }, userId: user.id, deletedAt: null },
    select: { id: true, name: true, parentId: true },
  });
  const paths = folderPaths(root.id, root.name, folders);

  const files = await prisma.file.findMany({
    where: {
      folderId: { in: treeIds },
      userId: user.id,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      folderId: true,
    },
  });

  // Build the zip fully on disk first. Streaming archiver straight into a
  // Next.js Response often truncates the central directory → invalid zip.
  const tmpDir = await mkdtemp(path.join(tmpdir(), "skylagring-zip-"));
  const zipPath = path.join(tmpDir, "out.zip");
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 5 } });

  const archiveFailed = new Promise<never>((_, reject) => {
    archive.on("error", reject);
    output.on("error", reject);
  });

  archive.pipe(output);

  // Only mark truly empty folders so Windows Explorer doesn't choke on
  // redundant directory entries that also contain files.
  const foldersWithFiles = new Set(
    files.map((f) => f.folderId).filter((id): id is string => Boolean(id)),
  );
  const foldersWithChildren = new Set(
    folders.map((f) => f.parentId).filter((id): id is string => Boolean(id)),
  );
  for (const folder of folders) {
    const dir = paths.get(folder.id);
    if (!dir) continue;
    if (foldersWithFiles.has(folder.id) || foldersWithChildren.has(folder.id)) {
      continue;
    }
    archive.append(Buffer.alloc(0), { name: `${dir}/` });
  }

  for (const file of files) {
    if (!file.folderId) continue;
    const dir = paths.get(file.folderId);
    if (!dir) continue;
    const entryName = `${dir}/${sanitizeSegment(file.name)}`;

    if (await fileExistsOnDisk(file.id)) {
      archive.append(openFileStream(file.id), { name: entryName });
      continue;
    }

    const data = await prisma.fileData.findUnique({
      where: { fileId: file.id },
      select: { bytes: true },
    });
    if (data) {
      archive.append(Buffer.from(data.bytes), { name: entryName });
    }
  }

  try {
    await Promise.race([archive.finalize(), archiveFailed]);
    await Promise.race([finished(output), archiveFailed]);
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    console.error("zip failed", err);
    return new Response("Failed to build zip", { status: 500 });
  }

  const { size } = await stat(zipPath);
  const nodeStream = createReadStream(zipPath);
  const cleanup = () => {
    void rm(tmpDir, { recursive: true, force: true });
  };
  nodeStream.on("close", cleanup);
  nodeStream.on("error", cleanup);

  const encoded = encodeURIComponent(`${root.name}.zip`);
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
