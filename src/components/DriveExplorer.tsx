"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
 ChevronRight,
 ChevronLeft,
 Folder as FolderIcon,
 FolderOpen,
 FolderPlus,
 Upload,
 Download,
 Trash2,
 Pencil,
 Loader2,
 Cloud,
 HardDrive,
 LayoutGrid,
 ListTree,
 Eye,
 Copy,
 ClipboardPaste,
} from "lucide-react";
import clsx from "clsx";
import FileIcon from "@/components/FileIcon";
import ContextMenu, { type MenuItem } from "@/components/ContextMenu";
import { useUploader, UploadCancelledError } from "@/components/UploadProvider";
import LassoSurface, {
  applyItemClick,
  itemKey,
} from "@/components/LassoSurface";
import { categorize, formatBytes } from "@/lib/fileType";
import {
  DEFAULT_UPLOAD_CONCURRENCY,
  DEFAULT_SCAN_CONCURRENCY,
} from "@/lib/uploadLimit";

type Folder = { id: string; name: string; parentId: string | null };
type FileItem = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  folderId: string | null;
};

const ROOT = "root";
const DRAG_TYPE = "application/x-skylagring-item";

type DragItem = { kind: "file" | "folder"; id: string };

// A file discovered while walking a dropped folder, together with the relative
// directory path it should live in ("" = the drop target itself).
type UploadEntry = { file: File; dir: string };

function readDirEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function getEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** Drain a directory reader (must be sequential on the same reader). */
async function readAllEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await readDirEntries(reader);
    all.push(...batch);
  } while (batch.length > 0);
  return all;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Run async work over items with a fixed concurrency limit. */
async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        await worker(items[i], i);
      }
    },
  );
  await Promise.all(runners);
}

/**
 * Recursively walk a dropped file/directory entry.
 * Sibling entries are resolved in parallel; UI progress is throttled.
 */
async function walkEntry(
  entry: FileSystemEntry,
  dir: string,
  out: UploadEntry[],
  concurrency: number,
  onFound?: (count: number) => void,
  notify?: { last: number },
  isCancelled?: () => boolean,
): Promise<void> {
  if (isCancelled?.()) return;
  const tick = notify ?? { last: 0 };

  const report = () => {
    if (!onFound) return;
    const now = performance.now();
    if (out.length - tick.last >= 50 || now - tick.last > 100) {
      tick.last = out.length;
      onFound(out.length);
    }
  };

  if (entry.isFile) {
    const file = await getEntryFile(entry as FileSystemFileEntry);
    if (isCancelled?.()) return;
    out.push({ file, dir });
    report();
    if (out.length % 200 === 0) await yieldToMain();
    return;
  }

  if (entry.isDirectory) {
    const childDir = dir ? `${dir}/${entry.name}` : entry.name;
    const children = await readAllEntries(
      (entry as FileSystemDirectoryEntry).createReader(),
    );
    if (isCancelled?.()) return;
    await mapPool(children, concurrency, async (child) => {
      if (isCancelled?.()) return;
      await walkEntry(
        child,
        childDir,
        out,
        concurrency,
        onFound,
        tick,
        isCancelled,
      );
    });
  }
}

