"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Folder as FolderIcon,
  Loader2,
  RotateCcw,
  Trash2,
  Ban,
} from "lucide-react";
import FileIcon from "@/components/FileIcon";
import { formatBytes } from "@/lib/fileType";

type TrashFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  deletedAt: string | null;
  daysLeft: number;
};

type TrashFolder = {
  id: string;
  name: string;
  deletedAt: string | null;
  daysLeft: number;
  itemCount?: number;
};

export default function TrashView() {
  const [files, setFiles] = useState<TrashFile[]>([]);
  const [folders, setFolders] = useState<TrashFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/trash");
    const json = await res.json();
    setFiles(json.files ?? []);
    setFolders(json.folders ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    action: "restore" | "purge" | "empty",
    kind?: "file" | "folder",
    id?: string,
  ) {
    if (action === "empty") {
      if (
        !window.confirm(
          "Permanently delete everything in the trash? This cannot be undone.",
        )
      )
        return;
    }
    if (action === "purge") {
      if (!window.confirm("Permanently delete this item? This cannot be undone."))
        return;
    }
    setBusy(action === "empty" ? "Emptying…" : action === "restore" ? "Restoring…" : "Deleting…");
    await fetch("/api/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, kind, id }),
    });
    await load();
    setBusy(null);
    window.dispatchEvent(
      new CustomEvent("sky:refresh", { detail: { origin: "trash" } }),
    );
  }

  const empty = files.length === 0 && folders.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-4">
        <div>
          <h1 className="font-serif text-xl font-semibold">Trash</h1>
          <p className="text-sm text-muted">
            {busy ??
              "Items stay here for 30 days, then are permanently deleted."}
          </p>
        </div>
        <button
          className="btn-surface text-danger"
          disabled={empty || !!busy}
          onClick={() => act("empty")}
        >
          <Ban className="h-4 w-4" />
          Empty trash
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-border py-20 text-muted">
            <Trash2 className="h-8 w-8" />
            <p className="text-sm">Trash is empty</p>
          </div>
        ) : (
          <div className="divide-y divide-border border border-border">
            {folders.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/60"
              >
                <FolderIcon className="h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{f.name}</p>
                  <p className="text-xs text-muted">
                    Folder
                    {typeof f.itemCount === "number" && f.itemCount > 0
                      ? ` · ${f.itemCount} item${f.itemCount === 1 ? "" : "s"}`
                      : ""}
                    {" · "}
                    {f.daysLeft} day{f.daysLeft === 1 ? "" : "s"} left
                  </p>
                </div>
                <button
                  className="btn-ghost"
                  title="Restore"
                  onClick={() => act("restore", "folder", f.id)}
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  className="btn-ghost text-danger"
                  title="Delete forever"
                  onClick={() => act("purge", "folder", f.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/60"
              >
                <FileIcon
                  name={file.name}
                  mimeType={file.mimeType}
                  className="h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{file.name}</p>
                  <p className="text-xs text-muted">
                    {formatBytes(file.size)} · {file.daysLeft} day
                    {file.daysLeft === 1 ? "" : "s"} left
                  </p>
                </div>
                <button
                  className="btn-ghost"
                  title="Restore"
                  onClick={() => act("restore", "file", file.id)}
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  className="btn-ghost text-danger"
                  title="Delete forever"
                  onClick={() => act("purge", "file", file.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
