"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";

/**
 * Company switcher: either trading company, or the group that consolidates
 * them. It sits in the header rather than buried in settings - whose figures
 * you are looking at is the single most important piece of context on the page.
 */
export function EntitySwitcher({
  entities,
  current,
}: {
  entities: { slug: string; name: string }[];
  current: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  if (entities.length < 2) return null;

  async function switchTo(slug: string) {
    setBusy(true);
    try {
      await fetch("/api/entity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label="Company"
      value={current}
      disabled={busy || pending}
      onChange={(e) => void switchTo(e.target.value)}
      className={clsx(
        "w-full truncate rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] font-medium text-ink sm:w-auto sm:max-w-[240px]",
        (busy || pending) && "opacity-60",
      )}
    >
      {entities.map((entity) => (
        <option key={entity.slug} value={entity.slug}>
          {entity.name}
        </option>
      ))}
    </select>
  );
}
