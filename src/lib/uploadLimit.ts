/** Per-file upload cap exposed in Settings. 50 GB is plenty for personal use. */
export const MAX_UPLOAD_MB = 50 * 1024; // 51200 MB = 50 GB
export const MIN_UPLOAD_MB = 1;

/** Parallel upload workers when dropping many files / a folder. */
export const MIN_UPLOAD_CONCURRENCY = 1;
export const MAX_UPLOAD_CONCURRENCY = 64;
export const DEFAULT_UPLOAD_CONCURRENCY = 8;

/** Parallel folder-scan workers while reading a dropped directory. */
export const MIN_SCAN_CONCURRENCY = 4;
export const MAX_SCAN_CONCURRENCY = 64;
export const DEFAULT_SCAN_CONCURRENCY = 32;
