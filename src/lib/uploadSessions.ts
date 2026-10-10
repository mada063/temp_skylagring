import fs from "fs/promises";
import path from "path";
import { createWriteStream } from "fs";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { randomBytes } from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const SESSION_DIR = path.join(UPLOAD_DIR, ".sessions");

export type UploadSessionMeta = {
  id: string;
  userId: string;
  name: string;
  mimeType: string;
  size: number;
  folderId: string | null;
  received: number;
  createdAt: string;
};

function sessionPaths(id: string) {
  const dir = path.join(SESSION_DIR, id);
  return {
    dir,
    meta: path.join(dir, "meta.json"),
    part: path.join(dir, "data.part"),
  };
}

export function newSessionId(): string {
  return randomBytes(16).toString("hex");
}

export async function createUploadSession(
  meta: Omit<UploadSessionMeta, "received" | "createdAt">,
): Promise<UploadSessionMeta> {
  const paths = sessionPaths(meta.id);
  await fs.mkdir(paths.dir, { recursive: true });
  const full: UploadSessionMeta = {
    ...meta,
    received: 0,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(paths.meta, JSON.stringify(full), "utf8");
  await fs.writeFile(paths.part, new Uint8Array(0));
  return full;
}

export async function readUploadSession(
  id: string,
): Promise<UploadSessionMeta | null> {
  try {
    const raw = await fs.readFile(sessionPaths(id).meta, "utf8");
    return JSON.parse(raw) as UploadSessionMeta;
  } catch {
    return null;
  }
}

async function writeMeta(meta: UploadSessionMeta): Promise<void> {
  await fs.writeFile(sessionPaths(meta.id).meta, JSON.stringify(meta), "utf8");
}

/**
 * Append a chunk at the expected offset (must equal bytes received so far).
 * Returns updated session metadata.
 */
export async function appendUploadChunk(
  id: string,
  offset: number,
  webStream: ReadableStream<Uint8Array>,
  maxTotal: number,
): Promise<UploadSessionMeta> {
  const meta = await readUploadSession(id);
  if (!meta) throw new SessionError(404, "Upload session not found.");
  if (offset !== meta.received) {
    throw new SessionError(
      409,
      `Unexpected chunk offset ${offset} (expected ${meta.received}).`,
    );
  }
  if (meta.received >= meta.size) {
    throw new SessionError(409, "Upload session is already complete.");
  }

  const paths = sessionPaths(id);
  let written = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      written += chunk.length;
      if (meta.received + written > meta.size) {
        cb(new SessionError(400, "Chunk exceeds declared file size."));
        return;
      }
      if (meta.received + written > maxTotal) {
        cb(new SessionError(413, "Upload exceeds size limit."));
        return;
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(webStream as import("stream/web").ReadableStream),
      counter,
      createWriteStream(paths.part, { flags: "a" }),
    );
  } catch (err) {
    await fs.truncate(paths.part, meta.received).catch(() => {});
    throw err;
  }

  meta.received += written;
  await writeMeta(meta);
  return meta;
}

/** Move assembled bytes to the final on-disk file id and remove the session. */
export async function finalizeUploadSession(
  id: string,
  fileId: string,
): Promise<number> {
  const meta = await readUploadSession(id);
  if (!meta) throw new SessionError(404, "Upload session not found.");
  if (meta.received !== meta.size) {
    throw new SessionError(
      400,
      `Incomplete upload (${meta.received} of ${meta.size} bytes).`,
    );
  }

  const paths = sessionPaths(id);
  const dest = path.join(UPLOAD_DIR, fileId);
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.rename(paths.part, dest);
  await fs.rm(paths.dir, { recursive: true, force: true });
  return meta.size;
}

export async function deleteUploadSession(id: string): Promise<void> {
  await fs.rm(sessionPaths(id).dir, { recursive: true, force: true });
}

export class SessionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
