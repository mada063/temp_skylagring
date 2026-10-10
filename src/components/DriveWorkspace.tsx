"use client";

import { useState } from "react";
import { Columns2, Rows2 } from "lucide-react";
import clsx from "clsx";
import DriveExplorer from "@/components/DriveExplorer";
import Splitter from "@/components/Splitter";
import { useSearchQuery } from "@/components/SearchQueryContext";

// Hosts one or more independent copies of the drive tree. The user can split
// the workspace left/right and/or top/bottom, and drag the dividers to resize.
export default function DriveWorkspace() {
  const query = useSearchQuery();
  const [vSplit, setVSplit] = useState(false); // left / right
  const [hSplit, setHSplit] = useState(false); // top / bottom
  const [colFrac, setColFrac] = useState(50);
  const [rowFrac, setRowFrac] = useState(50);

  const controls = (
    <>
      <button
        className={toggleClass(vSplit)}
        title={vSplit ? "Remove left/right split" : "Split left / right"}
        onClick={() => setVSplit((v) => !v)}
      >
        <Columns2 className="h-4 w-4" />
      </button>
      <button
        className={toggleClass(hSplit)}
        title={hSplit ? "Remove top/bottom split" : "Split top / bottom"}
        onClick={() => setHSplit((v) => !v)}
      >
        <Rows2 className="h-4 w-4" />
      </button>
    </>
  );

  // Only the very first pane carries the split controls and the search query.
  const pane = (primary: boolean) => (
    <DriveExplorer
      query={primary && query ? query : undefined}
      headerActions={primary ? controls : undefined}
    />
  );

  // The top region is a single pane, or a left/right split of two panes.
  const topRegion = vSplit ? (
    <Splitter
      direction="horizontal"
      fraction={colFrac}
      onFraction={setColFrac}
      a={pane(true)}
      b={pane(false)}
    />
  ) : (
    pane(true)
  );

  // A bottom split adds one full-width pane beneath the top region.
  if (hSplit) {
    return (
      <Splitter
        direction="vertical"
        fraction={rowFrac}
        onFraction={setRowFrac}
        a={topRegion}
        b={pane(false)}
      />
    );
  }
  return topRegion;
}

function toggleClass(active: boolean): string {
  return clsx(
    "btn px-2",
    active
      ? "border border-accent text-accent"
      : "border border-border text-muted hover:bg-elevated hover:text-fg",
  );
}
