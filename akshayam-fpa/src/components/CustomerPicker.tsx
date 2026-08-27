"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";

/**
 * Pick one customer and see only their side of the page.
 *
 * A plain select, matching the year, period and vertical pickers beside it.
 * This was briefly a text box backed by a datalist, on the reasoning that four
 * hundred names want a search box - but a datalist renders its list wherever
 * the browser feels like putting it, which on a narrow pane meant the
 * suggestion floating loose in the corner of the window. A native select opens
 * where it is anchored, scrolls, and type-ahead still works once it is open.
 *
 * The choice lives in the query string like every other filter, so a partner
 * can send someone the link to one client's position.
 */
export function CustomerPicker({
  customers,
  current,
  label = "Customer",
}: {
  customers: string[];
  current: string | null;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const apply = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value) next.delete("customer");
    else next.set("customer", value);
    // A customer panel replaces the tile drill-downs; leaving one open behind
    // it would have two panels arguing about what the page is showing.
    if (value) next.delete("drill");
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <label
      className={clsx("flex items-center gap-2 text-[12px] text-ink-muted", pending && "opacity-60")}
    >
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={current ?? ""}
        onChange={(e) => apply(e.target.value)}
        className="max-w-[240px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink"
      >
        <option value="">All customers</option>
        {customers.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}
