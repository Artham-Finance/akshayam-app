"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const TABS = [
  { href: "/upload", label: "Upload" },
  { href: "/upload/files", label: "Download" },
];

/**
 * Sub-navigation for the upload area.
 *
 * Sending a file in and getting it back out are two halves of one job. When a
 * figure looks wrong the question is always what the file actually said, and
 * that has to be answerable from here rather than by hunting for the copy
 * somebody uploaded three weeks ago.
 */
export function UploadTabs() {
  const pathname = usePathname();
  return (
    <div className="no-print mb-6 flex gap-1 border-b border-line">
      {TABS.map((tab) => {
        // Every tab sits under /upload, so the parent has to match exactly or
        // it stays lit on all of them.
        const active =
          tab.href === "/upload" ? pathname === "/upload" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "relative px-3 py-2 text-[13px] font-medium transition-colors",
              active ? "text-navy" : "text-ink-muted hover:text-ink",
            )}
          >
            {tab.label}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-navy" />}
          </Link>
        );
      })}
    </div>
  );
}
