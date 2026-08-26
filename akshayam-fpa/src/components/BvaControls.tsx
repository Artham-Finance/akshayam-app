"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";

/**
 * Year and period pickers for Budget vs Actual.
 *
 * One list rather than the separate month and week pickers the revenue page
 * uses: a budget is built monthly and reviewed quarterly, so the periods worth
 * comparing on are the year, a quarter and a month - and putting them in one
 * list makes it obvious those are the only three. Weeks are deliberately absent;
 * a week of trading against a month of budget is not a comparison.
 */
export function BvaControls({
  financialYears,
  currentFy,
  months,
  current,
}: {
  financialYears: number[];
  currentFy: number;
  /** months the ledger has reached, the current one included */
  months: { value: string; label: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const select =
    "rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink";

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", pending && "opacity-60")}>
      <label className="flex items-center gap-2 text-[12px] text-ink-muted">
        <span className="sr-only sm:not-sr-only">Year</span>
        <select value={currentFy} onChange={(e) => update("fy", e.target.value)} className={select}>
          {financialYears.map((year) => (
            <option key={year} value={year}>
              FY {year}-{String(year + 1).slice(2)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-[12px] text-ink-muted">
        <span className="sr-only sm:not-sr-only">Period</span>
        <select value={current} onChange={(e) => update("period", e.target.value)} className={select}>
          <option value="ytd">Year to date</option>
          <option value="full">Full year</option>
          <optgroup label="Quarter">
            {([1, 2, 3, 4] as const).map((q) => (
              <option key={q} value={`q${q}`}>
                Q{q}
              </option>
            ))}
          </optgroup>
          {months.length > 0 && (
            <optgroup label="Month">
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
    </div>
  );
}
