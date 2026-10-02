"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  UploadCloud,
  FolderSearch,
  FolderTree,
  Package,
  X,
} from "lucide-react";
import { formatBytes } from "@/lib/fileType";

export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelledError";
  }
}

type ActiveFile = {
  id: string;
  name: string;
  loaded: number;
  size: number;
};

type Job = {
  id: string;
  kind: "upload" | "zip";
  phase:
    | "scanning"
    | "preparing"
    | "uploading"
    | "zipping"
    | "done"
    | "cancelled";
  label: string;
  found: number;
  total: number;
  completed: number;
  failed: number;
  active: ActiveFile[];
  errors: string[];
};

type UploadResult = { files?: unknown[]; error?: string };

type ZipJobHandle = { jobId: string; signal: AbortSignal };

type UploadApi = {
  beginJob: () => string;
  setFound: (jobId: string, found: number) => void;
  startPreparing: (jobId: string, total: number) => void;
  startUploading: (jobId: string, total: number) => void;
  upload: (
    jobId: string,
    url: string,
    form: FormData,
    meta: { label: string; size: number },
  ) => Promise<UploadResult>;
  finishJob: (jobId: string) => void;
  failJob: (jobId: string, message: string) => void;
  /** Start a folder→ZIP toast; closing it aborts the fetch. */
  beginZipJob: (folderName: string) => ZipJobHandle;
  /** True after the user closed/cancelled this job. */
  isCancelled: (jobId: string) => boolean;
  /** Abort in-flight requests and stop the job. */
  cancelJob: (jobId: string) => void;
};

const UploadContext = createContext<UploadApi | null>(null);
const PROGRESS_THROTTLE_MS = 120;

export function useUploader(): UploadApi {
  const api = useContext(UploadContext);
  if (!api) throw new Error("useUploader must be used within an UploadProvider");
  return api;
}

