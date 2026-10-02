export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "archive"
  | "code"
  | "spreadsheet"
  | "document"
  | "text"
  | "ebook"
  | "rom"
  | "other";

const EXT: Record<string, FileCategory> = {
  // images
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  svg: "image", bmp: "image", ico: "image", heic: "image", avif: "image",
  // video
  mp4: "video", mov: "video", avi: "video", mkv: "video", webm: "video", m4v: "video",
  // audio
  mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio", aac: "audio",
  // pdf
  pdf: "pdf",
  // archives
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive", bz2: "archive",
  // code
  js: "code", ts: "code", tsx: "code", jsx: "code", json: "code", html: "code",
  css: "code", scss: "code", py: "code", rs: "code", go: "code", java: "code",
  c: "code", cpp: "code", sh: "code", rb: "code", php: "code", sql: "code", yml: "code", yaml: "code",
  // spreadsheets
  xls: "spreadsheet", xlsx: "spreadsheet", csv: "spreadsheet",
  // documents
  doc: "document", docx: "document", odt: "document", rtf: "document",
  ppt: "document", pptx: "document",
  // text
  txt: "text", md: "text", log: "text",
  // ebooks
  epub: "ebook", mobi: "ebook", azw: "ebook", azw3: "ebook", fb2: "ebook",
  // game ROMs / disc images
  rom: "rom", nes: "rom", smc: "rom", sfc: "rom", gba: "rom", gbc: "rom", gb: "rom",
  n64: "rom", z64: "rom", v64: "rom", nds: "rom", "3ds": "rom", cia: "rom",
  iso: "rom", bin: "rom", cue: "rom", chd: "rom", vpk: "rom", xci: "rom", nsp: "rom",
  wad: "rom", wbfs: "rom", rvz: "rom", gcm: "rom",
};

export function getExtension(name: string): string {
  const base = fileBaseName(name);
  const idx = base.lastIndexOf(".");
  return idx >= 0 ? base.slice(idx + 1).toLowerCase() : "";
}

/** Strip any directory prefix browsers may put in File.name for folder uploads. */
export function fileBaseName(name: string): string {
  const base = name.replace(/^.*[/\\]/, "").replace(/\0/g, "").trim();
  return base || "untitled";
}

export function categorize(name: string, mimeType?: string): FileCategory {
  const ext = getExtension(name);
  if (EXT[ext]) return EXT[ext];

  if (mimeType) {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType === "application/pdf") return "pdf";
    if (mimeType.startsWith("text/")) return "text";
  }
  return "other";
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
