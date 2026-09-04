"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const TABS = [
  { href: "/settings/accounts", label: "Account mapping" },
  { href: "/settings/verticals", label: "Verticals" },
  { href: "/settings/tds-deductors", label: "TDS deductors" },
];

/**
 * Sub-navigation for the settings area.
 *
 * People is an admin-only tab, so it is appended rather than listed above -
 * a contributor should not be shown a tab that would only turn them away.
 */
export function SettingsTabs({ canManageUsers = false }: { canManageUsers?: boolean }) {
  const pathname = usePathname();
  const tabs = canManageUsers
    ? [...TABS, { href: "/settings/users", label: "People" }]
    : TABS;
  return (
    <div className="no-print mb-6 flex gap-1 border-b border-line">
      {tabs.map((tab) => {
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
