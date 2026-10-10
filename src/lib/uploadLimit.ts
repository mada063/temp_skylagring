/** Per-file upload cap exposed in Settings. 50 GB is plenty for personal use. */
export const MAX_UPLOAD_MB = 50 * 1024; // 51200 MB = 50 GB
export const MIN_UPLOAD_MB = 1;

/** Parallel upload workers when dropping many files / a folder. */
export const MIN_UPLOAD_CONCURRENCY = 1;
export const MAX_UPLOAD_CONCURRENCY = 64;
export const DEFAULT_UPLOAD_CONCURRENCY = 8;

/**
 * Files at/above this size pause the rest of the queue: in-flight uploads
 * finish, then the large file runs alone, then normal concurrency resumes.
 */
export const LARGE_FILE_BYTES = 200 * 1024 * 1024; // 200 MB

/** Parallel folder-scan workers while reading a dropped directory. */
export const MIN_SCAN_CONCURRENCY = 4;
export const MAX_SCAN_CONCURRENCY = 64;
export const DEFAULT_SCAN_CONCURRENCY = 32;

/**
 * Upload scheduler:
 * - Small files share `concurrency` workers as usual.
 * - When the next item is large (≥ LARGE_FILE_BYTES), wait for in-flight
 *   work to drain, upload that large file alone, then resume.
 */
export async function mapPoolBySize<T>(
  items: T[],
  concurrency: number,
  getSize: (item: T) => number,
  worker: (item: T, index: number) => Promise<void>,
  largeBytes: number = LARGE_FILE_BYTES,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, concurrency);

  let next = 0;
  let active = 0;
  let largeActive = 0;
  let resolveWait: (() => void) | null = null;

  const wake = () => {
    resolveWait?.();
    resolveWait = null;
  };

  const wait = () =>
    new Promise<void>((resolve) => {
      resolveWait = resolve;
    });

  const run = (index: number) => {
    const item = items[index]!;
    const large = getSize(item) >= largeBytes;
    active++;
    if (large) largeActive++;

    void worker(item, index)
      .catch(() => {
        /* caller handles errors */
      })
      .finally(() => {
        active--;
        if (large) largeActive--;
        wake();
      });
  };

  while (next < items.length || active > 0) {
    // Large upload in progress: let it finish before starting anything else.
    if (largeActive > 0) {
      await wait();
      continue;
    }

    if (next >= items.length) {
      if (active === 0) break;
      await wait();
      continue;
    }

    const upcomingLarge = getSize(items[next]!) >= largeBytes;

    if (upcomingLarge) {
      // Drain in-flight small uploads, then run the large file alone.
      if (active > 0) {
        await wait();
        continue;
      }
      run(next++);
      continue;
    }

    // Small file: fill workers up to normal concurrency.
    if (active < limit) {
      run(next++);
      continue;
    }

    await wait();
  }
}