export default function UploadProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const progressTimers = useRef<
    Record<
      string,
      { timer: ReturnType<typeof setTimeout> | null; pending: ActiveFile | null }
    >
  >({});
  const cancelled = useRef(new Set<string>());
  const xhrs = useRef(new Map<string, Set<XMLHttpRequest>>());
  const aborts = useRef(new Map<string, AbortController>());

  const patchJob = useCallback((id: string, fn: (j: Job) => Job) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? fn(j) : j)));
  }, []);

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
    xhrs.current.delete(id);
    aborts.current.delete(id);
  }, []);

  const isCancelled = useCallback((jobId: string) => {
    return cancelled.current.has(jobId);
  }, []);

  const cancelJob = useCallback(
    (jobId: string) => {
      cancelled.current.add(jobId);
      const set = xhrs.current.get(jobId);
      if (set) {
        for (const xhr of set) {
          try {
            xhr.abort();
          } catch {
            /* ignore */
          }
        }
        set.clear();
      }
      const ac = aborts.current.get(jobId);
      if (ac) {
        try {
          ac.abort();
        } catch {
          /* ignore */
        }
        aborts.current.delete(jobId);
      }
      // Clear progress timers for this job.
      for (const key of Object.keys(progressTimers.current)) {
        if (key.startsWith(`${jobId}:`)) {
          const slot = progressTimers.current[key];
          if (slot?.timer) clearTimeout(slot.timer);
          delete progressTimers.current[key];
        }
      }
      clearTimeout(timers.current[jobId]);
      patchJob(jobId, (j) => ({
        ...j,
        phase: "cancelled",
        active: [],
      }));
      timers.current[jobId] = setTimeout(() => removeJob(jobId), 1500);
    },
    [patchJob, removeJob],
  );

  const beginJob = useCallback(() => {
    const id = Math.random().toString(36).slice(2);
    cancelled.current.delete(id);
    xhrs.current.set(id, new Set());
    setJobs((prev) => [
      ...prev,
      {
        id,
        kind: "upload",
        phase: "scanning",
        label: "",
        found: 0,
        total: 0,
        completed: 0,
        failed: 0,
        active: [],
        errors: [],
      },
    ]);
    return id;
  }, []);

  const beginZipJob = useCallback((folderName: string): ZipJobHandle => {
    const id = Math.random().toString(36).slice(2);
    cancelled.current.delete(id);
    const ac = new AbortController();
    aborts.current.set(id, ac);
    setJobs((prev) => [
      ...prev,
      {
        id,
        kind: "zip",
        phase: "zipping",
        label: folderName,
        found: 0,
        total: 0,
        completed: 0,
        failed: 0,
        active: [],
        errors: [],
      },
    ]);
    return { jobId: id, signal: ac.signal };
  }, []);

  const setFound = useCallback(
    (jobId: string, found: number) => {
      if (cancelled.current.has(jobId)) return;
      patchJob(jobId, (j) => (j.found === found ? j : { ...j, found }));
    },
    [patchJob],
  );

  const startPreparing = useCallback(
    (jobId: string, total: number) => {
      if (cancelled.current.has(jobId)) return;
      patchJob(jobId, (j) => ({
        ...j,
        phase: "preparing",
        total,
        found: total,
      }));
    },
    [patchJob],
  );

  const startUploading = useCallback(
    (jobId: string, total: number) => {
      if (cancelled.current.has(jobId)) return;
      patchJob(jobId, (j) => ({
        ...j,
        phase: "uploading",
        total,
        found: total,
      }));
    },
    [patchJob],
  );

  const finishJob = useCallback(
    (jobId: string) => {
      if (cancelled.current.has(jobId)) return;
      aborts.current.delete(jobId);
      patchJob(jobId, (j) => ({ ...j, phase: "done", active: [] }));
      clearTimeout(timers.current[jobId]);
      timers.current[jobId] = setTimeout(() => removeJob(jobId), 3500);
    },
    [patchJob, removeJob],
  );

  const failJob = useCallback(
    (jobId: string, message: string) => {
      if (cancelled.current.has(jobId)) return;
      aborts.current.delete(jobId);
      patchJob(jobId, (j) => ({
        ...j,
        phase: "done",
        failed: Math.max(1, j.failed),
        active: [],
        errors: [...j.errors.slice(-4), message],
      }));
      clearTimeout(timers.current[jobId]);
      timers.current[jobId] = setTimeout(() => removeJob(jobId), 4500);
    },
    [patchJob, removeJob],
  );

  const upload = useCallback(
    (
      jobId: string,
      url: string,
      form: FormData,
      meta: { label: string; size: number },
    ) => {
      if (cancelled.current.has(jobId)) {
        return Promise.reject(new UploadCancelledError());
      }

      const fileId = Math.random().toString(36).slice(2);
      patchJob(jobId, (j) => ({
        ...j,
        active: [
          ...j.active,
          { id: fileId, name: meta.label, loaded: 0, size: meta.size },
        ],
      }));

      const applyProgress = (loaded: number, size: number) => {
        if (cancelled.current.has(jobId)) return;
        patchJob(jobId, (j) => ({
          ...j,
          active: j.active.map((a) =>
            a.id === fileId ? { ...a, loaded, size } : a,
          ),
        }));
      };

      return new Promise<UploadResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const bucket = xhrs.current.get(jobId) ?? new Set();
        bucket.add(xhr);
        xhrs.current.set(jobId, bucket);

        const cleanup = () => {
          bucket.delete(xhr);
          delete progressTimers.current[`${jobId}:${fileId}`];
        };

        xhr.open("POST", url);
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable || cancelled.current.has(jobId)) return;
          const key = `${jobId}:${fileId}`;
          let slot = progressTimers.current[key];
          if (!slot) {
            slot = { timer: null, pending: null };
            progressTimers.current[key] = slot;
          }
          slot.pending = {
            id: fileId,
            name: meta.label,
            loaded: e.loaded,
            size: e.total,
          };
          if (slot.timer) return;
          slot.timer = setTimeout(() => {
            const pending = progressTimers.current[key]?.pending;
            progressTimers.current[key] = { timer: null, pending: null };
            if (pending) applyProgress(pending.loaded, pending.size);
          }, PROGRESS_THROTTLE_MS);
        };
        xhr.onload = () => {
          cleanup();
          if (cancelled.current.has(jobId)) {
            reject(new UploadCancelledError());
            return;
          }
          let json: UploadResult = {};
          try {
            json = JSON.parse(xhr.responseText || "{}");
          } catch {
            /* ignore */
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            patchJob(jobId, (j) => ({
              ...j,
              completed: j.completed + 1,
              active: j.active.filter((a) => a.id !== fileId),
            }));
            resolve(json);
          } else {
            const msg = json.error || `Upload failed (${xhr.status})`;
            patchJob(jobId, (j) => ({
              ...j,
              failed: j.failed + 1,
              completed: j.completed + 1,
              active: j.active.filter((a) => a.id !== fileId),
              errors: [...j.errors.slice(-4), `${meta.label}: ${msg}`],
            }));
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => {
          cleanup();
          if (cancelled.current.has(jobId)) {
            reject(new UploadCancelledError());
            return;
          }
          patchJob(jobId, (j) => ({
            ...j,
            failed: j.failed + 1,
            completed: j.completed + 1,
            active: j.active.filter((a) => a.id !== fileId),
            errors: [...j.errors.slice(-4), `${meta.label}: Network error`],
          }));
          reject(new Error("Network error"));
        };
        xhr.onabort = () => {
          cleanup();
          patchJob(jobId, (j) => ({
            ...j,
            active: j.active.filter((a) => a.id !== fileId),
          }));
          reject(new UploadCancelledError());
        };
        xhr.send(form);
      });
    },
    [patchJob],
  );

  return (
    <UploadContext.Provider
      value={{
        beginJob,
        beginZipJob,
        setFound,
        startPreparing,
        startUploading,
        upload,
        finishJob,
        failJob,
        isCancelled,
        cancelJob,
      }}
    >
      {children}
      <UploadToasts
        jobs={jobs}
        onDismiss={(id, phase) => {
          if (phase === "done" || phase === "cancelled") {
            clearTimeout(timers.current[id]);
            removeJob(id);
          } else {
            cancelJob(id);
          }
        }}
      />
    </UploadContext.Provider>
  );
}

