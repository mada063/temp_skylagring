"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Cloud,
  Search,
  Settings,
  User as UserIcon,
  LogOut,
  ChevronDown,
  HardDrive,
  Trash2,
} from "lucide-react";
import { formatBytes } from "@/lib/fileType";
import { SearchQueryContext } from "@/components/SearchQueryContext";

// The storage meter fills over each 1 GB. When a lap completes, that color
// becomes the track background and the next color fills on top of it.
const GB = 1024 * 1024 * 1024;
const LAP_COLORS = [
 "#f4b860", // gold
 "#34d399", // emerald
 "#38bdf8", // sky
 "#a78bfa", // violet
 "#fb7185", // rose
 "#fbbf24", // amber
 "#f472b6", // pink
 "#4ade80", // green
];

function storageLap(bytes: number): {
 pct: number;
 color: string;
 track: string | null;
 lap: number;
} {
 const lap = Math.floor(bytes / GB);
 const pct = ((bytes % GB) / GB) * 100;
 const color = LAP_COLORS[lap % LAP_COLORS.length];
 // Previous lap's color becomes the background once you've completed ≥1 GB.
 const track =
 lap > 0 ? LAP_COLORS[(lap - 1) % LAP_COLORS.length] : null;
 return { pct, color, track, lap };
}

export type ShellUser = {
 id: string;
 email: string;
 name: string | null;
 image: string | null;
};

export default function AppShell({
 user,
 children,
}: {
 user: ShellUser;
 children: React.ReactNode;
}) {
 const router = useRouter();
 const pathname = usePathname();
 const params = useSearchParams();

 const [query, setQuery] = useState(params.get("q") ?? "");
 const [usage, setUsage] = useState<{ bytes: number; files: number } | null>(
 null,
 );
 const searchRef = useRef<HTMLInputElement>(null);
 // Debounced query exposed to the drive — keeps typing responsive without
 // waiting on URL navigation, and avoids blurring the input on each fetch.
 const [driveQuery, setDriveQuery] = useState(
 () => (params.get("q") ?? "").trim(),
 );

 useEffect(() => {
 // Sync from the URL on back/forward only — never while the user is typing.
 if (document.activeElement === searchRef.current) return;
 const q = params.get("q") ?? "";
 setQuery(q);
 setDriveQuery(q.trim());
 }, [params]);

 const loadUsage = useCallback(() => {
 fetch("/api/me")
 .then((r) => (r.ok ? r.json() : null))
 .then((d) => d && setUsage(d.usage))
 .catch(() => {});
 }, []);

 useEffect(() => {
 loadUsage();
 }, [pathname, loadUsage]);

 // Keep the header usage current after uploads/deletes (panes broadcast this).
 useEffect(() => {
 function onRefresh() {
 loadUsage();
 }
 window.addEventListener("sky:refresh", onRefresh);
 return () => window.removeEventListener("sky:refresh", onRefresh);
 }, [loadUsage]);

 /** Update the address bar without a Next.js navigation (preserves input focus). */
 function syncUrlQuietly(q: string) {
 const url = q ? `/drive?q=${encodeURIComponent(q)}` : "/drive";
 const current = `${window.location.pathname}${window.location.search}`;
 if (current === url) return;
 window.history.replaceState(window.history.state, "", url);
 }

 function submitSearch(e: React.FormEvent) {
 e.preventDefault();
 const q = query.trim();
 setDriveQuery(q);
 if (pathname.startsWith("/drive")) {
 syncUrlQuietly(q);
 } else {
 router.replace(q ? `/drive?q=${encodeURIComponent(q)}` : "/drive");
 }
 }

 // Search as you type (debounced). Prefer a quiet history update on /drive so
 // the shell (and search input) are not remounted by App Router navigation.
 useEffect(() => {
 const q = query.trim();
 const t = setTimeout(() => {
 setDriveQuery(q);

 if (!pathname.startsWith("/drive")) {
 if (!q) return;
 router.replace(`/drive?q=${encodeURIComponent(q)}`);
 return;
 }

 syncUrlQuietly(q);
 }, 250);

 return () => clearTimeout(t);
 }, [query, pathname, router]);

 return (
 <SearchQueryContext.Provider value={driveQuery}>
 <div className="flex h-screen flex-col overflow-hidden bg-bg text-fg">
 {/* Header */}
 <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-5">
 <Link href="/drive" className="flex items-center gap-2.5">
 <div className="flex h-8 w-8 items-center justify-center bg-accent">
 <Cloud className="h-4 w-4 text-accent-fg" />
 </div>
 <span className="font-serif text-lg font-semibold tracking-tight">
 Skylagring
 </span>
 </Link>

 <form onSubmit={submitSearch} className="relative mx-auto w-full max-w-md">
 <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
 <input
 className="input pl-9"
 placeholder="Search files and folders…"
 value={query}
 ref={searchRef}
 onChange={(e) => setQuery(e.target.value)}
 />
 </form>

 {usage && <StorageMeter usage={usage} />}

 <ProfileMenu user={user} usage={usage} />
 </header>

 <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
 </div>
 </SearchQueryContext.Provider>
 );
}

