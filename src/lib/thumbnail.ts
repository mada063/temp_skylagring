import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import {
  fileExistsOnDisk,
  readFileBytes,
  readThumbBytes,
  saveThumbBytes,
} from "@/lib/storage";
import { categorize } from "@/lib/fileType";

/** Long edge of grid thumbnails (covers ~150px cards at 2x DPR). */
const THUMB_SIZE = 320;

const inflight = new Map<string, Promise<Buffer | null>>();

async function loadSourceBytes(fileId: string): Promise<Buffer | null> {
  if (await fileExistsOnDisk(fileId)) {
    return readFileBytes(fileId);
  }
  const data = await prisma.fileData.findUnique({
    where: { fileId },
    select: { bytes: true },
  });
  return data ? Buffer.from(data.bytes) : null;
}

async function buildThumb(fileId: string): Promise<Buffer | null> {
  const cached = await readThumbBytes(fileId);
  if (cached) return cached;

  const source = await loadSourceBytes(fileId);
  if (!source || source.length === 0) return null;

  try {
    const thumb = await sharp(source, { failOn: "none", animated: false })
      .rotate() // honor EXIF orientation
      .resize({
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 72, effort: 4 })
      .toBuffer();
    await saveThumbBytes(fileId, thumb);
    return thumb;
  } catch {
    return null;
  }
}

/**
 * Return a small WebP preview for an image file, generating + caching on disk
 * the first time it's requested. Concurrent callers share one generation job.
 */
export async function getOrCreateThumbnail(
  fileId: string,
  name: string,
  mimeType: string,
): Promise<Buffer | null> {
  if (categorize(name, mimeType) !== "image") return null;

  const existing = inflight.get(fileId);
  if (existing) return existing;

  const job = buildThumb(fileId).finally(() => {
    inflight.delete(fileId);
  });
  inflight.set(fileId, job);
  return job;
}
