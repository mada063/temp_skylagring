import fs from "fs/promises";
import path from "path";
import { createReadStream } from "fs";
import { Readable } from "stream";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

function diskPath(fileId: string): string {
  return path.join(UPLOAD_DIR, fileId);
}

export async function saveFileBytes(fileId: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(diskPath(fileId), bytes);
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

export async function deleteFileBytes(fileId: string): Promise<void> {
  try {
    await fs.unlink(diskPath(fileId));
  } catch {
    /* already gone */
  }
}

export async function deleteFileBytesMany(fileIds: string[]): Promise<void> {
  await Promise.all(fileIds.map(deleteFileBytes));
}
