import fs from "fs/promises";
import path from "path";
import { createReadStream, createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { randomBytes } from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const THUMB_DIR = path.join(UPLOAD_DIR, "thumbs");

function diskPath(fileId: string): string {
  return path.join(UPLOAD_DIR, fileId);
}

export function thumbPath(fileId: string): string {
  return path.join(THUMB_DIR, `${fileId}.webp`);
}

export async function saveFileBytes(fileId: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(diskPath(fileId), bytes);
}

/**
 * Stream a web ReadableStream straight to disk (constant memory).
 * Returns bytes written. Uses a temp name then renames to `fileId`.
 */
export async function saveFileStream(
  fileId: string,
  webStream: ReadableStream<Uint8Array>,
): Promise<number> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const tmpId = `tmp_${randomBytes(16).toString("hex")}`;
  const tmp = diskPath(tmpId);
  const dest = diskPath(fileId);
  try {
    const nodeStream = Readable.fromWeb(
      webStream as import("stream/web").ReadableStream,
    );
    await pipeline(nodeStream, createWriteStream(tmp));
    const { size } = await fs.stat(tmp);
    await fs.rename(tmp, dest);
    return size;
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Duplicate on-disk bytes from one file id to another. */
export async function copyFileBytes(
  fromId: string,
  toId: string,
): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.copyFile(diskPath(fromId), diskPath(toId));
}

export async function fileExistsOnDisk(fileId: string): Promise<boolean> {
  try {
    await fs.access(diskPath(fileId));
    return true;
  } catch {
    return false;
  }
}

export function openFileStream(fileId: string): Readable {
  return createReadStream(diskPath(fileId));
}

export async function readFileBytes(fileId: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(diskPath(fileId));
  } catch {
    return null;
  }
}

export async function saveThumbBytes(
  fileId: string,
  bytes: Buffer,
): Promise<void> {
  await fs.mkdir(THUMB_DIR, { recursive: true });
  await fs.writeFile(thumbPath(fileId), bytes);
}

export async function readThumbBytes(fileId: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(thumbPath(fileId));
  } catch {
    return null;
  }
}

export async function deleteFileBytes(fileId: string): Promise<void> {
  await Promise.all([
    fs.unlink(diskPath(fileId)).catch(() => {}),
    fs.unlink(thumbPath(fileId)).catch(() => {}),
  ]);
}

export async function deleteFileBytesMany(fileIds: string[]): Promise<void> {
  await Promise.all(fileIds.map(deleteFileBytes));
}
