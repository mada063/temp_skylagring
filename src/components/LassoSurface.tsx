"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";

export type ItemKey = `file:${string}` | `folder:${string}`;

export function itemKey(kind: "file" | "folder", id: string): ItemKey {
  return `${kind}:${id}`;
}

type Rect = { left: number; top: number; right: number; bottom: number };

function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1),
  };
}

function intersects(a: Rect, b: DOMRect): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

const MIN_DRAG_PX = 4;

/**
 * Scrollable surface that supports click-drag marquee (lasso) selection of
 * descendants marked with `data-item-key`.
 */
export default function LassoSurface({
  children,
  className,
  selected,
  onSelectedChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onBackgroundClick,
  onBackgroundContextMenu,
}: {
  children: React.ReactNode;
  className?: string;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  /** Fired on a plain click of empty space (not after a lasso). */
  onBackgroundClick?: (e: React.MouseEvent) => void;
  /** Right-click on empty space (e.g. paste menu). */
  onBackgroundContextMenu?: (e: React.MouseEvent) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const [lasso, setLasso] = useState<Rect | null>(null);
  // Suppress the click that follows pointerup after a real lasso drag,
  // otherwise it would clear the selection we just made.
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    additive: boolean;
    baseline: Set<string>;
    active: boolean;
  } | null>(null);

  const hitTest = useCallback((rect: Rect): Set<string> => {
    const root = containerRef.current;
    if (!root) return new Set();
    const hits = new Set<string>();
    root.querySelectorAll<HTMLElement>("[data-item-key]").forEach((el) => {
      const key = el.dataset.itemKey;
      if (!key) return;
      if (intersects(rect, el.getBoundingClientRect())) hits.add(key);
    });
    return hits;
  }, []);

  const endDrag = useCallback(
    (e: PointerEvent, commit: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      setLasso(null);
      try {
        containerRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (!commit || !drag.active) return;

      suppressClickRef.current = true;
      const rect = normalizeRect(drag.originX, drag.originY, e.clientX, e.clientY);
      const hits = hitTest(rect);
      if (drag.additive) {
        const next = new Set(drag.baseline);
        hits.forEach((k) => next.add(k));
        onSelectedChange(next);
      } else {
        onSelectedChange(hits);
      }
    },
    [hitTest, onSelectedChange],
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      const dx = e.clientX - drag.originX;
      const dy = e.clientY - drag.originY;
      if (!drag.active && Math.hypot(dx, dy) >= MIN_DRAG_PX) {
        drag.active = true;
      }
      if (!drag.active) return;

      e.preventDefault();
      const rect = normalizeRect(drag.originX, drag.originY, e.clientX, e.clientY);
      setLasso(rect);

      const hits = hitTest(rect);
      if (drag.additive) {
        const next = new Set(drag.baseline);
        hits.forEach((k) => next.add(k));
        onSelectedChange(next);
      } else {
        onSelectedChange(hits);
      }
    }

    function onUp(e: PointerEvent) {
      endDrag(e, true);
    }
    function onCancel(e: PointerEvent) {
      endDrag(e, false);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [endDrag, hitTest, onSelectedChange]);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    // Only start a lasso from empty space — not on items, buttons, links, inputs.
    const target = e.target as HTMLElement;
    if (target.closest("[data-item-key], a, button, input, textarea, label")) {
      return;
    }
    // Don't fight native HTML5 file / item drags.
    if (target.closest("[draggable='true']")) return;

    e.preventDefault();
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    dragRef.current = {
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      additive,
      baseline: new Set(selectedRef.current),
      active: false,
    };
    containerRef.current?.setPointerCapture(e.pointerId);
  }

  function onClick(e: React.MouseEvent) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest("[data-item-key], a, button, input, textarea, label")) {
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      onSelectedChange(new Set());
    }
    onBackgroundClick?.(e);
  }

  const localLasso = lasso
    ? (() => {
        const root = containerRef.current?.getBoundingClientRect();
        if (!root) return null;
        return {
          left: lasso.left - root.left + (containerRef.current?.scrollLeft ?? 0),
          top: lasso.top - root.top + (containerRef.current?.scrollTop ?? 0),
          width: lasso.right - lasso.left,
          height: lasso.bottom - lasso.top,
        };
      })()
    : null;

  return (
    <div
      ref={containerRef}
      className={clsx("relative", className, lasso && "select-none")}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement;
        if (
          target.closest("[data-item-key], a, button, input, textarea, label")
        ) {
          return;
        }
        onBackgroundContextMenu?.(e);
      }}
    >
      {children}
      {localLasso && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 border border-accent bg-accent/15"
          style={{
            left: localLasso.left,
            top: localLasso.top,
            width: localLasso.width,
            height: localLasso.height,
          }}
        />
      )}
    </div>
  );
}

/** Toggle / replace selection for a single item click. */
export function applyItemClick(
  selected: Set<string>,
  key: string,
  e: { ctrlKey: boolean; metaKey: boolean },
): Set<string> {
  if (e.ctrlKey || e.metaKey) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }
  return new Set([key]);
}
