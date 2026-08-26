"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const TABS = [
  { href: "/settings/accounts", label: "Account mapping" },
  { href: "/settings/verticals", label: "Verticals" },
];

/** Sub-navigation for the settings area. */
export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <div className="no-print mb-6 flex gap-1 border-b border-line">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
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
