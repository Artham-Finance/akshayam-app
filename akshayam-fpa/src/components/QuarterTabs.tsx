import clsx from "clsx";
import Link from "next/link";
import type { FyMonth, QuarterNo } from "@/lib/period";

/**
 * Period picker for a section that is struck quarterly.
 *
 * Links rather than a select, because there are only four and the reader
 * usually wants the one either side of the one they are on. Quarters the
 * ledger has not reached are shown but not offered: an empty statement reads
 * as a broken report rather than a future one.
 *
 * The active quarter opens into its months, which is this table's version of
 * expanding a column. It changes the window rather than adding columns - the
 * columns here are verticals, and three months of nine of them is a grid
 * nobody can read.
 */
export function QuarterTabs({
  current,
  currentMonth,
  reached,
  months,
  writtenTo,
  hrefFor,
}: {
  current: QuarterNo;
  /** the month key inside the quarter, when one is picked */
  currentMonth: string | null;
  /** the last quarter the ledger has entries for */
  reached: QuarterNo;
  /** every month of the year, for expanding the active quarter */
  months: FyMonth[];
  /** the date the ledger has been written to */
  writtenTo: string | null;
  hrefFor: (quarter: QuarterNo, month: string | null) => string;
}) {
  const labels = ["Q1 Apr-Jun", "Q2 Jul-Sep", "Q3 Oct-Dec", "Q4 Jan-Mar"];
  const inQuarter = months.filter(
    (m) => m.quarter === current && (!writtenTo || m.start <= writtenTo),
  );

  const chip =
    "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors whitespace-nowrap";

  return (
    <div className="flex flex-wrap items-center gap-1">
      {([1, 2, 3, 4] as const).map((q) => {
        if (q > reached) {
          return (
            <span
              key={q}
              className={clsx(chip, "text-ink-faint")}
              title="The ledger has not reached this quarter"
            >
              {labels[q - 1]}
            </span>
          );
        }
        const active = q === current;
        return (
          <Link
            key={q}
            href={hrefFor(q, null)}
            scroll={false}
            className={clsx(
              chip,
              active && currentMonth === null
                ? "bg-navy text-ink-invert"
                : active
                  ? "border border-navy text-navy"
                  : "border border-line text-ink-muted hover:bg-surface-sunk",
            )}
          >
            {labels[q - 1]}
          </Link>
        );
      })}

      {inQuarter.length > 0 && (
        <span className="ml-1 flex flex-wrap items-center gap-1 border-l border-line pl-2">
          {inQuarter.map((m) => (
            <Link
              key={m.key}
              href={hrefFor(current, m.key)}
              scroll={false}
              className={clsx(
                chip,
                currentMonth === m.key
                  ? "bg-navy text-ink-invert"
                  : "border border-line text-ink-muted hover:bg-surface-sunk",
              )}
            >
              {m.label}
            </Link>
          ))}
        </span>
      )}
    </div>
  );
}
