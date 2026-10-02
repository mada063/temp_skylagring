"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const TABS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings", label: "Account" },
];

export default function SettingsNav() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-accent text-fg"
                : "border-transparent text-muted hover:text-fg",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
