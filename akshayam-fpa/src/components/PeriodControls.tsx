"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";

/**
 * Financial-year and vertical pickers. They write to the query string so a
 * particular view of the report is a shareable URL - useful when a partner
 * wants to send the client a link to one vertical's P&L.
 */

export interface VerticalOption {
  id: number;
  name: string;
}

export interface PeriodOption {
  value: string;
  label: string;
}

export function PeriodControls({
  financialYears,
  currentFy,
  verticals,
  currentVerticalId,
  showVerticalPicker = true,
  months,
  weeks,
  currentMonth = null,
  currentWeek = null,
}: {
  financialYears: number[];
  currentFy: number;
  verticals: VerticalOption[];
  currentVerticalId: number | null;
  showVerticalPicker?: boolean;
  /** calendar months of the year, newest last */
  months?: PeriodOption[];
  /** Friday-to-Thursday reporting weeks */
  weeks?: PeriodOption[];
  currentMonth?: string | null;
  currentWeek?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  /**
   * Month and week are alternative ways of cutting the same year, so picking
   * one clears the other. Leaving both set would leave the page showing a
   * period neither picker describes.
   */
  const pickPeriod = (key: "month" | "week", value: string) => {
    const next = new URLSearchParams(params.toString());
    next.delete("month");
    next.delete("week");
    if (value) next.set(key, value);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const fyLabelFor = (year: number) => `FY ${year}-${String(year + 1).slice(2)}`;

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", pending && "opacity-60")}>
      {financialYears.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span className="sr-only sm:not-sr-only">Year</span>
          <select
            value={currentFy}
            onChange={(e) => update("fy", e.target.value)}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink"
          >
            {financialYears.map((year) => (
              <option key={year} value={year}>
                {fyLabelFor(year)}
              </option>
            ))}
          </select>
        </label>
      )}

      {months && months.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span className="sr-only sm:not-sr-only">Month</span>
          <select
            value={currentMonth ?? ""}
            onChange={(e) => pickPeriod("month", e.target.value)}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink"
          >
            <option value="">Year to date</option>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {weeks && weeks.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span className="sr-only sm:not-sr-only">Week</span>
          <select
            value={currentWeek ?? ""}
            onChange={(e) => pickPeriod("week", e.target.value)}
            className="max-w-[190px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink"
          >
            <option value="">All weeks</option>
            {weeks.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {showVerticalPicker && verticals.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span className="sr-only sm:not-sr-only">Vertical</span>
          <select
            value={currentVerticalId ?? ""}
            onChange={(e) => update("vertical", e.target.value || null)}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink"
          >
            <option value="">All verticals</option>
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
