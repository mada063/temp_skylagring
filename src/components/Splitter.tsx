"use client";

import { useRef, useState } from "react";
import clsx from "clsx";

// A two-pane split with a draggable gutter.
// direction "horizontal" = panes side by side (vertical gutter).
// direction "vertical"   = panes stacked (horizontal gutter).
export default function Splitter({
  direction,
  fraction,
  onFraction,
  a,
  b,
  min = 15,
}: {
  direction: "horizontal" | "vertical";
  fraction: number; // size of the first pane, as a percentage
  onFraction: (f: number) => void;
  a: React.ReactNode;
  b: React.ReactNode;
  min?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const isH = direction === "horizontal";

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const raw = isH
      ? ((e.clientX - rect.left) / rect.width) * 100
      : ((e.clientY - rect.top) / rect.height) * 100;
    onFraction(Math.max(min, Math.min(100 - min, raw)));
  }
  function onPointerUp(e: React.PointerEvent) {
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  return (
    <div
      ref={ref}
      className={clsx(
        "flex h-full w-full min-h-0 min-w-0",
        isH ? "flex-row" : "flex-col",
      )}
    >
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={isH ? { width: `${fraction}%` } : { height: `${fraction}%` }}
      >
        {a}
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={clsx(
          "shrink-0 bg-border transition-colors hover:bg-accent",
          dragging && "bg-accent",
          isH ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        )}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{b}</div>
    </div>
  );
}