export default function DriveExplorer({
 query,
 headerActions,
}: {
 query?: string;
 headerActions?: React.ReactNode;
}) {
  const uploadApi = useUploader();
  // Stable id so panes can distinguish their own refresh broadcasts.
  const instanceId = useRef(Math.random().toString(36).slice(2)).current;
  const concurrencyRef = useRef(DEFAULT_UPLOAD_CONCURRENCY);
  const scanConcurrencyRef = useRef(DEFAULT_SCAN_CONCURRENCY);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user?.uploadConcurrency) {
          concurrencyRef.current = d.user.uploadConcurrency;
        }
        if (d?.user?.scanConcurrency) {
          scanConcurrencyRef.current = d.user.scanConcurrency;
        }
      })
      .catch(() => {});
  }, []);

 const [folders, setFolders] = useState<Folder[]>([]);
 const [filesByFolder, setFilesByFolder] = useState<
 Record<string, FileItem[]>
 >({});
 const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT]));
 const [selected, setSelected] = useState<string>(ROOT);
 const [selectedItems, setSelectedItems] = useState<Set<string>>(
 () => new Set(),
 );
 const [clipboard, setClipboard] = useState<{
 fileIds: string[];
 folderIds: string[];
 } | null>(null);
 const [loading, setLoading] = useState(true);
 const [busy, setBusy] = useState<string | null>(null);
 const [dropTarget, setDropTarget] = useState<string | null>(null);

 // Per-pane view mode and current folder for the grid view.
 const [view, setView] = useState<"tree" | "grid">("tree");
 const [gridFolder, setGridFolder] = useState<string>(ROOT);
 const [menu, setMenu] = useState<{
 x: number;
 y: number;
 items: MenuItem[];
 } | null>(null);

 const activeFolder = view === "grid" ? gridFolder : selected;
 const clipboardRef = useRef(clipboard);
 clipboardRef.current = clipboard;
 const selectedItemsRef = useRef(selectedItems);
 selectedItemsRef.current = selectedItems;
 const activeFolderRef = useRef(activeFolder);
 activeFolderRef.current = activeFolder;
 const copySelectionRef = useRef<(keys: Set<string>) => void>(() => {});
 const pasteIntoRef = useRef<(destFolderId: string) => Promise<void>>(
 async () => {},
 );
 const deleteSelectionRef = useRef<(keys: Set<string>) => void>(() => {});

 // Delete / Backspace → trash; Ctrl/Cmd+C copy; Ctrl/Cmd+V paste; Esc clears.
 useEffect(() => {
 function onKey(e: KeyboardEvent) {
 const tag = (e.target as HTMLElement | null)?.tagName;
 if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
 if ((e.target as HTMLElement | null)?.isContentEditable) return;

 const mod = e.ctrlKey || e.metaKey;
 const key = e.key.toLowerCase();
 const code = e.code;

 if (e.key === "Escape") {
 setSelectedItems(new Set());
 return;
 }

 if (!mod && (e.key === "Delete" || e.key === "Backspace")) {
 if (selectedItemsRef.current.size === 0) return;
 e.preventDefault();
 deleteSelectionRef.current(new Set(selectedItemsRef.current));
 return;
 }

 if (mod && (key === "c" || code === "KeyC")) {
 if (selectedItemsRef.current.size === 0) return;
 e.preventDefault();
 copySelectionRef.current(new Set(selectedItemsRef.current));
 return;
 }

 if (mod && (key === "v" || code === "KeyV")) {
 if (!clipboardRef.current) return;
 e.preventDefault();
 void pasteIntoRef.current(activeFolderRef.current);
 }
 }
 window.addEventListener("keydown", onKey);
 return () => window.removeEventListener("keydown", onKey);
 }, []);

 // ---- data loading -------------------------------------------------------

 const childrenOf = useCallback(
 (parentId: string | null) =>
 folders
 .filter((f) => (f.parentId ?? ROOT) === (parentId ?? ROOT))
 .sort((a, b) => a.name.localeCompare(b.name)),
 [folders],
 );

 const loadFolders = useCallback(async () => {
 const res = await fetch("/api/folders");
 const json = await res.json();
 setFolders(json.folders ?? []);
 }, []);

 const loadFiles = useCallback(async (folderId: string) => {
 const param = folderId === ROOT ? "root" : folderId;
 const res = await fetch(`/api/files?folderId=${param}`);
 const json = await res.json();
 setFilesByFolder((prev) => ({ ...prev, [folderId]: json.files ?? [] }));
 }, []);

 // Reload folders and refresh files for every currently-expanded folder.
 const refreshLocal = useCallback(async () => {
 await loadFolders();
 await Promise.all([...expanded].map((id) => loadFiles(id)));
 }, [expanded, loadFiles, loadFolders]);

 // After a local mutation, refresh this pane and notify any other panes
 // (e.g. the split-view duplicate) so they stay in sync.
 const reload = useCallback(async () => {
 await refreshLocal();
 window.dispatchEvent(
 new CustomEvent("sky:refresh", { detail: { origin: instanceId } }),
 );
 }, [refreshLocal, instanceId]);

 useEffect(() => {
 (async () => {
 setLoading(true);
 await loadFolders();
 await loadFiles(ROOT);
 setLoading(false);
 })();
 }, [loadFolders, loadFiles]);

 // Listen for changes made by other panes.
 useEffect(() => {
 function onRefresh(e: Event) {
 const detail = (e as CustomEvent<{ origin: string }>).detail;
 if (detail?.origin !== instanceId) void refreshLocal();
 }
 window.addEventListener("sky:refresh", onRefresh);
 return () => window.removeEventListener("sky:refresh", onRefresh);
 }, [refreshLocal, instanceId]);

 function toggle(id: string) {
 setExpanded((prev) => {
 const next = new Set(prev);
 if (next.has(id)) {
 next.delete(id);
 } else {
 next.add(id);
 if (!filesByFolder[id]) void loadFiles(id);
 }
 return next;
 });
 }

 // Ensure the grid's current folder has its files loaded.
 useEffect(() => {
 if (view === "grid" && !filesByFolder[gridFolder]) void loadFiles(gridFolder);
 }, [view, gridFolder, filesByFolder, loadFiles]);

 function openGridFolder(id: string) {
 setGridFolder(id);
 setSelected(id);
 if (!filesByFolder[id]) void loadFiles(id);
 }

 // Breadcrumb chain from root down to the given folder.
 const folderPath = useCallback(
 (id: string): Folder[] => {
 const map = new Map(folders.map((f) => [f.id, f]));
 const path: Folder[] = [];
 let cur = id === ROOT ? undefined : map.get(id);
 while (cur) {
 path.unshift(cur);
 cur = cur.parentId ? map.get(cur.parentId) : undefined;
 }
 return path;
 },
 [folders],
 );

 // ---- mutations ----------------------------------------------------------

 async function createFolder(parentId: string) {
 const name = window.prompt("New folder name", "Untitled folder");
 if (!name?.trim()) return;
 setBusy("Creating folder…");
 await fetch("/api/folders", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 name: name.trim(),
 parentId: parentId === ROOT ? null : parentId,
 }),
 });
 setExpanded((prev) => new Set(prev).add(parentId));
 await reload();
 setBusy(null);
 }

 async function renameFolder(f: Folder) {
 const name = window.prompt("Rename folder", f.name);
 if (!name?.trim() || name === f.name) return;
 setBusy("Renaming…");
 await fetch(`/api/folders/${f.id}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ name: name.trim() }),
 });
 await reload();
 setBusy(null);
 }

 async function renameFile(file: FileItem) {
 const name = window.prompt("Rename file", file.name);
 if (!name?.trim() || name === file.name) return;
 setBusy("Renaming…");
 await fetch(`/api/files/${file.id}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ name: name.trim() }),
 });
 await reload();
 setBusy(null);
 }

 function collectDescendantIds(all: Folder[], rootId: string): Set<string> {
    const children = new Map<string | null, string[]>();
    for (const folder of all) {
      const arr = children.get(folder.parentId) ?? [];
      arr.push(folder.id);
      children.set(folder.parentId, arr);
    }
    const result = new Set<string>([rootId]);
    const stack = [rootId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of children.get(cur) ?? []) {
        if (!result.has(child)) {
          result.add(child);
          stack.push(child);
        }
      }
    }
    return result;
  }

  function broadcastRefresh() {
    window.dispatchEvent(
      new CustomEvent("sky:refresh", { detail: { origin: instanceId } }),
    );
  }

  async function deleteFolder(f: Folder) {
    if (
      !window.confirm(
        `Move "${f.name}" and everything inside it to the trash?`,
      )
    )
      return;

    const parentId = f.parentId ?? ROOT;
    const tree = collectDescendantIds(folders, f.id);

    // Hide immediately; soft-delete runs in the background.
    setFolders((prev) => prev.filter((x) => !tree.has(x.id)));
    setFilesByFolder((prev) => {
      const next = { ...prev };
      for (const id of tree) delete next[id];
      return next;
    });
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of tree) next.delete(id);
      return next;
    });
    if (tree.has(selected)) setSelected(parentId);
    if (tree.has(gridFolder)) setGridFolder(parentId);
    setSelectedItems((prev) => {
      const next = new Set(prev);
      for (const id of tree) next.delete(itemKey("folder", id));
      return next;
    });

    try {
      const res = await fetch(`/api/folders/${f.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      broadcastRefresh();
    } catch {
      await reload();
      window.alert(`Could not delete "${f.name}".`);
    }
  }

  async function deleteFile(file: FileItem) {
    if (!window.confirm(`Move "${file.name}" to the trash?`)) return;

    const parent = file.folderId ?? ROOT;
    setFilesByFolder((prev) => ({
      ...prev,
      [parent]: (prev[parent] ?? []).filter((x) => x.id !== file.id),
    }));
    setSelectedItems((prev) => {
      const next = new Set(prev);
      next.delete(itemKey("file", file.id));
      return next;
    });

    try {
      const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      broadcastRefresh();
    } catch {
      setFilesByFolder((prev) => ({
        ...prev,
        [parent]: [...(prev[parent] ?? []), file].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      }));
      window.alert(`Could not delete "${file.name}".`);
    }
  }

  const uploadFiles = useCallback(
    async (fileList: FileList | File[], folderId: string) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      const dest = folderId === ROOT ? "root" : folderId;
      setExpanded((prev) => new Set(prev).add(folderId));

      const jobId = uploadApi.beginJob();
      uploadApi.startUploading(jobId, files.length);
      await mapPool(files, concurrencyRef.current, async (f) => {
        if (uploadApi.isCancelled(jobId)) return;
        const form = new FormData();
        form.set("folderId", dest);
        form.append("file", f);
        try {
          await uploadApi.upload(jobId, "/api/files", form, {
            label: f.name,
            size: f.size,
          });
        } catch (err) {
          if (err instanceof UploadCancelledError) return;
          /* surfaced in the upload toast */
        }
      });
      if (uploadApi.isCancelled(jobId)) {
        await loadFiles(folderId);
        await reload();
        return;
      }
      uploadApi.finishJob(jobId);
      await loadFiles(folderId);
      await reload();
    },
    [uploadApi, loadFiles, reload],
  );

  // Upload dropped entries, which may include folders (whose structure is
  // recreated on the server).
  const uploadEntries = useCallback(
    async (entries: FileSystemEntry[], folderId: string) => {
      // Show the popup immediately so a long folder scan isn't silent.
      const jobId = uploadApi.beginJob();
      const collected: UploadEntry[] = [];
      try {
        const scanN = scanConcurrencyRef.current;
        await mapPool(entries, scanN, async (entry) => {
          if (uploadApi.isCancelled(jobId)) return;
          await walkEntry(
            entry,
            "",
            collected,
            scanN,
            (found) => uploadApi.setFound(jobId, found),
            undefined,
            () => uploadApi.isCancelled(jobId),
          );
        });
        if (uploadApi.isCancelled(jobId)) return;
        uploadApi.setFound(jobId, collected.length);
      } catch {
        if (uploadApi.isCancelled(jobId)) return;
        uploadApi.finishJob(jobId);
        window.alert("Could not read the dropped folder.");
        return;
      }
      if (uploadApi.isCancelled(jobId)) return;
      if (collected.length === 0) {
        uploadApi.finishJob(jobId);
        return;
      }

      const dest = folderId === ROOT ? "root" : folderId;
      setExpanded((prev) => new Set(prev).add(folderId));

      // Create the folder tree once (fast path: prefetch + parallel per depth).
      uploadApi.startPreparing(jobId, collected.length);
      if (uploadApi.isCancelled(jobId)) return;
      const paths = [
        ...new Set(collected.map((c) => c.dir).filter(Boolean)),
      ];
      try {
        if (!uploadApi.isCancelled(jobId)) {
          await fetch("/api/folders/ensure-tree", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: dest, paths }),
          });
        }
      } catch {
        /* uploads will still try to create folders; unique constraint covers races */
      }

      if (uploadApi.isCancelled(jobId)) {
        await loadFiles(folderId);
        await reload();
        return;
      }

      uploadApi.startUploading(jobId, collected.length);
      await mapPool(collected, concurrencyRef.current, async (item) => {
        if (uploadApi.isCancelled(jobId)) return;
        const form = new FormData();
        form.set("folderId", dest);
        form.append("file", item.file);
        form.append("path", item.dir);
        try {
          await uploadApi.upload(jobId, "/api/files", form, {
            label: item.file.name,
            size: item.file.size,
          });
        } catch (err) {
          if (err instanceof UploadCancelledError) return;
          /* surfaced in the upload toast */
        }
      });
      if (uploadApi.isCancelled(jobId)) {
        await loadFiles(folderId);
        await reload();
        return;
      }
      uploadApi.finishJob(jobId);
      await loadFiles(folderId);
      await reload();
    },
    [uploadApi, loadFiles, reload],
  );

 const moveItem = useCallback(
 async (item: DragItem, targetFolderId: string) => {
 const target = targetFolderId === ROOT ? null : targetFolderId;
 setBusy("Moving…");
 const url =
 item.kind === "folder"
 ? `/api/folders/${item.id}`
 : `/api/files/${item.id}`;
 const body =
 item.kind === "folder" ? { parentId: target } : { folderId: target };
 const res = await fetch(url, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(body),
 });
 if (!res.ok) {
 const json = await res.json().catch(() => ({}));
 window.alert(json.error ?? "Move failed.");
 }
 setExpanded((prev) => new Set(prev).add(targetFolderId));
 await reload();
 setBusy(null);
 },
 [reload],
 );

 // ---- drag & drop helpers ------------------------------------------------

 function handleDrop(e: React.DragEvent, folderId: string) {
 e.preventDefault();
 e.stopPropagation();
 setDropTarget(null);

 const dt = e.dataTransfer;

 // Snapshot FileList BEFORE touching items — webkitGetAsEntry() can empty
 // or truncate dataTransfer.files in some browsers.
 const droppedFiles = Array.from(dt.files ?? []);

 // Also collect via the items API. On Linux (esp. KDE/Dolphin + Firefox, or
 // some Wayland portals) files.length is often 1 while items still has every
 // file — so we keep both and pick the richer source below.
 const entries: FileSystemEntry[] = [];
 const itemFiles: File[] = [];
 if (dt.items && dt.items.length > 0) {
 for (let i = 0; i < dt.items.length; i++) {
 const item = dt.items[i];
 if (item.kind !== "file") continue;
 const entry = item.webkitGetAsEntry?.() ?? null;
 if (entry) entries.push(entry);
 const file = item.getAsFile?.() ?? null;
 if (file) itemFiles.push(file);
 }
 }
 const hasDirectory = entries.some((en) => en.isDirectory);

 // Folders present: recreate their structure via the entries API.
 if (hasDirectory) {
 void uploadEntries(entries, folderId);
 return;
 }

 // Prefer whichever flat-file source saw the most files.
 const bestFiles =
 itemFiles.length > droppedFiles.length
 ? itemFiles
 : droppedFiles.length > 0
 ? droppedFiles
 : itemFiles;

 if (bestFiles.length > 0 && bestFiles.length >= entries.length) {
 void uploadFiles(bestFiles, folderId);
 return;
 }

 if (entries.length > 0) {
 void uploadEntries(entries, folderId);
 return;
 }

 // Internal move (dragging an item between folders/panes).
 const raw = dt.getData(DRAG_TYPE);
 if (raw) {
 try {
 const item = JSON.parse(raw) as DragItem;
 if (item.kind === "folder" && item.id === folderId) return;
 void moveItem(item, folderId);
 } catch {
 /* ignore */
 }
 }
 }

 function allowDrop(e: React.DragEvent, folderId: string) {
 e.preventDefault();
 e.stopPropagation();
 setDropTarget(folderId);
 }

 // ---- context menu -------------------------------------------------------

 function openMenu(e: React.MouseEvent, items: MenuItem[]) {
 e.preventDefault();
 e.stopPropagation();
 setMenu({ x: e.clientX, y: e.clientY, items });
 }

 function parseSelectedKeys(keys: Set<string>): {
 fileIds: string[];
 folderIds: string[];
 } {
 const fileIds: string[] = [];
 const folderIds: string[] = [];
 for (const key of keys) {
 if (key.startsWith("file:")) fileIds.push(key.slice(5));
 else if (key.startsWith("folder:")) folderIds.push(key.slice(7));
 }
 return { fileIds, folderIds };
 }

 /** Drop nested folders / files already covered by a selected parent folder. */
 function pruneSelection(
 fileIds: string[],
 folderIds: string[],
 ): { fileIds: string[]; folderIds: string[] } {
 if (folderIds.length === 0) return { fileIds, folderIds };

 const covered = new Set<string>();
 const rootFolderIds: string[] = [];
 for (const id of folderIds) {
 let nested = false;
 for (const other of folderIds) {
 if (other === id) continue;
 if (collectDescendantIds(folders, other).has(id)) {
 nested = true;
 break;
 }
 }
 if (!nested) rootFolderIds.push(id);
 }
 for (const id of rootFolderIds) {
 for (const d of collectDescendantIds(folders, id)) covered.add(d);
 }

 const fileById = new Map<string, FileItem>();
 for (const list of Object.values(filesByFolder)) {
 for (const f of list) fileById.set(f.id, f);
 }

 return {
 folderIds: rootFolderIds,
 fileIds: fileIds.filter((id) => {
 const f = fileById.get(id);
 if (!f?.folderId) return true;
 return !covered.has(f.folderId);
 }),
 };
 }

 function downloadFile(file: FileItem) {
 const a = document.createElement("a");
 a.href = `/api/files/${file.id}/download`;
 a.download = file.name;
 document.body.appendChild(a);
 a.click();
 a.remove();
 }

  async function downloadFolderZip(folder: Folder) {
    const { jobId, signal } = uploadApi.beginZipJob(folder.name);
    try {
      const res = await fetch(`/api/folders/${folder.id}/download`, {
        signal,
      });
      if (uploadApi.isCancelled(jobId)) return;
      if (!res.ok) {
        throw new Error(`Failed (${res.status})`);
      }
      const blob = await res.blob();
      if (uploadApi.isCancelled(jobId)) return;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${folder.name}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      uploadApi.finishJob(jobId);
    } catch (err) {
      if (
        uploadApi.isCancelled(jobId) ||
        (err instanceof DOMException && err.name === "AbortError")
      ) {
        return;
      }
      uploadApi.failJob(
        jobId,
        err instanceof Error ? err.message : "Could not prepare ZIP",
      );
    }
  }

  async function downloadBulkZip(fileIds: string[], folderIds: string[]) {
    const count = fileIds.length + folderIds.length;
    const label =
      count === 1
        ? "1 item"
        : `${count} items`;
    const { jobId, signal } = uploadApi.beginZipJob(label);
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds, folderIds }),
        signal,
      });
      if (uploadApi.isCancelled(jobId)) return;
      if (!res.ok) {
        throw new Error(`Failed (${res.status})`);
      }
      const blob = await res.blob();
      if (uploadApi.isCancelled(jobId)) return;

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(
        disposition,
      );
      const filename = match
        ? decodeURIComponent(match[1] || match[2])
        : `download-${count}-items.zip`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      uploadApi.finishJob(jobId);
    } catch (err) {
      if (
        uploadApi.isCancelled(jobId) ||
        (err instanceof DOMException && err.name === "AbortError")
      ) {
        return;
      }
      uploadApi.failJob(
        jobId,
        err instanceof Error ? err.message : "Could not prepare ZIP",
      );
    }
  }

  function downloadSelection(keys: Set<string>) {
    const parsed = parseSelectedKeys(keys);
    const { fileIds, folderIds } = pruneSelection(
      parsed.fileIds,
      parsed.folderIds,
    );
    if (fileIds.length === 0 && folderIds.length === 0) return;

    if (fileIds.length === 1 && folderIds.length === 0) {
      const file = Object.values(filesByFolder)
        .flat()
        .find((f) => f.id === fileIds[0]);
      if (file) downloadFile(file);
      return;
    }
    if (fileIds.length === 0 && folderIds.length === 1) {
      const folder = folders.find((f) => f.id === folderIds[0]);
      if (folder) void downloadFolderZip(folder);
      return;
    }
    void downloadBulkZip(fileIds, folderIds);
  }

  function copySelection(keys: Set<string>) {
    const parsed = parseSelectedKeys(keys);
    const { fileIds, folderIds } = pruneSelection(
      parsed.fileIds,
      parsed.folderIds,
    );
    if (fileIds.length === 0 && folderIds.length === 0) return;
    setClipboard({ fileIds, folderIds });
  }

  async function pasteInto(destFolderId: string) {
    const clip = clipboardRef.current;
    if (!clip) return;
    if (clip.fileIds.length === 0 && clip.folderIds.length === 0) return;

    setBusy("Pasting…");
    try {
      const res = await fetch("/api/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileIds: clip.fileIds,
          folderIds: clip.folderIds,
          folderId: destFolderId === ROOT ? "root" : destFolderId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(json.error ?? "Paste failed.");
        return;
      }
      setExpanded((prev) => new Set(prev).add(destFolderId));
      await reload();
    } catch {
      window.alert("Paste failed.");
    } finally {
      setBusy(null);
    }
  }

  copySelectionRef.current = copySelection;
  pasteIntoRef.current = pasteInto;

  async function deleteSelection(keys: Set<string>) {
    const parsed = parseSelectedKeys(keys);
    const { fileIds, folderIds } = pruneSelection(
      parsed.fileIds,
      parsed.folderIds,
    );
    const total = fileIds.length + folderIds.length;
    if (total === 0) return;

    const label =
      total === 1
        ? "this item"
        : `these ${total} items`;
    if (
      !window.confirm(
        `Move ${label} to the trash? Folders include everything inside them.`,
      )
    ) {
      return;
    }

    // Optimistic UI: hide selected files and folder trees.
    const trees = folderIds.map((id) => collectDescendantIds(folders, id));
    const allFolderIds = new Set<string>();
    for (const tree of trees) for (const id of tree) allFolderIds.add(id);

    setFolders((prev) => prev.filter((f) => !allFolderIds.has(f.id)));
    setFilesByFolder((prev) => {
      const next = { ...prev };
      for (const id of allFolderIds) delete next[id];
      for (const [folderKey, list] of Object.entries(next)) {
        next[folderKey] = list.filter((f) => !fileIds.includes(f.id));
      }
      return next;
    });
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of allFolderIds) next.delete(id);
      return next;
    });
    if (allFolderIds.has(selected)) {
      const parent =
        folders.find((f) => folderIds.includes(f.id))?.parentId ?? ROOT;
      setSelected(parent);
    }
    if (allFolderIds.has(gridFolder)) {
      const parent =
        folders.find((f) => folderIds.includes(f.id))?.parentId ?? ROOT;
      setGridFolder(parent);
    }
    setSelectedItems(new Set());

    try {
      const results = await Promise.all([
        ...folderIds.map((id) =>
          fetch(`/api/folders/${id}`, { method: "DELETE" }),
        ),
        ...fileIds.map((id) =>
          fetch(`/api/files/${id}`, { method: "DELETE" }),
        ),
      ]);
      if (results.some((r) => !r.ok)) throw new Error("delete failed");
      broadcastRefresh();
    } catch {
      await reload();
      window.alert("Could not move some items to the trash.");
    }
  }

  deleteSelectionRef.current = (keys) => {
    void deleteSelection(keys);
  };

 function folderMenu(folder: Folder): MenuItem[] {
 const items: MenuItem[] = [
 {
 label: "Open",
 icon: <FolderOpen className="h-4 w-4" />,
 onClick: () =>
 view === "grid" ? openGridFolder(folder.id) : toggle(folder.id),
 },
 {
 label: "Download as ZIP",
 icon: <Download className="h-4 w-4" />,
 onClick: () => downloadFolderZip(folder),
 },
 {
 label: "Copy",
 icon: <Copy className="h-4 w-4" />,
 onClick: () =>
 copySelection(new Set([itemKey("folder", folder.id)])),
 },
 ];
 if (clipboard) {
 items.push({
 label: "Paste into folder",
 icon: <ClipboardPaste className="h-4 w-4" />,
 onClick: () => void pasteInto(folder.id),
 });
 }
 items.push(
 {
 label: "New subfolder",
 icon: <FolderPlus className="h-4 w-4" />,
 onClick: () => createFolder(folder.id),
 },
 {
 label: "Rename",
 icon: <Pencil className="h-4 w-4" />,
 onClick: () => renameFolder(folder),
 },
 { separator: true },
 {
 label: "Move to trash",
 icon: <Trash2 className="h-4 w-4" />,
 danger: true,
 onClick: () => deleteFolder(folder),
 },
 );
 return items;
 }

  function fileMenu(file: FileItem): MenuItem[] {
    return [
      {
        label: "Preview",
        icon: <Eye className="h-4 w-4" />,
        onClick: () =>
          window.open(`/api/files/${file.id}/download?inline=1`, "_blank"),
      },
      {
        label: "Download",
        icon: <Download className="h-4 w-4" />,
        onClick: () => downloadFile(file),
      },
      {
        label: "Copy",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => copySelection(new Set([itemKey("file", file.id)])),
      },
      {
        label: "Rename",
        icon: <Pencil className="h-4 w-4" />,
        onClick: () => renameFile(file),
      },
      { separator: true },
      {
        label: "Move to trash",
        icon: <Trash2 className="h-4 w-4" />,
        danger: true,
        onClick: () => deleteFile(file),
      },
    ];
  }

  function multiMenu(keys: Set<string>): MenuItem[] {
    const n = keys.size;
    return [
      {
        label: `Download ${n} items as ZIP`,
        icon: <Download className="h-4 w-4" />,
        onClick: () => downloadSelection(keys),
      },
      {
        label: `Copy ${n} items`,
        icon: <Copy className="h-4 w-4" />,
        onClick: () => copySelection(keys),
      },
      { separator: true },
      {
        label: `Move ${n} items to trash`,
        icon: <Trash2 className="h-4 w-4" />,
        danger: true,
        onClick: () => void deleteSelection(keys),
      },
    ];
  }

  function backgroundMenu(): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: "New folder",
        icon: <FolderPlus className="h-4 w-4" />,
        onClick: () => createFolder(activeFolder),
      },
    ];
    if (clipboard) {
      items.push({
        label: "Paste",
        icon: <ClipboardPaste className="h-4 w-4" />,
        onClick: () => void pasteInto(activeFolder),
      });
    }
    return items;
  }

  function openBackgroundMenu(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-item-key], a, button, input, textarea, label")) {
      return;
    }
    openMenu(e, backgroundMenu());
  }

  function openFolderMenu(e: React.MouseEvent, folder: Folder) {
    const key = itemKey("folder", folder.id);
    if (selectedItems.size > 1 && selectedItems.has(key)) {
      openMenu(e, multiMenu(new Set(selectedItems)));
      return;
    }
    if (!selectedItems.has(key)) {
      setSelectedItems(new Set([key]));
    }
    openMenu(e, folderMenu(folder));
  }

  function openFileMenu(e: React.MouseEvent, file: FileItem) {
    const key = itemKey("file", file.id);
    if (selectedItems.size > 1 && selectedItems.has(key)) {
      openMenu(e, multiMenu(new Set(selectedItems)));
      return;
    }
    if (!selectedItems.has(key)) {
      setSelectedItems(new Set([key]));
    }
    openMenu(e, fileMenu(file));
  }

 const contextMenu = menu ? (
 <ContextMenu
 x={menu.x}
 y={menu.y}
 items={menu.items}
 onClose={() => setMenu(null)}
 />
 ) : null;

 // Shared header action buttons (view toggle, new folder, upload).
 const actions = (
 <div className="flex shrink-0 items-center gap-2">
 <div className="flex overflow-hidden border border-border">
 <button
 className={viewBtn(view === "tree")}
 title="Tree view"
 onClick={() => setView("tree")}
 >
 <ListTree className="h-4 w-4" />
 </button>
 <button
 className={viewBtn(view === "grid")}
 title="Grid view"
 onClick={() => setView("grid")}
 >
 <LayoutGrid className="h-4 w-4" />
 </button>
 </div>
 <button className="btn-surface" onClick={() => createFolder(activeFolder)}>
 <FolderPlus className="h-4 w-4" />
 <span className="hidden md:inline">New folder</span>
 </button>
 <UploadButton onFiles={(files) => uploadFiles(files, activeFolder)} />
 {headerActions}
 </div>
 );

 // ---- search view --------------------------------------------------------

 if (query) {
 return <SearchResults query={query} />;
 }

 // ---- tree view ----------------------------------------------------------

 const hasContent =
 folders.length > 0 || (filesByFolder[ROOT]?.length ?? 0) > 0;

 return (
 <div className="flex h-full min-h-0 flex-col">
   {view === "grid" ? (
 <GridView
 path={folderPath(gridFolder)}
 loading={loading}
 folders={childrenOf(gridFolder === ROOT ? null : gridFolder)}
 files={filesByFolder[gridFolder] ?? []}
 dropTarget={dropTarget}
 gridFolder={gridFolder}
 actions={actions}
 selectedItems={selectedItems}
 onSelectedChange={setSelectedItems}
 onOpenFolder={openGridFolder}
 onOpenFile={(f) =>
 window.open(`/api/files/${f.id}/download?inline=1`, "_blank")
 }
 onDrop={handleDrop}
 onDragOver={allowDrop}
 onDragLeaveTarget={() => setDropTarget(null)}
 onFolderMenu={openFolderMenu}
 onFileMenu={openFileMenu}
 onBackgroundMenu={openBackgroundMenu}
 onUpload={(files) => uploadFiles(files, gridFolder)}
 />
 ) : (
 <>
 <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-3">
 <span className="truncate text-xs text-muted">{busy}</span>
 {actions}
 </div>

 <LassoSurface
 className={clsx(
 "min-h-0 flex-1 overflow-auto px-3 pb-6",
 dropTarget === ROOT && "bg-accent/5",
 )}
 selected={selectedItems}
 onSelectedChange={setSelectedItems}
 onDragOver={(e) => allowDrop(e, ROOT)}
 onDragLeave={() => setDropTarget(null)}
 onDrop={(e) => handleDrop(e, ROOT)}
 onBackgroundClick={() => setSelected(ROOT)}
 onBackgroundContextMenu={openBackgroundMenu}
 >
 {loading ? (
 <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted">
 <Loader2 className="h-4 w-4 animate-spin" /> Loading…
 </div>
 ) : hasContent ? (
 <TreeLevel
 parentId={ROOT}
 depth={0}
 childrenOf={childrenOf}
 filesByFolder={filesByFolder}
 expanded={expanded}
 selected={selected}
 selectedItems={selectedItems}
 dropTarget={dropTarget}
 onToggle={toggle}
 onSelect={setSelected}
 onSelectedChange={setSelectedItems}
 onDownloadFolder={downloadFolderZip}
 onDrop={handleDrop}
 onDragOver={allowDrop}
 onDragLeaveTarget={() => setDropTarget(null)}
 onNewFolder={createFolder}
 onRenameFolder={renameFolder}
 onDeleteFolder={deleteFolder}
 onRenameFile={renameFile}
 onDeleteFile={deleteFile}
 onFolderMenu={openFolderMenu}
 onFileMenu={openFileMenu}
 />
 ) : (
 <EmptyState onUpload={(files) => uploadFiles(files, ROOT)} />
 )}
 </LassoSurface>
 </>
 )}
 {contextMenu}
 </div>
 );
}

function viewBtn(active: boolean): string {
 return clsx(
 "flex h-9 w-9 items-center justify-center transition-colors",
 active ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
 );
}

// Recursively render folders (and their files) under a parent.
function TreeLevel(props: {
 parentId: string;
 depth: number;
 childrenOf: (id: string | null) => Folder[];
 filesByFolder: Record<string, FileItem[]>;
 expanded: Set<string>;
 selected: string;
 selectedItems: Set<string>;
 dropTarget: string | null;
 onToggle: (id: string) => void;
 onSelect: (id: string) => void;
 onSelectedChange: (next: Set<string>) => void;
 onDownloadFolder: (f: Folder) => void;
 onDrop: (e: React.DragEvent, id: string) => void;
 onDragOver: (e: React.DragEvent, id: string) => void;
 onDragLeaveTarget: () => void;
 onNewFolder: (id: string) => void;
 onRenameFolder: (f: Folder) => void;
 onDeleteFolder: (f: Folder) => void;
 onRenameFile: (f: FileItem) => void;
 onDeleteFile: (f: FileItem) => void;
 onFolderMenu: (e: React.MouseEvent, f: Folder) => void;
 onFileMenu: (e: React.MouseEvent, f: FileItem) => void;
}) {
 const {
 parentId,
 depth,
 childrenOf,
 filesByFolder,
 expanded,
 selected,
 selectedItems,
 dropTarget,
 } = props;
 const subfolders = childrenOf(parentId === ROOT ? null : parentId);
 const files = filesByFolder[parentId] ?? [];

 return (
 <>
 {subfolders.map((folder) => {
 const isOpen = expanded.has(folder.id);
 const key = itemKey("folder", folder.id);
 return (
 <div key={folder.id}>
 <TreeRow
 depth={depth}
 label={folder.name}
 expanded={isOpen}
 selected={selected === folder.id}
 itemSelected={selectedItems.has(key)}
 itemKeyAttr={key}
 isDropTarget={dropTarget === folder.id}
 draggable
 dragItem={{ kind: "folder", id: folder.id }}
 onToggle={() => props.onToggle(folder.id)}
 onSelect={(e) => {
 props.onSelect(folder.id);
 props.onSelectedChange(
 applyItemClick(selectedItems, key, e),
 );
 }}
 onDoubleClick={() => props.onDownloadFolder(folder)}
 onDrop={(e) => props.onDrop(e, folder.id)}
 onDragOver={(e) => props.onDragOver(e, folder.id)}
 onDragLeaveTarget={props.onDragLeaveTarget}
 onContextMenu={(e) => props.onFolderMenu(e, folder)}
 icon={
 isOpen ? (
 <FolderOpen className="h-4 w-4 text-accent" />
 ) : (
 <FolderIcon className="h-4 w-4 text-accent" />
 )
 }
 actions={
 <>
 <RowAction
 title="Download as ZIP"
 onClick={() => props.onDownloadFolder(folder)}
 >
 <Download className="h-3.5 w-3.5" />
 </RowAction>
 <RowAction
 title="New subfolder"
 onClick={() => props.onNewFolder(folder.id)}
 >
 <FolderPlus className="h-3.5 w-3.5" />
 </RowAction>
 <RowAction
 title="Rename"
 onClick={() => props.onRenameFolder(folder)}
 >
 <Pencil className="h-3.5 w-3.5" />
 </RowAction>
                  <RowAction
                    title="Move to trash"
                    danger
                    onClick={() => props.onDeleteFolder(folder)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </RowAction>
 </>
 }
 />
 {isOpen && (
 <TreeLevel {...props} parentId={folder.id} depth={depth + 1} />
 )}
 </div>
 );
 })}

 {files.map((file) => {
 const key = itemKey("file", file.id);
 return (
 <FileRow
 key={file.id}
 file={file}
 depth={depth}
 itemSelected={selectedItems.has(key)}
 itemKeyAttr={key}
 onSelect={(e) =>
 props.onSelectedChange(applyItemClick(selectedItems, key, e))
 }
 onRename={() => props.onRenameFile(file)}
 onDelete={() => props.onDeleteFile(file)}
 onContextMenu={(e) => props.onFileMenu(e, file)}
 />
 );
 })}

 {subfolders.length === 0 && files.length === 0 && parentId !== ROOT && (
 <div
 className="py-2 text-xs text-muted"
 style={{ paddingLeft: depth * 20 + 40 }}
 >
 Empty folder
 </div>
 )}
 </>
 );
}

function TreeRow({
 depth,
 label,
 expanded,
 selected,
 itemSelected,
 itemKeyAttr,
 isDropTarget,
 isRootNode,
 draggable,
 dragItem,
 icon,
 actions,
 onToggle,
 onSelect,
 onDoubleClick,
 onDrop,
 onDragOver,
 onDragLeaveTarget,
 onContextMenu,
}: {
 depth: number;
 label: string;
 expanded: boolean;
 selected: boolean;
 itemSelected?: boolean;
 itemKeyAttr?: string;
 isDropTarget?: boolean;
 isRootNode?: boolean;
 draggable?: boolean;
 dragItem?: DragItem;
 icon: React.ReactNode;
 actions?: React.ReactNode;
 onToggle: () => void;
 onSelect: (e: React.MouseEvent) => void;
 onDoubleClick?: () => void;
 onDrop?: (e: React.DragEvent) => void;
 onDragOver?: (e: React.DragEvent) => void;
 onDragLeaveTarget?: () => void;
 onContextMenu?: (e: React.MouseEvent) => void;
}) {
 return (
 <div
 data-item-key={itemKeyAttr}
 draggable={draggable}
 onDragStart={(e) => {
 if (dragItem) {
 e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragItem));
 e.dataTransfer.effectAllowed = "move";
 }
 }}
 onDrop={onDrop}
 onDragOver={onDragOver}
 onDragLeave={onDragLeaveTarget}
 onContextMenu={onContextMenu}
 onClick={(e) => {
 e.stopPropagation();
 onSelect(e);
 }}
 onDoubleClick={(e) => {
 e.stopPropagation();
 onDoubleClick?.();
 }}
 className={clsx(
 "group flex items-center gap-1 py-1.5 pr-2 transition-colors",
 itemSelected
 ? "bg-accent/20"
 : selected
 ? "bg-elevated"
 : "hover:bg-elevated/60",
 isDropTarget && "outline outline-2 outline-accent",
 )}
 style={{ paddingLeft: depth * 20 + 8 }}
 >
 <button
 onClick={(e) => {
 e.stopPropagation();
 onToggle();
 }}
 className="flex h-5 w-5 shrink-0 items-center justify-center text-muted hover:text-fg"
 >
 <ChevronRight
 className={clsx(
 "h-4 w-4 transition-transform",
 expanded && "rotate-90",
 )}
 />
 </button>
 {icon}
 <span
 className={clsx(
 "min-w-0 flex-1 truncate text-sm",
 isRootNode && "font-medium",
 )}
 title={onDoubleClick ? `${label} · double-click to download ZIP` : label}
 >
 {label}
 </span>
 {actions && (
 <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
 {actions}
 </div>
 )}
 </div>
 );
}

function FileRow({
 file,
 depth,
 itemSelected,
 itemKeyAttr,
 onSelect,
 onRename,
 onDelete,
 onContextMenu,
}: {
 file: FileItem;
 depth: number;
 itemSelected?: boolean;
 itemKeyAttr?: string;
 onSelect?: (e: React.MouseEvent) => void;
 onRename: () => void;
 onDelete: () => void;
 onContextMenu?: (e: React.MouseEvent) => void;
}) {
 return (
 <div
 data-item-key={itemKeyAttr}
 draggable
 onDragStart={(e) => {
 e.dataTransfer.setData(
 DRAG_TYPE,
 JSON.stringify({ kind: "file", id: file.id } as DragItem),
 );
 e.dataTransfer.effectAllowed = "move";
 }}
 onClick={(e) => {
 e.stopPropagation();
 onSelect?.(e);
 }}
 onContextMenu={onContextMenu}
 className={clsx(
 "group flex items-center gap-1 py-1.5 pr-2 transition-colors",
 itemSelected ? "bg-accent/20" : "hover:bg-elevated/60",
 )}
 style={{ paddingLeft: depth * 20 + 8 }}
 >
 <span className="h-5 w-5 shrink-0" />
 <FileIcon name={file.name} mimeType={file.mimeType} className="h-4 w-4" />
 <a
 href={`/api/files/${file.id}/download?inline=1`}
 target="_blank"
 rel="noreferrer"
 onClick={(e) => e.stopPropagation()}
 className="min-w-0 flex-1 truncate text-sm hover:underline"
 title={file.name}
 >
 {file.name}
 </a>
 <span className="shrink-0 px-2 text-xs text-muted">
 {formatBytes(file.size)}
 </span>
 <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
 <RowAction title="Download">
 <a href={`/api/files/${file.id}/download`}>
 <Download className="h-3.5 w-3.5" />
 </a>
 </RowAction>
 <RowAction title="Rename" onClick={onRename}>
 <Pencil className="h-3.5 w-3.5" />
 </RowAction>
        <RowAction title="Move to trash" danger onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </RowAction>
 </div>
 </div>
 );
}

function RowAction({
 children,
 title,
 danger,
 onClick,
}: {
 children: React.ReactNode;
 title: string;
 danger?: boolean;
 onClick?: () => void;
}) {
 return (
 <button
 title={title}
 onClick={(e) => {
 e.stopPropagation();
 onClick?.();
 }}
 className={clsx(
 "flex h-7 w-7 items-center justify-center text-muted transition-colors hover:bg-surface",
 danger ? "hover:text-danger" : "hover:text-fg",
 )}
 >
 {children}
 </button>
 );
}

function UploadButton({ onFiles }: { onFiles: (files: FileList) => void }) {
 const ref = useRef<HTMLInputElement>(null);
 return (
 <>
 <button className="btn-primary" onClick={() => ref.current?.click()}>
 <Upload className="h-4 w-4" />
 <span className="hidden md:inline">Upload</span>
 </button>
 <input
 ref={ref}
 type="file"
 multiple
 className="hidden"
 onChange={(e) => {
 if (e.target.files?.length) onFiles(e.target.files);
 e.target.value = "";
 }}
 />
 </>
 );
}

function EmptyState({ onUpload }: { onUpload: (files: FileList) => void }) {
 const ref = useRef<HTMLInputElement>(null);
 return (
 <button
 onClick={() => ref.current?.click()}
 className="flex w-full flex-col items-center justify-center gap-3 border border-dashed border-border py-16 text-center text-muted transition-colors hover:border-accent hover:text-fg"
 >
 <HardDrive className="h-8 w-8" />
 <div>
 <p className="text-sm font-medium">Your drive is empty</p>
 <p className="text-xs">Drag & drop files or folders here, or click to upload.</p>
 </div>
 <input
 ref={ref}
 type="file"
 multiple
 className="hidden"
 onClick={(e) => e.stopPropagation()}
 onChange={(e) => {
 if (e.target.files?.length) onUpload(e.target.files);
 e.target.value = "";
 }}
 />
 </button>
 );
}

// ---- search -------------------------------------------------------------

function SearchResults({ query }: { query: string }) {
 const router = useRouter();
 const [results, setResults] = useState<{
 files: FileItem[];
 folders: Folder[];
 } | null>(null);

 useEffect(() => {
 let active = true;
 fetch(`/api/files?q=${encodeURIComponent(query)}`)
 .then((r) => r.json())
 .then((json) => {
 if (active) setResults({ files: json.files ?? [], folders: json.folders ?? [] });
 });
 return () => {
 active = false;
 };
 }, [query]);

 const empty =
 results && results.files.length === 0 && results.folders.length === 0;

 return (
 <div className="h-full min-h-0 overflow-auto px-6 py-6">
 <div className="mb-5 flex items-center justify-between">
 <div>
 <h1 className="font-serif text-xl font-semibold">Search</h1>
 <p className="text-sm text-muted">
 Results for “{query}”
 </p>
 </div>
 <button className="btn-ghost" onClick={() => router.push("/drive")}>
 Clear search
 </button>
 </div>

 {!results ? (
 <div className="flex items-center gap-2 text-sm text-muted">
 <Loader2 className="h-4 w-4 animate-spin" /> Searching…
 </div>
 ) : empty ? (
 <div className="card p-10 text-center text-sm text-muted">
 No files or folders match “{query}”.
 </div>
 ) : (
 <div className="card divide-y divide-border">
 {results.folders.map((f) => (
 <button
 key={f.id}
 onClick={() => router.push("/drive")}
 className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-elevated"
 >
 <FolderIcon className="h-4 w-4 text-accent" />
 <span className="flex-1 truncate text-sm">{f.name}</span>
 <span className="text-xs text-muted">Folder</span>
 </button>
 ))}
 {results.files.map((file) => (
 <a
 key={file.id}
 href={`/api/files/${file.id}/download?inline=1`}
 target="_blank"
 rel="noreferrer"
 className="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated"
 >
 <FileIcon
 name={file.name}
 mimeType={file.mimeType}
 className="h-4 w-4"
 />
 <span className="flex-1 truncate text-sm">{file.name}</span>
 <span className="text-xs text-muted">
 {formatBytes(file.size)}
 </span>
 </a>
 ))}
 </div>
 )}
 </div>
 );
}

// ---- grid view ----------------------------------------------------------

function GridView({
 path,
 loading,
 folders,
 files,
 dropTarget,
 gridFolder,
 actions,
 selectedItems,
 onSelectedChange,
 onOpenFolder,
 onOpenFile,
 onDrop,
 onDragOver,
 onDragLeaveTarget,
 onFolderMenu,
 onFileMenu,
 onBackgroundMenu,
 onUpload,
}: {
 path: Folder[];
 loading: boolean;
 folders: Folder[];
 files: FileItem[];
 dropTarget: string | null;
 gridFolder: string;
 actions: React.ReactNode;
 selectedItems: Set<string>;
 onSelectedChange: (next: Set<string>) => void;
 onOpenFolder: (id: string) => void;
 onOpenFile: (f: FileItem) => void;
 onDrop: (e: React.DragEvent, id: string) => void;
 onDragOver: (e: React.DragEvent, id: string) => void;
 onDragLeaveTarget: () => void;
 onFolderMenu: (e: React.MouseEvent, f: Folder) => void;
 onFileMenu: (e: React.MouseEvent, f: FileItem) => void;
 onBackgroundMenu: (e: React.MouseEvent) => void;
 onUpload: (files: FileList) => void;
}) {
 const empty = folders.length === 0 && files.length === 0;

 return (
 <div className="flex h-full min-h-0 flex-col">
 <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-3">
 {/* Breadcrumb */}
 <div className="flex min-w-0 items-center gap-1 text-sm">
 <button
 onClick={() =>
 onOpenFolder(path.length > 1 ? path[path.length - 2].id : ROOT)
 }
 disabled={path.length === 0}
 title="Back"
 className="mr-1 flex h-8 w-8 items-center justify-center text-muted transition-colors hover:bg-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
 >
 <ChevronLeft className="h-4 w-4" />
 </button>
 <button
 onClick={() => onOpenFolder(ROOT)}
 title="My Drive"
 className={clsx(
 "flex items-center gap-1.5 px-1.5 py-1 hover:bg-elevated",
 path.length === 0 ? "text-fg" : "text-muted",
 )}
 >
 <Cloud className="h-4 w-4 text-accent" />
 </button>
 {path.map((f, i) => (
 <span key={f.id} className="flex min-w-0 items-center gap-1">
 <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
 <button
 onClick={() => onOpenFolder(f.id)}
 className={clsx(
 "truncate px-1.5 py-1 hover:bg-elevated",
 i === path.length - 1 ? "text-fg" : "text-muted",
 )}
 >
 {f.name}
 </button>
 </span>
 ))}
 </div>
 {actions}
 </div>

 <LassoSurface
 className={clsx(
 "min-h-0 flex-1 overflow-auto px-6 pb-6",
 dropTarget === gridFolder && "bg-accent/5",
 )}
 selected={selectedItems}
 onSelectedChange={onSelectedChange}
 onDragOver={(e) => onDragOver(e, gridFolder)}
 onDragLeave={onDragLeaveTarget}
 onDrop={(e) => onDrop(e, gridFolder)}
 onBackgroundContextMenu={onBackgroundMenu}
 >
 {loading ? (
 <div className="flex items-center gap-2 py-8 text-sm text-muted">
 <Loader2 className="h-4 w-4 animate-spin" /> Loading…
 </div>
 ) : empty ? (
 <EmptyState onUpload={onUpload} />
 ) : (
 <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
 {folders.map((folder) => {
 const key = itemKey("folder", folder.id);
 return (
 <FolderCard
 key={folder.id}
 folder={folder}
 itemSelected={selectedItems.has(key)}
 itemKeyAttr={key}
 isDropTarget={dropTarget === folder.id}
 onSelect={(e) =>
 onSelectedChange(applyItemClick(selectedItems, key, e))
 }
 onOpen={() => onOpenFolder(folder.id)}
 onContextMenu={(e) => onFolderMenu(e, folder)}
 onDrop={(e) => onDrop(e, folder.id)}
 onDragOver={(e) => onDragOver(e, folder.id)}
 onDragLeaveTarget={onDragLeaveTarget}
 />
 );
 })}
 {files.map((file) => {
 const key = itemKey("file", file.id);
 return (
 <FileCard
 key={file.id}
 file={file}
 itemSelected={selectedItems.has(key)}
 itemKeyAttr={key}
 onSelect={(e) =>
 onSelectedChange(applyItemClick(selectedItems, key, e))
 }
 onOpen={() => onOpenFile(file)}
 onContextMenu={(e) => onFileMenu(e, file)}
 />
 );
 })}
 </div>
 )}
 </LassoSurface>
 </div>
 );
}

function FolderCard({
 folder,
 itemSelected,
 itemKeyAttr,
 isDropTarget,
 onSelect,
 onOpen,
 onContextMenu,
 onDrop,
 onDragOver,
 onDragLeaveTarget,
}: {
 folder: Folder;
 itemSelected: boolean;
 itemKeyAttr: string;
 isDropTarget: boolean;
 onSelect: (e: React.MouseEvent) => void;
 onOpen: () => void;
 onContextMenu: (e: React.MouseEvent) => void;
 onDrop: (e: React.DragEvent) => void;
 onDragOver: (e: React.DragEvent) => void;
 onDragLeaveTarget: () => void;
}) {
 return (
 <button
 data-item-key={itemKeyAttr}
 draggable
 onDragStart={(e) => {
 e.dataTransfer.setData(
 DRAG_TYPE,
 JSON.stringify({ kind: "folder", id: folder.id } as DragItem),
 );
 e.dataTransfer.effectAllowed = "move";
 }}
 onClick={(e) => onSelect(e)}
 onDoubleClick={(e) => {
 e.preventDefault();
 onOpen();
 }}
 onContextMenu={onContextMenu}
 onDrop={onDrop}
 onDragOver={onDragOver}
 onDragLeave={onDragLeaveTarget}
 title={`${folder.name} · double-click to open`}
 className={clsx(
 "group flex flex-col overflow-hidden border border-border bg-surface text-left transition-colors hover:border-accent/60",
 itemSelected && "border-accent bg-accent/10",
 isDropTarget && "border-accent outline outline-2 outline-accent",
 )}
 >
 <div className="flex h-28 items-center justify-center bg-elevated/40">
 <FolderIcon className="h-12 w-12 text-accent" />
 </div>
 <div className="truncate px-3 py-2 text-sm">{folder.name}</div>
 </button>
 );
}

function FileCard({
 file,
 itemSelected,
 itemKeyAttr,
 onSelect,
 onOpen,
 onContextMenu,
}: {
 file: FileItem;
 itemSelected: boolean;
 itemKeyAttr: string;
 onSelect: (e: React.MouseEvent) => void;
 onOpen: () => void;
 onContextMenu: (e: React.MouseEvent) => void;
}) {
 const isImage = categorize(file.name, file.mimeType) === "image";
 return (
 <button
 data-item-key={itemKeyAttr}
 draggable
 onDragStart={(e) => {
 e.dataTransfer.setData(
 DRAG_TYPE,
 JSON.stringify({ kind: "file", id: file.id } as DragItem),
 );
 e.dataTransfer.effectAllowed = "move";
 }}
 onClick={(e) => onSelect(e)}
 onDoubleClick={(e) => {
 e.preventDefault();
 onOpen();
 }}
 onContextMenu={onContextMenu}
 title={`${file.name} · double-click to open`}
 className={clsx(
 "group flex flex-col overflow-hidden border border-border bg-surface text-left transition-colors hover:border-accent/60",
 itemSelected && "border-accent bg-accent/10",
 )}
 >
 <div className="flex h-28 items-center justify-center overflow-hidden bg-elevated/40">
 {isImage ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img
 src={`/api/files/${file.id}/download?inline=1`}
 alt={file.name}
 loading="lazy"
 className="h-full w-full object-cover"
 />
 ) : (
 <FileIcon
 name={file.name}
 mimeType={file.mimeType}
 className="h-12 w-12"
 />
 )}
 </div>
 <div className="flex items-center gap-2 px-3 py-2">
 <FileIcon
 name={file.name}
 mimeType={file.mimeType}
 className="h-4 w-4 shrink-0"
 />
 <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
 </div>
 </button>
 );
}