function StorageMeter({
 usage,
}: {
 usage: { bytes: number; files: number };
}) {
 const { pct, color, track, lap } = storageLap(usage.bytes);
 return (
 <div
 className="hidden shrink-0 items-center gap-2 lg:flex"
 title={`${formatBytes(usage.bytes)} used · ${usage.files} files · ${lap} GB completed`}
 >
 <HardDrive className="h-4 w-4 text-muted" />
 <div
        className="h-1.5 w-24 overflow-hidden bg-elevated transition-colors"
 style={track ? { backgroundColor: track } : undefined}
 >
 <div
 className="h-full transition-all"
 style={{ width: `${pct.toFixed(1)}%`, backgroundColor: color }}
 />
 </div>
 <span className="whitespace-nowrap text-xs text-muted">
 {formatBytes(usage.bytes)}
 <span className="ml-1.5">
 · {usage.files} file{usage.files === 1 ? "" : "s"}
 </span>
 </span>
 </div>
 );
}

function ProfileMenu({
 user,
 usage,
}: {
 user: ShellUser;
 usage: { bytes: number; files: number } | null;
}) {
 const [open, setOpen] = useState(false);
 const ref = useRef<HTMLDivElement>(null);
 const router = useRouter();

 useEffect(() => {
 function onClick(e: MouseEvent) {
 if (ref.current && !ref.current.contains(e.target as Node)) {
 setOpen(false);
 }
 }
 document.addEventListener("mousedown", onClick);
 return () => document.removeEventListener("mousedown", onClick);
 }, []);

 async function logout() {
 await fetch("/api/auth/logout", { method: "POST" });
 router.replace("/login");
 router.refresh();
 }

 const initial = (user.name || user.email).charAt(0).toUpperCase();

 return (
 <div className="relative shrink-0" ref={ref}>
 <button
 onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 p-0.5 pr-2 transition-colors hover:bg-elevated"
 >
 <Avatar image={user.image} initial={initial} />
 <ChevronDown className="h-4 w-4 text-muted" />
 </button>

 {open && (
 <div className="absolute right-0 top-full z-30 mt-2 w-60 overflow-hidden border border-border bg-elevated shadow-xl">
 <div className="flex items-center gap-3 border-b border-border px-4 py-3">
 <Avatar image={user.image} initial={initial} />
 <div className="min-w-0">
 <p className="truncate text-sm font-medium">
 {user.name || "No name"}
 </p>
 <p className="truncate text-xs text-muted">{user.email}</p>
 </div>
 </div>

 {usage && (
 <div className="border-b border-border px-4 py-3">
 <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
 <span>Storage</span>
 <span>{usage.files} files</span>
 </div>
 {(() => {
 const lap = storageLap(usage.bytes);
 return (
 <div
                    className="mb-1.5 h-1.5 w-full overflow-hidden bg-surface transition-colors"
 style={lap.track ? { backgroundColor: lap.track } : undefined}
 >
 <div
 className="h-full transition-all"
 style={{
 width: `${lap.pct.toFixed(1)}%`,
 backgroundColor: lap.color,
 }}
 />
 </div>
 );
 })()}
 <p className="text-xs text-muted">{formatBytes(usage.bytes)} used</p>
 </div>
 )}

 <div className="p-1.5">
            <MenuLink
              href="/settings/profile"
              icon={UserIcon}
              label="Profile"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/settings"
              icon={Settings}
              label="Settings"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/trash"
              icon={Trash2}
              label="Trash"
              onNavigate={() => setOpen(false)}
            />
            <button
              onClick={logout}
              className="flex w-full items-center gap-3 px-3 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-danger"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
 </div>
 </div>
 )}
 </div>
 );
}

function MenuLink({
 href,
 icon: Icon,
 label,
 onNavigate,
}: {
 href: string;
 icon: typeof UserIcon;
 label: string;
 onNavigate: () => void;
}) {
 return (
 <Link
 href={href}
 onClick={onNavigate}
 className="flex items-center gap-3 px-3 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-fg"
 >
 <Icon className="h-4 w-4" />
 {label}
 </Link>
 );
}

function Avatar({ image, initial }: { image: string | null; initial: string }) {
 if (image) {
 // eslint-disable-next-line @next/next/no-img-element
 return (
 <img
 src={image}
 alt="Profile"
 className="h-8 w-8 rounded-full object-cover"
 />
 );
 }
 return (
 <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-fg">
 {initial}
 </div>
 );
}
