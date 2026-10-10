import { createWriteStream, createReadStream } from "fs";
import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import archiver, { type Archiver } from "archiver";
import { prisma } from "@/lib/prisma";
import { fileExistsOnDisk, openFileStream } from "@/lib/storage";
import { fileBaseName } from "@/lib/fileType";

export function sanitizeZipSegment(name: string): string {
  const cleaned = fileBaseName(name).replace(/[/\\]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") return "_";
  return cleaned;
}

/** Pick a unique entry name within a set of already-used names. */
export function uniqueZipName(used: Set<string>, name: string): string {
  const base = sanitizeZipSegment(name);
  if (!used.has(base.toLowerCase())) {
    used.add(base.toLowerCase());
    return base;
  }
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let n = 2;
  while (used.has(`${stem} (${n})${ext}`.toLowerCase())) n++;
  const next = `${stem} (${n})${ext}`;
  used.add(next.toLowerCase());
  return next;
}

export async function appendStoredFile(
  archive: Archiver,
  fileId: string,
  entryName: string,
): Promise<void> {
  if (await fileExistsOnDisk(fileId)) {
    archive.append(openFileStream(fileId), { name: entryName });
    return;
  }
  const data = await prisma.fileData.findUnique({
    where: { fileId },
    select: { bytes: true },
  });
  if (data) {
    archive.append(Buffer.from(data.bytes), { name: entryName });
  }
}

export type BuiltZip = {
  stream: ReadableStream;
  size: number;
  cleanup: () => void;
};

/**
 * Build a zip on disk, then return a web ReadableStream that cleans up when done.
 */
export async function buildZipOnDisk(
  fill: (archive: Archiver) => Promise<void>,
): Promise<BuiltZip> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "skylagring-zip-"));
  const zipPath = path.join(tmpDir, "out.zip");
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 5 } });

  const archiveFailed = new Promise<never>((_, reject) => {
    archive.on("error", reject);
    output.on("error", reject);
  });

  archive.pipe(output);

  try {
    await fill(archive);
    await Promise.race([archive.finalize(), archiveFailed]);
    await Promise.race([finished(output), archiveFailed]);
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  const { size } = await stat(zipPath);
  const nodeStream = createReadStream(zipPath);
  const cleanup = () => {
    void rm(tmpDir, { recursive: true, force: true });
  };
  nodeStream.on("close", cleanup);
  nodeStream.on("error", cleanup);

  return {
    stream: Readable.toWeb(nodeStream) as ReadableStream,
    size,
    cleanup,
  };
}

export function zipResponse(
  built: BuiltZip,
  filename: string,
): Response {
  const encoded = encodeURIComponent(filename);
  return new Response(built.stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(built.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
