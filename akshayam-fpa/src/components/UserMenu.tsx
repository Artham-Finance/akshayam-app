"use client";

import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/login/actions";
import { ROLE_LABEL, type Role } from "@/lib/auth/permissions";

/**
 * Who you are signed in as, and the way out.
 *
 * The role is on the badge rather than hidden in a menu: when a button someone
 * expects is missing, the first useful thing to know is which role they are
 * holding.
 */
export function UserMenu({
  name,
  email,
  role,
}: {
  name: string | null;
  email: string;
  role: Role;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocument(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocument);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const label = name?.trim() || email;
  const initials = (name?.trim() || email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px] text-ink-muted transition-colors hover:bg-navy-tint hover:text-navy"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-navy text-[10px] font-semibold text-ink-invert">
          {initials || "?"}
        </span>
        <span className="hidden max-w-[140px] truncate font-medium sm:block">{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-60 rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          <div className="border-b border-line px-3 py-2.5">
            {name && (
              <p className="truncate text-[13px] font-medium text-ink">{name}</p>
            )}
            <p className="truncate text-[11px] text-ink-muted">{email}</p>
            <p className="mt-1.5 inline-block rounded-sm bg-navy-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy">
              {ROLE_LABEL[role]}
            </p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              role="menuitem"
              className="w-full rounded-sm px-3 py-2 text-left text-[12px] font-medium text-ink-muted transition-colors hover:bg-navy-tint hover:text-navy"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
