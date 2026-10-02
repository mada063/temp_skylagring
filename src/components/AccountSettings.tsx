"use client";

import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { formatBytes } from "@/lib/fileType";
import {
  MAX_UPLOAD_MB,
  MIN_UPLOAD_MB,
  MAX_UPLOAD_CONCURRENCY,
  MIN_UPLOAD_CONCURRENCY,
  DEFAULT_UPLOAD_CONCURRENCY,
  MAX_SCAN_CONCURRENCY,
  MIN_SCAN_CONCURRENCY,
  DEFAULT_SCAN_CONCURRENCY,
} from "@/lib/uploadLimit";

export default function AccountSettings() {
  const [info, setInfo] = useState<{
    email: string;
    createdAt: string;
    usage: { bytes: number; files: number };
  } | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [limit, setLimit] = useState("");
  const [concurrency, setConcurrency] = useState(
    String(DEFAULT_UPLOAD_CONCURRENCY),
  );
  const [scanConcurrency, setScanConcurrency] = useState(
    String(DEFAULT_SCAN_CONCURRENCY),
  );
  const [limitSaving, setLimitSaving] = useState(false);
  const [limitSaved, setLimitSaved] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        setInfo({
          email: d.user.email,
          createdAt: d.user.createdAt,
          usage: d.usage,
        });
        setLimit(String(d.user.maxUploadMb ?? 10240));
        setConcurrency(
          String(d.user.uploadConcurrency ?? DEFAULT_UPLOAD_CONCURRENCY),
        );
        setScanConcurrency(
          String(d.user.scanConcurrency ?? DEFAULT_SCAN_CONCURRENCY),
        );
      });
  }, []);

  async function saveUploadSettings(e: React.FormEvent) {
    e.preventDefault();
    setLimitSaving(true);
    setLimitError(null);
    setLimitSaved(false);
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxUploadMb: Number(limit),
        uploadConcurrency: Number(concurrency),
        scanConcurrency: Number(scanConcurrency),
      }),
    });
    const json = await res.json();
    setLimitSaving(false);
    if (!res.ok) {
      setLimitError(json.error ?? "Could not update upload settings.");
      return;
    }
    setLimit(String(json.user.maxUploadMb));
    setConcurrency(String(json.user.uploadConcurrency));
    setScanConcurrency(String(json.user.scanConcurrency));
    setLimitSaved(true);
    setTimeout(() => setLimitSaved(false), 2000);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? "Could not update password.");
      return;
    }
    setSaved(true);
    setCurrent("");
    setNext("");
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-md space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Account</h2>
        {info ? (
          <dl className="card divide-y divide-border text-sm">
            <Row label="Email" value={info.email} />
            <Row
              label="Member since"
              value={new Date(info.createdAt).toLocaleDateString()}
            />
            <Row
              label="Storage used"
              value={`${formatBytes(info.usage.bytes)} · ${info.usage.files} files`}
            />
          </dl>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Uploads</h2>
        <form onSubmit={saveUploadSettings} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm text-muted">
              Maximum file size (MB)
            </label>
            <input
              className="input"
              type="number"
              min={MIN_UPLOAD_MB}
              max={MAX_UPLOAD_MB}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              required
            />
            <p className="mt-1.5 text-xs text-muted">
              Each uploaded file must be smaller than this. Allowed range:{" "}
              {MIN_UPLOAD_MB} MB – {MAX_UPLOAD_MB / 1024} GB.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-muted">
              Parallel uploads
            </label>
            <input
              className="input"
              type="number"
              min={MIN_UPLOAD_CONCURRENCY}
              max={MAX_UPLOAD_CONCURRENCY}
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
              required
            />
            <p className="mt-1.5 text-xs text-muted">
              How many files to upload at once. Higher is faster but harder on
              the browser. Allowed: {MIN_UPLOAD_CONCURRENCY}–
              {MAX_UPLOAD_CONCURRENCY}.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-muted">
              Folder scan speed
            </label>
            <input
              className="input"
              type="number"
              min={MIN_SCAN_CONCURRENCY}
              max={MAX_SCAN_CONCURRENCY}
              value={scanConcurrency}
              onChange={(e) => setScanConcurrency(e.target.value)}
              required
            />
            <p className="mt-1.5 text-xs text-muted">
              How many entries to read at once when dropping a folder. Higher
              scans faster. Allowed: {MIN_SCAN_CONCURRENCY}–
              {MAX_SCAN_CONCURRENCY}.
            </p>
          </div>
          {limitError && <p className="text-sm text-danger">{limitError}</p>}
          <button className="btn-primary" disabled={limitSaving}>
            {limitSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : limitSaved ? (
              <Check className="h-4 w-4" />
            ) : null}
            {limitSaved ? "Saved" : "Save upload settings"}
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Change password</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm text-muted">
              Current password
            </label>
            <input
              className="input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-muted">
              New password
            </label>
            <input
              className="input"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button className="btn-primary" disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="h-4 w-4" />
            ) : null}
            {saved ? "Updated" : "Update password"}
          </button>
        </form>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
