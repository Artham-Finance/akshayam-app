"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { QuarterTabs } from "@/components/QuarterTabs";
import { withParams, type Params } from "@/lib/href";
import type { FyMonth, QuarterNo } from "@/lib/period";

/**
 * FY / basis / vertical pickers plus the quarter-into-months drill-down,
 * written to the query string.
 */
export function ScorecardControls({
  financialYears,
  currentFy,
  currentQuarter,
  currentMonth,
  cumulative,
  months,
  reachedQuarter,
  writtenTo,
  params,
  verticalOptions,
  currentVertical,
  alwaysShowMonths = false,
}: {
  financialYears: number[];
  currentFy: number;
  currentQuarter: QuarterNo;
  /** the month picked inside the quarter, when one is */
  currentMonth: string | null;
  cumulative: boolean;
  /** every month of the year, for expanding the active quarter */
  months: FyMonth[];
  /** the last quarter the ledger has reached */
  reachedQuarter: QuarterNo;
  writtenTo: string | null;
  /** the page's current query params, so a quarter/month link keeps fy and basis */
  params: Params;
  /**
   * Every team-lead row a partner may pick to read as if they were that TL.
   * Empty for a slice's own login - there is nothing to pick, it already
   * shows only that one row.
   */
  verticalOptions: { code: string; label: string }[];
  /** the vertical currently picked, or null for the whole scorecard */
  currentVertical: string | null;
  /** show every reached month, not just the active quarter's */
  alwaysShowMonths?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // "All verticals" clears the param rather than setting it empty.
  const setVertical = (code: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (code) next.set("v", code);
    else next.delete("v");
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // "This year" is not a stored state of its own - it is cumulative to the
  // last quarter the ledger has reached, with no month narrowing it further.
  // Landing there is why this is a jump to a specific quarter and clears
  // whatever month was picked, rather than a plain patch onto whatever
  // quarter happened to be showing.
  const setYear = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("basis", "cumulative");
    next.set("q", String(reachedQuarter));
    next.delete("m");
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const basisValue = cumulative
    ? currentQuarter === reachedQuarter
      ? "year"
      : "cumulative"
    : "quarter";

  const cls =
    "rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink";

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", pending && "opacity-60")}>
      {financialYears.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span className="sr-only sm:not-sr-only">Year</span>
          <select value={currentFy} onChange={(e) => set({ fy: e.target.value })} className={cls}>
            {financialYears.map((y) => (
              <option key={y} value={y}>{`FY ${y}-${String(y + 1).slice(2)}`}</option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-2 text-[12px] text-ink-muted">
        <span className="sr-only sm:not-sr-only">Basis</span>
        <select
          value={basisValue}
          onChange={(e) => {
            if (e.target.value === "year") setYear();
            else set({ basis: e.target.value });
          }}
          className={cls}
        >
          <option value="year">This year</option>
          <option value="quarter">This quarter</option>
          <option value="cumulative">Cumulative to quarter</option>
        </select>
      </label>
      {verticalOptions.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span className="sr-only sm:not-sr-only">Vertical</span>
          <select
            value={currentVertical ?? ""}
            onChange={(e) => setVertical(e.target.value)}
            className={cls}
          >
            <option value="">All verticals</option>
            {verticalOptions.map((v) => (
              <option key={v.code} value={v.code}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <QuarterTabs
        current={currentQuarter}
        currentMonth={currentMonth}
        reached={reachedQuarter}
        months={months}
        writtenTo={writtenTo}
        hrefFor={(quarter, m) => withParams(pathname, params, { q: quarter, m })}
        alwaysShowMonths={alwaysShowMonths}
      />
    </div>
  );
}
