"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { EntitySwitcher } from "@/components/EntitySwitcher";
import { UserMenu } from "@/components/UserMenu";
import type { Permission, Role } from "@/lib/auth/permissions";

/**
 * Primary navigation. One row of labelled tabs, scrollable on narrow screens.
 * Deliberately flat - a management dashboard should never make someone hunt
 * through a menu to find the P&L.
 */

const SECTIONS = [
  { href: "/", label: "Overview" },
  { href: "/pnl", label: "Profit & Loss" },
  { href: "/balance-sheet", label: "Balance Sheet" },
  { href: "/cash-flow", label: "Cash Flow" },
  { href: "/budget-vs-actual", label: "Budget vs Actual" },
  { href: "/revenue", label: "Revenue" },
  { href: "/receivables", label: "Receivables" },
  { href: "/collections", label: "Collections" },
];

/**
 * Utility links, each with the permission that makes it worth showing.
 *
 * Hiding a link is presentation, not protection - the page behind it does its
 * own check. The point is that a viewer is not offered an Upload tab that
 * turns them away the moment they click it.
 */
const UTILITY: { href: string; label: string; needs: Permission }[] = [
  { href: "/upload", label: "Upload", needs: "data.upload" },
  { href: "/settings", label: "Settings", needs: "accounts.map" },
];

export function Nav({
  entities,
  currentSlug,
  user,
}: {
  entities: { slug: string; name: string }[];
  currentSlug: string;
  user: { name: string | null; email: string; role: Role; permissions: Permission[] };
}) {
  const pathname = usePathname();
  const allowed = new Set(user.permissions);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      {/* On a phone the company picker drops to its own line rather than
          fighting the nav buttons for width. */}
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1 sm:flex-none">
          {/*
            The brand, not the selected company - which one you are looking at
            is the switcher's job, right beside it. A title that changed with
            every switch was reading as confirmation of the switch rather than
            the firm's own name.
          */}
          <p className="truncate text-[17px] font-semibold uppercase tracking-wide text-ink">
            Akshayam Group
          </p>
          <p className="hidden text-[11px] uppercase tracking-[0.14em] text-ink-faint sm:block">
            Management Reporting
          </p>
        </div>
        <div className="order-3 w-full sm:order-none sm:w-auto">
          <EntitySwitcher entities={entities} current={currentSlug} />
        </div>
        <nav className="ml-auto flex shrink-0 items-center gap-1">
          {UTILITY.filter((item) => allowed.has(item.needs)).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                isActive(item.href)
                  ? "bg-navy text-ink-invert"
                  : "text-ink-muted hover:bg-navy-tint hover:text-navy",
              )}
            >
              {item.label}
            </Link>
          ))}
          <UserMenu name={user.name} email={user.email} role={user.role} />
        </nav>
      </div>

      <div className="scroll-fade overflow-x-auto border-t border-line">
        <div className="mx-auto flex max-w-[1400px] gap-1 px-3 sm:px-5">
          {SECTIONS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "relative whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors",
                  active ? "text-navy" : "text-ink-muted hover:text-ink",
                )}
              >
                {item.label}
                {active && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-navy" />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
