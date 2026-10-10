"use client";

import { useEffect, useRef, useState } from "react";
import FileIcon from "@/components/FileIcon";

/**
 * Grid thumbnail that only fetches when near the viewport, and falls back to
 * the file icon if the thumb endpoint has nothing (non-image / failed).
 */
export default function LazyThumb({
  fileId,
  name,
  mimeType,
}: {
  fileId: string;
  name: string;
  mimeType: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Native lazy helps a bit, but an IO with generous rootMargin lets us
    // skip work for cards far off-screen while still prefetching nearby ones.
    if (typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setActive(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center">
      {active && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${fileId}/thumbnail`}
          alt={name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <FileIcon name={name} mimeType={mimeType} className="h-12 w-12" />
      )}
    </div>
  );
}