function UploadToasts({
  jobs,
  onDismiss,
}: {
  jobs: Job[];
  onDismiss: (id: string, phase: Job["phase"]) => void;
}) {
  if (jobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {jobs.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          onDismiss={() => onDismiss(job.id, job.phase)}
        />
      ))}
    </div>
  );
}

function JobCard({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  const active =
    job.phase === "scanning" ||
    job.phase === "preparing" ||
    job.phase === "uploading" ||
    job.phase === "zipping";
  const pct =
    job.phase === "uploading" && job.total > 0
      ? Math.min(100, Math.round((job.completed / job.total) * 100))
      : job.phase === "done"
        ? 100
        : 0;

  const title =
    job.phase === "scanning"
      ? job.found > 0
        ? `Reading folder… ${job.found} file${job.found === 1 ? "" : "s"} found`
        : "Reading folder…"
      : job.phase === "preparing"
        ? `Preparing ${job.total} file${job.total === 1 ? "" : "s"}…`
        : job.phase === "uploading"
          ? `Uploading ${job.total} file${job.total === 1 ? "" : "s"}…`
          : job.phase === "zipping"
            ? `Preparing ZIP…`
            : job.phase === "cancelled"
              ? job.kind === "zip"
                ? "ZIP cancelled"
                : "Upload cancelled"
              : job.kind === "zip"
                ? job.failed > 0
                  ? "ZIP failed"
                  : "ZIP ready"
                : job.failed > 0
                  ? `Done · ${job.failed} failed`
                  : "Uploads complete";

  return (
    <div className="overflow-hidden border border-border bg-elevated shadow-2xl">
      <div className="flex items-start gap-2 border-b border-border px-3 py-2.5">
        {job.phase === "scanning" ? (
          <FolderSearch className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-accent" />
        ) : job.phase === "preparing" ? (
          <FolderTree className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-accent" />
        ) : job.phase === "zipping" ? (
          <Package className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-accent" />
        ) : job.phase === "uploading" ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-accent" />
        ) : job.phase === "cancelled" ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        ) : job.failed > 0 ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          {job.phase === "preparing" && (
            <p className="text-[11px] text-muted">Creating folders…</p>
          )}
          {job.phase === "zipping" && job.label && (
            <p className="truncate text-[11px] text-muted" title={job.label}>
              {job.label}
            </p>
          )}
          {job.phase === "done" && job.kind === "zip" && job.failed === 0 && job.label && (
            <p className="truncate text-[11px] text-muted" title={job.label}>
              {job.label}.zip
            </p>
          )}
          {(job.phase === "uploading" ||
            (job.phase === "done" && job.kind === "upload")) && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden bg-surface">
                <div
                  className={
                    job.phase === "done" && job.failed === 0
                      ? "h-full bg-emerald-400 transition-all"
                      : "h-full bg-accent transition-all"
                  }
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] text-muted">{pct}%</span>
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 p-0.5 text-muted hover:text-fg"
          title={
            active
              ? job.kind === "zip"
                ? "Cancel ZIP"
                : "Cancel upload"
              : "Dismiss"
          }
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {job.active.length > 0 && (
        <div className="max-h-40 divide-y divide-border overflow-auto border-t border-border">
          {job.active.map((a) => {
            const filePct =
              a.size > 0
                ? Math.min(100, Math.round((a.loaded / a.size) * 100))
                : 0;
            return (
              <div key={a.id} className="px-3 py-2">
                <div className="mb-1 flex items-center gap-2">
                  <UploadCloud className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span
                    className="min-w-0 flex-1 truncate text-xs"
                    title={a.name}
                  >
                    {a.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {filePct}%
                  </span>
                </div>
                <div className="h-1 overflow-hidden bg-surface">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${filePct}%` }}
                  />
                </div>
                {a.size > 0 && (
                  <p className="mt-0.5 text-[10px] text-muted">
                    {formatBytes(a.loaded)} / {formatBytes(a.size)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {job.errors.length > 0 &&
        job.phase !== "scanning" &&
        job.phase !== "preparing" &&
        job.phase !== "zipping" &&
        job.phase !== "cancelled" && (
          <div className="space-y-0.5 border-t border-border px-3 py-2">
            {job.errors.map((err, i) => (
              <p
                key={i}
                className="truncate text-[11px] text-danger"
                title={err}
              >
                {err}
              </p>
            ))}
          </div>
        )}
    </div>
  );
}
