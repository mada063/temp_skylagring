"use client";

import { useEffect } from "react";
import clsx from "clsx";

export type MenuItem =
 | { separator: true }
 | {
 separator?: false;
 label: string;
 icon?: React.ReactNode;
 danger?: boolean;
 onClick: () => void;
 };

export default function ContextMenu({
 x,
 y,
 items,
 onClose,
}: {
 x: number;
 y: number;
 items: MenuItem[];
 onClose: () => void;
}) {
 useEffect(() => {
 function onKey(e: KeyboardEvent) {
 if (e.key === "Escape") onClose();
 }
 window.addEventListener("keydown", onKey);
 window.addEventListener("resize", onClose);
 window.addEventListener("scroll", onClose, true);
 return () => {
 window.removeEventListener("keydown", onKey);
 window.removeEventListener("resize", onClose);
 window.removeEventListener("scroll", onClose, true);
 };
 }, [onClose]);

 // Keep the menu inside the viewport.
 const width = 190;
 const height = items.length * 34 + 8;
 const left =
 typeof window !== "undefined" ? Math.min(x, window.innerWidth - width - 8) : x;
 const top =
 typeof window !== "undefined"
 ? Math.min(y, window.innerHeight - height - 8)
 : y;

 return (
 <>
 {/* Backdrop to catch outside clicks. */}
 <div className="fixed inset-0 z-40" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
 <div
 style={{ top, left, width }}
 className="fixed z-50 overflow-hidden border border-border bg-elevated py-1 text-sm shadow-xl"
 onContextMenu={(e) => e.preventDefault()}
 >
 {items.map((item, i) =>
 "separator" in item && item.separator ? (
 <div key={i} className="my-1 h-px bg-border" />
 ) : (
 <button
 key={i}
 onClick={() => {
 (item as Extract<MenuItem, { label: string }>).onClick();
 onClose();
 }}
 className={clsx(
 "flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-surface",
 (item as { danger?: boolean }).danger
 ? "text-danger"
 : "text-fg",
 )}
 >
 {(item as { icon?: React.ReactNode }).icon}
 {(item as { label: string }).label}
 </button>
 ),
 )}
 </div>
 </>
 );
}
